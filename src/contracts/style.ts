/**
 * Visual style tokens. Cozy, warm, low-poly, playful. Never realistic, never dark horror.
 * Reference: a warm isometric gaming bedroom: orange lamp light, teal accent LEDs,
 * honey wood, cream plaster, plum/rust fabrics, lots of plants.
 *
 * The same tokens are exposed to Tailwind as CSS variables in `src/index.css`
 * (e.g. `bg-panel`, `text-ink`, `bg-accent`, `text-teal`). Use those in UI.
 *
 * Owned by the orchestrator.
 */

export const PALETTE = {
  // Surfaces
  plaster: '#e9d7c0',
  plasterAccent: '#c98f6b',
  ceiling: '#f1e4d1',
  woodLight: '#c88a52',
  woodDark: '#7a4a2b',
  woodFloor: '#a96a3f',
  baseboard: '#f3e7d6',
  cork: '#c69a63',
  paper: '#fbf5ea',
  chalkboard: '#2f4a42',
  metal: '#9aa3a8',
  metalDark: '#3d4248',
  brass: '#d4a24c',
  ceramic: '#efe6da',
  pot: '#c0603f',
  // Fabrics
  fabricOrange: '#e07b39',
  fabricTeal: '#2f8f8a',
  fabricCream: '#efe0c8',
  fabricPlum: '#6d3b5c',
  rug: '#b8503f',
  // Nature
  leaf: '#5a9a4b',
  leafDark: '#3f7a3a',
  // Accents
  redString: '#d42a2a',
  pinRed: '#e8433a',
  screen: '#18303a',
  // Background behind the windows
  sky: '#f7b98a',
} as const

export const LIGHT = {
  /** Warm lamp light. */
  lampWarm: '#ffb36b',
  /** Softer warm fill. */
  fillWarm: '#ffd9b0',
  /** Teal accent LEDs. */
  ledTeal: '#2de2d0',
  /** Cool window light (dusk). */
  windowCool: '#9fc6ff',
  /** Ambient / hemisphere. */
  hemiSky: '#ffe2c4',
  hemiGround: '#b07a5e',
  /** Fog / clear colour (outside, unseen mostly). */
  background: '#2a1f2d',
} as const

export const FONTS = {
  /** Headings: rounded, friendly. Loaded from Google Fonts in index.css. */
  display: "'Fredoka', 'Nunito', system-ui, sans-serif",
  /** Body text. */
  body: "'Nunito', system-ui, sans-serif",
  /** Handwriting for polaroid captions and chalkboard. */
  hand: "'Caveat', 'Comic Sans MS', cursive",
  /** Monospace for the desk terminal. */
  mono: "'JetBrains Mono', ui-monospace, monospace",
} as const

/** UI tokens (mirrored as CSS variables in index.css). */
export const UI = {
  panel: '#fff7ec',
  panelEdge: '#e8c9a4',
  ink: '#3b2a26',
  inkSoft: '#7a6258',
  accent: '#e07b39',
  accentInk: '#ffffff',
  teal: '#2f8f8a',
  good: '#4f9d5a',
  bad: '#c4513f',
  warn: '#e0a93a',
  backdrop: 'rgba(40, 24, 30, 0.55)',
  radius: '18px',
  shadow: '0 18px 50px rgba(60, 30, 20, 0.35)',
} as const

/** Puzzle type chip colours. */
export const PUZZLE_TYPE_COLORS: Record<string, string> = {
  'lock-and-key': '#d4a24c',
  logic: '#2f8f8a',
  math: '#6d7fd1',
  physical: '#e07b39',
  search: '#5a9a4b',
  'audio-visual': '#b5579b',
}

/** Genre colours (polaroid tape, legend chips). */
export const GENRE_COLORS: Record<string, string> = {
  horror: '#8a3b52',
  mystery: '#5b5fa8',
  adventure: '#e07b39',
  'sci-fi': '#2f8f8a',
  fantasy: '#9b6bc4',
  heist: '#d4a24c',
  historical: '#a0704a',
  comedy: '#e8b93a',
  thriller: '#c4513f',
  other: '#7a8a8a',
}
