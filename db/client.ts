import { drizzle as drizzleD1 } from 'drizzle-orm/d1'
import * as schema from './schema'

export type Db = ReturnType<typeof drizzle>

export function drizzle(database: D1Database) {
  return drizzleD1(database, { schema })
}
