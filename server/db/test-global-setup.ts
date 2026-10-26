/**
 * Vitest global setup: build one migrated PGlite data dir per run and share it as a template,
 * so each test file's `createTestDb()` loads it in ~0.5 s instead of running initdb (~2 s).
 * The template file is deleted at teardown.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { TestProject } from 'vitest/node'
import { createPglite } from './client'

declare module 'vitest' {
  export interface ProvidedContext {
    pgliteTemplate: string
  }
}

let dir: string | undefined

export async function setup(project: TestProject) {
  const handle = await createPglite('memory')
  await handle.migrate()
  const dump = await handle.dumpDataDir()
  await handle.close()
  dir = mkdtempSync(path.join(os.tmpdir(), 'myescapes-pglite-'))
  const file = path.join(dir, 'template.tar.gz')
  writeFileSync(file, Buffer.from(await dump.arrayBuffer()))
  project.provide('pgliteTemplate', file)
}

export function teardown() {
  if (dir) rmSync(dir, { recursive: true, force: true })
}
