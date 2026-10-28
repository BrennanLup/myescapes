/**
 * "You waved · Mia sees it": a short chip by the emote buttons while your own emote plays.
 *
 * In first person (the default) your own character is hidden, so pressing Wave only played a
 * sound and nothing on screen changed. The chip says it worked and who saw it, including when
 * nobody else is here. In third person you see your character wave, so it only shows when you
 * are alone (to say nobody saw it).
 */
import type { Emote } from '@/contracts/realtime'
import { firstName, playersInOrder, useRealtime, type Player } from '@/net/store'
import { useCameraMode } from '@/player/view'

const DID: Record<Emote, string> = { wave: 'You waved', cheer: 'You cheered', dance: "You're dancing" }

/** The chip's words, or null when it should stay hidden. Exported for tests. */
export function emoteEchoText(emote: Emote, others: readonly Pick<Player, 'user'>[], firstPerson: boolean): string | null {
  // Several tabs of one person count once.
  const names = [...new Map(others.map((p) => [p.user.id, firstName(p.user)])).values()]
  if (!names.length) return `${DID[emote]} · nobody else is here to see it`
  if (!firstPerson) return null
  if (names.length === 1) return `${DID[emote]} · ${names[0]} sees it`
  if (names.length === 2) return `${DID[emote]} · ${names[0]} and ${names[1]} see it`
  return `${DID[emote]} · ${names.length} people see it`
}

export function EmoteEcho() {
  const sid = useRealtime((s) => s.sid)
  const mine = useRealtime((s) => (s.sid ? s.emotes[s.sid] : undefined))
  const players = useRealtime((s) => s.players)
  const firstPerson = useCameraMode((s) => s.mode !== 'third')
  if (!sid || !mine) return null
  const text = emoteEchoText(mine.emote, playersInOrder(players), firstPerson)
  if (!text) return null
  return (
    <p
      key={mine.at}
      role="status"
      data-testid="emote-echo"
      className="pointer-events-none m-0 w-fit max-w-[min(340px,calc(100vw-24px))] truncate rounded-full bg-[rgba(42,31,45,0.78)] px-3 py-1.5 text-sm font-semibold text-panel shadow"
    >
      {text}
    </p>
  )
}
