import type {
  AIInsight,
  BoundsTuple,
  HistoricalAnalog,
  RegionInsightMetrics,
  RiskBand,
  RiskProfile,
} from './types'

export type ConfidenceBand = 'Low' | 'Medium' | 'High'
export type TerrainPositionBand = 'valley' | 'lowland' | 'mid-slope' | 'ridge'

export interface TerrainSummaryStats {
  min: number
  max: number
  mean: number
}

export interface TerrainSummaryCoverage {
  landCoveragePct: number
}

export interface TerrainSummaryRecord {
  tileName: string
  stats: TerrainSummaryStats
  coverage: TerrainSummaryCoverage
  positionBand?: TerrainPositionBand
  narrative?: string
}

export interface NearestSurgeStation {
  stationId: number
  distanceKm: number
  rp1Bestfit: number
  rp10Bestfit: number
  rp50Bestfit: number
  rp100Bestfit: number
  rp100Lower5: number
  rp100Upper95: number
}

export interface StormAggregate {
  distinctStormCount: number
  strongestWindKt?: number
  mostRecentStormYear?: number
}

export interface RiskProfileInput {
  terrain?: TerrainSummaryRecord
  nearestSurge?: NearestSurgeStation
  storms?: StormAggregate
  populationDensityPerSqKm?: number
  estimatedPopulation?: number
  builtUpPct?: number
  waterPct?: number
  wetlandPct?: number
  mangrovePct?: number
  analysisAreaSqKm?: number
  confidenceNotes: string[]
}

interface DriverContribution {
  label: string
  weight: number
}

export function round(value: number, digits = 1) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function toRadians(value: number) {
  return (value * Math.PI) / 180
}

export function haversineDistanceKm(
  [originLng, originLat]: [number, number],
  [targetLng, targetLat]: [number, number],
) {
  const earthRadiusKm = 6371
  const dLat = toRadians(targetLat - originLat)
  const dLng = toRadians(targetLng - originLng)
  const lat1 = toRadians(originLat)
  const lat2 = toRadians(targetLat)

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return earthRadiusKm * c
}

export function estimateBoundsAreaSqKm(bounds: BoundsTuple) {
  const [[west, south], [east, north]] = bounds
  const midLat = (south + north) / 2
  const widthKm = haversineDistanceKm([west, midLat], [east, midLat])
  const heightKm = haversineDistanceKm([west, south], [west, north])
  return widthKm * heightKm
}

export function deriveTileName([lng, lat]: [number, number]) {
  const latLabel = `${Math.floor(Math.abs(lat))}${lat >= 0 ? 'N' : 'S'}`
  const lonLabel = `${Math.ceil(Math.abs(lng))}${lng <= 0 ? 'W' : 'E'}`
  return `${latLabel}_${lonLabel}`
}

export function inferTerrainPositionBand(
  terrain: Pick<TerrainSummaryRecord, 'stats'>,
): TerrainPositionBand {
  const mean = terrain.stats.mean
  const relief = Math.max(terrain.stats.max - terrain.stats.min, 0)
  const normalizedMean =
    relief > 0 ? clamp((mean - terrain.stats.min) / relief, 0, 1) : 0.5

  if (mean <= 25 && normalizedMean <= 0.32) {
    return 'valley'
  }

  if (mean <= 55 || normalizedMean <= 0.45) {
    return 'lowland'
  }

  if (mean >= 120 && normalizedMean >= 0.68) {
    return 'ridge'
  }

  return 'mid-slope'
}

