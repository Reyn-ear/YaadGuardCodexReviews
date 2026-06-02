import { createError, defineEventHandler, getRouterParam } from 'h3'
import { readGeneratedObject } from '../../../../../src/features/map/runtimeData.server'

export default defineEventHandler(async (event) => {
  const z = getRouterParam(event, 'z')
  const x = getRouterParam(event, 'x')
  const y = getRouterParam(event, 'y')

  if (!z || !x || !y) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing tile parameters',
    })
  }

  const yClean = y.replace(/\.png$/i, '')
  const key = `tiles/${z}/${x}/${yClean}.png`
  const tile = await readGeneratedObject(key)

  if (!tile?.body) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Tile not found',
    })
  }

  return new Response(tile.body, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
      'Content-Type': tile.httpMetadata?.contentType ?? 'image/png',
    },
  })
})
