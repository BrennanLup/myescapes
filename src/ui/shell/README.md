# Shell: loading and onboarding (workstream 19)

Exports from `index.tsx`: `LoadingScreen`, `Hud`, `SettingsOverlay`, `PerfMonitor`, `CanvasBoundary`. They are already mounted by `App.tsx` and `World.tsx`.

## CanvasBoundary (`data-testid="canvas-failed"`)
Wraps the room's `<Canvas>` in `App.tsx`. react-three-fiber rethrows a failed WebGL context (or any error inside the scene) out of `<Canvas>`, and without a boundary React would unmount the whole page. The boundary instead shows an alert above the loading screen (z-90): "The room couldn't light up", with WebGL-specific advice (hardware acceleration, another browser) when the error mentions WebGL or a context, a **Reload** button and **Open the light version** (`/m`, no three.js). The error is logged with `console.error`.

## BootSplash (`BootSplash.tsx`, `data-testid="page-loading"`)
Every page load starts with a splash instead of an empty screen: the door logo, "My Escapes" and a CSS-only shimmer on the loader's night gradient.
- `index.html` paints it inside `#root` (markup and inline `<style>` with the `.boot-*` classes), so it shows before any JavaScript or stylesheet loads. React replaces it on its first render.
- `BootSplash` renders the same markup and is every "still loading" fallback on the way to a room: the router's `PageFallback`, the landing's `Blank` while the session or the room's code loads, `/home/:handle` (with "Heading to Vera's room…") and `/daily/room` ("Unlocking today's room…", `daily-room-loading`). The shimmer gets a negative `animationDelay` so it carries on in step when React swaps the markup. Reduced motion stops it.
- No imports, so the router can import it straight from the file without pulling in the shell (`index.tsx` imports three.js helpers). Keep the markup and the `.boot-*` styles in `index.html` in sync; `BootSplash.test.tsx` checks both.
- `headingToRoom(owner)` gives "Heading to Vera's room…" (first name, else `@handle`), shared with the LoadingScreen tagline.

## LoadingScreen (`data-testid="loading-screen"`)
- A full-screen night gradient with a lamp glow, the title "My Escapes", fanned polaroids with a padlock and a wiggling key, and a progress bar.
- The tagline (`loading-tagline`) is "every room we ever broke out of" in your own room and "Heading to Vera's room…" in a friend's (`store.visiting`; the @handle until their name has loaded), also used as the dialog's label.
- Progress (`computeProgress` in `logic.ts`) is 50% assets (drei `useProgress`, which counts as done when the loading manager never saw a file) and 50% `dataStatus`. It is capped by a 600 ms minimum display time so the screen does not flash.
- If the data fails to load, it shows the error and a "Try again" button (`retry-button`) that calls `store.loadData()`.
- When everything is ready, it shows "Enter the room" (`enter-button`; Enter/Space also work). That click emits `user:gesture`. The screen then fades out over 550 ms and calls `setWorldReady(true)`.
- `?autostart=1` skips the button. Auto-enter is also the default when `navigator.webdriver` is set, and `?autostart=0` forces the button back on (used for the loading screenshot).

## Hud (`data-testid="hud"`)
- Hidden before `worldReady` and while any overlay is open.
- Top-left: a title chip with the room count, plus a "Demo mode" badge (`mode-badge`) when `/api/status` reports mock extraction or seed storage. The badge has a tooltip and opens settings when clicked.
- Top-right round buttons: wish list (`wishlist:open`), year wrap (`wrap:open`), log a room (`record:open`), settings (`settings:open`, `settings-button`), `VolumeToggle` from `@/audio`, and help "?" (re-opens the controls hint).
- Sort: at 768 px and wider, an always-visible chip group (`sort-<key>`). Narrower screens get a round sort button (`sort-button`) that opens the same chips. Keys 1-6 (top row or numpad) change the sort; they are ignored while typing in a field.
- Controls hint (`controls-hint`): 4 lines (the last one is the camera switch) with desktop and touch variants (from `store.isTouch`). It appears the first time the world becomes ready, fades after 8 s, can be dismissed, and re-opens from "?".
- Toasts (`shell-toast`) are always rendered, e.g. the perf downgrade notice.

## SettingsOverlay (`data-testid="settings-overlay"`)
Settings: look sensitivity (0.2-3), invert Y, head bob, quality presets (`quality-low|medium|high`, each with a one-line description) and volume. Every change goes through `store.updateSettings`. The "Server status" section shows Claude vs mock and Google Sheet vs seed, plus the env vars that switch each one to real. Esc, the close button or a backdrop click emits `overlay:close`.

## PerfMonitor (inside the Canvas)
- Writes an EMA-smoothed `runtime.fps` every frame.
- Governor (`stepGovernor`): after a 3 s warm-up, if fps stays below 40 for 6 s at medium or high quality, it switches to Low once per session and shows "Switched to Low quality for smoother play". It is disabled under `navigator.webdriver`, in a hidden tab and before `worldReady`.
- 1.5 s after window load, it prints a console warning if `totalAssetBytes()` or the summed `transferSize` of the navigation and resource entries is over `LOAD_BUDGET_BYTES`.
- `?debug=1` shows an fps, draw-call and triangle readout (`perf-readout`, read from `gl.info`, totalled across all render passes of a frame). On narrow screens the HUD buttons sit in one row along the top, and on touch the controls hint sits under them, clear of the joystick.

## Simplifications
- The downgrade goes straight to Low (it matches the toast copy), not one preset at a time.
- The volume slider sets `settings.volume` and sets `muted` when it is at 0. The audio workstream reads those values.
- Shell-local UI state (hint, toast, cached server status) lives in `shellStore.ts`, a small Zustand store, not in the app store.
