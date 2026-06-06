import type { BoundsTuple, LngLatTuple } from './types'

export const MAP_STYLE_URL =
  'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

export const GEOCODER_ENDPOINT = 'https://photon.komoot.io/api/'

export const DEFAULT_MAP_CENTER: LngLatTuple = [-76.7928, 17.9714]
export const DEFAULT_MAP_ZOOM = 12

// Product camera coverage. This is intentionally separate from country and
// analysis bounds, which describe data-query and grid-filtering regions.
export const CARIBBEAN_CAMERA_BOUNDS: BoundsTuple = [
  [-90, 9],
  [-58, 28],
]

export const MAP_MAX_BOUNDS: BoundsTuple = [
  [-122, -5],
  [-38, 37],
]

export const GRID_ROWS = 100
export const GRID_COLUMNS = 100
export const GRID_LAT_STEP = 0.015
export const GRID_LNG_STEP = 0.02
export const GRID_LAT_SPAN = GRID_ROWS * GRID_LAT_STEP
export const GRID_LNG_SPAN = GRID_COLUMNS * GRID_LNG_STEP

export const GRID_SOURCE_ID = 'map-grid-source'
export const GRID_FILL_LAYER_ID = 'map-grid-fill'
export const GRID_OUTLINE_LAYER_ID = 'map-grid-outline'

export const WATER_SOURCE_ID = 'water-depth-source'
export const WATER_FILL_LAYER_ID = 'water-depth-fill'

export const TERRAIN_TILE_URL = '/api/tiles/{z}/{x}/{y}.png'
export const TERRAIN_SOURCE_ID = 'terrain-dem-source'
export const TERRAIN_HILLSHADE_SOURCE_ID = 'terrain-hillshade-source'
export const TERRAIN_HILLSHADE_LAYER_ID = 'terrain-hillshade'
export const TERRAIN_MIN_ZOOM = 6
export const TERRAIN_DISPLAY_MIN_ZOOM = 8
export const TERRAIN_MAX_ZOOM = 12
export const TERRAIN_EXAGGERATION = 1.0
export const TERRAIN_RED_FACTOR = 0
export const TERRAIN_GREEN_FACTOR = 25.6
export const TERRAIN_BLUE_FACTOR = 0.1
export const TERRAIN_BASE_SHIFT = -3276.8
