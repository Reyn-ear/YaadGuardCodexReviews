export const TILE_SIZE = 256
const EARTH_RADIUS = 6378137
const ORIGIN_SHIFT = Math.PI * EARTH_RADIUS

export function tileBounds3857(z, x, y) {
  const span = (2 * ORIGIN_SHIFT) / 2 ** z
  return [
    -ORIGIN_SHIFT + x * span,
    ORIGIN_SHIFT - (y + 1) * span,
    -ORIGIN_SHIFT + (x + 1) * span,
    ORIGIN_SHIFT - y * span,
  ]
}

export function lngLatToTile(lng, lat, zoom) {
  const scale = 2 ** zoom
  const x = Math.floor(((lng + 180) / 360) * scale)
  const radians =
    (Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI) / 180
  const y = Math.floor(
    ((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * scale,
  )
  return [x, y]
}

export function encodeTerrainRgb(elevation) {
  const encoded = Math.max(
    0,
    Math.min(256 ** 3 - 1, Math.round((elevation + 10000) * 10)),
  )
  return [(encoded >> 16) & 255, (encoded >> 8) & 255, encoded & 255]
}

export function decodeTerrainRgb(red, green, blue) {
  return -10000 + (red * 256 * 256 + green * 256 + blue) * 0.1
}

export function extractFirstFloatChannel(data, pixelCount, channels) {
  const source = new Float32Array(
    data.buffer,
    data.byteOffset,
    data.byteLength / Float32Array.BYTES_PER_ELEMENT,
  )

  if (channels === 1) {
    return source.subarray(0, pixelCount)
  }

  const values = new Float32Array(pixelCount)
  for (let index = 0; index < pixelCount; index += 1) {
    values[index] = source[index * channels]
  }
  return values
}

export function deriveTileName(lng, lat) {
  const latLabel = `${Math.floor(Math.abs(lat))}${lat >= 0 ? 'N' : 'S'}`
  const lonLabel = `${Math.ceil(Math.abs(lng))}${lng <= 0 ? 'W' : 'E'}`
  return `${latLabel}_${lonLabel}`
}