export function buildMetrics(input: {
  terrain?: TerrainSummaryRecord
  nearestSurge?: NearestSurgeStation
  storms?: StormAggregate
  populationDensityPerSqKm?: number
  estimatedPopulation?: number
  builtUpPct?: number
  treeCoverPct?: number
  croplandPct?: number
  waterPct?: number
  wetlandPct?: number
  mangrovePct?: number
  analysisAreaSqKm?: number
}): RegionInsightMetrics {
  const terrain = input.terrain
  const surge = input.nearestSurge
  const storms = input.storms
  const feasibleSlopeAngleDeg =
    terrain && input.analysisAreaSqKm !== undefined
      ? estimateFeasibleSlopeAngleDeg(
          terrain.stats.max - terrain.stats.min,
          input.analysisAreaSqKm,
        )
      : undefined

  return {
    elevationMinM: terrain ? round(terrain.stats.min) : undefined,
    elevationMeanM: terrain ? round(terrain.stats.mean) : undefined,
    elevationMaxM: terrain ? round(terrain.stats.max) : undefined,
    reliefM: terrain ? round(terrain.stats.max - terrain.stats.min) : undefined,
    feasibleSlopeAngleDeg,
    landCoveragePct: terrain
      ? round(terrain.coverage.landCoveragePct)
      : undefined,
    nearestSurgeStationKm: surge ? round(surge.distanceKm) : undefined,
    surgeRp1M: surge ? round(surge.rp1Bestfit, 2) : undefined,
    surgeRp10M: surge ? round(surge.rp10Bestfit, 2) : undefined,
    surgeRp50M: surge ? round(surge.rp50Bestfit, 2) : undefined,
    surgeRp100M: surge ? round(surge.rp100Bestfit, 2) : undefined,
    nearbyStormCount: storms?.distinctStormCount,
    strongestNearbyWindKt: storms?.strongestWindKt,
    mostRecentNearbyStormYear: storms?.mostRecentStormYear,
    populationDensityPerSqKm:
      input.populationDensityPerSqKm !== undefined
        ? round(input.populationDensityPerSqKm)
        : undefined,
    estimatedPopulation:
      input.estimatedPopulation !== undefined
        ? Math.round(input.estimatedPopulation)
        : undefined,
    builtUpPct:
      input.builtUpPct !== undefined ? round(input.builtUpPct, 1) : undefined,
    treeCoverPct:
      input.treeCoverPct !== undefined
        ? round(input.treeCoverPct, 1)
        : undefined,
    croplandPct:
      input.croplandPct !== undefined ? round(input.croplandPct, 1) : undefined,
    waterPct:
      input.waterPct !== undefined ? round(input.waterPct, 1) : undefined,
    wetlandPct:
      input.wetlandPct !== undefined ? round(input.wetlandPct, 1) : undefined,
    mangrovePct:
      input.mangrovePct !== undefined ? round(input.mangrovePct, 1) : undefined,
  }
}

export function buildRiskProfile({
  terrain,
  nearestSurge,
  storms,
  populationDensityPerSqKm,
  estimatedPopulation,
  builtUpPct,
  waterPct,
  wetlandPct,
  mangrovePct,
  analysisAreaSqKm,
  confidenceNotes,
}: RiskProfileInput): RiskProfile {
  const terrainDriver = buildTerrainContribution(terrain)
  const landslideDriver = buildLandslideContribution({
    terrain,
    storms,
    analysisAreaSqKm,
  })
  const surgeDriver = buildSurgeContribution(nearestSurge, terrain)
  const stormDriver = buildStormContribution(storms)
  const exposureDriver = buildExposureContribution({
    populationDensityPerSqKm,
    estimatedPopulation,
  })
  const landCoverDriver = buildLandCoverContribution({
    builtUpPct,
    waterPct,
    wetlandPct,
    mangrovePct,
  })

  const drivers = [
    terrainDriver,
    landslideDriver,
    surgeDriver,
    stormDriver,
    exposureDriver,
    landCoverDriver,
  ].filter((driver): driver is DriverContribution => driver.weight > 0)

  const score = clamp(
    Math.round(drivers.reduce((total, driver) => total + driver.weight, 0)),
    0,
    100,
  )

  const band: RiskBand =
    score >= 75
      ? 'Severe'
      : score >= 55
        ? 'High'
        : score >= 30
          ? 'Moderate'
          : 'Low'

  const confidence: ConfidenceBand =
    confidenceNotes.length >= 3
      ? 'Low'
      : confidenceNotes.length >= 1
        ? 'Medium'
        : 'High'

  return {
    band,
    score,
    topDrivers: drivers
      .sort((left, right) => right.weight - left.weight)
      .slice(0, 3)
      .map((driver) => driver.label),
    confidence,
  }
}

