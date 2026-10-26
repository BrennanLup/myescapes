import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Me } from '../../contracts/models'
import { fetchStub } from '../shared/fixtures'
import { GoogleButton, Home, Landing, OnboardingScreen, SignInScreen, localHandleProblem, safeNext, signInErrorMessage, suggestHandle, wantsDemo } from '.'

const auth = vi.hoisted(() => ({
  session: { status: 'signed-out', user: null } as unknown,
  signIn: vi.fn(async (_url?: string) => {}),
  setSessionUser: vi.fn((_me: unknown) => {}),
}))
vi.mock('../../auth', () => ({
  useSession: () => auth.session,
  signInWithGoogle: (url?: string) => auth.signIn(url),
  signOut: vi.fn(),
  setSessionUser: (me: unknown) => auth.setSessionUser(me),
}))
// The real 3D room pulls in three.js; the gate only needs to know it was chosen.
vi.mock('../../desktop', () => ({ DesktopApp: () => <div data-testid="desktop-room" /> }))

const ME: Me = { id: 'usr_new', handle: null, displayName: 'Brennan Lup', image: null, email: 'someone@example.com', onboarded: false, isAdmin: false, createdAt: '2026-10-26T00:00:00Z' }

function at(url: string) {
  window.history.replaceState(null, '', url)
}

beforeEach(() => {
  auth.session = { status: 'signed-out', user: null }
  auth.signIn.mockClear()
  try {
    sessionStorage.clear()
  } catch {
    /* ignore */
  }
  at('/')
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  at('/')
})

