#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import sharp from 'sharp'
import {
  TILE_SIZE,
  deriveTileName,
  encodeTerrainRgb,
  extractFirstFloatChannel,
  lngLatToTile,
  tileBounds3857,
} from './lib/terrain-artifacts.mjs'

const run = promisify(execFile)
const root = process.env.TERRAIN_ROOT ?? '/Volumes/Games/InitToWinit26-terrain'
const sourceDir =
  process.env.COPERNICUS_SOURCE_DIR ??
  join(root, 'sources/copernicus-dem-glo-30')
const vrt = join(sourceDir, 'copernicus-dem-glo-30-caribbean.vrt')
const output = resolve(
  process.argv.find((arg) => arg.startsWith('--output='))?.slice(9) ??
    join(root, 'generated/copernicus-glo30-caribbean'),
)
const smokeTest = process.argv.includes('--smoke-test')
const requestedMinZoom = Number(
  process.argv.find((arg) => arg.startsWith('--min-zoom='))?.slice(11) ?? 10,
)
const requestedMaxZoom = Number(
  process.argv.find((arg) => arg.startsWith('--max-zoom='))?.slice(11) ?? 13,
)
const minZoom = requestedMinZoom
const maxZoom = smokeTest ? requestedMinZoom : requestedMaxZoom
const gridSize = Number(
  process.argv.find((arg) => arg.startsWith('--grid-size='))?.slice(12) ?? 120,
)
const generationConcurrency = Number(
  process.argv.find((arg) => arg.startsWith('--concurrency='))?.slice(14) ?? 1,
)
const requestedBounds = process.argv
  .find((arg) => arg.startsWith('--bounds='))
  ?.slice(9)
  .split(',')
  .map(Number)

// Bounding rectangles mirror the application's supported country/territory list.
const fullRegions = [
  [-89.25, 15.85, -87.72, 18.55],
  [-84.96, 19.6, -74.1, 27.35],
  [-81.45, 19.15, -79.65, 19.85],
  [-74.55, 17.45, -65.2, 22],
  [-78.45, 17.6, -76.1, 18.55],
  [-70.12, 12, -68.15, 12.65],
  [-67.35, 17.65, -62.4, 18.8],
  [-64.95, 32.15, -64.55, 32.45],
  [-63.43, 16.65, -60.78, 18.65],
  [-61.95, 10, -59.4, 16.55],
]
const regions = requestedBounds
  ? [requestedBounds]
  : smokeTest
    ? [[-77.05, 17.95, -76.95, 18.05]]
    : fullRegions

if (
  !Number.isInteger(minZoom) ||
  !Number.isInteger(maxZoom) ||
  minZoom > maxZoom
) {
  throw new Error(
    'Zooms must be integers and min-zoom must not exceed max-zoom',
  )
}

if (!Number.isInteger(generationConcurrency) || generationConcurrency < 1) {
  throw new Error('Concurrency must be a positive integer')
}

if (
  requestedBounds &&
  (requestedBounds.length !== 4 ||
    requestedBounds.some((value) => !Number.isFinite(value)) ||
    requestedBounds[0] >= requestedBounds[2] ||
    requestedBounds[1] >= requestedBounds[3])
) {
  throw new Error('Bounds must be west,south,east,north')
}

await run('bash', [
  join(
    dirname(new URL(import.meta.url).pathname),
    'validate-copernicus-source.sh',
  ),
  sourceDir,
])
await mkdir(output, { recursive: true })
const temporary = await mkdtemp(join(tmpdir(), 'copernicus-terrain-'))

async function warp(bounds, width, height, target, srs) {
  await run('gdalwarp', [
    '-q',
    '-overwrite',
    '-t_srs',
    srs,
    '-te',
    ...bounds.map(String),
    '-ts',
    String(width),
    String(height),
    '-r',
    'bilinear',
    '-ot',
    'Float32',
    '-dstnodata',
    '-9999',
    vrt,
    target,
  ])
}

async function readFloatRaster(path, width, height) {
  const { data, info } = await sharp(path)
    .raw({ depth: 'float' })
    .toBuffer({ resolveWithObject: true })
  return extractFirstFloatChannel(data, width * height, info.channels)
}

