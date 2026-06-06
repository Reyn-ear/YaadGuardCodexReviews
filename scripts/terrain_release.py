#!/usr/bin/env python3
import argparse
import gzip
import hashlib
import io
import json
import math
import os
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_COVERAGE_MANIFEST = ROOT / "coverage/jamaica-v1.manifest.json"
TILE_SIZE = 256
MIN_ZOOM = 6
MAX_ZOOM = 12
NODATA_ELEVATION_M = -2.0
GRID_LNG_STEP = 0.02
GRID_LAT_STEP = 0.015
REQUIRED_SOURCE_FIELDS = (
    "productVersion",
    "doi",
    "sourceUrl",
    "artifactUrl",
    "retrievedAt",
    "horizontalCrs",
    "verticalReference",
    "units",
    "noDataValue",
    "sourceTemporalRange",
    "localRasterPath",
)


def load_json(path):
    with Path(path).open(encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path, payload):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def require_command(name):
    command = shutil.which(name)
    if not command:
        raise RuntimeError(f"Required command is not installed or on PATH: {name}")
    return command


def run(command, **kwargs):
    return subprocess.run(command, check=True, text=True, **kwargs)


def validate_source_manifest(manifest):
    if manifest.get("sourceId") != "T-02":
        raise ValueError("GEDTM30 source manifest must use sourceId T-02")

    missing = [
        field
        for field in REQUIRED_SOURCE_FIELDS
        if manifest.get(field) in (None, "", "REQUIRED")
    ]
    checksum = manifest.get("checksum", {}).get("value")
    license_data = manifest.get("license", {})
    spacing = manifest.get("pixelSpacing", {})
    if checksum in (None, "", "REQUIRED"):
        missing.append("checksum.value")
    for field in ("identifier", "artifactLicenseUrl", "attribution"):
        if license_data.get(field) in (None, "", "REQUIRED"):
            missing.append(f"license.{field}")
    for field in ("x", "y", "units"):
        if spacing.get(field) in (None, "", "REQUIRED"):
            missing.append(f"pixelSpacing.{field}")
    if missing:
        raise ValueError(
            "Source artifact is not frozen; complete: " + ", ".join(missing)
        )
    if manifest["units"] != "m":
        raise ValueError("The first release requires source units normalized to metres")
    if manifest.get("scaleFactor") is None:
        raise ValueError("Source manifest must declare scaleFactor")

    raster_path = Path(manifest["localRasterPath"]).expanduser().resolve()
    if not raster_path.is_file():
        raise ValueError(f"Source raster does not exist: {raster_path}")
    actual_checksum = sha256(raster_path)
    if actual_checksum.lower() != checksum.lower():
        raise ValueError(
            f"Source checksum mismatch: expected {checksum}, got {actual_checksum}"
        )
    return raster_path, actual_checksum


def load_geospatial_dependencies():
    try:
        global np, rasterio, Image, Resampling, rasterize, from_bounds, reproject
        import numpy as np
        import rasterio
        from PIL import Image
        from rasterio.enums import Resampling
        from rasterio.features import rasterize
        from rasterio.transform import from_bounds
        from rasterio.warp import reproject
    except ModuleNotFoundError as error:
        raise RuntimeError(
            "Missing geospatial Python dependency. Run the command in "
            "containers/geospatial or install numpy, Pillow, and rasterio."
        ) from error


def validate_coverage_manifest(path):
    manifest = load_json(path)
    if not manifest.get("coverageId"):
        raise ValueError("Coverage manifest must declare coverageId")
    coverage_path = Path(manifest["path"]).expanduser()
    if not coverage_path.is_absolute():
        coverage_path = ROOT / coverage_path
    coverage_path = coverage_path.resolve()
    actual_checksum = sha256(coverage_path)
    expected_checksum = manifest.get("checksum", {}).get("value")
    if actual_checksum != expected_checksum:
        raise ValueError(
            f"Coverage checksum mismatch: expected {expected_checksum}, got {actual_checksum}"
        )
    return manifest, coverage_path, actual_checksum


def tile_bounds_lonlat(z, x, y):
    scale = 2**z
    west = x / scale * 360.0 - 180.0
    east = (x + 1) / scale * 360.0 - 180.0
    north = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / scale))))
    south = math.degrees(
        math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / scale)))
    )
    return west, south, east, north


def lon_to_tile_x(lon, zoom):
    return int(math.floor((lon + 180.0) / 360.0 * (2**zoom)))


def lat_to_tile_y(lat, zoom):
    latitude = math.radians(max(min(lat, 85.05112878), -85.05112878))
    return int(
        math.floor(
            (1 - math.asinh(math.tan(latitude)) / math.pi) / 2 * (2**zoom)
        )
    )


def tile_range(bounds, zoom):
    west, south, east, north = bounds
    return (
        range(lon_to_tile_x(west, zoom), lon_to_tile_x(east, zoom) + 1),
        range(lat_to_tile_y(north, zoom), lat_to_tile_y(south, zoom) + 1),
    )


def bounds_intersect(left, right):
    return not (
        left[2] < right[0]
        or left[0] > right[2]
        or left[3] < right[1]
        or left[1] > right[3]
    )


def geometries_for_bounds(bounds, geometries):
    return [
        geometry
        for geometry, geometry_bounds in geometries
        if bounds_intersect(bounds, geometry_bounds)
    ]


