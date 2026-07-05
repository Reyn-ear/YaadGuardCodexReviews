# MapLibre GEDTM30 Terrain Candidate Plan

## Objective

Evaluate GEDTM30 as the preferred open, bare-earth terrain source for Jamaica,
then adopt it only if it improves the product's terrain and hazard-analysis
behavior over raw Copernicus DEM GLO-30.

The first production release is Jamaica-only. Caribbean expansion is a separate
follow-up that requires its own coverage, storage, runtime, and validation
decision.

GEDTM30 is a global approximately 30 m digital terrain model produced through
data fusion involving Copernicus GLO-30, ALOS World3D, MERIT DEM, ICESat-2,
GEDI, and other inputs. It is published under CC BY 4.0. Because Copernicus is
already an input, this plan treats GEDTM30 as a replacement candidate, not as a
raster to average blindly with Copernicus.

This document is an evaluation and adoption plan. It does not authorize a
production source change until licensing, provenance, vertical reference,
quality, and performance gates pass.

## Candidate Summary

| Property                     | Candidate value                                        |
| ---------------------------- | ------------------------------------------------------ |
| Dataset                      | Global Ensemble Digital Terrain Model 30 m             |
| Short name                   | GEDTM30                                                |
| Data model                   | Bare-earth DTM                                         |
| Nominal spacing              | Approximately 30 m                                     |
| License                      | CC BY 4.0; verify the exact downloaded artifact        |
| Distribution                 | Cloud-optimized GeoTIFF and published dataset archives |
| Proposed source ID           | `T-02`                                                 |
| Proposed role                | Jamaica baseline terrain                               |
| MapLibre maximum native zoom | 13 by default                                          |

Primary references:

- `https://github.com/openlandmap/GEDTM30`
- `https://doi.org/10.5281/zenodo.14900181`
- `https://doi.org/10.5281/zenodo.15689805`
- `https://doi.org/10.7717/peerj.19673`

The repository cites `10.5281/zenodo.14900181` for the v20250130 dataset and
also points to `10.5281/zenodo.15689805` as a newer distribution. Resolve and
freeze one exact immutable release before implementation. Record its version,
download URL, checksum, license text, citation, and retrieval date.

The GEDTM30 repository code is MIT-licensed. The published dataset is described
as CC BY 4.0. Record and comply with the license attached to the exact downloaded
dataset artifact rather than treating the repository license as the data
license.

## Why Evaluate GEDTM30

Copernicus GLO-30 is a digital surface model, so vegetation and buildings can
raise the apparent terrain. That is acceptable for visualization but can
distort slope, drainage, low-ground, and coastal-risk indicators.

GEDTM30 is intended to model bare-earth terrain and uses multiple elevation
sources plus spaceborne lidar reference data. Potential advantages include:

- Reduced forest and building height bias.
- Better terrain shape for hydrology and slope analysis.
- Fully open CC BY licensing.
- The same approximately 30 m spacing as GLO-30, allowing reuse of the proposed
  zoom-12 LOD and serving architecture.
- Published provenance and derived terrain variables that may support later
  analysis.

Potential risks include:

- Machine-learning artifacts or over-smoothed local features.
- Source-dependent errors inherited from its inputs.
- Vertical datum or unit mismatches.
- Differences at coastlines, steep slopes, karst terrain, and dense urban
  areas.
- A newer and less operationally established product than Copernicus GLO-30.

## Decisions

- Evaluate GEDTM30 independently against Copernicus before changing production.
- Do not average GEDTM30 with Copernicus. GEDTM30 already incorporates
  Copernicus and other global sources.
- Keep both candidate artifact sets addressable by immutable source-specific
  URLs during evaluation.
- Use the same MapLibre native `raster-dem` renderer for both sources.
- Use zoom 12 as the default maximum native-detail level.
- Limit the initial generated and published coverage to Jamaica plus only the
  minimal surrounding tile area required by the selected tile scheme.
