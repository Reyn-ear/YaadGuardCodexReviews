import { z } from 'zod'

const surgeRowSchema = z.object({
  stationId: z.number().int(),
  lat: z.number(),
  lon: z.number(),
  rp1Bestfit: z.number(),
  rp1Lower5: z.number(),
  rp1Upper95: z.number(),
  rp2Bestfit: z.number(),
  rp2Lower5: z.number(),
  rp2Upper95: z.number(),
  rp5Bestfit: z.number(),
  rp5Lower5: z.number(),
  rp5Upper95: z.number(),
  rp10Bestfit: z.number(),
  rp10Lower5: z.number(),
  rp10Upper95: z.number(),
  rp25Bestfit: z.number(),
  rp25Lower5: z.number(),
  rp25Upper95: z.number(),
  rp50Bestfit: z.number(),
  rp50Lower5: z.number(),
  rp50Upper95: z.number(),
  rp75Bestfit: z.number(),
  rp75Lower5: z.number(),
  rp75Upper95: z.number(),
  rp100Bestfit: z.number(),
  rp100Lower5: z.number(),
  rp100Upper95: z.number(),
  evaScale: z.number(),
  evaShape: z.number(),
  evaLoc: z.number(),
})

const surgeProcessorSchema = z.object({
  surgeRows: z.array(surgeRowSchema),
})

export async function importSurgeReturnLevels(
  env: CloudflareBindings,
  processorResult: unknown,
) {
  if (!env.DB) {
    throw new Error('Missing Cloudflare D1 binding: DB')
  }

  const { surgeRows } = surgeProcessorSchema.parse(processorResult)

  await env.DB.prepare('DELETE FROM surge_return_levels').run()

  const statement = env.DB.prepare(
    `
      INSERT INTO surge_return_levels (
        station_id,
        lat,
        lon,
        rp1_bestfit,
        rp1_lower5,
        rp1_upper95,
        rp2_bestfit,
        rp2_lower5,
        rp2_upper95,
        rp5_bestfit,
        rp5_lower5,
        rp5_upper95,
        rp10_bestfit,
        rp10_lower5,
        rp10_upper95,
        rp25_bestfit,
        rp25_lower5,
        rp25_upper95,
        rp50_bestfit,
        rp50_lower5,
        rp50_upper95,
        rp75_bestfit,
        rp75_lower5,
        rp75_upper95,
        rp100_bestfit,
        rp100_lower5,
        rp100_upper95,
        eva_scale,
        eva_shape,
        eva_loc
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  )

  const chunks = Array.from(
    { length: Math.ceil(surgeRows.length / 100) },
    (_, chunkIndex) =>
      surgeRows.slice(chunkIndex * 100, chunkIndex * 100 + 100),
  )

  await Promise.all(
    chunks.map((chunk) =>
      env.DB.batch(
        chunk.map((row) =>
          statement.bind(
            row.stationId,
            row.lat,
            row.lon,
            row.rp1Bestfit,
            row.rp1Lower5,
            row.rp1Upper95,
            row.rp2Bestfit,
            row.rp2Lower5,
            row.rp2Upper95,
            row.rp5Bestfit,
            row.rp5Lower5,
            row.rp5Upper95,
            row.rp10Bestfit,
            row.rp10Lower5,
            row.rp10Upper95,
            row.rp25Bestfit,
            row.rp25Lower5,
            row.rp25Upper95,
            row.rp50Bestfit,
            row.rp50Lower5,
            row.rp50Upper95,
            row.rp75Bestfit,
            row.rp75Lower5,
            row.rp75Upper95,
            row.rp100Bestfit,
            row.rp100Lower5,
            row.rp100Upper95,
            row.evaScale,
            row.evaShape,
            row.evaLoc,
          ),
        ),
      ),
    ),
  )

  return {
    importedSurgeStations: surgeRows.length,
  }
}
