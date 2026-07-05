import { describe, expect, it } from 'vitest'
import {
  decodeTerrainRgb,
  encodeTerrainRgb,
  extractFirstFloatChannel,
  lngLatToTile,
  tileBounds3857,
} from './terrain-artifacts.mjs'

describe('terrain artifact encoding', () => {
  it.each([-100, 0, 123.4, 8848.9])('round trips %s metres', (height) => {
    expect(decodeTerrainRgb(...encodeTerrainRgb(height))).toBeCloseTo(height, 1)
  })

  it('produces adjacent Web Mercator tile bounds', () => {
    const left = tileBounds3857(10, ...lngLatToTile(-77, 18, 10))
    expect(left[0]).toBeLessThan(left[2])
    expect(left[1]).toBeLessThan(left[3])
  })

  it('extracts one elevation per pixel from expanded RGB float rasters', () => {
    const expanded = new Float32Array([
      100, 100, 100, 200, 200, 200, 300, 300, 300,
    ])

    expect(
      Array.from(extractFirstFloatChannel(Buffer.from(expanded.buffer), 3, 3)),
    ).toEqual([100, 200, 300])
  })
})