- Package each visual terrain release as one immutable PMTiles archive in R2.
- Store queryable terrain summaries and artifact pointers in D1.
- Store dense elevation grids, provenance, and validation reports as chunked,
  compressed artifacts in R2.
- Run heavy generation locally. Workers serve and query completed artifacts;
  they do not generate Jamaica-wide terrain during user requests.
- Use Martin as the required local tile server for PMTiles catalog, TileJSON,
  Z/X/Y compatibility, and application validation before any remote upload.
- Complete and validate a local release first. Upload to R2 and import into D1
  only after the local release passes every required check.
- Reuse the Copernicus plan's LOD, encoding, image-format, coverage, lazy-load,
  and immutable-cache benchmarks.
- Preserve source and confidence provenance for every adopted output.
- Prefer a licensed Jamaica national 5-6 m DEM over GEDTM30 where it becomes
  legally and operationally available.

## Target Source Hierarchy

The long-term source hierarchy should be:

1. Licensed, validated Jamaica national 5-6 m DEM/DTM where available.
2. GEDTM30 as the open Jamaica bare-earth baseline, with Caribbean expansion
   evaluated separately.
3. Copernicus GLO-30 as a comparison, quality-control source, and fallback.
4. ALOS AW3D30, NASADEM, and the World Bank Jamaica DEM for independent
   comparison and anomaly investigation, not automatic averaging.

If high-resolution Jamaica data is later adopted:

- Use it only inside its verified coverage.
- Bias-correct it to the baseline vertical reference.
- Feather or otherwise validate transitions at coverage boundaries.
- Retain a source mask so every pixel's origin is discoverable.
- Allow additional native detail at higher zooms only where the higher
  resolution source exists.

## Evaluation Data Flow

```text
Versioned GEDTM30 source COG
  -> record license, citation, checksum, units, horizontal CRS, vertical CRS
  -> subset versioned Jamaica coverage
  -> normalize units, no-data, coastline mask, and vertical reference
  -> generate analysis rasters and source-comparison reports
  -> generate chunked elevation artifacts and D1 summary import
  -> package isolated GEDTM30 raster-dem LOD tiles into PMTiles
  -> serve PMTiles through local Martin and validate the local application
  -> upload immutable R2 artifacts and import versioned D1 summaries
  -> compare visual terrain, elevation statistics, slopes, hydrology, bytes,
     decode CPU, and render behavior against Copernicus
  -> publish a release manifest and activate only after all gates pass
```

## Evaluation Steps

### 1. Acquire and Freeze the Candidate

Files:

- Ingestion source registry
- Source manifest schema
- R2 raw-source layout
- Local release-build configuration

Acquire only the COG ranges or tiles required for the versioned Jamaica coverage
mask where the distribution permits efficient subsetting.

Store:

```text
raw/T-02/{sourceVersion}/{runId}/...
raw/T-02/{sourceVersion}/{runId}/source-manifest.json
raw/T-02/{sourceVersion}/{runId}/LICENSE.txt
raw/T-02/{sourceVersion}/{runId}/CITATION.txt
```

The source manifest must include:

- Dataset and product version.
- DOI and source URL.
- Retrieval timestamp.
- File or object checksum.
- License identifier and attribution text.
- Horizontal CRS.
- Vertical CRS or datum.
- Units and scale factor.
- No-data value.
- Pixel spacing.
- Source temporal range where documented.

Do not proceed if the exact artifact's license or redistribution terms are
ambiguous.

### 1a. Freeze Jamaica Coverage

The initial coverage is Jamaica, not a Caribbean bounding rectangle. Store a
versioned GeoJSON polygon or raster mask with:

- a stable coverage ID;
- source and derivation notes;
- CRS;
- checksum;
- bounding box;
- generation timestamp;
- explicit rules for offshore padding and small outlying islands.

