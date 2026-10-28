/**
 * The 3D world. Each workstream exports one component that mounts itself at its
 * anchor(s); this file only lists them. Owned by the orchestrator.
 */
import { useMemo } from 'react'
import { warmMaterials } from './materials'
import { Room } from './room'
import { Lighting } from './lighting'
import { LivingProps } from './props/living'
import { DeskProps } from './props/desk'
import { BulletinBoard } from './board'
import { RedString } from './string'
import { WishlistBoard } from './wishlist'
import { GateDoor } from '@/gate'
import { WrapTrophy } from '@/ui/wrap'
import { PlayerController, RenderPause } from '@/player'
import { LocalAvatar } from './avatars'
import { RemotePlayers } from './avatars/RemotePlayers'
import { InteractionSystem } from '@/interaction'
import { PerfMonitor } from '@/ui/shell'

export function World() {
  // Build every shared material and its procedural textures up front, behind the loading screen.
  useMemo(() => warmMaterials(), [])
  return (
    <>
      <Lighting />
      <Room />
      <LivingProps />
      <DeskProps />
      <BulletinBoard />
      <RedString />
      <WishlistBoard />
      <GateDoor />
      <WrapTrophy />
      <PlayerController />
      <LocalAvatar />
      <RemotePlayers />
      <InteractionSystem />
      <PerfMonitor />
      <RenderPause />
    </>
  )
}
