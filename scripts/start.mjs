#!/usr/bin/env node
// One-command local run: `npm start`.
// Checks Node, installs dependencies if needed, builds, starts the server, waits for /health, opens the browser.
// Uses only Node built-ins: it runs before dependencies are installed.
//
// Flags:   --no-build   skip `npm run build` when dist/ is already fresh
// Env:     PORT (default 3000, also read from .env), NO_OPEN=1 or CI to skip opening the browser
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
/** Vite 8 needs Node ^20.19 or >=22.12. */
const NODE_REQUIREMENT = '20.19+ or 22.12+'
const isWin = process.platform === 'win32'

export function nodeMajor(version = process.versions.node) {
  return Number(String(version).replace(/^v/, '').split('.')[0])
}

/** True when this Node can run the build (Vite 8: ^20.19.0 || >=22.12.0). */
export function nodeSupported(version = process.versions.node) {
  const [major, minor] = String(version).replace(/^v/, '').split('.').map(Number)
  if (major === 20) return minor >= 19
  if (major === 22) return minor >= 12
  return major > 22
}

function mtime(p) {
  try {
    return statSync(p).mtimeMs
  } catch {
    return 0
  }
}

/** True when node_modules is missing or package-lock.json changed since the last install. */
export function needsInstall(root = ROOT) {
  const marker = path.join(root, 'node_modules', '.package-lock.json')
  if (!existsSync(path.join(root, 'node_modules'))) return true
  const lock = path.join(root, 'package-lock.json')
  if (!existsSync(lock)) return false
  if (!existsSync(marker)) return true
  if (mtime(lock) <= mtime(marker)) return false
  // The lockfile is newer (a git checkout also bumps mtimes): install only if it really asks for something different.
  return !lockSatisfied(lock, marker)
}

/** True when every non-optional package in package-lock.json is installed at the locked version. */
export function lockSatisfied(lockPath, markerPath) {
  try {
    const want = JSON.parse(readFileSync(lockPath, 'utf8')).packages ?? {}
    const have = JSON.parse(readFileSync(markerPath, 'utf8')).packages ?? {}
    for (const [key, info] of Object.entries(want)) {
      if (!key || info.optional || info.link) continue
      if (!have[key] || have[key].version !== info.version) return false
    }
    return true
  } catch {
    return false
  }
}

function newestMtime(p) {
  let st
  try {
    st = statSync(p)
  } catch {
    return 0
  }
  if (!st.isDirectory()) return st.mtimeMs
  let newest = st.mtimeMs
  for (const name of readdirSync(p)) newest = Math.max(newest, newestMtime(path.join(p, name)))
  return newest
}

/** True when dist/index.html exists and is newer than every client source file. */
export function distIsFresh(root = ROOT) {
  const built = mtime(path.join(root, 'dist', 'index.html'))
  if (!built) return false
  const inputs = ['src', 'public', 'index.html', 'vite.config.ts', 'package-lock.json', 'tsconfig.json']
  return inputs.every((p) => newestMtime(path.join(root, p)) <= built)
}

/** PORT from the environment, else from .env, else 3000. */
export function resolvePort(env = process.env, root = ROOT) {
  let raw = env.PORT
  if (!raw) {
    try {
      const m = readFileSync(path.join(root, '.env'), 'utf8').match(/^\s*PORT\s*=\s*["']?(\d+)["']?\s*$/m)
      if (m) raw = m[1]
    } catch {
      /* no .env */
    }
  }
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : 3000
}

export function openCommand(url, platform = process.platform) {
  if (platform === 'darwin') return ['open', [url]]
  if (platform === 'win32') return ['cmd', ['/c', 'start', '""', url]]
  return ['xdg-open', [url]]
}

function say(msg) {
  console.log(`\x1b[38;5;215m[my-escapes]\x1b[0m ${msg}`)
}

function fail(msg) {
  console.error(`\n\x1b[31m[my-escapes]\x1b[0m ${msg}\n`)
  process.exit(1)
}

function npm(args) {
  const res = spawnSync(isWin ? 'npm.cmd' : 'npm', args, { cwd: ROOT, stdio: 'inherit', shell: isWin })
  if (res.error) fail(`Could not run npm (${res.error.message}). npm ships with Node: reinstall Node from https://nodejs.org`)
  if (res.status !== 0) fail(`\`npm ${args.join(' ')}\` failed (exit ${res.status}). See the output above.`)
}

function ping(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/health', timeout: 1000 }, (res) => {
      res.resume()
      resolve(res.statusCode === 200)
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
  })
}

async function waitForHealth(port, child, timeoutMs = 60_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (child.exitCode !== null) return false
    if (await ping(port)) return true
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

function openBrowser(url) {
  const [cmd, args] = openCommand(url)
  try {
    const p = spawn(cmd, args, { stdio: 'ignore', detached: true })
    p.on('error', () => say(`Open ${url} in your browser.`))
    p.unref()
  } catch {
    say(`Open ${url} in your browser.`)
  }
}

async function main() {
  const argv = process.argv.slice(2)
  const noBuild = argv.includes('--no-build')

  if (!nodeSupported()) {
    fail(
      `My Escapes needs Node ${NODE_REQUIREMENT}, but this is Node ${process.versions.node}.\n` +
        `  Install the current LTS from https://nodejs.org (or run \`nvm use\`; .nvmrc says 22).`,
    )
  }

  if (needsInstall()) {
    say('Installing dependencies (first run or package-lock.json changed)...')
    npm(['install', '--no-audit', '--no-fund'])
  }

  if (noBuild && distIsFresh()) {
    say('Skipping build: dist/ is up to date.')
  } else {
    if (noBuild) say('dist/ is missing or older than the source, building anyway...')
    else say('Building the app...')
    npm(['run', 'build'])
  }

  const port = resolvePort()
  const url = `http://localhost:${port}`
  if (await ping(port)) {
    fail(`Something is already answering on port ${port}. Stop it, or pick another port:  PORT=${port + 1} npm start`)
  }

  say('Starting the server...')
  const tsxCli = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  const child = spawn(process.execPath, [tsxCli, path.join('server', 'index.ts')], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, PORT: String(port) },
  })
  child.on('error', (err) => fail(`Could not start the server: ${err.message}`))

  const forward = (signal) => {
    if (child.exitCode === null) child.kill(signal)
  }
  process.on('SIGINT', () => forward('SIGINT'))
  process.on('SIGTERM', () => forward('SIGTERM'))
  if (!isWin) process.on('SIGHUP', () => forward('SIGHUP'))
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 0 : 1)))
  // If our parent (e.g. `npm start`) is killed without passing the signal on, stop the server too.
  const parent = process.ppid
  setInterval(() => {
    if (process.ppid !== parent) forward('SIGTERM')
  }, 1000).unref()

  if (await waitForHealth(port, child)) {
    if (process.env.NO_OPEN === '1' || process.env.CI) {
      say(`Ready at ${url}`)
    } else {
      say(`Ready, opening ${url}`)
      openBrowser(url)
    }
  } else if (child.exitCode === null) {
    say(`The server has not answered ${url}/health yet. Check the log above.`)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
