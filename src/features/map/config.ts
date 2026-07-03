import type { LngLatTuple } from './types'

export const MAP_STYLE_URL =
  'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

export const GEOCODER_ENDPOINT = 'https://photon.komoot.io/api/'

export const DEFAULT_MAP_CENTER: LngLatTuple = [-76.7928, 17.9714]
export const DEFAULT_MAP_ZOOM = 12

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

export const TERRAIN_TILE_URL =
  import.meta.env.VITE_TERRAIN_TILE_URL ??
  '/api/tiles/{z}/{x}/{y}.webp?v=terrain-rgb-v2'
export const TERRAIN_SOURCE_ID = 'terrain-dem-source'
export const TERRAIN_HILLSHADE_LAYER_ID = 'terrain-hillshade'
export const TERRAIN_MIN_ZOOM = 10
export const TERRAIN_MAX_ZOOM = 12
export const TERRAIN_EXAGGERATION = 1.0
