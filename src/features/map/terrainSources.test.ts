import { describe, expect, it } from 'vitest'
import { resolveTerrainSource } from './terrainSources'

describe('resolveTerrainSource', () => {
  it('keeps Copernicus as the default', () => {
    const result = resolveTerrainSource({
      isDevelopment: true,
      requestedCandidate: null,
      gedtm30PmtilesUrl: 'http://localhost:3001/gedtm30.pmtiles',
    })

    expect(result.candidate).toBe('copernicus')
    expect(result.source).toMatchObject({ type: 'raster-dem', maxzoom: 12 })
  })

  it('allows GEDTM30 only for an explicit development evaluation', () => {
    const result = resolveTerrainSource({
      isDevelopment: true,
      requestedCandidate: 'gedtm30',
      gedtm30PmtilesUrl: 'http://localhost:3001/gedtm30.pmtiles',
    })

    expect(result.candidate).toBe('gedtm30')
    expect(result.source).toMatchObject({
      type: 'raster-dem',
      url: 'pmtiles://http://localhost:3001/gedtm30.pmtiles',
      maxzoom: 12,
    })
  })

  it('refuses a production GEDTM30 override', () => {
    const result = resolveTerrainSource({
      isDevelopment: false,
      requestedCandidate: 'gedtm30',
      gedtm30PmtilesUrl: 'https://terrain.example/gedtm30.pmtiles',
    })

    expect(result.candidate).toBe('copernicus')
  })

  it('supports a development Martin TileJSON source', () => {
    const result = resolveTerrainSource({
      isDevelopment: true,
      requestedCandidate: 'gedtm30',
      gedtm30TileJsonUrl: 'http://127.0.0.1:3010/jamaica',
    })

    expect(result.candidate).toBe('gedtm30')
    expect(result.source).toMatchObject({
      type: 'raster-dem',
      url: 'http://127.0.0.1:3010/jamaica',
      maxzoom: 12,
    })
  })

  it('prefers an explicit PMTiles URL over a local Martin fallback', () => {
    const terrain = resolveTerrainSource({
      isDevelopment: true,
      requestedCandidate: 'gedtm30',
      gedtm30PmtilesUrl: '/api/terrain/gedtm30.pmtiles',
      gedtm30TileJsonUrl: 'http://127.0.0.1:3010/jamaica',
    })

    expect(terrain.source.url).toBe('pmtiles:///api/terrain/gedtm30.pmtiles')
  })

  it('supports a 512 pixel GEDTM30 archive with equivalent detail', () => {
    const terrain = resolveTerrainSource({
      isDevelopment: true,
      requestedCandidate: 'gedtm30',
      gedtm30PmtilesUrl: 'https://terrain.example/caribbean.pmtiles',
      gedtm30TileSize: 512,
      gedtm30MinZoom: 5,
      gedtm30MaxZoom: 11,
    })

    expect(terrain.source).toMatchObject({
      tileSize: 512,
      minzoom: 5,
      maxzoom: 11,
    })
  })
})
