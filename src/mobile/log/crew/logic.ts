/**
 * Pure crew-tagging helpers (workstream 36): friend chips ordered by how often you play together,
 * plus guest names for people without an account.
 */
import type { CrewSuggestion, CrewTag, PublicUser } from '../../../contracts/models'

export type FriendSuggestion = Extract<CrewSuggestion, { kind: 'friend' }>
export type GuestSuggestion = Extract<CrewSuggestion, { kind: 'guest' }>

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()

export function friendName(u: Pick<PublicUser, 'displayName' | 'handle'>): string {
  return u.displayName || (u.handle ? `@${u.handle}` : 'Friend')
}

/** Friends first, most visits together first (ties by name); then guest names the same way. */
export function sortSuggestions(list: readonly CrewSuggestion[]): CrewSuggestion[] {
  const label = (s: CrewSuggestion) => (s.kind === 'friend' ? friendName(s.user) : s.guestName)
  return [...list].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'friend' ? -1 : 1
    if (b.visitsTogether !== a.visitsTogether) return b.visitsTogether - a.visitsTogether
    return label(a).localeCompare(label(b))
  })
}

export function tagKey(t: CrewTag): string {
  return 'userId' in t ? `u:${t.userId}` : `g:${norm(t.guestName)}`
}

export function hasTag(value: readonly CrewTag[], t: CrewTag): boolean {
  const k = tagKey(t)
  return value.some((v) => tagKey(v) === k)
}

export function toggleTag(value: readonly CrewTag[], t: CrewTag): CrewTag[] {
  const k = tagKey(t)
  return hasTag(value, t) ? value.filter((v) => tagKey(v) !== k) : [...value, t]
}

/** Find a friend whose display name, first name or @handle matches a typed or spoken name. */
export function findFriend(name: string, suggestions: readonly CrewSuggestion[]): FriendSuggestion | null {
  const n = norm(name).replace(/^@/, '')
  if (!n) return null
  const friends = suggestions.filter((s): s is FriendSuggestion => s.kind === 'friend')
  const exact = friends.find((f) => norm(f.user.displayName) === n || (f.user.handle && norm(f.user.handle) === n))
  if (exact) return exact
  // "Mia" matches the friend "Mia Chen" when only one friend has that first name.
  const byFirst = friends.filter((f) => norm(f.user.displayName).split(' ')[0] === n)
  return byFirst.length === 1 ? byFirst[0] : null
}

/** Typed name -> a friend tag when it names a friend, else a guest tag. Null for blank input. */
export function tagForName(name: string, suggestions: readonly CrewSuggestion[]): CrewTag | null {
  const clean = name.trim().replace(/\s+/g, ' ').slice(0, 60)
  if (!clean) return null
  const f = findFriend(clean, suggestions)
  return f ? { userId: f.user.id } : { guestName: clean }
}

const SELF_WORDS = new Set(['me', 'i', 'myself', 'me myself', 'us', 'we'])

/**
 * Crew names from the extracted draft ("me, Maya, Leo") -> tags, skipping the person logging
 * (by the words "me"/"I" or their own name) and duplicates.
 */
export function tagsFromNames(names: readonly string[], suggestions: readonly CrewSuggestion[], self?: Pick<PublicUser, 'id' | 'displayName' | 'handle'> | null): CrewTag[] {
  const selfNames = new Set<string>()
  if (self) {
    selfNames.add(norm(self.displayName))
    selfNames.add(norm(self.displayName).split(' ')[0])
    if (self.handle) selfNames.add(norm(self.handle))
  }
  let out: CrewTag[] = []
  for (const raw of names) {
    const n = norm(raw)
    if (!n || SELF_WORDS.has(n) || selfNames.has(n)) continue
    const t = tagForName(raw, suggestions)
    if (!t || ('userId' in t && self && t.userId === self.id)) continue
    if (!hasTag(out, t)) out = [...out, t]
  }
  return out
}

/** Chip text for a tag. */
export function tagLabel(t: CrewTag, suggestions: readonly CrewSuggestion[]): string {
  if ('guestName' in t) return t.guestName
  const f = suggestions.find((s): s is FriendSuggestion => s.kind === 'friend' && s.user.id === t.userId)
  return f ? friendName(f.user) : 'Friend'
}
