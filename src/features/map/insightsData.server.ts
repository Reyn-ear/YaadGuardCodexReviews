import { and, between, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from '../../../db/client.ts'
import { stormHistoryPoints } from '../../../db/schema/stormHistory'
import { surgeReturnLevels } from '../../../db/schema/surgeReturnLevels'
import { terrainSummaries } from '../../../db/schema/terrainSummaries'
import { worldpopCountryPayloads } from '../../../db/schema/worldpop'
import { CARIBBEAN_COUNTRY_BOUNDARIES } from './caribbeanCountryBoundaries'
import { GRID_LAT_STEP, GRID_LNG_STEP } from './config'
import { pointInPolygon } from './geometry'
import {
  deriveTileName,
  estimateBoundsAreaSqKm,
  haversineDistanceKm,
  inferTerrainPositionBand,
  round,
} from './insightMath'
import type {
  NearestSurgeStation,
  StormAggregate,
  TerrainSummaryRecord,
} from './insightMath'
import { readGeneratedJson } from './runtimeData.server'
import type { BoundsTuple, HistoricalAnalog, RegionInsightInput } from './types'

const schema = {
  stormHistoryPoints,
  surgeReturnLevels,
  terrainSummaries,
  worldpopCountryPayloads,
}

const STORM_STATS_RADIUS_KM = 250
const STORM_ANALOG_RADIUS_KM = 450
const MAX_SEARCH_ANALYSIS_AREA_SQ_KM = 400
const DEFAULT_ANALYSIS_BOUNDS: BoundsTuple = [
  [-GRID_LNG_STEP / 2, -GRID_LAT_STEP / 2],
  [GRID_LNG_STEP / 2, GRID_LAT_STEP / 2],
]

const terrainSummarySchema = z.object({
  tileName: z.string(),
  stats: z.object({
    min: z.number(),
    max: z.number(),
    mean: z.number(),
  }),
  coverage: z.object({
    landCoveragePct: z.number(),
  }),
  narrative: z.string().optional(),
})

const populationSummarySchema = z.object({
  count: z.number(),
  density: z.number().optional(),
  iso3: z.string().optional(),
  sourceYear: z.number().optional(),
})

const landCoverSummarySchema = z.object({
  classes: z.object({
    treeCoverPct: z.number().optional(),
    croplandPct: z.number().optional(),
    builtUpPct: z.number().optional(),
    waterPct: z.number().optional(),
    wetlandPct: z.number().optional(),
    mangrovePct: z.number().optional(),
  }),
  validPixelCount: z.number().optional(),
  source: z.string().optional(),
})

interface StormRow {
  stormId: string
  stormName: string
  stormDate: string
  status: string
  lat: number
  lon: number
  windKt: number
  pressureMb: number | null
}

export interface StormCandidate extends StormRow {
  distanceKm: number
}

export interface TerrainLoadResult {
  record: TerrainSummaryRecord
  precision: 'cell' | 'coarse'
}

export interface PopulationLoadResult {
  count: number
  density: number
  iso3: string
  sourceYear?: number
}

export interface LandCoverLoadResult {
  treeCoverPct?: number
  croplandPct?: number
  builtUpPct?: number
  waterPct?: number
  wetlandPct?: number
  mangrovePct?: number
}

export interface HistoricalAnalogCandidate extends HistoricalAnalog {
  stormId: string
}

export interface NearestSurgeStationDetails extends NearestSurgeStation {
  rp1Lower5: number
  rp1Upper95: number
  rp2Bestfit: number
  rp2Lower5: number
  rp2Upper95: number
  rp5Bestfit: number
  rp5Lower5: number
  rp5Upper95: number
  rp10Lower5: number
  rp10Upper95: number
  rp25Bestfit: number
  rp25Lower5: number
  rp25Upper95: number
  rp50Lower5: number
  rp50Upper95: number
  rp75Bestfit: number
  rp75Lower5: number
  rp75Upper95: number
}

export async function loadPopulationData(
  center: [number, number],
  bounds: BoundsTuple,
  db: Db | null,
): Promise<PopulationLoadResult | undefined> {
  const country = resolveCountryByPoint(center)
  if (!country) {
    return undefined
  }

  const metadata = await loadWorldPopMetadata(country.iso3, db)
  const tileName = deriveTileName(center)
  const payload = await loadGeneratedPopulationSummary(
    country.iso3,
    tileName,
    bounds,
  )

  if (!payload) {
    return undefined
  }

  const areaSqKm = estimateBoundsAreaSqKm(bounds)

  return {
    count: payload.count,
    density: payload.density ?? (areaSqKm > 0 ? payload.count / areaSqKm : 0),
    iso3: payload.iso3 ?? country.iso3,
    sourceYear: payload.sourceYear ?? metadata?.populationYear ?? undefined,
  }
}

export async function loadLandCoverData(
  center: [number, number],
  bounds: BoundsTuple,
): Promise<LandCoverLoadResult | undefined> {
  const tileName = deriveTileName(center)
  const generatedPayload = await loadGeneratedLandCoverSummary(tileName, bounds)
  const payload =
    generatedPayload && (generatedPayload.validPixelCount ?? 0) > 0
      ? generatedPayload
      : undefined

  if (!payload || (payload.validPixelCount ?? 0) <= 0) {
    return undefined
  }

  return payload.classes
}

export async function loadNearestSurgeStation(
  center: [number, number],
  db: Db | null,
): Promise<NearestSurgeStationDetails | null> {
  if (!db) {
    return null
  }

  const rows = await db.select().from(schema.surgeReturnLevels)

  if (rows.length === 0) {
    return null
  }

  let best: NearestSurgeStationDetails | null = null

  for (const row of rows) {
    const distanceKm = haversineDistanceKm(center, [row.lon, row.lat])

    if (!best || distanceKm < best.distanceKm) {
      best = {
        stationId: row.stationId,
        distanceKm,
        rp1Bestfit: row.rp1Bestfit,
        rp1Lower5: row.rp1Lower5,
        rp1Upper95: row.rp1Upper95,
        rp2Bestfit: row.rp2Bestfit,
        rp2Lower5: row.rp2Lower5,
        rp2Upper95: row.rp2Upper95,
        rp5Bestfit: row.rp5Bestfit,
        rp5Lower5: row.rp5Lower5,
        rp5Upper95: row.rp5Upper95,
        rp10Bestfit: row.rp10Bestfit,
        rp10Lower5: row.rp10Lower5,
        rp10Upper95: row.rp10Upper95,
        rp25Bestfit: row.rp25Bestfit,
        rp25Lower5: row.rp25Lower5,
        rp25Upper95: row.rp25Upper95,
        rp50Bestfit: row.rp50Bestfit,
        rp50Lower5: row.rp50Lower5,
        rp50Upper95: row.rp50Upper95,
        rp75Bestfit: row.rp75Bestfit,
        rp75Lower5: row.rp75Lower5,
        rp75Upper95: row.rp75Upper95,
        rp100Bestfit: row.rp100Bestfit,
        rp100Lower5: row.rp100Lower5,
        rp100Upper95: row.rp100Upper95,
      }
    }
  }

  return best
}

export async function loadStormRows(
  center: [number, number],
  db: Db | null,
  radiusKm = STORM_ANALOG_RADIUS_KM,
): Promise<StormCandidate[]> {
  if (!db) {
    return []
  }

  const [lng, lat] = center
  const latDelta = radiusKm / 111
  const lonDelta =
    radiusKm / Math.max(111 * Math.cos((Math.abs(lat) * Math.PI) / 180), 15)

  const rows = await db
    .select({
      stormId: schema.stormHistoryPoints.stormId,
      stormName: schema.stormHistoryPoints.stormName,
      stormDate: schema.stormHistoryPoints.stormDate,
      status: schema.stormHistoryPoints.status,
      lat: schema.stormHistoryPoints.lat,
      lon: schema.stormHistoryPoints.lon,
      windKt: schema.stormHistoryPoints.windKt,
      pressureMb: schema.stormHistoryPoints.pressureMb,
    })
    .from(schema.stormHistoryPoints)
    .where(
      and(
        between(schema.stormHistoryPoints.lat, lat - latDelta, lat + latDelta),
        between(schema.stormHistoryPoints.lon, lng - lonDelta, lng + lonDelta),
      ),
    )

  return rows.reduce<StormCandidate[]>((candidates, row) => {
    const distanceKm = haversineDistanceKm(center, [row.lon, row.lat])

    if (distanceKm <= radiusKm) {
      candidates.push({ ...row, distanceKm })
    }

    return candidates
  }, [])
}

export function aggregateStorms(
  rows: StormCandidate[],
  radiusKm = STORM_STATS_RADIUS_KM,
): StormAggregate {
  const nearbyRows = rows.filter((row) => row.distanceKm <= radiusKm)
  const distinctStorms = new Set(nearbyRows.map((row) => row.stormId))

  const strongestNearbyWindKt = nearbyRows.reduce<number | undefined>(
    (highest, row) =>
      highest === undefined || row.windKt > highest ? row.windKt : highest,
    undefined,
  )

  const mostRecentNearbyStormYear = nearbyRows.reduce<number | undefined>(
    (latest, row) => {
      const year = Number(row.stormDate.slice(0, 4))
      if (!Number.isFinite(year)) {
        return latest
      }

      return latest === undefined || year > latest ? year : latest
    },
    undefined,
  )

  return {
    distinctStormCount: distinctStorms.size,
    strongestWindKt: strongestNearbyWindKt,
    mostRecentStormYear: mostRecentNearbyStormYear,
  }
}

export function listHistoricalAnalogs(
  rows: StormCandidate[],
  {
    radiusKm = STORM_ANALOG_RADIUS_KM,
    limit = 3,
  }: { radiusKm?: number; limit?: number } = {},
): HistoricalAnalogCandidate[] {
  const analogRows = rows.filter((row) => row.distanceKm <= radiusKm)

  if (analogRows.length === 0) {
    return []
  }

  const grouped = new Map<
    string,
    {
      stormName: string
      closestApproachKm: number
      peakWindKt?: number
      eventDate?: string
    }
  >()

  for (const row of analogRows) {
    const current = grouped.get(row.stormId)
    const nextPeakWind =
      current?.peakWindKt === undefined || row.windKt > current.peakWindKt
        ? row.windKt
        : current.peakWindKt
    const nextDate =
      !current || row.distanceKm < current.closestApproachKm
        ? row.stormDate
        : current.eventDate

    if (!current || row.distanceKm < current.closestApproachKm) {
      grouped.set(row.stormId, {
        stormName: row.stormName,
        closestApproachKm: row.distanceKm,
        peakWindKt: nextPeakWind,
        eventDate: nextDate,
      })
      continue
    }

    grouped.set(row.stormId, {
      ...current,
      peakWindKt: nextPeakWind,
    })
  }

  return Array.from(grouped.entries())
    .map(([stormId, summary]) => {
      const year = summary.eventDate?.slice(0, 4)
      const baseLabel =
        summary.stormName.toUpperCase() === 'UNNAMED'
          ? `Unnamed storm${year ? ` (${year})` : ''}`
          : summary.stormName

      return {
        stormId,
        label: `${baseLabel} [${stormId}]`,
        closestApproachKm: round(summary.closestApproachKm),
        peakWindKt: summary.peakWindKt,
        eventDate: summary.eventDate,
      }
    })
    .sort((left, right) => {
      if (left.closestApproachKm !== right.closestApproachKm) {
        return left.closestApproachKm - right.closestApproachKm
      }

      if ((left.peakWindKt ?? 0) !== (right.peakWindKt ?? 0)) {
        return (right.peakWindKt ?? 0) - (left.peakWindKt ?? 0)
      }

      return (right.eventDate ?? '').localeCompare(left.eventDate ?? '')
    })
    .slice(0, Math.max(limit, 0))
}

export function selectHistoricalAnalog(
  rows: StormCandidate[],
): HistoricalAnalog | undefined {
  return listHistoricalAnalogs(rows, { limit: 1 })[0]
}

export async function loadTerrainSummary(
  center: [number, number],
  db: Db | null,
): Promise<TerrainLoadResult | undefined> {
  const tileName = deriveTileName(center)
  const databasePayload = await loadDatabaseTerrainSummary(tileName, db)

  if (databasePayload) {
    return {
      record: {
        ...databasePayload,
        positionBand: inferTerrainPositionBand(databasePayload),
      },
      precision: 'coarse',
    }
  }

  const generatedPayload = await loadGeneratedTerrainSummary(tileName)
  if (generatedPayload) {
    return {
      record: {
        ...generatedPayload,
        positionBand: inferTerrainPositionBand(generatedPayload),
      },
      precision: 'coarse',
    }
  }

  return undefined
}

export function resolveAnalysisBounds(input: RegionInsightInput): BoundsTuple {
  if (input.bounds) {
    const normalized = normalizeBounds(input.bounds)
    if (estimateBoundsAreaSqKm(normalized) <= MAX_SEARCH_ANALYSIS_AREA_SQ_KM) {
      return normalized
    }
  }

  const [lng, lat] = input.center
  return [
    [lng + DEFAULT_ANALYSIS_BOUNDS[0][0], lat + DEFAULT_ANALYSIS_BOUNDS[0][1]],
    [lng + DEFAULT_ANALYSIS_BOUNDS[1][0], lat + DEFAULT_ANALYSIS_BOUNDS[1][1]],
  ]
}

export function normalizeBounds(bounds: BoundsTuple): BoundsTuple {
  const [[lngA, latA], [lngB, latB]] = bounds
  return [
    [Math.min(lngA, lngB), Math.min(latA, latB)],
    [Math.max(lngA, lngB), Math.max(latA, latB)],
  ]
}

async function loadWorldPopMetadata(iso3: string, db: Db | null) {
  if (!db) {
    return null
  }

  return db.query.worldpopCountryPayloads.findFirst({
    where: eq(schema.worldpopCountryPayloads.iso3, iso3),
    orderBy: (table, { desc }) => [desc(table.populationYear)],
  })
}

async function loadGeneratedPopulationSummary(
  iso3: string,
  tileName: string,
  bounds: BoundsTuple,
): Promise<z.infer<typeof populationSummarySchema> | undefined> {
  const cellKey = populationCellKey(bounds)
  const candidates = [
    `population/${iso3}/${tileName}/${cellKey}.json`,
    `population/${iso3.toLowerCase()}/${tileName}/${cellKey}.json`,
    `population/${iso3}/${tileName}.json`,
    `population/${iso3.toLowerCase()}/${tileName}.json`,
    `worldpop/${iso3}/${tileName}/${cellKey}.json`,
    `worldpop/${iso3.toLowerCase()}/${tileName}/${cellKey}.json`,
    `worldpop/${iso3}/${tileName}.json`,
    `worldpop/${iso3.toLowerCase()}/${tileName}.json`,
  ]

  const payloads = await Promise.all(
    candidates.map((key) => readGeneratedJson(key, populationSummarySchema)),
  )
  const payload = payloads.find((candidatePayload) => candidatePayload)

  if (payload) {
    return payload
  }

  return undefined
}

async function loadGeneratedLandCoverSummary(
  tileName: string,
  bounds: BoundsTuple,
): Promise<z.infer<typeof landCoverSummarySchema> | undefined> {
  const cellKey = populationCellKey(bounds)
  const candidates = [
    `landcover/${tileName}/${cellKey}.json`,
    `worldcover/${tileName}/${cellKey}.json`,
    `landcover/${tileName}.json`,
    `worldcover/${tileName}.json`,
  ]

  const payloads = await Promise.all(
    candidates.map((key) => readGeneratedJson(key, landCoverSummarySchema)),
  )
  const payload = payloads.find((candidatePayload) => candidatePayload)

  if (payload) {
    return payload
  }

  return undefined
}

function populationCellKey(bounds: BoundsTuple) {
  const [[west, south], [east, north]] = normalizeBounds(bounds)
  return [
    south.toFixed(4),
    west.toFixed(4),
    north.toFixed(4),
    east.toFixed(4),
  ].join('_')
}

async function loadDatabaseTerrainSummary(
  tileName: string,
  db: Db | null,
): Promise<TerrainSummaryRecord | undefined> {
  if (!db) {
    return undefined
  }

  const row = await db.query.terrainSummaries.findFirst({
    where: eq(schema.terrainSummaries.tileName, tileName),
  })

  if (!row) {
    return undefined
  }

  return {
    tileName: row.tileName,
    stats: {
      min: row.minElevationM,
      max: row.maxElevationM,
      mean: row.meanElevationM,
    },
    coverage: {
      landCoveragePct: row.landCoveragePct,
    },
  }
}

async function loadGeneratedTerrainSummary(
  tileName: string,
): Promise<TerrainSummaryRecord | undefined> {
  const candidates = [
    `topographical_summaries/${tileName}.json`,
    `terrain-summaries/${tileName}.json`,
    `terrain/${tileName}.json`,
  ]

  const payloads = await Promise.all(
    candidates.map((key) => readGeneratedJson(key, terrainSummarySchema)),
  )
  const payload = payloads.find((candidatePayload) => candidatePayload)

  if (payload) {
    return payload
  }

  return undefined
}

function resolveCountryByPoint(center: [number, number]) {
  for (const country of CARIBBEAN_COUNTRY_BOUNDARIES) {
    if (country.polygons.some((polygon) => pointInPolygon(center, polygon))) {
      return country
    }
  }

  return undefined
}
