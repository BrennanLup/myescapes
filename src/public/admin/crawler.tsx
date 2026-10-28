/**
 * /admin/rooms: the room crawler's status and a form to start a run (admins only; the API
 * answers 403 to everyone else). Uses ROUTES.adminEnrichStatus and ROUTES.adminEnrichStart.
 */
import { useEffect, useState, type FormEvent } from 'react'
import type { RouteProps } from '../../router'
import { ROUTES, callApi } from '../../contracts/routes'
import { ApiCallError } from '../../contracts/errors'
import type { EnrichStatus } from '../../contracts/models'
import { Card, PublicPage } from '../shared/Layout'
import { useDocumentTitle } from '../shared/useApi'

const usd = (n: number) => `$${n.toFixed(2)}`
const input = 'h-11 w-full rounded-xl border border-panel-edge bg-white px-3'

export function CrawlerAdminPage(_props: RouteProps) {
  useDocumentTitle('Room crawler · My Escapes')
  const [status, setStatus] = useState<EnrichStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [limit, setLimit] = useState('500')
  const [budget, setBudget] = useState('25')
  const [country, setCountry] = useState('')
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let live = true
    callApi(ROUTES.adminEnrichStatus).then(
      (s) => live && (setStatus(s), setError(null)),
      (err: unknown) => live && setError(err instanceof ApiCallError && err.status === 403 ? 'Admins only.' : err instanceof ApiCallError && err.status === 401 ? 'Sign in first.' : "Couldn't load the crawler status."),
    )
    // Refresh while a run is going.
    const t = setTimeout(() => setTick((n) => n + 1), status?.running ? 5000 : 30000)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [tick, status?.running])

  const start = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await callApi(ROUTES.adminEnrichStart, { body: { limit: Number(limit), budgetUsd: Number(budget), ...(country.trim() ? { country: country.trim().toUpperCase() } : {}) } })
      setTick((n) => n + 1)
    } catch (err) {
      setError(err instanceof ApiCallError && err.body?.error ? err.body.error : "Couldn't start the run.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <PublicPage testId="crawler-admin">
      <Card>
        <h1 className="m-0 font-display text-3xl font-semibold">Room crawler</h1>
        <p className="m-0 mt-2 text-ink-soft">
          Reads each venue's own website and adds its escape rooms to the directory. A run stops before it could go over its budget.
        </p>
        {error && (
          <p role="alert" className="mt-3 text-bad">
            {error}
          </p>
        )}
        {status && (
          <>
            <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="crawler-totals">
              {[
                ['Rooms in the directory', String(status.rooms)],
                ['Venues read', `${status.venuesTried} (${status.venuesWithRooms} with rooms)`],
                ['Venues left to read', String(status.venuesLeft)],
                ['Spent so far', usd(status.spentUsd)],
                ['Estimate for the rest', usd(status.estimatedUsdForRest)],
                ['Model', status.model],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg bg-paper px-3 py-2">
                  <dt className="text-xs text-ink-soft">{k}</dt>
                  <dd className="m-0 font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
            {status.running ? (
              <p className="mt-4 font-semibold" data-testid="crawler-running">
                Running: {status.running.venues} of up to {status.running.limit} venues read, {status.running.roomsAdded} new rooms, {usd(status.running.spentUsd)} of {usd(status.running.budgetUsd)}.
              </p>
            ) : (
              <form onSubmit={start} className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="crawler-form">
                <label className="text-sm">
                  Venues
                  <input className={input} inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)} />
                </label>
                <label className="text-sm">
                  Budget (USD)
                  <input className={input} inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} />
                </label>
                <label className="text-sm">
                  Country (optional)
                  <input className={input} maxLength={2} placeholder="US" value={country} onChange={(e) => setCountry(e.target.value)} />
                </label>
                <button type="submit" disabled={busy} className="mt-5 h-11 rounded-xl bg-accent px-4 font-semibold text-accent-ink">
                  {busy ? 'Starting…' : 'Start a run'}
                </button>
              </form>
            )}
            {status.runs.length > 0 && (
              <table className="mt-5 w-full text-left text-sm">
                <thead>
                  <tr className="text-ink-soft">
                    <th>Started</th>
                    <th>Kind</th>
                    <th>Venues</th>
                    <th>New rooms</th>
                    <th>Spent</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {status.runs.map((r) => (
                    <tr key={r.id}>
                      <td>{new Date(r.startedAt).toLocaleString()}</td>
                      <td>{r.kind}</td>
                      <td>{r.venues}</td>
                      <td>{r.roomsAdded}</td>
                      <td>{usd(r.spentUsd)}</td>
                      <td>{r.status === 'done' ? (r.note ?? 'done') : r.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </Card>
    </PublicPage>
  )
}
