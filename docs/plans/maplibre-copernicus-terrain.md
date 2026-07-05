# MapLibre Copernicus Terrain Implementation Plan

## Objective

Render Copernicus DEM GLO-30 terrain with MapLibre's built-in 3D terrain
primitives while minimizing client JavaScript, client CPU, transferred bytes,
runtime compute, and unnecessary tile generation.

Terrain tiles are generated during ingestion, stored as immutable artifacts in
R2, and served through Cloudflare caching. MapLibre selects only the tiles
needed for the current viewport and zoom. Lower zooms use coarser DEM levels,
detail increases while zooming in, and detail stops increasing at the useful
resolution of GLO-30.

Dev validation and measured performance are release gates. Production deployment
happens only after visual, encoding, cache, transfer-size, and client-CPU
checks pass.

## Decisions

- Keep MapLibre's native `raster-dem`, `terrain`, and `hillshade` primitives.
- Do not add deck.gl for terrain. Its `TerrainLayer` still downloads elevation
  images, decodes pixels, builds meshes, and adds JavaScript dependencies.
- Generate a multi-zoom DEM pyramid during ingestion. Do not generate terrain
  from user requests.
- Use zoom 12 as the default maximum native-detail level for GLO-30 around
  Jamaica. At approximately 18 degrees latitude, zoom 12 is about 36 m per
  pixel, close to the source's approximately 30 m spacing.
- Let MapLibre overzoom zoom-12 terrain above source zoom 12. Do not generate
  zoom 13 unless a controlled visual benchmark demonstrates a meaningful
  improvement that justifies approximately four times as many tiles.
- Generate only tiles intersecting supported product coverage. Do not use the
  previous broad `[-92, 0, -50, 35]` rectangle as the generation footprint.
- Prefer a compact 16-bit custom elevation encoding with 0.5 m increments.
  Benchmark it against standard Mapbox Terrain-RGB before finalizing.
- Use optimized lossless PNG as the compatibility baseline. Benchmark lossless
  WebP for exact pixel preservation, transfer size, decode time, and browser
  reliability before adopting it.
- Use immutable, versioned tile URLs with long-lived browser and edge caching.
- Lazy-load the map and MapLibre code so non-map visits do not pay the mapping
  JavaScript cost.
- Keep source, encoding, coverage, and provenance metadata in a versioned
  terrain manifest and TileJSON document.

## Non-Goals

- Do not synthesize terrain detail beyond the GLO-30 source resolution.
- Do not average unrelated global DEMs into the production source without a
  separate source-evaluation and bias-correction process.
- Do not use lossy JPEG, lossy WebP, or lossy AVIF for elevation values.
- Do not use the terrain tiles as survey-grade or flood-model-grade elevation.
  GLO-30 is a digital surface model and includes vegetation and structures.

## Level-of-Detail Policy

The source pyramid must provide progressively greater detail as the user zooms
in without loading all resolution levels at once.

| Map zoom | Terrain policy                                              |
| -------- | ----------------------------------------------------------- |
| 0-7      | No visual terrain shown in the app                          |
| 8-10     | Medium island-level DEM                                     |
| 11-12    | Full useful GLO-30 detail                                   |
| 13+      | Overzoom zoom-12 DEM; do not claim additional source detail |

Each zoom should be generated directly from GLO-30 or an appropriate
high-quality source overview. Do not build all lower zooms by repeatedly
resampling already encoded child tiles.

MapLibre requests visible tiles at the appropriate source zoom. It does not
download the complete pyramid. Parent tiles may remain visible while more
detailed child tiles load.

## Target Data Flow

```text
Copernicus DEM GLO-30 COG
  -> ingestion selects only supported coverage tiles
  -> geospatial container samples the appropriate source overview per zoom
  -> container quantizes elevations and encodes lossless raster-dem images
  -> benchmark gate selects optimized PNG or exact lossless WebP
  -> ingestion writes immutable, versioned tiles and metadata to R2
  -> active manifest points to a versioned TileJSON document
  -> Cloudflare edge serves versioned tile responses with immutable caching
  -> lazy-loaded MapLibre raster-dem source requests visible LOD tiles only
  -> MapLibre workers decode DEM pixels and build terrain meshes
  -> MapLibre renders terrain and optional hillshade
```

## Implementation Steps

### 1. Terrain Configuration

Files:

- `src/features/map/config.ts`
- The MapLibre terrain setup in `src/features/map/MapPage.tsx`

Define explicit source and LOD configuration:

