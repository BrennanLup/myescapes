// @vitest-environment node
/**
 * Auth (workstream 3): real Better Auth sessions on PGlite, the test-only login (and proof that it
 * is absent outside NODE_ENV=test), Google scopes, cookie attributes, and the Fastify bridge.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { accounts, sessions, users } from '../db/schema'
import { buildTestApp, type TestApp } from '../testing'
import { authMode, resolveUser } from './index'
import { authBaseUrl, authOptions, authSecret, DISABLED_AUTH_PATHS, GOOGLE_SCOPES, secureCookiesFor } from './config'

/** Pull `name=value` pairs out of Set-Cookie headers, for sending back as a Cookie header. */
function cookieHeader(setCookie: string | string[] | undefined): string {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []
  return list.map((c) => c.split(';')[0]).join('; ')
}

function setCookies(res: { headers: Record<string, unknown> }): string[] {
  const v = res.headers['set-cookie']
  return Array.isArray(v) ? (v as string[]) : v ? [String(v)] : []
}

describe('test login + real sessions (NODE_ENV=test)', () => {
  let t: TestApp
  beforeAll(async () => {
    t = await buildTestApp({ fixtures: true, resolveUser })
  })
  afterAll(async () => {
    await t?.close()
  })

  it('creates a user, sets an http-only session cookie, and /api/me works with it', async () => {
    const login = await t.inject({ method: 'POST', url: '/api/test/login', payload: { email: 'New.Person@Example.com', name: 'New Person' } })
    expect(login.statusCode).toBe(200)
    const body = login.json()
    expect(body.user.email).toBe('new.person@example.com')
    expect(body.user.onboarded).toBe(false)
    expect(body.user.handle).toBeNull()
    const cookies = setCookies(login)
    const session = cookies.find((c) => c.startsWith('myescapes.session_token='))
    expect(session).toBeTruthy()
    expect(session).toMatch(/HttpOnly/i)
    expect(session).toMatch(/SameSite=Lax/i)
    expect(session).toMatch(/Path=\//)

    const me = await t.inject({ method: 'GET', url: '/api/me', headers: { cookie: cookieHeader(cookies) } })
    expect(me.statusCode).toBe(200)
    expect(me.json().id).toBe(body.user.id)
    expect(me.json().id).toMatch(/^usr_/)

    const rows = await t.db.select().from(sessions).where(eq(sessions.userId, body.user.id))
    expect(rows).toHaveLength(1)
  })

  it('reuses an existing user by email and can create an onboarded user with a handle', async () => {
    const a = await t.inject({ method: 'POST', url: '/api/test/login', payload: { email: 'alice@example.com' } })
    expect(a.statusCode).toBe(200)
    expect(a.json().user.id).toBe(t.fx.users.alice)
    const b = await t.inject({ method: 'POST', url: '/api/test/login', payload: { email: 'h@example.com', name: 'Hank', handle: '@Hank_1' } })
    expect(b.json().user).toMatchObject({ handle: 'hank_1', displayName: 'Hank', onboarded: true })
    const bad = await t.inject({ method: 'POST', url: '/api/test/login', payload: { email: 'x@example.com', handle: 'admin' } })
    expect(bad.statusCode).toBe(400)
  })

  it('rejects a tampered or unknown session cookie', async () => {
    const login = await t.inject({ method: 'POST', url: '/api/test/login', payload: { email: 'bob@example.com' } })
    const cookie = cookieHeader(setCookies(login))
    const tampered = cookie.replace(/session_token=([^;.]+)/, 'session_token=AAAA$1')
    expect((await t.inject({ method: 'GET', url: '/api/me', headers: { cookie: tampered } })).statusCode).toBe(401)
    expect((await t.inject({ method: 'GET', url: '/api/me', headers: { cookie: 'myescapes.session_token=nope.nope' } })).statusCode).toBe(401)
    expect((await t.inject({ method: 'GET', url: '/api/me' })).statusCode).toBe(401)
  })

  it('get-session and sign-out go through the Better Auth bridge', async () => {
    const login = await t.inject({ method: 'POST', url: '/api/test/login', payload: { email: 'carol@example.com' } })
    const cookie = cookieHeader(setCookies(login))
    const s = await t.inject({ method: 'GET', url: '/api/auth/get-session', headers: { cookie } })
    expect(s.statusCode).toBe(200)
    expect(s.json().user.id).toBe(t.fx.users.carol)

    const out = await t.inject({ method: 'POST', url: '/api/auth/sign-out', headers: { cookie, 'content-type': 'application/json', origin: 'http://localhost:80' }, payload: '{}' })
    expect(out.statusCode).toBe(200)
    expect(setCookies(out).some((c) => c.startsWith('myescapes.session_token=') && /Max-Age=0/i.test(c))).toBe(true)
    expect((await t.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).statusCode).toBe(401)
  })

  it('expired sessions are not accepted', async () => {
    const login = await t.inject({ method: 'POST', url: '/api/test/login', payload: { email: 'dave@example.com' } })
    const cookie = cookieHeader(setCookies(login))
    await t.db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.userId, t.fx.users.dave))
    expect((await t.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).statusCode).toBe(401)
  })

  it('the update-user and other unused Better Auth endpoints are disabled', async () => {
    const login = await t.inject({ method: 'POST', url: '/api/test/login', payload: { email: 'eve@example.com' } })
    const cookie = cookieHeader(setCookies(login))
    const res = await t.inject({
      method: 'POST',
      url: '/api/auth/update-user',
      headers: { cookie, 'content-type': 'application/json', origin: 'http://localhost:80' },
      payload: JSON.stringify({ name: 'Hacked', handle: 'hacked', isAdmin: true }),
    })
    expect(res.statusCode).toBe(404)
    const row = (await t.db.select().from(users).where(eq(users.id, t.fx.users.eve)))[0]
    expect(row).toMatchObject({ name: 'Eve', handle: 'eve', isAdmin: false })
    expect((await t.inject({ method: 'GET', url: '/api/auth/list-accounts', headers: { cookie } })).statusCode).toBe(404)
    expect((await t.inject({ method: 'POST', url: '/api/auth/sign-in/email', headers: { 'content-type': 'application/json' }, payload: '{"email":"a@b.co","password":"x"}' })).statusCode).toBe(404)
  })

  it('the server-only test sign-in endpoint is never reachable over HTTP', async () => {
    const res = await t.inject({ method: 'POST', url: '/api/auth/test/sign-in', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ userId: t.fx.users.alice }) })
    expect(res.statusCode).toBe(404)
    expect(setCookies(res)).toHaveLength(0)
  })

  it('a request without a session cookie never touches the auth tables', async () => {
    const res = await t.inject({ method: 'GET', url: '/api/me' })
    expect(res.statusCode).toBe(401)
    expect(res.json().code).toBe('unauthorized')
  })
})

