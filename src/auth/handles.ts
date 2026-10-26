/**
 * @handle helpers for onboarding (workstream 3). The server is the authority
 * (`GET /api/handles/:handle`, `PATCH /api/me`); these only prefill and pre-check.
 */
import { HANDLE_RE, RESERVED_HANDLES } from '../contracts/models'

export function normaliseHandle(raw: string): string {
  return raw.trim().replace(/^@/, '').toLowerCase()
}

/** Why a typed handle can't work, before asking the server. Null when it looks fine. */
export function localHandleProblem(raw: string): string | null {
  const h = normaliseHandle(raw)
  if (!h) return 'Pick a handle.'
  if (h.length < 3) return 'At least 3 characters.'
  if (h.length > 24) return 'At most 24 characters.'
  if (!/^[a-z]/.test(h)) return 'Start with a letter.'
  if (!HANDLE_RE.test(h)) return 'Letters, digits and _ only.'
  if ((RESERVED_HANDLES as readonly string[]).includes(h)) return `@${h} is reserved.`
  return null
}

/** Prefill from the Google name, else the email's local part: "Brennan Lup" -> "brennanlup". */
export function suggestHandle(name: string, email = ''): string {
  const clean = (s: string) =>
    s
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '')
  let base = clean(name)
  if (base.length < 3) base = clean(email.split('@')[0] ?? '')
  base = base.replace(/^[^a-z]+/, '')
  if (base.length < 3) base = `escaper${base}`
  base = base.slice(0, 20)
  return (RESERVED_HANDLES as readonly string[]).includes(base) ? `${base}_1` : base
}
