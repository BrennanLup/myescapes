import { useEffect, useId, type ReactNode } from 'react'
import { useStore, type QualityPreset } from '@/state/store'
import { bus } from '@/contracts/events'
import { useServerStatus, fetchServerStatus } from './shellStore'
import { IconClose } from './icons'
import { useSession } from '@/auth/session'

export const QUALITY_INFO: Record<QualityPreset, { label: string; desc: string }> = {
  low: { label: 'Low', desc: 'No shadows, lower resolution. Smoothest on phones and older laptops.' },
  medium: { label: 'Medium', desc: 'Soft shadows and sharp text. A good fit for most devices.' },
  high: { label: 'High', desc: 'Full resolution and antialiasing. For a strong graphics card.' },
}

const close = () => bus.emit('overlay:close')

export function SettingsOverlay() {
  const settings = useStore((s) => s.settings)
  const update = useStore((s) => s.updateSettings)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-backdrop p-0 font-body text-ink sm:items-center sm:p-6"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div
        data-testid="settings-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-cozy bg-panel shadow-cozy ring-1 ring-panel-edge sm:rounded-cozy"
      >
        <header className="flex items-center justify-between border-b border-panel-edge/70 px-5 py-4 sm:px-6">
          <h2 id="settings-title" className="font-display text-2xl font-semibold">
            Settings
          </h2>
          <button
            type="button"
            aria-label="Close settings"
            data-testid="settings-close"
            onClick={close}
            className="flex h-11 w-11 items-center justify-center rounded-full text-ink-soft transition hover:bg-[rgba(224,123,57,.12)] hover:text-ink"
          >
            <IconClose />
          </button>
        </header>

        <div className="flex flex-col gap-6 overflow-y-auto px-5 py-5 sm:px-6" style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}>
          <AccountSection />
          <Section title="Controls">
            <Slider
              label="Look sensitivity"
              testId="sensitivity-slider"
              min={0.2}
              max={3}
              step={0.1}
              value={settings.sensitivity}
              display={`${settings.sensitivity.toFixed(1)}x`}
              onChange={(v) => update({ sensitivity: v })}
            />
            <Toggle label="Invert look up/down" testId="invert-y-toggle" checked={settings.invertY} onChange={(v) => update({ invertY: v })} />
            <Toggle
              label="Head bob while walking"
              hint="A gentle sway as you walk. Turn off if it feels queasy."
              testId="head-bob-toggle"
              checked={settings.headBob}
              onChange={(v) => update({ headBob: v })}
            />
          </Section>

          <Section title="Graphics quality">
            <div role="radiogroup" aria-label="Graphics quality" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {(Object.keys(QUALITY_INFO) as QualityPreset[]).map((q) => {
                const on = settings.quality === q
                return (
                  <button
                    key={q}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    data-testid={`quality-${q}`}
                    onClick={() => update({ quality: q })}
                    className={`flex min-h-12 flex-col items-start rounded-2xl px-3.5 py-2.5 text-left ring-2 transition active:scale-[.98] ${
                      on ? 'bg-[rgba(47,143,138,.1)] ring-teal' : 'bg-paper ring-panel-edge/50 hover:ring-panel-edge'
                    }`}
                  >
                    <span className={`font-display text-base font-semibold ${on ? 'text-teal' : ''}`}>{QUALITY_INFO[q].label}</span>
                    <span className="text-xs leading-snug text-ink-soft">{QUALITY_INFO[q].desc}</span>
                  </button>
                )
              })}
            </div>
          </Section>

          <Section title="Sound">
            <Slider
              label="Volume"
              testId="volume-slider"
              min={0}
              max={1}
              step={0.05}
              value={settings.muted ? 0 : settings.volume}
              display={settings.muted ? 'Muted' : `${Math.round(settings.volume * 100)}%`}
              onChange={(v) => update({ volume: v, muted: v === 0 })}
            />
          </Section>

          <ServerStatusSection />
        </div>
      </div>
    </div>
  )
}

/**
 * Signed in: the way from the 3D room to the account page (/settings), where the invite link,
 * friends, inbox, data download, sign-out and account deletion live.
 */
