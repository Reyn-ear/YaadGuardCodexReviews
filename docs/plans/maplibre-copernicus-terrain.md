# MapLibre Copernicus Terrain Implementation Plan

## Objective

Render Copernicus DEM terrain with MapLibre's built-in 3D terrain primitives and serve precomputed, standard DEM tiles from R2. The implementation target is the MapLibre 3D terrain example style: pitched terrain, hillshade, basemap context, sky, pitch controls, and terrain controls.

Dev validation is the release gate. Once the terrain flow works in dev and the verification checklist passes, deploy the same implementation to production.

## Decisions

- Use MapLibre `raster-dem` sources for terrain displacement.
- Use MapLibre `terrain`, `hillshade`, `sky`, `NavigationControl`, and `TerrainControl`.
- Use standard Mapbox Terrain-RGB PNG encoding for generated DEM tiles.
- Generate terrain tiles during ingestion, store them in R2, and serve them directly at runtime.
- Remove user-request runtime DEM processing from `/api/tiles/{z}/{x}/{y}.png`.
- Keep the terrain coverage bounded to the Caribbean coverage window unless product scope narrows it further.

## Target Data Flow

```text
Copernicus DEM GLO-30 COG
  -> geospatial container samples DEM with rasterio
  -> container encodes 256x256 Mapbox Terrain-RGB PNG tiles
  -> ingestion Worker writes tiles to R2 under generated/{runId}/tiles/{z}/{x}/{y}.png
  -> active manifest points runtime reads at the generated run prefix
  -> /api/tiles/{z}/{x}/{y}.png streams the R2 object
  -> MapLibre raster-dem source decodes Terrain-RGB
  -> MapLibre terrain mesh and hillshade render in the popup
```

## Implementation Steps

### 1. Terrain Configuration

File: `src/features/map/config.ts`

Add explicit terrain config:

```ts
export const TERRAIN_TILE_URL = '/api/tiles/{z}/{x}/{y}.png'
export const TERRAIN_SOURCE_ID = 'terrain-dem-source'
export const TERRAIN_HILLSHADE_LAYER_ID = 'terrain-hillshade'
export const TERRAIN_BASEMAP_SOURCE_ID = 'terrain-basemap-source'
export const TERRAIN_BASEMAP_LAYER_ID = 'terrain-basemap'
export const TERRAIN_TILE_SIZE = 256
export const TERRAIN_MIN_ZOOM = 10
export const TERRAIN_MAX_ZOOM = 13
export const TERRAIN_EXAGGERATION = 1.0
export const TERRAIN_ENCODING = 'mapbox'
export const TERRAIN_BOUNDS = [-92, 0, -50, 35] as const
```

Remove the custom DEM factors from active use:

- `TERRAIN_RED_FACTOR`
- `TERRAIN_GREEN_FACTOR`
- `TERRAIN_BLUE_FACTOR`
- `TERRAIN_BASE_SHIFT`

Build one `raster-dem` source shape from these constants so `TerrainPopup` cannot drift from the processor encoding.

### 2. MapLibre 3D Terrain Popup

File: `src/features/map/TerrainPopup.tsx`

Change the popup style to follow the MapLibre 3D terrain example, adapted to local Copernicus tiles.

Expected style structure:

```ts
style: {
  version: 8,
  sources: {
    [TERRAIN_BASEMAP_SOURCE_ID]: {
      type: 'raster',
      tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '&copy; OpenStreetMap Contributors',
    },
    [TERRAIN_SOURCE_ID]: {
      type: 'raster-dem',
      tiles: [TERRAIN_TILE_URL],
      tileSize: TERRAIN_TILE_SIZE,
      encoding: TERRAIN_ENCODING,
      minzoom: TERRAIN_MIN_ZOOM,
      maxzoom: TERRAIN_MAX_ZOOM,
      bounds: TERRAIN_BOUNDS,
    },
    'terrain-focus': {
      type: 'geojson',
      data: focusFeatureCollection,
    },
  },
  layers: [
    {
      id: TERRAIN_BASEMAP_LAYER_ID,
      type: 'raster',
      source: TERRAIN_BASEMAP_SOURCE_ID,
      paint: { 'raster-opacity': 0.82 },
    },
    {
      id: TERRAIN_HILLSHADE_LAYER_ID,
      type: 'hillshade',
      source: TERRAIN_SOURCE_ID,
      paint: {
        'hillshade-method': 'standard',
        'hillshade-exaggeration': 0.45,
        'hillshade-shadow-color': '#263238',
        'hillshade-highlight-color': '#f8fafc',
        'hillshade-accent-color': '#38bdf8',
      },
    },
    focusFillLayer,
    focusOutlineLayer,
    focusPointLayer,
    focusLabelLayer,
  ],
  terrain: {
    source: TERRAIN_SOURCE_ID,
    exaggeration: TERRAIN_EXAGGERATION,
  },
  sky: {},
}
```

