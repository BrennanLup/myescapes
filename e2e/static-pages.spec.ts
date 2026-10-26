/**
 * The static pages (/about, /privacy, /terms: public/*.html served by server/static.ts) are linked
 * from Google's consent screen, so they must keep working, be linked from the app, and every
 * promise in /privacy must hold. Runs on the desktop and mobile projects.
 */
import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { newDevice, person, signIn, watchErrors } from './support/morning'

const PAGES = [
  { path: '/about', title: /My Escapes/, heading: /My Escapes/i },
  { path: '/privacy', title: /^Privacy policy · My Escapes$/, heading: /Privacy policy/ },
  { path: '/terms', title: /^Terms of service · My Escapes$/, heading: /Terms of service/ },
] as const

test.describe('static pages', () => {
  for (const p of PAGES) {
    test(`${p.path} is served as its own HTML page, readable and linked to the others`, async ({ page, request }) => {
      const errors: string[] = []
      watchErrors(page, errors)
      const res = await request.get(p.path)
      expect(res.status()).toBe(200)
      expect(res.headers()['content-type']).toMatch(/text\/html/)
      const html = await res.text()
      // The real page, not the SPA shell.
      expect(html).not.toContain('id="root"')

      await page.goto(p.path)
      await expect(page).toHaveTitle(p.title)
      await expect(page.getByRole('heading', { level: 1 })).toContainText(p.heading)
      for (const other of ['/about', '/privacy', '/terms']) {
        if (other !== p.path) await expect(page.locator(`a[href="${other}"]`).first()).toBeAttached()
      }
      // Nothing scrolls sideways on a phone.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
      // A trailing slash and HEAD work too (crawlers and Google's consent-screen checks).
      expect((await request.get(`${p.path}/`)).status()).toBeLessThan(400)
      expect((await request.head(p.path)).status()).toBe(200)
      expect(errors).toEqual([])
    })
  }

  test('the legal links are on the landing page, the mobile app, settings and Escape of the Day', async ({ page, isMobile }) => {
    const hrefs = ['/about', '/privacy', '/terms']
    await page.goto(isMobile ? '/m' : '/')
    await expect(page.getByTestId(isMobile ? 'mobile-app' : 'landing-page')).toBeVisible()
    for (const h of hrefs) await expect(page.locator(`a[href="${h}"]`).first()).toBeVisible()
    await page.goto('/daily')
    await expect(page.getByTestId('daily-page')).toBeVisible()
    for (const h of hrefs) await expect(page.locator(`a[href="${h}"]`).first()).toBeAttached()
    await page.goto('/settings')
    await expect(page.getByTestId('legal-links')).toBeVisible()
    // Following a link from the app lands on the real page.
    await page.locator('a[href="/privacy"]').first().click()
    await expect(page).toHaveURL(/\/privacy$/)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Privacy policy')
  })
})

test.describe('privacy promises', () => {
  test('email never public; download my data as JSON; deleting the account removes reviews and voice notes', async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(10 * 60_000)
    const run = Date.now().toString(36).slice(-5)
    const me = person(`priv_${testInfo.project.name.slice(0, 3)}`, 'Privacy Tester', run)
    const errors: string[] = []
    const phone = await newDevice(browser, baseURL!, 'phone')
    await signIn(phone, me, { onboarded: true })
    const page = await phone.newPage()
    watchErrors(page, errors)

    // Log a room by voice (fake microphone, mock transcription), public by default.
    await page.goto('/m/log')
    await page.getByTestId('record-start').click()
    await expect(page.getByTestId('record-elapsed')).toHaveText(/^00:0[3-9]$/, { timeout: 15_000 })
    await page.getByTestId('record-stop').click()
    const transcript = page.getByTestId('transcript-input')
    await expect(transcript).toHaveValue(/Lost Observatory/, { timeout: 90_000 })
    await transcript.fill((await transcript.inputValue()).replace('The Lost Observatory by Starlight Escapes', 'Subject Zero by The Puzzle Foundry').replace('San Francisco', 'Toronto'))
    await page.getByTestId('transcript-submit').click()
    await page.locator('[data-testid^="match-game-"]', { hasText: 'Best match' }).filter({ hasText: 'Subject Zero' }).click()
    for (const k of ['overall', 'puzzles', 'setting', 'storyline', 'difficulty']) {
      const input = page.getByTestId(`confirm-score-${k}`)
      if ((await input.inputValue()) === '') await input.fill('77')
    }
    const date = page.getByTestId('confirm-date')
    if ((await date.inputValue()) === '') await date.fill('2026-10-18')
    await page.getByTestId('confirm-save').click()
    await expect(page.getByTestId('log-done')).toBeVisible({ timeout: 90_000 })
    const href = (await page.getByTestId('log-done-public').getAttribute('href'))!

    // Public: the handle shows, the email never does (page and API).
    const visitor = await browser.newContext({ baseURL })
    const vp = await visitor.newPage()
    await vp.goto(href)
    const mine = vp.getByTestId('review-card').filter({ hasText: `@${me.handle}` })
    await expect(mine).toHaveCount(1)
    expect(await vp.content()).not.toContain(me.email)
    expect(await (await visitor.request.get(`/api${href}`)).text()).not.toContain(me.email)

    // "Download my data" gives a JSON file with the review and transcript, and no stored audio.
    await page.goto('/settings')
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-download').click()])
    expect(download.suggestedFilename()).toMatch(/\.json$/)
    const text = await readFile((await download.path())!, 'utf8')
    JSON.parse(text)
    expect(text).toContain('Subject Zero')
    // The transcript stays with the review.
    expect(text).toContain('We escaped in 48 minutes')
    expect(text).not.toMatch(/"audio(Base64|Data|Bytes)?"\s*:\s*"[A-Za-z0-9+/=]{100,}/)

    // Delete the account from settings: the public review goes, and the session ends.
    await page.getByTestId('delete-open').click()
    await page.getByTestId('delete-confirm-input').fill('DELETE')
    await page.getByTestId('delete-confirm').click()
    await expect(page).toHaveURL(/\/welcome\?deleted=1/)
    expect((await phone.request.get('/api/me')).status()).toBe(401)
    await vp.reload()
    await expect(vp.getByRole('heading', { level: 1 })).toContainText('Subject Zero')
    await expect(vp.getByTestId('review-card').filter({ hasText: `@${me.handle}` })).toHaveCount(0)
    expect(errors).toEqual([])
    await visitor.close()
    await phone.close()
  })
})
