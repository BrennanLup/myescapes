/**
 * The individual Wrapped cards. Each card is a full-bleed gradient with bold copy.
 * `buildCards(stats)` picks the sequence for a given period.
 */
import type { ReactNode } from 'react'
import { GENRE_COLORS, PUZZLE_TYPE_COLORS } from '@/contracts/style'
import type { Room, Review } from '@/contracts/types'
import { PUZZLE_TYPE_LABELS, type WrapStats } from './computeWrap'

export interface WrapCard {
  key: string
  /** CSS background. */
  bg: string
  /** Light text on a dark background (true) or ink on a bright one. */
  dark: boolean
  /** Confetti density, 0 for none. */
  confetti: number
  render: () => ReactNode
}

export const periodLabel = (year: WrapStats['year']) => (year === 'all' ? 'All time' : String(year))

/** Staggered entrance wrapper. */
function Rise({ i = 0, className = '', children }: { i?: number; className?: string; children: ReactNode }) {
  return (
    <div className={`wrap-rise ${className}`} style={{ animationDelay: `${0.08 + i * 0.12}s` }}>
      {children}
    </div>
  )
}

function Kicker({ children }: { children: ReactNode }) {
  return <p className="font-display text-lg font-semibold uppercase tracking-[0.18em] opacity-85 sm:text-xl">{children}</p>
}

function Big({ children, i = 1 }: { children: ReactNode; i?: number }) {
  return (
    <div className="wrap-pop wrap-big font-display font-bold" style={{ animationDelay: `${0.1 + i * 0.12}s` }}>
      {children}
    </div>
  )
}

function Chip({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-white/85 px-3 py-1 text-sm font-bold text-ink shadow-sm"
      style={{ boxShadow: `inset 0 -3px 0 ${color}` }}
    >
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      {children}
    </span>
  )
}

/** Polaroid of the room: its first photo, or a genre-coloured keyhole placeholder. */
export function RoomPolaroid({ room, review }: { room: Room; review?: Review }) {
  const photo = room.photos[0]?.url ?? review?.photos[0]?.url
  const color = GENRE_COLORS[room.genre] ?? GENRE_COLORS.other
  return (
    <div className="wrap-wobble mx-auto w-[min(58vw,230px)] rounded-[6px] bg-paper p-3 pb-2 shadow-cozy">
      <div className="relative aspect-square overflow-hidden rounded-[3px]" style={{ background: color }}>
        {photo ? (
          <img src={photo} alt={room.name} className="h-full w-full object-cover" />
        ) : (
          <div
            className="flex h-full w-full flex-col items-center justify-center gap-2 text-white"
            style={{ background: `radial-gradient(circle at 30% 25%, ${color}aa, ${color} 60%, #00000055)` }}
            data-testid="wrap-photo-placeholder"
          >
            <svg viewBox="0 0 64 64" className="h-16 w-16 opacity-90" aria-hidden>
              <circle cx="32" cy="24" r="12" fill="currentColor" />
              <path d="M26 30 L22 52 H42 L38 30 Z" fill="currentColor" />
            </svg>
            <span className="font-display text-lg font-semibold uppercase tracking-widest">{room.genre}</span>
          </div>
        )}
      </div>
      <p className="truncate pt-1 text-center font-hand text-2xl leading-tight text-ink">{room.name}</p>
    </div>
  )
}

function Bar({ label, value, max, color, i }: { label: string; value: number; max: number; color: string; i: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 truncate text-right text-base font-bold sm:w-32">{label}</span>
      <div className="h-6 flex-1 overflow-hidden rounded-full bg-black/15">
        <div
          className="wrap-fill h-full rounded-full"
          style={{ width: `${Math.max(8, (value / max) * 100)}%`, background: color, animationDelay: `${0.3 + i * 0.1}s` }}
        />
      </div>
      <span className="w-6 font-display text-lg font-bold">{value}</span>
    </div>
  )
}

const pct = (x: number) => `${Math.round(x * 100)}%`
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function hoursLabel(mins: number) {
  if (mins < 120) return plural(mins, 'minute')
  return `${(mins / 60).toFixed(1).replace(/\.0$/, '')} hours`
}

