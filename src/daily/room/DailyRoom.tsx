/**
 * Today's Escape of the Day as a small 3D room (the /daily/room page). Same player controller,
 * interaction system, reticle, touch controls and audio as your own room; its own shell, props and
 * DOM panels. The play logic is the 2D game's (`useDailyPlay`), so hints, timer, streaks, the share
 * grid and the saved result (leaderboards) behave exactly the same.
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { bus } from '@/contracts/events'
import { runtime } from '@/contracts/runtime'
import { LIGHT } from '@/contracts/style'
import { installTestHooks } from '@/contracts/testing'
import type { DailyToday } from '@/contracts/models'
import { installBridge } from '@/state/bridge'
import { useStore } from '@/state/store'
import { AudioSystem } from '@/audio'
import { InteractionSystem, Reticle } from '@/interaction'
import { MobileControls, PlayerController } from '@/player'
import { warmMaterials } from '@/world/materials'
import { useDailyPlay, type DailyPlayApi } from '../ui/DailyGame'
import { markDoorSolved } from '../ui/overlay'
import { isFinished } from '../ui/state'
import { walkHome } from './exit'
import { Furniture } from './Furniture'
import { SPAWN } from './layout'
import { EMPTY_ROUND, resetRoomPlay, useRoomPlay } from './playStore'
import { Clues, ExitSign, GuessBoard, HintBell, LockBox, Plaque } from './PuzzleProps'
import { Confetti, ControlsHint, EntryCard, LeavingFade, ROOM_CSS, RoomHud, RoomPanels, Toast } from './RoomUi'
import { ExitDoor, ExitWatcher, RoomLights, RoomShell } from './Shell'
import { assignTargets, canLook, look, roundFromGuesses, type SearchRound } from './search'
import { useRoomUi } from './uiStore'

const DPR: Record<string, [number, number]> = { low: [0.75, 1], medium: [1, 1.5], high: [1, 2] }

declare global {
  interface Window {
    /** QA hook for the puzzle room: where the search targets hide, and the current round. */
    __ESCAPE_DAILY_ROOM__?: { spots: () => Record<string, string>; round: () => SearchRound; leave: () => void }
  }
}

/** Puts the shared player/runtime state into this room's starting pose, once per mount. */
function useRoomBoot() {
  useState(() => {
    runtime.player.position = [...SPAWN.position]
    runtime.player.yaw = SPAWN.yaw
    runtime.player.pitch = SPAWN.pitch
    runtime.pendingTeleport = null
    runtime.joystick.x = runtime.joystick.y = 0
    const st = useStore.getState()
    if (st.overlay) st.closeOverlay()
    if (st.worldReady) st.setWorldReady(false)
    useRoomUi.getState().reset()
    return true
  })
  useEffect(() => {
    installTestHooks()
    const offBridge = installBridge()
    return () => {
      offBridge()
      useRoomUi.getState().reset()
      resetRoomPlay()
      const st = useStore.getState()
      if (st.overlay) st.closeOverlay()
      st.setWorldReady(false)
      if (typeof document !== 'undefined' && document.pointerLockElement) document.exitPointerLock?.()
    }
  }, [])
}

