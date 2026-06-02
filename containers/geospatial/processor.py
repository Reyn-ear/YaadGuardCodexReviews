from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import hashlib
import json
import math
import os
import time
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from urllib.request import urlretrieve

from netCDF4 import Dataset
import numpy as np
from PIL import Image
import rasterio
from rasterio.enums import Resampling
from rasterio.windows import from_bounds


NODATA_ELEVATION_M = -2.0
TILE_SIZE = 256
CARIBBEAN_BOUNDS = {"west": -92.0, "south": 0.0, "east": -50.0, "north": 35.0}
GTSM_STATS_URL = (
    "https://zenodo.org/api/records/14671593/files/"
    "ds_GTSM-ERA5-E_1950-2024_stats.nc/content"
)
GTSM_STATS_PATH = Path("/tmp/ds_GTSM-ERA5-E_1950-2024_stats.nc")
PROCESSOR_BUILD = "worldcover-runtime-20260507"


class ProcessorHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path in ("/", "/health", "/ping"):
            self.respond_json({"ok": True, "service": "yaad-guard-geospatial"})
            return

        if parsed.path == "/terrain-tile":
            params = parse_qs(parsed.query)
            try:
                z = int(first(params, "z"))
                x = int(first(params, "x"))
                y = int(first(params, "y"))
                tile = build_terrain_tile_png(z, x, y)
                self.respond_bytes(tile, "image/png")
            except Exception as error:
                self.respond_json({"ok": False, "error": str(error)}, status=500)
            return

        self.send_error(404)

    def do_POST(self):
        if self.path == "/process":
            payload = self.read_json()
            source = payload.get("source", {})
            source_id = source.get("id")

            if source_id == "H-12":
                self.respond_json(
                    {
                        "ok": True,
                        "runId": payload.get("runId"),
                        "sourceId": source_id,
                        "generatedPrefix": payload.get("generatedPrefix"),
                        "surgeRows": build_surge_return_levels(),
                        "processor": "source-backed",
                        "processedAt": iso_now(),
                    }
                )
                return

            self.respond_json(
                {
                    "ok": True,
                    "runId": payload.get("runId"),
                    "sourceId": source_id,
                    "generatedPrefix": payload.get("generatedPrefix"),
                    "processor": "source-backed",
                    "processedAt": iso_now(),
                }
            )
            return

        if self.path == "/elevation-grid":
            try:
                payload = self.read_json()
                bounds = payload["bounds"]
                sub_grid_size = int(payload.get("subGridSize", 20))
                self.respond_json(build_elevation_grid(bounds, sub_grid_size))
            except Exception as error:
                self.respond_json({"ok": False, "error": str(error)}, status=500)
            return

        if self.path == "/terrain-summary":
            try:
                payload = self.read_json()
                self.respond_json(
                    build_terrain_summary(payload["tileName"], payload["bounds"])
                )
            except Exception as error:
                self.respond_json({"ok": False, "error": str(error)}, status=500)
            return

        if self.path == "/population-summary":
            try:
                payload = self.read_json()
                self.respond_json(
                    build_population_summary(
                        payload["iso3"],
                        payload["bounds"],
                        payload["rasterUrl"],
                        payload.get("sourceYear"),
                    )
                )
            except Exception as error:
                self.respond_json({"ok": False, "error": str(error)}, status=500)
            return

        if self.path == "/landcover-summary":
            try:
                payload = self.read_json()
                self.respond_json(build_landcover_summary(payload["bounds"]))
            except Exception as error:
                self.respond_json({"ok": False, "error": str(error)}, status=500)
            return

        self.send_error(404)

    def read_json(self):
        length = int(self.headers.get("content-length", "0"))
        return json.loads(self.rfile.read(length).decode("utf-8") or "{}")

    def respond_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.respond_bytes(body, "application/json", status=status)

    def respond_bytes(self, body, content_type, status=200):
        self.send_response(status)
        self.send_header("content-type", content_type)
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        return


def build_elevation_grid(bounds, sub_grid_size):
    west, south = bounds[0]
    east, north = bounds[1]
    elevations = sample_dem_grid(west, south, east, north, sub_grid_size, sub_grid_size)

    return {
        "ok": True,
        "elevations": [round(float(value), 2) for value in elevations.reshape(-1)],
        "subGridSize": sub_grid_size,
        "bounds": bounds,
        "source": "Copernicus DEM GLO-30 COG",
        "processedAt": iso_now(),
    }


