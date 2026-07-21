import type { Creature, RawCondition, RawTrait, RawCreature, RawHazard } from '../types/pf2e'
import { parseCreature, parseHazard } from '../utils/parseCreature'
import { entriesToText } from '../utils/tags'
import { MONSTER_PARTS_RULES } from './monsterPartsRules'

const BASE = '/data'

let _index: IndexEntry[] | null = null
let _conditions: Map<string, string> | null = null
let _traits: Map<string, string> | null = null
let _spells: Map<string, SpellInfo> | null = null
let _rituals: Map<string, RitualInfo> | null = null
let _actions: Map<string, string> | null = null
let _skills: Map<string, string> | null = null
let _equipment: Map<string, EquipmentInfo> | null = null
let _images: Map<string, string> | null = null
const _creatureCache = new Map<string, Creature>()
const _fileCache = new Map<string, object>()

export interface EquipmentInfo {
  name: string
  level: number
  traits: string[]
  category: string        // 'weapon' | 'armor' | 'shield' | 'equipment'
  itemCategory?: string   // 'Worn Items', 'Consumables', etc.
  price?: string
  bulk?: string
  usage?: string
  damage?: string         // weapons: "1d8 S"
  hands?: string
  acBonus?: number        // armor
  description: string
  source?: string
  url?: string
}

export interface SpellInfo {
  name: string
  level: number
  traits: string[]
  cast?: string
  components?: string[]   // ['verbal', 'somatic', 'material']
  range?: string
  area?: string
  targets?: string
  duration?: string
  savingThrow?: string
  description: string
  heightened?: Record<string, string>
  source?: string
}

export interface RitualInfo {
  name: string
  level: number
  traits: string[]
  cast?: string
  cost?: string
  secondaryCasters?: string
  primaryCheck?: string
  secondaryChecks?: string
  area?: string
  range?: string
  targets?: string
  duration?: string
  description: string
  heightened?: Record<string, string>
  source?: string
  url?: string
}

export interface IndexEntry {
  name: string; level: number; traits: string[]
  source: string; file: string; isHazard?: boolean
  // Denormalized filter data (added by scrape-aon.mjs). All optional so older
  // index.json files still parse cleanly.
  isNpc?: boolean
  immunities?: string[]
  weaknesses?: string[]
  resistances?: string[]
  speedTypes?: string[]
  maxSpeed?: number
  traditions?: string[]
  spellDC?: number
  spellLvl?: number
  spellTypes?: string[]
  /** Experimental "similar to class" tag — populated by
   *  scripts/classify-similar-classes.mjs for humanoid creatures. Hidden
   *  from creature cards; only used by the Similar Class search filter. */
  similarClasses?: string[]
}

async function fetchJSON<T>(path: string): Promise<T> {
  if (_fileCache.has(path)) return _fileCache.get(path) as T
  const r = await fetch(`${BASE}/${path}`)
  if (!r.ok) throw new Error(`Failed to load ${path}: ${r.status}`)
  const data = await r.json()
  _fileCache.set(path, data)
  return data as T
}

export async function loadIndex(): Promise<IndexEntry[]> {
  if (_index) return _index
  _index = await fetchJSON<IndexEntry[]>('index.json')
  return _index
}

export async function loadConditions(): Promise<Map<string, string>> {
  if (_conditions) return _conditions
  const data = await fetchJSON<{ condition: (RawCondition & { text?: string })[] }>('conditions.json')
  _conditions = new Map()
  for (const c of data.condition ?? []) {
    // Prefer the link-preserving `text` rebuilt from AoN markdown.
    _conditions.set(c.name.toLowerCase(), c.text ?? entriesToText(c.entries))
  }
  return _conditions
}

export async function loadEquipment(): Promise<Map<string, EquipmentInfo>> {
  if (_equipment) return _equipment
  try {
    const data = await fetchJSON<Record<string, EquipmentInfo>>('equipment-index.json')
    _equipment = new Map(Object.entries(data))
  } catch { _equipment = new Map() }
  return _equipment
}

