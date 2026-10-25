/**
 * Tiny sample dataset for unit tests and early visual checks. The real seed
 * (12 rooms) lives in seed/reviews.json, owned by the data layer.
 * Owned by the orchestrator.
 */
import type { Dataset, Ratings } from './types'

const r = (o: number, p: number, s: number, st: number, d: number): Ratings => ({
  overall: { score: o, comment: 'Loved it.' },
  puzzles: { score: p, comment: 'Clever chains.' },
  setting: { score: s, comment: 'Gorgeous set.' },
  storyline: { score: st, comment: 'Fun twist.' },
  difficulty: { score: d, comment: 'Just right.' },
})

export const FIXTURE_DATASET: Dataset = {
  source: 'seed',
  crew: [
    { id: 'c1', name: 'Brennan' },
    { id: 'c2', name: 'Maya' },
    { id: 'c3', name: 'Jules' },
  ],
  rooms: [
    { id: 'room_fx_1', name: 'The Clockmaker', company: 'Puzzle Parlour', city: 'San Francisco', genre: 'mystery', address: '1 Market St', website: 'https://example.com', photos: [] },
    { id: 'room_fx_2', name: 'Haunted Lighthouse', company: 'Escape Hatch', city: 'Toronto', genre: 'horror', address: '10 Queen St W', website: 'https://example.com', photos: [] },
    { id: 'room_fx_3', name: 'Mars Base Omega', company: 'Puzzle Parlour', city: 'San Francisco', genre: 'sci-fi', address: '2 Mission St', website: 'https://example.com', photos: [] },
  ],
  reviews: [
    {
      id: 'rev_fx_1', roomId: 'room_fx_1', date: '2025-03-14', crew: ['Brennan', 'Maya'], ratings: r(88, 90, 85, 80, 70),
      puzzles: [
        { id: 'pz_fx_1', reviewId: 'rev_fx_1', description: 'Set the grandfather clock to 4:35 to open the panel', type: 'lock-and-key', memorable: true },
        { id: 'pz_fx_2', reviewId: 'rev_fx_1', description: 'Gear ratio math puzzle', type: 'math', memorable: false },
      ],
      escaped: true, escapeTimeMinutes: 52, visibleTimer: true, multiRoom: true, flashlights: false, liveActors: false,
      toolsUsed: ['keypads', 'magnets'], voiceTranscript: 'We did The Clockmaker at Puzzle Parlour...', photos: [],
    },
    {
      id: 'rev_fx_2', roomId: 'room_fx_2', date: '2024-10-31', crew: ['Brennan', 'Jules'], ratings: r(76, 70, 92, 75, 85),
      puzzles: [
        { id: 'pz_fx_3', reviewId: 'rev_fx_2', description: 'Shine the UV light on the logbook to find the cipher', type: 'search', memorable: true },
      ],
      escaped: false, escapeTimeMinutes: 60, visibleTimer: false, multiRoom: false, flashlights: true, liveActors: true,
      toolsUsed: ['UV light', 'flashlights'], voiceTranscript: '', photos: [],
    },
    {
      id: 'rev_fx_3', roomId: 'room_fx_3', date: '2025-07-02', crew: ['Maya', 'Jules'], ratings: r(93, 95, 90, 88, 80),
      puzzles: [
        { id: 'pz_fx_4', reviewId: 'rev_fx_3', description: 'Reroute power by matching symbol sequence on the console', type: 'logic', memorable: true },
      ],
      escaped: true, escapeTimeMinutes: 47, visibleTimer: true, multiRoom: true, flashlights: false, liveActors: false,
      toolsUsed: ['keypads', 'RFID'], voiceTranscript: '', photos: [],
    },
  ],
  wishlist: [
    { id: 'w1', name: 'The Vault', city: 'Toronto', link: '', addedBy: 'Maya', priority: 1, done: false },
    { id: 'w2', name: 'Sky Pirates', city: 'San Francisco', link: '', addedBy: 'Jules', priority: 2, done: false },
  ],
}
