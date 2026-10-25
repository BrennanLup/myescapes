/**
 * The 3D world. Each workstream exports one component that mounts itself at its
 * anchor(s); this file only lists them. Owned by the orchestrator.
 */
import { Room } from './room'
import { Lighting } from './lighting'
import { LivingProps } from './props/living'
import { DeskProps } from './props/desk'
import { BulletinBoard } from './board'
import { RedString } from './string'
import { WishlistBoard } from './wishlist'
import { GateDoor } from '@/gate'
import { WrapTrophy } from '@/ui/wrap'
import { PlayerController } from '@/player'
import { InteractionSystem } from '@/interaction'
import { PerfMonitor } from '@/ui/shell'

export function World() {
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
      <InteractionSystem />
      <PerfMonitor />
    </>
  )
}
