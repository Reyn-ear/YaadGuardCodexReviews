import { integer, real, sqliteTable } from 'drizzle-orm/sqlite-core'

export const surgeReturnLevels = sqliteTable('surge_return_levels', {
  stationId: integer('station_id').primaryKey(),
  lat: real('lat').notNull(),
  lon: real('lon').notNull(),
  rp1Bestfit: real('rp1_bestfit').notNull(),
  rp1Lower5: real('rp1_lower5').notNull(),
  rp1Upper95: real('rp1_upper95').notNull(),
  rp2Bestfit: real('rp2_bestfit').notNull(),
  rp2Lower5: real('rp2_lower5').notNull(),
  rp2Upper95: real('rp2_upper95').notNull(),
  rp5Bestfit: real('rp5_bestfit').notNull(),
  rp5Lower5: real('rp5_lower5').notNull(),
  rp5Upper95: real('rp5_upper95').notNull(),
  rp10Bestfit: real('rp10_bestfit').notNull(),
  rp10Lower5: real('rp10_lower5').notNull(),
  rp10Upper95: real('rp10_upper95').notNull(),
  rp25Bestfit: real('rp25_bestfit').notNull(),
  rp25Lower5: real('rp25_lower5').notNull(),
  rp25Upper95: real('rp25_upper95').notNull(),
  rp50Bestfit: real('rp50_bestfit').notNull(),
  rp50Lower5: real('rp50_lower5').notNull(),
  rp50Upper95: real('rp50_upper95').notNull(),
  rp75Bestfit: real('rp75_bestfit').notNull(),
  rp75Lower5: real('rp75_lower5').notNull(),
  rp75Upper95: real('rp75_upper95').notNull(),
  rp100Bestfit: real('rp100_bestfit').notNull(),
  rp100Lower5: real('rp100_lower5').notNull(),
  rp100Upper95: real('rp100_upper95').notNull(),
  evaScale: real('eva_scale').notNull(),
  evaShape: real('eva_shape').notNull(),
  evaLoc: real('eva_loc').notNull(),
})

export type SurgeReturnLevelRow = typeof surgeReturnLevels.$inferSelect
export type NewSurgeReturnLevelRow = typeof surgeReturnLevels.$inferInsert