def build_terrain_summary(tile_name, bounds):
    west, south = bounds[0]
    east, north = bounds[1]
    elevations = sample_dem_grid(west, south, east, north, 160, 160)
    valid = elevations[elevations > NODATA_ELEVATION_M + 0.01]

    if valid.size == 0:
        minimum = maximum = mean = NODATA_ELEVATION_M
        land_coverage_pct = 0.0
    else:
        minimum = float(np.min(valid))
        maximum = float(np.max(valid))
        mean = float(np.mean(valid))
        land_coverage_pct = float((valid.size / elevations.size) * 100.0)

    return {
        "ok": True,
        "tileName": tile_name,
        "stats": {
            "min": round(minimum, 2),
            "max": round(maximum, 2),
            "mean": round(mean, 2),
        },
        "coverage": {"landCoveragePct": round(land_coverage_pct, 2)},
        "source": "Copernicus DEM GLO-30 COG",
        "processedAt": iso_now(),
    }


def build_terrain_tile_png(z, x, y):
    west, south, east, north = tile_bounds(z, x, y)
    elevations = sample_dem_grid(west, south, east, north, TILE_SIZE, TILE_SIZE)
    rgba = np.zeros((TILE_SIZE, TILE_SIZE, 4), dtype=np.uint8)

    encoded = np.clip(elevations + 3276.8, 0, 6553.5)
    green = np.floor(encoded / 25.6)
    blue = np.round((encoded - green * 25.6) / 0.1)

    rgba[:, :, 1] = np.clip(green, 0, 255).astype(np.uint8)
    rgba[:, :, 2] = np.clip(blue, 0, 255).astype(np.uint8)
    rgba[:, :, 3] = 255

    output = io.BytesIO()
    Image.fromarray(rgba, mode="RGBA").save(output, format="PNG", optimize=False)
    return output.getvalue()


def build_population_summary(iso3, bounds, raster_url, source_year):
    west, south = bounds[0]
    east, north = bounds[1]

    if "data.worldpop.org" in raster_url:
        dataset_source = ensure_cached_url(raster_url, ".tif")
    else:
        dataset_source = raster_url

    try:
        dataset = rasterio.open(dataset_source)
    except Exception as error:
        if dataset_source != raster_url or "Range downloading not supported" not in str(error):
            raise
        dataset = rasterio.open(ensure_cached_url(raster_url, ".tif"))

    with dataset:
        window = from_bounds(west, south, east, north, dataset.transform)
        data = dataset.read(
            1,
            window=window,
            boundless=True,
            fill_value=0,
            masked=True,
        ).astype(np.float64)

        if dataset.nodata is not None:
            data = np.ma.masked_where(data == dataset.nodata, data)

        valid = np.ma.masked_invalid(data)
        total = float(valid.sum()) if valid.count() else 0.0

    return {
        "ok": True,
        "count": round(max(total, 0.0), 2),
        "iso3": iso3,
        "sourceYear": source_year,
        "source": "WorldPop constrained population count 100m",
        "processedAt": iso_now(),
    }


def build_landcover_summary(bounds):
    west, south = bounds[0]
    east, north = bounds[1]
    class_counts = {}
    valid_pixel_count = 0

    for tile in overlapping_worldcover_tiles(west, south, east, north):
        try:
            with rasterio.open(worldcover_url(tile["south"], tile["west"])) as dataset:
                tile_west = max(west, tile["west"])
                tile_south = max(south, tile["south"])
                tile_east = min(east, tile["east"])
                tile_north = min(north, tile["north"])

                if tile_east <= tile_west or tile_north <= tile_south:
                    continue

                window = from_bounds(
                    tile_west,
                    tile_south,
                    tile_east,
                    tile_north,
                    dataset.transform,
                )
                data = dataset.read(
                    1,
                    window=window,
                    out_shape=(96, 96),
                    resampling=Resampling.nearest,
                    boundless=True,
                    fill_value=0,
                )
                valid = data[data > 0]
                valid_pixel_count += int(valid.size)

                values, counts = np.unique(valid, return_counts=True)
                for value, count in zip(values, counts):
                    class_counts[int(value)] = class_counts.get(int(value), 0) + int(count)
        except Exception:
            continue

    return {
        "ok": True,
        "classes": worldcover_percentages(class_counts, valid_pixel_count),
        "validPixelCount": valid_pixel_count,
        "source": "ESA WorldCover 2021 v200 10m COG",
        "processorBuild": PROCESSOR_BUILD,
        "processedAt": iso_now(),
    }


