/**
 * Puzzle views for Escape of the Day: the clues, the guess input and the past guesses, per kind.
 * Reuses the Phase 1 gate's drawings (icons, clock, search scene). Works with touch and keyboard.
 */
import { useState, type FormEvent, type ReactNode } from 'react'
import { ClockFace, ClueIcon, ShapeIcon } from '../../gate/icons'
import { SearchScene } from '../../gate/SearchScene'
import type { CipherDailyChallenge, CombinationChallenge, DailyChallenge, DailyGuessMark, GridMark, SearchDailyChallenge, SequenceDailyChallenge } from '../engine'

export const MARK_STYLE: Record<GridMark, { bg: string; fg: string; label: string }> = {
  hit: { bg: '#4f9d5a', fg: '#ffffff', label: 'right' },
  close: { bg: '#e0a93a', fg: '#3b2a26', label: 'close' },
  miss: { bg: '#8a7a72', fg: '#ffffff', label: 'wrong' },
  hint: { bg: '#fff7ec', fg: '#3b2a26', label: 'hint' },
}

/** Keyboard focus: the app's teal ring, offset from the button so it reads on the orange primary too. */
export const focusRing = 'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-teal focus-visible:ring-offset-2 focus-visible:ring-offset-panel'
/** Text fields: the border turns teal with a soft halo (the border colour alone was too subtle). */
export const fieldFocus = 'outline-none focus:border-teal focus:ring-4 focus:ring-teal/30'
export const btn = `min-h-12 rounded-full px-5 font-display text-base font-semibold transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`
export const btnPrimary = `${btn} bg-accent text-accent-ink shadow hover:brightness-105`
export const btnGhost = `${btn} border-2 border-panel-edge bg-white/70 text-ink hover:border-accent`

// ---------------------------------------------------------------------------
// Clues
// ---------------------------------------------------------------------------

