#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process'
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

const release = process.argv[2]
const runId =
  process.env.RUN_ID ??
  `terrain_${new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')}`
const bucket = process.env.R2_BUCKET ?? 'yaad-guard-artifacts'
const concurrency = process.env.R2_UPLOAD_CONCURRENCY ?? '100'
const chunkSize = Number(process.env.R2_BULK_CHUNK_SIZE ?? 1000)
const retrySeconds = Number(process.env.R2_BULK_RETRY_SECONDS ?? 60)
const dataPrefix = 'data'
const excludedTilePrefix = 'tiles/13/'

if (!release) {
  console.error('Usage: node scripts/publish-terrain-bulk.mjs RELEASE')
  process.exit(2)
}

const stateFile = join(release, '.publish', `${runId}.uploaded`)
mkdirSync(join(release, '.publish'), { recursive: true })
writeFileSync(stateFile, '', { flag: 'a' })
const uploaded = new Set(
  readFileSync(stateFile, 'utf8').split('\n').filter(Boolean),
)
const roots = [
  ['tiles', 'image/webp'],
  ['elevation-grids', 'application/json'],
  ['terrain-summaries', 'application/json'],
  ['provenance', 'application/json'],
]

execFileSync(
  'node',
  [join(process.cwd(), 'scripts', 'validate-terrain-release.mjs'), release],
  {
    stdio: 'inherit',
  },
)

function walk(directory, output = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) walk(path, output)
    else if (entry.isFile()) output.push(path)
  }
  return output
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

const temporary = mkdtempSync(join(tmpdir(), 'terrain-bulk-'))
try {
  for (const [root, contentType] of roots) {
    const directory = join(release, root)
    try {
      if (!statSync(directory).isDirectory()) continue
    } catch {
      continue
    }

    const pending = walk(directory)
      .map((file) => ({ file, relative: relative(release, file) }))
      .filter(
        ({ relative: path }) =>
          !uploaded.has(path) && !path.startsWith(excludedTilePrefix),
      )
      .sort((a, b) => a.relative.localeCompare(b.relative))

    for (let offset = 0; offset < pending.length; offset += chunkSize) {
      const chunk = pending.slice(offset, offset + chunkSize)
      const manifest = join(temporary, `${root}-${offset}.json`)
      writeFileSync(
        manifest,
        JSON.stringify(
          chunk.map(({ file, relative: path }) => ({
            key: `${dataPrefix}/${path}`,
            file,
          })),
        ),
      )

      while (true) {
        const result = spawnSync(
          join(process.cwd(), 'node_modules', '.bin', 'wrangler'),
          [
            'r2',
            'bulk',
            'put',
            bucket,
            '--filename',
            manifest,
            '--content-type',
            contentType,
            '--concurrency',
            concurrency,
            '--remote',
            '--force',
          ],
          { stdio: 'inherit' },
        )
        if (result.status === 0) break
        console.error(`Bulk batch failed; retrying in ${retrySeconds}s`)
        await sleep(retrySeconds * 1000)
      }

      appendFileSync(
        stateFile,
        `${chunk.map(({ relative: path }) => path).join('\n')}\n`,
      )
      console.log(
        `Recorded ${Math.min(offset + chunk.length, pending.length)} / ${pending.length} ${root}`,
      )
    }
  }

  execFileSync(
    'bash',
    [join(process.cwd(), 'scripts', 'publish-terrain.sh'), release],
    {
      env: { ...process.env, RUN_ID: runId, R2_UPLOAD_CONCURRENCY: '1' },
      stdio: 'inherit',
    },
  )
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
