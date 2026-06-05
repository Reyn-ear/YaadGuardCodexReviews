import { drizzle } from 'drizzle-orm/d1'
import { env } from 'cloudflare:workers'
import * as schema from './schema'

type D1Client = ReturnType<typeof drizzle<typeof schema>>

let cachedDb: D1Client | null = null

export class D1BindingError extends Error {
  constructor(bindingName: string) {
    super(`Missing Cloudflare D1 binding: ${bindingName}`)
    this.name = 'D1BindingError'
  }
}

function resolveD1Binding(database?: D1Database) {
  const binding = database ?? (env as Partial<CloudflareBindings>).DB

  if (!binding) {
    throw new D1BindingError('DB')
  }

  return binding
}

export function createDb(database?: D1Database) {
  return drizzle(resolveD1Binding(database), { schema })
}

export function getDb(database?: D1Database) {
  if (database) {
    return createDb(database)
  }

  cachedDb ??= createDb()
  return cachedDb
}

export const db = new Proxy({} as D1Client, {
  get(_target, property, receiver) {
    return Reflect.get(getDb(), property, receiver)
  },
})

export { schema }
