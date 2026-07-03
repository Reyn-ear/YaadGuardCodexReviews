import { env } from 'cloudflare:workers'
import type { z } from 'zod'

const GENERATED_DATA_PREFIX = 'data'

function getRuntimeBucket() {
  return env.YAAD_GUARD_BUCKET ?? null
}

async function readR2Object(key: string) {
  const bucket = getRuntimeBucket()
  if (!bucket) {
    return null
  }

  return bucket.get(key)
}

function resolveDataObjectKey(key: string) {
  const normalizedKey = key.replace(/^\/+/, '')

  return `${GENERATED_DATA_PREFIX}/${normalizedKey}`
}

export async function readGeneratedObject(key: string) {
  return readR2Object(resolveDataObjectKey(key))
}

async function readGeneratedText(key: string) {
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
