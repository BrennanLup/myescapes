import { callApi, ROUTES } from '@/contracts/routes'
import type { GameSummary, VenueSummary } from '@/contracts/models'

export interface DirectoryQuery {
  q: string
  lat?: number
  lng?: number
  country?: string
  limit?: number
}

export async function searchDirectory(query: DirectoryQuery, signal?: AbortSignal): Promise<{ games: GameSummary[]; venues: VenueSummary[] }> {
  return callApi(ROUTES.directorySearch, { query }, { signal })
}
