// Precompresses the text assets of the Vite build (dist/) to .br and .gz siblings, so the static
// server can send them compressed (@fastify/static `preCompressed`). Runs as a post-build step
// (`npm run build`) and again at server startup for anything missing or stale. Node built-ins only.
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

/** Extensions worth compressing (images, audio and fonts are already compressed). */
export const COMPRESSIBLE = new Set(['.js', '.mjs', '.css', '.svg', '.html', '.json', '.txt', '.xml', '.map', '.webmanifest'])
/** Files smaller than this are not worth the extra request-path lookup. */
export const MIN_BYTES = 512

export interface PrecompressResult {
  /** Source files with up-to-date .br and .gz siblings after the run. */
  files: string[]
  /** How many .br/.gz files were (re)written in this run. */
  written: number
}

function walk(dir: string, out: string[]) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(p, out)
    else if (entry.isFile()) out.push(p)
  }
}

function isFresh(target: string, srcMtime: number) {
  try {
    return statSync(target).mtimeMs >= srcMtime
  } catch {
    return false
  }
}

/** Writes `<file>.br` and `<file>.gz` for every compressible file under `distDir` whose siblings are missing or older. */
export function precompressDist(distDir: string): PrecompressResult {
  const result: PrecompressResult = { files: [], written: 0 }
  if (!existsSync(distDir)) return result
  const all: string[] = []
  walk(distDir, all)
  for (const file of all) {
    if (!COMPRESSIBLE.has(path.extname(file).toLowerCase())) continue
    const st = statSync(file)
    if (st.size < MIN_BYTES) continue
    const br = `${file}.br`
    const gz = `${file}.gz`
    let buf: Buffer | undefined
    try {
      if (!isFresh(br, st.mtimeMs)) {
        buf ??= readFileSync(file)
        writeFileSync(
          br,
          brotliCompressSync(buf, {
            params: {
              [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
              [constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
              [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
            },
          }),
        )
        result.written++
      }
      if (!isFresh(gz, st.mtimeMs)) {
        buf ??= readFileSync(file)
        writeFileSync(gz, gzipSync(buf, { level: 9 }))
        result.written++
      }
      result.files.push(file)
    } catch (err) {
      // A read-only dist still works: the server falls back to the uncompressed file.
      console.warn(`  Could not precompress ${path.relative(distDir, file)}: ${(err as Error).message}`)
    }
  }
  return result
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const dist = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist'))
  const t0 = Date.now()
  const { files, written } = precompressDist(dist)
  console.log(`precompressed ${files.length} file(s) in ${dist} (${written} written, ${Date.now() - t0} ms)`)
}