def build_surge_return_levels():
    ensure_file(GTSM_STATS_URL, GTSM_STATS_PATH)

    with Dataset(GTSM_STATS_PATH) as dataset:
        lats = np.asarray(dataset.variables["lat"][:], dtype=np.float64)
        lons = np.asarray(dataset.variables["lon"][:], dtype=np.float64)
        station_ids = np.asarray(dataset.variables["stations"][:])
        periods = [int(value) for value in dataset.variables["return_period"][:]]
        period_indexes = {period: periods.index(period) for period in periods}
        bestfit = np.asarray(
            dataset.variables["wl_extreme_bestfit"][:], dtype=np.float64
        )
        lower = np.asarray(dataset.variables["wl_extreme_5perc"][:], dtype=np.float64)
        upper = np.asarray(dataset.variables["wl_extreme_95perc"][:], dtype=np.float64)
        eva_scale = np.asarray(dataset.variables["eva_param_scale"][:], dtype=np.float64)
        eva_shape = np.asarray(dataset.variables["eva_param_shape"][:], dtype=np.float64)
        eva_loc = np.asarray(dataset.variables["eva_param_loc"][:], dtype=np.float64)

        rows = []
        for index, (lat, lon) in enumerate(zip(lats, lons)):
            if not (
                CARIBBEAN_BOUNDS["south"] <= lat <= CARIBBEAN_BOUNDS["north"]
                and CARIBBEAN_BOUNDS["west"] <= lon <= CARIBBEAN_BOUNDS["east"]
            ):
                continue

            row = {
                "stationId": int(station_ids[index]),
                "lat": rounded(lat),
                "lon": rounded(lon),
                "evaScale": rounded(eva_scale[index]),
                "evaShape": rounded(eva_shape[index]),
                "evaLoc": rounded(eva_loc[index]),
            }

            for period in (1, 2, 5, 10, 25, 50, 75, 100):
                period_index = period_indexes[period]
                label = f"rp{period}"
                row[f"{label}Bestfit"] = rounded(bestfit[index, period_index])
                row[f"{label}Lower5"] = rounded(lower[index, period_index])
                row[f"{label}Upper95"] = rounded(upper[index, period_index])

            if all(is_finite(value) for value in row.values()):
                rows.append(row)

    return rows


def sample_dem_grid(west, south, east, north, width, height):
    output = np.full((height, width), NODATA_ELEVATION_M, dtype=np.float32)

    for tile in overlapping_dem_tiles(west, south, east, north):
        try:
            with rasterio.open(copernicus_dem_url(tile["lat"], tile["lon"])) as dataset:
                tile_window = from_bounds(
                    max(west, tile["west"]),
                    max(south, tile["south"]),
                    min(east, tile["east"]),
                    min(north, tile["north"]),
                    dataset.transform,
                )

                col_start = max(
                    math.floor(((max(west, tile["west"]) - west) / (east - west)) * width),
                    0,
                )
                col_stop = min(
                    math.ceil(((min(east, tile["east"]) - west) / (east - west)) * width),
                    width,
                )
                row_start = max(
                    math.floor(((north - min(north, tile["north"])) / (north - south)) * height),
                    0,
                )
                row_stop = min(
                    math.ceil(((north - max(south, tile["south"])) / (north - south)) * height),
                    height,
                )

                if col_stop <= col_start or row_stop <= row_start:
                    continue

                data = dataset.read(
                    1,
                    window=tile_window,
                    out_shape=(row_stop - row_start, col_stop - col_start),
                    resampling=Resampling.bilinear,
                    boundless=True,
                    fill_value=NODATA_ELEVATION_M,
                ).astype(np.float32)

                if dataset.nodata is not None:
                    data = np.where(data == dataset.nodata, NODATA_ELEVATION_M, data)

                output[row_start:row_stop, col_start:col_stop] = np.maximum(
                    data,
                    NODATA_ELEVATION_M,
                )
        except Exception:
            continue

    return output


