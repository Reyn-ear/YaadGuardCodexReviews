import {
  index,
  integer,
  real,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

export const terrainSummaries = sqliteTable(
  'terrain_summaries',
  {
    tileName: text('tile_name').primaryKey(),
    sourceKey: text('source_key').notNull(),
    minElevationM: real('min_elevation_m').notNull(),
    maxElevationM: real('max_elevation_m').notNull(),
    meanElevationM: real('mean_elevation_m').notNull(),
    landCoveragePct: real('land_coverage_pct').notNull(),
    pixelCount: integer('pixel_count').notNull(),
    validPixelCount: integer('valid_pixel_count').notNull(),
    landPixelCount: integer('land_pixel_count').notNull(),
    sourceUpdatedAt: text('source_updated_at'),
    createdAt: text('created_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: text('updated_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [index('terrain_summaries_source_key_idx').on(table.sourceKey)],
)

export type TerrainSummaryRow = typeof terrainSummaries.$inferSelect
export type NewTerrainSummaryRow = typeof terrainSummaries.$inferInsert
