/**
 * Minimal Google Sheets REST v4 client over fetch. Auth is a bearer-token
 * provider so tests can inject a fake; production uses a service-account JWT.
 */
import { readFileSync } from 'node:fs'
import { JWT } from 'google-auth-library'
import type { Row } from './sheetMapping'

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean
  status: number
  statusText: string
  text(): Promise<string>
}>

export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets'
const BASE = 'https://sheets.googleapis.com/v4/spreadsheets'

/** Accepts raw service-account JSON or a path to a JSON key file. */
export function parseServiceAccount(raw: string): { client_email: string; private_key: string } {
  const text = raw.trim().startsWith('{') ? raw : readFileSync(raw.trim(), 'utf8')
  const json = JSON.parse(text) as { client_email?: string; private_key?: string }
  if (!json.client_email || !json.private_key) throw new Error('service account JSON is missing client_email or private_key')
  return { client_email: json.client_email, private_key: json.private_key.replace(/\\n/g, '\n') }
}

export function serviceAccountTokenProvider(raw: string): () => Promise<string> {
  const sa = parseServiceAccount(raw)
  const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: [SHEETS_SCOPE] })
  return async () => {
    const { token } = await jwt.getAccessToken()
    if (!token) throw new Error('could not obtain a Google access token')
    return token
  }
}

/** `'My Tab'!A1:B2` style A1 range. */
export function a1(tab: string, range?: string): string {
  const quoted = `'${tab.replace(/'/g, "''")}'`
  return range ? `${quoted}!${range}` : quoted
}

export class SheetsApi {
  constructor(
    private readonly sheetId: string,
    private readonly getToken: () => Promise<string>,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
  ) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await this.getToken()
    const res = await this.fetchImpl(`${BASE}/${encodeURIComponent(this.sheetId)}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    if (!res.ok) {
      let msg = text
      try {
        msg = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? text
      } catch {
        /* keep raw text */
      }
      throw new Error(`Sheets API ${res.status} ${res.statusText}: ${msg.slice(0, 300)}`)
    }
    return (text ? JSON.parse(text) : {}) as T
  }

  async tabTitles(): Promise<string[]> {
    const r = await this.call<{ sheets?: { properties?: { title?: string } }[] }>('GET', '?fields=sheets.properties.title')
    return (r.sheets ?? []).map((s) => s.properties?.title ?? '').filter(Boolean)
  }

  async addTabs(titles: string[]): Promise<void> {
    if (titles.length === 0) return
    await this.call('POST', ':batchUpdate', { requests: titles.map((title) => ({ addSheet: { properties: { title } } })) })
  }

  async batchGet(ranges: string[]): Promise<Row[][]> {
    const q = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join('&')
    const r = await this.call<{ valueRanges?: { values?: Row[] }[] }>(
      'GET',
      `/values:batchGet?${q}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`,
    )
    return ranges.map((_, i) => r.valueRanges?.[i]?.values ?? [])
  }

  async update(range: string, values: Row[]): Promise<void> {
    await this.call('PUT', `/values/${encodeURIComponent(range)}?valueInputOption=RAW`, { range, majorDimension: 'ROWS', values })
  }

  async append(range: string, values: Row[]): Promise<void> {
    if (values.length === 0) return
    await this.call('POST', `/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      range,
      majorDimension: 'ROWS',
      values,
    })
  }

  async clear(range: string): Promise<void> {
    await this.call('POST', `/values/${encodeURIComponent(range)}:clear`, {})
  }
}
