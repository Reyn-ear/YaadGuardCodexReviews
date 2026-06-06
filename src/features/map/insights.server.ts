import { env } from 'cloudflare:workers'
import { drizzle } from '../../../db/client.ts'
import { regionInsightResponseSchema } from './contracts'
import {
  aggregateStorms,
  loadLandCoverData,
  loadNearestSurgeStation,
  loadPopulationData,
  loadStormRows,
  loadTerrainSummary,
  resolveAnalysisBounds,
  selectHistoricalAnalog,
} from './insightsData.server'
import {
  buildDeterministicInsight,
  buildMetrics,
  buildRiskProfile,
  estimateBoundsAreaSqKm,
  round,
} from './insightMath'
import type { RegionInsightInput, RegionInsightResponse } from './types'

export async function calculateRegionInsights(
  input: RegionInsightInput,
): Promise<RegionInsightResponse> {
  const confidenceNotes: string[] = []
  const analysisBounds = resolveAnalysisBounds(input)
  const analysisAreaSqKm = estimateBoundsAreaSqKm(analysisBounds)
  const db = env.DB ? drizzle(env.DB) : null

  const [
    terrainResult,
    nearestSurge,
    stormRows,
    populationData,
    landCoverData,
  ] = await Promise.all([
    loadTerrainSummary(input.center, analysisBounds, db).catch(() => undefined),
    loadNearestSurgeStation(input.center, db).catch(() => null),
    loadStormRows(input.center, db).catch(() => []),
    loadPopulationData(input.center, analysisBounds, db).catch(
      () => undefined,
    ),
    loadLandCoverData(input.center, analysisBounds).catch(() => undefined),
  ])

  const terrain = terrainResult?.record

  if (!terrain) {
    confidenceNotes.push(
      'No topographical summary was available for this location.',
    )
  } else if (terrainResult.precision === 'coarse') {
    confidenceNotes.push(
      'Terrain scoring used a source-backed coarse regional DEM summary for this location.',
    )
  }

  if (!nearestSurge) {
    confidenceNotes.push(
      'No nearby surge station was available for this location.',
    )
  } else if (nearestSurge.distanceKm > 120) {
    confidenceNotes.push(
      `Nearest surge station is ${round(nearestSurge.distanceKm)} km away, so coastal estimates are less precise.`,
    )
  }

  if (!populationData) {
    confidenceNotes.push(
      'Local population context could not be reliably determined for this analysis window.',
    )
  }

  if (!landCoverData) {
    confidenceNotes.push(
      'ESA WorldCover context could not be reliably determined for this analysis window.',
    )
  }

  const stormAggregate = aggregateStorms(stormRows)
  const historicalAnalog = selectHistoricalAnalog(stormRows)

  if (!stormAggregate.distinctStormCount) {
    confidenceNotes.push(
      'Historical storm coverage is sparse near this coordinate.',
    )
  }

  const metrics = buildMetrics({
    terrain,
    nearestSurge: nearestSurge ?? undefined,
    storms: stormAggregate,
    populationDensityPerSqKm: populationData?.density,
    estimatedPopulation: populationData?.count,
    builtUpPct: landCoverData?.builtUpPct,
    treeCoverPct: landCoverData?.treeCoverPct,
    croplandPct: landCoverData?.croplandPct,
    waterPct: landCoverData?.waterPct,
    wetlandPct: landCoverData?.wetlandPct,
    mangrovePct: landCoverData?.mangrovePct,
    analysisAreaSqKm,
  })

  const riskProfile = buildRiskProfile({
    terrain,
    nearestSurge: nearestSurge ?? undefined,
    storms: stormAggregate,
    populationDensityPerSqKm: populationData?.density,
    estimatedPopulation: populationData?.count,
    builtUpPct: landCoverData?.builtUpPct,
    waterPct: landCoverData?.waterPct,
    wetlandPct: landCoverData?.wetlandPct,
    mangrovePct: landCoverData?.mangrovePct,
    analysisAreaSqKm,
    confidenceNotes,
  })

  const aiInsight = buildDeterministicInsight({
    label: input.label,
    riskProfile,
    metrics,
  })

  return regionInsightResponseSchema.parse({
    riskProfile,
    aiInsight,
    metrics,
    historicalAnalog,
    dataQuality: {
      terrainAvailable: Boolean(terrain),
      landCoverAvailable: Boolean(landCoverData),
      surgeAvailable: Boolean(nearestSurge),
      stormHistoryAvailable: stormAggregate.distinctStormCount > 0,
      confidenceNotes,
    },
  })
}
