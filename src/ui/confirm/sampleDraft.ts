import type { ReviewDraft } from '@/contracts/types'

/** A realistic extractor draft with a few unknowns, for tests and screenshots. */
export function sampleDraft(over: Partial<ReviewDraft> = {}): ReviewDraft {
  return {
    room: { name: 'The Clockmaker', company: 'Puzzle Parlour', city: null, genre: 'mystery', address: null, website: null },
    review: {
      date: null,
      crew: ['Brennan', 'Maya'],
      ratings: {
        overall: { score: 88, comment: 'Loved the finale.' },
        puzzles: { score: 90, comment: 'Clever gear chain.' },
        setting: { score: 85, comment: '' },
        storyline: { score: null, comment: '' },
        difficulty: { score: 70, comment: 'Just right.' },
      },
      puzzles: [
        { description: 'Set the grandfather clock to 4:35 to open the panel', type: 'lock-and-key', memorable: true },
        { description: 'Gear ratio puzzle on the workbench', type: null, memorable: false },
      ],
      escaped: true,
      escapeTimeMinutes: 52,
      visibleTimer: true,
      multiRoom: null,
      flashlights: false,
      liveActors: null,
      toolsUsed: ['keypads', 'magnets'],
      voiceTranscript:
        'We did The Clockmaker at Puzzle Parlour with Maya. Escaped in 52 minutes! Overall like an 88, puzzles 90, the gear chain was clever...',
    },
    flags: ['room.city', 'review.date', 'review.ratings.storyline.score', 'review.puzzles.1.type', 'review.multiRoom', 'review.liveActors'],
    mode: 'mock',
    ...over,
  }
}
