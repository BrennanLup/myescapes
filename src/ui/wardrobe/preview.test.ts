import { afterEach, describe, expect, it, vi } from 'vitest'
import { hasWebGL, resetWebGLCheck } from './Preview'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  resetWebGLCheck()
})

describe('hasWebGL', () => {
  it('probes once per page and releases the probe context at once', () => {
    vi.stubGlobal('WebGLRenderingContext', function WebGLRenderingContext() {})
    const loseContext = vi.fn()
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((kind: string) =>
      kind === 'webgl2' ? { getExtension: (name: string) => (name === 'WEBGL_lose_context' ? { loseContext } : null) } : null) as never)
    expect(hasWebGL()).toBe(true)
    expect(hasWebGL()).toBe(true)
    expect(getContext).toHaveBeenCalledTimes(1)
    expect(loseContext).toHaveBeenCalledTimes(1)
  })

  it('is false without WebGL', () => {
    vi.stubGlobal('WebGLRenderingContext', function WebGLRenderingContext() {})
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    expect(hasWebGL()).toBe(false)
  })
})