export function DailyRoom({ today, setToday, reload }: { today: DailyToday; setToday(t: DailyToday): void; reload(): void }) {
  useRoomBoot()
  const quality = useStore((s) => s.settings.quality)
  const worldReady = useStore((s) => s.worldReady)
  const leaving = useRoomUi((s) => s.leaving)

  const onSolved = useCallback((fresh: boolean) => {
    markDoorSolved()
    if (!fresh) return
    bus.emit('sfx', { name: 'unlock' })
    useRoomPlay.setState((s) => ({ celebrate: s.celebrate + 1 }))
    useRoomUi.getState().say('Click! The lock springs open.', 'good')
    window.setTimeout(() => {
      const u = useRoomUi.getState()
      if (!u.leaving && useStore.getState().worldReady) u.open({ kind: 'result' })
    }, 1600)
  }, [])

  const play = useDailyPlay({ today, setToday, reload, onSolved })
  const { challenge, progress } = play
  const playRef = useRef<DailyPlayApi>(play)
  playRef.current = play

  // Search days: which spot hides which target, and this round's looks.
  const assignment = useMemo(() => (challenge.kind === 'search' ? assignTargets(challenge, today.puzzle.seed) : new Map<string, string>()), [challenge, today.puzzle.seed])
  const [round, setRound] = useState<SearchRound>(() => (challenge.kind === 'search' ? roundFromGuesses(challenge, progress.guesses) : EMPTY_ROUND))
  useEffect(() => {
    if (challenge.kind === 'search') setRound(roundFromGuesses(challenge, progress.guesses))
  }, [challenge, progress.guesses])

  // A fresh fail (out of guesses, or giving up) opens the door anyway, with the answer in the result.
  const wasFinished = useRef(isFinished(progress))
  useEffect(() => {
    if (wasFinished.current || progress.status !== 'failed') return
    wasFinished.current = true
    bus.emit('sfx', { name: 'error' })
    useRoomUi.getState().say('Out of luck today. The door creaks open anyway.', 'bad')
    window.setTimeout(() => {
      const u = useRoomUi.getState()
      if (!u.leaving) u.open({ kind: 'result' })
    }, 1400)
  }, [progress.status])

  // Publish what the 3D props draw.
  useEffect(() => {
    useRoomPlay.setState({
      challenge,
      progress,
      maxGuesses: today.puzzle.maxGuesses,
      round,
      assignment,
      doorOpen: isFinished(progress),
      number: today.puzzle.number,
      theme: today.puzzle.theme,
    })
  }, [challenge, progress, round, assignment, today.puzzle])

  const leave = useCallback(() => {
    const u = useRoomUi.getState()
    if (u.leaving) return
    u.close()
    u.setLeaving(true)
    bus.emit('sfx', { name: 'whoosh' })
    const p = playRef.current
    window.setTimeout(() => walkHome({ progress: p.progress, maxGuesses: p.today.puzzle.maxGuesses, signedIn: p.signedIn }), 900)
  }, [])

  // Props -> panels. Every prop carries an id `daily:*` and no event of its own.
  const roundRef = useRef(round)
  roundRef.current = round
  useEffect(
    () =>
      bus.on('interact', ({ id }) => {
        if (!id.startsWith('daily:')) return
        const p = playRef.current
        const u = useRoomUi.getState()
        const c = p.challenge
        if (id === 'daily:lock' || id === 'daily:board') {
          if (p.finished) u.open({ kind: 'result' })
          else u.open({ kind: 'lock' })
        } else if (id === 'daily:hint') {
          if (p.finished) u.say('No hints needed: today is done.')
          else u.open({ kind: 'hint' })
        } else if (id === 'daily:plaque' || id.startsWith('daily:clue:')) {
          u.open({ kind: 'clues', focus: Number(id.split(':')[2]) || 0 })
        } else if (id === 'daily:door') {
          u.say(p.finished ? 'Walk through the doorway to go home.' : 'Locked tight. The lock is on the wall to the right.')
        } else if (id.startsWith('daily:spot:') && c.kind === 'search') {
          if (p.progress.status !== 'playing') return
          const spot = id.slice('daily:spot:'.length)
          if (!canLook(spot, roundRef.current, assignment)) return
          const res = look(c, roundRef.current, spot, assignment)
          const name = c.data.symbol
          if (res.hit) {
            bus.emit('sfx', { name: 'chalk' })
            u.say(`You found a brass ${name}!`, 'good')
          } else u.say('Nothing here.')
          setRound(res.round)
          if (res.guess) {
            const left = c.slots - c.check(res.guess).filter((m) => m === 'hit').length
            p.guess(res.guess)
            if (left > 0 && p.progress.guesses.length + 1 < p.today.puzzle.maxGuesses) {
              window.setTimeout(() => useRoomUi.getState().say(`Round over: ${left} still hidden. New round, ${left} look${left === 1 ? '' : 's'}.`), 1300)
            }
          }
        }
      }),
    [assignment],
  )

  // Something else closed the shared overlay (Esc handled elsewhere, a bus `overlay:close`): drop the panel too.
  useEffect(
    () =>
      useStore.subscribe((s, prev) => {
        if (prev.overlay && !s.overlay && useRoomUi.getState().panel) useRoomUi.setState({ panel: null })
      }),
    [],
  )

  // QA hook.
  useEffect(() => {
    window.__ESCAPE_DAILY_ROOM__ = { spots: () => Object.fromEntries(assignment), round: () => roundRef.current, leave }
    return () => {
      delete window.__ESCAPE_DAILY_ROOM__
    }
  }, [assignment, leave])

  const enter = () => {
    bus.emit('user:gesture')
    if (progress.status === 'idle') play.start()
    useStore.getState().setWorldReady(true)
  }

  return (
    <div className="fixed inset-0 overflow-hidden bg-[var(--color-night)] select-none" data-testid="daily-room" data-kind={challenge.kind} data-status={progress.status}>
      <style>{ROOM_CSS}</style>
      <Canvas
        id="daily-room-canvas"
        dpr={DPR[quality]}
        gl={{ antialias: quality !== 'low', powerPreference: 'high-performance' }}
        camera={{ fov: 70, near: 0.05, far: 40, position: SPAWN.position }}
        style={{ position: 'absolute', inset: 0, touchAction: 'none' }}
      >
        <color attach="background" args={[LIGHT.background]} />
        <Suspense fallback={null}>
          <RoomScene play={play} onExit={leave} />
        </Suspense>
      </Canvas>
      {worldReady && <RoomHud play={play} />}
      {worldReady && <ControlsHint />}
      <Reticle />
      <MobileControls />
      <RoomPanels play={play} onLeave={leave} />
      <Toast />
      <Confetti />
      {!worldReady && !leaving && <EntryCard play={play} onEnter={enter} />}
      <LeavingFade />
      <AudioSystem />
    </div>
  )
}

function RoomScene({ play, onExit }: { play: DailyPlayApi; onExit(): void }) {
  useMemo(() => warmMaterials(), [])
  const c = play.challenge
  return (
    <>
      <RoomLights />
      <RoomShell />
      <ExitDoor />
      <LockBox c={c} />
      <Clues c={c} />
      {c.kind !== 'cipher' && <ExitSign />}
      <GuessBoard c={c} />
      <HintBell />
      <Plaque c={c} />
      <Furniture searchSymbol={c.kind === 'search' ? c.data.symbol : null} />
      <PlayerController />
      <InteractionSystem />
      <ExitWatcher onExit={onExit} />
    </>
  )
}
