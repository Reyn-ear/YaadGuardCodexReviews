import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

export interface WorldPopRecord {
  id: string
  title?: string
  desc?: string
  doi?: string
  date?: string
  popyear?: string
  citation?: string
  data_file?: string
  archive?: string
  public?: string
  source?: string
  data_format?: string
  author_email?: string
  author_name?: string
  maintainer_name?: string
  maintainer_email?: string
  project?: string
  category?: string
  gtype?: string
  continent?: string
  country?: string
  iso3?: string
  files?: string[]
  url_img?: string
  organisation?: string
  license?: string
  url_summary?: string
}

export const worldpopCountryPayloads = sqliteTable(
  'worldpop_country_payloads',
  {
    worldpopId: integer('worldpop_id').primaryKey(),
    datasetAlias: text('dataset_alias').notNull(),
    iso3: text('iso3').notNull(),
    countryName: text('country_name').notNull(),
    continent: text('continent'),
    populationYear: integer('population_year').notNull(),
    sourceDate: text('source_date'),
    payload: text('payload', { mode: 'json' })
      .$type<WorldPopRecord>()
      .notNull(),
    syncedAt: text('synced_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    createdAt: text('created_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: text('updated_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    uniqueIndex('worldpop_country_payloads_dataset_iso3_year_idx').on(
      table.datasetAlias,
      table.iso3,
      table.populationYear,
    ),
    index('worldpop_country_payloads_iso3_year_idx').on(
      table.iso3,
      table.populationYear,
    ),
    index('worldpop_country_payloads_dataset_idx').on(table.datasetAlias),
  ],
)

export type WorldpopCountryPayloadRow =
  typeof worldpopCountryPayloads.$inferSelect
export type NewWorldpopCountryPayloadRow =
  typeof worldpopCountryPayloads.$inferInsert
