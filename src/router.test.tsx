import { describe, expect, it } from 'vitest'
import { matchPath, resolveRoute, ROUTE_TABLE } from './router'

describe('router', () => {
  it('matches params and prefixes', () => {
    expect(matchPath('/games/:slug', '/games/the-vault')).toEqual({ params: { slug: 'the-vault' }, rest: '/' })
    expect(matchPath('/games/:slug', '/games/the-vault/')).toEqual({ params: { slug: 'the-vault' }, rest: '/' })
    expect(matchPath('/games/:slug', '/games')).toBeNull()
    expect(matchPath('/m', '/m/log/new', true)).toEqual({ params: {}, rest: '/log/new' })
    expect(matchPath('/m', '/m', true)).toEqual({ params: {}, rest: '/' })
    expect(matchPath('/m', '/mobile', true)).toBeNull()
    expect(matchPath('/invite/:code', '/invite/%E0%A4%A')).toBeNull()
  })

  it('has a page for every Phase 2 client route', () => {
    const patterns = ROUTE_TABLE.map((r) => r.pattern)
    for (const p of ['/', '/m', '/games/:slug', '/venues/:slug', '/cities/:slug', '/daily', '/settings', '/invite/:code']) expect(patterns).toContain(p)
    expect(resolveRoute('/daily').entry?.pattern).toBe('/daily')
    expect(resolveRoute('/nope').entry).toBeNull()
  })
})
