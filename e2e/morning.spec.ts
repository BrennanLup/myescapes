/**
 * The owner's morning test (docs/PHASE2_KICKOFF.md, "Definition of done"), end to end on a
 * laptop and a phone, with the test-only login and mock transcription and extraction:
 *
 *   1. Laptop: sign in, choose a public name, land in an empty personal 3D room.
 *   2. Phone: the same URL opens the /m logging app.
 *   3. Phone: record a voice note (Chromium's fake microphone plays a WAV), upload it, get the
 *      transcript, a draft, match a directory venue (desktop project) or create a new venue and
 *      game (mobile project), confirm and save.
 *   4. Laptop reload: the polaroid pins itself to the board. The public game page shows the
 *      review with the @handle, never the email.
 *   5. Invite link: a second person signs in, becomes a friend, claims the guest-name visits,
 *      and a visit the owner tags her on appears in her room.
 *   6. Escape of the Day on phone and laptop: same puzzle, share grid, streak.
 *
 * Runs once per project; the projects differ in the venue step (directory match vs. new venue)
 * and in which device of the pair is the one Playwright's project emulates.
 */
import { expect, test, type Page } from '@playwright/test'
import { SLOW, solveDaily, waitOverlay } from './helpers'
import { newDevice, person, roomNames, signIn, waitPinned, waitRoom, watchErrors } from './support/morning'

const RUN = Date.now().toString(36).slice(-5)

/** Fill whatever the confirm form still asks for (mock extraction leaves some scores empty). */
async function completeConfirm(phone: Page) {
  for (const k of ['overall', 'puzzles', 'setting', 'storyline', 'difficulty']) {
    const input = phone.getByTestId(`confirm-score-${k}`)
    if ((await input.inputValue()) === '') await input.fill('80')
  }
  const date = phone.getByTestId('confirm-date')
  if ((await date.inputValue()) === '') await date.fill('2026-10-17')
}

