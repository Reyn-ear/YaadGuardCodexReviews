import { createError, defineEventHandler, getHeader, getQuery } from 'h3'
import type { H3Event } from 'h3'
import { env } from 'cloudflare:workers'

export default defineEventHandler(async (event) => {
  if (event.method !== 'GET') {
    throw createError({ statusCode: 405, statusMessage: 'Method Not Allowed' })
  }

  assertAdmin(event)

  const runId = getQuery(event).runId
  if (typeof runId === 'string') {
    if (!/^[\w-]+$/.test(runId)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid runId',
      })
    }

    const result = await env.DB!.prepare(
      `SELECT source_id, action, status, message, updated_at
       FROM ingestion_source_jobs
       WHERE run_id = ?
       ORDER BY updated_at`,
    )
      .bind(runId)
      .all<{
        source_id: string
        action: string
        status: string
        message: string | null
        updated_at: string
      }>()

    return {
      runId,
      jobs: (result.results ?? []).map((row) => ({
        sourceId: row.source_id,
        action: row.action,
        status: row.status,
        message: row.message,
        updatedAt: row.updated_at,
      })),
    }
  }

  const result = await env.DB!.prepare(
    `SELECT run_id, status, source_ids, updated_at
     FROM ingestion_runs
     ORDER BY updated_at DESC
     LIMIT 10`,
  ).all<{
    run_id: string
    status: string
    source_ids: string
    updated_at: string
  }>()

  return {
    runs: (result.results ?? []).map((row) => ({
      runId: row.run_id,
      status: row.status,
      sourceIds: JSON.parse(row.source_ids) as string[],
      updatedAt: row.updated_at,
    })),
  }
})

function assertAdmin(event: H3Event) {
  const configuredToken = env.INGESTION_ADMIN_TOKEN
  if (!configuredToken) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Ingestion admin token is not configured',
    })
  }

  const bearerToken = getHeader(event, 'authorization')?.replace(/^Bearer\s+/i, '')
  const explicitToken = getHeader(event, 'x-ingestion-token')

  if (bearerToken !== configuredToken && explicitToken !== configuredToken) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized ingestion request',
    })
  }
}