describe('helpers', () => {
  it('safeNext only allows same-origin paths', () => {
    expect(safeNext('/games/x?y=1')).toBe('/games/x?y=1')
    expect(safeNext(null)).toBe('/')
    expect(safeNext('https://evil.example')).toBe('/')
    expect(safeNext('//evil.example')).toBe('/')
    expect(safeNext('/\\evil.example')).toBe('/')
    expect(safeNext('/a\nb')).toBe('/')
    expect(safeNext('games')).toBe('/')
  })

  it('wantsDemo and sign-in error messages', () => {
    expect(wantsDemo('?demo=1')).toBe(true)
    expect(wantsDemo('?demo')).toBe(true)
    expect(wantsDemo('?debug=1')).toBe(false)
    expect(signInErrorMessage(null)).toBeNull()
    expect(signInErrorMessage('access_denied')).toMatch(/cancelled/)
    expect(signInErrorMessage('weird')).toMatch(/didn't work/)
  })

  it('suggests a valid handle from a Google name or email', () => {
    expect(suggestHandle('Brennan Lup')).toBe('brennan_lup')
    expect(suggestHandle('josé.núñez@example.com')).toBe('jose_nunez')
    expect(suggestHandle('42 Al')).toBe('al_escapes')
    expect(suggestHandle('')).toBe('player')
    expect(suggestHandle('admin')).toBe('admin_1')
    expect(suggestHandle('a'.repeat(40))).toHaveLength(24)
    for (const s of ['Brennan Lup', 'josé.núñez@example.com', '42 Al', '', 'admin', '___x']) expect(localHandleProblem(suggestHandle(s))).toBeNull()
  })

  it('checks handles locally', () => {
    expect(localHandleProblem('ok_name')).toBeNull()
    expect(localHandleProblem('@Mixed_Case')).toBeNull()
    expect(localHandleProblem('ab')).toMatch(/3-24/)
    expect(localHandleProblem('1abc')).toMatch(/starting with a letter/)
    expect(localHandleProblem('settings')).toMatch(/reserved/)
  })
})

describe('Landing', () => {
  it('offers "Continue with Google" and links the static pages', () => {
    render(<Landing />)
    expect(screen.getByTestId('google-sign-in').textContent).toContain('Continue with Google')
    const hrefs = [...screen.getByTestId('landing-page').querySelectorAll('a')].map((a) => a.getAttribute('href'))
    for (const p of ['/about', '/privacy', '/terms']) expect(hrefs).toContain(p)
    expect(screen.getByTestId('demo-link').getAttribute('href')).toBe('/?demo=1')
    expect(document.title).toMatch(/^My Escapes/)
  })

  it('starts Google sign-in, returning to ?next when it is safe', async () => {
    at('/welcome?next=%2Fgames%2Fthe-vault')
    render(<Landing />)
    fireEvent.click(screen.getByTestId('google-sign-in'))
    await waitFor(() => expect(auth.signIn).toHaveBeenCalledWith('/games/the-vault'))
    expect(screen.getByTestId('google-sign-in').textContent).toContain('Opening Google')
  })

  it('ignores an unsafe ?next', async () => {
    at('/welcome?next=https%3A%2F%2Fevil.example')
    render(<Landing />)
    fireEvent.click(screen.getByTestId('google-sign-in'))
    await waitFor(() => expect(auth.signIn).toHaveBeenCalledWith('/'))
  })

  it('shows a sign-in error from the callback', () => {
    at('/welcome?error=access_denied')
    render(<Landing />)
    expect(screen.getByRole('alert').textContent).toMatch(/cancelled/)
  })

  it('sends a signed-in visitor on /welcome to ?next', async () => {
    auth.session = { status: 'signed-in', user: { ...ME, onboarded: true, handle: 'brennan' } }
    at('/welcome?next=%2Fdaily')
    render(<Landing />)
    await waitFor(() => expect(window.location.pathname).toBe('/daily'))
  })

  it('never shows an email', () => {
    auth.session = { status: 'signed-in', user: { ...ME, onboarded: true } }
    const { container } = render(<Landing />)
    expect(container.textContent).not.toContain('someone@example.com')
  })
})

describe('GoogleButton and SignInScreen', () => {
  it('shows a friendly error when sign-in cannot start', async () => {
    render(<GoogleButton signIn={() => Promise.reject(new Error('down'))} />)
    fireEvent.click(screen.getByTestId('google-sign-in'))
    expect((await screen.findByRole('alert')).textContent).toMatch(/isn't available/)
    expect((screen.getByTestId('google-sign-in') as HTMLButtonElement).disabled).toBe(false)
  })

  it('SignInScreen has the button and the legal links', () => {
    render(<SignInScreen reason="Sign in to log a room." />)
    const box = screen.getByTestId('sign-in-screen')
    expect(box.textContent).toContain('Sign in to log a room.')
    expect(screen.getByTestId('google-sign-in')).toBeTruthy()
    const hrefs = [...box.querySelectorAll('a')].map((a) => a.getAttribute('href'))
    for (const p of ['/about', '/privacy', '/terms']) expect(hrefs).toContain(p)
  })
})

describe('Home (the / route)', () => {
  it('shows the landing page to signed-out visitors', () => {
    render(<Home />)
    expect(screen.getByTestId('landing-page')).toBeTruthy()
    expect(screen.queryByTestId('desktop-room')).toBeNull()
  })

  it('opens the demo room for signed-out visitors with ?demo', async () => {
    at('/?demo=1')
    render(<Home />)
    expect(await screen.findByTestId('desktop-room')).toBeTruthy()
  })

  it('shows nothing but a blank screen while the session loads', () => {
    auth.session = { status: 'loading', user: null }
    render(<Home />)
    expect(screen.getByTestId('page-loading')).toBeTruthy()
    expect(screen.queryByTestId('landing-page')).toBeNull()
  })

  it('opens the room for an onboarded user', async () => {
    auth.session = { status: 'signed-in', user: { ...ME, handle: 'brennan', onboarded: true } }
    render(<Home />)
    expect(await screen.findByTestId('desktop-room')).toBeTruthy()
  })

  it('asks a new user for a public name first, then opens the room', async () => {
    auth.session = { status: 'signed-in', user: ME }
    const stub = fetchStub({
      '/api/handles/brennan_lup': { body: { handle: 'brennan_lup', available: true, reason: null } },
      '/api/me': (init) => ({ body: { ...ME, ...JSON.parse(String(init?.body)), onboarded: true } }),
    })
    vi.stubGlobal('fetch', stub.fn)
    render(<Home />)
    expect(screen.getByTestId('onboarding-screen')).toBeTruthy()
    expect((screen.getByRole('textbox', { name: 'Display name' }) as HTMLInputElement).value).toBe('Brennan Lup')
    expect((screen.getByRole('textbox', { name: 'Handle' }) as HTMLInputElement).value).toBe('brennan_lup')
    expect(screen.getByTestId('onboarding-screen').textContent).not.toContain('someone@example.com')
    await waitFor(() => expect(screen.getByTestId('handle-status').textContent).toBe('Available'))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByTestId('desktop-room')).toBeTruthy()
    const patch = stub.calls.find((c) => c.init?.method === 'PATCH')!
    expect(patch.url).toBe('/api/me')
    expect(JSON.parse(String(patch.init?.body))).toEqual({ displayName: 'Brennan Lup', handle: 'brennan_lup' })
    // The shared session learns the new name, so other screens don't ask again.
    expect(auth.setSessionUser).toHaveBeenCalledWith(expect.objectContaining({ handle: 'brennan_lup', onboarded: true }))
  })

  it('lets a new user skip onboarding for now', async () => {
    auth.session = { status: 'signed-in', user: ME }
    vi.stubGlobal('fetch', fetchStub({ '/api/handles/brennan_lup': { body: { handle: 'brennan_lup', available: true, reason: null } } }).fn)
    render(<Home />)
    fireEvent.click(screen.getByRole('button', { name: 'Later' }))
    expect(await screen.findByTestId('desktop-room')).toBeTruthy()
  })
})

describe('OnboardingScreen', () => {
  it('reports a taken handle and blocks saving', async () => {
    vi.stubGlobal('fetch', fetchStub({ '/api/handles/taken_name': { body: { handle: 'taken_name', available: false, reason: 'taken' } } }).fn)
    render(<OnboardingScreen user={ME} onDone={vi.fn()} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Handle' }), { target: { value: '@Taken_Name' } })
    await waitFor(() => expect(screen.getByTestId('handle-status').textContent).toMatch(/taken/))
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('flags an invalid handle without asking the server', () => {
    const stub = fetchStub({})
    vi.stubGlobal('fetch', stub.fn)
    render(<OnboardingScreen user={ME} onDone={vi.fn()} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Handle' }), { target: { value: 'x' } })
    expect(screen.getByTestId('handle-status').textContent).toMatch(/3-24/)
    expect(stub.calls).toHaveLength(0)
  })

  it('handles a 409 handle_taken on save', async () => {
    const onDone = vi.fn()
    vi.stubGlobal(
      'fetch',
      fetchStub({
        '/api/handles/brennan_lup': { body: { handle: 'brennan_lup', available: true, reason: null } },
        '/api/me': { status: 409, body: { error: 'taken', code: 'handle_taken' } },
      }).fn,
    )
    render(<OnboardingScreen user={ME} onDone={onDone} />)
    await waitFor(() => expect(screen.getByTestId('handle-status').textContent).toBe('Available'))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(screen.getByTestId('handle-status').textContent).toMatch(/taken/))
    expect(onDone).not.toHaveBeenCalled()
  })
})
