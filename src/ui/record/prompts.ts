/** Fixed prompt checklist the crew talks through while recording. */
export interface RecordPrompt {
  id: string
  title: string
  hint: string
}

export const RECORD_PROMPTS: readonly RecordPrompt[] = [
  { id: 'room', title: 'Room name, company and city', hint: 'What was it called, who runs it, where is it?' },
  { id: 'puzzles', title: 'Every puzzle you remember', hint: 'Locks, logic, maths, searching, sound or light...' },
  { id: 'setting', title: 'Setting and atmosphere', hint: 'How did it look, sound and feel?' },
  { id: 'story', title: 'Storyline', hint: 'What was the plot, and did it hang together?' },
  { id: 'result', title: 'Difficulty, did you escape, and your time', hint: 'Score it out of 100 and say your time.' },
  {
    id: 'tools',
    title: 'Tools and features',
    hint: 'Physical tools, writing boards, flashlights, visible timer, live actors.',
  },
]

/** Seconds of talking we expect per prompt before nudging to the next one. */
export const SECONDS_PER_PROMPT = 40

/**
 * Which prompt to highlight: the first unticked prompt at or after the
 * time-based suggestion, else any earlier unticked prompt. -1 when all are ticked.
 */
export function nextPromptIndex(elapsedSeconds: number, ticked: ReadonlySet<string>): number {
  const n = RECORD_PROMPTS.length
  const byTime = Math.min(n - 1, Math.max(0, Math.floor(elapsedSeconds / SECONDS_PER_PROMPT)))
  for (let i = byTime; i < n; i++) if (!ticked.has(RECORD_PROMPTS[i].id)) return i
  for (let i = 0; i < byTime; i++) if (!ticked.has(RECORD_PROMPTS[i].id)) return i
  return -1
}

/** mm:ss */
export function formatElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** A realistic canned voice note that covers every prompt (feeds the mock extractor well). */
export const SAMPLE_TRANSCRIPT = `Okay, we're recording. Tonight we did The Lost Observatory by Starlight Escapes in San Francisco. It's a sci-fi room, the address is 1420 Valencia Street, and the crew was me, Maya, Leo and Priya.

Puzzles. The first puzzle was a star chart where we lined up constellations on a rotating dome to get a four digit code for a padlock, so a lock and key puzzle. Then a logic puzzle on the writing board where we worked out which astronaut sat at which console. Third, a math puzzle with planet orbits: we added up the orbital periods to get the telescope coordinates. The last one was a search puzzle, hunting around the control room with a UV light for hidden symbols, and using magnets under the desk to drag a key out of a tube. I'd give the puzzles 90 out of 100.

The setting was gorgeous. A domed observatory with a starfield ceiling, humming computers, a little fog, and the lights shifted from dusk to deep space as the clock ran down. Setting gets 92 out of 100.

Storyline: an astronomer vanished mid-experiment and you have to finish her calculations before a comet hits. It held together well but the ending felt rushed. Storyline 78 out of 100.

Difficulty was medium-hard, so difficulty 70 out of 100. We escaped! Our time was 48 minutes, with two hints. Overall I'd give it 87 out of 100.

Tools and features: visible timer, yes, on the main screen. No flashlights, the room was bright enough. There was a live actor playing mission control who came in as the astronaut's assistant. We used a UV light, magnets and a writing board. It was one big room, not multiple rooms. Great night, would recommend.`
