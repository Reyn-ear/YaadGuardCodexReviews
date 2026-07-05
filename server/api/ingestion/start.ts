import { createError, defineEventHandler, getHeader, readBody } from 'h3'
import type { H3Event } from 'h3'
import { env } from 'cloudflare:workers'
import { z } from 'zod'
import {
  createIngestionRunId,
  enqueueIngestionJobs,
  resolveSourceIds,
} from '../../../ingestion/orchestration.ts'

const requestSchema = z.object({
  runId: z.string().trim().min(1).optional(),
  sourceIds: z.array(z.string()).optional(),
})

export default defineEventHandler(async (event) => {
  if (event.method !== 'POST') {
    throw createError({ statusCode: 405, statusMessage: 'Method Not Allowed' })
  }

  assertAdmin(event)

  const body = requestSchema.parse(await readBody(event).catch(() => ({})))
  const sourceIds = resolveSourceIds(body.sourceIds)
  const runId = body.runId ?? createIngestionRunId()

  if (env.DATASET_INGESTION) {
    const instance = await env.DATASET_INGESTION.create({
      id: runId,
      params: { runId, sourceIds, requestedBy: 'api' },
    })

    return {
      runId,
      sourceIds,
      status: 'queued',
      workflowInstanceId: instance.id,
    }
  }

  return enqueueIngestionJobs(env, runId, sourceIds, 'api')
})

function assertAdmin(event: H3Event) {
  const configuredToken = env.INGESTION_ADMIN_TOKEN
  if (!configuredToken) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Ingestion admin token is not configured',
    })
  }

  const bearerToken = getHeader(event, 'authorization')?.replace(
    /^Bearer\s+/i,
    '',
  )
  const explicitToken = getHeader(event, 'x-ingestion-token')

  if (bearerToken !== configuredToken && explicitToken !== configuredToken) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized ingestion request',
    })
  }
}
