# Brand assets

- `logo.svg`: the master logo (arched door with a keyhole and a timer LED). Rounded square, for app icons and favicons.
- `logo-maskable.svg`: the same art full-bleed, for maskable PWA icons and the Apple touch icon.
- `google-oauth-logo-120.png`: 120×120 PNG for the Google OAuth consent screen (Branding → App logo).
- `og.html`: source for `public/og-image.png` (1200×630 social preview).

Rendered copies live in `public/` (`favicon.svg`, `icons/`, `og-image.png`, `manifest.webmanifest`).
Colours come from the app palette in `src/index.css`: night `#2a1f2d`, plum `#4a2f48`, accent `#e07b39`, cork `#c69a63`, LED `#2de2d0`.

## Google OAuth consent screen (Google Auth Platform → Branding)

| Field | Value |
| --- | --- |
| App name | My Escapes |
| App logo | `brand/google-oauth-logo-120.png` |
| Application home page | `https://<domain>/about` |
| Privacy policy link | `https://<domain>/privacy` |
| Terms of service link | `https://<domain>/terms` |
| Authorised domain | the app's domain, e.g. `bubbly-hope-production.up.railway.app` |

The static pages are `public/about.html`, `public/privacy.html` and `public/terms.html`, served at clean URLs by `server/static.ts`.