def tile_intersects_coverage(bounds, geometries):
    candidates = geometries_for_bounds(bounds, geometries)
    if not candidates:
        return False
    transform = from_bounds(*bounds, 16, 16)
    mask = rasterize(
        [(geometry, 1) for geometry in candidates],
        out_shape=(16, 16),
        transform=transform,
        fill=0,
        dtype=np.uint8,
        all_touched=True,
    )
    return bool(mask.any())


def visual_tile_count(
    bounds, geometries, min_zoom=MIN_ZOOM, max_zoom=MAX_ZOOM
):
    total = 0
    for zoom in range(min_zoom, max_zoom + 1):
        x_range, y_range = tile_range(bounds, zoom)
        for x in x_range:
            for y in y_range:
                if tile_intersects_coverage(
                    tile_bounds_lonlat(zoom, x, y), geometries
                ):
                    total += 1
    return total


def encode_custom_dem(elevations):
    encoded = np.clip(elevations + 3276.8, 0, 6553.5)
    green = np.floor(encoded / 25.6)
    blue = np.round((encoded - green * 25.6) / 0.1)
    rgba = np.zeros((*elevations.shape, 4), dtype=np.uint8)
    rgba[:, :, 1] = np.clip(green, 0, 255).astype(np.uint8)
    rgba[:, :, 2] = np.clip(blue, 0, 255).astype(np.uint8)
    rgba[:, :, 3] = 255
    return rgba


def terrain_image_bytes(rgba, image_format):
    with tempfile.SpooledTemporaryFile() as output:
        image = Image.fromarray(rgba, mode="RGBA").convert("RGB")
        if image_format == "webp":
            image.save(
                output,
                format="WEBP",
                lossless=True,
                quality=100,
                method=4,
            )
        else:
            image.save(output, format="PNG", optimize=True, compress_level=9)
        output.seek(0)
        return output.read()


def image_dimensions(payload):
    with Image.open(io.BytesIO(payload)) as image:
        return image.size


def open_mbtiles(
    path,
    bounds,
    coverage_id,
    tile_size,
    min_zoom,
    max_zoom,
    image_format,
):
    connection = sqlite3.connect(path)
    connection.executescript(
        """
        PRAGMA journal_mode=OFF;
        PRAGMA synchronous=OFF;
        CREATE TABLE metadata (name TEXT, value TEXT);
        CREATE UNIQUE INDEX metadata_name ON metadata (name);
        CREATE TABLE tiles (
          zoom_level INTEGER,
          tile_column INTEGER,
          tile_row INTEGER,
          tile_data BLOB
        );
        CREATE UNIQUE INDEX tile_index
          ON tiles (zoom_level, tile_column, tile_row);
        """
    )
    metadata = {
        "name": f"GEDTM30 {coverage_id} candidate",
        "type": "baselayer",
        "version": "1",
        "description": "Custom-encoded 0.1 m raster DEM for GEDTM30 evaluation",
        "format": image_format,
        "bounds": ",".join(str(value) for value in bounds),
        "minzoom": str(min_zoom),
        "maxzoom": str(max_zoom),
        "tile_size": str(tile_size),
    }
    connection.executemany(
        "INSERT INTO metadata(name, value) VALUES (?, ?)", metadata.items()
    )
    return connection


def read_coverage_geometry(path):
    payload = load_json(path)
    geometries = []
    for feature in payload.get("features", []):
        geometry = feature.get("geometry")
        if not geometry:
            continue
        coordinates = geometry["coordinates"]
        points = []

        def collect(value):
            if (
                isinstance(value, list)
                and len(value) >= 2
                and isinstance(value[0], (int, float))
                and isinstance(value[1], (int, float))
            ):
                points.append(value)
                return
            for item in value:
                collect(item)

        collect(coordinates)
        geometry_bounds = (
            min(point[0] for point in points),
            min(point[1] for point in points),
            max(point[0] for point in points),
            max(point[1] for point in points),
        )
        geometries.append((geometry, geometry_bounds))
    if not geometries:
        raise ValueError("Coverage GeoJSON contains no geometries")
    return geometries


def sample_window(dataset, bounds, width, height, geometries, scale_factor):
    destination = np.full((height, width), np.nan, dtype=np.float32)
    transform = from_bounds(*bounds, width, height)
    reproject(
        source=rasterio.band(dataset, 1),
        destination=destination,
        src_transform=dataset.transform,
        src_crs=dataset.crs,
        src_nodata=dataset.nodata,
        dst_transform=transform,
        dst_crs="EPSG:4326",
        dst_nodata=np.nan,
        resampling=Resampling.bilinear,
    )
    destination *= float(scale_factor)
    candidates = geometries_for_bounds(bounds, geometries)
    if candidates:
        land_mask = rasterize(
            [(geometry, 1) for geometry in candidates],
            out_shape=(height, width),
            transform=transform,
            fill=0,
            dtype=np.uint8,
            all_touched=True,
        ).astype(bool)
    else:
        land_mask = np.zeros((height, width), dtype=bool)
    valid = land_mask & np.isfinite(destination)
    return destination, land_mask, valid


