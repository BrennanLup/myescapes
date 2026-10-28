/**
 * App shell: canvas + DOM overlays. Owned by the orchestrator.
 */
import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { World } from './world/World'
import { useStore } from './state/store'
import { LIGHT } from './contracts/style'
import { PLAYER, ANCHORS } from './contracts/scene'
import { ReviewOverlay } from './ui/review'
import { RecordOverlay } from './ui/record'
import { ConfirmOverlay } from './ui/confirm'
import { WishlistOverlay } from './world/wishlist'
import { DailyOverlay } from './daily/ui/overlay'
import { DailyWelcome } from './daily/ui/welcome'
import { WrapOverlay } from './ui/wrap'
import { LoadingScreen, Hud, SettingsOverlay } from './ui/shell'
import { Reticle } from './interaction'
import { MobileControls } from './player'
import { AudioSystem } from './audio'
import { CharacterHud, WardrobeOverlay } from './ui/wardrobe'

const DPR: Record<string, [number, number]> = { low: [0.75, 1], medium: [1, 1.5], high: [1, 2] }

function Overlays() {
  const overlay = useStore((s) => s.overlay)
  if (!overlay) return null
  switch (overlay.kind) {
    case 'review':
      return <ReviewOverlay roomId={overlay.roomId} />
    case 'record':
      return <RecordOverlay />
    case 'confirm':
      return <ConfirmOverlay draft={overlay.draft} />
    case 'wishlist':
      return <WishlistOverlay />
    case 'wrap':
      return <WrapOverlay />
    case 'gate':
      // The door is Escape of the Day now (workstream 22): optional, never blocks entry.
      return <DailyOverlay />
    case 'settings':
      return <SettingsOverlay />
    case 'wardrobe':
      return <WardrobeOverlay />
  }
}

export function App() {
  const quality = useStore((s) => s.settings.quality)
  return (
    <div className="fixed inset-0 overflow-hidden bg-[var(--color-night)] select-none">
      <Canvas
        id="world-canvas"
        shadows={quality !== 'low'}
        dpr={DPR[quality]}
        gl={{ antialias: quality !== 'low', powerPreference: 'high-performance' }}
        camera={{ fov: 70, near: 0.05, far: 80, position: [ANCHORS.spawn.position[0], PLAYER.eyeHeight, ANCHORS.spawn.position[2]] }}
        style={{ position: 'absolute', inset: 0, touchAction: 'none' }}
      >
        <color attach="background" args={[LIGHT.background]} />
        <Suspense fallback={null}>
          <World />
        </Suspense>
      </Canvas>
      <Hud />
      <Reticle />
      <MobileControls />
      <CharacterHud />
      <Overlays />
      <LoadingScreen />
      <DailyWelcome />
      <AudioSystem />
    </div>
  )
}