export async function loadSpells(): Promise<Map<string, SpellInfo>> {
  if (_spells) return _spells
  try {
    const data = await fetchJSON<Record<string, SpellInfo>>('spells-index.json')
    _spells = new Map(Object.entries(data))
  } catch { _spells = new Map() }
  return _spells
}

export async function loadRituals(): Promise<Map<string, RitualInfo>> {
  if (_rituals) return _rituals
  try {
    const data = await fetchJSON<Record<string, RitualInfo>>('rituals.json')
    _rituals = new Map(Object.entries(data))
  } catch { _rituals = new Map() }
  return _rituals
}

export async function loadAbilitiesGlossary(): Promise<Map<string, string>> {
  try {
    const data = await fetchJSON<{ ability: Array<{ name: string; entries?: (string|object)[] }> }>('abilities.json')
    const map = new Map<string, string>()
    for (const a of data.ability ?? []) {
      if (a.entries?.length) {
        const key = a.name.toLowerCase()
        if (!map.has(key)) map.set(key, entriesToText(a.entries))
      }
    }
    return map
  } catch { return new Map() }
}

export async function loadActions(): Promise<Map<string, string>> {
  if (_actions) return _actions
  try {
    const data = await fetchJSON<{ action: Array<{ name: string; entries?: (string|object)[]; text?: string }> }>('actions.json')
    _actions = new Map()
    for (const a of data.action ?? []) {
      // Prefer the link-preserving `text` (rebuilt from AoN markdown); fall back
      // to the older stripped entries for the few entries with no raw match.
      const text = a.text ?? (a.entries?.length ? entriesToText(a.entries) : '')
      if (text) _actions.set(a.name.toLowerCase(), text)
    }
  } catch { _actions = new Map() }
  return _actions
}

let _actionTraits: Map<string, string[]> | null = null
/** name (lowercased) → its PF2e traits, e.g. Demoralize → [Auditory, …]. Read
 *  from the same actions.json (cached), so popups can show action traits. */
export async function loadActionTraits(): Promise<Map<string, string[]>> {
  if (_actionTraits) return _actionTraits
  try {
    const data = await fetchJSON<{ action: Array<{ name: string; traits?: string[] }> }>('actions.json')
    _actionTraits = new Map()
    for (const a of data.action ?? []) {
      if (Array.isArray(a.traits) && a.traits.length) _actionTraits.set(a.name.toLowerCase(), a.traits)
    }
  } catch { _actionTraits = new Map() }
  return _actionTraits
}

export async function loadSkills(): Promise<Map<string, string>> {
  if (_skills) return _skills
  try {
    const data = await fetchJSON<{ skill: Array<{ name: string; entries?: (string|object)[] }> }>('skills.json')
    _skills = new Map()
    for (const s of data.skill ?? []) {
      if (s.entries?.length) {
        _skills.set(s.name.toLowerCase(), entriesToText([s.entries[0]]).slice(0, 400))
      }
    }
  } catch { _skills = new Map() }
  return _skills
}

