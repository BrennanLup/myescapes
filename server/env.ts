// Loads `.env` (quietly) as a side effect. Import this module before anything that reads process.env.
import { config } from 'dotenv'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Repo root (the folder holding package.json). */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

config({ path: path.join(ROOT, '.env'), quiet: true })

let cachedVersion: string | undefined

/** Version string from package.json, falling back to "0.0.0". */
export function appVersion(): string {
  if (cachedVersion) return cachedVersion
  try {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { version?: unknown }
    cachedVersion = typeof pkg.version === 'string' ? pkg.version : '0.0.0'
  } catch {
    cachedVersion = '0.0.0'
  }
  return cachedVersion
}

/** Port from PORT (default 3000). Invalid values fall back to 3000. */
export function resolvePort(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.PORT)
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : 3000
}

export interface FeatureLine {
  name: string
  real: boolean
  mode: string
  /** Env vars that switch the feature to real mode (names only, never values). */
  vars: string[]
}

/** Human-readable startup banner. Prints env var names, never their values. */
export function startupBanner(opts: {
  port: number
  extraction: string
  storage: string
  version: string
  distReady: boolean
}): string {
  const features: FeatureLine[] = [
    { name: 'Review extraction', real: opts.extraction === 'claude', mode: opts.extraction, vars: ['ANTHROPIC_API_KEY'] },
    {
      name: 'Storage',
      real: opts.storage === 'google-sheet',
      mode: opts.storage,
      vars: ['GOOGLE_SHEET_ID', 'GOOGLE_SERVICE_ACCOUNT_JSON'],
    },
  ]
  const lines = [
    '',
    `  My Escapes v${opts.version}`,
    `  Running at http://localhost:${opts.port}`,
    '',
  ]
  for (const f of features) {
    const tag = f.real ? 'REAL' : 'MOCK'
    const hint = f.real ? `(using ${f.vars.join(' + ')})` : `(set ${f.vars.join(' + ')} in .env to switch to real)`
    lines.push(`  [${tag}] ${f.name}: ${f.mode} ${hint}`)
  }
  if (!opts.distReady) {
    lines.push('', '  Note: no dist/ build found. Run `npm run build` (or `npm start`) to build the app.')
  }
  lines.push('', '  Press Ctrl+C to stop.', '')
  return lines.join('\n')
}