function AccountSection() {
  const session = useSession()
  if (session.status !== 'signed-in') return null
  const u = session.user
  return (
    <Section title="Account">
      <p className="text-sm text-ink-soft">
        Signed in as <span className="font-semibold text-ink">{u.displayName ?? u.handle ?? 'you'}</span>
        {u.handle ? ` (@${u.handle})` : ''}
      </p>
      <a
        href="/settings"
        data-testid="settings-account-link"
        className="self-start rounded-full bg-accent px-4 py-2 text-sm font-bold text-accent-ink transition hover:scale-[1.02]"
      >
        Friends, invites and account
      </a>
    </Section>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-xs font-extrabold tracking-wider text-ink-soft uppercase">{title}</h3>
      {children}
    </section>
  )
}

function Slider(props: { label: string; min: number; max: number; step: number; value: number; display: string; testId: string; onChange(v: number): void }) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="font-semibold">
          {props.label}
        </label>
        <span className="font-mono text-sm text-ink-soft">{props.display}</span>
      </div>
      <input
        id={id}
        type="range"
        data-testid={props.testId}
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.currentTarget.value))}
        className="h-8 w-full cursor-pointer accent-[var(--color-accent)]"
      />
    </div>
  )
}

function Toggle({ label, hint, checked, onChange, testId }: { label: string; hint?: string; checked: boolean; onChange(v: boolean): void; testId: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-testid={testId}
      onClick={() => onChange(!checked)}
      className="flex min-h-11 w-full items-center justify-between gap-4 text-left"
    >
      <span className="flex flex-col">
        <span className="font-semibold">{label}</span>
        {hint ? <span className="text-xs text-ink-soft">{hint}</span> : null}
      </span>
      <span className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${checked ? 'bg-teal' : 'bg-panel-edge'}`}>
        <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-[left] ${checked ? 'left-6' : 'left-1'}`} />
      </span>
    </button>
  )
}

function ServerStatusSection() {
  const { status, error } = useServerStatus()
  return (
    <Section title="Server status">
      <div data-testid="server-status" className="flex flex-col gap-2 rounded-2xl bg-paper p-3.5 ring-1 ring-panel-edge/70">
        {error ? (
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-bad">Couldn't reach the server status.</span>
            <button type="button" onClick={() => void fetchServerStatus(true)} className="min-h-9 rounded-full bg-panel px-3 font-semibold ring-1 ring-panel-edge">
              Retry
            </button>
          </div>
        ) : !status ? (
          <span className="text-sm text-ink-soft">Checking...</span>
        ) : (
          <>
            <StatusRow
              name="Voice note extraction"
              real={status.extraction === 'claude'}
              realLabel="Claude"
              mockLabel="Mock extractor"
              howTo={
                <>
                  Set <Env>ANTHROPIC_API_KEY</Env> on the server to use Claude.
                </>
              }
            />
            <StatusRow
              name="Storage"
              real={status.storage === 'postgres'}
              realLabel="Postgres"
              mockLabel={status.storage === 'pglite' ? 'Local database' : 'Seed data'}
              howTo={
                <>
                  Set <Env>DATABASE_URL</Env> on the server to use Postgres.
                </>
              }
            />
            <span className="text-right font-mono text-[11px] text-ink-soft/70">server v{status.version}</span>
          </>
        )}
      </div>
    </Section>
  )
}

function StatusRow({ name, real, realLabel, mockLabel, howTo }: { name: string; real: boolean; realLabel: string; mockLabel: string; howTo: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold">{name}</span>
        <span
          className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold ${real ? 'bg-[rgba(79,157,90,.15)] text-good' : 'bg-[rgba(224,169,58,.2)] text-[#9a6a12]'}`}
        >
          <span className={`h-2 w-2 rounded-full ${real ? 'bg-good' : 'bg-warn'}`} />
          {real ? realLabel : mockLabel}
        </span>
      </div>
      {!real ? <p className="text-xs leading-snug text-ink-soft">{howTo}</p> : null}
    </div>
  )
}

function Env({ children }: { children: ReactNode }) {
  return <code className="rounded bg-panel px-1 py-px font-mono text-[11px] text-ink ring-1 ring-panel-edge">{children}</code>
}
