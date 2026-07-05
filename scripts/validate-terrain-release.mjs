#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import sharp from 'sharp'
import { deriveTileName, lngLatToTile } from './lib/terrain-artifacts.mjs'

const root = resolve(
  process.env.TERRAIN_ROOT ?? '/Volumes/Games/InitToWinit26-terrain',
)
const releaseArg = process.argv[2]
const checkedZooms = [10, 11, 12]
const minimumNonZeroTilePixels = 64
const minimumNonZeroGridCells = 64

const landSamples = [
  { name: 'Kingston, Jamaica', lng: -76.7928, lat: 17.9714 },
  { name: 'Montego Bay, Jamaica', lng: -77.9188, lat: 18.4762 },
  { name: 'Havana, Cuba', lng: -82.3666, lat: 23.1136 },
  { name: 'Santiago, Dominican Republic', lng: -70.697, lat: 19.4517 },
  { name: 'San Juan, Puerto Rico', lng: -66.1057, lat: 18.4655 },
  { name: 'Belize City, Belize', lng: -88.1962, lat: 17.5046 },
  { name: 'Bridgetown, Barbados', lng: -59.6167, lat: 13.1 },
]

if (!releaseArg) {
  console.error('Usage: node scripts/validate-terrain-release.mjs RELEASE')
  process.exit(2)
}

const release = resolve(releaseArg)
if (release !== root && !release.startsWith(`${root}${sep}`)) {
  console.error(`Release directory must be under ${root}`)
  process.exit(2)
}

function decodeTerrainRgb(red, green, blue) {
  return -10000 + (red * 256 * 256 + green * 256 + blue) * 0.1
}

async function countNonZeroTilePixels(file) {
  const { data, info } = await sharp(file).raw().toBuffer({
    resolveWithObject: true,
  })
  let nonZero = 0

  for (let index = 0; index < data.length; index += info.channels) {
    if (decodeTerrainRgb(data[index], data[index + 1], data[index + 2]) !== 0) {
      nonZero += 1
    }
  }

  return nonZero
}

function countNonZeroGridCells(file) {
  const payload = JSON.parse(readFileSync(file, 'utf8'))
  if (!Array.isArray(payload.elevations)) {
    throw new Error(`Grid payload has no elevations array: ${file}`)
  }

  return payload.elevations.filter((value) => value !== null && value !== 0)
    .length
}

const failures = []

for (const sample of landSamples) {
  for (const zoom of checkedZooms) {
    const [x, y] = lngLatToTile(sample.lng, sample.lat, zoom)
    const tile = resolve(release, 'tiles', String(zoom), String(x), `${y}.webp`)

    if (!existsSync(tile)) {
      failures.push(`${sample.name} z${zoom} tile missing: ${tile}`)
      continue
    }

    const nonZeroPixels = await countNonZeroTilePixels(tile)
    if (nonZeroPixels < minimumNonZeroTilePixels) {
      failures.push(
        `${sample.name} z${zoom} tile is flat/empty: ${tile} (${nonZeroPixels} non-zero pixels)`,
      )
    }
  }

  const tileName = deriveTileName(sample.lng, sample.lat)
  const grid = resolve(release, 'elevation-grids', `${tileName}.json`)
  if (!existsSync(grid)) {
    failures.push(`${sample.name} elevation grid missing: ${grid}`)
    continue
  }

  const nonZeroCells = countNonZeroGridCells(grid)
  if (nonZeroCells < minimumNonZeroGridCells) {
    failures.push(
      `${sample.name} elevation grid is flat/empty: ${grid} (${nonZeroCells} non-zero cells)`,
    )
  }
}

if (failures.length > 0) {
  console.error('Terrain release validation failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  console.error('z13 tiles are intentionally not checked yet.')
  process.exit(1)
}

console.log(
  `Terrain release validation passed for ${landSamples.length} land samples at z${checkedZooms.join(', z')}.`,
)
console.log('z13 tiles are intentionally not checked yet.')
