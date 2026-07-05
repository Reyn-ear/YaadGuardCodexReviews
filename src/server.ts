import handler from '@tanstack/react-start/server-entry'
import { WorkflowEntrypoint } from 'cloudflare:workers'
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import {
  createIngestionRunId,
  enqueueIngestionJobs,
  handleIngestionQueueBatch,
  resolveSourceIds,
} from '../ingestion/orchestration.ts'

const GENERATED_DATA_PREFIX = 'data'

export class DatasetIngestionWorkflow extends WorkflowEntrypoint<
  CloudflareBindings,
  IngestionWorkflowParams
> {
  async run(event: WorkflowEvent<IngestionWorkflowParams>, step: WorkflowStep) {
    const runId = event.payload.runId ?? createIngestionRunId()
    const sourceIds = resolveSourceIds(event.payload.sourceIds)
    const requestedBy = event.payload.requestedBy ?? 'workflow'

    return step.do('enqueue ingestion source jobs', async () =>
      enqueueIngestionJobs(this.env, runId, sourceIds, requestedBy),
    )
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    const tileMatch = url.pathname.match(
      /^\/api\/tiles\/([^/]+)\/([^/]+)\/([^/]+)$/,
    )
    if (tileMatch) {
      return handleTileRequest(request, env, tileMatch)
    }

    if (url.pathname === '/api/terrain/gedtm30.pmtiles') {
      return handleTerrainArchiveRequest(request, env)
    }

    return handler.fetch(request)
  },
  queue(batch, env, ctx) {
    return handleIngestionQueueBatch(batch, env, ctx)
  },
} satisfies ExportedHandler<CloudflareBindings, IngestionQueueMessage>

async function handleTerrainArchiveRequest(
  request: Request,
  env: CloudflareBindings,
) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', {
      status: 405,
      headers: { Allow: 'GET, HEAD' },
    })
  }

  const bucket = env.YAAD_GUARD_BUCKET
  const key = env.TERRAIN_PMTILES_KEY?.replace(/^\/+/, '')
  if (!bucket || !key) {
    return new Response('Terrain archive is not configured', { status: 503 })
  }

  const object =
    request.method === 'HEAD'
      ? await bucket.head(key)
      : await bucket.get(key, {
          onlyIf: request.headers,
          range: request.headers,
        })
  if (!object) {
    return new Response('Terrain archive not found', { status: 404 })
  }

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('Accept-Ranges', 'bytes')
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Cache-Control', 'public, max-age=31536000, immutable')
  headers.set('Content-Type', 'application/octet-stream')
  headers.set('ETag', object.httpEtag)

  const isPartial =
    request.method === 'GET' &&
    'body' in object &&
    request.headers.has('Range') &&
    object.range !== undefined
  if (isPartial) {
    const { offset, length } = parseRangeHeader(
      request.headers.get('Range')!,
      object.size,
    )
    headers.set(
      'Content-Range',
      `bytes ${offset}-${offset + length - 1}/${object.size}`,
    )
    headers.set('Content-Length', String(length))
  } else {
    headers.set('Content-Length', String(object.size))
  }

  const body: ReadableStream | null =
    request.method === 'GET' && 'body' in object
      ? (object as R2ObjectBody).body
      : null

  return new Response(body, {
    status: isPartial ? 206 : 200,
    headers,
  })
}

function parseRangeHeader(rangeHeader: string, objectSize: number) {
  const range = /^bytes=(?:(\d+)-(\d*)|-(\d+))$/.exec(rangeHeader.trim())
  if (!range) {
    throw new Error(`Unsupported byte range: ${rangeHeader}`)
  }

  if (range[3]) {
    const length = Math.min(Number(range[3]), objectSize)
    return { offset: objectSize - length, length }
  }

  const offset = Number(range[1])
  const requestedEnd = range[2] ? Number(range[2]) : objectSize - 1
  const end = Math.min(requestedEnd, objectSize - 1)
  return { offset, length: end - offset + 1 }
}

async function handleTileRequest(
  request: Request,
  env: CloudflareBindings,
  match: RegExpMatchArray,
) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', {
      status: 405,
      headers: { Allow: 'GET, HEAD' },
    })
  }

  const [, z, x, y] = match
  const yClean = y.replace(/\.(?:png|webp)$/i, '')
  const key = `tiles/${z}/${x}/${yClean}.webp`
  const object = await readGeneratedObject(env, key)

  if (object?.body) {
    return new Response(request.method === 'HEAD' ? null : object.body, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Type': object.httpMetadata?.contentType ?? 'image/webp',
      },
    })
  }

  return new Response('Tile not found', { status: 404 })
}

async function readGeneratedObject(env: CloudflareBindings, key: string) {
  const bucket = env.YAAD_GUARD_BUCKET
  if (!bucket) {
    return null
  }

  return bucket.get(resolveDataObjectKey(key))
}

function resolveDataObjectKey(key: string) {
  const normalizedKey = key.replace(/^\/+/, '')

  return `${GENERATED_DATA_PREFIX}/${normalizedKey}`
}
