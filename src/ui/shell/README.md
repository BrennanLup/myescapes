# Shell: loading and onboarding (workstream 19)

Exports from `index.tsx`: `LoadingScreen`, `Hud`, `SettingsOverlay`, `PerfMonitor`. They are already mounted by `App.tsx` and `World.tsx`.

## LoadingScreen (`data-testid="loading-screen"`)
- A full-screen night gradient with a lamp glow, the title "My Escapes", fanned polaroids with a padlock and a wiggling key, and a progress bar.
- Progress (`computeProgress` in `logic.ts`) is 50% assets (drei `useProgress`, which counts as done when the loading manager never saw a file) and 50% `dataStatus`. It is capped by a 600 ms minimum display time so the screen does not flash.
- If the data fails to load, it shows the error and a "Try again" button (`retry-button`) that calls `store.loadData()`.
- When everything is ready, it shows "Enter the room" (`enter-button`; Enter/Space also work). That click emits `user:gesture`. The screen then fades out over 550 ms and calls `setWorldReady(true)`.
- `?autostart=1` skips the button. Auto-enter is also the default when `navigator.webdriver` is set, and `?autostart=0` forces the button back on (used for the loading screenshot).

## Hud (`data-testid="hud"`)
- Hidden before `worldReady` and while any overlay is open.
- Top-left: a title chip with the room count, plus a "Demo mode" badge (`mode-badge`) when `/api/status` reports mock extraction or seed storage. The badge has a tooltip and opens settings when clicked.
- Top-right round buttons: wish list (`wishlist:open`), year wrap (`wrap:open`), log a room (`record:open`), settings (`settings:open`, `settings-button`), `VolumeToggle` from `@/audio`, and help "?" (re-opens the controls hint).
- Sort: at 768 px and wider, an always-visible chip group (`sort-<key>`). Narrower screens get a round sort button (`sort-button`) that opens the same chips. Keys 1-6 (top row or numpad) change the sort; they are ignored while typing in a field.
- Controls hint (`controls-hint`): 3 lines with desktop and touch variants (from `store.isTouch`). It appears the first time the world becomes ready, fades after 8 s, can be dismissed, and re-opens from "?".
- Toasts (`shell-toast`) are always rendered, e.g. the perf downgrade notice.

## SettingsOverlay (`data-testid="settings-overlay"`)
Settings: look sensitivity (0.2-3), invert Y, head bob, quality presets (`quality-low|medium|high`, each with a one-line description) and volume. Every change goes through `store.updateSettings`. The "Server status" section shows Claude vs mock and Google Sheet vs seed, plus the env vars that switch each one to real. Esc, the close button or a backdrop click emits `overlay:close`.

## PerfMonitor (inside the Canvas)
- Writes an EMA-smoothed `runtime.fps` every frame.
- Governor (`stepGovernor`): after a 3 s warm-up, if fps stays below 40 for 6 s at medium or high quality, it switches to Low once per session and shows "Switched to Low quality for smoother play". It is disabled under `navigator.webdriver`, in a hidden tab and before `worldReady`.
- 1.5 s after window load, it prints a console warning if `totalAssetBytes()` or the summed `transferSize` of the navigation and resource entries is over `LOAD_BUDGET_BYTES`.
- `?debug=1` shows an fps, draw-call and triangle readout (`perf-readout`, read from `gl.info`).

## Simplifications
- The downgrade goes straight to Low (it matches the toast copy), not one preset at a time.
- The volume slider sets `settings.volume` and sets `muted` when it is at 0. The audio workstream reads those values.
- Shell-local UI state (hint, toast, cached server status) lives in `shellStore.ts`, a small Zustand store, not in the app store.
