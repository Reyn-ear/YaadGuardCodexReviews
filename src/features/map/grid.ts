import { isPointOnCaribbeanLand } from './geometry'
import type {
  GridCellFeature,
  GridFeatureCollection,
  LngLatTuple,
} from './types'
import { GRID_COLUMNS, GRID_LAT_STEP, GRID_LNG_STEP, GRID_ROWS } from './config'

interface GridOptions {
  center: LngLatTuple
  rows?: number
  cols?: number
  latStep?: number
  lngStep?: number
}

export function getColumnLabel(index: number): string {
  let label = ''
  let current = index

  do {
    label = String.fromCharCode(65 + (current % 26)) + label
    current = Math.floor(current / 26) - 1
  } while (current >= 0)

  return label
}

export function createGridFeatureCollection({
  center,
  rows = GRID_ROWS,
  cols = GRID_COLUMNS,
  latStep = GRID_LAT_STEP,
  lngStep = GRID_LNG_STEP,
}: GridOptions): GridFeatureCollection {
  const [centerLng, centerLat] = center
  const startLat = centerLat + (rows / 2) * latStep
  const startLng = centerLng - (cols / 2) * lngStep

  const features: GridCellFeature[] = []

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const north = startLat - row * latStep
      const south = startLat - (row + 1) * latStep
      const west = startLng + col * lngStep
      const east = startLng + (col + 1) * lngStep
      const id = row * cols + col
      const cellKey = `${getColumnLabel(col)}${row + 1}`
      const cellCenterLng = west + lngStep / 2
      const cellCenterLat = south + latStep / 2

      if (!isPointOnCaribbeanLand([cellCenterLng, cellCenterLat])) {
        continue
      }

      features.push({
        type: 'Feature',
        id,
        properties: {
          cellId: cellKey,
          cellKey,
          cellLabel: cellKey,
          centerLng: cellCenterLng,
          centerLat: cellCenterLat,
          latIndex: row,
          lngIndex: col,
        },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [west, north],
              [east, north],
              [east, south],
              [west, south],
              [west, north],
            ],
          ],
        },
      })
    }
  }

  return {
    type: 'FeatureCollection',
    features,
  }
}
