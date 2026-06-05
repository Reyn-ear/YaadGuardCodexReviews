import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_MAP_CENTER, GRID_LAT_STEP, GRID_LNG_STEP } from './config'

const mockState = vi.hoisted(() => ({
  terrainRow: null as null | {
    tileName: string
    minElevationM: number
    maxElevationM: number
    meanElevationM: number
    landCoveragePct: number
  },
  worldpopRow: null as null | { populationYear: number; payload: { files?: string[] } },
  surgeRows: [] as Array<Record<string, number>>,
  stormRows: [] as Array<{
    stormId: string
    stormName: string
    stormDate: string
    status: string
    lat: number
    lon: number
    windKt: number
    pressureMb: number | null
  }>,
}))

vi.mock('geotiff', () => ({
  fromArrayBuffer: vi.fn(async () => {
    throw new Error('no raster')
  }),
  fromFile: vi.fn(async () => {
    throw new Error('no raster')
  }),
}))

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(async () => {
    throw new Error('missing file')
  }),
}))

vi.mock('../../../db/client.ts', async () => {
  const schema = await import('../../../db/schema/index.ts')

  class D1BindingError extends Error {}

  return {
    schema,
    D1BindingError,
    db: {
      query: {
        terrainSummaries: {
          findFirst: vi.fn(async () => mockState.terrainRow),
        },
        worldpopCountryPayloads: {
          findFirst: vi.fn(async () => mockState.worldpopRow),
        },
      },
      select: vi.fn((selection?: unknown) =>
        selection
          ? {
              from: vi.fn(() => ({
                where: vi.fn(async () => mockState.stormRows),
              })),
            }
          : {
              from: vi.fn(async () => mockState.surgeRows),
            },
      ),
    },
  }
})

describe('insightsData.server', () => {
  beforeEach(() => {
    mockState.terrainRow = null
    mockState.worldpopRow = null
    mockState.surgeRows = []
    mockState.stormRows = []
    delete process.env.TERRAIN_RASTER_PATH
    delete process.env.TERRAIN_RASTER_KEY
    delete process.env.SOURCE_BUCKET
    delete process.env.TOPOGRAPHICAL_SUMMARY_DIR
    delete process.env.WORLDPOP_RASTER_DIR
    delete process.env.WORLDPOP_RASTER_PREFIX
    delete process.env.AWS_ACCESS_KEY_ID
    delete process.env.AWS_SECRET_ACCESS_KEY
    delete process.env.S3_ENDPOINT
  })

  it('loads a coarse terrain summary from the database when present', async () => {
    mockState.terrainRow = {
      tileName: 'tile_1',
      minElevationM: 12,
      maxElevationM: 54,
      meanElevationM: 27,
      landCoveragePct: 91,
    }

    const { loadTerrainSummary } = await import('./insightsData.server')
    const result = await loadTerrainSummary(DEFAULT_MAP_CENTER, [
      [DEFAULT_MAP_CENTER[0] - GRID_LNG_STEP / 2, DEFAULT_MAP_CENTER[1] - GRID_LAT_STEP / 2],
      [DEFAULT_MAP_CENTER[0] + GRID_LNG_STEP / 2, DEFAULT_MAP_CENTER[1] + GRID_LAT_STEP / 2],
    ])

    expect(result).toMatchObject({
      precision: 'coarse',
      record: {
        tileName: 'tile_1',
        stats: {
          min: 12,
          max: 54,
          mean: 27,
        },
        coverage: {
          landCoveragePct: 91,
        },
      },
    })
  })

  it('returns undefined when no terrain data source is available', async () => {
    const { loadTerrainSummary } = await import('./insightsData.server')
    const result = await loadTerrainSummary(DEFAULT_MAP_CENTER, [
      [DEFAULT_MAP_CENTER[0] - GRID_LNG_STEP / 2, DEFAULT_MAP_CENTER[1] - GRID_LAT_STEP / 2],
      [DEFAULT_MAP_CENTER[0] + GRID_LNG_STEP / 2, DEFAULT_MAP_CENTER[1] + GRID_LAT_STEP / 2],
    ])

    expect(result).toBeUndefined()
  })

  it('returns null when no surge stations are available', async () => {
    const { loadNearestSurgeStation } = await import('./insightsData.server')
    const result = await loadNearestSurgeStation(DEFAULT_MAP_CENTER)

    expect(result).toBeNull()
  })

  it('returns zero-count storm aggregates and no analog when storm history is sparse', async () => {
    const { aggregateStorms, loadStormRows, selectHistoricalAnalog } = await import(
      './insightsData.server'
    )

    const rows = await loadStormRows(DEFAULT_MAP_CENTER)
    const aggregate = aggregateStorms(rows)

    expect(rows).toEqual([])
    expect(aggregate).toEqual({
      distinctStormCount: 0,
      strongestWindKt: undefined,
      mostRecentStormYear: undefined,
    })
    expect(selectHistoricalAnalog(rows)).toBeUndefined()
  })

  it('returns undefined population data when worldpop metadata or rasters are unavailable', async () => {
    const { loadPopulationData } = await import('./insightsData.server')
    const result = await loadPopulationData(DEFAULT_MAP_CENTER, [
      [DEFAULT_MAP_CENTER[0] - GRID_LNG_STEP / 2, DEFAULT_MAP_CENTER[1] - GRID_LAT_STEP / 2],
      [DEFAULT_MAP_CENTER[0] + GRID_LNG_STEP / 2, DEFAULT_MAP_CENTER[1] + GRID_LAT_STEP / 2],
    ])

    expect(result).toBeUndefined()
  })
})
