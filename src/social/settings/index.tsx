/**
 * Account settings /settings (workstream 35): display name and @handle, friends and auto-accept,
 * the inbox, download my data (ROUTES.exportMe), delete my account (ROUTES.deleteMe), and links
 * to /about, /privacy and /terms (static pages served by the server).
 *
 * `SettingsPage` is the routed page; `SettingsScreen` is the same content without the page frame,
 * for the mobile shell to embed (e.g. at /m/settings).
 */
import { useEffect, useState } from 'react'
import { signInWithGoogle, signOut } from '../../auth'
import type { Me } from '../../contracts/models'
import { callApi, ROUTES } from '../../contracts/routes'
import type { RouteProps } from '../../router'
import { checkHandle, downloadText, exportFileName, fetchExport, isUnauthorized, localHandleCheck, type HandleCheck } from '../client'
import { FriendsPanel, Inbox, LegalLinks } from '../index'
import { Button, Card, ErrorLine, Loading, useAction, useLoad } from '../ui'

export function SettingsPage(_props: Partial<RouteProps>) {
  return (
    <main data-testid="settings-page" className="min-h-screen bg-panel px-4 pt-6 pb-16 text-ink">
      <div className="mx-auto max-w-xl space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-3xl">Settings</h1>
          <a href="/" className="text-sm font-bold text-teal">
            Back to my room
          </a>
        </div>
        <SettingsScreen />
      </div>
    </main>
  )
}

/** Where to go after deleting the account or signing out. Overridable in tests. */
export const settingsNav = {
  leave(to: string) {
    window.location.assign(to)
  },
}

export function SettingsScreen() {
  const me = useLoad((signal) => callApi(ROUTES.me, {}, { signal }), [])
  useEffect(() => {
    // Jump to #inbox (or another section) once the content exists.
    if (me.status !== 'ready' || typeof window === 'undefined' || !window.location.hash) return
    document.getElementById(window.location.hash.slice(1))?.scrollIntoView?.()
  }, [me.status])

  if (me.status === 'loading') return <Loading />
  if (me.status === 'error') {
    if (isUnauthorized(me.error)) return <SignedOut />
    return (
      <div className="space-y-2">
        <ErrorLine error={me.error} testId="settings-error" />
        <Button onClick={me.reload}>Try again</Button>
        <LegalLinks />
      </div>
    )
  }
  return (
    <div className="space-y-4" data-testid="settings-screen">
      <ProfileCard me={me.data} onSaved={me.reload} />
      <Card title="Inbox" id="inbox" testId="settings-inbox">
        <Inbox />
      </Card>
      <section id="friends" className="space-y-2">
        <h2 className="font-display text-xl">Friends</h2>
        <FriendsPanel inviterName={me.data.displayName} />
      </section>
      <DataCard />
      <AccountCard me={me.data} />
      <LegalLinks />
    </div>
  )
}

function SignedOut() {
  const act = useAction()
  return (
    <div className="space-y-3" data-testid="settings-signed-out">
      <p>Sign in to change your name, manage friends, or download or delete your data.</p>
      <Button tone="primary" disabled={act.busy} onClick={() => void act.run(() => signInWithGoogle('/settings'))} data-testid="settings-sign-in">
        Continue with Google
      </Button>
      <ErrorLine error={act.error} />
      <LegalLinks />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Profile: display name and @handle
// ---------------------------------------------------------------------------

const HANDLE_DEBOUNCE_MS = 350

export function ProfileCard({ me, onSaved }: { me: Me; onSaved(): void }) {
  const [displayName, setDisplayName] = useState(me.displayName)
  const [handle, setHandle] = useState(me.handle ?? '')
  const [check, setCheck] = useState<HandleCheck>({ state: 'idle' })
  const [saved, setSaved] = useState(false)
  const act = useAction()

  // Follow the saved profile (after a save, or a reload elsewhere).
  useEffect(() => {
    setDisplayName(me.displayName)
    setHandle(me.handle ?? '')
  }, [me.displayName, me.handle])

  useEffect(() => {
    const local = localHandleCheck(handle)
    if (local.error) {
      setCheck(handle.trim() ? { state: 'invalid', message: local.error } : { state: 'idle' })
      return
    }
    if (me.handle && local.handle === me.handle.toLowerCase()) {
      setCheck({ state: 'idle' })
      return
    }
    setCheck({ state: 'checking' })
    let live = true
    const t = setTimeout(() => {
      void checkHandle(local.handle, me.handle).then((c) => live && setCheck(c))
    }, HANDLE_DEBOUNCE_MS)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [handle, me.handle])

  const nameOk = displayName.trim().length > 0 && displayName.trim().length <= 60
  const local = localHandleCheck(handle)
  const handleChanged = local.handle !== (me.handle ?? '').toLowerCase()
  const nameChanged = displayName.trim() !== me.displayName
  const blocked = !nameOk || Boolean(local.error) || check.state === 'unavailable' || check.state === 'checking'
  const dirty = nameChanged || handleChanged

  const save = () =>
    act.run(async () => {
      const body: { displayName?: string; handle?: string } = {}
      if (nameChanged || !me.onboarded) body.displayName = displayName.trim()
      if (handleChanged || !me.onboarded) body.handle = local.handle
      await callApi(ROUTES.updateMe, { body })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
      onSaved()
    })

  return (
    <Card title="Your public name" testId="profile-card">
      {!me.onboarded && (
        <p className="mb-3 rounded-lg bg-warn/20 p-2 text-sm" data-testid="profile-onboarding">
          Pick a display name and @handle. Reviews can only be public once you have one.
        </p>
      )}
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (!blocked && (dirty || !me.onboarded)) void save()
        }}
      >
        <label className="block text-sm">
          <span className="font-bold">Display name</span>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={60}
            autoComplete="nickname"
            data-testid="profile-display-name"
            className="mt-1 block min-h-11 w-full rounded-full bg-white px-4 text-base ring-1 ring-panel-edge"
          />
        </label>
        <label className="block text-sm">
          <span className="font-bold">@handle</span>
          <span className="mt-1 flex items-center rounded-full bg-white ring-1 ring-panel-edge focus-within:ring-2 focus-within:ring-accent">
            <span className="pl-4 text-ink-soft">@</span>
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value.replace(/^@/, '').toLowerCase())}
              maxLength={25}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              data-testid="profile-handle"
              className="block min-h-11 w-full min-w-0 rounded-full bg-transparent pr-4 pl-1 text-base outline-none"
            />
          </span>
          <HandleStatus check={check} />
        </label>
        <p className="text-xs text-ink-soft">Public pages show your display name and @handle, never your email ({me.email}).</p>
        <div className="flex items-center gap-3">
          <Button type="submit" tone="primary" disabled={act.busy || blocked || (!dirty && me.onboarded)} data-testid="profile-save">
            Save
          </Button>
          {saved && (
            <span className="text-sm text-good" data-testid="profile-saved">
              Saved
            </span>
          )}
        </div>
        <ErrorLine error={act.error} testId="profile-error" />
      </form>
    </Card>
  )
}