export function buildCards(s: WrapStats): WrapCard[] {
  const period = periodLabel(s.year)
  const intro: WrapCard = {
    key: 'intro',
    bg: 'linear-gradient(160deg, #6d3b5c 0%, #b8503f 52%, #e07b39 100%)',
    dark: true,
    confetti: 26,
    render: () => (
      <div className="flex flex-col items-start gap-5">
        <Rise i={0}>
          <Kicker>My Escapes Wrapped</Kicker>
        </Rise>
        <Rise i={1}>
          <h2 className="font-display text-[clamp(2.8rem,12vw,4.2rem)] font-bold leading-[0.95]">
            Your {s.year === 'all' ? 'escape rooms, all time' : 'year in escape rooms'}
          </h2>
        </Rise>
        <Rise i={2}>
          <div className="wrap-pop inline-block rounded-2xl bg-white/90 px-5 py-2 font-display text-5xl font-bold text-plum shadow-cozy">
            {period}
          </div>
        </Rise>
        <Rise i={3}>
          <p className="text-xl font-semibold opacity-90">
            {s.roomsDone > 0 ? 'Locks were picked. Codes were cracked. Let’s look back.' : 'Nothing logged here yet.'}
          </p>
        </Rise>
      </div>
    ),
  }

  if (s.roomsDone === 0) {
    return [
      intro,
      {
        key: 'empty',
        bg: 'linear-gradient(160deg, #2f8f8a 0%, #2f4a42 100%)',
        dark: true,
        confetti: 0,
        render: () => (
          <div className="flex flex-col items-start gap-5">
            <Rise i={0}>
              <Kicker>{period}</Kicker>
            </Rise>
            <Big>0</Big>
            <Rise i={2}>
              <p className="font-display text-3xl font-semibold">rooms so far.</p>
            </Rise>
            <Rise i={3}>
              <p className="text-xl opacity-90">Head to the desk terminal and log your first escape. This wall will fill up fast.</p>
            </Rise>
          </div>
        ),
      },
    ]
  }

  const cards: WrapCard[] = [intro]

  cards.push({
    key: 'rooms',
    bg: 'linear-gradient(165deg, #e07b39 0%, #e8b93a 100%)',
    dark: false,
    confetti: 14,
    render: () => (
      <div className="flex flex-col items-start gap-4">
        <Rise i={0}>
          <Kicker>You stepped into</Kicker>
        </Rise>
        <Big>{s.roomsDone}</Big>
        <Rise i={2}>
          <p className="font-display text-4xl font-semibold">{s.roomsDone === 1 ? 'escape room' : 'escape rooms'}</p>
        </Rise>
        <Rise i={3} className="flex flex-wrap gap-2 pt-2">
          <span className="rounded-full bg-ink px-4 py-1.5 text-lg font-bold text-paper">{plural(s.escapes, 'escape')}</span>
          <span className="rounded-full bg-white/80 px-4 py-1.5 text-lg font-bold">{pct(s.escapeRate)} escape rate</span>
        </Rise>
        <Rise i={4}>
          <p className="text-xl font-semibold">
            That’s {hoursLabel(s.totalMinutes)} locked in{s.uniqueRooms < s.roomsDone ? ` (${s.uniqueRooms} different rooms)` : ''}.
          </p>
        </Rise>
      </div>
    ),
  })

  if (s.bestRoom) {
    const b = s.bestRoom
    cards.push({
      key: 'best',
      bg: 'linear-gradient(170deg, #b8503f 0%, #6d3b5c 100%)',
      dark: true,
      confetti: 18,
      render: () => (
        <div className="flex flex-col items-center gap-4 text-center">
          <Rise i={0}>
            <Kicker>Your top-rated room</Kicker>
          </Rise>
          <Rise i={1}>
            <RoomPolaroid room={b.room} review={b.review} />
          </Rise>
          <Rise i={2}>
            <h3 className="font-display text-4xl font-bold leading-tight">{b.room.name}</h3>
            <p className="text-lg opacity-85">
              {b.room.company} · {b.room.city}
            </p>
          </Rise>
          <Rise i={3}>
            <div className="wrap-pop rounded-2xl bg-white/90 px-5 py-1 font-display text-4xl font-bold">
              <span className="text-[#b8503f]">{b.score}</span>
              <span className="text-2xl text-ink-soft">/100</span>
            </div>
          </Rise>
        </div>
      ),
    })
  }

  const f = s.fastestEscape
  cards.push({
    key: 'fastest',
    bg: 'linear-gradient(165deg, #2f8f8a 0%, #1f5752 100%)',
    dark: true,
    confetti: f ? 10 : 0,
    render: () =>
      f ? (
        <div className="flex flex-col items-start gap-4">
          <Rise i={0}>
            <Kicker>Fastest escape</Kicker>
          </Rise>
          <div className="flex items-end gap-3">
            <Big>{f.minutes}</Big>
            <Rise i={2}>
              <span className="pb-3 font-display text-3xl font-semibold">min</span>
            </Rise>
          </div>
          <Rise i={3}>
            <p className="font-display text-3xl font-bold leading-tight">{f.room.name}</p>
            <p className="text-lg opacity-85">
              {f.room.company} · {f.room.city}
            </p>
          </Rise>
          <Rise i={4}>
            <p className="text-xl">
              Longest streak: <b className="font-display text-2xl">{plural(s.longestEscapeStreak, 'escape')}</b> in a row.
            </p>
          </Rise>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-4">
          <Rise i={0}>
            <Kicker>Fastest escape</Kicker>
          </Rise>
          <Big>0</Big>
          <Rise i={2}>
            <p className="font-display text-3xl font-semibold">escapes this time.</p>
          </Rise>
          <Rise i={3}>
            <p className="text-xl opacity-90">The rooms won this round. Rematch?</p>
          </Rise>
        </div>
      ),
  })

  const fav = s.favouritePuzzleType
  const mm = s.mostMemorablePuzzle
  cards.push({
    key: 'puzzle',
    bg: 'linear-gradient(160deg, #e8b93a 0%, #e07b39 100%)',
    dark: false,
    confetti: 0,
    render: () => (
      <div className="flex flex-col items-start gap-4">
        <Rise i={0}>
          <Kicker>Your puzzle type</Kicker>
        </Rise>
        {fav ? (
          <>
            <div className="wrap-pop font-display text-[clamp(3.2rem,15vw,5.2rem)] font-bold leading-[0.95]" style={{ animationDelay: '0.2s' }}>
              {PUZZLE_TYPE_LABELS[fav.type]}
            </div>
            <Rise i={2}>
              <p className="text-xl font-semibold">
                {plural(fav.count, 'puzzle')} solved{fav.memorable ? `, ${fav.memorable} unforgettable` : ''}.
              </p>
            </Rise>
            <Rise i={3} className="flex flex-wrap gap-2">
              {s.puzzleTypes.slice(0, 6).map((t) => (
                <Chip key={t.type} color={PUZZLE_TYPE_COLORS[t.type] ?? '#7a8a8a'}>
                  {PUZZLE_TYPE_LABELS[t.type]} × {t.count}
                </Chip>
              ))}
            </Rise>
          </>
        ) : (
          <Rise i={1}>
            <p className="font-display text-4xl font-bold">No puzzles logged… mysterious.</p>
          </Rise>
        )}
        {mm && (
          <Rise i={4} className="mt-2 w-full">
            <figure className="-rotate-1 rounded-cozy bg-paper p-4 text-ink shadow-cozy">
              <p className="text-xs font-bold uppercase tracking-widest text-ink-soft">Most memorable puzzle</p>
              <blockquote className="font-hand text-[1.7rem] leading-tight">“{mm.puzzle.description}”</blockquote>
              <figcaption className="text-sm font-semibold text-ink-soft">{mm.room.name}</figcaption>
            </figure>
          </Rise>
        )}
      </div>
    ),
  })

  const topCities = s.cities.slice(0, 5)
  const moreCities = s.cities.length - topCities.length
  cards.push({
    key: 'cities',
    bg: 'linear-gradient(170deg, #5b5fa8 0%, #6d3b5c 100%)',
    dark: true,
    confetti: 0,
    render: () => (
      <div className="flex w-full flex-col items-start gap-4">
        <Rise i={0}>
          <Kicker>Cities conquered</Kicker>
        </Rise>
        <Big>{s.cities.length}</Big>
        <Rise i={2}>
          <p className="font-display text-3xl font-semibold">{s.cities.length === 1 ? 'city' : 'cities'} on the map</p>
        </Rise>
        <Rise i={3} className="flex w-full flex-col gap-2.5 pt-2">
          {topCities.map((c, i) => (
            <Bar key={c.city} label={c.city} value={c.count} max={topCities[0].count} color={['#e8b93a', '#e07b39', '#2de2d0', '#e8433a', '#efe0c8'][i]} i={i} />
          ))}
          {moreCities > 0 && <p className="text-base opacity-80">+ {plural(moreCities, 'more city', 'more cities')}</p>}
        </Rise>
      </div>
    ),
  })

  const mvp = s.crewMvp
  cards.push({
    key: 'crew',
    bg: 'linear-gradient(160deg, #e8433a 0%, #e07b39 100%)',
    dark: true,
    confetti: mvp ? 22 : 0,
    render: () =>
      mvp ? (
        <div className="flex flex-col items-start gap-4">
          <Rise i={0}>
            <Kicker>Crew MVP</Kicker>
          </Rise>
          <Rise i={1}>
            <Trophy />
          </Rise>
          <div className="wrap-pop font-display text-[clamp(3.4rem,16vw,5.6rem)] font-bold leading-[0.95]" style={{ animationDelay: '0.25s' }}>
            {mvp.name}
          </div>
          <Rise i={3}>
            <p className="text-xl font-semibold">
              Showed up for {mvp.count} of {plural(s.roomsDone, 'room')}. Legend.
            </p>
          </Rise>
          <Rise i={4} className="flex flex-wrap gap-2">
            {s.crew.slice(1, 7).map((c) => (
              <span key={c.name} className="rounded-full bg-white/25 px-3 py-1 text-base font-bold">
                {c.name} · {c.count}
              </span>
            ))}
          </Rise>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-4">
          <Rise i={0}>
            <Kicker>Crew MVP</Kicker>
          </Rise>
          <Rise i={1}>
            <p className="font-display text-5xl font-bold">Solo mission?</p>
          </Rise>
          <Rise i={2}>
            <p className="text-xl">No crew logged. Add names when you record your next room.</p>
          </Rise>
        </div>
      ),
  })

  cards.push({
    key: 'summary',
    bg: 'linear-gradient(165deg, #3b2a26 0%, #6d3b5c 60%, #b8503f 100%)',
    dark: true,
    confetti: 14,
    render: () => <Summary s={s} />,
  })

  return cards
}

