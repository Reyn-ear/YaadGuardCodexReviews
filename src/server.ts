import { Container } from '@cloudflare/containers'
import handler from '@tanstack/react-start/server-entry'
import { WorkflowEntrypoint } from 'cloudflare:workers'
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import {
  createIngestionRunId,
  enqueueIngestionJobs,
  handleIngestionQueueBatch,
  resolveSourceIds,
} from '../ingestion/orchestration.ts'
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

