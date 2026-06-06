interface CloudflareBindings {
  DB?: D1Database
  ASSETS?: Fetcher
  YAAD_GUARD_BUCKET?: R2Bucket
  DATASET_INGESTION?: Workflow<IngestionWorkflowParams>
  INGESTION_QUEUE?: Queue<IngestionQueueMessage>
  GEOSPATIAL_PROCESSOR?: DurableObjectNamespace
  INGESTION_ADMIN_TOKEN?: string
  ACTIVE_MANIFEST_KEY?: string
  TERRAIN_PMTILES_KEY?: string
}

interface IngestionWorkflowParams {
  sourceIds?: string[]
  runId?: string
  requestedBy?: string
}

interface IngestionQueueMessage {
  runId: string
  sourceId: string
  action: 'download-source' | 'process-source'
}

declare namespace Cloudflare {
  interface Env extends CloudflareBindings {}
}