Use accurate coastline and land geometry for analysis. Tile generation may
include the minimal complete Web Mercator tiles intersecting that mask, but
analysis summaries must distinguish valid land, water, and no-data.

Suggested artifact:

```text
coverage/jamaica-v1.geojson
```

Do not start a full build until this mask and its checksum are fixed.

### 2. Normalize Spatial and Vertical References

File: `containers/geospatial/processor.py`

Before comparison:

1. Confirm GEDTM30's published horizontal coordinate system.
2. Confirm whether elevations are orthometric or ellipsoidal and identify the
   geoid model.
3. Confirm Copernicus, World Bank, national, and comparison-source vertical
   references.
4. Select and document one named project vertical reference, then transform all
   candidates to it where a defensible transform is available.
5. Apply documented scale factors before statistics or encoding.
6. Normalize no-data and water masks without converting valid coastal
   elevations to no-data.

Do not infer a common vertical reference merely because values are expressed in
meters.

### 3. Build the Jamaica Test Set

Select representative areas rather than relying on an island-wide average:

- Kingston and other dense urban areas.
- Blue Mountains and steep forested slopes.
- Cockpit Country or other karst terrain.
- Agricultural plains and low-relief interior areas.
- Rivers, reservoirs, and known drainage paths.
- Low coastal communities and flood-prone ground.
- Sharp coastline transitions.
- Areas with known cloud, void-fill, or surface-model artifacts.

Include point or survey references where licensing allows:

- National geodetic control or surveyed elevations.
- Validated topographic surveys from public hazard studies.
- A licensed national 5-6 m DEM/DSM if access is granted.
- Clearly documented independent elevation checkpoints.

Do not use another 30 m global DEM as ground truth. Use those datasets only for
cross-comparison.

### 4. Compare Against Existing Sources

Required candidates:

- GEDTM30.
- Copernicus GLO-30.
- World Bank Jamaica 30 m DEM.
- ALOS AW3D30 where terms permit the evaluation.
- NASADEM.

For each area calculate:

- Valid-data coverage.
- Minimum, maximum, mean, median, and robust spread.
- GEDTM30-minus-Copernicus elevation differences.
- Median bias and median absolute deviation.
- RMSE only where trustworthy reference elevations exist.
- Slope and aspect differences.
- Curvature and terrain-position differences where relevant.
- Hydrologic sink count and drainage continuity.
- Coastline and water-mask behavior.
- Frequency and magnitude of spikes, pits, and striping artifacts.

Produce maps of differences and source masks. Aggregate statistics alone are
not sufficient.

### 5. Evaluate Product Behavior

Re-run the product's terrain-derived outputs with GEDTM30:

- Terrain summaries by supported grid cell.
- Minimum, mean, and maximum elevation.
- Relief.
- Feasible slope or landslide indicators.
- Drainage-related terrain position.
- Coastal surge-versus-ground comparisons.

Flag cells where changing the DEM materially changes:

- Risk category.
- User-facing explanation.
- Confidence.
- Availability.

Review those cells manually before adoption. A visually smoother DTM is not
automatically a better hazard input.

Publish analysis data according to this boundary:

- D1 contains one indexed row per analysis cell with its stable ID, bounds,
  center, source release, minimum/maximum/mean elevation, relief, coverage,
  valid-sample counts, required slope or drainage indicators, and the R2 key of
  its detailed elevation artifact.
- R2 contains chunked detailed elevation grids, comparison reports,
  provenance, checksums, and validation output.
- PMTiles contains visual terrain tiles only. It is not the analytical source
  of truth.

Do not store individual approximately 30 m pixels or large elevation arrays as
D1 rows.

### 6. Generate Isolated MapLibre Artifacts

Do not overwrite Copernicus artifacts during evaluation.

Suggested layout:

