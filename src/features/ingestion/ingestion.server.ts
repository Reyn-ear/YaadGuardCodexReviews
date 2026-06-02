import { importHurdat2StormHistory } from './hurdat2.server'
import { importSurgeReturnLevels } from './surge.server'
import { syncWorldPopMetadata, WORLDPOP_DATASET_ALIAS } from './worldpop.server'

type IngestionSource = {
  id: string
  name: string
  provider: string
  collection: string
  sourceVersion: string
  landingUrl: string
  downloadUrl?: string
  downloadFilename?: string
}

type JobStatus =
  | 'queued'
  | 'downloading'
  | 'downloaded'
  | 'processing'
  | 'completed'
  | 'failed'

export const SOURCE_CATALOG: Record<string, IngestionSource> = {
  'T-01': {
    id: 'T-01',
    name: 'Copernicus DEM GLO-30',
    provider: 'Copernicus / ESA',
    collection: 'Copernicus DEM 30m COG tiles',
    sourceVersion: 'glo-30',
    landingUrl: 'https://registry.opendata.aws/copernicus-dem/',
  },
  'T-09': {
    id: 'T-09',
    name: 'ESA WorldCover',
    provider: 'ESA',
    collection: 'WorldCover 10m Collection',
    sourceVersion: '2021-v200',
    landingUrl: 'https://esa-worldcover.org/en/data-access',
  },
  'H-01': {
    id: 'H-01',
    name: 'HURDAT2',
    provider: 'NOAA / NHC',
    collection: 'NOAA NHC Data Archive',
    sourceVersion: 'atlantic-1851-2025-20260227',
    landingUrl: 'https://www.nhc.noaa.gov/data/',
    downloadUrl:
      'https://www.nhc.noaa.gov/data/hurdat/hurdat2-1851-2025-02272026.txt',
    downloadFilename: 'hurdat2-1851-2025-02272026.txt',
  },
  'H-12': {
    id: 'H-12',
    name: 'GTSM-ERA5-E',
    provider: 'Deltares / Zenodo',
    collection: 'Zenodo Repository',
    sourceVersion: 'doi-10.5281-zenodo.14671593',
    landingUrl: 'https://doi.org/10.5281/zenodo.14671593',
  },
  'E-02': {
    id: 'E-02',
    name: 'WorldPop',
    provider: 'University of Southampton',
    collection: 'WorldPop Open Data Portal',
    sourceVersion: WORLDPOP_DATASET_ALIAS,
    landingUrl: 'https://hub.worldpop.org/',
  },
}

export function createIngestionRunId() {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '')
  const suffix = crypto.randomUUID().slice(0, 8)
  return `run_${timestamp}_${suffix}`
}

export function resolveSourceIds(sourceIds?: string[]) {
  const ids = sourceIds?.length ? sourceIds : Object.keys(SOURCE_CATALOG)
  const uniqueIds = Array.from(new Set(ids))
  const unknownIds = uniqueIds.filter((id) => !SOURCE_CATALOG[id])

  if (unknownIds.length > 0) {
    throw new Error(`Unknown ingestion source ids: ${unknownIds.join(', ')}`)
  }

  return uniqueIds
}

export async function enqueueIngestionJobs(
  env: CloudflareBindings,
  runId: string,
  sourceIds?: string[],
  requestedBy?: string,
) {
  const ids = resolveSourceIds(sourceIds)

  if (!env.INGESTION_QUEUE) {
    throw new Error('Missing Cloudflare Queue binding: INGESTION_QUEUE')
  }

  await writeRunManifest(env, runId, ids, requestedBy)
  await upsertRun(env, runId, 'queued', ids, requestedBy)

  for (const sourceId of ids) {
    const source = SOURCE_CATALOG[sourceId]
    const action = source.downloadUrl ? 'download-source' : 'process-source'
    await upsertJob(env, {
      runId,
      sourceId,
      action,
      status: 'queued',
      sourceVersion: source.sourceVersion,
    })
    await env.INGESTION_QUEUE.send({ runId, sourceId, action })
  }

  return {
    runId,
    sourceIds: ids,
    status: 'queued',
  }
}

export async function handleIngestionQueueBatch(
  batch: MessageBatch<IngestionQueueMessage>,
  env: CloudflareBindings,
  ctx: ExecutionContext,
) {
  void ctx

  for (const message of batch.messages) {
    try {
      await handleIngestionMessage(message.body, env)
      message.ack()
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      await upsertJob(env, {
        ...message.body,
        status: 'failed',
        message: reason,
      })
      message.retry()
    }
  }
}

async function handleIngestionMessage(
  message: IngestionQueueMessage,
  env: CloudflareBindings,
) {
  const source = SOURCE_CATALOG[message.sourceId]
  if (!source) {
    throw new Error(`Unknown ingestion source id: ${message.sourceId}`)
  }

  if (message.action === 'download-source') {
    await downloadSource(message, source, env)
    return
  }

  await processSource(message, source, env)
}

