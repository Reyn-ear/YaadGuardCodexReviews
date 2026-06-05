import { Container } from '@cloudflare/containers'
import handler from '@tanstack/react-start/server-entry'
import { WorkflowEntrypoint } from 'cloudflare:workers'
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import {
  createIngestionRunId,
  enqueueIngestionJobs,
  handleIngestionQueueBatch,
  resolveSourceIds,
} from './features/ingestion/ingestion.server'
import { processDemTerrainTile } from './features/map/demProcessor.server'

export class GeospatialProcessor extends Container<CloudflareBindings> {
  defaultPort = 8080
  sleepAfter = '1m'
  enableInternet = true
}

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

    if (url.pathname === '/api/ingestion/start') {
      return handleIngestionStartRequest(request, env)
    }

    const tileMatch = url.pathname.match(
      /^\/api\/tiles\/([^/]+)\/([^/]+)\/([^/]+)$/,
    )
    if (tileMatch) {
      return handleTileRequest(request, env, tileMatch)
    }

    return handler.fetch(request)
  },
  queue(batch, env, ctx) {
    return handleIngestionQueueBatch(batch, env, ctx)
  },
} satisfies ExportedHandler<CloudflareBindings, IngestionQueueMessage>

async function handleIngestionStartRequest(
  request: Request,
  env: CloudflareBindings,
) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, {
      Allow: 'POST',
    })
  }

  const configuredToken = env.INGESTION_ADMIN_TOKEN
  if (!configuredToken) {
    return jsonResponse(
      { error: 'Ingestion admin token is not configured' },
      503,
    )
  }

  const authHeader = request.headers.get('authorization')
  const bearerToken = authHeader?.replace(/^Bearer\s+/i, '')
  const explicitToken = request.headers.get('x-ingestion-token')

  if (bearerToken !== configuredToken && explicitToken !== configuredToken) {
    return jsonResponse({ error: 'Unauthorized ingestion request' }, 401)
  }

  try {
    const body = await readJsonBody(request)
    const sourceIds = resolveSourceIds(
      Array.isArray(body.sourceIds)
        ? body.sourceIds.filter((sourceId): sourceId is string => {
            return typeof sourceId === 'string'
          })
        : undefined,
    )
    const runId =
      typeof body.runId === 'string' && body.runId.trim()
        ? body.runId.trim()
        : createIngestionRunId()

    if (env.DATASET_INGESTION) {
      const instance = await env.DATASET_INGESTION.create({
        id: runId,
        params: {
          runId,
          sourceIds,
          requestedBy: 'api',
        },
      })

      return jsonResponse({
        runId,
        sourceIds,
        status: 'queued',
        workflowInstanceId: instance.id,
      })
    }

    return jsonResponse(
      await enqueueIngestionJobs(env, runId, sourceIds, 'api'),
    )
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : String(error) },
      400,
    )
  }
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
  const key = `tiles/${z}/${x}/${y.replace(/\.png$/i, '')}.png`
  const object = await readGeneratedObject(env, key)

  if (object?.body) {
    return new Response(request.method === 'HEAD' ? null : object.body, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600',
        'Content-Type': object.httpMetadata?.contentType ?? 'image/png',
      },
    })
  }

  const tile = await processDemTerrainTile(env, z, x, y.replace(/\.png$/i, ''))
  if (!tile) {
    return new Response('Tile not found', { status: 404 })
  }

  await writeGeneratedObject(env, key, tile, {
    httpMetadata: { contentType: 'image/png' },
  })

  return new Response(request.method === 'HEAD' ? null : tile, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
      'Content-Type': 'image/png',
    },
  })
}

async function readGeneratedObject(env: CloudflareBindings, key: string) {
  const bucket = env.YAAD_GUARD_BUCKET
  if (!bucket) {
    return null
  }

  return bucket.get(await resolveGeneratedObjectKey(env, key))
}

async function writeGeneratedObject(
  env: CloudflareBindings,
  key: string,
  value: ArrayBuffer,
  options?: R2PutOptions,
) {
  const bucket = env.YAAD_GUARD_BUCKET
  if (!bucket) {
    return null
  }

  return bucket.put(await resolveGeneratedObjectKey(env, key), value, options)
}

async function resolveGeneratedObjectKey(env: CloudflareBindings, key: string) {
  const bucket = env.YAAD_GUARD_BUCKET
  if (!bucket) {
    return key.replace(/^\/+/, '')
  }

  const normalizedKey = key.replace(/^\/+/, '')
  const activeManifestKey = env.ACTIVE_MANIFEST_KEY ?? 'manifests/active.json'
  const activeManifestObject = await bucket.get(activeManifestKey)
  const activeManifest = activeManifestObject
    ? await activeManifestObject.json<{
        generatedPrefix?: unknown
      }>()
    : null
  const generatedPrefix =
    typeof activeManifest?.generatedPrefix === 'string'
      ? activeManifest.generatedPrefix.replace(/^\/+|\/+$/g, '')
      : ''

  return generatedPrefix ? `${generatedPrefix}/${normalizedKey}` : normalizedKey
}

async function readJsonBody(request: Request) {
  if (!request.body) {
    return {} as Record<string, unknown>
  }

  const text = await request.text()
  if (!text.trim()) {
    return {} as Record<string, unknown>
  }

  return JSON.parse(text) as Record<string, unknown>
}

function jsonResponse(payload: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(payload, {
    status,
    headers: {
      ...headers,
      'Cache-Control': 'no-store',
    },
  })
}