function CombinationClues({ c }: { c: CombinationChallenge }) {
  return (
    <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {c.data.clues.map((clue, i) => (
        <li key={i} className="flex items-center gap-3 rounded-2xl border border-panel-edge bg-paper px-3 py-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#3d4248] font-mono text-sm font-semibold text-[#f0c977]">{i + 1}</span>
          <div className="min-w-0">
            <div className="text-[15px] font-semibold leading-snug text-ink">{clue.text}</div>
            {clue.type === 'count' && (
              <div className="mt-1 flex flex-wrap gap-0.5" aria-label={`${clue.count} ${clue.icon} icons`}>
                {Array.from({ length: clue.count }, (_, k) => (
                  <ClueIcon key={k} name={clue.icon} />
                ))}
              </div>
            )}
            {clue.type === 'clock' && (
              <div className="mt-1">
                <ClockFace hour={clue.hour} minute={clue.minute} size={56} />
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}

function CipherClues({ c }: { c: CipherDailyChallenge }) {
  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-chalk p-3 text-center">
        <div className="mb-1 font-hand text-lg text-[#e9f1ea]/80">Decode me</div>
        <div className="flex flex-wrap justify-center gap-1.5 sm:gap-2">
          {c.data.encoded.map((s, i) => (
            <span
              key={i}
              className={`grid h-11 w-10 place-items-center rounded-lg border-2 text-2xl text-[#f7efe0] sm:h-12 sm:w-11 ${c.data.missing.includes(s) ? 'border-dashed border-[#f0c977]' : 'border-[#e9f1ea]/40'}`}
            >
              {s}
            </span>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1 text-xs font-bold uppercase tracking-wider text-ink-soft">Key (dashed symbols are missing)</div>
        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
          {c.data.key.map((k) => (
            <div key={k.symbol} className="flex items-center justify-center gap-1.5 rounded-lg border border-panel-edge bg-paper py-1.5">
              <span className="text-lg text-plum">{k.symbol}</span>
              <span className="text-ink-soft">=</span>
              <span className="font-mono font-semibold text-ink">{k.letter}</span>
            </div>
          ))}
          {c.data.missing.map((s) => (
            <div key={s} className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-accent bg-paper py-1.5">
              <span className="text-lg text-plum">{s}</span>
              <span className="text-ink-soft">=</span>
              <span className="font-mono font-semibold text-accent">?</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function SequenceClues({ c }: { c: SequenceDailyChallenge }) {
  const d = c.data
  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5 rounded-2xl border border-panel-edge bg-paper p-3 sm:gap-2" aria-label="The sequence so far">
      {d.mode === 'number'
        ? d.shown.map((n, i) => (
            <span key={i} className="grid h-11 min-w-10 place-items-center rounded-xl bg-[#3d4248] px-1.5 font-mono text-lg font-semibold text-[#f0c977] sm:h-12 sm:min-w-12 sm:text-xl">
              {n}
            </span>
          ))
        : d.shown.map((t, i) => (
            <span key={i} className="grid h-10 w-10 place-items-center rounded-xl bg-white/70 shadow-sm sm:h-12 sm:w-12" title={`${t.colorName} ${t.shape}`}>
              <ShapeIcon shape={t.shape} color={t.color} size={30} />
            </span>
          ))}
      {[0, 1, 2].map((i) => (
        <span key={`q${i}`} className="grid h-11 w-10 place-items-center rounded-xl border-2 border-dashed border-accent font-display text-2xl text-accent sm:h-12 sm:w-12">
          ?
        </span>
      ))}
    </div>
  )
}

/** The static part of the puzzle (search is drawn by its input). */
export function PuzzleClues({ c }: { c: DailyChallenge }) {
  switch (c.kind) {
    case 'combination':
      return <CombinationClues c={c} />
    case 'cipher':
      return <CipherClues c={c} />
    case 'sequence':
      return <SequenceClues c={c} />
    case 'search':
      return null
  }
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

interface InputProps<C> {
  c: C
  disabled?: boolean
  onGuess(guess: string[]): void
}

function TextGuess({ c, disabled, onGuess }: InputProps<CombinationChallenge | CipherDailyChallenge>) {
  const [value, setValue] = useState('')
  const digits = c.kind === 'combination'
  const clean = (s: string) => (digits ? s.replace(/[^0-9]/g, '') : s.toUpperCase().replace(/[^A-Z]/g, '')).slice(0, c.slots)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (value.length !== c.slots || disabled) return
    onGuess(value.split(''))
    setValue('')
  }
  return (
    <form onSubmit={submit} className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
      <label className="sr-only" htmlFor="daily-input">
        Your guess
      </label>
      <input
        id="daily-input"
        data-testid="daily-input"
        value={value}
        onChange={(e) => setValue(clean(e.target.value))}
        inputMode={digits ? 'numeric' : 'text'}
        autoComplete="off"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        disabled={disabled}
        placeholder={Array(c.slots).fill(digits ? '0' : 'A').join('')}
        maxLength={c.slots}
        className={`w-full max-w-[16rem] rounded-2xl border-2 border-panel-edge bg-white px-4 py-3 text-center font-mono text-2xl font-semibold uppercase tracking-[0.4em] text-ink placeholder:text-ink-soft/30 ${fieldFocus}`}
      />
      <button type="submit" data-testid="daily-submit" className={btnPrimary} disabled={disabled || value.length !== c.slots}>
        Try it
      </button>
    </form>
  )
}

function NumberSequenceGuess({ c, disabled, onGuess }: InputProps<SequenceDailyChallenge>) {
  const [vals, setVals] = useState<string[]>(() => Array(c.slots).fill(''))
  const ready = vals.every((v) => v.trim() !== '')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!ready || disabled) return
    onGuess(vals.map((v) => v.trim()))
    setVals(Array(c.slots).fill(''))
  }
  return (
    <form onSubmit={submit} className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
      <div className="flex gap-2">
        {vals.map((v, i) => (
          <input
            key={i}
            data-testid={`daily-input-${i}`}
            aria-label={`Number ${i + 1}`}
            value={v}
            onChange={(e) => setVals((old) => old.map((x, j) => (j === i ? e.target.value.replace(/[^0-9-]/g, '').slice(0, 6) : x)))}
            inputMode="numeric"
            autoComplete="off"
            disabled={disabled}
            className={`w-20 rounded-2xl border-2 border-panel-edge bg-white px-2 py-3 text-center font-mono text-xl font-semibold text-ink ${fieldFocus}`}
          />
        ))}
      </div>
      <button type="submit" data-testid="daily-submit" className={btnPrimary} disabled={disabled || !ready}>
        Try it
      </button>
    </form>
  )
}

function ShapeSequenceGuess({ c, disabled, onGuess }: InputProps<SequenceDailyChallenge>) {
  const [slots, setSlots] = useState<(string | null)[]>(() => Array(c.slots).fill(null))
  if (c.data.mode !== 'shape') return null
  const byId = new Map(c.data.choices.map((t) => [t.id, t]))
  const pick = (id: string) =>
    setSlots((old) => {
      const i = old.indexOf(null)
      return i === -1 ? old : old.map((x, j) => (j === i ? id : x))
    })
  const ready = slots.every(Boolean)
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex gap-2" aria-label="Your three tiles">
        {slots.map((id, i) => {
          const t = id ? byId.get(id) : null
          return (
            <button
              key={i}
              type="button"
              data-testid={`daily-slot-${i}`}
              aria-label={t ? `Tile ${i + 1}: ${t.colorName} ${t.shape}. Tap to clear.` : `Tile ${i + 1}: empty`}
              disabled={disabled}
              onClick={() => setSlots((old) => old.map((x, j) => (j === i ? null : x)))}
              className={`grid h-14 w-14 place-items-center rounded-xl border-2 border-dashed border-accent bg-white/70 ${focusRing}`}
            >
              {t ? <ShapeIcon shape={t.shape} color={t.color} size={34} /> : <span className="font-display text-xl text-accent">{i + 1}</span>}
            </button>
          )
        })}
      </div>
      <div className="grid grid-cols-4 gap-2">
        {c.data.choices.map((t) => (
          <button
            key={t.id}
            type="button"
            data-testid={`daily-choice-${t.id}`}
            aria-label={`${t.colorName} ${t.shape}`}
            disabled={disabled || ready}
            onClick={() => pick(t.id)}
            className={`grid h-12 w-12 place-items-center rounded-xl border-2 border-panel-edge bg-white/70 transition hover:border-accent active:scale-95 disabled:opacity-50 ${focusRing}`}
          >
            <ShapeIcon shape={t.shape} color={t.color} size={30} />
          </button>
        ))}
      </div>
      <button
        type="button"
        data-testid="daily-submit"
        className={btnPrimary}
        disabled={disabled || !ready}
        onClick={() => {
          onGuess(slots as string[])
          setSlots(Array(c.slots).fill(null))
        }}
      >
        Try it
      </button>
    </div>
  )
}

/** Hit ids so far, from the past rounds. */
export function searchFound(c: SearchDailyChallenge, guesses: readonly string[][]): string[] {
  const found = new Set<string>()
  for (const g of guesses) {
    const marks = c.check(g)
    g.forEach((id, i) => marks[i] === 'hit' && found.add(id))
  }
  return [...found]
}

function SearchGuess({ c, disabled, onGuess, guesses }: InputProps<SearchDailyChallenge> & { guesses: readonly string[][] }) {
  const [taps, setTaps] = useState<string[]>([])
  const found = searchFound(c, guesses)
  const tapsLeft = c.slots - found.length - taps.length
  const tap = (id: string) => {
    if (disabled) return
    const next = [...taps, id]
    if (found.length + next.length >= c.slots) {
      onGuess([...found, ...next])
      setTaps([])
    } else setTaps(next)
  }
  return (
    <div>
      <SearchScene challenge={c.scene} found={[...found, ...taps.filter(Boolean)]} onFind={tap} onMiss={() => tap('')} disabled={disabled} />
      <div className="mt-2 text-center text-sm font-semibold text-ink-soft" data-testid="daily-taps-left">
        Found {found.length + taps.filter(Boolean).length} of {c.slots} · {tapsLeft} tap{tapsLeft === 1 ? '' : 's'} left this round
      </div>
    </div>
  )
}

export function GuessInput({ c, disabled, onGuess, guesses }: InputProps<DailyChallenge> & { guesses: readonly string[][] }) {
  switch (c.kind) {
    case 'combination':
    case 'cipher':
      return <TextGuess c={c} disabled={disabled} onGuess={onGuess} />
    case 'sequence':
      return c.data.mode === 'number' ? <NumberSequenceGuess c={c} disabled={disabled} onGuess={onGuess} /> : <ShapeSequenceGuess c={c} disabled={disabled} onGuess={onGuess} />
    case 'search':
      return <SearchGuess c={c} disabled={disabled} onGuess={onGuess} guesses={guesses} />
  }
}

// ---------------------------------------------------------------------------
// History and grid
// ---------------------------------------------------------------------------

function Cell({ mark, children }: { mark: GridMark; children?: ReactNode }) {
  const s = MARK_STYLE[mark]
  return (
    <span
      data-mark={mark}
      aria-label={s.label}
      className="grid h-10 min-w-10 place-items-center rounded-lg px-1 font-mono text-lg font-bold shadow-sm sm:h-11 sm:min-w-11"
      style={{ background: s.bg, color: s.fg }}
    >
      {children}
    </span>
  )
}

/** Past guesses with their marks (hint rows show as a small chip). */
export function GuessHistory({ c, guesses, grid }: { c: DailyChallenge; guesses: readonly string[][]; grid: readonly GridMark[][] }) {
  let g = 0
  const byId = c.kind === 'sequence' && c.data.mode === 'shape' ? new Map(c.data.choices.map((t) => [t.id, t])) : null
  return (
    <ol className="flex flex-col items-center gap-1.5" data-testid="daily-history">
      {grid.map((row, r) => {
        if (row.length === 1 && row[0] === 'hint') {
          return (
            <li key={r} className="rounded-full bg-paper px-3 py-0.5 text-xs font-semibold text-ink-soft ring-1 ring-panel-edge">
              💡 hint used
            </li>
          )
        }
        const guess = guesses[g++] ?? []
        return (
          <li key={r} className="flex gap-1.5" data-testid={`daily-row-${g - 1}`}>
            {row.map((m, i) => {
              const v = guess[i] ?? ''
              const t = byId?.get(v)
              return (
                <Cell key={i} mark={m as DailyGuessMark}>
                  {c.kind === 'search' ? null : t ? <ShapeIcon shape={t.shape} color="#ffffff" size={22} /> : v}
                </Cell>
              )
            })}
          </li>
        )
      })}
    </ol>
  )
}

/** The answer, shown after a failed attempt. */
export function AnswerReveal({ c }: { c: DailyChallenge }) {
  if (c.kind === 'search') {
    return (
      <div>
        <p className="mb-2 text-center text-sm text-ink-soft">Here's where the {c.data.symbol}s were hiding.</p>
        <SearchScene challenge={c.scene} found={c.answer} onFind={() => undefined} onMiss={() => undefined} disabled />
      </div>
    )
  }
  if (c.kind === 'sequence' && c.data.mode === 'shape') {
    const byId = new Map(c.data.choices.map((t) => [t.id, t]))
    return (
      <p className="text-center text-sm text-ink-soft">
        The answer was {c.answer.map((id) => `${byId.get(id)?.colorName} ${byId.get(id)?.shape}`).join(', ')}.
      </p>
    )
  }
  return (
    <p className="text-center text-sm text-ink-soft" data-testid="daily-answer">
      The answer was <span className="font-mono font-bold text-ink">{c.answer.join(c.kind === 'sequence' ? ', ' : '')}</span>.
    </p>
  )
}