export function buildDeterministicInsight(input: {
  label: string
  riskProfile: RiskProfile
  metrics: RegionInsightMetrics
}): AIInsight {
  const { label, riskProfile, metrics } = input
  const driver =
    riskProfile.topDrivers[0] ?? 'Available hazard signals are mixed.'

  const terrainFocus =
    metrics.elevationMeanM !== undefined && metrics.reliefM !== undefined
      ? metrics.elevationMeanM <= 30
        ? `Lower terrain around ${metrics.elevationMeanM.toFixed(1)} m and only ${metrics.reliefM.toFixed(1)} m of relief make water harder to shed quickly.`
        : metrics.elevationMeanM >= 120
          ? `Higher ground around ${metrics.elevationMeanM.toFixed(1)} m gives runoff more room to drain away before pooling.`
          : `Terrain around ${metrics.elevationMeanM.toFixed(1)} m with ${metrics.reliefM.toFixed(1)} m of relief keeps flood behavior mixed rather than extreme.`
      : 'Terrain coverage is limited, so this reading leans more on coastal and storm context.'

  const surgeFocus =
    metrics.surgeRp100M !== undefined && metrics.elevationMeanM !== undefined
      ? metrics.surgeRp100M > metrics.elevationMeanM
        ? `Estimated severe-storm water levels can exceed the local average ground height, which raises overtopping risk.`
        : metrics.elevationMeanM - metrics.surgeRp100M <= 1
          ? `Estimated severe-storm water levels sit close to average ground height, so low pockets can still flood during stronger events.`
          : riskProfile.band === 'High' || riskProfile.band === 'Severe'
            ? `Estimated severe-storm water levels remain below average ground height, but other signals still keep overall risk elevated.`
            : `Estimated severe-storm water levels remain below average ground height, which helps limit direct inundation pressure.`
      : ''

  const exposureFocus =
    metrics.estimatedPopulation !== undefined && metrics.estimatedPopulation > 0
      ? `Around ${metrics.estimatedPopulation.toLocaleString()} people are estimated inside the analysis window, so exposure rises if flooding does occur.`
      : ''

  const landCoverFocus =
    metrics.builtUpPct !== undefined || metrics.waterPct !== undefined
      ? `WorldCover shows ${metrics.builtUpPct ?? 0}% built-up cover and ${metrics.waterPct ?? 0}% open water in the analysis window.`
      : ''

  const landslideFocus =
    metrics.feasibleSlopeAngleDeg !== undefined
      ? metrics.feasibleSlopeAngleDeg >= 20
        ? `A feasible local slope of about ${metrics.feasibleSlopeAngleDeg.toFixed(1)} degrees indicates meaningful slope-failure potential if soils become saturated.`
        : metrics.feasibleSlopeAngleDeg >= 12
          ? `A feasible local slope of about ${metrics.feasibleSlopeAngleDeg.toFixed(1)} degrees indicates moderate landslide sensitivity during prolonged heavy rain.`
          : `A feasible local slope of about ${metrics.feasibleSlopeAngleDeg.toFixed(1)} degrees suggests lower landslide pressure than steeper nearby terrain.`
      : ''

  return {
    headline: truncateText(
      `${label} is currently assessed as ${riskProfile.band.toLowerCase()} flood risk.`,
      160,
    ),
    explanation: truncateText(
      [driver, terrainFocus, landslideFocus, surgeFocus, exposureFocus]
        .concat(landCoverFocus)
        .filter(Boolean)
        .join(' '),
      320,
    ),
    caution:
      riskProfile.confidence !== 'High'
        ? truncateText(
            `Confidence is ${riskProfile.confidence.toLowerCase()} because some supporting terrain, land-cover, surge, or population data is sparse or unavailable.`,
            220,
          )
        : undefined,
  }
}

function buildTerrainContribution(
  terrain: TerrainSummaryRecord | undefined,
): DriverContribution {
  if (!terrain) {
    return { label: 'Terrain data is unavailable for this area.', weight: 0 }
  }

  const mean = terrain.stats.mean
  const relief = Math.max(terrain.stats.max - terrain.stats.min, 0)
  const positionBand = terrain.positionBand ?? inferTerrainPositionBand(terrain)
  const elevationPenalty =
    24 * (1 - clamp(Math.log1p(Math.max(mean, 0)) / Math.log1p(250), 0, 1))
  const reliefPenalty = 9 * (1 - clamp(relief / 180, 0, 1))
  const coastalMixPenalty =
    2 * (1 - clamp(terrain.coverage.landCoveragePct / 100, 0, 1))
  const bandPenalty =
    positionBand === 'valley'
      ? 10
      : positionBand === 'lowland'
        ? 6
        : positionBand === 'mid-slope'
          ? 3
          : 0

  const weight = clamp(
    elevationPenalty + reliefPenalty + coastalMixPenalty + bandPenalty,
    0,
    45,
  )

  return {
    label: describeTerrainContribution({ mean, relief, positionBand }),
    weight,
  }
}

