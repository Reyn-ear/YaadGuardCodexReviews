import { primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

export const ingestionRuns = sqliteTable('ingestion_runs', {
  runId: text('run_id').primaryKey(),
  status: text('status').notNull(),
  requestedBy: text('requested_by'),
  sourceIds: text('source_ids', { mode: 'json' }).$type<string[]>().notNull(),
  manifestKey: text('manifest_key'),
  createdAt: text('created_at')
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  updatedAt: text('updated_at')
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
})

export const ingestionSourceJobs = sqliteTable(
  'ingestion_source_jobs',
  {
    runId: text('run_id').notNull(),
    sourceId: text('source_id').notNull(),
    action: text('action').notNull(),
    status: text('status').notNull(),
    sourceVersion: text('source_version'),
    rawObjectKey: text('raw_object_key'),
    generatedPrefix: text('generated_prefix'),
    message: text('message'),
    createdAt: text('created_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: text('updated_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    completedAt: text('completed_at'),
  },
  (table) => [
    primaryKey({
      columns: [table.runId, table.sourceId, table.action],
      name: 'ingestion_source_jobs_pk',
    }),
  ],
)

export type IngestionRunRow = typeof ingestionRuns.$inferSelect
export type NewIngestionRunRow = typeof ingestionRuns.$inferInsert
export type IngestionSourceJobRow = typeof ingestionSourceJobs.$inferSelect
export type NewIngestionSourceJobRow = typeof ingestionSourceJobs.$inferInsert