def build_visual_tiles(
    dataset,
    mbtiles_path,
    bounds,
    geometries,
    scale_factor,
    coverage_id,
    tile_size,
    min_zoom,
    max_zoom,
    image_format,
):
    connection = open_mbtiles(
        mbtiles_path,
        bounds,
        coverage_id,
        tile_size,
        min_zoom,
        max_zoom,
        image_format,
    )
    tile_count = 0
    try:
        for zoom in range(min_zoom, max_zoom + 1):
            x_range, y_range = tile_range(bounds, zoom)
            for x in x_range:
                for y in y_range:
                    tile_bounds = tile_bounds_lonlat(zoom, x, y)
                    if not tile_intersects_coverage(tile_bounds, geometries):
                        continue
                    values, _land_mask, valid = sample_window(
                        dataset,
                        tile_bounds,
                        tile_size,
                        tile_size,
                        geometries,
                        scale_factor,
                    )
                    normalized = np.full(values.shape, NODATA_ELEVATION_M)
                    normalized[valid] = values[valid]
                    connection.execute(
                        "INSERT INTO tiles VALUES (?, ?, ?, ?)",
                        (
                            zoom,
                            x,
                            (2**zoom - 1) - y,
                            terrain_image_bytes(
                                encode_custom_dem(normalized), image_format
                            ),
                        ),
                    )
                    tile_count += 1
            connection.commit()
    finally:
        connection.close()
    return tile_count


def sql_quote(value):
    if value is None:
        return "NULL"
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def analysis_cells(bounds):
    west, south, east, north = bounds
    start_lng = math.floor(west / GRID_LNG_STEP) * GRID_LNG_STEP
    start_lat = math.floor(south / GRID_LAT_STEP) * GRID_LAT_STEP
    lng = start_lng
    while lng < east:
        lat = start_lat
        while lat < north:
            yield (
                f"jam:{round(lng, 6)}:{round(lat, 6)}",
                (lng, lat, lng + GRID_LNG_STEP, lat + GRID_LAT_STEP),
            )
            lat += GRID_LAT_STEP
        lng += GRID_LNG_STEP


def build_analysis(
    dataset,
    release_dir,
    source_release,
    bounds,
    geometries,
    scale_factor,
):
    chunks_dir = release_dir / "analysis/gedtm30/elevation-grids"
    chunks_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    for cell_id, cell_bounds in analysis_cells(bounds):
        values, land_mask, valid = sample_window(
            dataset, cell_bounds, 20, 20, geometries, scale_factor
        )
        if not land_mask.any():
            continue
        valid_values = values[valid]
        if valid_values.size:
            minimum = float(np.min(valid_values))
            maximum = float(np.max(valid_values))
            mean = float(np.mean(valid_values))
            relief = maximum - minimum
            lat = (cell_bounds[1] + cell_bounds[3]) / 2
            x_spacing = max(
                GRID_LNG_STEP * 111320 * math.cos(math.radians(lat)) / 19, 1
            )
            y_spacing = GRID_LAT_STEP * 110540 / 19
            filled = np.where(valid, values, mean)
            gradient_y, gradient_x = np.gradient(filled, y_spacing, x_spacing)
            slope = float(
                np.degrees(np.arctan(np.median(np.hypot(gradient_x, gradient_y))))
            )
            terrain_position = (mean - minimum) / relief if relief > 0 else 0.5
        else:
            minimum = maximum = mean = relief = slope = terrain_position = None

        chunk_key = (
            "analysis/gedtm30/elevation-grids/"
            + hashlib.sha256(cell_id.encode()).hexdigest()[:20]
            + ".json.gz"
        )
        chunk_path = release_dir / chunk_key
        chunk = {
            "cellId": cell_id,
            "sourceRelease": source_release,
            "bounds": list(cell_bounds),
            "width": 20,
            "height": 20,
            "noDataValue": None,
            "elevationsM": [
                round(float(value), 2) if is_valid else None
                for value, is_valid in zip(values.reshape(-1), valid.reshape(-1))
            ],
        }
        with chunk_path.open("wb") as raw_handle:
            with gzip.GzipFile(
                filename="", mode="wb", fileobj=raw_handle, mtime=0
            ) as gzip_handle:
                gzip_handle.write(
                    json.dumps(
                        chunk, separators=(",", ":"), sort_keys=True
                    ).encode("utf-8")
                )

        rows.append(
            {
                "cell_id": cell_id,
                "source_release": source_release,
                "west": cell_bounds[0],
                "south": cell_bounds[1],
                "east": cell_bounds[2],
                "north": cell_bounds[3],
                "center_lng": (cell_bounds[0] + cell_bounds[2]) / 2,
                "center_lat": (cell_bounds[1] + cell_bounds[3]) / 2,
                "min_elevation_m": minimum,
                "max_elevation_m": maximum,
                "mean_elevation_m": mean,
                "relief_m": relief,
                "land_coverage_pct": float(land_mask.mean() * 100),
                "valid_sample_count": int(valid.sum()),
                "sample_count": int(values.size),
                "median_slope_deg": slope,
                "terrain_position": terrain_position,
                "detail_object_key": chunk_key,
            }
        )

    sql_dir = release_dir / "analysis/gedtm30/d1"
    sql_dir.mkdir(parents=True, exist_ok=True)
    shard_paths = []
    columns = list(rows[0]) if rows else []
    for index in range(0, len(rows), 500):
        shard = sql_dir / f"terrain-analysis-{index // 500:04d}.sql"
        statements = ["BEGIN;"]
        for row in rows[index : index + 500]:
            values = ", ".join(sql_quote(row[column]) for column in columns)
            statements.append(
                "INSERT OR REPLACE INTO terrain_analysis_cells "
                f"({', '.join(columns)}) VALUES ({values});"
            )
        statements.append("COMMIT;")
        shard.write_text("\n".join(statements) + "\n", encoding="utf-8")
        shard_paths.append(str(shard.relative_to(release_dir)))
    write_json(
        release_dir / "analysis/gedtm30/d1-import-manifest.json",
        {"rowCount": len(rows), "shards": shard_paths},
    )
    return len(rows), len(shard_paths)


