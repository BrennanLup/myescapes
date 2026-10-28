# Voice Capture (`src/ui/record`)

`RecordOverlay`: the "Log a new escape" overlay, opened by `record:open` (desk terminal) as overlay `{ kind: 'record' }`.

## What it does
- A big record button. It uses `getUserMedia({ audio: true })` and `MediaRecorder`, and shows the elapsed time and a live input level meter (an `AnalyserNode` RMS that writes the `--level` CSS variable with no React re-renders). It emits `record:start`, then `record:stop` with `{ transcript }`.
- The six-prompt checklist is always visible. While you record, the next prompt is highlighted over time (40 s per prompt) and skips prompts you have ticked. Tap a prompt to tick it.
- A live transcript comes from the Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`, continuous with interim results). The session restarts when the browser ends it after a silence. Recording again appends to the current (edited) text.
- After you stop, the transcript is in an editable textarea, and the audio Blob can be played back in the overlay. The audio stays on the device and is never uploaded.
- Fallbacks: with no microphone, a denied microphone or no speech recognition, a note explains that audio-only transcription needs a browser with speech recognition. You can then type or paste the transcript or upload a `.txt` file. "Use a sample transcript" fills in `SAMPLE_TRANSCRIPT` (The Lost Observatory, Starlight Escapes, San Francisco). The sample covers every prompt.
- "Turn it into a review" calls `apiClient.extract(transcript)`. While it waits, the button shows "Reading your notes...". It then emits `draft:ready` with `{ draft }`, and the bridge opens the confirm screen. Errors show inline with a Retry button.
- Focus (QA r4): on open, focus moves into the dialog: to the transcript box when the main pointer is fine (mouse, trackpad; type straight away), to the dialog title (`tabIndex=-1`) on touch screens, where focusing a text box would pop the keyboard over the record button. On close, focus goes back to whatever had it before (the HUD's `record-button`) unless the next overlay (the review form) has already taken it. Esc pressed in the transcript box still reaches the close handler; other keys stay in the box, away from the room's key bindings.
- Esc or × emits `overlay:close`. If a transcript exists, you are asked to confirm first. On unmount the overlay stops the tracks, the recorder, the recognition and the audio context, and revokes the blob URL.

## Files
- `index.tsx`: the overlay. It also re-exports `SAMPLE_TRANSCRIPT` and `RECORD_PROMPTS`.
- `useVoiceCapture.ts`: the hook for the microphone, recorder, meter and speech.
- `speech.ts`: minimal Web Speech typings, feature detection and result folding.
- `prompts.ts`: the prompt list, highlight logic, `formatElapsed` and `SAMPLE_TRANSCRIPT`.
- `record.test.tsx`: jsdom tests with a mocked MediaRecorder, getUserMedia and SpeechRecognition.

Test ids: `record-toggle`, `transcript-input`, `sample-transcript`, `extract-submit`, plus `record-overlay`, `record-close`, `record-discard`, `record-live`, `record-fallback`, `record-prompts`, `prompt-<id>`, `transcript-file` and `record-playback`.

## Simplifications
- Audio is never transcribed server-side. Without speech recognition, the user types, pastes or uploads the text.
- Loading the sample ticks every prompt, because the sample covers them all.