async function downloadSource(
  message: IngestionQueueMessage,
  source: IngestionSource,
  env: CloudflareBindings,
) {
  if (!source.downloadUrl) {
    throw new Error(`Source ${source.id} does not define a direct download URL`)
  }

  if (!env.YAAD_GUARD_BUCKET) {
    throw new Error('Missing Cloudflare R2 binding: YAAD_GUARD_BUCKET')
  }

  assertAllowedSourceUrl(source.downloadUrl, source)

  await upsertJob(env, {
    ...message,
    status: 'downloading',
    sourceVersion: source.sourceVersion,
  })

  const response = await fetch(source.downloadUrl, {
    headers: {
      'User-Agent': 'Yaad Guard Cloudflare ingestion worker',
    },
  })

  if (!response.ok || !response.body) {
    throw new Error(
      `Failed to download ${source.id}: ${response.status} ${response.statusText}`,
    )
  }

  const filename =
    source.downloadFilename ??
    new URL(source.downloadUrl).pathname.split('/').at(-1)
  const objectKey = [
    'raw',
    source.id,
    source.sourceVersion,
    message.runId,
    filename ?? 'source.bin',
  ].join('/')

  await env.YAAD_GUARD_BUCKET.put(objectKey, response.body, {
    httpMetadata: {
      contentType:
        response.headers.get('content-type') ?? 'application/octet-stream',
    },
    customMetadata: {
      runId: message.runId,
      sourceId: source.id,
      sourceVersion: source.sourceVersion,
    },
  })

  await upsertJob(env, {
    ...message,
    status: 'downloaded',
    sourceVersion: source.sourceVersion,
    rawObjectKey: objectKey,
  })

  await env.INGESTION_QUEUE?.send({
    runId: message.runId,
    sourceId: message.sourceId,
    action: 'process-source',
  })
}

async function processSource(
  message: IngestionQueueMessage,
  source: IngestionSource,
  env: CloudflareBindings,
) {
  const generatedPrefix = `generated/${message.runId}`
  await upsertJob(env, {
    ...message,
    status: 'processing',
    sourceVersion: source.sourceVersion,
    generatedPrefix,
  })

  const processorPayload = {
    runId: message.runId,
    source,
    rawPrefix: `raw/${source.id}/${source.sourceVersion}/${message.runId}`,
    generatedPrefix,
  }

  let processorResult: unknown = null

  if (env.GEOSPATIAL_PROCESSOR) {
    const processor = env.GEOSPATIAL_PROCESSOR.getByName(message.runId)
    const response = await processor.fetch('https://processor/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(processorPayload),
    })

    if (!response.ok) {
      throw new Error(
        `Processor failed for ${source.id}: ${response.status} ${response.statusText}`,
      )
    }

    processorResult = await response.json().catch(() => null)
  }

  if (source.id === 'H-01') {
    const rawObjectKey = getRawSourceObjectKey(message.runId, source)
    const stormImport = await importHurdat2StormHistory(env, rawObjectKey)
    processorResult = {
      processorResult,
      stormImport,
    }
  }

  if (source.id === 'H-12') {
    const surgeImport = await importSurgeReturnLevels(env, processorResult)
    processorResult = {
      processorResult,
      surgeImport,
    }
  }

  if (source.id === 'E-02') {
    const worldPopImport = await syncWorldPopMetadata(env)
    processorResult = {
      processorResult,
      worldPopImport,
    }
  }

  await writeSourceArtifact(env, generatedPrefix, source, processorResult)
  await upsertJob(env, {
    ...message,
    status: 'completed',
    sourceVersion: source.sourceVersion,
    generatedPrefix,
  })

  await maybePublishActiveManifest(env, message.runId)
}

function getRawSourceObjectKey(runId: string, source: IngestionSource) {
  const filename =
    source.downloadFilename ??
    (source.downloadUrl
      ? new URL(source.downloadUrl).pathname.split('/').at(-1)
      : undefined)

  return [
    'raw',
    source.id,
    source.sourceVersion,
    runId,
    filename ?? 'source.bin',
  ].join('/')
}

