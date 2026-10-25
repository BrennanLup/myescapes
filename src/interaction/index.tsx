/**
 * Interaction system (workstream 9). See README.md.
 * - `InteractionSystem`: mount inside the Canvas (World.tsx does).
 * - `Reticle`: DOM overlay (App.tsx does).
 * - `useIsHovered(id)`: true while that interactable is hovered.
 */
export { InteractionSystem } from './InteractionSystem'
export { Reticle } from './Reticle'
export { useIsHovered, interactHovered, useInteraction } from './controller'