function HandleStatus({ check }: { check: HandleCheck }) {
  const text =
    check.state === 'checking'
      ? 'Checking…'
      : check.state === 'available'
        ? 'Available'
        : check.state === 'invalid' || check.state === 'unavailable' || check.state === 'error'
          ? check.message
          : ''
  if (!text) return null
  const tone = check.state === 'available' ? 'text-good' : check.state === 'checking' ? 'text-ink-soft' : 'text-bad'
  return (
    <span className={`mt-1 block text-xs ${tone}`} data-testid="profile-handle-status" data-state={check.state}>
      {text}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Data export
// ---------------------------------------------------------------------------

function DataCard() {
  const act = useAction()
  const [done, setDone] = useState(false)
  const download = () =>
    act.run(async () => {
      const text = await fetchExport()
      downloadText(text, exportFileName())
      setDone(true)
    })
  return (
    <Card title="Your data" testId="data-card">
      <p className="mb-3 text-sm text-ink-soft">Download everything you've added: visits, reviews, transcripts, wish list, friends, invites, Escape of the Day results and notifications, as a JSON file.</p>
      <Button disabled={act.busy} onClick={() => void download()} data-testid="export-download">
        {act.busy ? 'Preparing…' : 'Download my data'}
      </Button>
      {done && (
        <p className="mt-2 text-sm text-good" data-testid="export-done">
          Download started.
        </p>
      )}
      <ErrorLine error={act.error} testId="export-error" />
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Sign out and account deletion
// ---------------------------------------------------------------------------

export const DELETE_WORD = 'DELETE'

function AccountCard({ me }: { me: Me }) {
  const act = useAction()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')

  const doSignOut = () =>
    act.run(async () => {
      await signOut()
      settingsNav.leave('/welcome')
    })
  const doDelete = () =>
    act.run(async () => {
      await callApi(ROUTES.deleteMe, { body: { confirm: DELETE_WORD } })
      // The server already ended the session; signing out client-side too clears any cached state.
      await signOut().catch(() => undefined)
      settingsNav.leave('/welcome?deleted=1')
    })

  return (
    <Card title="Account" testId="account-card">
      <p className="mb-3 text-sm text-ink-soft">Signed in with Google as {me.email}.</p>
      <div className="flex flex-wrap gap-2">
        <Button disabled={act.busy} onClick={() => void doSignOut()} data-testid="sign-out">
          Sign out
        </Button>
        {!open && (
          <Button tone="danger" onClick={() => setOpen(true)} data-testid="delete-open">
            Delete my account
          </Button>
        )}
      </div>
      {open && (
        <div className="mt-4 space-y-3 rounded-xl bg-bad/10 p-3" data-testid="delete-panel">
          <p className="text-sm">
            This permanently deletes your account, your reviews, photos, voice notes and transcripts, friendships, wish list and Escape of the Day results. On visits shared with friends, your tag becomes a plain name so their logs still make sense. This cannot be undone.
          </p>
          <p className="text-sm">You may want to download your data first.</p>
          <label className="block text-sm">
            <span>
              Type <b>{DELETE_WORD}</b> to confirm
            </span>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoCapitalize="characters"
              autoComplete="off"
              data-testid="delete-confirm-input"
              className="mt-1 block min-h-11 w-full rounded-full bg-white px-4 text-base ring-1 ring-panel-edge"
            />
          </label>
          <div className="flex gap-2">
            <Button tone="danger" disabled={act.busy || typed.trim() !== DELETE_WORD} onClick={() => void doDelete()} data-testid="delete-confirm">
              Delete forever
            </Button>
            <Button
              onClick={() => {
                setOpen(false)
                setTyped('')
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
      <ErrorLine error={act.error} testId="account-error" />
    </Card>
  )
}