```ts
export const TERRAIN_SOURCE_ID = 'terrain-dem-source'
export const TERRAIN_HILLSHADE_LAYER_ID = 'terrain-hillshade'
export const TERRAIN_TILE_SIZE = 256
export const TERRAIN_MIN_ZOOM = 6
export const TERRAIN_DISPLAY_MIN_ZOOM = 8
export const TERRAIN_MAX_ZOOM = 12
export const TERRAIN_EXAGGERATION = 1.0
export const TERRAIN_ENCODING = 'custom'

export const TERRAIN_RED_FACTOR = 0
export const TERRAIN_GREEN_FACTOR = 128
export const TERRAIN_BLUE_FACTOR = 0.5
export const TERRAIN_BASE_SHIFT = -1000
```

The proposed custom encoding uses green as the high byte and blue as the low
byte:

```text
encoded = round((elevation_m + 1000) * 2)
green = floor(encoded / 256)
blue = encoded % 256
red = 0

elevation_m = green * 128 + blue * 0.5 - 1000
```

This provides 0.5 m increments from approximately -1000 m to 31,767.5 m.
That precision is already finer than the practical vertical accuracy of
GLO-30, while the constant red channel should compress better than full
three-channel Terrain-RGB.

Build one typed `raster-dem` source definition from the configuration and
terrain manifest so renderer settings cannot drift from ingestion settings.

The source must include accurate:

- `minzoom`
- `maxzoom`
- `bounds`
- `tileSize`
- `encoding`
- Custom channel factors and base shift

Do not constrain the map's interactive `maxZoom` to the DEM source `maxzoom`.
Users may zoom farther in while MapLibre overzooms the last native DEM level.

### 2. Coverage Definition

Files:

- `src/features/map/config.ts`
- `src/features/ingestion/terrainTiles.server.ts`, or an equivalent ingestion
  module

Replace the broad Caribbean rectangle with explicit product coverage.

Preferred order:

1. Tiles intersecting supported analysis grid cells.
2. Buffered Jamaica or supported-island polygons.
3. A tightly bounded product rectangle only if polygonal generation is not yet
   available.

Persist both:

- A simple bounding box for MapLibre source metadata.
- A sparse tile allowlist or coverage mask for ingestion and validation.

Ocean-only and unsupported tiles should not be generated merely because they
fall inside a large rectangular extent.

### 3. MapLibre Terrain Rendering

File: `src/features/map/MapPage.tsx`

Use the existing MapLibre map instance and add:

- One `raster-dem` source.
- Native `terrain`.
- An optional `hillshade` layer.
- Existing grid and focus overlays above terrain.
- `NavigationControl` with pitch visualization.
- `TerrainControl` only if users need to toggle exaggeration or terrain.

Recommended initial settings:

- Terrain mode pitch near 65-70 degrees.
- `maxPitch` near 85 degrees.
- Exaggeration `1.0`.
- Source `maxzoom: 12`.
- Visual terrain hidden below zoom 8.
- Accurate source bounds.

Performance requirements:

- Do not instantiate a second map or deck.gl renderer for terrain.
- Benchmark `canvasContextAttributes.antialias`. Leave it disabled if the
  visual benefit does not justify GPU cost.
- Allow hillshade to be disabled independently from terrain. On weak devices,
  terrain without a separate hillshade pass may be the preferred profile.
- Keep terrain disabled until the user selects terrain mode.

### 4. Client JavaScript Loading

Files:

- The route or component that loads `MapPage`
- MapLibre imports in `src/features/map/MapPage.tsx`

Reduce initial JavaScript independently from DEM transfer optimization:

1. Lazy-load the map route or map component.
2. Dynamically load MapLibre and its terrain UI only when the map is needed.
3. Do not add deck.gl unless a separate visualization requirement justifies its
   bundle and runtime cost.
4. Measure the initial non-map bundle, map chunk, and terrain activation cost.

The terrain source format does not materially reduce the MapLibre JavaScript
bundle. Bundle splitting is required to improve initial page loading.

### 5. DEM Tile Encoding

File: `containers/geospatial/processor.py`

Implement the proposed 16-bit custom encoding as the preferred candidate, but
retain a benchmark path for standard Mapbox Terrain-RGB.

Encoding candidates:

| Candidate          | Precision | Expected tradeoff                                  |
| ------------------ | --------- | -------------------------------------------------- |
| Custom 16-bit      | 0.5 m     | Better compression, MapLibre-web specific settings |
| Mapbox Terrain-RGB | 0.1 m     | Broad portability, excess precision and entropy    |

Image-format candidates:

