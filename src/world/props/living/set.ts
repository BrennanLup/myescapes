/** Assembles the whole living set into merged per-material geometry + book instances. */
import { ROOM, type Vec3 } from '@/contracts/scene'
import { PartsBuilder, type BuiltPart } from './builder'
import { beanBags, coffeeTable, couch, floorLamp, pendants, rug, sideTable } from './furniture'
import { FLOOR_PLANTS, HANGING_PLANTS } from './layout'
import { bush, hangingPlant, monstera, snakePlant } from './plants'
import { bookshelf, type BookInstance } from './shelf'

export interface LivingSet {
  parts: BuiltPart[]
  books: BookInstance[]
  /** World-space reference points (lamp shade centres). */
  marks: Map<string, Vec3>
}

export function buildLivingSet(): LivingSet {
  const b = new PartsBuilder()
  rug(b)
  couch(b)
  beanBags(b)
  coffeeTable(b)
  sideTable(b)
  floorLamp(b)
  pendants(b)
  const books = bookshelf(b)
  FLOOR_PLANTS.forEach((p, i) => {
    const seed = 100 + i * 17
    if (p.kind === 'monstera') monstera(b, p.pos, p.scale, seed)
    else if (p.kind === 'snake') snakePlant(b, p.pos, p.scale, seed)
    else bush(b, p.pos, p.scale, seed)
  })
  HANGING_PLANTS.forEach((pos, i) => hangingPlant(b, pos, ROOM.height, 300 + i * 7))
  return { parts: b.build(), books, marks: b.marks }
}