export async function loadTraits(): Promise<Map<string, string>> {
  if (_traits) return _traits
  try {
    const data = await fetchJSON<{ trait: (RawTrait & { text?: string })[] }>('traits.json')
    _traits = new Map()
    for (const t of data.trait ?? []) {
      const text = t.text ?? (t.entries?.length ? entriesToText(t.entries) : '')
      if (text) _traits.set(t.name.toLowerCase(), text)
    }
  } catch { _traits = new Map() }
  // Override entries that rely on unresolvable external links
  _traits.set('reload',
    `This entry indicates how many Interact actions it takes to reload such weapons. This can be 0 if drawing ammunition and firing the weapon are part of the same action. If an item takes 2 or more actions to reload, the GM determines whether they must be performed together as an activity, or you can spend some of those actions during one turn and the rest during your next turn.\n\nAn item with an entry of "—" must be drawn to be thrown, which usually takes an Interact action just like drawing any other weapon. Reloading a ranged weapon and drawing a thrown weapon both require a free hand. Switching your grip to free a hand and then to place your hands in the grip necessary to wield the weapon are both included in the actions you spend to reload a weapon.`)
  _traits.set('range increment',
    `Ranged and thrown weapons have a range increment. Attacks with these weapons work normally up to that distance. Attack rolls beyond a weapon's range increment take a –2 penalty for each additional multiple of that increment between you and the target. Attacks beyond the sixth range increment are impossible.\n\nFor example, a shortbow takes no penalty against a target up to 60 feet away, a –2 penalty against a target beyond 60 feet but up to 120 feet away, and a –4 penalty against a target beyond 120 feet but up to 180 feet away, and so on, up to 360 feet.`)
  return _traits
}

let _families: Map<string, string> | null = null
/** Creature-family name (lowercased) → description text. */
export async function loadFamilies(): Promise<Map<string, string>> {
  if (_families) return _families
  try {
    const data = await fetchJSON<Record<string, { name: string; text: string }>>('creature-families.json')
    _families = new Map()
    for (const [k, v] of Object.entries(data)) if (v?.text) _families.set(k, v.text)
  } catch { _families = new Map() }
  return _families
}

let _creatureLinks: Map<string, Record<string, string>> | null = null
/** Per-creature map of the exact terms Archives of Nethys hyperlinks on that
 *  creature's page → our popup type (term lowercased). Lets prose link the same
 *  words AoN does. Keyed by creature name (lowercased). */
export async function loadCreatureLinks(): Promise<Map<string, Record<string, string>>> {
  if (_creatureLinks) return _creatureLinks
  try {
    const data = await fetchJSON<Record<string, Record<string, string>>>('creature-links.json')
    _creatureLinks = new Map(Object.entries(data))
  } catch { _creatureLinks = new Map() }
  return _creatureLinks
}

export interface RuleEntry { name: string; text: string; source?: string }
let _rules: Map<string, RuleEntry> | null = null
/** AoN "Rules" pages (name lowercased → { name, cleaned body with {@…} links }).
 *  Powers the rule reference popup. */
export async function loadRules(): Promise<Map<string, RuleEntry>> {
  if (_rules) return _rules
  let map: Map<string, RuleEntry>
  try {
    const data = await fetchJSON<Record<string, RuleEntry>>('rules.json')
    map = new Map(Object.entries(data))
  } catch { map = new Map() }
  // Segments of the Monster Parts (Remaster Conversion) book — each heading is
  // its own searchable rule (search visibility is gated behind the Show Monster
  // Parts setting in GlobalSearch).
  for (const r of MONSTER_PARTS_RULES) map.set(r.name.toLowerCase(), { name: r.name, text: r.text, source: r.source })
  _rules = map
  return _rules
}

export async function loadImages(): Promise<Map<string, string>> {
  if (_images) return _images
  try {
    const data = await fetchJSON<Record<string, string>>('images.json')
    _images = new Map(Object.entries(data))
  } catch { _images = new Map() }
  return _images
}

export async function searchCreatures(query: string, max = 60): Promise<IndexEntry[]> {
  const idx = await loadIndex()
  if (!query.trim()) return idx.slice(0, max)
  const q = query.toLowerCase()
  return idx.filter(e => e.name.toLowerCase().includes(q)).slice(0, max)
}