def ensure_file(url, path):
    if not path.exists() or path.stat().st_size == 0:
        urlretrieve(url, path)


def ensure_cached_url(url, suffix):
    digest = hashlib.sha256(url.encode("utf-8")).hexdigest()[:24]
    path = Path(f"/tmp/{digest}{suffix}")
    ensure_file(url, path)
    return str(path)


def rounded(value):
    return round(float(value), 6)


def is_finite(value):
    return not isinstance(value, float) or math.isfinite(value)


def overlapping_dem_tiles(west, south, east, north):
    west_degree = math.floor(west)
    east_degree = math.ceil(east)
    south_degree = math.floor(south)
    north_degree = math.ceil(north)

    for lat in range(south_degree, north_degree):
        for lon in range(west_degree, east_degree):
            yield {
                "lat": lat,
                "lon": lon,
                "west": lon,
                "south": lat,
                "east": lon + 1,
                "north": lat + 1,
            }


def overlapping_worldcover_tiles(west, south, east, north):
    west_tile = math.floor(west / 3) * 3
    east_tile = math.floor((east - 1e-9) / 3) * 3
    south_tile = math.floor(south / 3) * 3
    north_tile = math.floor((north - 1e-9) / 3) * 3

    for tile_west in range(west_tile, east_tile + 1, 3):
        for tile_south in range(south_tile, north_tile + 1, 3):
            yield {
                "west": tile_west,
                "south": tile_south,
                "east": tile_west + 3,
                "north": tile_south + 3,
            }


def copernicus_dem_url(lat, lon):
    lat_prefix = "N" if lat >= 0 else "S"
    lon_prefix = "E" if lon >= 0 else "W"
    tile = (
        f"Copernicus_DSM_COG_10_"
        f"{lat_prefix}{abs(lat):02d}_00_"
        f"{lon_prefix}{abs(lon):03d}_00_DEM"
    )
    return f"https://copernicus-dem-30m.s3.amazonaws.com/{tile}/{tile}.tif"


def worldcover_url(south, west):
    lat_prefix = "N" if south >= 0 else "S"
    lon_prefix = "E" if west >= 0 else "W"
    tile = f"{lat_prefix}{abs(south):02d}{lon_prefix}{abs(west):03d}"
    return (
        "https://esa-worldcover.s3.eu-central-1.amazonaws.com/"
        f"v200/2021/map/ESA_WorldCover_10m_2021_v200_{tile}_Map.tif"
    )


def worldcover_percentages(class_counts, valid_pixel_count):
    labels = {
        10: "treeCoverPct",
        20: "shrublandPct",
        30: "grasslandPct",
        40: "croplandPct",
        50: "builtUpPct",
        60: "bareSparsePct",
        70: "snowIcePct",
        80: "waterPct",
        90: "wetlandPct",
        95: "mangrovePct",
        100: "mossLichenPct",
    }

    if valid_pixel_count <= 0:
        return {value: 0.0 for value in labels.values()}

    return {
        label: round((class_counts.get(code, 0) / valid_pixel_count) * 100.0, 2)
        for code, label in labels.items()
    }


def tile_bounds(z, x, y):
    west = tile_to_lon(x, z)
    east = tile_to_lon(x + 1, z)
    north = tile_to_lat(y, z)
    south = tile_to_lat(y + 1, z)
    return west, south, east, north


def tile_to_lon(x, z):
    return x / (2**z) * 360.0 - 180.0


def tile_to_lat(y, z):
    n = math.pi - (2.0 * math.pi * y) / (2**z)
    return math.degrees(math.atan(math.sinh(n)))


def first(params, key):
    values = params.get(key)
    if not values:
        raise ValueError(f"Missing parameter: {key}")
    return values[0]


def iso_now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def main():
    port = int(os.environ.get("PORT", "8080"))
    server = ThreadingHTTPServer(("0.0.0.0", port), ProcessorHandler)
    server.serve_forever()


if __name__ == "__main__":
    main()