Map constructor changes:

- `pitch: 70`
- `maxPitch: 85`
- `bearing: -20`
- `maxZoom: TERRAIN_MAX_ZOOM`
- `minZoom: TERRAIN_MIN_ZOOM`
- `canvasContextAttributes: { antialias: true }`

Controls:

```ts
map.addControl(
  new maplibregl.NavigationControl({ visualizePitch: true }),
  'bottom-right',
)

map.addControl(
  new maplibregl.TerrainControl({
    source: TERRAIN_SOURCE_ID,
    exaggeration: TERRAIN_EXAGGERATION,
  }),
  'top-right',
)
```

Keep the selected cell focus polygon, point, and label above the terrain.

### 3. DEM Tile Encoding

File: `containers/geospatial/processor.py`

Replace the custom green/blue encoding in `build_terrain_tile_png` with Mapbox Terrain-RGB.

Encoding formula:

```text
encoded = round((elevation_m + 10000.0) * 10.0)
r = floor(encoded / 65536)
g = floor((encoded % 65536) / 256)
b = encoded % 256
height_m = -10000.0 + ((r * 256 * 256 + g * 256 + b) * 0.1)
```

Implementation detail:

```py
def encode_mapbox_terrain_rgb(elevations):
    encoded = np.round((elevations + 10000.0) * 10.0)
    encoded = np.clip(encoded, 0, 16777215).astype(np.uint32)

    rgba = np.zeros((TILE_SIZE, TILE_SIZE, 4), dtype=np.uint8)
    rgba[:, :, 0] = ((encoded >> 16) & 255).astype(np.uint8)
    rgba[:, :, 1] = ((encoded >> 8) & 255).astype(np.uint8)
    rgba[:, :, 2] = (encoded & 255).astype(np.uint8)
    rgba[:, :, 3] = 255
    return rgba
```

Then:

```py
def build_terrain_tile_png(z, x, y):
    west, south, east, north = tile_bounds(z, x, y)
    elevations = sample_dem_grid(west, south, east, north, TILE_SIZE, TILE_SIZE)
    rgba = encode_mapbox_terrain_rgb(elevations)

    output = io.BytesIO()
    Image.fromarray(rgba, mode="RGBA").save(output, format="PNG", optimize=True)
    return output.getvalue()
```

No-data remains represented by `NODATA_ELEVATION_M = -2.0`, which renders slightly below sea level and keeps the current water/no-coverage behavior coherent.

### 4. Runtime Tile Route

Files:

- `src/server.ts`
- `server/api/tiles/[z]/[x]/[y].ts`
- `src/features/map/demProcessor.server.ts`

Make `/api/tiles/{z}/{x}/{y}.png` an R2 streaming route only.

`src/server.ts` behavior:

1. Validate method is `GET` or `HEAD`.
2. Build key `tiles/{z}/{x}/{y}.png`.
3. Resolve through the active manifest generated prefix.
4. Return the R2 object body with:
   - `Content-Type: image/png`
   - `Cache-Control: public, max-age=3600`
   - `Access-Control-Allow-Origin: *`
5. Return `404` when the tile is missing.

Remove `processDemTerrainTile` from runtime tile handling. The container should not be called from user traffic for terrain tiles.

`server/api/tiles/[z]/[x]/[y].ts` should mirror the same R2-only behavior for the Nitro route path used in dev.

`demProcessor.server.ts` should keep processor functions needed for ingestion and compact elevation grids. The user-facing tile route should not call `processDemTerrainTile`.

### 5. Ingestion-Time Tile Generation

Files:

- `src/features/ingestion/ingestion.server.ts`
- `containers/geospatial/processor.py`
- Optional helper: `src/features/ingestion/terrainTiles.server.ts`

Add a terrain tile generation job for source `T-01`.

Worker responsibilities:

