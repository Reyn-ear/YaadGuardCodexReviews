import { z } from 'zod'

const lngLatSchema = z.tuple([z.number(), z.number()])

const boundsSchema = z.tuple([lngLatSchema, lngLatSchema])

export const regionInsightInputSchema = z.object({
  kind: z.enum(['cell', 'search']),
  label: z.string().trim().min(1),
  center: lngLatSchema,
  bounds: boundsSchema.optional(),
  gridCellId: z.string().trim().min(1).nullable().optional(),
})

const aiInsightSchema = z.object({
  headline: z.string().trim().min(1).max(160),
  explanation: z.string().trim().min(1).max(320),
  caution: z.string().trim().min(1).max(220).optional(),
})

export const regionInsightResponseSchema = z.object({
  riskProfile: z.object({
    band: z.enum(['Low', 'Moderate', 'High', 'Severe']),
    score: z.number().min(0).max(100),
    topDrivers: z.array(z.string()).max(3),
    confidence: z.enum(['Low', 'Medium', 'High']),
  }),
  aiInsight: aiInsightSchema,
  metrics: z.object({
    elevationMinM: z.number().optional(),
    elevationMeanM: z.number().optional(),
    elevationMaxM: z.number().optional(),
    reliefM: z.number().optional(),
    feasibleSlopeAngleDeg: z.number().optional(),
    landCoveragePct: z.number().optional(),
    nearestSurgeStationKm: z.number().optional(),
    surgeRp1M: z.number().optional(),
    surgeRp10M: z.number().optional(),
    surgeRp50M: z.number().optional(),
    surgeRp100M: z.number().optional(),
    nearbyStormCount: z.number().optional(),
    strongestNearbyWindKt: z.number().optional(),
    mostRecentNearbyStormYear: z.number().optional(),
    estimatedPopulation: z.number().optional(),
    populationDensityPerSqKm: z.number().optional(),
    builtUpPct: z.number().optional(),
    treeCoverPct: z.number().optional(),
    croplandPct: z.number().optional(),
    waterPct: z.number().optional(),
    wetlandPct: z.number().optional(),
    mangrovePct: z.number().optional(),
  }),
  historicalAnalog: z
    .object({
      label: z.string(),
      closestApproachKm: z.number(),
      peakWindKt: z.number().optional(),
      eventDate: z.string().optional(),
    })
    .optional(),
  dataQuality: z.object({
    terrainAvailable: z.boolean(),
    landCoverAvailable: z.boolean(),
    surgeAvailable: z.boolean(),
    stormHistoryAvailable: z.boolean(),
    confidenceNotes: z.array(z.string()),
  }),
})
