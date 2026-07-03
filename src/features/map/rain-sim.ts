import type { Feature, Polygon } from 'geojson'
import type { BoundsTuple } from './types'

const SUB_GRID_SIZE = 20
const TICK_HR = 5 / 60
const SPILL_PASSES = 4
const BASE_ABSORB_MHR = 0.008

export interface SimConfig {
  subGridSize?: number
  tickHr?: number
  spillPasses?: number
  baseAbsorbMhr?: number
  soilMoistureRatio?: number
}

export interface StormCategory {
  label: string
  mmPerHr: number
  color: string
}

export const STORM_CATEGORIES: StormCategory[] = [
  { label: 'No Rain', mmPerHr: 0, color: '#94a3b8' },
  { label: 'Tropical Storm', mmPerHr: 13, color: '#60d4ff' },
  { label: 'Cat 1', mmPerHr: 25, color: '#4ade80' },
  { label: 'Cat 2', mmPerHr: 50, color: '#fbbf24' },
  { label: 'Cat 3', mmPerHr: 75, color: '#f97316' },
  { label: 'Cat 4', mmPerHr: 100, color: '#fb7185' },
  { label: 'Cat 5', mmPerHr: 178, color: '#f43f5e' },
]

export function getCategory(mmPerHr: number): StormCategory {
  for (let i = STORM_CATEGORIES.length - 1; i >= 0; i--) {
    if (mmPerHr >= STORM_CATEGORIES[i].mmPerHr) return STORM_CATEGORIES[i]
  }
  return STORM_CATEGORIES[0]
}

export interface SubGridElevation {
  elevations: number[]
  bounds: BoundsTuple
  subGridSize: number
}

function tick(
  elevations: number[],
  depths: Float32Array,
  mmPerHr: number,
  config: SimConfig,
  subGridSize: number,
): void {
  const count = subGridSize * subGridSize
  const addM = (mmPerHr / 1000) * TICK_HR
  const absorb =
    (config.baseAbsorbMhr ?? BASE_ABSORB_MHR) *
    (1 - (config.soilMoistureRatio ?? 0.3)) *
    TICK_HR

  for (let i = 0; i < count; i++) {
    depths[i] = Math.max(0, depths[i] + addM - absorb)
  }

  for (let pass = 0; pass < SPILL_PASSES; pass++) {
    for (let row = 0; row < subGridSize; row++) {
      for (let col = 0; col < subGridSize; col++) {
        const i = row * subGridSize + col
        const surf = elevations[i] + depths[i]

        const neighbours: number[] = []
        if (row > 0) neighbours.push((row - 1) * subGridSize + col)
        if (row < subGridSize - 1)
          neighbours.push((row + 1) * subGridSize + col)
        if (col > 0) neighbours.push(row * subGridSize + (col - 1))
        if (col < subGridSize - 1)
          neighbours.push(row * subGridSize + (col + 1))

        for (const j of neighbours) {
          const nSurf = elevations[j] + depths[j]
          if (surf > nSurf) {
            const move = Math.min((surf - nSurf) * 0.25, depths[i])
            depths[i] -= move
            depths[j] += move
          }
        }
      }
    }
  }

  for (let i = 0; i < count; i++) {
    if (elevations[i] <= 0) depths[i] = 0
  }
}

export function computeWaterDepths(
  elevations: number[],
  mmPerHr: number,
  config: SimConfig = {},
  ticks = 120,
): number[] {
  const subGridSize = config.subGridSize ?? SUB_GRID_SIZE
  const count = subGridSize * subGridSize

  if (elevations.length !== count) {
    console.warn(
      `Elevation array length ${elevations.length} does not match expected ${count}`,
    )
  }

  if (mmPerHr === 0) return new Array<number>(count).fill(0)

  const depths = new Float32Array(count)
  const effectiveConfig = {
    ...config,
    baseAbsorbMhr: config.baseAbsorbMhr ?? BASE_ABSORB_MHR,
    spillPasses: config.spillPasses ?? SPILL_PASSES,
  }

  for (let t = 0; t < ticks; t++) {
    tick(elevations, depths, mmPerHr, effectiveConfig, subGridSize)
  }

  return Array.from(depths)
}

export function buildWaterDepthFeatures({
  bounds,
  waterDepths,
  subGridSize = SUB_GRID_SIZE,
}: {
  bounds: BoundsTuple
  waterDepths: number[]
  subGridSize?: number
}): Feature<Polygon>[] {
  const [[west, south], [east, north]] = bounds
  const latStep = (north - south) / subGridSize
  const lngStep = (east - west) / subGridSize
  const features: Feature<Polygon>[] = []

  for (let row = 0; row < subGridSize; row++) {
    for (let col = 0; col < subGridSize; col++) {
      const idx = row * subGridSize + col
      const depth = waterDepths[idx] ?? 0

      if (depth <= 0) continue

      const cellNorth = north - row * latStep
      const cellSouth = cellNorth - latStep
      const cellWest = west + col * lngStep
      const cellEast = cellWest + lngStep

      features.push({
        type: 'Feature',
        properties: { depth },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [cellWest, cellSouth],
              [cellEast, cellSouth],
              [cellEast, cellNorth],
              [cellWest, cellNorth],
              [cellWest, cellSouth],
            ],
          ],
        },
      })
    }
  }

  return features
}
