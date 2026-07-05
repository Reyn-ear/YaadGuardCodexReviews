import maplibregl from 'maplibre-gl'
import { Protocol } from 'pmtiles'
import {
  TERRAIN_BASE_SHIFT,
  TERRAIN_BLUE_FACTOR,
  TERRAIN_GREEN_FACTOR,
  TERRAIN_MAX_ZOOM,
  TERRAIN_MIN_ZOOM,
  TERRAIN_RED_FACTOR,
  TERRAIN_TILE_URL,
} from './config'

export type TerrainCandidate = 'copernicus' | 'gedtm30'

export interface TerrainSourceConfig {
  candidate: TerrainCandidate
  label: string
  attribution: string
  source: maplibregl.RasterDEMSourceSpecification
}

let pmtilesRegistered = false

export function registerPmtilesProtocol() {
  if (pmtilesRegistered) {
    return
  }

  const protocol = new Protocol({ metadata: true })
  maplibregl.addProtocol('pmtiles', protocol.tile)
  pmtilesRegistered = true
}

export function resolveTerrainSource({
  isDevelopment,
  requestedCandidate,
  gedtm30PmtilesUrl,
  gedtm30TileJsonUrl,
  gedtm30TileSize = 256,
  gedtm30MinZoom = TERRAIN_MIN_ZOOM,
  gedtm30MaxZoom = TERRAIN_MAX_ZOOM,
}: {
  isDevelopment: boolean
  requestedCandidate?: string | null
  gedtm30PmtilesUrl?: string
  gedtm30TileJsonUrl?: string
  gedtm30TileSize?: number
  gedtm30MinZoom?: number
  gedtm30MaxZoom?: number
}): TerrainSourceConfig {
  const encoding = {
    encoding: 'custom' as const,
    redFactor: TERRAIN_RED_FACTOR,
    greenFactor: TERRAIN_GREEN_FACTOR,
    blueFactor: TERRAIN_BLUE_FACTOR,
    baseShift: TERRAIN_BASE_SHIFT,
  }

  if (
    isDevelopment &&
    requestedCandidate === 'gedtm30' &&
    (gedtm30PmtilesUrl || gedtm30TileJsonUrl)
  ) {
    return {
      candidate: 'gedtm30',
      label: 'GEDTM30 candidate',
      attribution: 'GEDTM30, CC BY 4.0. Evaluation artifact.',
      source: {
        type: 'raster-dem',
        url: gedtm30PmtilesUrl
          ? `pmtiles://${gedtm30PmtilesUrl}`
          : gedtm30TileJsonUrl,
        tileSize: gedtm30TileSize,
        minzoom: gedtm30MinZoom,
        maxzoom: gedtm30MaxZoom,
        ...encoding,
      },
    }
  }

  return {
    candidate: 'copernicus',
    label: 'Copernicus DEM GLO-30',
    attribution: 'Copernicus DEM GLO-30',
    source: {
      type: 'raster-dem',
      tiles: [TERRAIN_TILE_URL],
      tileSize: 256,
      minzoom: TERRAIN_MIN_ZOOM,
      maxzoom: TERRAIN_MAX_ZOOM,
      ...encoding,
    },
  }
}

export function getBrowserTerrainSource() {
  const requestedCandidate =
    typeof window === 'undefined'
      ? null
      : (new URLSearchParams(window.location.search).get('terrainSource') ??
        import.meta.env.VITE_TERRAIN_SOURCE)

  return resolveTerrainSource({
    isDevelopment: import.meta.env.DEV,
    requestedCandidate,
    gedtm30PmtilesUrl: import.meta.env.VITE_GEDTM30_PMTILES_URL,
    gedtm30TileJsonUrl: import.meta.env.VITE_GEDTM30_TILEJSON_URL,
    gedtm30TileSize: Number(import.meta.env.VITE_GEDTM30_TILE_SIZE) || 256,
    gedtm30MinZoom:
      Number(import.meta.env.VITE_GEDTM30_MIN_ZOOM) || TERRAIN_MIN_ZOOM,
    gedtm30MaxZoom:
      Number(import.meta.env.VITE_GEDTM30_MAX_ZOOM) || TERRAIN_MAX_ZOOM,
  })
}
