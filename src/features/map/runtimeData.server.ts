import { env } from 'cloudflare:workers'
import { z } from 'zod'

const activeManifestSchema = z.object({
  runId: z.string().optional(),
  generatedPrefix: z.string().trim().optional(),
  artifactVersion: z.string().optional(),
  sourceId: z.string().optional(),
  sourceVersion: z.string().optional(),
  sourceChecksum: z.string().optional(),
  coverageId: z.string().optional(),
  coverageChecksum: z.string().optional(),
  configurationChecksum: z.string().optional(),
  terrain: z
    .object({
      source: z.string(),
      pmtilesKey: z.string(),
      attribution: z.string().optional(),
    })
    .passthrough()
    .optional(),
})

export type ActiveManifest = z.infer<typeof activeManifestSchema>

let activeManifestPromise: Promise<ActiveManifest | null> | null = null

export function getRuntimeBucket() {
  return env.YAAD_GUARD_BUCKET ?? null
}

export async function readR2Object(key: string) {
  const bucket = getRuntimeBucket()
  if (!bucket) {
    return null
  }

  return bucket.get(key)
}

export async function readR2Text(key: string) {
  const object = await readR2Object(key)
  return object ? object.text() : null
}

export async function readR2Json<T>(key: string, schema: z.ZodType<T>) {
  try {
    const payload = await readR2Text(key)
    if (!payload) {
      return null
    }

    return schema.parse(JSON.parse(payload))
  } catch {
    return null
  }
}

export async function getActiveManifest() {
  activeManifestPromise ??= (async () => {
    const manifestKey = env.ACTIVE_MANIFEST_KEY ?? 'manifests/active.json'

    return readR2Json(manifestKey, activeManifestSchema)
  })()

  return activeManifestPromise
}

export async function resolveGeneratedObjectKey(key: string) {
  const normalizedKey = key.replace(/^\/+/, '')
  const manifest = await getActiveManifest()
  const prefix = manifest?.generatedPrefix?.replace(/^\/+|\/+$/g, '')

  return prefix ? `${prefix}/${normalizedKey}` : normalizedKey
}

export async function readGeneratedObject(key: string) {
  return readR2Object(await resolveGeneratedObjectKey(key))
}

export async function writeGeneratedObject(
  key: string,
  value: ReadableStream | ArrayBuffer | ArrayBufferView | string,
  options?: R2PutOptions,
) {
  const bucket = getRuntimeBucket()
  if (!bucket) {
    return null
  }

  return bucket.put(await resolveGeneratedObjectKey(key), value, options)
}

export async function readGeneratedText(key: string) {
  const object = await readGeneratedObject(key)
  return object ? object.text() : null
}

export async function readGeneratedJson<T>(key: string, schema: z.ZodType<T>) {
  try {
    const payload = await readGeneratedText(key)
    if (!payload) {
      return null
    }

    return schema.parse(JSON.parse(payload))
  } catch {
    return null
  }
}