def release_identity(manifest):
    return {
        key: manifest[key]
        for key in (
            "sourceId",
            "sourceVersion",
            "sourceChecksum",
            "coverageId",
            "coverageChecksum",
            "configurationChecksum",
            "artifactVersion",
            "runId",
        )
    }


def validate_evaluation_report(report, source_checksum, coverage_checksum):
    decision = report.get("decision")
    if decision not in ("pending", "adopt", "retain-copernicus"):
        raise ValueError(
            "Evaluation decision must be pending, adopt, or retain-copernicus"
        )
    for key, expected in (
        ("sourceChecksum", source_checksum),
        ("coverageChecksum", coverage_checksum),
    ):
        value = report.get(key)
        if value not in ("REQUIRED", expected):
            raise ValueError(f"Evaluation report {key} does not match the release")
    required_areas = {
        "urban",
        "forest",
        "mountain",
        "karst",
        "plain",
        "river",
        "coastal",
    }
    if set(report.get("reviewedAreas", {})) != required_areas:
        raise ValueError("Evaluation report must include every representative area")
    required_gates = {
        "licenseAndRedistributionConfirmed",
        "horizontalAndVerticalReferencesNormalized",
        "validatedElevationQualityMaintainedOrImproved",
        "surfaceModelBiasReducedWithoutUnacceptableArtifacts",
        "terrainDerivedRiskOutputsReviewed",
        "renderingAndLodPassed",
        "operationalPerformanceAcceptable",
        "publishingAndRollbackPassed",
    }
    if set(report.get("gates", {})) != required_gates:
        raise ValueError("Evaluation report must include every adoption gate")


def evaluation_allows_adoption(report):
    return (
        report.get("decision") == "adopt"
        and all(report.get("reviewedAreas", {}).values())
        and all(report.get("gates", {}).values())
    )


def collect_artifacts(release_dir):
    artifacts = []
    for path in sorted(release_dir.rglob("*")):
        if path.is_file() and path.name not in (
            "release-manifest.json",
            "local-validation.json",
            "remote-validation.json",
        ):
            artifacts.append(
                {
                    "key": str(path.relative_to(release_dir)),
                    "bytes": path.stat().st_size,
                    "sha256": sha256(path),
                }
            )
    return artifacts


