import { useEffect, useState, type ReactNode } from 'react'
import { RATING_KEYS, type Puzzle, type Review } from '@/contracts/types'
import { PUZZLE_TYPE_COLORS } from '@/contracts/style'
import {
  CheckIcon,
  CrossIcon,
  DoorIcon,
  FlashlightIcon,
  MaskIcon,
  MicIcon,
  PuzzleIcon,
  RoomsIcon,
  StarIcon,
  TimerIcon,
  WrenchIcon,
} from './icons'
import { formatMinutes, PUZZLE_TYPE_LABELS, RATING_LABELS, scoreWord } from './helpers'

export function SectionTitle({ icon, children, id }: { icon?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <h3 id={id} className="mb-3 flex items-center gap-2 font-display text-lg font-semibold text-ink">
      {icon && <span className="text-accent">{icon}</span>}
      {children}
    </h3>
  )
}

/** Paper card with a slight tilt, like something glued into a scrapbook. */
export function PaperCard({ children, tilt = 0, className = '', label }: { children: ReactNode; tilt?: number; className?: string; label?: string }) {
  return (
    <section
      aria-label={label}
      className={`relative rounded-[12px] border border-panel-edge/70 bg-paper p-4 shadow-[0_4px_12px_rgba(60,30,20,.12)] sm:p-5 ${className}`}
      style={{ transform: tilt ? `rotate(${tilt}deg)` : undefined }}
    >
      {children}
    </section>
  )
}

// ---------------------------------------------------------------------------

function barColor(score: number): string {
  if (score >= 85) return 'linear-gradient(90deg, #2f8f8a, #3fb3a8)'
  if (score >= 65) return 'linear-gradient(90deg, #e07b39, #f0a05a)'
  if (score >= 45) return 'linear-gradient(90deg, #d4a24c, #e8c070)'
  return 'linear-gradient(90deg, #c4513f, #d9735f)'
}

