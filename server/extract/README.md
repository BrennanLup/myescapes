# Extraction API (Phase 1 workstream 12, extraction v2 = Phase 2 workstream 11)

`POST /api/extract` with `{ "transcript": "...", "lat"?: number, "lng"?: number }` returns a `ReviewDraft` (`src/contracts/types.ts`) plus `hints` and `notice` (contract: `ROUTES.extract` in `src/contracts/routes.ts`). Nothing is saved; the confirm screen turns the draft into a visit and review. Auth is optional, so the Phase 1 3D room still works signed out.

## Extraction v2 (Phase 2)
- **Directory hints** (`hints.ts`): `hints = { venue, game, city, country }` for `GET /api/directory/match`. Claude returns its own `hints` (part of the strict JSON schema); the server falls back to `room.company` / `room.name` / `room.city`, and infers an ISO country from country or province words in the transcript, else from the city (`CITY_COUNTRY`).
- **Nearby directory context**: when the phone sends `lat`/`lng`, active venues within 50 km (max 15, nearest first) and their active games are read from Postgres. Claude gets them in a `<nearby_directory>` block so it can spell misheard names the directory's way (and flag the corrected field). In both modes the hints are snapped to the closest nearby venue/game name when a trigram similarity is >= 0.55; a game match alone also picks its venue.
- **Spending caps** (`service.ts`, counters in `server/db/usage.ts`): each Claude call reserves one `extraction` unit for the user and the global ceiling first (`CAP_EXTRACT_CALLS_PER_USER`, default 30; `CAP_EXTRACT_CALLS_GLOBAL`, default 1000, per UTC day). Signed-out callers share one `__anonymous__` bucket with the per-user limit (no IPs stored). If the Claude path falls back to mock, the unit is given back. Over a cap, or if the counter can't be written, the answer is still 200: a mock draft with a friendly `notice`. Mock mode costs nothing and never touches the counters.

## Modes
- **claude**: used when `ANTHROPIC_API_KEY` is set. One Messages API call through `@anthropic-ai/sdk` (beta namespace), model `ANTHROPIC_MODEL` or `claude-opus-5-5`, effort `low`. It uses structured outputs (`output_config.format` with a strict JSON schema mirroring ReviewDraft, see `prompt.ts`) and the server-side refusal fallback (`fallbacks: "default"`). The timeout is 30 s and the SDK retries once. The answer is checked with `ReviewDraftSchema`; scores are rounded and clamped to 1-100 first. If the output is invalid, the call is retried once with the validation error. If it is still invalid, or the API errors, or the model refuses, the mock extractor runs and adds the flag `extraction.fallback` (the draft's `mode` is then `mock`). Logs show only the error class and status, never the key.
- **mock**: the rule-based extractor in `mock.ts`, used when no key is set. It works from regexes and keyword lists: room name, company, city (a list of known cities, else "in X"), genre, ratings ("87 out of 100", "9/10" becomes 90, "4 out of 5" becomes 80, a bare number right after a category word), each rating's own clause as its comment (sentences are split at commas, semicolons, "and" and "but"; a clause runs from the segment that names a category to the next segment naming a different one, so "the puzzles were clever, maybe 85" stays together and a score belongs to its clause's category; a category mentioned without a number, like "Pretty hard", keeps the comment with a null, flagged score), whether you escaped, the time ("in 48 minutes", "with 12 minutes left" becomes 48), the timer, multi-room, flashlight and actor booleans (it handles negation and yes/no answers), tools (COMMON_TOOLS plus synonyms), crew ("with A, B and C", "I went with A and B", "A, B and I", "Me, A and B played", "crew was A, B, C"; capitalised names only, pronouns and common words excluded), and puzzles (sentences that mention puzzle/lock/code/cipher/riddle/search, sorted into PUZZLE_TYPES by keyword, and marked memorable when you say favourite/best/loved). Dates: ISO, month names, then relative dates against the injectable `now` (today, yesterday, "last/on/this past Saturday" meaning the most recent one before today, "3 days ago", "a week ago"). Vague dates ("last week", "last weekend", "a few days ago") stay null and are flagged.

In both modes every null field's dotted path goes into `flags` (`finalizeDraft` in `draft.ts`), and `review.voiceTranscript` is the transcript. A bad body returns 400 `{ error }`. The schema caps transcripts at 50k characters.

## Files
- `server/routes/extract.ts`: `extractRoutes(app, ctx, opts?)` (contract route via `defineRoute`, 20 requests/min per IP) and `extractionMode(env?)`. `opts.clientFactory` and `opts.log` are for tests; the clock is `ctx.now()`.
- `service.ts`: `extractV2()`: mode, caps, nearby lookup, hints, notice.
- `hints.ts`: name similarity, country inference, nearby directory query, hint builder.
- `test-app.ts`: a test server with just the extract and transcribe routes, injectable clients, PGlite (provider keys blanked).
- `claude.ts`: the Claude path, `ExtractClient` interface and the real client factory.
- `prompt.ts`: the system prompt and the JSON schema.
- `mock.ts`: the rule-based extractor.
- `draft.ts`: the empty draft, null-path flags and the fallback flag.
- `fixtures.ts`: the sample transcript (The Lost Observatory).

## Tests
`npx vitest run server/extract` covers the mock cases (the sample scenario, negations, 10-point scales, sparse transcripts), hints and the nearby query, and the route with a fake SDK client (validation, retry, fallback, nearby prompt, caps per user / global / anonymous / next day, fail-closed when the database is down, and that the key is never logged). Nothing touches the network.

## Simplifications
The mock extractor is heuristic and English-only. It flags what it cannot find rather than guessing.