def build_local(args):
    source_manifest_path = Path(args.source_manifest).expanduser().resolve()
    source_manifest = load_json(source_manifest_path)
    raster_path, source_checksum = validate_source_manifest(source_manifest)
    load_geospatial_dependencies()
    pmtiles = require_command("pmtiles")
    martin = require_command("martin")
    coverage_manifest, coverage_path, coverage_checksum = validate_coverage_manifest(
        args.coverage_manifest
    )
    evaluation_report = None
    if not args.visual_only:
        evaluation_report = load_json(args.evaluation_report)
        validate_evaluation_report(
            evaluation_report, source_checksum, coverage_checksum
        )
        evaluation_report["sourceChecksum"] = source_checksum
        evaluation_report["coverageChecksum"] = coverage_checksum
    output_root = Path(args.output_root).expanduser().resolve()
    release_dir = (
        output_root / args.artifact_version / args.run_id
    ).resolve()
    if release_dir.exists() and not args.force:
        raise RuntimeError(
            f"Release already exists: {release_dir}. Use --force to rebuild."
        )
    if release_dir.exists():
        shutil.rmtree(release_dir)
    release_dir.mkdir(parents=True)

    frozen_source = release_dir / "provenance/source-manifest.json"
    frozen_coverage = release_dir / "provenance/coverage-manifest.json"
    frozen_source.parent.mkdir(parents=True)
    shutil.copy2(source_manifest_path, frozen_source)
    shutil.copy2(args.coverage_manifest, frozen_coverage)
    shutil.copy2(
        coverage_path,
        release_dir
        / "provenance"
        / f"{coverage_manifest['coverageId']}.geojson",
    )
    if evaluation_report is not None:
        write_json(
            release_dir / "analysis/gedtm30/validation-report.json",
            evaluation_report,
        )

    configuration = {
        "minZoom": args.min_zoom,
        "maxZoom": args.max_zoom,
        "tileSize": args.tile_size,
        "imageFormat": args.image_format,
        "encoding": {
            "name": "custom",
            "redFactor": 0,
            "greenFactor": 25.6,
            "blueFactor": 0.1,
            "baseShift": -3276.8,
        },
        "analysisGrid": {
            "enabled": not args.visual_only,
            "longitudeStep": GRID_LNG_STEP if not args.visual_only else None,
            "latitudeStep": GRID_LAT_STEP if not args.visual_only else None,
            "samplesPerCell": 400 if not args.visual_only else None,
        },
        "verticalReference": source_manifest["verticalReference"],
        "tools": {
            "python": sys.version.split()[0],
            "rasterio": rasterio.__version__,
            "numpy": np.__version__,
            "pmtiles": run(
                [pmtiles, "version"], capture_output=True
            ).stdout.strip(),
            "martin": run(
                [martin, "--version"], capture_output=True
            ).stdout.strip(),
        },
    }
    write_json(release_dir / "provenance/build-configuration.json", configuration)
    configuration_checksum = sha256(
        release_dir / "provenance/build-configuration.json"
    )

    geometries = read_coverage_geometry(coverage_path)
    bounds = coverage_manifest["bounds"]
    coverage_slug = coverage_manifest.get(
        "artifactSlug", coverage_manifest["coverageId"]
    )
    mbtiles_path = release_dir / f"terrain/gedtm30/{coverage_slug}.mbtiles"
    mbtiles_path.parent.mkdir(parents=True)
    with rasterio.open(raster_path) as dataset:
        if not dataset.crs:
            raise ValueError("Source raster does not declare a horizontal CRS")
        tile_count = build_visual_tiles(
            dataset,
            mbtiles_path,
            bounds,
            geometries,
            source_manifest["scaleFactor"],
            coverage_manifest["coverageId"],
            args.tile_size,
            args.min_zoom,
            args.max_zoom,
            args.image_format,
        )
        if args.visual_only:
            cell_count = shard_count = 0
        else:
            cell_count, shard_count = build_analysis(
                dataset,
                release_dir,
                source_manifest["productVersion"],
                bounds,
                geometries,
                source_manifest["scaleFactor"],
            )

    pmtiles_path = release_dir / f"terrain/gedtm30/{coverage_slug}.pmtiles"
    run([pmtiles, "convert", str(mbtiles_path), str(pmtiles_path)])
    mbtiles_path.unlink()

    manifest = {
        "schemaVersion": 1,
        "status": "built",
        "sourceId": "T-02",
        "sourceVersion": source_manifest["productVersion"],
        "sourceChecksum": source_checksum,
        "coverageId": coverage_manifest["coverageId"],
        "coverageChecksum": coverage_checksum,
        "configurationChecksum": configuration_checksum,
        "artifactVersion": args.artifact_version,
        "runId": args.run_id,
        "generatedPrefix": f"generated/{args.artifact_version}/{args.run_id}",
        "terrain": {
            "source": "gedtm30",
            "pmtilesKey": f"terrain/gedtm30/{coverage_slug}.pmtiles",
            "bounds": bounds,
            "tileSize": args.tile_size,
            "imageFormat": args.image_format,
            "minZoom": args.min_zoom,
            "maxZoom": args.max_zoom,
            "tileCount": tile_count,
            "encoding": configuration["encoding"],
            "attribution": source_manifest["license"]["attribution"],
        },
        "builtAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    if not args.visual_only:
        manifest["analysis"] = {
            "cellCount": cell_count,
            "sqlShardCount": shard_count,
            "importManifestKey": "analysis/gedtm30/d1-import-manifest.json",
            "validationReportKey": "analysis/gedtm30/validation-report.json",
            "evaluationDecision": evaluation_report["decision"],
        }
    manifest["artifacts"] = collect_artifacts(release_dir)
    write_json(release_dir / "release-manifest.json", manifest)
    print(release_dir)


def initialize_validation_db(database_path):
    connection = sqlite3.connect(database_path)
    migration = (ROOT / "db/migrations/0001_terrain_releases.sql").read_text(
        encoding="utf-8"
    )
    connection.executescript(migration)
    return connection


def martin_check(pmtiles_path):
    martin = require_command("martin")
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    address = f"http://127.0.0.1:{port}"
    process = subprocess.Popen(
        [martin, "--listen-addresses", f"127.0.0.1:{port}", str(pmtiles_path)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        deadline = time.time() + 15
        while time.time() < deadline:
            if process.poll() is not None:
                break
            try:
                with urllib.request.urlopen(
                    address + "/catalog", timeout=1
                ) as response:
                    catalog = json.load(response)
                break
            except Exception:
                time.sleep(0.2)
        else:
            catalog = None
        if not catalog:
            raise RuntimeError("Martin did not become ready within 15 seconds")
        source_ids = set(catalog.get("tiles", {}))
        if not source_ids:
            raise RuntimeError("Martin catalog contains no tile sources")
        source_id = sorted(source_ids)[0]
        with urllib.request.urlopen(f"{address}/{source_id}", timeout=5) as response:
            tilejson = json.load(response)
        if not tilejson.get("tiles"):
            raise RuntimeError("Martin TileJSON does not contain tile URLs")
        return {"catalogSource": source_id, "tileJson": True}
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()


def validate_visual_tile_payloads(
    pmtiles_path, bounds, geometries, tile_size, min_zoom, max_zoom
):
    pmtiles = require_command("pmtiles")
    checked_count = 0
    for zoom in range(min_zoom, max_zoom + 1):
        x_range, y_range = tile_range(bounds, zoom)
        candidates = []
        for x in x_range:
            for y in y_range:
                if tile_intersects_coverage(
                    tile_bounds_lonlat(zoom, x, y), geometries
                ):
                    candidates.append((x, y))
        sample_indexes = sorted({0, len(candidates) // 2, len(candidates) - 1})
        for index in sample_indexes:
            x, y = candidates[index]
            result = subprocess.run(
                [pmtiles, "tile", str(pmtiles_path), str(zoom), str(x), str(y)],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            width, height = image_dimensions(result.stdout)
            if width != tile_size or height != tile_size:
                raise ValueError(
                    f"Terrain tile {zoom}/{x}/{y} is {width}x{height}; "
                    f"expected {tile_size}x{tile_size}"
                )
            checked_count += 1
    return checked_count


def validate_local(args):
    load_geospatial_dependencies()
    release_dir = Path(args.release).expanduser().resolve()
    manifest_path = release_dir / "release-manifest.json"
    manifest = load_json(manifest_path)
    failures = []
    for artifact in manifest.get("artifacts", []):
        path = release_dir / artifact["key"]
        if not path.is_file():
            failures.append(f"Missing artifact: {artifact['key']}")
        elif sha256(path) != artifact["sha256"]:
            failures.append(f"Checksum mismatch: {artifact['key']}")

    terrain = manifest.get("terrain", {})
    coverage_manifest = load_json(
        release_dir / "provenance/coverage-manifest.json"
    )
    coverage_path = (
        release_dir
        / "provenance"
        / f"{coverage_manifest['coverageId']}.geojson"
    )
    geometries = read_coverage_geometry(coverage_path)
    if terrain.get("bounds") and terrain.get("tileCount") is not None:
        expected_tile_count = visual_tile_count(
            terrain["bounds"],
            geometries,
            terrain.get("minZoom", MIN_ZOOM),
            terrain.get("maxZoom", MAX_ZOOM),
        )
        if terrain["tileCount"] != expected_tile_count:
            failures.append(
                "Visual terrain tile pyramid is sparse: "
                f"expected {expected_tile_count} complete coverage tiles, "
                f"got {terrain['tileCount']}"
            )

    if manifest.get("analysis"):
        import_manifest = load_json(
            release_dir / manifest["analysis"]["importManifestKey"]
        )
        database_path = release_dir / "analysis/gedtm30/local-validation.sqlite"
        if database_path.exists():
            database_path.unlink()
        connection = initialize_validation_db(database_path)
        try:
            for shard in import_manifest["shards"]:
                connection.executescript(
                    (release_dir / shard).read_text(encoding="utf-8")
                )
            row_count = connection.execute(
                "SELECT COUNT(*) FROM terrain_analysis_cells "
                "WHERE source_release = ?",
                (manifest["sourceVersion"],),
            ).fetchone()[0]
            if row_count != import_manifest["rowCount"]:
                failures.append(
                    "D1 row count mismatch: "
                    f"expected {import_manifest['rowCount']}, got {row_count}"
                )
            keys = connection.execute(
                "SELECT detail_object_key FROM terrain_analysis_cells"
            ).fetchall()
            missing_chunks = [
                key for (key,) in keys if not (release_dir / key).is_file()
            ]
            if missing_chunks:
                failures.append(f"{len(missing_chunks)} D1 detail keys are missing")
        finally:
            connection.close()

    pmtiles_path = release_dir / manifest["terrain"]["pmtilesKey"]
    pmtiles = require_command("pmtiles")
    visual_tile_payload_count = None
    try:
        run([pmtiles, "show", str(pmtiles_path)], capture_output=True)
        run([pmtiles, "verify", str(pmtiles_path)], capture_output=True)
    except subprocess.CalledProcessError as error:
        failures.append(f"PMTiles validation failed: {error}")
    if not failures and terrain.get("bounds"):
        try:
            visual_tile_payload_count = validate_visual_tile_payloads(
                pmtiles_path,
                terrain["bounds"],
                geometries,
                terrain.get("tileSize", TILE_SIZE),
                terrain.get("minZoom", MIN_ZOOM),
                terrain.get("maxZoom", MAX_ZOOM),
            )
        except Exception as error:
            failures.append(f"Terrain tile payload validation failed: {error}")

    martin_result = None
    if not failures:
        try:
            martin_result = martin_check(pmtiles_path)
        except Exception as error:
            failures.append(f"Martin validation failed: {error}")

    validation = {
        **release_identity(manifest),
        "status": "passed" if not failures else "failed",
        "failures": failures,
        "martin": martin_result,
        "visualTilePayloadCount": visual_tile_payload_count,
        "validatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    write_json(release_dir / "local-validation.json", validation)
    if failures:
        raise RuntimeError("; ".join(failures))
    manifest["status"] = "validated"
    manifest["localValidationChecksum"] = sha256(
        release_dir / "local-validation.json"
    )
    write_json(manifest_path, manifest)
    print(release_dir / "local-validation.json")


def require_validated_release(release_dir):
    manifest = load_json(release_dir / "release-manifest.json")
    validation = load_json(release_dir / "local-validation.json")
    if validation.get("status") != "passed":
        raise RuntimeError("Local release validation has not passed")
    if release_identity(manifest) != release_identity(validation):
        raise RuntimeError("Local validation identity does not match release manifest")
    if sha256(release_dir / "local-validation.json") != manifest.get(
        "localValidationChecksum"
    ):
        raise RuntimeError("Local validation checksum does not match release manifest")
    return manifest


def upload_r2(args):
    release_dir = Path(args.release).expanduser().resolve()
    manifest = require_validated_release(release_dir)
    bucket = args.bucket or os.environ.get("TERRAIN_R2_BUCKET")
    if not bucket:
        raise RuntimeError("Set --bucket or TERRAIN_R2_BUCKET")
    require_command("npx")
    files = [
        path
        for path in release_dir.rglob("*")
        if path.is_file()
        and "local-validation.sqlite" not in path.name
        and path.suffix != ".sql"
    ]
    for path in files:
        relative = path.relative_to(release_dir)
        key = f"{manifest['generatedPrefix']}/{relative}"
        run(
            [
                "npx",
                "wrangler",
                "r2",
                "object",
                "put",
                f"{bucket}/{key}",
                "--file",
                str(path),
                "--content-type",
                content_type(path),
                "--cache-control",
                "public, max-age=31536000, immutable",
                "--remote",
            ]
        )


def content_type(path):
    return {
        ".json": "application/json",
        ".gz": "application/gzip",
        ".pmtiles": "application/octet-stream",
        ".geojson": "application/geo+json",
    }.get(path.suffix, "application/octet-stream")


def import_d1(args):
    release_dir = Path(args.release).expanduser().resolve()
    require_validated_release(release_dir)
    run(
        [
            "npx",
            "wrangler",
            "d1",
            "migrations",
            "apply",
            args.database,
            "--remote",
        ]
    )
    import_manifest = load_json(
        release_dir / "analysis/gedtm30/d1-import-manifest.json"
    )
    for shard in import_manifest["shards"]:
        run(
            [
                "npx",
                "wrangler",
                "d1",
                "execute",
                args.database,
                "--remote",
                "--file",
                str(release_dir / shard),
            ]
        )


def validate_remote(args):
    release_dir = Path(args.release).expanduser().resolve()
    manifest = require_validated_release(release_dir)
    bucket = args.bucket or os.environ.get("TERRAIN_R2_BUCKET")
    if not bucket:
        raise RuntimeError("Set --bucket or TERRAIN_R2_BUCKET")
    terrain_url = args.terrain_url or os.environ.get(
        "TERRAIN_PUBLIC_PMTILES_URL"
    )
    if not terrain_url:
        raise RuntimeError(
            "Set --terrain-url or TERRAIN_PUBLIC_PMTILES_URL to validate "
            "range requests, CORS, ETags, and immutable caching"
        )
    artifact_by_key = {
        artifact["key"]: artifact for artifact in manifest.get("artifacts", [])
    }
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_dir = Path(temp_dir)
        remote_manifest = Path(temp_dir) / "release-manifest.json"
        run(
            [
                "npx",
                "wrangler",
                "r2",
                "object",
                "get",
                f"{bucket}/{manifest['generatedPrefix']}/release-manifest.json",
                "--file",
                str(remote_manifest),
                "--remote",
            ]
        )
        if release_identity(load_json(remote_manifest)) != release_identity(manifest):
            raise RuntimeError("Remote release manifest identity does not match local")
        verification_keys = [manifest["terrain"]["pmtilesKey"]]
        chunk_key = next(
            (
                key
                for key in artifact_by_key
                if key.startswith("analysis/gedtm30/elevation-grids/")
            ),
            None,
        )
        if chunk_key:
            verification_keys.append(chunk_key)
        for index, key in enumerate(verification_keys):
            remote_path = temp_dir / f"remote-{index}"
            run(
                [
                    "npx",
                    "wrangler",
                    "r2",
                    "object",
                    "get",
                    f"{bucket}/{manifest['generatedPrefix']}/{key}",
                    "--file",
                    str(remote_path),
                    "--remote",
                ]
            )
            expected = artifact_by_key.get(key)
            if not expected or sha256(remote_path) != expected["sha256"]:
                raise RuntimeError(f"Remote artifact checksum mismatch: {key}")

    range_request = urllib.request.Request(
        terrain_url, headers={"Range": "bytes=0-126", "Origin": "http://localhost"}
    )
    with urllib.request.urlopen(range_request, timeout=20) as response:
        headers = response.headers
        if response.status != 206:
            raise RuntimeError(
                f"Terrain host did not honor byte range request: {response.status}"
            )
        if not headers.get("Content-Range"):
            raise RuntimeError("Terrain range response is missing Content-Range")
        if not headers.get("ETag"):
            raise RuntimeError("Terrain response is missing ETag")
        if headers.get("Access-Control-Allow-Origin") not in ("*", "http://localhost"):
            raise RuntimeError("Terrain response does not allow browser CORS")
        if "immutable" not in headers.get("Cache-Control", ""):
            raise RuntimeError("Terrain response is missing immutable caching")

    query = (
        "SELECT COUNT(*) AS row_count FROM terrain_analysis_cells "
        f"WHERE source_release = {sql_quote(manifest['sourceVersion'])};"
    )
    result = run(
        [
            "npx",
            "wrangler",
            "d1",
            "execute",
            args.database,
            "--remote",
            "--json",
            "--command",
            query,
        ],
        capture_output=True,
    )
    payload = json.loads(result.stdout)
    rows = payload[0].get("results", []) if payload else []
    remote_count = rows[0].get("row_count") if rows else None
    if remote_count != manifest["analysis"]["cellCount"]:
        raise RuntimeError(
            "Remote D1 row count mismatch: "
            f"expected {manifest['analysis']['cellCount']}, got {remote_count}"
        )
    validation = {
        **release_identity(manifest),
        "status": "passed",
        "r2ManifestVerified": True,
        "r2ArtifactChecksumsVerified": True,
        "publicRangeRequestVerified": True,
        "d1RowCount": remote_count,
        "validatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    write_json(release_dir / "remote-validation.json", validation)
    remote_key = f"{manifest['generatedPrefix']}/remote-validation.json"
    run(
        [
            "npx",
            "wrangler",
            "r2",
            "object",
            "put",
            f"{bucket}/{remote_key}",
            "--file",
            str(release_dir / "remote-validation.json"),
            "--content-type",
            "application/json",
            "--cache-control",
            "public, max-age=31536000, immutable",
            "--remote",
        ]
    )


def activate(args):
    release_dir = Path(args.release).expanduser().resolve()
    manifest = require_validated_release(release_dir)
    remote_validation = load_json(release_dir / "remote-validation.json")
    if remote_validation.get("status") != "passed":
        raise RuntimeError("Remote validation has not passed")
    if release_identity(remote_validation) != release_identity(manifest):
        raise RuntimeError("Remote validation identity does not match release")
    evaluation_report = load_json(
        release_dir / manifest["analysis"]["validationReportKey"]
    )
    validate_evaluation_report(
        evaluation_report,
        manifest["sourceChecksum"],
        manifest["coverageChecksum"],
    )
    if not evaluation_allows_adoption(evaluation_report):
        raise RuntimeError(
            "GEDTM30 adoption is not approved by the evaluation report"
        )
    bucket = args.bucket or os.environ.get("TERRAIN_R2_BUCKET")
    if not bucket:
        raise RuntimeError("Set --bucket or TERRAIN_R2_BUCKET")
    active = {
        **release_identity(manifest),
        "generatedPrefix": manifest["generatedPrefix"],
        "terrain": manifest["terrain"],
        "analysis": manifest["analysis"],
        "activatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
        json.dump(active, handle, indent=2, sort_keys=True)
        handle.write("\n")
        active_path = Path(handle.name)
    try:
        run(
            [
                "npx",
                "wrangler",
                "r2",
                "object",
                "put",
                f"{bucket}/{args.active_key}",
                "--file",
                str(active_path),
                "--content-type",
                "application/json",
                "--cache-control",
                "no-cache",
                "--remote",
            ]
        )
    finally:
        active_path.unlink(missing_ok=True)


def serve_local(args):
    release_dir = Path(args.release).expanduser().resolve()
    manifest = load_json(release_dir / "release-manifest.json")
    pmtiles_path = release_dir / manifest["terrain"]["pmtilesKey"]
    os.execvp(
        "martin",
        [
            "martin",
            "--listen-addresses",
            args.listen,
            str(pmtiles_path),
        ],
    )


def parser():
    root = argparse.ArgumentParser(description="GEDTM30 terrain release tool")
    commands = root.add_subparsers(dest="command", required=True)

    build = commands.add_parser("build-local")
    build.add_argument("--source-manifest", required=True)
    build.add_argument(
        "--evaluation-report",
        default=str(ROOT / "terrain/evaluation-report.template.json"),
    )
    build.add_argument("--coverage-manifest", default=str(DEFAULT_COVERAGE_MANIFEST))
    build.add_argument("--artifact-version", required=True)
    build.add_argument("--run-id", required=True)
    build.add_argument("--output-root", default=str(ROOT / "generated"))
    build.add_argument("--visual-only", action="store_true")
    build.add_argument("--tile-size", type=int, choices=(256, 512), default=TILE_SIZE)
    build.add_argument(
        "--image-format", choices=("png", "webp"), default="png"
    )
    build.add_argument("--min-zoom", type=int, default=MIN_ZOOM)
    build.add_argument("--max-zoom", type=int, default=MAX_ZOOM)
    build.add_argument("--force", action="store_true")
    build.set_defaults(handler=build_local)

    validate = commands.add_parser("validate-local")
    validate.add_argument("--release", required=True)
    validate.set_defaults(handler=validate_local)

    serve = commands.add_parser("serve-local")
    serve.add_argument("--release", required=True)
    serve.add_argument("--listen", default="127.0.0.1:3010")
    serve.set_defaults(handler=serve_local)

    upload = commands.add_parser("upload-r2")
    upload.add_argument("--release", required=True)
    upload.add_argument("--bucket")
    upload.set_defaults(handler=upload_r2)

    d1_import = commands.add_parser("import-d1")
    d1_import.add_argument("--release", required=True)
    d1_import.add_argument("--database", default="yaad-guard")
    d1_import.set_defaults(handler=import_d1)

    remote = commands.add_parser("validate-remote")
    remote.add_argument("--release", required=True)
    remote.add_argument("--bucket")
    remote.add_argument("--database", default="yaad-guard")
    remote.add_argument("--terrain-url")
    remote.set_defaults(handler=validate_remote)

    activation = commands.add_parser("activate")
    activation.add_argument("--release", required=True)
    activation.add_argument("--bucket")
    activation.add_argument("--active-key", default="manifests/active.json")
    activation.set_defaults(handler=activate)
    return root


def main():
    args = parser().parse_args()
    try:
        args.handler(args)
    except Exception as error:
        print(f"terrain-release: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
