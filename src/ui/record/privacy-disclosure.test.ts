/**
 * public/privacy.html must stay true about where voice audio goes. Both recorders can use the
 * browser's Web Speech API, which may send audio to the browser maker, so the page must say so.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const html = readFileSync(resolve(__dirname, '../../../public/privacy.html'), 'utf8')
const providers = html.slice(html.indexOf('<h2>Service providers</h2>'), html.indexOf('<h2>How long we keep it</h2>'))

describe('privacy page: voice audio', () => {
  it("lists the browser's speech recognition among the providers that may process voice", () => {
    expect(providers).toMatch(/speech recognition/i)
    expect(providers).toMatch(/Google in Chrome/)
    expect(providers).toMatch(/Apple in Safari/)
    expect(providers).toMatch(/only happens if you turn live captions on/)
  })
})
