export const TILE_SIZE: 256

export function tileBounds3857(
  z: number,
  x: number,
  y: number,
): [number, number, number, number]

export function lngLatToTile(
  lng: number,
  lat: number,
  zoom: number,
): [number, number]

export function encodeTerrainRgb(elevation: number): [number, number, number]

export function decodeTerrainRgb(
  red: number,
  green: number,
  blue: number,
): number

export function extractFirstFloatChannel(
  data: Buffer,
  pixelCount: number,
  channels: number,
): Float32Array

export function deriveTileName(lng: number, lat: number): string
