/**
 * Test helpers for the social route suites (friends, visits, reviews, claims). Not a test file.
 * One PGlite app per suite; `reset()` reloads the fixtures between tests.
 */
import type { InjectOptions } from 'fastify'
import { FX, loadFixtures } from '../db/fixtures'
import { resetDb } from '../db/testing'
import { buildTestApp, type TestApp } from '../testing'

export interface Res {
  status: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any
}

export interface Kit {
  t: TestApp
  api(as: string | null, method: InjectOptions['method'], url: string, payload?: unknown): Promise<Res>
  reset(): Promise<void>
  close(): Promise<void>
}

export async function socialKit(): Promise<Kit> {
  const t = await buildTestApp({ fixtures: true })
  return {
    t,
    async api(as, method, url, payload) {
      const res = await t.inject({ method, url, ...(as ? { as } : {}), ...(payload !== undefined ? { payload: payload as InjectOptions['payload'] } : {}) })
      const body = res.headers['content-type']?.includes('json') ? res.json() : res.body
      return { status: res.statusCode, body }
    },
    async reset() {
      await resetDb(t.db)
      await loadFixtures(t.db)
    },
    close: () => t.close(),
  }
}

export const U = FX.users

/** Ratings with one score for every key. */
export function ratings(overall: number, rest = overall, comment = '') {
  return {
    overall: { score: overall, comment },
    puzzles: { score: rest, comment: '' },
    setting: { score: rest, comment: '' },
    storyline: { score: rest, comment: '' },
    difficulty: { score: rest, comment: '' },
  }
}

export function facts(date: string, extra: Record<string, unknown> = {}) {
  return { date, escaped: true, escapeTimeMinutes: 50, visibleTimer: true, multiRoom: false, flashlights: false, liveActors: false, toolsUsed: [], ...extra }
}

/** JSON text of a response, for "never contains" checks. */
export const text = (r: Res) => JSON.stringify(r.body)
