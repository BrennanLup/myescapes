// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
// @ts-expect-error plain .mjs script without type declarations
import * as start from '../scripts/start.mjs'

const dirs: string[] = []
function tmp() {
  const d = mkdtempSync(path.join(tmpdir(), 'escapes-start-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function lock(pkgs: Record<string, { version: string; optional?: boolean }>) {
  return JSON.stringify({ packages: { '': { name: 'x' }, ...pkgs } })
}

describe('scripts/start.mjs helpers', () => {
  it('nodeMajor', () => {
    expect(start.nodeMajor('22.3.0')).toBe(22)
    expect(start.nodeMajor('v18.19.1')).toBe(18)
  })

  it('needsInstall: missing node_modules', () => {
    const d = tmp()
    writeFileSync(path.join(d, 'package-lock.json'), lock({}))
    expect(start.needsInstall(d)).toBe(true)
  })

  it('needsInstall: newer lockfile only matters when versions differ', () => {
    const d = tmp()
    mkdirSync(path.join(d, 'node_modules'))
    const marker = path.join(d, 'node_modules', '.package-lock.json')
    const lockPath = path.join(d, 'package-lock.json')
    writeFileSync(marker, lock({ 'node_modules/a': { version: '1.0.0' } }))
    writeFileSync(lockPath, lock({ 'node_modules/a': { version: '1.0.0' }, 'node_modules/opt': { version: '1.0.0', optional: true } }))
    utimesSync(marker, new Date(1000), new Date(1000))
    expect(start.needsInstall(d)).toBe(false)
    writeFileSync(lockPath, lock({ 'node_modules/a': { version: '2.0.0' } }))
    expect(start.needsInstall(d)).toBe(true)
  })

  it('distIsFresh', () => {
    const d = tmp()
    mkdirSync(path.join(d, 'src'))
    writeFileSync(path.join(d, 'src', 'main.tsx'), '')
    expect(start.distIsFresh(d)).toBe(false)
    mkdirSync(path.join(d, 'dist'))
    writeFileSync(path.join(d, 'dist', 'index.html'), '')
    utimesSync(path.join(d, 'src', 'main.tsx'), new Date(1000), new Date(1000))
    utimesSync(path.join(d, 'src'), new Date(1000), new Date(1000))
    expect(start.distIsFresh(d)).toBe(true)
  })

  it('resolvePort reads env then .env', () => {
    const d = tmp()
    expect(start.resolvePort({ PORT: '4120' }, d)).toBe(4120)
    expect(start.resolvePort({}, d)).toBe(3000)
    writeFileSync(path.join(d, '.env'), 'FOO=1\nPORT=5005\n')
    expect(start.resolvePort({}, d)).toBe(5005)
  })

  it('openCommand per platform', () => {
    expect(start.openCommand('http://x', 'darwin')[0]).toBe('open')
    expect(start.openCommand('http://x', 'linux')[0]).toBe('xdg-open')
    expect(start.openCommand('http://x', 'win32')[1]).toContain('start')
  })
})