test.describe('morning test', () => {
  test.describe.configure({ mode: 'serial' })

  test('laptop + phone: sign in, log by voice, polaroid, public page, invite, tags, Escape of the Day', async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(20 * 60_000)
    const project = testInfo.project.name
    const owner = person(`owner_${project.slice(0, 3)}`, 'Brennan Test', RUN)
    const friend = person(`mia_${project.slice(0, 3)}`, 'Mia Test', RUN)
    const errors: string[] = []

    const laptop = await newDevice(browser, baseURL!, 'laptop')
    const phone = await newDevice(browser, baseURL!, 'phone')
    const lp = await laptop.newPage()
    const pp = await phone.newPage()
    watchErrors(lp, errors)
    watchErrors(pp, errors)

    // ---------------------------------------------------------------- 1. laptop: empty room
    await test.step('laptop: sign in, choose a public name, land in an empty 3D room', async () => {
      await lp.goto('/')
      await expect(lp.getByTestId('landing-page')).toBeVisible()
      await expect(lp.getByTestId('google-sign-in')).toBeVisible()
      await signIn(laptop, owner)
      await lp.reload()
      await expect(lp.getByTestId('onboarding-screen')).toBeVisible()
      await lp.locator('input[name="displayName"]').fill(owner.displayName)
      await lp.locator('input[name="handle"]').fill(owner.handle)
      await expect(lp.getByTestId('handle-status')).toHaveText('Available')
      await lp.getByRole('button', { name: 'Continue' }).click()
      await waitRoom(lp)
      expect(await roomNames(lp)).toEqual([])
      expect(await lp.evaluate(() => window.__ESCAPE__!.store.getState().boardPins.length)).toBe(0)
      await expect(lp.getByTestId('hud')).toBeVisible()
    })

    // ---------------------------------------------------------------- 2. phone: /m
    await test.step('phone: the same URL opens the mobile logging app', async () => {
      await pp.goto('/')
      await expect(pp).toHaveURL(/\/m$/)
      await expect(pp.getByTestId('mobile-signin')).toBeVisible()
      await signIn(phone, owner)
      await pp.reload()
      await expect(pp.getByTestId('mobile-home')).toBeVisible()
      await expect(pp.getByTestId('log-room')).toBeVisible()
      await expect(pp.getByTestId('rooms-empty')).toBeVisible()
      await expect(pp.getByTestId('daily-card')).toBeVisible()
    })

    // ---------------------------------------------------------------- 3. phone: voice log
    const directory = project === 'desktop'
    const gameName = directory ? 'The Last Lighthouse Keeper' : 'The Lost Observatory'
    let publicHref = ''
    await test.step(`phone: record a voice note -> transcript -> draft -> ${directory ? 'match a directory venue' : 'create a new venue'} -> save`, async () => {
      await pp.getByTestId('log-room').click()
      await expect(pp.getByTestId('log-flow')).toHaveAttribute('data-step', 'record')
      await pp.getByTestId('record-start').click()
      await expect(pp.getByTestId('record-elapsed')).toBeVisible()
      await expect(pp.getByTestId('record-elapsed')).toHaveText(/^00:0[3-9]$/, { timeout: 15_000 })
      await pp.getByTestId('record-stop').click()
      // Uploaded and transcribed (mock transcription returns the sample voice note).
      await expect(pp.getByTestId('log-flow')).toHaveAttribute('data-step', 'transcript', { timeout: SLOW })
      await expect(pp.getByTestId('upload-note')).toHaveCount(0)
      const transcript = pp.getByTestId('transcript-input')
      await expect(transcript).toHaveValue(/The Lost Observatory by Starlight Escapes in San Francisco/)
      // The recording left the phone's queue once the server confirmed the transcript.
      if (directory) {
        // The owner corrects the room name in the transcript: it is a room from the directory.
        const text = await transcript.inputValue()
        await transcript.fill(text.replace('The Lost Observatory by Starlight Escapes', 'The Last Lighthouse Keeper by Fog City Escapes'))
      }
      await pp.getByTestId('transcript-submit').click()
      await expect(pp.getByTestId('venue-game-matcher')).toBeVisible({ timeout: SLOW })
      await expect(pp.getByTestId('matcher-loading')).toHaveCount(0)

      if (directory) {
        const best = pp.locator('[data-testid^="match-game-"]', { hasText: 'Best match' })
        await expect(best).toContainText(gameName)
        await expect(best).toContainText('Fog City Escapes')
        await best.click()
      } else {
        await expect(pp.locator('[data-testid^="match-game-"]', { hasText: gameName })).toHaveCount(0)
        await pp.getByTestId('new-venue').click()
        await expect(pp.getByTestId('new-venue-form')).toBeVisible()
        await expect(pp.getByTestId('new-venue-name')).toHaveValue('Starlight Escapes')
        await expect(pp.getByTestId('new-venue-city')).toHaveValue('San Francisco')
        // Unique per run so a reused server never de-duplicates into an earlier run's venue.
        await pp.getByTestId('new-venue-name').fill(`Starlight Escapes ${RUN}`)
        if ((await pp.getByTestId('new-venue-country').inputValue()) === '') await pp.getByTestId('new-venue-country').fill('US')
        await pp.getByTestId('new-venue-submit').click()
        await expect(pp.getByTestId('new-game-form')).toBeVisible()
        await expect(pp.getByTestId('new-game-name')).toHaveValue(gameName)
        await pp.getByTestId('new-game-submit').click()
      }

      await expect(pp.getByTestId('log-confirm')).toBeVisible()
      await expect(pp.getByTestId('confirm-game')).toContainText(gameName)
      await completeConfirm(pp)
      await expect(pp.getByTestId('confirm-visibility-public')).toBeChecked()
      // The voice note named Maya, Jordan and Priya: they are guests on the crew.
      await expect(pp.getByTestId('crew-tag-Maya')).toBeVisible()
      await pp.getByTestId('confirm-save').click()
      await expect(pp.getByTestId('log-done')).toBeVisible({ timeout: SLOW })
      publicHref = (await pp.getByTestId('log-done-public').getAttribute('href')) ?? ''
      expect(publicHref).toMatch(/^\/games\/[a-z0-9-]+$/)
      await pp.getByTestId('log-done-home').click()
      await expect(pp.getByTestId('review-detail')).toBeVisible()
      await pp.goto('/m')
      await expect(pp.getByTestId('rooms-row')).toHaveCount(1)
      await expect(pp.getByTestId('rooms-row')).toContainText(gameName)
      await expect(pp.getByTestId('upload-queue')).toHaveCount(0)
    })

    // ---------------------------------------------------------------- 4. laptop reload + public page
    await test.step('laptop: reload, the polaroid pins itself to the board', async () => {
      await lp.reload()
      await waitRoom(lp)
      expect(await roomNames(lp)).toEqual([gameName])
      await waitPinned(lp, gameName)
    })

    await test.step('public game page shows the review with the handle, never the email', async () => {
      const visitor = await browser.newContext({ baseURL })
      const vp = await visitor.newPage()
      watchErrors(vp, errors)
      await vp.goto(publicHref)
      await expect(vp.getByRole('heading', { level: 1 })).toContainText(gameName)
      // Filtered by handle: a reused server (E2E_REUSE_SERVER) keeps earlier runs' reviews.
      const card = vp.getByTestId('review-card').filter({ hasText: `@${owner.handle}` })
      await expect(card).toHaveCount(1)
      await expect(card.getByTestId('author-card')).toContainText(owner.displayName)
      await expect(card.getByTestId('author-card')).toContainText(`@${owner.handle}`)
      expect(await vp.content()).not.toContain(owner.email)
      const api = await visitor.request.get(`/api${publicHref}`)
      expect(api.ok()).toBe(true)
      expect(await api.text()).not.toContain(owner.email)
      await visitor.close()
    })

    // ---------------------------------------------------------------- 5. invite, friend, claim, tag
    let inviteUrl = ''
    await test.step('laptop: make an invite link for the guest name "Maya"', async () => {
      await lp.goto('/settings')
      await expect(lp.getByTestId('settings-page')).toBeVisible()
      await lp.getByTestId('invite-guest-name').fill('Maya')
      await lp.getByTestId('invite-create').click()
      inviteUrl = (await lp.getByTestId('invite-url').innerText()).trim()
      expect(inviteUrl).toMatch(/\/invite\/[A-Za-z0-9_-]+$/)
    })

    const herPhone = await newDevice(browser, baseURL!, 'phone')
    const herLaptop = await newDevice(browser, baseURL!, 'laptop')
    const hp = await herPhone.newPage()
    watchErrors(hp, errors)
    await test.step('second person opens the invite, signs in, becomes a friend and claims "Maya"', async () => {
      await hp.goto(new URL(inviteUrl).pathname)
      await expect(hp.getByTestId('invite-valid')).toContainText(owner.displayName)
      await expect(hp.getByTestId('invite-sign-in')).toBeVisible()
      await signIn(herPhone, friend)
      await signIn(herLaptop, friend)
      await hp.reload()
      await hp.getByTestId('invite-accept').click()
      await expect(hp.getByTestId('invite-accepted')).toContainText(owner.displayName)
      const claim = hp.getByTestId('inbox-claim')
      await expect(claim).toContainText('"Maya"')
      await claim.getByTestId('inbox-claim-all').click()
      await expect(hp.getByTestId('inbox-claim-done')).toContainText('Claimed 1 visit')
      // Her mobile app: onboarding first, then the claimed visit is in her rooms.
      await hp.goto('/m')
      await expect(hp.getByTestId('mobile-onboarding')).toBeVisible()
      await hp.getByTestId('onboarding-name').fill(friend.displayName)
      await hp.getByTestId('onboarding-handle').fill(friend.handle)
      await expect(hp.getByTestId('onboarding-handle-status')).toHaveText(/available/i)
      await hp.getByTestId('onboarding-submit').click()
      await expect(hp.getByTestId('mobile-home')).toBeVisible()
      await expect(hp.getByTestId('rooms-row')).toHaveCount(1)
      await expect(hp.getByTestId('rooms-row')).toContainText(gameName)
    })

    const taggedGame = 'Golden Gate Vault Job'
    await test.step('phone: the owner logs another room and tags her (a friend now)', async () => {
      await pp.goto('/m/log')
      await pp.getByTestId('record-type-instead').click()
      await pp
        .getByTestId('transcript-input')
        .fill('Yesterday we did Golden Gate Vault Job by Lockbox Social in San Francisco. A heist room. We escaped in 55 minutes. Overall 82 out of 100, puzzles 80 out of 100, setting 75 out of 100, story 70 out of 100, difficulty 60 out of 100.')
      await pp.getByTestId('transcript-submit').click()
      await expect(pp.getByTestId('matcher-loading')).toHaveCount(0, { timeout: SLOW })
      await pp.locator('[data-testid^="match-game-"]', { hasText: 'Best match' }).filter({ hasText: taggedGame }).click()
      await expect(pp.getByTestId('log-confirm')).toBeVisible()
      await completeConfirm(pp)
      // Friends come first on the crew picker.
      const chip = pp.locator('[data-testid^="crew-friend-"]', { hasText: friend.displayName })
      await expect(chip).toBeVisible()
      await chip.click()
      await expect(chip).toHaveAttribute('aria-pressed', 'true')
      // Maya was claimed by her, so the guest name is no longer suggested.
      await expect(pp.getByTestId('crew-guest-Maya')).toHaveCount(0)
      await pp.getByTestId('confirm-save').click()
      await expect(pp.getByTestId('log-done')).toBeVisible({ timeout: SLOW })
    })

    await test.step('her phone: "1 visit to confirm" -> Add to my room', async () => {
      await hp.goto('/m')
      await expect(hp.getByTestId('pending-tags')).toContainText('1 visit to confirm')
      await hp.getByTestId('pending-tags').click()
      const tag = hp.getByTestId('inbox-tag')
      await expect(tag).toContainText(taggedGame)
      await expect(tag).toContainText(owner.displayName)
      await tag.getByTestId('inbox-tag-accept').click()
      await expect(hp.getByTestId('inbox-tag-done')).toContainText('Added to your room')
      await hp.goto('/m')
      await expect(hp.getByTestId('rooms-row')).toHaveCount(2)
    })

    const hl = await herLaptop.newPage()
    watchErrors(hl, errors)
    await test.step('her laptop: both visits are polaroids in her own 3D room', async () => {
      await hl.goto('/')
      await waitRoom(hl)
      expect((await roomNames(hl)).sort()).toEqual([gameName, taggedGame].sort())
      await waitPinned(hl, taggedGame)
    })

    // ---------------------------------------------------------------- 6. Escape of the Day
    await test.step('Escape of the Day on the phone: same puzzle, share grid, streak', async () => {
      await pp.goto('/m')
      await pp.getByTestId('daily-card').click()
      await expect(pp.getByTestId('daily-page')).toBeVisible()
      await solveDaily(pp)
      await expect(pp.getByTestId('daily-share')).toBeVisible()
      await expect(pp.getByTestId('daily-share-text')).toContainText(/My Escapes · Escape #\d+/)
      await expect(pp.getByTestId('daily-streak')).toContainText('Streak')
      await expect(pp.getByTestId('daily-streak').locator('dd').first()).toHaveText('1')
    })

    await test.step('Escape of the Day on the laptop: the door shows the same puzzle, already solved', async () => {
      const phoneNumber = (await pp.getByTestId('daily-number').innerText()).trim()
      await lp.goto('/')
      await waitRoom(lp)
      await lp.evaluate(() => window.__ESCAPE__!.bus.emit('gate:open'))
      await waitOverlay(lp, 'gate')
      await expect(lp.getByTestId('daily-overlay')).toBeVisible()
      await expect(lp.getByTestId('daily-number')).toHaveText(phoneNumber)
      await expect(lp.getByTestId('daily-finished')).toBeVisible({ timeout: SLOW })
      await expect(lp.getByTestId('daily-streak').locator('dd').first()).toHaveText('1')
      await lp.getByTestId('daily-close').click()
      await waitOverlay(lp, null)
    })

    await test.step('Escape of the Day on her laptop: she solves it, the friends leaderboard shows both', async () => {
      await hl.evaluate(() => window.__ESCAPE__!.bus.emit('gate:open'))
      await waitOverlay(hl, 'gate')
      await solveDaily(hl)
      const board = hl.getByTestId('daily-leaderboard')
      await expect(board).toBeVisible()
      await expect(board.getByTestId('daily-leaderboard-row')).toHaveCount(2)
      await expect(board).toContainText(owner.displayName)
    })

    expect(errors).toEqual([])
    for (const c of [laptop, phone, herPhone, herLaptop]) await c.close()
  })
})