async function generateTile(z, x, y) {
  const tif = join(temporary, `${z}-${x}-${y}.tif`)
  await warp(tileBounds3857(z, x, y), TILE_SIZE, TILE_SIZE, tif, 'EPSG:3857')
  const heights = await readFloatRaster(tif, TILE_SIZE, TILE_SIZE)
  const rgb = Buffer.alloc(TILE_SIZE * TILE_SIZE * 3)
  let hasData = false
  for (let index = 0; index < heights.length; index += 1) {
    const height = heights[index]
    const valid = Number.isFinite(height) && height > -9990
    const [red, green, blue] = encodeTerrainRgb(valid ? height : 0)
    rgb[index * 3] = red
    rgb[index * 3 + 1] = green
    rgb[index * 3 + 2] = blue
    hasData ||= valid
  }
  if (!hasData) return false
  const target = join(output, 'tiles', String(z), String(x), `${y}.png`)
  await mkdir(dirname(target), { recursive: true })
  await sharp(rgb, {
    raw: { width: TILE_SIZE, height: TILE_SIZE, channels: 3 },
  })
    .png({ compressionLevel: 9, palette: false })
    .toFile(target)
  return true
}

async function generateElevationGrid(lon, lat) {
  const tif = join(temporary, `grid-${lat}-${lon}.tif`)
  await warp([lon, lat, lon + 1, lat + 1], gridSize, gridSize, tif, 'EPSG:4326')
  const values = await readFloatRaster(tif, gridSize, gridSize)
  const elevations = Array.from(values, (value) =>
    Number.isFinite(value) && value > -9990
      ? Math.round(value * 10) / 10
      : null,
  )
  const valid = elevations.filter((value) => value !== null)
  if (valid.length === 0) return false
  const tileName = deriveTileName(lon + 0.5, lat + 0.5)
  const payload = {
    elevations,
    width: gridSize,
    height: gridSize,
    bounds: [
      [lon, lat],
      [lon + 1, lat + 1],
    ],
    noDataValue: null,
  }
  await mkdir(join(output, 'elevation-grids'), { recursive: true })
  await writeFile(
    join(output, 'elevation-grids', `${tileName}.json`),
    `${JSON.stringify(payload)}\n`,
  )
  const summary = {
    tileName,
    stats: {
      min: Math.min(...valid),
      max: Math.max(...valid),
      mean:
        Math.round(
          (valid.reduce((sum, value) => sum + value, 0) / valid.length) * 10,
        ) / 10,
    },
    coverage: {
      landCoveragePct:
        Math.round((valid.length / elevations.length) * 1000) / 10,
    },
  }
  await mkdir(join(output, 'terrain-summaries'), { recursive: true })
  await writeFile(
    join(output, 'terrain-summaries', `${tileName}.json`),
    `${JSON.stringify(summary)}\n`,
  )
  return true
}

async function processWithConcurrency(values, worker) {
  let nextIndex = 0
  let completed = 0
  const workers = Array.from(
    { length: Math.min(generationConcurrency, values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex
        nextIndex += 1
        if (await worker(values[index])) completed += 1
      }
    },
  )
  await Promise.all(workers)
  return completed
}

try {
  const tiles = new Set()
  for (let z = minZoom; z <= maxZoom; z += 1) {
    for (const [west, south, east, north] of regions) {
      const [minX, minY] = lngLatToTile(west, north, z)
      const [maxX, maxY] = lngLatToTile(east, south, z)
      for (let x = minX; x <= maxX; x += 1) {
        for (let y = minY; y <= maxY; y += 1) tiles.add(`${z}/${x}/${y}`)
      }
    }
  }
  const generatedTiles = await processWithConcurrency(
    [...tiles],
    async (key) => {
      const [z, x, y] = key.split('/').map(Number)
      return generateTile(z, x, y)
    },
  )

  const gridCells = new Set()
  for (const [west, south, east, north] of regions) {
    for (let lon = Math.floor(west); lon < Math.ceil(east); lon += 1) {
      for (let lat = Math.floor(south); lat < Math.ceil(north); lat += 1) {
        gridCells.add(`${lon}/${lat}`)
      }
    }
  }
  const generatedGrids = await processWithConcurrency(
    [...gridCells],
    async (key) => {
      const [lon, lat] = key.split('/').map(Number)
      return generateElevationGrid(lon, lat)
    },
  )

  await mkdir(join(output, 'provenance'), { recursive: true })
  await cp(
    join(sourceDir, 'source-manifest.json'),
    join(output, 'provenance/source-manifest.json'),
  )
  await writeFile(
    join(output, 'provenance/build-configuration.json'),
    `${JSON.stringify({ minZoom, maxZoom, tileSize: TILE_SIZE, gridSize, smokeTest, generationConcurrency, generatedTiles, generatedGrids }, null, 2)}\n`,
  )
  console.log(
    `Generated ${generatedTiles} PNG tiles and ${generatedGrids} elevation grids at ${output}`,
  )
} finally {
  await rm(temporary, { recursive: true, force: true })
}
