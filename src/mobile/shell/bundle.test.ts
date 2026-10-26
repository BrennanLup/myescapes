// @vitest-environment node
/**
 * Phones must never download three.js. Walks the static import graph (dynamic `import()` starts a
 * separate chunk, `import type` is erased) from the entry and from the mobile shell, and fails if
 * it reaches three, React Three Fiber, postprocessing or the 3D room's modules.
 * (Verified against the real build too: see DECISIONS.md, "Mobile code split".)
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '../../..')
const src = path.join(root, 'src')

const FORBIDDEN_PACKAGES = [/^three($|\/)/, /^@react-three\//, /^postprocessing$/, /^three-stdlib/]
// src/gate/SearchScene.tsx is plain SVG (no three.js) and is shared with Escape of the Day on /m;
// the forbidden-package check above still fails if it ever imports three.
const FORBIDDEN_FILES = [/^src\/world\//, /^src\/App\.tsx$/, /^src\/desktop\.tsx$/, /^src\/player\//, /^src\/gate\/GateDoor/, /^src\/gate\/session/, /^src\/state\/store/, /^src\/daily\/ui\/overlay/]

function resolveFile(from: string, spec: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = path.join(src, spec.slice(2))
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec)
  else return null
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    if (existsSync(c) && !c.endsWith('/') && /\.(ts|tsx|js|mjs|css)$/.test(c)) return c
  }
  throw new Error(`cannot resolve ${spec} from ${path.relative(root, from)}`)
}

/** Static, value-level import specifiers of a module. */
export function staticImports(code: string): string[] {
  const noComments = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const out: string[] = []
  const re = /(?:^|[;\n])\s*(import|export)\s+(type\s+)?([^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(noComments))) {
    if (m[2]) continue // import type / export type
    if (m[1] === 'export' && !m[3]) continue
    if (m[3] && /^\{\s*(type\s+[^,}]+,?\s*)+\}\s+from\s+$/.test(m[3].trim() + ' ')) continue // import { type A, type B }
    out.push(m[4])
  }
  return out
}

function graph(entry: string): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>()
  const packages = new Set<string>()
  const stack = [path.join(root, entry)]
  while (stack.length) {
    const f = stack.pop()!
    if (files.has(f)) continue
    files.add(f)
    if (f.endsWith('.css')) continue
    for (const spec of staticImports(readFileSync(f, 'utf8'))) {
      const r = resolveFile(f, spec)
      if (r) stack.push(r)
      else packages.add(spec)
    }
  }
  return { files: new Set([...files].map((f) => path.relative(root, f).split(path.sep).join('/'))), packages }
}

function offenders(g: { files: Set<string>; packages: Set<string> }): string[] {
  return [...[...g.packages].filter((p) => FORBIDDEN_PACKAGES.some((r) => r.test(p))), ...[...g.files].filter((f) => FORBIDDEN_FILES.some((r) => r.test(f)))]
}

describe('mobile bundle stays free of three.js', () => {
  it('the import parser skips dynamic and type-only imports', () => {
    const code = `import { a } from './a'\nimport type { B } from './b'\nimport { type C } from './c'\nexport { d } from './d'\nexport type { E } from './e'\nconst x = () => import('./lazy')\nimport './side.css'\n// import z from './comment'`
    expect(staticImports(code)).toEqual(['./a', './d', './side.css'])
  })

  it('the mobile shell (and everything it imports) never reaches three.js', () => {
    const g = graph('src/mobile/shell/index.tsx')
    expect(g.files.has('src/mobile/log/index.tsx')).toBe(true)
    expect(g.files.has('src/mobile/match/index.tsx')).toBe(true)
    expect(offenders(g)).toEqual([])
  })

  it('the app entry loads the 3D room only lazily', () => {
    const g = graph('src/main.tsx')
    expect(offenders(g)).toEqual([])
  })

  it('the check would catch a leak', () => {
    const g = graph('src/desktop.tsx')
    expect(offenders(g).length).toBeGreaterThan(0)
  })
})