export async function loadCreature(entry: IndexEntry): Promise<Creature> {
  const key = `${entry.file}::${entry.name}`
  if (_creatureCache.has(key)) return _creatureCache.get(key)!

  const images = await loadImages()

  if (entry.isHazard) {
    const data = await fetchJSON<{ hazard: RawHazard[] }>('hazards.json')
    const raw = data.hazard.find(h => h.name === entry.name)
    if (!raw) throw new Error(`Hazard "${entry.name}" not found`)
    const c = parseHazard(raw)
    if (!c.image) c.image = images.get(c.name.toLowerCase())
    _creatureCache.set(key, c)
    return c
  }

  const data = await fetchJSON<{ creature: RawCreature[] }>(`bestiary/${entry.file}`)
  const raw = data.creature.find(c => c.name === entry.name)
  if (!raw) throw new Error(`Creature "${entry.name}" not found`)
  const c = parseCreature(raw, entry.file)
  if (!c.image) c.image = images.get(c.name.toLowerCase())
  _creatureCache.set(key, c)
  return c
}

// ── Creature-by-name lookup (for auto-linked creature mentions in prose) ──────
let _nameIndex: Map<string, IndexEntry> | null = null
/** Lowercased creature name → its index entry (first match wins). Lets prose
 *  link a bare creature mention to its stat block. */
export async function loadCreatureNameIndex(): Promise<Map<string, IndexEntry>> {
  if (_nameIndex) return _nameIndex
  const m = new Map<string, IndexEntry>()
  try {
    for (const e of await loadIndex()) {
      const k = e.name.toLowerCase()
      if (!m.has(k)) m.set(k, e)
    }
  } catch { /* no creature linking if the index can't load — non-fatal */ }
  _nameIndex = m
  return m
}

/** Load a creature's full stat block by (case-insensitive) name, or null if no
 *  bestiary entry matches. Cached via loadCreature's own cache. */
export async function loadCreatureByName(name: string): Promise<Creature | null> {
  const m = await loadCreatureNameIndex()
  const entry = m.get(name.toLowerCase())
  if (!entry) return null
  try { return await loadCreature(entry) } catch { return null }
}

// ── Custom creatures ──────────────────────────────────────────────────────
// In-memory cache so we don't JSON.parse the whole list on every read/write.
let _customCreatures: Creature[] | null = null
const CUSTOM_KEY = 'pf2e-custom-creatures'

export function loadCustomCreatures(): Creature[] {
  if (_customCreatures) return _customCreatures
  try {
    const raw = localStorage.getItem(CUSTOM_KEY)
    _customCreatures = raw ? JSON.parse(raw) : []
  } catch { _customCreatures = [] }
  return _customCreatures!
}

export function saveCustomCreature(creature: Creature): void {
  // Always re-allocate so React components that received the cached array as
  // their state value see a new reference (forcing the re-render they expect).
  const current = loadCustomCreatures()
  const idx = current.findIndex(c => c.id === creature.id)
  const next = idx >= 0
    ? current.map(c => (c.id === creature.id ? creature : c))
    : [...current, creature]
  _customCreatures = next
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(next))
}

export function deleteCustomCreature(id: string): void {
  const current = loadCustomCreatures()
  const next = current.filter(c => c.id !== id)
  if (next.length === current.length) return
  _customCreatures = next
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(next))
}

// ── Hidden bestiary entries ────────────────────────────────────────────────
// Key format: "file::name" (same as creature cache key)
let _hiddenEntries: Set<string> | null = null
const HIDDEN_KEY = 'pf2e-hidden-entries'

export function loadHiddenEntries(): Set<string> {
  if (_hiddenEntries) return _hiddenEntries
  try {
    const raw = localStorage.getItem(HIDDEN_KEY)
    _hiddenEntries = new Set(raw ? JSON.parse(raw) : [])
  } catch { _hiddenEntries = new Set() }
  return _hiddenEntries!
}

export function hideEntry(key: string): void {
  const current = loadHiddenEntries()
  if (current.has(key)) return
  const next = new Set(current); next.add(key)
  _hiddenEntries = next
  localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next]))
}

export function unhideEntry(key: string): void {
  const current = loadHiddenEntries()
  if (!current.has(key)) return
  const next = new Set(current); next.delete(key)
  _hiddenEntries = next
  localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next]))
}