| Candidate     | Requirement                                                                          |
| ------------- | ------------------------------------------------------------------------------------ |
| Optimized PNG | Baseline; exact RGB values and broad compatibility                                   |
| Lossless WebP | Adopt only if exact pixels, smaller transfer, and acceptable decode CPU are verified |

For PNG, compare the current Pillow output with a production optimizer such as
`oxipng` or an equivalent lossless pipeline.

For WebP:

- Use lossless mode only.
- Verify decoded RGB bytes exactly match the encoded elevation bytes.
- Test Chromium, Firefox, and Safari versions in the supported browser matrix.
- Compare worker decode and time-to-visible-terrain on a mid-range mobile
  device.

Use RGB rather than RGBA if MapLibre and the chosen browser path preserve the
values correctly. A constant opaque alpha channel should not be stored unless
required.

No-data handling must be explicit in the manifest. Do not silently use a valid
low elevation as no-data when that value could be meaningful for coastal
analysis.

### 6. Tile-Size Benchmark

Baseline: `256x256`.

Benchmark `512x512` only as a controlled alternative. Larger tiles may reduce
request count but increase per-request transfer, decode work, memory spikes,
and wasted pixels near viewport edges.

Record for each candidate:

- Median and p95 compressed tile size.
- Tile count for representative viewports.
- Total transferred DEM bytes.
- Image decode time.
- Time to first visible terrain.
- Peak worker and GPU memory where measurable.
- Pan and zoom responsiveness.

Do not choose 512 solely because it creates fewer HTTP requests.

### 7. Ingestion-Time LOD Generation

Files:

- `src/features/ingestion/ingestion.server.ts`
- `containers/geospatial/processor.py`
- Optional helper: `src/features/ingestion/terrainTiles.server.ts`

Add a terrain generation job for source `T-01`.

Worker responsibilities:

1. Load the product coverage mask.
2. Compute sparse tile coordinates for zooms 6 through 12.
3. Select an appropriate GLO-30 overview or resampling scale for each zoom.
4. Call the geospatial container with explicit source, zoom, encoding, tile
   size, and image-format parameters.
5. Write immutable tiles under a versioned prefix.
6. Write terrain manifest and TileJSON artifacts.
7. Validate tile count, coverage, encoding, and representative elevation
   roundtrips before activating the run.

Suggested layout:

```text
generated/{artifactVersion}/{runId}/terrain/copernicus/tiles/{z}/{x}/{y}.{ext}
generated/{artifactVersion}/{runId}/terrain/copernicus/tilejson.json
generated/{artifactVersion}/{runId}/terrain/copernicus/manifest.json
generated/{artifactVersion}/{runId}/terrain/copernicus/coverage.json
```

3. Write each PNG to the local release directory:

```text
tiles/{z}/{x}/{y}.png
```

4. Write terrain provenance and build metadata:

```text
provenance/source-manifest.json
provenance/build-configuration.json
```

Build metadata shape:

```json
{
  "sourceId": "T-01",
  "source": "Copernicus DEM GLO-30",
  "artifactVersion": "terrain-v2",
  "runId": "immutable-run-id",
  "demType": "DSM",
  "encoding": "custom",
  "elevationIncrementM": 0.5,
  "imageFormat": "png",
  "tileSize": 256,
  "minZoom": 6,
  "maxZoom": 12,
  "bounds": [-78.5, 17.6, -76.0, 18.6],
  "coverageId": "supported-jamaica-grid-v1",
  "tileCountByZoom": {},
  "sourceVersion": "record-the-upstream-version",
  "generatedAt": "ISO-8601 timestamp"
}
```

The example bounds are illustrative. Derive production values from the actual
supported coverage rather than copying them into configuration.

### 8. Versioned TileJSON and Runtime Delivery

Files:

- `src/server.ts`
- `server/api/tiles/[z]/[x]/[y].ts`, if retained for local development
- A TileJSON or terrain metadata endpoint

The active manifest should resolve to a versioned TileJSON URL. TileJSON should
then contain immutable tile URLs, for example:

```text
/api/terrain/{artifactVersion}/{runId}/{z}/{x}/{y}.png
```

For immutable tiles return:

```http
Cache-Control: public, max-age=31536000, immutable
Access-Control-Allow-Origin: *
Content-Type: image/png
ETag: "<object-etag>"
```

Also:

- Support `GET` and `HEAD`.
- Propagate `Content-Length`, `ETag`, and object content type where available.
- Honor conditional requests or let Cloudflare satisfy them.
- Cache missing immutable tile responses for a bounded period.
- Never call the geospatial container from a user-facing tile request.

