#!/usr/bin/env node

import { execFileSync } from 'node:child_process'

function getArg(flag) {
  const index = process.argv.indexOf(flag)
  if (index === -1) {
    return undefined
  }

  return process.argv[index + 1]
}

function printUsage() {
  console.error(`Usage: npm run ingest:status -- [options]

Options:
  --run-id <id>   Show jobs for a specific run
  --local         Query local D1 instead of remote

Examples:
  npm run ingest:status
  npm run ingest:status -- --run-id run_20260101120000_ab12cd34
  npm run ingest:status -- --local
`)
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printUsage()
  process.exit(0)
}

const runId = getArg('--run-id')
const useLocal = process.argv.includes('--local')
const remoteFlag = useLocal ? [] : ['--remote']

let command
if (runId) {
  if (!/^[\w-]+$/.test(runId)) {
    console.error('Invalid --run-id. Use only letters, numbers, underscores, and hyphens.')
    process.exit(1)
  }

  command = `SELECT source_id, action, status, message, updated_at FROM ingestion_source_jobs WHERE run_id = '${runId}' ORDER BY updated_at`
} else {
  command =
    'SELECT run_id, status, source_ids, updated_at FROM ingestion_runs ORDER BY updated_at DESC LIMIT 10'
}

execFileSync(
  'npx',
  ['wrangler', 'd1', 'execute', 'yaad-guard', ...remoteFlag, '--command', command],
  { stdio: 'inherit' },
)
