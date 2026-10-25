# Extraction API (workstream 12)

`POST /api/extract` with `{ "transcript": "..." }` returns a `ReviewDraft` (`src/contracts/types.ts`). Nothing is saved; the confirm screen turns the draft into an Entry.

## Modes
- **claude**: used when `ANTHROPIC_API_KEY` is set. One Messages API call through `@anthropic-ai/sdk` (beta namespace), model `ANTHROPIC_MODEL` or `claude-opus-5-5`, effort `low`. It uses structured outputs (`output_config.format` with a strict JSON schema mirroring ReviewDraft, see `prompt.ts`) and the server-side refusal fallback (`fallbacks: "default"`). The timeout is 30 s and the SDK retries once. The answer is checked with `ReviewDraftSchema`; scores are rounded and clamped to 1-100 first. If the output is invalid, the call is retried once with the validation error. If it is still invalid, or the API errors, or the model refuses, the mock extractor runs and adds the flag `extraction.fallback` (the draft's `mode` is then `mock`). Logs show only the error class and status, never the key.
- **mock**: the rule-based extractor in `mock.ts`, used when no key is set. It works from regexes and keyword lists: room name, company, city (a list of known cities, else "in X"), genre, ratings ("87 out of 100", "9/10" becomes 90, "4 out of 5" becomes 80, a bare number right after a category word), each rating's own clause as its comment (sentences are split at commas, semicolons, "and" and "but"; a clause runs from the segment that names a category to the next segment naming a different one, so "the puzzles were clever, maybe 85" stays together and a score belongs to its clause's category; a category mentioned without a number, like "Pretty hard", keeps the comment with a null, flagged score), whether you escaped, the time ("in 48 minutes", "with 12 minutes left" becomes 48), the timer, multi-room, flashlight and actor booleans (it handles negation and yes/no answers), tools (COMMON_TOOLS plus synonyms), crew ("with A, B and C", "I went with A and B", "A, B and I", "Me, A and B played", "crew was A, B, C"; capitalised names only, pronouns and common words excluded), and puzzles (sentences that mention puzzle/lock/code/cipher/riddle/search, sorted into PUZZLE_TYPES by keyword, and marked memorable when you say favourite/best/loved). Dates: ISO, month names, then relative dates against the injectable `now` (today, yesterday, "last/on/this past Saturday" meaning the most recent one before today, "3 days ago", "a week ago"). Vague dates ("last week", "last weekend", "a few days ago") stay null and are flagged.

In both modes every null field's dotted path goes into `flags` (`finalizeDraft` in `draft.ts`), and `review.voiceTranscript` is the transcript. A bad body returns 400 `{ error }`. The schema caps transcripts at 50k characters.

## Files
- `server/routes/extract.ts`: `extractRoutes(app, opts?)` and `extractionMode()`. `opts.clientFactory`, `opts.now` and `opts.log` are for tests.
- `claude.ts`: the Claude path, `ExtractClient` interface and the real client factory.
- `prompt.ts`: the system prompt and the JSON schema.
- `mock.ts`: the rule-based extractor.
- `draft.ts`: the empty draft, null-path flags and the fallback flag.
- `fixtures.ts`: the sample transcript (The Lost Observatory).

## Tests
`npx vitest run server/extract` covers the mock cases (the sample scenario, negations, 10-point scales, sparse transcripts) and the route with a fake SDK client (validation, retry, fallback, and that the key is never logged). Nothing touches the network.

## Simplifications
The mock extractor is heuristic and English-only. It flags what it cannot find rather than guessing.
