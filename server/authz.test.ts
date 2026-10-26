// @vitest-environment node
/**
 * Permission suite (workstream 38): every rule in "Who can do what" (docs/PHASE2_PLAN.md) as an
 * API test against buildTestApp({ fixtures: true }). The `todo`s are the checklist; each becomes
 * a real test as the routes land. Fixture people and visits: server/db/fixtures.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ROUTE_LIST } from '../src/contracts/routes'
import { buildTestApp, type TestApp } from './testing'

let t: TestApp
beforeAll(async () => {
  t = await buildTestApp({ fixtures: true })
})
afterAll(async () => {
  await t?.close()
})

describe('authz baseline', () => {
  it('every user-only route answers 401 when signed out', async () => {
    for (const r of ROUTE_LIST.filter((x) => x.auth === 'user' || x.auth === 'admin')) {
      const url = r.path.replace(/:([A-Za-z_]+)/g, 'x')
      const res = await t.inject({ method: r.method, url, payload: r.body && r.body !== 'multipart' ? {} : undefined })
      expect(res.statusCode, `${r.method} ${r.path}`).toBe(401)
    }
  })

  it('admin routes answer 403 for a signed-in non-admin', async () => {
    for (const r of ROUTE_LIST.filter((x) => x.auth === 'admin')) {
      const url = r.path.replace(/:([A-Za-z_]+)/g, 'x')
      const res = await t.inject({ method: r.method, url, as: t.fx.users.alice, payload: r.body && r.body !== 'multipart' ? {} : undefined })
      expect(res.statusCode, `${r.method} ${r.path}`).toBe(403)
    }
  })
})

describe('who can do what', () => {
  it.todo('see a visit: accepted participants only; others only through a public review')
  it.todo('edit shared facts: any accepted participant, recorded in visit_edits')
  it.todo('add photos: any accepted participant; only the uploader can remove their own')
  it.todo('write or edit a review: only its author')
  it.todo('tag someone with an account: only their accepted friends')
  it.todo('remove yourself from a visit: any participant; review removed, visit stays')
  it.todo('delete a visit: creator, only when nobody else accepted')
  it.todo('review visibility: public, friends only, private; a visit with only private reviews never appears publicly')
  it.todo('transcripts and emails never appear in another user\'s responses')
  it.todo('account deletion removes reviews, photos, friendships; tags become plain names')
})
