/**
 * Characters (Phase 3 workstream B). `Character` draws anyone from an `Outfit`; `LocalAvatar` is
 * you (mounted by World.tsx). The catalogue and pose maths are pure and shared with the server.
 */
export { Character, type CharacterMotion, type CharacterProps } from './Character'
export { LocalAvatar } from './LocalAvatar'
export { CHARACTER_ACTIONS, locomotionAction, poseAt, type CharacterAction, type CharacterEmote } from './animation'
export * from './catalog'
