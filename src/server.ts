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
