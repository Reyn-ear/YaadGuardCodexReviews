#!/usr/bin/env node

import { createReadStream, existsSync, statSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = resolve(
  process.env.TERRAIN_ROOT ?? '/Volumes/Games/InitToWinit26-terrain',
)
const releaseArg = process.argv[2]
const port = Number(process.env.TERRAIN_PREVIEW_PORT ?? 4174)
const excludedTileZoom = '13'

if (!releaseArg) {
  console.error(
    'Usage: npm run terrain:preview-local -- /Volumes/Games/.../release-directory',
  )
  process.exit(2)
}

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error('TERRAIN_PREVIEW_PORT must be a valid TCP port')
  process.exit(2)
}

const release = resolve(releaseArg)
const scriptDirectory = dirname(fileURLToPath(import.meta.url))
if (release !== root && !release.startsWith(`${root}${sep}`)) {
  console.error(`Release directory must be under ${root}`)
  process.exit(2)
}

function requireDirectory(relativePath) {
  const directory = resolve(release, relativePath)
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    console.error(`Missing required directory: ${directory}`)
    process.exit(2)
  }
}

function requireFile(relativePath) {
  const file = resolve(release, relativePath)
  if (!existsSync(file) || !statSync(file).isFile()) {
    console.error(`Missing required file: ${file}`)
    process.exit(2)
  }
}

async function hasPublishableTile(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      if (
        entry.name === excludedTileZoom &&
        directory === resolve(release, 'tiles')
      ) {
        continue
      }
      if (await hasPublishableTile(path)) return true
    } else if (entry.isFile() && entry.name.endsWith('.webp')) {
      return true
    }
  }

  return false
}

function contentTypeFor(path) {
  switch (extname(path).toLowerCase()) {
    case '.json':
      return 'application/json'
    case '.webp':
      return 'image/webp'
    case '.png':
      return 'image/png'
    default:
      return 'application/octet-stream'
  }
}

function safeFilePath(relativePath) {
  const file = resolve(release, relativePath)
  if (file !== release && !file.startsWith(`${release}${sep}`)) {
    return null
  }

  return file
}

function resolveRequestPath(pathname) {
  const tileMatch = pathname.match(/^\/api\/tiles\/([^/]+)\/([^/]+)\/([^/]+)$/)
  if (tileMatch) {
    const [, z, x, y] = tileMatch
    if (z === excludedTileZoom) return null
    const yClean = y.replace(/\.(?:png|webp)$/i, '')

    return `tiles/${z}/${x}/${yClean}.webp`
  }

  for (const prefix of [
    '/data/',
    '/tiles/',
    '/elevation-grids/',
    '/terrain-summaries/',
    '/provenance/',
  ]) {
    if (pathname.startsWith(prefix)) {
      return pathname.slice(prefix === '/data/' ? 6 : 1)
    }
  }

  return null
}

function sendText(response, status, body) {
  response.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'text/plain; charset=utf-8',
  })
  response.end(body)
}

requireDirectory('tiles')
requireDirectory('elevation-grids')
requireFile('provenance/source-manifest.json')
execFileSync(
  'node',
  [join(scriptDirectory, 'validate-terrain-release.mjs'), release],
  {
    stdio: 'inherit',
  },
)

if (!(await hasPublishableTile(resolve(release, 'tiles')))) {
  console.error(
    `Missing non-z${excludedTileZoom} WebP tiles in ${release}/tiles`,
  )
  process.exit(2)
}

const server = createServer((request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')

  if (request.method === 'OPTIONS') {
    response.writeHead(204)
    response.end()
    return
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD, OPTIONS' })
    response.end('Method not allowed')
    return
  }

  const url = new URL(request.url ?? '/', `http://${request.headers.host}`)
  if (url.pathname === '/') {
    sendText(
      response,
      200,
      [
        'Local terrain preview server is running.',
        '',
        `Release: ${release}`,
        `Tile URL: http://localhost:${port}/api/tiles/{z}/{x}/{y}.webp`,
        `z${excludedTileZoom} tiles are intentionally excluded for now.`,
      ].join('\n'),
    )
    return
  }

  const relativePath = resolveRequestPath(url.pathname)
  if (!relativePath) {
    console.log(`${request.method} ${url.pathname} -> 404`)
    sendText(response, 404, 'Terrain artifact not found')
    return
  }

  const file = safeFilePath(relativePath)
  if (!file || !existsSync(file) || !statSync(file).isFile()) {
    console.log(`${request.method} ${url.pathname} -> 404 ${relativePath}`)
    sendText(response, 404, 'Terrain artifact not found')
    return
  }

  console.log(`${request.method} ${url.pathname} -> 200 ${relativePath}`)

  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Type': contentTypeFor(file),
  })

  if (request.method === 'HEAD') {
    response.end()
    return
  }

  createReadStream(file).pipe(response)
})

server.listen(port, () => {
  console.log(`Local terrain preview: http://localhost:${port}`)
  console.log(`Serving release: ${release}`)
  console.log(`Tile URL: http://localhost:${port}/api/tiles/{z}/{x}/{y}.webp`)
  console.log(`z${excludedTileZoom} tiles are intentionally excluded for now.`)
  console.log(
    `Run the app with VITE_TERRAIN_TILE_URL=http://localhost:${port}/api/tiles/{z}/{x}/{y}.webp`,
  )
})