function RatingBar({ k, score, comment, delay }: { k: (typeof RATING_KEYS)[number]; score: number; comment: string; delay: number }) {
  const [grown, setGrown] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setGrown(true))
    return () => cancelAnimationFrame(id)
  }, [])
  const label = RATING_LABELS[k]
  const big = k === 'overall'
  return (
    <li data-testid={`rating-${k}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className={`font-display font-semibold text-ink ${big ? 'text-lg' : 'text-base'}`}>{label}</span>
        <span className="flex items-baseline gap-1.5">
          <span className="font-hand text-lg text-ink-soft">{k === 'difficulty' ? (score >= 75 ? 'tough' : score >= 45 ? 'medium' : 'gentle') : scoreWord(score)}</span>
          <span className={`font-display font-bold tabular-nums text-ink ${big ? 'text-2xl' : 'text-xl'}`} data-testid={`score-${k}`}>
            {score}
          </span>
          <span className="text-xs font-bold text-ink-soft">/100</span>
        </span>
      </div>
      <div
        role="meter"
        aria-label={`${label} rating`}
        aria-valuemin={1}
        aria-valuemax={100}
        aria-valuenow={score}
        className={`mt-1.5 overflow-hidden rounded-full bg-[#ecdcc6] shadow-[inset_0_1px_2px_rgba(60,30,20,.18)] ${big ? 'h-4' : 'h-3'}`}
      >
        <div
          className="h-full rounded-full motion-safe:transition-[width] motion-safe:duration-[900ms] motion-safe:ease-out"
          style={{ width: grown ? `${score}%` : '0%', background: barColor(k === 'difficulty' ? 70 : score), transitionDelay: `${delay}ms` }}
        />
      </div>
      {comment && <p className="mt-1.5 text-[15px] leading-snug text-ink-soft">“{comment}”</p>}
    </li>
  )
}

export function Ratings({ review }: { review: Review }) {
  return (
    <PaperCard label="Ratings" tilt={-0.4}>
      <SectionTitle icon={<StarIcon size={20} />}>Ratings</SectionTitle>
      <ul className="flex flex-col gap-4">
        {RATING_KEYS.map((k, i) => (
          <RatingBar key={k} k={k} score={review.ratings[k].score} comment={review.ratings[k].comment} delay={i * 90} />
        ))}
      </ul>
    </PaperCard>
  )
}

// ---------------------------------------------------------------------------

interface BadgeSpec {
  key: string
  label: string
  /** null: the player wasn't sure ("Not sure" on the forms). */
  value: boolean | null
  icon: ReactNode
  detail?: string | null
}

function Badge({ spec }: { spec: BadgeSpec }) {
  const on = spec.value === true
  const unknown = spec.value === null
  return (
    <li
      data-testid={`badge-${spec.key}`}
      data-value={unknown ? 'unknown' : on ? 'yes' : 'no'}
      className={`flex min-h-14 items-center gap-2.5 rounded-[14px] border px-3 py-2 ${
        on ? 'border-good/40 bg-good/12 text-ink' : unknown ? 'border-dashed border-ink-soft/30 text-ink-soft' : 'border-ink-soft/20 bg-ink-soft/8 text-ink-soft'
      }`}
    >
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${on ? 'bg-white text-good' : 'bg-white/70 text-ink-soft/80'}`}>{spec.icon}</span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="text-sm font-bold">{spec.label}</span>
        {unknown ? <span className="text-xs font-semibold text-ink-soft">Not sure</span> : spec.detail && <span className="text-xs font-semibold text-ink-soft">{spec.detail}</span>}
      </span>
      <span
        className={`ml-auto grid h-6 w-6 shrink-0 place-items-center rounded-full ${
          on ? 'bg-good text-white' : unknown ? 'border border-dashed border-ink-soft/50 text-sm font-bold text-ink-soft' : 'bg-ink-soft/25 text-white'
        }`}
      >
        {on ? <CheckIcon size={15} strokeWidth={3} /> : unknown ? <span aria-hidden="true">?</span> : <CrossIcon size={14} strokeWidth={3} />}
        <span className="sr-only">{unknown ? 'not sure' : on ? 'yes' : 'no'}</span>
      </span>
    </li>
  )
}

export function Badges({ review }: { review: Review }) {
  const time = formatMinutes(review.escapeTimeMinutes)
  const specs: BadgeSpec[] = [
    { key: 'escaped', label: 'Escaped', value: review.escaped, icon: <DoorIcon />, detail: time ? (review.escaped ? `in ${time}` : `${time} used`) : null },
    { key: 'visibleTimer', label: 'Visible timer', value: review.visibleTimer, icon: <TimerIcon /> },
    { key: 'multiRoom', label: 'Multi-room', value: review.multiRoom, icon: <RoomsIcon /> },
    { key: 'flashlights', label: 'Flashlights', value: review.flashlights, icon: <FlashlightIcon /> },
    { key: 'liveActors', label: 'Live actors', value: review.liveActors, icon: <MaskIcon /> },
  ]
  return (
    <PaperCard label="Room facts" tilt={0.3}>
      <SectionTitle icon={<DoorIcon />}>The room</SectionTitle>
      <ul className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
        {specs.map((s) => (
          <Badge key={s.key} spec={s} />
        ))}
      </ul>
    </PaperCard>
  )
}

/** Big stamp near the header: ESCAPED 52 min / SO CLOSE. */
export function EscapeStamp({ review }: { review: Review }) {
  const time = formatMinutes(review.escapeTimeMinutes)
  const color = review.escaped ? 'var(--color-good)' : 'var(--color-bad)'
  return (
    <div
      data-testid="escape-stamp"
      className="inline-flex rotate-[-6deg] flex-col items-center rounded-[10px] border-[3px] px-3 py-1 font-display leading-none uppercase"
      style={{ borderColor: color, color }}
    >
      <span className="text-base font-bold tracking-wider">{review.escaped ? 'Escaped!' : 'Trapped'}</span>
      {time && <span className="mt-0.5 text-sm font-semibold tracking-wide normal-case">{time}</span>}
    </div>
  )
}

// ---------------------------------------------------------------------------

function PuzzleChip({ type }: { type: Puzzle['type'] }) {
  const c = PUZZLE_TYPE_COLORS[type] ?? '#7a8a8a'
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap"
      style={{ background: `${c}2e`, color: `color-mix(in srgb, ${c} 62%, #3b2a26)`, boxShadow: `inset 0 0 0 1.5px ${c}80` }}
    >
      {PUZZLE_TYPE_LABELS[type] ?? type}
    </span>
  )
}

export function Puzzles({ puzzles }: { puzzles: Puzzle[] }) {
  return (
    <PaperCard label="Puzzles" tilt={0.5}>
      <SectionTitle icon={<PuzzleIcon />}>Puzzles</SectionTitle>
      {puzzles.length === 0 ? (
        <p className="text-ink-soft">No puzzles noted.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-dashed divide-panel-edge">
          {puzzles.map((p) => (
            <li key={p.id} data-testid="puzzle" className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
              <span className={`mt-0.5 shrink-0 ${p.memorable ? 'text-[#e8b93a]' : 'text-panel-edge'}`} title={p.memorable ? 'Memorable' : undefined}>
                <StarIcon size={20} filled={p.memorable} />
                <span className="sr-only">{p.memorable ? 'Memorable puzzle' : ''}</span>
              </span>
              <span className="min-w-0 flex-1 leading-snug text-ink">{p.description}</span>
              <PuzzleChip type={p.type} />
            </li>
          ))}
        </ul>
      )}
    </PaperCard>
  )
}

export function Tools({ tools }: { tools: string[] }) {
  return (
    <PaperCard label="Tools used" tilt={-0.3}>
      <SectionTitle icon={<WrenchIcon />}>Tools used</SectionTitle>
      {tools.length === 0 ? (
        <p className="text-ink-soft">Nothing special.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {tools.map((t) => (
            <li key={t} data-testid="tool" className="rounded-full border border-teal/30 bg-teal/10 px-3 py-1 text-sm font-bold text-teal">
              {t}
            </li>
          ))}
        </ul>
      )}
    </PaperCard>
  )
}

export function VoiceNote({ transcript }: { transcript: string }) {
  const text = transcript.trim()
  return (
    <details className="group rounded-[12px] border border-panel-edge/70 bg-[#fffdf6] shadow-[0_4px_12px_rgba(60,30,20,.1)]" data-testid="voice-note">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 rounded-[12px] px-4 py-3 font-display text-lg font-semibold text-ink select-none hover:bg-accent/5 focus-visible:outline-3 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
        <span className="text-accent">
          <MicIcon />
        </span>
        Voice note
        <span className="ml-auto text-sm font-bold text-ink-soft">
          <span className="group-open:hidden">Show</span>
          <span className="hidden group-open:inline">Hide</span>
        </span>
      </summary>
      <div
        className="px-4 pb-4"
        style={{ backgroundImage: 'repeating-linear-gradient(transparent 0 29px, #e8c9a466 29px 30px)', backgroundPosition: '0 6px' }}
      >
        {text ? (
          <p className="font-hand text-[22px] leading-[30px] whitespace-pre-wrap text-ink">{text}</p>
        ) : (
          <p className="font-hand text-[22px] leading-[30px] text-ink-soft">No voice note for this one.</p>
        )}
      </div>
    </details>
  )
}
