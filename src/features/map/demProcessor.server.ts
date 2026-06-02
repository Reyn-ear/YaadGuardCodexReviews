import { env } from 'cloudflare:workers'
import { z } from 'zod'
import type { BoundsTuple } from './types'

const elevationGridSchema = z.object({
  ok: z.boolean().optional(),
  elevations: z.array(z.number()),
  subGridSize: z.number(),
  bounds: z.tuple([
    z.tuple([z.number(), z.number()]),
    z.tuple([z.number(), z.number()]),
  ]),
  source: z.string().optional(),
  processedAt: z.string().optional(),
})

const terrainSummarySchema = z.object({
  ok: z.boolean().optional(),
  tileName: z.string(),
  stats: z.object({
    min: z.number(),
    max: z.number(),
    mean: z.number(),
  }),
  coverage: z.object({
    landCoveragePct: z.number(),
  }),
  source: z.string().optional(),
  processedAt: z.string().optional(),
})

const populationSummarySchema = z.object({
  ok: z.boolean().optional(),
  count: z.number(),
  density: z.number().optional(),
  iso3: z.string(),
  sourceYear: z.number().optional(),
  source: z.string().optional(),
  processedAt: z.string().optional(),
})

const landCoverSummarySchema = z.object({
  ok: z.boolean().optional(),
  classes: z.object({
    treeCoverPct: z.number().optional(),
    shrublandPct: z.number().optional(),
    grasslandPct: z.number().optional(),
    croplandPct: z.number().optional(),
    builtUpPct: z.number().optional(),
    bareSparsePct: z.number().optional(),
    snowIcePct: z.number().optional(),
    waterPct: z.number().optional(),
    wetlandPct: z.number().optional(),
    mangrovePct: z.number().optional(),
    mossLichenPct: z.number().optional(),
  }),
  validPixelCount: z.number(),
  source: z.string().optional(),
  processedAt: z.string().optional(),
})

export async function processDemElevationGrid(
  bounds: BoundsTuple,
  subGridSize: number,
) {
  const processor = getDemProcessor()
  if (!processor) {
    return undefined
  }

  const response = await processor.fetch('https://processor/elevation-grid', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bounds, subGridSize }),
  })

  if (!response.ok) {
    throw new Error(
      `DEM elevation processor failed: ${response.status} ${response.statusText}`,
    )
  }

  return elevationGridSchema.parse(await response.json())
}

export async function processDemTerrainSummary(
  tileName: string,
  bounds: BoundsTuple,
) {
  const processor = getDemProcessor()
  if (!processor) {
    return undefined
  }

  const response = await processor.fetch('https://processor/terrain-summary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tileName, bounds }),
  })

  if (!response.ok) {
    throw new Error(
      `DEM terrain summary processor failed: ${response.status} ${response.statusText}`,
    )
  }

  return terrainSummarySchema.parse(await response.json())
}

export async function processWorldPopPopulationSummary(input: {
  iso3: string
  bounds: BoundsTuple
  rasterUrl: string
  sourceYear?: number
}) {
  const processor = getDemProcessor()
  if (!processor) {
    return undefined
  }

  const response = await processor.fetch(
    'https://processor/population-summary',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )

  if (!response.ok) {
    throw new Error(
      `WorldPop processor failed: ${response.status} ${response.statusText}`,
    )
  }

  return populationSummarySchema.parse(await response.json())
}

export async function processWorldCoverLandCoverSummary(input: {
  bounds: BoundsTuple
}) {
  const processor = getDemProcessor()
  if (!processor) {
    return undefined
  }

  const response = await processor.fetch(
    'https://processor/landcover-summary',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )

  if (!response.ok) {
    throw new Error(
      `WorldCover processor failed: ${response.status} ${response.statusText}`,
    )
  }

  return landCoverSummarySchema.parse(await response.json())
}

export async function processDemTerrainTile(
  envOverride: CloudflareBindings,
  z: string,
  x: string,
  y: string,
) {
  const processor =
    envOverride.GEOSPATIAL_PROCESSOR?.getByName('copernicus-dem')
  if (!processor) {
    return undefined
  }

  const url = new URL('https://processor/terrain-tile')
  url.searchParams.set('z', z)
  url.searchParams.set('x', x)
  url.searchParams.set('y', y)

  const response = await processor.fetch(url.toString())
  if (!response.ok) {
    throw new Error(
      `DEM tile processor failed: ${response.status} ${response.statusText}`,
    )
  }

  return response.arrayBuffer()
}

function getDemProcessor() {
  return (env as Partial<CloudflareBindings>).GEOSPATIAL_PROCESSOR?.getByName(
    'copernicus-dem',
  )
}