function Trophy() {
  return (
    <svg viewBox="0 0 64 64" className="h-16 w-16 drop-shadow" aria-hidden>
      <path d="M18 8h28v10c0 9-6 16-14 16S18 27 18 18z" fill="#ffe08a" stroke="#3b2a26" strokeWidth="2.5" />
      <path d="M18 12H9c0 8 4 12 10 12M46 12h9c0 8-4 12-10 12" fill="none" stroke="#3b2a26" strokeWidth="2.5" />
      <rect x="28" y="34" width="8" height="10" fill="#d4a24c" stroke="#3b2a26" strokeWidth="2.5" />
      <rect x="20" y="44" width="24" height="9" rx="2" fill="#7a4a2b" stroke="#3b2a26" strokeWidth="2.5" />
    </svg>
  )
}

function Tile({ label, value, sub, i, wide }: { label: string; value: ReactNode; sub?: ReactNode; i: number; wide?: boolean }) {
  return (
    <div
      className={`wrap-rise flex min-w-0 flex-col justify-center rounded-2xl bg-white/12 px-3 py-2 ring-1 ring-white/15 sm:py-3 ${wide ? 'col-span-2' : ''}`}
      style={{ animationDelay: `${0.1 + i * 0.07}s`, background: 'rgba(255,255,255,0.12)' }}
    >
      <span className="text-[0.7rem] font-bold uppercase tracking-widest opacity-75">{label}</span>
      <span className="truncate font-display text-[1.6rem] font-bold leading-tight sm:text-3xl">{value}</span>
      {sub && <span className="truncate text-sm opacity-80">{sub}</span>}
    </div>
  )
}