1. Compute all tile coordinates intersecting `TERRAIN_BOUNDS` for zooms `TERRAIN_MIN_ZOOM` through `TERRAIN_MAX_ZOOM`.
2. For each tile, call the geospatial container endpoint:

```text
GET https://processor/terrain-tile?z={z}&x={x}&y={y}
```

3. Write each PNG to:

```text
generated/{runId}/tiles/{z}/{x}/{y}.png
```

4. Write a terrain artifact manifest:

```text
generated/{runId}/terrain/manifest.json
```

Manifest shape:

```json
{
  "sourceId": "T-01",
  "source": "Copernicus DEM GLO-30 COG",
  "encoding": "mapbox",
  "tileSize": 256,
  "minZoom": 10,
  "maxZoom": 13,
  "bounds": [-92, 0, -50, 35],
  "tileCount": 0,
  "generatedAt": "2026-06-02T00:00:00.000Z"
}
```

Tile coordinate helper details:

```ts
function lonToTileX(lon: number, zoom: number) {
  return Math.floor(((lon + 180) / 360) * 2 ** zoom)
}

function latToTileY(lat: number, zoom: number) {
  const radians = (lat * Math.PI) / 180
  return Math.floor(
    ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) *
      2 ** zoom,
  )
}
```

Use inclusive ranges:

- `xMin = lonToTileX(west, z)`
- `xMax = lonToTileX(east, z)`
- `yMin = latToTileY(north, z)`
- `yMax = latToTileY(south, z)`

Process tiles with bounded concurrency. Start with concurrency `4` in dev and tune after measuring container throughput.

### 6. Dev Seed Command

Add a dev-friendly way to generate the terrain tiles before opening the map.

Preferred implementation:

- Add a protected ingestion trigger for only `T-01`.
- Use the existing `/api/ingestion/start` endpoint with `sourceIds: ["T-01"]`.
- Document the exact command in `README.md` after implementation.

Expected dev sequence:

```sh
npm run db:migrate:local
npm run dev
curl -X POST http://localhost:3000/api/ingestion/start \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $INGESTION_ADMIN_TOKEN" \
  -d '{"sourceIds":["T-01"]}'
```

Then open the map, select a grid cell, and open Terrain Details.

### 7. Validation

Add deterministic checks before production deployment.

Tile encoding validation:

- Decode sample generated PNG pixels with the Mapbox formula.
- Confirm representative elevations roundtrip within `0.1m`.
- Test values:
  - `-2.0`
  - `0.0`
  - `12.3`
  - `250.0`
  - `1200.0`

R2 artifact validation:

- `terrain/manifest.json` exists.
- `tileCount` is greater than `0`.
- At least one generated PNG exists for each configured zoom.
- Sample PNG dimensions are `256x256`.
- Sample PNG alpha channel is `255`.

Renderer validation:

- Terrain popup opens after a grid cell selection.
- Basemap is visible.
- Terrain relief is visible at pitch.
- Hillshade is visible.
- Focus polygon, outline, point, and label are visible.
- No browser console errors.
- Missing tiles return `404`, not a container-generated response.

Performance validation:

- The terrain popup does not call the geospatial container.
- DEM tile requests are served from `/api/tiles`.
- Total terrain tile requests for a popup remain within the expected MapLibre viewport count.
- Time from clicking Terrain Details to visible terrain is acceptable in dev.

Commands:

```sh
npm run lint
npm run build
npm run test:e2e
```

### 8. Production Deployment

Production deployment happens after dev validation passes.

Deployment sequence:

1. Run local/dev ingestion for `T-01`.
2. Verify the renderer and tile route in dev.
3. Run lint, build, and e2e tests.
4. Deploy:

```sh
npm run deploy
```

5. Run hosted ingestion for `T-01`.
6. Verify `manifests/active.json` points at the run with terrain tiles.
7. Open production map, select a cell, and verify Terrain Details renders with 3D terrain.

## Acceptance Criteria

- `TerrainPopup` visually matches the MapLibre 3D terrain pattern with pitched terrain, sky, basemap, hillshade, and controls.
- DEM tiles are Mapbox Terrain-RGB PNGs.
- Runtime tile requests read from R2 only.
- The geospatial container is used during ingestion, not user-facing tile serving.
- Dev terrain rendering works from generated artifacts.
- Production is deployed after the dev validation checklist passes.
