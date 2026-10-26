import { describe, expect, it } from 'vitest'
import { ApiCallError } from '../contracts/errors'
import { badgeCount, checkHandle, errorText, exportFileName, fetchExport, inviteMessage, localHandleCheck, normaliseSearch, settle, smsHref, visitsToConfirm } from './client'
import { apiError, claim, fakeApi, notification, pendingTag } from './testing/fakeApi'

describe('social client helpers', () => {
  it('normalises friend searches', () => {
    expect(normaliseSearch('  Mia ')).toBe('@mia')
    expect(normaliseSearch('@@Mia')).toBe('@mia')
    expect(normaliseSearch('Mia@Example.com ')).toBe('mia@example.com')
    expect(normaliseSearch('   ')).toBe('')
  })

  it('counts visits to confirm without double-counting a visit', () => {
    expect(visitsToConfirm([], [])).toBe(0)
    expect(visitsToConfirm([pendingTag(), pendingTag({ visitId: 'vis_g1', participantId: 'x' })], [claim()])).toBe(3)
  })

  it('badge counts unread plus pending tags not already covered by an unread notification', () => {
    const tags = [pendingTag(), pendingTag({ visitId: 'vis_b', participantId: 'p2' })]
    const covered = notification({ type: 'tagged', visitId: 'vis_tag' })
    expect(badgeCount(1, [covered], tags)).toBe(2)
    expect(badgeCount(0, [], tags)).toBe(2)
    // A read notification doesn't cover anything.
    expect(badgeCount(0, [{ ...covered, readAt: '2026-10-21T00:00:00Z' }], tags)).toBe(2)
    expect(badgeCount(5, [], [])).toBe(5)
  })

  it('checks handles locally like HandleSchema', () => {
    expect(localHandleCheck('@Mia_1')).toEqual({ handle: 'mia_1', error: null })
    expect(localHandleCheck('ab').error).toBeTruthy()
    expect(localHandleCheck('9lives').error).toBeTruthy()
    expect(localHandleCheck('has space').error).toBeTruthy()
    expect(localHandleCheck('').error).toBe('Pick a handle.')
    expect(localHandleCheck('a'.repeat(25)).error).toBeTruthy()
  })

  it('checks handles on the server only when needed', async () => {
    const api = fakeApi({ handleAvailable: (req) => ({ handle: req.params.handle, available: false, reason: req.params.handle === 'admin' ? 'reserved' : 'taken' }) })
    expect(await checkHandle('x', null, { fetch: api.fetch })).toMatchObject({ state: 'invalid' })
    expect(await checkHandle('Alice', 'alice', { fetch: api.fetch })).toEqual({ state: 'available' })
    expect(api.log).toHaveLength(0)
    expect(await checkHandle('admin', null, { fetch: api.fetch })).toEqual({ state: 'unavailable', message: 'That handle is reserved.' })
    expect(await checkHandle('bobby', null, { fetch: api.fetch })).toEqual({ state: 'unavailable', message: 'That handle is taken.' })
    const down = fakeApi({ handleAvailable: () => apiError(503, 'db_unavailable') })
    expect(await checkHandle('bobby', null, { fetch: down.fetch })).toMatchObject({ state: 'error' })
  })

  it('writes invite text and sms links', () => {
    const text = inviteMessage('https://x.test/invite/A', 'Brennan')
    expect(text).toBe('Brennan invited you to My Escapes, so we can log the escape rooms we play together: https://x.test/invite/A')
    expect(inviteMessage('u', null).startsWith("You're invited")).toBe(true)
    expect(smsHref('a b&c')).toBe('sms:?&body=a%20b%26c')
  })

  it('names the export file by date', () => {
    expect(exportFileName(new Date('2026-10-26T05:00:00Z'))).toBe('myescapes-export-2026-10-26.json')
  })

  it('fetches the export raw and maps errors', async () => {
    const ok = fakeApi({ exportMe: () => ({ format: 'myescapes-export-v1', anything: [1, 2] }) })
    expect(JSON.parse(await fetchExport({ fetch: ok.fetch }))).toEqual({ format: 'myescapes-export-v1', anything: [1, 2] })
    const bad = fakeApi({ exportMe: () => apiError(401, 'unauthorized', 'Sign in first.') })
    const err = await fetchExport({ fetch: bad.fetch }).catch((e) => e)
    expect(err).toBeInstanceOf(ApiCallError)
    expect(err.status).toBe(401)
    expect(err.code).toBe('unauthorized')
  })

  it('turns errors into friendly text', () => {
    expect(errorText(new ApiCallError(401, undefined, 'x'))).toBe('Sign in to see this.')
    expect(errorText(new ApiCallError(501, undefined, 'x'))).toBe("This part isn't ready yet.")
    expect(errorText(new ApiCallError(409, { error: 'Taken.', code: 'conflict' }, 'x'))).toBe('Taken.')
    expect(errorText(new TypeError('Failed to fetch'))).toMatch(/connection/)
    expect(errorText('weird')).toBe('Something went wrong.')
  })

  it('settles promises into sections', async () => {
    expect(await settle(Promise.resolve(1))).toEqual({ ok: true, data: 1 })
    const s = await settle(Promise.reject('boom'))
    expect(s.ok).toBe(false)
  })
})
