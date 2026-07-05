import { drizzle as drizzleD1 } from 'drizzle-orm/d1'
import { ingestionRuns, ingestionSourceJobs } from './schema/ingestion'
import { stormHistoryPoints } from './schema/stormHistory'
import { surgeReturnLevels } from './schema/surgeReturnLevels'
import {
  terrainAnalysisCells,
  terrainSummaries,
} from './schema/terrainSummaries'
import { worldpopCountryPayloads } from './schema/worldpop'

const schema = {
  ingestionRuns,
  ingestionSourceJobs,
  stormHistoryPoints,
  surgeReturnLevels,
  terrainAnalysisCells,
  terrainSummaries,
  worldpopCountryPayloads,
}

export type Db = ReturnType<typeof drizzle>

export function drizzle(database: D1Database) {
  return drizzleD1(database, { schema })
}