describe('the test login is off outside NODE_ENV=test', () => {
  for (const NODE_ENV of ['production', 'development', '']) {
    it(`NODE_ENV=${NODE_ENV || '(unset)'}: POST /api/test/login is 404 and signs nobody in`, async () => {
      const t = await buildTestApp({ fixtures: true, resolveUser, env: { NODE_ENV, BETTER_AUTH_SECRET: 'x'.repeat(40) } })
      try {
        const res = await t.inject({ method: 'POST', url: '/api/test/login', payload: { email: 'alice@example.com' } })
        expect(res.statusCode).toBe(404)
        expect(setCookies(res)).toHaveLength(0)
        // ...and the Better Auth instance has no test endpoint at all.
        const opts = authOptions(t.db, t.ctx.env)
        expect(opts.plugins).toHaveLength(0)
        const via = await t.inject({ method: 'POST', url: '/api/auth/test/sign-in', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ userId: t.fx.users.alice }) })
        expect(via.statusCode).toBe(404)
      } finally {
        await t.close()
      }
    })
  }

  it('production without BETTER_AUTH_SECRET has no secret (auth disabled), never the test secret', () => {
    expect(authSecret({ NODE_ENV: 'production' })).toBeNull()
    expect(authSecret({})).toBeNull()
    expect(authSecret({ NODE_ENV: 'test' })).toBeTruthy()
    expect(authMode({ NODE_ENV: 'production' })).toBe('disabled')
    expect(authMode({ NODE_ENV: 'test' })).toBe('test')
    expect(authMode({ GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b', BETTER_AUTH_SECRET: 'c' })).toBe('google')
  })
})

describe('Google configuration', () => {
  it('asks Google for openid, email and profile only', async () => {
    const t = await buildTestApp({ resolveUser, env: { GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'not-a-real-secret', BETTER_AUTH_SECRET: 'y'.repeat(40), PUBLIC_URL: 'https://escapes.example.com' } })
    try {
      const opts = authOptions(t.db, t.ctx.env)
      expect(opts.socialProviders.google?.scope).toEqual(['openid', 'email', 'profile'])
      expect(GOOGLE_SCOPES).toEqual(['openid', 'email', 'profile'])
      const res = await t.inject({
        method: 'POST',
        url: '/api/auth/sign-in/social',
        headers: { 'content-type': 'application/json', origin: 'https://escapes.example.com' },
        payload: JSON.stringify({ provider: 'google', callbackURL: '/' }),
      })
      expect(res.statusCode).toBe(200)
      const target = new URL(res.json().url)
      expect(target.host).toBe('accounts.google.com')
      expect(target.searchParams.get('scope')!.split(' ').sort()).toEqual(['email', 'openid', 'profile'])
      expect(target.searchParams.get('redirect_uri')).toBe('https://escapes.example.com/api/auth/callback/google')
      expect(target.searchParams.get('client_id')).toBe('cid.apps.googleusercontent.com')
      // The state cookie is Secure on an https origin.
      expect(setCookies(res).every((c) => /Secure/i.test(c) && /HttpOnly/i.test(c))).toBe(true)
    } finally {
      await t.close()
    }
  })

  it('rejects an open-redirect callbackURL', async () => {
    const t = await buildTestApp({ resolveUser, env: { GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 's', BETTER_AUTH_SECRET: 'y'.repeat(40), PUBLIC_URL: 'https://escapes.example.com' } })
    try {
      const res = await t.inject({
        method: 'POST',
        url: '/api/auth/sign-in/social',
        headers: { 'content-type': 'application/json', origin: 'https://escapes.example.com' },
        payload: JSON.stringify({ provider: 'google', callbackURL: 'https://evil.example.net/steal' }),
      })
      expect(res.statusCode).toBeGreaterThanOrEqual(400)
    } finally {
      await t.close()
    }
  })

  it('does not keep Google OAuth tokens', async () => {
    const t = await buildTestApp({ fixtures: true, resolveUser })
    try {
      const { createAuth } = await import('./config')
      const auth = createAuth(t.db, t.ctx.env)
      const actx = await auth.$context
      await actx.internalAdapter.createAccount({ userId: t.fx.users.alice, providerId: 'google', accountId: 'g-123', accessToken: 'ya29.secret', refreshToken: 'r', idToken: 'i', scope: 'openid email profile' })
      const row = (await t.db.select().from(accounts).where(eq(accounts.accountId, 'g-123')))[0]
      expect(row).toMatchObject({ accessToken: null, refreshToken: null, idToken: null })
    } finally {
      await t.close()
    }
  })

  it('refuses to create a user whose email the provider did not verify', async () => {
    const t = await buildTestApp({ fixtures: true, resolveUser })
    try {
      const { createAuth } = await import('./config')
      const actx = await createAuth(t.db, t.ctx.env).$context
      const account = { providerId: 'google', accountId: 'g-unverified', scope: 'openid email profile' }
      await expect(
        actx.internalAdapter.createOAuthUser({ email: 'Unverified@Example.com', name: 'Mallory', emailVerified: false, image: null }, account),
      ).rejects.toThrow()
      expect(await t.db.select().from(users).where(eq(users.email, 'unverified@example.com'))).toHaveLength(0)
      expect(await t.db.select().from(accounts).where(eq(accounts.accountId, 'g-unverified'))).toHaveLength(0)
      const ok = await actx.internalAdapter.createOAuthUser({ email: 'verified@example.com', name: 'Vera', emailVerified: true, image: null }, { ...account, accountId: 'g-verified' })
      expect(ok.user).toMatchObject({ email: 'verified@example.com', emailVerified: true })
    } finally {
      await t.close()
    }
  })

  it('base URL and secure cookies', () => {
    expect(authBaseUrl({ PUBLIC_URL: 'https://a.example/' })).toBe('https://a.example')
    expect(authBaseUrl({ RAILWAY_PUBLIC_DOMAIN: 'bubbly-hope-production.up.railway.app' })).toBe('https://bubbly-hope-production.up.railway.app')
    expect(authBaseUrl({})).toBeUndefined()
    expect(secureCookiesFor({ NODE_ENV: 'production' })).toBe(true)
    expect(secureCookiesFor({ RAILWAY_PUBLIC_DOMAIN: 'x.up.railway.app' })).toBe(true)
    expect(secureCookiesFor({ NODE_ENV: 'test' })).toBe(false)
    expect(DISABLED_AUTH_PATHS).toContain('/update-user')
  })
})

describe('sign-in rate limit is per client behind a proxy', () => {
  it('keys Better Auth limits on the address Fastify trusts, not one shared bucket, and ignores a client-sent IP header', async () => {
    const origin = 'https://escapes.example.com'
    const t = await buildTestApp({
      resolveUser,
      env: { NODE_ENV: 'production', GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 's', BETTER_AUTH_SECRET: 'z'.repeat(40), PUBLIC_URL: origin },
    })
    // Railway's edge appends the client to X-Forwarded-For, so the header is a chain.
    const signIn = (client: string, extra: Record<string, string> = {}) =>
      t.inject({
        method: 'POST',
        url: '/api/auth/sign-in/social',
        headers: { 'content-type': 'application/json', origin, 'x-forwarded-for': `198.51.100.77, ${client}`, ...extra },
        payload: JSON.stringify({ provider: 'google', callbackURL: '/' }),
      })
    try {
      let limited = false
      for (let i = 0; i < 80 && !limited; i++) limited = (await signIn('203.0.113.10')).statusCode === 429
      expect(limited).toBe(true)
      // The same client cannot dodge its limit by naming another address in our private header.
      expect((await signIn('203.0.113.10', { 'x-myescapes-client-ip': '192.0.2.200' })).statusCode).toBe(429)
      // Another visitor is unaffected.
      expect((await signIn('203.0.113.20')).statusCode).toBe(200)
    } finally {
      await t.close()
    }
  })

  it('never stores the client address on a session row', async () => {
    const t = await buildTestApp({ fixtures: true, resolveUser })
    try {
      const login = await t.inject({ method: 'POST', url: '/api/test/login', headers: { 'x-forwarded-for': '203.0.113.30' }, payload: { email: 'ip.check@example.com', name: 'Ip Check' } })
      expect(login.statusCode).toBe(200)
      const rows = await t.db.select().from(sessions)
      expect(rows.length).toBeGreaterThan(0)
      expect(rows.every((r) => r.ipAddress === null)).toBe(true)
    } finally {
      await t.close()
    }
  })
})
