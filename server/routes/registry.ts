/**
 * The single list of route modules. server/index.ts registers each one in its own Fastify scope.
 * Owned by foundation: workstreams fill in their own module files and never edit this list.
 */
import type { FastifyInstance } from 'fastify'
import { authRoutes } from '../auth'
import type { AppContext } from '../context'
import { seoRoutes } from '../seo'
import { adminRoutes } from './admin'
import { avatarRoutes } from './avatar'
import { claimsRoutes } from './claims'
import { dailyRoutes } from './daily'
import { directoryRoutes } from './directory'
import { extractRoutes } from './extract'
import { friendsRoutes } from './friends'
import { logsRoutes } from './logs'
import { phase1Routes } from './logs.phase1'
import { photosRoutes } from './photos'
import { platformRoutes } from './platform'
import { reviewsRoutes } from './reviews'
import { transcribeRoutes } from './transcribe'
import { visitsRoutes } from './visits'
import { wishlistRoutes } from './wishlist'

export interface RouteModule {
  /** Workstream number in docs/PHASE2_PLAN.md. */
  ws: number
  name: string
  file: string
  register(app: FastifyInstance, ctx: AppContext): Promise<void>
}

export const ROUTE_MODULES: readonly RouteModule[] = [
  { ws: 27, name: 'platform', file: 'server/routes/platform.ts', register: platformRoutes },
  { ws: 3, name: 'auth', file: 'server/auth/index.ts', register: authRoutes },
  { ws: 4, name: 'account and logs', file: 'server/routes/logs.ts', register: logsRoutes },
  { ws: 4, name: 'phase 1 data', file: 'server/routes/logs.phase1.ts', register: phase1Routes },
  { ws: 4, name: 'wish list', file: 'server/routes/wishlist.ts', register: wishlistRoutes },
  { ws: 5, name: 'directory', file: 'server/routes/directory.ts', register: directoryRoutes },
  { ws: 10, name: 'transcription', file: 'server/routes/transcribe.ts', register: transcribeRoutes },
  { ws: 11, name: 'extraction', file: 'server/routes/extract.ts', register: (app, ctx) => extractRoutes(app, ctx) },
  { ws: 23, name: 'escape of the day', file: 'server/routes/daily.ts', register: dailyRoutes },
  { ws: 24, name: 'photos', file: 'server/routes/photos.ts', register: photosRoutes },
  { ws: 25, name: 'moderation', file: 'server/routes/admin.ts', register: adminRoutes },
  { ws: 26, name: 'seo', file: 'server/seo/index.ts', register: seoRoutes },
  { ws: 31, name: 'friends', file: 'server/routes/friends.ts', register: friendsRoutes },
  { ws: 32, name: 'visits', file: 'server/routes/visits.ts', register: visitsRoutes },
  { ws: 33, name: 'reviews', file: 'server/routes/reviews.ts', register: reviewsRoutes },
  { ws: 34, name: 'claims', file: 'server/routes/claims.ts', register: claimsRoutes },
  // Phase 3 workstream B (ws 302 = phase 3, workstream 2/B).
  { ws: 302, name: 'avatar and wardrobe', file: 'server/routes/avatar.ts', register: avatarRoutes },
]

export async function registerRoutes(app: FastifyInstance, ctx: AppContext) {
  for (const mod of ROUTE_MODULES) {
    await app.register(async (scope) => mod.register(scope, ctx))
  }
}