function Summary({ s }: { s: WrapStats }) {
  const total = s.genres.reduce((a, g) => a + g.count, 0)
  return (
    <div className="flex w-full flex-col gap-3" data-testid="wrap-summary">
      <div className="wrap-rise">
        <Kicker>{periodLabel(s.year)} · Wrapped</Kicker>
        <h2 className="font-display text-4xl font-bold leading-tight">Your escape room year</h2>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Tile i={0} label="Rooms done" value={s.roomsDone} sub={`${s.escapes} escaped`} />
        <Tile i={1} label="Escape rate" value={pct(s.escapeRate)} sub={`Best streak ${s.longestEscapeStreak}`} />
        <Tile i={2} label="Top room" value={s.bestRoom?.room.name ?? '-'} sub={s.bestRoom ? `${s.bestRoom.score}/100` : undefined} wide />
        <Tile i={3} label="Fastest" value={s.fastestEscape ? `${s.fastestEscape.minutes} min` : '-'} sub={s.fastestEscape?.room.name} />
        <Tile
          i={4}
          label="Puzzle type"
          value={s.favouritePuzzleType ? PUZZLE_TYPE_LABELS[s.favouritePuzzleType.type] : '-'}
          sub={s.favouritePuzzleType ? `${s.favouritePuzzleType.count} solved` : undefined}
        />
        <Tile i={5} label="Cities" value={s.cities.length} sub={s.cities[0]?.city} />
        <Tile i={6} label="Time inside" value={hoursLabel(s.totalMinutes)} />
        <Tile i={7} label="Crew MVP" value={s.crewMvp?.name ?? '-'} sub={s.crewMvp ? plural(s.crewMvp.count, 'room') : undefined} wide />
      </div>
      {total > 0 && (
        <div className="wrap-rise" style={{ animationDelay: '0.7s' }}>
          <p className="pb-1 text-[0.7rem] font-bold uppercase tracking-widest opacity-75">Genres</p>
          <div className="flex h-4 w-full overflow-hidden rounded-full ring-1 ring-white/20">
            {s.genres.map((g) => (
              <div key={g.genre} style={{ width: `${(g.count / total) * 100}%`, background: GENRE_COLORS[g.genre] ?? '#7a8a8a' }} title={g.genre} />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 pt-1.5 text-sm font-semibold">
            {s.genres.slice(0, 5).map((g) => (
              <span key={g.genre} className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: GENRE_COLORS[g.genre] ?? '#7a8a8a' }} />
                {g.genre} {g.count}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