```text
generated/{artifactVersion}/{runId}/terrain/gedtm30/jamaica.pmtiles
generated/{artifactVersion}/{runId}/terrain/gedtm30/manifest.json
generated/{artifactVersion}/{runId}/terrain/gedtm30/coverage.json
generated/{artifactVersion}/{runId}/analysis/gedtm30/elevation-grids/...
generated/{artifactVersion}/{runId}/analysis/gedtm30/validation-report.json
generated/{artifactVersion}/{runId}/analysis/gedtm30/d1-import-manifest.json
```

The build may use temporary loose Z/X/Y tiles locally, but published R2 output
must contain one immutable PMTiles archive per source and release rather than
thousands of individual terrain PNG objects.

Martin is the required local serving layer for the generated archive. It does
not replace GDAL, raster processing, terrain encoding, or PMTiles packaging.
Those tools create the archive; Martin serves it for local integration and
validation.

Minimum local Martin configuration:

```yaml
pmtiles:
  sources:
    gedtm30_jamaica:
      path: ./generated/{artifactVersion}/{runId}/terrain/gedtm30/jamaica.pmtiles
```

Equivalent one-off CLI usage is acceptable:

```sh
martin ./generated/{artifactVersion}/{runId}/terrain/gedtm30/jamaica.pmtiles
```

The release scripts should own a checked-in Martin configuration template while
generated paths and run IDs are supplied through local release configuration.

Use the same initial policy as the revised Copernicus plan:

| Map zoom | GEDTM30 detail                        |
| -------- | ------------------------------------- |
| 0-7      | No visual terrain shown in the app    |
| 8-10     | Medium island-level detail            |
| 11-12    | Full useful approximately 30 m detail |
| 13+      | Overzoom zoom-12 data                 |

Use only the versioned Jamaica coverage mask. Do not generate the former broad
Caribbean rectangle or other Caribbean islands in the initial release.

### 7. Reuse Encoding and PMTiles Delivery Benchmarks

Run GEDTM30 through the same candidates:

- Custom 16-bit encoding at 0.5 m increments.
- Mapbox Terrain-RGB control.
- Optimized lossless PNG.
- Exact lossless WebP candidate.
- 256 tile-size baseline.
- Optional 512 tile-size benchmark.

Compression results may differ from Copernicus because bare-earth correction
changes local pixel entropy. Do not assume the Copernicus winner automatically
wins for GEDTM30.

Serve evaluation artifacts from source-specific immutable PMTiles URLs:

```text
pmtiles://https://{terrain-host}/{artifactVersion}/{runId}/gedtm30/jamaica.pmtiles
pmtiles://https://{terrain-host}/{artifactVersion}/{runId}/copernicus/jamaica.pmtiles
```

Both sources must use equivalent cache and renderer settings for fair
comparison.

MapLibre should register the PMTiles protocol once and use each archive as a
`raster-dem` source. The archive host must support byte-range requests, CORS,
ETags, and immutable caching. Prefer an R2 custom domain. Use a Worker proxy
only if direct delivery does not meet access-control, caching, or observability
requirements.

Measure:

- complete PMTiles archive size;
- PMTiles directory/index overhead;
- range requests and bytes transferred per representative viewport;
- cold and warm request latency;
- R2 Class B reads;
- browser decode and render performance.

Before remote upload, run the same visual archive through Martin locally and
verify:

- `GET /catalog` lists the expected source;
- the source TileJSON endpoint resolves;
- representative Z/X/Y terrain requests decode to expected elevations;
- missing tiles and out-of-coverage requests behave consistently;
- the local application can render terrain using the Martin source;
- the direct local PMTiles protocol path and Martin compatibility path produce
  equivalent terrain.

### 8. Visual and Client-Performance A/B Test

Create a development-only source switch or separate test pages.

Compare:

- Terrain shape in urban and forested areas.
- Ridge and valley continuity.
- Coastal flatness and artifacts.
- Hillshade quality.
- Parent-child LOD transitions.
- Compressed bytes per viewport.
- Image decode and worker CPU.
- Time to first visible terrain.
- Pan, pitch, and zoom responsiveness.