function buildSurgeContribution(
  nearestSurge: NearestSurgeStation | undefined,
  terrain: TerrainSummaryRecord | undefined,
): DriverContribution {
  if (!nearestSurge) {
    return { label: 'No nearby surge station is available.', weight: 0 }
  }

  const baseScore = clamp((nearestSurge.rp100Bestfit / 2.5) * 15, 0, 15)
  const proximityScore = clamp(
    ((180 - nearestSurge.distanceKm) / 180) * 4,
    0,
    4,
  )
  const overtoppingScore =
    terrain && nearestSurge.rp100Bestfit > terrain.stats.mean
      ? clamp(
          ((nearestSurge.rp100Bestfit - terrain.stats.mean) / 2.5) * 6,
          0,
          6,
        )
      : 0
  const weight = clamp(baseScore + proximityScore + overtoppingScore, 0, 25)

  const isDistantStation = nearestSurge.distanceKm > 180
  const isLowSurgeSignal = nearestSurge.rp100Bestfit < 0.8

  return {
    label:
      overtoppingScore > 0 && terrain
        ? `Estimated 100-year surge of ${round(nearestSurge.rp100Bestfit, 2)} m can exceed the cell's average ground height of ${round(terrain.stats.mean)} m.`
        : isDistantStation || isLowSurgeSignal
          ? `Estimated 100-year surge of ${round(nearestSurge.rp100Bestfit, 2)} m suggests limited direct coastal pressure at this point, especially with the nearest station ${round(nearestSurge.distanceKm)} km away.`
          : `Estimated 100-year surge of ${round(nearestSurge.rp100Bestfit, 2)} m still adds coastal flood pressure near this location.`,
    weight,
  }
}

function buildStormContribution(
  storms: StormAggregate | undefined,
): DriverContribution {
  if (!storms?.distinctStormCount) {
    return {
      label: 'Historical storm tracks are sparse near this area.',
      weight: 0,
    }
  }

  const countScore = clamp((storms.distinctStormCount / 8) * 8, 0, 8)
  const windScore =
    storms.strongestWindKt !== undefined
      ? clamp(((storms.strongestWindKt - 45) / 80) * 10, 0, 10)
      : 0
  const recencyScore =
    storms.mostRecentStormYear !== undefined
      ? clamp(((storms.mostRecentStormYear - 1980) / 45) * 2, 0, 2)
      : 0
  const totalWeight = clamp(countScore + windScore + recencyScore, 0, 20)

  const stormRecencyLabel =
    storms.mostRecentStormYear !== undefined
      ? ` Most recent nearby year in the record is ${storms.mostRecentStormYear}.`
      : ''

  const label =
    totalWeight >= 12
      ? storms.strongestWindKt !== undefined
        ? `${storms.distinctStormCount} historical storms passed nearby, including intense winds up to ${storms.strongestWindKt} kt.${stormRecencyLabel}`
        : `${storms.distinctStormCount} historical storms passed nearby, indicating repeated storm exposure.${stormRecencyLabel}`
      : storms.strongestWindKt !== undefined && storms.strongestWindKt < 70
        ? `${storms.distinctStormCount} historical storms passed nearby, but peak recorded winds were lower at ${storms.strongestWindKt} kt.${stormRecencyLabel}`
        : `${storms.distinctStormCount} historical storms passed nearby.${stormRecencyLabel}`

  return {
    label,
    weight: totalWeight,
  }
}

function buildExposureContribution(input: {
  populationDensityPerSqKm?: number
  estimatedPopulation?: number
}): DriverContribution {
  const density = input.populationDensityPerSqKm
  const estimatedPopulation = input.estimatedPopulation

  if (density === undefined && estimatedPopulation === undefined) {
    return { label: 'No local exposure estimate is available.', weight: 0 }
  }

  const densityScore =
    density !== undefined ? clamp((Math.log10(density + 1) / 3.5) * 6, 0, 6) : 0
  const populationScore =
    estimatedPopulation !== undefined
      ? clamp((Math.log10(estimatedPopulation + 1) / 5) * 4, 0, 4)
      : 0

  const details = [
    estimatedPopulation !== undefined
      ? `about ${Math.round(estimatedPopulation).toLocaleString()} people`
      : null,
    density !== undefined ? `${round(density)} people per sq km` : null,
  ].filter(Boolean)

  const totalWeight = clamp(densityScore + populationScore, 0, 10)

  const label =
    totalWeight >= 6
      ? `Local exposure is elevated because the analysis window contains ${details.join(' and ')}.`
      : totalWeight >= 2
        ? `Local exposure is moderate, with the analysis window containing ${details.join(' and ')}.`
        : `Local exposure appears limited, with the analysis window containing ${details.join(' and ')}.`

  return {
    label,
    weight: totalWeight,
  }
}

