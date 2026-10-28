/**
 * Realtime client (Phase 3, workstream C): the socket, smooth remote movement and the stores the
 * room's people UI reads. See README.md.
 */
export { RealtimeClient, backoffDelay, realtimeUrl, WindowLimiter, type ConnectionStatus, type SendResult } from './client'
export { ServerClock } from './clock'
export { INTERP_DELAY_MS, lerpAngle, PoseBuffer, wrapAngle, type SampledPose } from './interpolation'
export { activeLocalEmote, installRealtime, kickPlayer, loadPresence, realtimeClient, sendChat, sendEmote } from './session'
export { BUBBLE_MS, EMOTE_MS, firstName, friendsInOrder, playersInOrder, poses, useRealtime, whereLabel, type ChatLine, type Player } from './store'