The dataset choice should be driven primarily by terrain quality and
terrain-derived product behavior. Encoding and delivery should then be tuned
for the selected source.

### 9. Local-First Release Build and Publishing

The Jamaica release must be generated by a reproducible local command or small
set of commands. Do not rely on request-time Workers or the production
geospatial container for bulk generation.

The release has two strictly separated phases:

1. Local build and validation.
2. Remote publication to R2 and D1.

Remote publication must refuse to run unless the local release manifest records
a successful validation result for the same source checksum, coverage checksum,
configuration checksum, artifact version, and run ID.

The local build must:

1. Read the frozen source and coverage manifests.
2. Download or range-read required source COG data into a resumable cache.
3. Normalize projection, units, vertical reference, scale, no-data, and water
   handling.
4. Generate and validate the visual terrain pyramid for zooms 6 through 12.
5. Package the visual pyramid as PMTiles.
6. Generate chunked, compressed detailed elevation artifacts for product
   analysis.
7. Generate D1 summary rows and deterministic SQL import shards.
8. Produce checksums, tile and cell counts, storage totals, and a validation
   report.
9. Load the generated PMTiles archive into local Martin.
10. Import the generated D1 SQL into a local SQLite/D1-compatible database.
11. Run local application, PMTiles, Martin, analysis, and database validation.
12. Write a release manifest that references every immutable artifact and
    records the validation result.

The build must be resumable and idempotent. Re-running the same source,
coverage, configuration, and artifact version must either reproduce the same
checksums or fail with a documented nondeterminism reason.

Local validation must include:

- Martin catalog and source metadata;
- representative terrain tiles across zooms 6 through 12;
- PMTiles header, metadata, bounds, zooms, tile type, and compression;
- encoded-elevation round trips;
- coastline, water, and no-data cases;
- local D1 row counts, indexes, and representative lookups;
- every D1 detailed-artifact key resolving to a local staged object;
- application rendering and rain-simulation reads against local artifacts.

Only after local validation passes, publish in this order:

1. Upload immutable PMTiles, analysis chunks, provenance, and validation output
   to a versioned R2 prefix.
2. Verify uploaded sizes, checksums, byte-range reads, and representative
   decoded elevations.
3. Apply required D1 schema migrations.
4. Import the already validated D1 SQL shards with Wrangler.
5. Verify remote row counts, indexes, representative lookups, and D1-to-R2
   object references.
6. Configure and validate the R2 custom domain, range requests, CORS, ETags,
   and immutable cache metadata.
7. Optionally point a separate Martin validation configuration at the remote
   R2 PMTiles object and compare it with the locally served archive.
8. Upload the immutable release manifest.
9. Update `manifests/active.json` only after all remote validation succeeds.

Never activate a partially uploaded or partially imported release. Keep the
previous active manifest available for rollback. Define a retention policy for
old releases and source caches before automatic deletion.

Recommended command boundaries:

```text
terrain:build:local      Build all staged Jamaica artifacts.
terrain:serve:local      Start Martin against the staged PMTiles archive.
terrain:validate:local   Validate PMTiles, Martin, local database, and app.
terrain:upload:r2        Upload immutable validated artifacts to R2.
terrain:import:d1        Apply migrations and import validated SQL into D1.
terrain:validate:remote  Validate R2, D1, and cross-resource references.
terrain:activate         Atomically switch the active manifest.
```

### 10. Runtime Analysis Reads

Runtime analysis should:

- query D1 by indexed Jamaica analysis-cell ID or spatial lookup key;
- read a detailed R2 elevation chunk only when rain simulation or fine-grained
  analysis requires it;
- avoid parsing full-island JSON or PMTiles for analytical calculations;
- return a controlled unavailable-data response when the active manifest,
  summary row, or detailed artifact is missing;
- avoid production fallback generation once Jamaica coverage is complete.

JSON is acceptable for the first release if chunks are small and compressed.
Benchmark it against a compact binary representation before Caribbean
expansion.

