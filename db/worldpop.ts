import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { db } from './client'
import { worldpopCountryPayloads } from './schema'
import type { NewWorldpopCountryPayloadRow, WorldPopRecord } from './schema'

export const DEFAULT_COUNTRIES = [
  { iso3: 'ATG', country: 'Antigua and Barbuda' },
  { iso3: 'BHS', country: 'Bahamas' },
  { iso3: 'BRB', country: 'Barbados' },
  { iso3: 'CUB', country: 'Cuba' },
  { iso3: 'DMA', country: 'Dominica' },
  { iso3: 'DOM', country: 'Dominican Republic' },
  { iso3: 'GRD', country: 'Grenada' },
  { iso3: 'HTI', country: 'Haiti' },
  { iso3: 'JAM', country: 'Jamaica' },
  { iso3: 'KNA', country: 'Saint Kitts and Nevis' },
  { iso3: 'LCA', country: 'Saint Lucia' },
  { iso3: 'TTO', country: 'Trinidad and Tobago' },
  { iso3: 'VCT', country: 'Saint Vincent and the Grenadines' },
] as const

export type CaribbeanCountry = (typeof DEFAULT_COUNTRIES)[number]
type CaribbeanIso3 = CaribbeanCountry['iso3']

export function parseCountries(url: URL): CaribbeanCountry[] {
  const requested = url.searchParams.getAll('iso3')
  const values =
    requested.length > 0
      ? requested
          .flatMap((value) => value.split(','))
          .map((value) => value.trim().toUpperCase())
          .filter(Boolean)
      : DEFAULT_COUNTRIES.map((entry) => entry.iso3)

  const countryMap = new Map<string, CaribbeanCountry>(
    DEFAULT_COUNTRIES.map((entry): [string, CaribbeanCountry] => [
      entry.iso3,
      entry,
    ]),
  )
  const uniqueIso3 = Array.from(new Set(values))

  return uniqueIso3
    .filter((iso3): iso3 is CaribbeanIso3 => countryMap.has(iso3))
    .map((iso3) => countryMap.get(iso3))
    .filter((entry): entry is CaribbeanCountry => Boolean(entry))
}

export function parsePopulationYear(
  value: string | null | undefined,
): number | null {
  if (!value) {
    return null
  }

  const year = Number(value)
  return Number.isInteger(year) ? year : null
}

let schemaReady: Promise<void> | null = null

export async function ensureWorldpopSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await db.run(sql`
        CREATE TABLE IF NOT EXISTS worldpop_country_payloads (
          worldpop_id integer PRIMARY KEY NOT NULL,
          dataset_alias text NOT NULL,
          iso3 text NOT NULL,
          country_name text NOT NULL,
          continent text,
          population_year integer NOT NULL,
          source_date text,
          payload text NOT NULL,
          synced_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
          created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `)

      await db.run(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS worldpop_country_payloads_dataset_iso3_year_idx
        ON worldpop_country_payloads (dataset_alias, iso3, population_year)
      `)

      await db.run(sql`
        CREATE INDEX IF NOT EXISTS worldpop_country_payloads_iso3_year_idx
        ON worldpop_country_payloads (iso3, population_year DESC)
      `)

      await db.run(sql`
        CREATE INDEX IF NOT EXISTS worldpop_country_payloads_dataset_idx
        ON worldpop_country_payloads (dataset_alias)
      `)

      // D1/SQLite stores payload as JSON text; query-critical fields are indexed above.
    })()
  }

  await schemaReady
}

function toInsertableRecord(
  datasetAlias: string,
  record: WorldPopRecord,
): NewWorldpopCountryPayloadRow | null {
  const worldpopId = Number(record.id)
  const populationYear = parsePopulationYear(record.popyear)

  if (
    !Number.isInteger(worldpopId) ||
    !record.iso3 ||
    !record.country ||
    populationYear === null
  ) {
    return null
  }

  return {
    worldpopId,
    datasetAlias,
    iso3: record.iso3,
    countryName: record.country,
    continent: record.continent ?? null,
    populationYear,
    sourceDate: record.date ?? null,
    payload: record,
  }
}

export async function upsertWorldPopRecords(
  datasetAlias: string,
  records: WorldPopRecord[],
) {
  await ensureWorldpopSchema()

  const values = records
    .map((record) => toInsertableRecord(datasetAlias, record))
    .filter((record): record is NewWorldpopCountryPayloadRow => record !== null)

  if (values.length === 0) {
    return 0
  }

  await db
    .insert(worldpopCountryPayloads)
    .values(values)
    .onConflictDoUpdate({
      target: worldpopCountryPayloads.worldpopId,
      set: {
        datasetAlias: sql`excluded.dataset_alias`,
        iso3: sql`excluded.iso3`,
        countryName: sql`excluded.country_name`,
        continent: sql`excluded.continent`,
        populationYear: sql`excluded.population_year`,
        sourceDate: sql`excluded.source_date`,
        payload: sql`excluded.payload`,
        syncedAt: sql`CURRENT_TIMESTAMP`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      },
    })

  return values.length
}

export async function listPopulationRecords(
  datasetAlias: string,
  countries: string[],
  year: number | null,
) {
  await ensureWorldpopSchema()

  const conditions = [eq(worldpopCountryPayloads.datasetAlias, datasetAlias)]

  if (countries.length > 0) {
    conditions.push(inArray(worldpopCountryPayloads.iso3, countries))
  }

  if (year !== null) {
    conditions.push(eq(worldpopCountryPayloads.populationYear, year))
  }

  return db
    .select({
      worldpopId: worldpopCountryPayloads.worldpopId,
      datasetAlias: worldpopCountryPayloads.datasetAlias,
      iso3: worldpopCountryPayloads.iso3,
      country: worldpopCountryPayloads.countryName,
      continent: worldpopCountryPayloads.continent,
      populationYear: worldpopCountryPayloads.populationYear,
      sourceDate: worldpopCountryPayloads.sourceDate,
      syncedAt: worldpopCountryPayloads.syncedAt,
      payload: worldpopCountryPayloads.payload,
    })
    .from(worldpopCountryPayloads)
    .where(and(...conditions))
    .orderBy(
      asc(worldpopCountryPayloads.countryName),
      asc(worldpopCountryPayloads.populationYear),
    )
}

export async function listCountryCoverage() {
  await ensureWorldpopSchema()

  return db
    .select({
      iso3: worldpopCountryPayloads.iso3,
      country: worldpopCountryPayloads.countryName,
      minYear:
        sql<number>`min(${worldpopCountryPayloads.populationYear})`.mapWith(
          Number,
        ),
      maxYear:
        sql<number>`max(${worldpopCountryPayloads.populationYear})`.mapWith(
          Number,
        ),
      recordCount: sql<number>`count(*)`.mapWith(Number),
    })
    .from(worldpopCountryPayloads)
    .groupBy(worldpopCountryPayloads.iso3, worldpopCountryPayloads.countryName)
    .orderBy(asc(worldpopCountryPayloads.countryName))
}
