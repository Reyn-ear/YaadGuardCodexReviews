import {
  index,
  integer,
  real,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core'

export const stormHistoryPoints = sqliteTable(
  'storm_history_points',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    stormId: text('storm_id').notNull(),
    stormName: text('storm_name').notNull(),
    stormDate: text('storm_date').notNull(),
    stormTime: text('storm_time').notNull(),
    recordId: text('record_id'),
    status: text('status').notNull(),
    lat: real('lat').notNull(),
    lon: real('lon').notNull(),
    windKt: integer('wind_kt').notNull(),
    pressureMb: integer('pressure_mb'),
  },
  (table) => [
    index('storm_history_points_lat_lon_idx').on(table.lat, table.lon),
    index('storm_history_points_storm_id_date_time_idx').on(
      table.stormId,
      table.stormDate,
      table.stormTime,
    ),
  ],
)

export type StormHistoryPointRow = typeof stormHistoryPoints.$inferSelect
export type NewStormHistoryPointRow = typeof stormHistoryPoints.$inferInsert
