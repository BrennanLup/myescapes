// PLACEHOLDER (orchestrator). Owned by workstream 14: Data Layer.
import type { FastifyInstance } from 'fastify'
import { API } from '../../src/contracts/api'
import type { Dataset } from '../../src/contracts/types'
import { FIXTURE_DATASET } from '../../src/contracts/fixtures'

export function storageMode(): 'google-sheet' | 'seed' {
  return process.env.GOOGLE_SHEET_ID && process.env.GOOGLE_SERVICE_ACCOUNT_JSON ? 'google-sheet' : 'seed'
}

export async function sheetRoutes(app: FastifyInstance) {
  app.get(API.data, async (): Promise<Dataset> => FIXTURE_DATASET)
}
