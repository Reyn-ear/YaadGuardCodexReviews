import { sql } from 'drizzle-orm'
import { drizzle } from '../../db/client.ts'
import type { WorldPopRecord } from '../../db/schema/worldpop.ts'
import { worldpopCountryPayloads } from '../../db/schema/worldpop.ts'
import { CARIBBEAN_COUNTRY_BOUNDARIES } from '../../src/features/map/caribbeanCountryBoundaries.ts'

export const WORLDPOP_DATASET_ALIAS = 'G2_CN_POP_2024_100m'

interface WorldPopApiResponse {
  data?: WorldPopRecord[]
}

export async function syncWorldPopMetadata(env: CloudflareBindings) {
  if (!env.DB) {
    throw new Error('Missing Cloudflare D1 binding: DB')
  }
  const db = env.DB

  const countries = CARIBBEAN_COUNTRY_BOUNDARIES.map(({ iso3, name }) => ({
    iso3,
    name,
  }))
  const imported: string[] = []
  const missing: string[] = []

  const results = await Promise.all(
    countries.map(async (country) => {
      const record = await fetchWorldPopRecord(country.iso3)

      if (!record) {
        return { iso3: country.iso3, status: 'missing' as const }
      }

      await upsertWorldPopRecord(db, record, country.name)
      return { iso3: country.iso3, status: 'imported' as const }
    }),
  )

  for (const result of results) {
    if (result.status === 'imported') {
      imported.push(result.iso3)
    } else {
      missing.push(result.iso3)
    }
  }

  return {
    datasetAlias: WORLDPOP_DATASET_ALIAS,
    importedCountries: imported,
    missingCountries: missing,
  }
}

async function fetchWorldPopRecord(iso3: string) {
  const url = new URL(
    `https://hub.worldpop.org/rest/data/pop/${WORLDPOP_DATASET_ALIAS}`,
  )
  url.searchParams.set('iso3', iso3)

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Yaad Guard Cloudflare ingestion worker',
    },
  })

  if (!response.ok) {
    throw new Error(
      `WorldPop metadata request failed for ${iso3}: ${response.status} ${response.statusText}`,
    )
  }

  const payload: WorldPopApiResponse = await response.json()
  const records = Array.isArray(payload.data) ? payload.data : []
  const usable = records.find(
    (record) =>
      record.id &&
      record.iso3 &&
      record.popyear &&
      Array.isArray(record.files) &&
      record.files.some((file) => typeof file === 'string' && file.length > 0),
  )

  return usable ?? null
}

async function upsertWorldPopRecord(
  db: D1Database,
  record: WorldPopRecord,
  countryName: string,
) {
  const worldpopId = Number(record.id)
  const populationYear = Number(record.popyear)
  const iso3 = record.iso3

  if (
    !Number.isInteger(worldpopId) ||
    !Number.isInteger(populationYear) ||
    !iso3
  ) {
    throw new Error(`WorldPop record for ${record.iso3} has invalid ids`)
  }

  try {
    await drizzle(db)
      .insert(worldpopCountryPayloads)
      .values({
        worldpopId,
        datasetAlias: WORLDPOP_DATASET_ALIAS,
        iso3,
        countryName: record.country ?? countryName,
        continent: record.continent ?? null,
        populationYear,
        sourceDate: record.date ?? null,
        payload: record,
      })
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
  } catch (error) {
    if (!isMissingWorldPopPayloadsTableError(error)) {
      throw error
    }

    throw new Error(
      'Failed to write WorldPop metadata. Confirm D1 migrations have created worldpop_country_payloads.',
      { cause: error },
    )
  }
}

function isMissingWorldPopPayloadsTableError(error: unknown) {
  if (!(error instanceof Error)) {
    return false
  }

  return error.message.includes('no such table: worldpop_country_payloads')
}
