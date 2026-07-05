import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { deriveTileName } from './insightMath'
import { readGeneratedJson } from './runtimeData.server'
import type { BoundsTuple } from './types'

const inputSchema = z.object({
  bounds: z.tuple([
    z.tuple([z.number(), z.number()]),
    z.tuple([z.number(), z.number()]),
  ]),
  subGridSize: z.number().min(1).max(100).default(20),
})

const elevationGridSchema = z.object({
  elevations: z.array(z.number().nullable()),
  subGridSize: z.number().min(1).max(100).optional(),
  bounds: inputSchema.shape.bounds.optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
})

function sampleIndexedGrid(
  grid: z.infer<typeof elevationGridSchema>,
  requestedBounds: BoundsTuple,
  subGridSize: number,
) {
  if (!grid.bounds || !grid.width || !grid.height) return undefined
  const [[gridWest, gridSouth], [gridEast, gridNorth]] = grid.bounds
  const [[west, south], [east, north]] = requestedBounds
  const elevations: number[] = []

  for (let row = 0; row < subGridSize; row += 1) {
    const lat = north - ((row + 0.5) / subGridSize) * (north - south)
    const sourceRow = Math.max(
      0,
      Math.min(
        grid.height - 1,
        Math.floor(((gridNorth - lat) / (gridNorth - gridSouth)) * grid.height),
      ),
    )
    for (let column = 0; column < subGridSize; column += 1) {
      const lng = west + ((column + 0.5) / subGridSize) * (east - west)
      const sourceColumn = Math.max(
        0,
        Math.min(
          grid.width - 1,
          Math.floor(((lng - gridWest) / (gridEast - gridWest)) * grid.width),
        ),
      )
      elevations.push(
        grid.elevations[sourceRow * grid.width + sourceColumn] ?? 0,
      )
    }
  }
  return elevations
}

function gridCellKey(bounds: BoundsTuple, subGridSize: number) {
  const [[west, south], [east, north]] = bounds
  const centerLng = (west + east) / 2
  const centerLat = (south + north) / 2

  return {
    center: [centerLng, centerLat] satisfies [number, number],
    key: `cell_${centerLat.toFixed(4)}_${centerLng.toFixed(4)}_${subGridSize}`,
  }
}

async function loadGeneratedElevationGrid(
  bounds: BoundsTuple,
  subGridSize: number,
) {
  const { center, key } = gridCellKey(bounds, subGridSize)
  const tileName = deriveTileName(center)
  const candidates = [
    `elevation-grids/${key}.json`,
    `elevation-grids/${tileName}/${key}.json`,
    `elevation-grids/${tileName}.json`,
    `terrain-grids/${key}.json`,
    `terrain-grids/${tileName}/${key}.json`,
  ]

  const payloads = await Promise.all(
    candidates.map((candidate) =>
      readGeneratedJson(candidate, elevationGridSchema),
    ),
  )
  const payload = payloads.find((candidatePayload) => candidatePayload)

  if (payload) {
    const sampled = sampleIndexedGrid(payload, bounds, subGridSize)
    return sampled ? { elevations: sampled, subGridSize, bounds } : payload
  }

  return undefined
}

export const fetchSubGridElevations = createServerFn({ method: 'POST' })
  .inputValidator(inputSchema)
  .handler(async ({ data }) => {
    const { bounds, subGridSize } = data
    const grid = await loadGeneratedElevationGrid(bounds, subGridSize)

    if (grid) {
      return {
        success: true,
        elevations: grid.elevations,
        subGridSize: grid.subGridSize ?? subGridSize,
        bounds: grid.bounds ?? bounds,
      }
    }

    return {
      success: false,
      error: 'Generated elevation grid not found',
      elevations: [],
    }
  })
