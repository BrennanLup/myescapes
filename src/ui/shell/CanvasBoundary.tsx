/**
 * Catches a 3D failure (most often: the browser could not create a WebGL context, e.g. with
 * hardware acceleration off or the GPU process gone) so the page shows a friendly way out instead
 * of going blank. Without it, react-three-fiber rethrows the error and React unmounts the whole app,
 * loading screen included.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State {
  error: Error | null
}

export class CanvasBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[3d] the room could not start', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return <CanvasFailed message={this.state.error.message} />
  }
}

export function CanvasFailed({ message }: { message?: string }) {
  const webgl = /webgl|context/i.test(message ?? '')
  return (
    <div
      role="alert"
      data-testid="canvas-failed"
      // Above the loading screen (z-80), which would otherwise sit at "ready" forever.
      className="fixed inset-0 z-[90] flex items-center justify-center bg-[linear-gradient(180deg,#4a2f48,var(--color-night)_420px)] bg-no-repeat px-4 py-10 font-body"
    >
      <div className="w-full max-w-md rounded-[var(--radius-cozy)] bg-panel p-6 text-center text-ink shadow-[var(--shadow-cozy)]">
        <div aria-hidden className="text-4xl">
          🕯️
        </div>
        <h1 className="m-0 mt-2 font-display text-2xl font-semibold [text-wrap:balance]">The room couldn't light up</h1>
        <p className="m-0 mt-2 text-ink-soft">
          {webgl
            ? 'Your browser could not start 3D graphics. Turning on hardware acceleration, or trying another browser, usually fixes it.'
            : 'Something went wrong while drawing the room. Reloading usually fixes it.'}
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            data-testid="canvas-reload"
            onClick={() => window.location.reload()}
            className="min-h-11 rounded-full bg-accent px-5 font-display text-base font-semibold text-accent-ink shadow-sm transition hover:scale-[1.02] active:scale-95"
          >
            Reload
          </button>
          <a href="/m" className="inline-flex min-h-11 items-center rounded-full bg-white/70 px-5 text-sm font-bold text-ink ring-1 ring-panel-edge">
            Open the light version
          </a>
        </div>
      </div>
    </div>
  )
}
