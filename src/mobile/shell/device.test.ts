import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyMobileManifest, isPhone, MOBILE_MANIFEST, prefersDesktop, setDesktopPreference, shouldRedirectToMobile, VIEW_PREF_KEY } from './device'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const ANDROID_PHONE = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'
const ANDROID_TABLET = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

const media = (coarse: boolean, small: boolean) => (q: string) => ({ matches: q.includes('pointer') ? coarse : small })
const noMedia = media(false, false)
const at = (pathname: string, search = '') => ({ pathname, search })

beforeEach(() => localStorage.clear())
afterEach(() => localStorage.clear())

describe('device redirect', () => {
  it('sends phones on / to /m, but not tablets or desktops', () => {
    expect(shouldRedirectToMobile(at('/'), { userAgent: IPHONE }, noMedia)).toBe(true)
    expect(shouldRedirectToMobile(at('/'), { userAgent: ANDROID_PHONE }, noMedia)).toBe(true)
    expect(shouldRedirectToMobile(at('/'), { userAgent: ANDROID_TABLET }, noMedia)).toBe(false)
    expect(shouldRedirectToMobile(at('/'), { userAgent: IPAD }, media(true, false))).toBe(false)
    expect(shouldRedirectToMobile(at('/'), { userAgent: DESKTOP }, noMedia)).toBe(false)
  })

  it('treats a coarse pointer on a small screen as a phone (UA-less browsers)', () => {
    expect(isPhone({ userAgent: DESKTOP }, media(true, true))).toBe(true)
    expect(isPhone({ userAgent: DESKTOP }, media(false, true))).toBe(false)
    expect(isPhone({ userAgent: DESKTOP }, undefined)).toBe(false)
  })

  it('only redirects the home page', () => {
    expect(shouldRedirectToMobile(at('/games/x'), { userAgent: IPHONE }, noMedia)).toBe(false)
    expect(shouldRedirectToMobile(at('/daily'), { userAgent: IPHONE }, noMedia)).toBe(false)
  })

  it('"View on desktop" is remembered, and ?mobile=1 forgets it', () => {
    expect(shouldRedirectToMobile(at('/', '?desktop=1'), { userAgent: IPHONE }, noMedia)).toBe(false)
    expect(localStorage.getItem(VIEW_PREF_KEY)).toBe('desktop')
    expect(prefersDesktop()).toBe(true)
    expect(shouldRedirectToMobile(at('/'), { userAgent: IPHONE }, noMedia)).toBe(false)
    expect(shouldRedirectToMobile(at('/', '?mobile=1'), { userAgent: IPHONE }, noMedia)).toBe(true)
    expect(prefersDesktop()).toBe(false)
    setDesktopPreference(true)
    expect(shouldRedirectToMobile(at('/'), { userAgent: IPHONE }, noMedia)).toBe(false)
  })

  it('points the manifest link at the mobile manifest while /m is shown, then restores it', () => {
    document.head.innerHTML = '<link rel="manifest" href="/manifest.webmanifest">'
    const restore = applyMobileManifest(document)
    expect(document.querySelector('link[rel="manifest"]')?.getAttribute('href')).toBe(MOBILE_MANIFEST)
    restore()
    expect(document.querySelector('link[rel="manifest"]')?.getAttribute('href')).toBe('/manifest.webmanifest')
    document.head.innerHTML = ''
    const restore2 = applyMobileManifest(document)
    expect(document.querySelectorAll('link[rel="manifest"]')).toHaveLength(1)
    restore2()
    expect(document.querySelectorAll('link[rel="manifest"]')).toHaveLength(0)
  })
})

describe('mobileRedirectURL', () => {
  it('sends phones to /m and keeps a Google sign-in failure so /m can show it', async () => {
    const { mobileRedirectURL } = await import('./device')
    expect(mobileRedirectURL('')).toBe('/m')
    expect(mobileRedirectURL('?demo=1')).toBe('/m')
    expect(mobileRedirectURL('?error=state_mismatch')).toBe('/m?signin=failed&error=state_mismatch')
    expect(mobileRedirectURL('?error=a%26b%3Dc')).toBe('/m?signin=failed&error=a%26b%3Dc')
  })
})