function buildLandCoverContribution(input: {
  builtUpPct?: number
  waterPct?: number
  wetlandPct?: number
  mangrovePct?: number
}): DriverContribution {
  const aquaticPct =
    (input.waterPct ?? 0) + (input.wetlandPct ?? 0) + (input.mangrovePct ?? 0)
  const builtUpPct = input.builtUpPct ?? 0

  if (
    input.builtUpPct === undefined &&
    input.waterPct === undefined &&
    input.wetlandPct === undefined &&
    input.mangrovePct === undefined
  ) {
    return { label: 'No land-cover signal is available.', weight: 0 }
  }

  const aquaticScore = clamp((aquaticPct / 35) * 6, 0, 6)
  const builtScore = clamp((builtUpPct / 45) * 5, 0, 5)
  const combinedScore = clamp((aquaticPct * builtUpPct) / 120, 0, 4)
  const weight = clamp(aquaticScore + builtScore + combinedScore, 0, 15)

  const label =
    aquaticPct >= 20 && builtUpPct >= 15
      ? `WorldCover shows ${round(aquaticPct, 1)}% water, wetland, or mangrove cover near ${round(builtUpPct, 1)}% built-up land, which raises exposure around flood-prone surfaces.`
      : aquaticPct >= 20
        ? `WorldCover shows ${round(aquaticPct, 1)}% water, wetland, or mangrove cover, indicating flood-sensitive land-cover nearby.`
        : builtUpPct >= 15
          ? `WorldCover shows ${round(builtUpPct, 1)}% built-up land, increasing exposure where flooding occurs.`
          : `WorldCover land-cover mix does not add a strong flood-exposure signal here.`

  return { label, weight }
}

function buildLandslideContribution(input: {
  terrain?: TerrainSummaryRecord
  storms?: StormAggregate
  analysisAreaSqKm?: number
}): DriverContribution {
  const terrain = input.terrain
  if (!terrain || input.analysisAreaSqKm === undefined) {
    return {
      label: 'Landslide signal is unavailable without terrain slope context.',
      weight: 0,
    }
  }

  const relief = Math.max(terrain.stats.max - terrain.stats.min, 0)
  const slopeAngleDeg = estimateFeasibleSlopeAngleDeg(
    relief,
    input.analysisAreaSqKm,
  )
  const slopeScore = clamp(((slopeAngleDeg - 6) / 22) * 10, 0, 10)
  const reliefScore = clamp(((relief - 35) / 160) * 3, 0, 3)
  const stormTriggerScore =
    input.storms && input.storms.distinctStormCount > 0
      ? clamp((input.storms.distinctStormCount / 10) * 1.5, 0, 1.5)
      : 0

  const totalWeight = clamp(slopeScore + reliefScore + stormTriggerScore, 0, 15)

  const label =
    slopeAngleDeg >= 22
      ? `Estimated feasible slope near ${round(slopeAngleDeg, 1)} degrees suggests elevated landslide potential, especially under saturated ground conditions.`
      : slopeAngleDeg >= 14
        ? `Estimated feasible slope near ${round(slopeAngleDeg, 1)} degrees indicates moderate landslide susceptibility during heavy rain periods.`
        : `Estimated feasible slope near ${round(slopeAngleDeg, 1)} degrees indicates lower landslide susceptibility than steeper terrain.`

  return {
    label,
    weight: totalWeight,
  }
}

function describeTerrainContribution(input: {
  mean: number
  relief: number
  positionBand: TerrainPositionBand
}) {
  const meanLabel = round(input.mean)
  const reliefLabel = round(input.relief)

  switch (input.positionBand) {
    case 'valley':
      return `Valley-like terrain keeps this cell close to its local low ground, with mean elevation around ${meanLabel} m and only ${reliefLabel} m of relief.`
    case 'lowland':
      return `Low-lying terrain around ${meanLabel} m makes this cell more prone to standing water than nearby higher ground.`
    case 'ridge':
      return `Ridge-like higher ground around ${meanLabel} m reduces how easily water can pool in this cell.`
    default:
      return `Mid-slope terrain around ${meanLabel} m with ${reliefLabel} m of relief gives this cell moderate drainage support.`
  }
}

function estimateFeasibleSlopeAngleDeg(reliefM: number, areaSqKm: number) {
  const normalizedAreaSqKm = Math.max(areaSqKm, 0.05)
  const characteristicRunM = Math.max(
    Math.sqrt(normalizedAreaSqKm) * 1000 * 0.4,
    200,
  )
  const angleRad = Math.atan2(Math.max(reliefM, 0), characteristicRunM)
  return round((angleRad * 180) / Math.PI, 1)
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
