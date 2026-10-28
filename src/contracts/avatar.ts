/**
 * Phase 3 workstream B: your character's outfit, the keys you earned and what you bought.
 * Shared by the server (`server/routes/avatar.ts`) and the wardrobe (`src/ui/wardrobe`).
 * Kept apart from `routes.ts` so Phase 3 teams don't collide in one file; call these with
 * `callApi` like any other route.
 *
 * No real money: keys are earned in the app (see `KEY_REWARDS` in src/world/avatars/catalog.ts).
 */
import { z } from 'zod'
import {
  FABRIC_COLORS,
  HAIR_COLORS,
  ITEMS,
  SKIN_TONES,
  type AccessoryId,
  type BottomId,
  type HairId,
  type HatId,
  type ItemId,
  type Outfit,
  type OutfitSlot,
  type ShoesId,
  type TopId,
} from '../world/avatars/catalog'
import type { RouteSpec } from './routes'

const ids = <T extends string>(list: readonly { id: string }[]) => list.map((x) => x.id) as [T, ...T[]]
const slotIds = <T extends string>(slot: OutfitSlot) => ids<T>(ITEMS.filter((i) => i.slot === slot))

export const ItemIdSchema = z.enum(ids<ItemId>(ITEMS))
const FabricSchema = z.enum(ids<(typeof FABRIC_COLORS)[number]['id']>(FABRIC_COLORS))

/** A complete look; every field must be a catalogue id (400 `invalid` otherwise). */
export const OutfitSchema = z
  .object({
    skin: z.enum(ids<(typeof SKIN_TONES)[number]['id']>(SKIN_TONES)),
    hair: z.enum(slotIds<HairId>('hair')),
    hairColor: z.enum(ids<(typeof HAIR_COLORS)[number]['id']>(HAIR_COLORS)),
    top: z.enum(slotIds<TopId>('top')),
    topColor: FabricSchema,
    bottom: z.enum(slotIds<BottomId>('bottom')),
    bottomColor: FabricSchema,
    shoes: z.enum(slotIds<ShoesId>('shoes')),
    shoesColor: FabricSchema,
    hat: z.enum(slotIds<HatId>('hat')),
    hatColor: FabricSchema,
    accessory: z.enum(slotIds<AccessoryId>('accessory')),
  })
  .strict() satisfies z.ZodType<Outfit>

export const KeyBalanceSchema = z.object({
  /** Keys you can spend now. */
  balance: z.number().int().min(0),
  earned: z.number().int().min(0),
  spent: z.number().int().min(0),
  /** Rooms counted towards your keys. */
  rooms: z.number().int().min(0),
  /** Escape of the Day puzzles solved. */
  dailies: z.number().int().min(0),
})

export const AvatarStateSchema = z.object({
  /** False for signed-out visitors: the wardrobe keeps their look on this device only. */
  signedIn: z.boolean(),
  outfit: OutfitSchema,
  /** True once you saved a look (otherwise `outfit` is your free starter look). */
  saved: z.boolean(),
  /** Priced items you bought. Free items are never listed. */
  owned: z.array(ItemIdSchema),
  /** Null when signed out. */
  keys: KeyBalanceSchema.nullable(),
})
export type AvatarState = z.infer<typeof AvatarStateSchema>

const route = <const S extends RouteSpec>(spec: S): S => spec

export const AVATAR_ROUTES = {
  getAvatar: route({
    method: 'GET', path: '/api/me/avatar', auth: 'optional', ws: 302,
    summary: 'My outfit, the items I own and my key balance. Signed out: a starter look, nothing owned, no keys.',
    response: AvatarStateSchema,
  }),
  putAvatar: route({
    method: 'PUT', path: '/api/me/avatar', auth: 'user', ws: 302,
    summary: 'Wear an outfit. 403 `forbidden` when it uses a priced item I have not bought.',
    body: z.object({ outfit: OutfitSchema }),
    response: AvatarStateSchema,
  }),
  buyItem: route({
    method: 'POST', path: '/api/me/avatar/purchases', auth: 'user', ws: 302,
    summary: 'Buy a wardrobe item with keys (no real money). 409 `conflict` when it is free or already owned, 403 `forbidden` when I have too few keys. Optionally wears the new outfit in the same step.',
    body: z.object({ itemId: ItemIdSchema, wear: OutfitSchema.optional() }),
    response: AvatarStateSchema,
  }),
} as const