### 11. Attribution and User Communication

If adopted:

- Add GEDTM30 attribution required by CC BY 4.0.
- Cite the dataset DOI in project data documentation.
- Describe it as a modeled bare-earth DTM, not survey-grade elevation.
- Publish source version, date, nominal resolution, and known limitations.
- Preserve Copernicus attribution if any production artifact still contains or
  directly redistributes Copernicus-derived data and its license requires it.

### 12. Adoption Decision

Adopt GEDTM30 as the baseline only if:

- Exact source licensing and redistribution are confirmed.
- Horizontal and vertical references are normalized and documented.
- It improves or maintains validated elevation quality in representative
  Jamaica terrain.
- It reduces surface-model bias in forests and urban areas without unacceptable
  smoothing or artifacts.
- Terrain-derived risk outputs are reviewed and remain defensible.
- Map rendering and LOD behavior pass the same checks as Copernicus.
- Operational ingestion, artifact size, and runtime delivery remain acceptable.
- The Jamaica PMTiles, R2 analysis artifacts, D1 summaries, and release manifest
  pass end-to-end publishing and rollback checks.

If it fails:

- Keep Copernicus as the production source.
- Retain GEDTM30 only as a comparison or quality-control dataset.
- Record failure reasons by terrain class and test area.

## Future Jamaica High-Resolution Track

A Jamaica government-hosted 2023 coastal assessment reports use of an
island-wide DEM/DSM with approximately 6 m horizontal and vertical resolution
from the National Spatial Data Management Division. Public redistribution
rights and direct download access were not confirmed during initial research.

Before using that dataset:

1. Request the exact product, metadata, collection date, DEM-versus-DSM
   classification, vertical datum, accuracy report, and license.
2. Confirm application hosting and derivative redistribution rights.
3. Evaluate it against surveyed checkpoints.
4. Use it as a high-resolution override, not as an uncorrected average.
5. Generate higher native zooms only inside its verified coverage.

Potential LOD if the national source is licensed:

| Map zoom | Preferred source                       |
| -------- | -------------------------------------- |
| 6-10     | Downsampled GEDTM30                    |
| 11-12    | Full GEDTM30                           |
| 13-15    | National 5-6 m DEM where available     |
| 16+      | Overzoom national maximum-detail tiles |

## Acceptance Criteria

- GEDTM30 is evaluated as a replacement candidate, not blindly averaged with
  Copernicus.
- The exact candidate version, license, checksum, units, CRS, vertical
  reference, and provenance are recorded.
- Representative Jamaica urban, forest, mountain, karst, plain, river, and
  coastal areas are reviewed.
- Product terrain summaries and risk outputs are compared, not only map
  appearance.
- Copernicus and GEDTM30 artifacts remain isolated and reproducible during A/B
  testing.
- Initial production coverage is limited to a versioned, checksummed Jamaica
  mask.
- Visual terrain is published as immutable PMTiles rather than loose production
  Z/X/Y objects.
- D1 stores indexed cell summaries and R2 pointers; dense elevation grids and
  reports are stored as chunked R2 artifacts.
- A reproducible local build emits PMTiles, analysis chunks, D1 SQL shards,
  manifests, checksums, and a validation report.
- Martin serves the staged PMTiles archive for local catalog, TileJSON, tile,
  and application validation before publication.
- Remote R2 upload and D1 import cannot run until the matching local release
  passes validation.
- Publishing uploads and validates immutable R2 artifacts, imports and verifies
  D1, and only then atomically switches `manifests/active.json`.
- The previous release remains available for rollback.
- The same MapLibre LOD, encoding, compression, caching, and client-performance
  benchmark process is applied to both sources.
- An adoption or rejection record identifies measured reasons and known
  limitations.
- Any future Jamaica 5-6 m source is used only after access, metadata, datum,
  accuracy, and redistribution rights are confirmed.