Preferred production delivery is an R2 custom domain or a cacheable Worker path
that does not invoke the application rendering stack. Keep the Nitro route only
where needed for local parity.

The active manifest or unversioned TileJSON pointer may use a short cache
lifetime. The tile artifacts referenced by it are immutable.

### 9. Dev Seed Command

Provide a protected ingestion trigger for source `T-01`:

```sh
npm run db:migrate:local
npm run dev
curl -X POST http://localhost:3000/api/ingestion/start \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $INGESTION_ADMIN_TOKEN" \
  -d '{"sourceIds":["T-01"]}'
```

Document the final command in `README.md` after implementation.

### 10. Validation

#### Encoding validation

- Roundtrip representative elevations through each encoding candidate.
- Require exact encoded-byte preservation after image decode.
- For custom 0.5 m encoding, require error no greater than 0.25 m before
  quantization tie handling.
- Test negative coastal elevations, sea level, hills, and Blue Mountain
  elevations.
- Verify no-data behavior separately from valid elevation values.

#### LOD validation

- Confirm lower zoom tiles contain less spatial detail and fewer source samples.
- Confirm detail increases through zoom 12.
- Confirm zoom 13 and above overzoom zoom-12 data without requesting nonexistent
  native-detail levels.
- Confirm MapLibre requests only viewport tiles, not all zoom levels.
- Check parent-to-child transitions for visible height jumps or seams.

#### Coverage validation

- Confirm every supported analysis grid cell has terrain coverage.
- Confirm ocean-only and unsupported areas are excluded.
- Confirm source bounds prevent requests far outside supported coverage.
- Compare sparse tile counts with the previous broad rectangular estimate.

#### Renderer validation

- Basemap, terrain relief, grid, focus geometry, and labels remain visible.
- Hillshade can be enabled and disabled independently.
- Missing terrain degrades cleanly without removing the base map.
- No browser console or worker errors occur.

#### Delivery validation

- User-facing tile requests never call the geospatial container.
- Versioned URLs return one-year immutable cache headers.
- Repeat views produce browser or edge cache hits.
- `HEAD`, `ETag`, `Content-Length`, CORS, and content type are correct.
- Activating a new manifest changes URLs rather than overwriting cached tiles.

#### Performance benchmark

Test representative Jamaica views on desktop and a mid-range mobile device:

- Cold terrain activation.
- Warm-cache terrain activation.
- Zoom 8 regional view.
- Zoom 10 island view.
- Zoom 12 local view.
- Zoom 14 overzoomed local view.
- Pan across a tile boundary.

Compare:

- Custom encoding versus Terrain-RGB.
- Optimized PNG versus lossless WebP.
- 256 versus 512 tile size if 512 remains a candidate.
- Terrain with and without hillshade.
- Antialiasing on and off.

Capture:

- JavaScript bytes for initial page and lazy map chunk.
- DEM bytes transferred.
- Number of DEM requests.
- Time to first visible terrain.
- Main-thread long tasks.
- Worker CPU time where observable.
- Frame responsiveness during pan, pitch, and zoom.

Choose formats from measured results rather than compression ratio alone.

Commands:

```sh
npm run lint
npm run build
npm run test:e2e
```

### 11. Production Deployment

Production deployment happens after dev validation passes.

Deployment sequence:

1. Run local/dev ingestion for `T-01`.
2. Verify the renderer and tile route in dev.
3. Run lint, build, and e2e tests.
4. Deploy:

```sh
npm run deploy
```

5. Preview the local WebP terrain release with `npm run terrain:preview-local`.
6. Publish the verified release to the R2 `data/` prefix.
7. Open production map, select a cell, and verify Terrain Details renders with 3D terrain.

## Acceptance Criteria

- MapLibre native `raster-dem` terrain is used without deck.gl.
- Terrain is generated during ingestion and never generated from user traffic.
- The LOD pyramid provides coarse regional data and full useful detail by zoom 12.
- Zooms above 12 overzoom the last native GLO-30 level.
- Terrain generation uses actual supported coverage rather than the old broad
  Caribbean rectangle.
- The selected encoding and image format are backed by transfer-size and
  client-decode benchmarks.
- Immutable versioned tile URLs use long-lived browser and edge caching.
- MapLibre is lazy-loaded so non-map visits avoid its JavaScript cost.
- Terrain, hillshade, overlays, and failure behavior pass desktop and mobile
  validation.
- Source version, coverage, encoding, and provenance are recorded in the
  terrain manifest.
