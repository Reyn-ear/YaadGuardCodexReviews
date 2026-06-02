import { CARIBBEAN_COUNTRY_BOUNDARIES } from '../map/caribbeanCountryBoundaries'

export const WORLDPOP_DATASET_ALIAS = 'G2_CN_POP_2024_100m'

interface WorldPopRecord {
  id?: string
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

interface WorldPopApiResponse {
  data?: WorldPopRecord[]
}

export async function syncWorldPopMetadata(env: CloudflareBindings) {
  if (!env.DB) {
    throw new Error('Missing Cloudflare D1 binding: DB')
  }

  const countries = CARIBBEAN_COUNTRY_BOUNDARIES.map(({ iso3, name }) => ({
    iso3,
    name,
  }))
  const imported: string[] = []
  const missing: string[] = []

  for (const country of countries) {
    const record = await fetchWorldPopRecord(country.iso3)

    if (!record) {
      missing.push(country.iso3)
      continue
    }

    await upsertWorldPopRecord(env, record, country.name)
    imported.push(country.iso3)
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

  const payload = (await response.json()) as WorldPopApiResponse
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
  env: CloudflareBindings,
  record: WorldPopRecord,
  countryName: string,
) {
  const worldpopId = Number(record.id)
  const populationYear = Number(record.popyear)

  if (!Number.isInteger(worldpopId) || !Number.isInteger(populationYear)) {
    throw new Error(`WorldPop record for ${record.iso3} has invalid ids`)
  }

  await env.DB?.prepare(
    `
      INSERT INTO worldpop_country_payloads (
        worldpop_id,
        dataset_alias,
        iso3,
        country_name,
        continent,
        population_year,
        source_date,
        payload,
        synced_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(worldpop_id) DO UPDATE SET
        dataset_alias = excluded.dataset_alias,
        iso3 = excluded.iso3,
        country_name = excluded.country_name,
        continent = excluded.continent,
        population_year = excluded.population_year,
        source_date = excluded.source_date,
        payload = excluded.payload,
        synced_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    `,
  )
    .bind(
      worldpopId,
      WORLDPOP_DATASET_ALIAS,
      record.iso3,
      record.country ?? countryName,
      record.continent ?? null,
      populationYear,
      record.date ?? null,
      JSON.stringify(record),
    )
    .run()
}
