import { createServerFn } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'
import { z } from 'zod'
import { drizzle } from '../../../db/client'
import { processDemElevationGrid } from './demProcessor.server'
import { deriveTileName } from './insightMath'
import { readGeneratedJson, writeGeneratedObject } from './runtimeData.server'
import { loadActiveElevationGrid } from './terrainRuntime.server'
import type { BoundsTuple } from './types'

const inputSchema = z.object({
  bounds: z.tuple([
    z.tuple([z.number(), z.number()]),
    z.tuple([z.number(), z.number()]),
  ]),
  subGridSize: z.number().min(1).max(100).default(20),
})

const elevationGridSchema = z.object({
  elevations: z.array(z.number()),
  subGridSize: z.number().min(1).max(100).optional(),
  bounds: inputSchema.shape.bounds.optional(),
})

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

  for (const candidate of candidates) {
    const payload = await readGeneratedJson(candidate, elevationGridSchema)
    if (payload) {
      return payload
    }
  }

  return undefined
}

export const fetchSubGridElevations = createServerFn({ method: 'POST' })
  .inputValidator(inputSchema)
  .handler(async ({ data }) => {
    const { bounds, subGridSize } = data
    const activeGrid = await loadActiveElevationGrid(
      bounds,
      subGridSize,
      env.DB ? drizzle(env.DB) : null,
    )
    if (activeGrid) {
      return {
        success: true,
        ...activeGrid,
      }
    }

    const grid = await loadGeneratedElevationGrid(bounds, subGridSize)

    if (grid) {
      return {
        success: true,
        elevations: grid.elevations,
        subGridSize: grid.subGridSize ?? subGridSize,
        bounds: grid.bounds ?? bounds,
      }
    }

    const processedGrid = await processDemElevationGrid(bounds, subGridSize)

    if (!processedGrid) {
      return {
        success: false,
        error: 'Generated elevation grid not found',
        elevations: [],
      }
    }

    const { center, key } = gridCellKey(bounds, subGridSize)
    const tileName = deriveTileName(center)
    await writeGeneratedObject(
      `elevation-grids/${tileName}/${key}.json`,
      JSON.stringify(processedGrid),
      { httpMetadata: { contentType: 'application/json' } },
    )

    return {
      success: true,
      elevations: processedGrid.elevations,
      subGridSize: processedGrid.subGridSize,
      bounds: processedGrid.bounds,
    }
  })
