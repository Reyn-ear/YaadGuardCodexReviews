#!/usr/bin/env node

function getArg(flag) {
  const index = process.argv.indexOf(flag)
  if (index === -1) {
    return undefined
  }

  return process.argv[index + 1]
}

function printUsage() {
  console.error(`Usage: npm run ingest:start -- [options]

Options:
  --url <worker-url>     Worker base URL (or set INGESTION_URL)
  --sources <ids>        Comma-separated source ids (default: all catalog sources)
  --run-id <id>          Optional run id override

Environment:
  INGESTION_URL          Deployed worker URL, e.g. https://yaad-guard.<account>.workers.dev
  INGESTION_ADMIN_TOKEN  Admin bearer token for /api/ingestion/start

Source ids: T-01, T-09, H-01, H-12, E-02
`)
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printUsage()
  process.exit(0)
}

const baseUrl = getArg('--url') ?? process.env.INGESTION_URL
const token = process.env.INGESTION_ADMIN_TOKEN
const sourcesArg = getArg('--sources')
const runId = getArg('--run-id')

if (!baseUrl || !token) {
  printUsage()
  console.error('\nMissing INGESTION_URL/--url or INGESTION_ADMIN_TOKEN.')
  process.exit(1)
}

const body = {}
if (sourcesArg) {
  body.sourceIds = sourcesArg
    .split(',')
    .map((sourceId) => sourceId.trim())
    .filter(Boolean)
}
if (runId) {
  body.runId = runId
}

const response = await fetch(
  `${baseUrl.replace(/\/$/, '')}/api/ingestion/start`,
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  },
)

const payload = await response.json().catch(() => null)

if (!response.ok) {
  console.error(
    JSON.stringify(
      {
        status: response.status,
        statusText: response.statusText,
        body: payload,
      },
      null,
      2,
    ),
  )
  process.exit(1)
}

console.log(JSON.stringify(payload, null, 2))