async function writeRunManifest(
  env: CloudflareBindings,
  runId: string,
  sourceIds: string[],
  requestedBy?: string,
) {
  await env.YAAD_GUARD_BUCKET?.put(
    `manifests/runs/${runId}/run.json`,
    JSON.stringify(
      {
        runId,
        sourceIds,
        requestedBy,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    {
      httpMetadata: { contentType: 'application/json' },
    },
  )
}

async function writeSourceArtifact(
  env: CloudflareBindings,
  generatedPrefix: string,
  source: IngestionSource,
  processorResult: unknown,
) {
  await env.YAAD_GUARD_BUCKET?.put(
    `${generatedPrefix}/sources/${source.id}.json`,
    JSON.stringify(
      {
        source,
        processorResult,
        completedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    {
      httpMetadata: { contentType: 'application/json' },
    },
  )
}

async function maybePublishActiveManifest(
  env: CloudflareBindings,
  runId: string,
) {
  const runManifest = await readRunManifest(env, runId)
  if (!runManifest) {
    return
  }

  const generatedPrefix = `generated/${runId}`
  const ready = await Promise.all(
    runManifest.sourceIds.map((sourceId) =>
      env.YAAD_GUARD_BUCKET?.head(
        `${generatedPrefix}/sources/${sourceId}.json`,
      ),
    ),
  )

  if (ready.some((artifact) => !artifact)) {
    return
  }

  const activeManifest = {
    runId,
    generatedPrefix,
    artifactVersion: 'cloudflare-port-v1',
    sourceIds: runManifest.sourceIds,
    publishedAt: new Date().toISOString(),
  }

  await env.YAAD_GUARD_BUCKET?.put(
    `manifests/runs/${runId}/active.json`,
    JSON.stringify(activeManifest, null, 2),
    { httpMetadata: { contentType: 'application/json' } },
  )
  await env.YAAD_GUARD_BUCKET?.put(
    env.ACTIVE_MANIFEST_KEY ?? 'manifests/active.json',
    JSON.stringify(activeManifest, null, 2),
    { httpMetadata: { contentType: 'application/json' } },
  )
  await upsertRun(
    env,
    runId,
    'active',
    runManifest.sourceIds,
    runManifest.requestedBy,
    `manifests/runs/${runId}/active.json`,
  )
}

async function readRunManifest(env: CloudflareBindings, runId: string) {
  const object = await env.YAAD_GUARD_BUCKET?.get(
    `manifests/runs/${runId}/run.json`,
  )
  const payload = object ? await object.json<unknown>() : null

  if (!payload || typeof payload !== 'object') {
    return null
  }

  const sourceIds = (payload as { sourceIds?: unknown }).sourceIds
  if (
    !Array.isArray(sourceIds) ||
    sourceIds.some((id) => typeof id !== 'string')
  ) {
    return null
  }

  return {
    sourceIds,
    requestedBy:
      typeof (payload as { requestedBy?: unknown }).requestedBy === 'string'
        ? (payload as { requestedBy: string }).requestedBy
        : undefined,
  }
}

async function upsertRun(
  env: CloudflareBindings,
  runId: string,
  status: string,
  sourceIds: string[],
  requestedBy?: string,
  manifestKey?: string,
) {
  await env.DB?.prepare(
    `
      INSERT INTO ingestion_runs (
        run_id,
        status,
        requested_by,
        source_ids,
        manifest_key,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(run_id) DO UPDATE SET
        status = excluded.status,
        requested_by = excluded.requested_by,
        source_ids = excluded.source_ids,
        manifest_key = excluded.manifest_key,
        updated_at = CURRENT_TIMESTAMP
    `,
  )
    .bind(
      runId,
      status,
      requestedBy ?? null,
      JSON.stringify(sourceIds),
      manifestKey ?? null,
    )
    .run()
}

async function upsertJob(
  env: CloudflareBindings,
  job: IngestionQueueMessage & {
    status: JobStatus
    sourceVersion?: string
    rawObjectKey?: string
    generatedPrefix?: string
    message?: string
  },
) {
  await env.DB?.prepare(
    `
      INSERT INTO ingestion_source_jobs (
        run_id,
        source_id,
        action,
        status,
        source_version,
        raw_object_key,
        generated_prefix,
        message,
        updated_at,
        completed_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
      ON CONFLICT(run_id, source_id, action) DO UPDATE SET
        status = excluded.status,
        source_version = excluded.source_version,
        raw_object_key = excluded.raw_object_key,
        generated_prefix = excluded.generated_prefix,
        message = excluded.message,
        updated_at = CURRENT_TIMESTAMP,
        completed_at = excluded.completed_at
    `,
  )
    .bind(
      job.runId,
      job.sourceId,
      job.action,
      job.status,
      job.sourceVersion ?? null,
      job.rawObjectKey ?? null,
      job.generatedPrefix ?? null,
      job.message ?? null,
      job.status === 'completed' ? new Date().toISOString() : null,
    )
    .run()
}

function assertAllowedSourceUrl(value: string, source: IngestionSource) {
  const url = new URL(value)
  const landingUrl = new URL(source.landingUrl)
  const allowedHosts = new Set([
    landingUrl.hostname,
    'www.nhc.noaa.gov',
    'esa-worldcover.s3.eu-central-1.amazonaws.com',
    'esa-worldcover.org',
    'zenodo.org',
    'www.worldpop.org',
    'hub.worldpop.org',
  ])

  if (!allowedHosts.has(url.hostname)) {
    throw new Error(
      `Source ${source.id} attempted to fetch a non-allowlisted host: ${url.hostname}`,
    )
  }
}
