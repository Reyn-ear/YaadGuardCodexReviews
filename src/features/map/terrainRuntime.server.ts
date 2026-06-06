import { and, eq, gte, lte } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from '../../../db/client'
import * as schema from '../../../db/schema'
import { getActiveManifest, readGeneratedObject } from './runtimeData.server'
import type { BoundsTuple } from './types'

const elevationChunkSchema = z.object({
  cellId: z.string(),
  sourceRelease: z.string(),
  bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  width: z.number(),
  height: z.number(),
  elevationsM: z.array(z.number().nullable()),
})

export async function loadActiveTerrainCell(
  center: [number, number],
  db: Db | null,
) {
  const manifest = await getActiveManifest()
  if (!db || manifest?.sourceId !== 'T-02' || !manifest.sourceVersion) {
    return undefined
  }

  const [lng, lat] = center
  return db.query.terrainAnalysisCells.findFirst({
    where: and(
      eq(schema.terrainAnalysisCells.sourceRelease, manifest.sourceVersion),
      lte(schema.terrainAnalysisCells.west, lng),
      gte(schema.terrainAnalysisCells.east, lng),
      lte(schema.terrainAnalysisCells.south, lat),
      gte(schema.terrainAnalysisCells.north, lat),
    ),
  })
}

export async function loadActiveElevationGrid(
  bounds: BoundsTuple,
  subGridSize: number,
  db: Db | null,
) {
  if (subGridSize !== 20) {
    return undefined
  }

  const center: [number, number] = [
    (bounds[0][0] + bounds[1][0]) / 2,
    (bounds[0][1] + bounds[1][1]) / 2,
  ]
  const cell = await loadActiveTerrainCell(center, db)
  if (!cell) {
    return undefined
  }

  const object = await readGeneratedObject(cell.detailObjectKey)
  if (!object?.body) {
    return undefined
  }

  const decompressed = object.body.pipeThrough(new DecompressionStream('gzip'))
  const payload = elevationChunkSchema.parse(
    await new Response(decompressed).json(),
  )
  if (payload.width !== subGridSize || payload.height !== subGridSize) {
    return undefined
  }

  return {
    elevations: payload.elevationsM.map((value) => value ?? -2),
    subGridSize,
    bounds,
  }
}
