// @vitest-environment node
/**
 * "Your email address: only us. It is never shown on public pages." (/privacy)
 *
 * Sweep: every public or optional GET route in the contract, called signed out and signed in as a
 * stranger, with fixture ids filled in, must never return anyone's email. Routes that are still
 * stubs answer 501 and pass trivially; the sweep keeps guarding them as they land.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PublicUserSchema } from '../../src/contracts/models'
import { ROUTE_LIST } from '../../src/contracts/routes'
import { FX } from '../db/fixtures'
import { buildTestApp, type TestApp } from '../testing'

let t: TestApp
beforeAll(async () => {
  t = await buildTestApp({ fixtures: true })
})
afterAll(async () => {
  await t?.close()
})

/** Candidate values for each path parameter, by route. */
function urlsFor(path: string): string[] {
  const fill = (values: Record<string, string[]>) => {
    let urls = [path]
    for (const [name, vals] of Object.entries(values)) {
      if (!path.includes(`:${name}`)) continue
      urls = urls.flatMap((u) => vals.map((v) => u.replace(`:${name}`, encodeURIComponent(v))))
    }
    return urls
  }
  if (path.startsWith('/api/games/')) return fill({ slug: Object.values(FX.gameSlugs) })
  if (path.startsWith('/api/venues/')) return fill({ slug: Object.values(FX.venueSlugs) })
  if (path.startsWith('/api/cities/')) return fill({ slug: Object.values(FX.cities) })
  if (path.startsWith('/api/reviews/')) return fill({ id: Object.values(FX.reviews) })
  if (path.startsWith('/api/photos/')) return fill({ id: Object.values(FX.photos) })
  if (path.startsWith('/api/invites/')) return fill({ code: Object.values(FX.invites) })
  if (path.startsWith('/api/handles/')) return fill({ handle: ['alice', 'bob', 'newbie'] })
  if (path === '/api/directory/search') return ['/api/directory/search?q=starlight', '/api/directory/search?q=lighthouse']
  if (path === '/api/directory/nearby') return ['/api/directory/nearby?lat=37.78&lng=-122.39']
  if (path === '/api/directory/match') return ['/api/directory/match?venue=Starlight&game=Observatory&city=San%20Francisco']
  return [path.replace(/:([A-Za-z_]+)/g, 'x')]
}

describe('no public endpoint exposes an email', () => {
  const routes = ROUTE_LIST.filter((r) => r.method === 'GET' && (r.auth === 'public' || r.auth === 'optional'))

  it('covers the public routes', () => {
    expect(routes.length).toBeGreaterThan(10)
  })

  for (const as of [undefined, FX.users.carol]) {
    it(`signed ${as ? 'in as a stranger' : 'out'}`, async () => {
      for (const r of routes) {
        for (const url of urlsFor(r.path)) {
          const res = await t.inject({ method: 'GET', url, as })
          expect(res.body, `${url}`).not.toMatch(/[a-z0-9._-]+@example\.com/i)
        }
      }
    })
  }

  it('PublicUser has no email field, and parsing strips one', () => {
    expect(Object.keys(PublicUserSchema.shape)).not.toContain('email')
    const parsed = PublicUserSchema.parse({ id: 'u', handle: 'h', displayName: 'D', image: null, email: 'leak@example.com' })
    expect(JSON.stringify(parsed)).not.toContain('leak@')
  })
})
