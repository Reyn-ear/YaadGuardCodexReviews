import { CARIBBEAN_CAMERA_BOUNDS } from './config'
import type { BoundsTuple, LngLatTuple, SearchResult } from './types'

export function isPointInBounds(
  [lng, lat]: LngLatTuple,
  [[west, south], [east, north]]: BoundsTuple = CARIBBEAN_CAMERA_BOUNDS,
) {
  return lng >= west && lng <= east && lat >= south && lat <= north
}

export function intersectBounds(
  [[westA, southA], [eastA, northA]]: BoundsTuple,
  [[westB, southB], [eastB, northB]]: BoundsTuple = CARIBBEAN_CAMERA_BOUNDS,
): BoundsTuple | null {
  const west = Math.max(westA, westB)
  const south = Math.max(southA, southB)
  const east = Math.min(eastA, eastB)
  const north = Math.min(northA, northB)

  if (west > east || south > north) {
    return null
  }

  return [
    [west, south],
    [east, north],
  ]
}

export function constrainSearchResult(
  result: SearchResult,
  cameraBounds: BoundsTuple = CARIBBEAN_CAMERA_BOUNDS,
): SearchResult | null {
  if (!isPointInBounds(result.center, cameraBounds)) {
    return null
  }

  if (!result.bounds) {
    return result
  }

  const bounds = intersectBounds(result.bounds, cameraBounds)
  return bounds ? { ...result, bounds } : { ...result, bounds: undefined }
}

export function serializeBoundsForGeocoder([
  [west, south],
  [east, north],
]: BoundsTuple = CARIBBEAN_CAMERA_BOUNDS) {
  return [west, south, east, north].join(',')
}
