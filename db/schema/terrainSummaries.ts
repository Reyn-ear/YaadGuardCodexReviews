import {
  index,
  integer,
  primaryKey,
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

export const terrainAnalysisCells = sqliteTable(
  'terrain_analysis_cells',
  {
    cellId: text('cell_id').notNull(),
    sourceRelease: text('source_release').notNull(),
    west: real('west').notNull(),
    south: real('south').notNull(),
    east: real('east').notNull(),
    north: real('north').notNull(),
    centerLng: real('center_lng').notNull(),
    centerLat: real('center_lat').notNull(),
    minElevationM: real('min_elevation_m'),
    maxElevationM: real('max_elevation_m'),
    meanElevationM: real('mean_elevation_m'),
    reliefM: real('relief_m'),
    landCoveragePct: real('land_coverage_pct').notNull(),
    validSampleCount: integer('valid_sample_count').notNull(),
    sampleCount: integer('sample_count').notNull(),
    medianSlopeDeg: real('median_slope_deg'),
    terrainPosition: real('terrain_position'),
    detailObjectKey: text('detail_object_key').notNull(),
    createdAt: text('created_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.cellId, table.sourceRelease],
      name: 'terrain_analysis_cells_pk',
    }),
    index('terrain_analysis_cells_release_idx').on(table.sourceRelease),
    index('terrain_analysis_cells_center_idx').on(
      table.centerLng,
      table.centerLat,
    ),
    index('terrain_analysis_cells_bounds_idx').on(
      table.west,
      table.east,
      table.south,
      table.north,
    ),
  ],
)

export type TerrainSummaryRow = typeof terrainSummaries.$inferSelect
export type NewTerrainSummaryRow = typeof terrainSummaries.$inferInsert
export type TerrainAnalysisCellRow = typeof terrainAnalysisCells.$inferSelect
export type NewTerrainAnalysisCellRow = typeof terrainAnalysisCells.$inferInsert
