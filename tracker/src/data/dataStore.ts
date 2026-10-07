import type { Creature, RawCondition, RawTrait, RawCreature, RawHazard, Attack, Ability, SpellBlock, SpellSlotEntry } from '../types/pf2e'
import { parseCreature, parseHazard } from '../utils/parseCreature'
import { entriesToText } from '../utils/tags'
import { searchMatches } from '../utils/searchRank'
import { MONSTER_PARTS_RULES } from './monsterPartsRules'
import { notifyPersist } from '../store/persistBus'

const BASE = '/data'

let _index: IndexEntry[] | null = null
let _conditions: Map<string, string> | null = null
let _traits: Map<string, string> | null = null
let _spells: Map<string, SpellInfo> | null = null
let _rituals: Map<string, RitualInfo> | null = null
let _actions: Map<string, string> | null = null
let _skills: Map<string, string> | null = null
let _equipment: Map<string, EquipmentInfo> | null = null
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
  _conditions = new Map()
  // Degrade to an empty map on a missing/corrupt file, exactly like every sibling loader below — this
  // was the ONE loader without a try/catch, so a single failed conditions.json fetch rejected the
  // `Promise.all` in gameDataContext and left ALL game data permanently empty.
  try {
    const data = await fetchJSON<{ condition: (RawCondition & { text?: string })[] }>('conditions.json')
    for (const c of data.condition ?? []) {
      // Prefer the link-preserving `text` rebuilt from AoN markdown.
      _conditions.set(c.name.toLowerCase(), c.text ?? entriesToText(c.entries))
    }
  } catch { /* no conditions glossary if the file can't load — non-fatal */ }
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

let _abilities: Map<string, string> | null = null
export async function loadAbilitiesGlossary(): Promise<Map<string, string>> {
  if (_abilities) return _abilities
  try {
    const data = await fetchJSON<{ ability: Array<{ name: string; entries?: (string|object)[] }> }>('abilities.json')
    const map = new Map<string, string>()
    for (const a of data.ability ?? []) {
      if (a.entries?.length) {
        const key = a.name.toLowerCase()
        if (!map.has(key)) map.set(key, entriesToText(a.entries))
      }
    }
    _abilities = map
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
    // Wait for loadActions first. `fetchJSON`'s cache only helps a caller that arrives AFTER the
    // response; started side by side in the same Promise.all, both missed it and actions.json (3.4 MB)
    // went over the wire twice on every cold load.
    await loadActions()
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

/* `loadImages` / public/data/images.json are GONE (2026-09-15). The file was 84 KB of 1,050 creature
 * names mapped onto FIVE distinct URLs — every one an Archives sidebar icon
 * (https://2e.aonprd.com/images/Icons/Sidebar_*.png), not a token — and both app CSPs allow images
 * only from 'self', data: and blob:, so not one of them could ever have loaded. A creature's `image`
 * is still real: it is the base64 data URL a user uploads via CombatantDetail, stored on the custom
 * creature. Nothing replaced this lookup because there was nothing to replace. */

/**
 * The bestiary PRE-FILTER. MonsterSearch calls this with max 5000 and ranks only what comes back, so
 * anything this drops is invisible no matter how good the ranking is — and a bare
 * `name.includes(query)` drops every multi-word query whose words are in a different order than the
 * creature's name ("rat giant", or a stray double space, returned 0 rows for Giant Rat).
 *
 * `searchMatches` is the same `.includes` for a single word and "every word appears somewhere" for
 * several, so nothing that matched before stops matching. Imported from the TRACKER's copy of
 * searchRank (a sync test pins it byte-identical to src/data/searchRank.ts) — never from ../../src,
 * which tsconfig deliberately keeps out of reach.
 */
export async function searchCreatures(query: string, max = 60): Promise<IndexEntry[]> {
  const idx = await loadIndex()
  if (!query.trim()) return idx.slice(0, max)
  return idx.filter(e => searchMatches(query, e.name)).slice(0, max)
}

/** A source without its page suffix: "GM Core pg. 102" and "GM Core p.102" both read "GM Core". */
const sourceWithoutPage = (s: unknown): string =>
  String(s ?? '').replace(/\s*(?:pg\.|p\.)\s*\d+.*$/i, '').trim()

/**
 * The hazard printing an index row names. hazards.json keeps EVERY printing of a hazard (a byte copy of
 * the corpus, legacy copy first), and the index row names one of them by name, level and source; a
 * find by name alone opened the first copy whatever the row said (90 rows: "Hidden Pit" (GM Core) loaded
 * the Core Rulebook page). Match all three, and fall back to the first copy with that name only when no
 * copy matches the row's level and source.
 */
export function pickHazardPrinting<H extends { name: string; level?: number; source?: string }>(
  hazards: H[], entry: Pick<IndexEntry, 'name' | 'level' | 'source'>,
): H | undefined {
  const named = hazards.filter(h => h.name === entry.name)
  const src = sourceWithoutPage(entry.source)
  return named.find(h => h.level === entry.level && sourceWithoutPage(h.source) === src) ?? named[0]
}

export async function loadCreature(entry: IndexEntry): Promise<Creature> {
  const key = `${entry.file}::${entry.name}`
  if (_creatureCache.has(key)) return _creatureCache.get(key)!

  if (entry.isHazard) {
    const data = await fetchJSON<{ hazard: RawHazard[] }>('hazards.json')
    const raw = pickHazardPrinting(data.hazard, entry)
    if (!raw) throw new Error(`Hazard "${entry.name}" not found`)
    const c = parseHazard(raw)
    _creatureCache.set(key, c)
    return c
  }

  const data = await fetchJSON<{ creature: RawCreature[] }>(`bestiary/${entry.file}`)
  const raw = data.creature.find(c => c.name === entry.name)
  if (!raw) throw new Error(`Creature "${entry.name}" not found`)
  const c = parseCreature(raw, entry.file)
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

let _aliases: Map<string, string> | null = null
/** Legacy name (lowercased) → the name of the index row that serves its remaster (decision D11).
 *  The index offers the newest printing only (R12), so "Adult Red Dragon" or "Troll" is not in it;
 *  public/data/bestiary-aliases.json, built by scripts/bestiary-aliases.mjs from the Archives' own
 *  legacy → remaster links, says which row stands in for it. Empty when the file can't load. */
export async function loadBestiaryAliases(): Promise<Map<string, string>> {
  if (_aliases) return _aliases
  const m = new Map<string, string>()
  try {
    const data = await fetchJSON<Record<string, unknown>>('bestiary-aliases.json')
    for (const [k, v] of Object.entries(data ?? {})) if (typeof v === 'string' && v) m.set(k.toLowerCase(), v)
  } catch { /* no aliases if the file can't load — the exact name still resolves */ }
  _aliases = m
  return m
}

/** The index row a (case-insensitive) name opens: its own row, else the row its legacy → remaster
 *  alias names (D11). Null when neither exists. */
export async function findBestiaryEntry(name: string): Promise<IndexEntry | null> {
  const m = await loadCreatureNameIndex()
  const key = name.toLowerCase()
  const own = m.get(key)
  if (own) return own
  const alias = (await loadBestiaryAliases()).get(key)
  return alias ? m.get(alias.toLowerCase()) ?? null : null
}

/** Load a creature's full stat block by (case-insensitive) name, or null if no
 *  bestiary entry matches. A legacy name opens the remaster the index serves in its place
 *  (findBestiaryEntry). Cached via loadCreature's own cache. */
export async function loadCreatureByName(name: string): Promise<Creature | null> {
  const entry = await findBestiaryEntry(name)
  if (!entry) return null
  try { return await loadCreature(entry) } catch { return null }
}

// ── Custom creatures ──────────────────────────────────────────────────────
// In-memory cache so we don't JSON.parse the whole list on every read/write.
// `_storedCustom` is the list exactly as stored, every entry; `_customCreatures` is the usable view
// every reader gets. Writers work on the stored list, so a skipped entry is never dropped by them.
let _storedCustom: unknown[] | null = null
let _customCreatures: Creature[] | null = null
const CUSTOM_KEY = 'pf2e-custom-creatures'

// ── Reading a stat block ──────────────────────────────────────────────────
// A homebrew stat block reaches the board from storage, the GM mirror, a backup, a pasted JSON or an
// imported file, and the board reads EVERY field of it: the lists read name/traits/source/level, the
// stat block reads senses.flatMap and languages.join, Elite/Weak reads Object.entries(skills). One
// field of the wrong type took the whole tracker down (2026-10-02), so a stat block is read whole,
// field by field, against the types Creature declares:
//   • a REQUIRED field that is missing gets the value every app writer gives it (the builder, the
//     text parser, the file importer's normalizeCreature) — a thin paste works instead of crashing;
//   • an OPTIONAL one (`?` in the type) may be missing or null, and is passed through as it is;
//   • a field present with the wrong type refuses the whole block, with the reason: guessing what it
//     meant would show the GM a stat block that is not theirs.
// `name`, `traits` and a `defenses` block must be there (the file importer's own test for "looks like
// a creature"). Unknown fields ride along untouched.

type Fields = Record<string, unknown>
const isFields = (v: unknown): v is Fields => !!v && typeof v === 'object' && !Array.isArray(v)
const isWords = (v: unknown): v is string[] => Array.isArray(v) && v.every(t => typeof t === 'string')

class NotAStatBlock extends Error {}
const refuse = (why: string): never => { throw new NotAStatBlock(why) }

const text = (v: unknown, at: string, d = '') =>
  v === undefined ? d : typeof v === 'string' ? v : refuse(`"${at}" must be text`)
const num = (v: unknown, at: string, d = 0) =>
  v === undefined ? d : typeof v === 'number' ? v : refuse(`"${at}" must be a number`)
const flag = (v: unknown, at: string) =>
  typeof v === 'boolean' ? v : refuse(`"${at}" must be true or false`)
const words = (v: unknown, at: string): string[] =>
  v === undefined ? [] : isWords(v) ? v : refuse(`"${at}" must be a list of words`)
const numbers = (v: unknown, at: string): Record<string, number> =>
  v === undefined ? {} : isFields(v) && Object.values(v).every(n => typeof n === 'number')
    ? v as Record<string, number> : refuse(`"${at}" must be names with numbers`)
const listOf = <T>(v: unknown, at: string, read: (o: Fields, at: string) => T): T[] =>
  v === undefined ? [] : !Array.isArray(v) ? refuse(`"${at}" must be a list`)
    : v.map((o, i) => (isFields(o) ? read(o, `${at}[${i}]`) : refuse(`"${at}[${i}]" must be an object`)))
/** Optional fields: missing or null is fine, anything else must pass `check`. */
const optional = (o: Fields, at: string, keys: string[], check: (v: unknown, at: string) => unknown) => {
  for (const k of keys) if (o[k] != null) check(o[k], `${at}${k}`)
}

const attackOf = (a: Fields, at: string): Attack => {
  optional(a, `${at}.`, ['activity'], text)
  return {
    ...a, range: text(a.range, `${at}.range`, 'Melee') as Attack['range'], name: text(a.name, `${at}.name`),
    attack: num(a.attack, `${at}.attack`), traits: words(a.traits, `${at}.traits`),
    damage: text(a.damage, `${at}.damage`), types: words(a.types, `${at}.types`),
    effects: words(a.effects, `${at}.effects`), isAgile: a.isAgile === undefined ? false : flag(a.isAgile, `${at}.isAgile`),
  }
}
/** One of a fixed set of words (an ability's page slot, a printed save). */
const oneOf = <T extends string>(allowed: readonly T[]) => (v: unknown, at: string): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? v as T
    : refuse(`"${at}" must be one of ${allowed.join(', ')}`)
const SLOTS = ['top', 'mid', 'bot'] as const
const SAVES = ['fort', 'ref', 'will'] as const
const abilityOf = (a: Fields, at: string): Ability => {
  optional(a, `${at}.`, ['activity', 'trigger'], text)
  optional(a, `${at}.`, ['slot'], oneOf(SLOTS))
  return { ...a, name: text(a.name, `${at}.name`), traits: words(a.traits, `${at}.traits`), entries: text(a.entries, `${at}.entries`) }
}
const spellOf = (s: Fields, at: string): SpellSlotEntry['spells'][number] => {
  optional(s, `${at}.`, ['note'], text)
  optional(s, `${at}.`, ['uses'], num)
  optional(s, `${at}.`, ['atWill'], flag)
  return { ...s, name: text(s.name, `${at}.name`) }
}
const spellRankOf = (r: Fields, at: string): SpellSlotEntry => {
  optional(r, `${at}.`, ['slots'], num)
  optional(r, `${at}.`, ['isCantrip', 'isConstant'], flag)
  return { ...r, label: text(r.label, `${at}.label`), level: num(r.level, `${at}.level`), spells: listOf(r.spells, `${at}.spells`, spellOf) }
}
const spellBlockOf = (b: Fields, at: string): SpellBlock => {
  optional(b, `${at}.`, ['tradition'], text)
  optional(b, `${at}.`, ['DC', 'attack', 'focusPoints'], num)
  return {
    ...b, name: text(b.name, `${at}.name`), type: text(b.type, `${at}.type`), spells: text(b.spells, `${at}.spells`),
    spellsByLevel: listOf(b.spellsByLevel, `${at}.spellsByLevel`, spellRankOf),
  }
}
const amountOf = (r: Fields, at: string) => {
  optional(r, `${at}.`, ['amount'], num)
  optional(r, `${at}.`, ['note'], text)
  return { ...r, name: text(r.name, `${at}.name`), amount: (r.amount ?? null) as number | null }
}

function readStatBlock(x: unknown): Creature {
  if (Array.isArray(x)) refuse('paste one creature, not a list')
  if (!isFields(x)) return refuse('paste one creature as a JSON object')
  const c = x
  if (typeof c.name !== 'string') refuse('"name" must be text')
  if (!isWords(c.traits)) refuse('"traits" must be a list of words')
  const d = isFields(c.defenses) ? c.defenses : refuse('it needs a "defenses" block')
  optional(c, '', ['image', 'perceptionNote', 'speedNote', 'flavor', 'family', 'recallKnowledge', 'aonUrl', 'rawMarkdown'], text)
  optional(c, '', ['isHazard', 'fromArchivesPage'], flag)
  optional(c, '', ['languageAbilities'], words)
  optional(d, 'defenses.', ['hpNote', 'saveNote', 'acNote'], text)
  optional(d, 'defenses.', ['hardness', 'bt'], num)
  optional(d, 'defenses.', ['acPrinted'], flag)
  // The fields the verified-bestiary adapter added (2026-10-06): the renderer reads every HP pool and
  // every printed save, so one of the wrong shape refuses the block like any other field.
  optional(d, 'defenses.', ['hpPools'], (v, at) => listOf(v, at, (p, pat) => {
    optional(p, `${pat}.`, ['name'], text)
    return typeof p.hp === 'number' ? p : refuse(`"${pat}.hp" must be a number`)
  }))
  optional(d, 'defenses.', ['savesPrinted'], (v, at) =>
    Array.isArray(v) ? v.map((s, i) => oneOf(SAVES)(s, `${at}[${i}]`)) : refuse(`"${at}" must be a list`))
  if (c.hazardData != null) {
    const h = isFields(c.hazardData) ? c.hazardData : refuse('"hazardData" must be an object')
    optional(h, 'hazardData.', ['stealth', 'description', 'disable', 'routine', 'reset'], text)
    optional(h, 'hazardData.', ['complex'], flag)
  }
  let rituals = c.rituals
  if (rituals != null) {
    const r = isFields(rituals) ? rituals : refuse('"rituals" must be an object')
    optional(r, 'rituals.', ['dc'], num)
    rituals = {
      ...r,
      casts: listOf(r.casts, 'rituals.casts', (k, at) =>
        ({ ...k, rank: text(k.rank, `${at}.rank`), level: num(k.level, `${at}.level`), names: words(k.names, `${at}.names`) })),
    }
  }
  const out = {
    ...c,
    source: text(c.source, 'source', 'Homebrew'),
    level: num(c.level, 'level'),
    perception: num(c.perception, 'perception'),
    senses: words(c.senses, 'senses'),
    languages: words(c.languages, 'languages'),
    skills: numbers(c.skills, 'skills'),
    str: num(c.str, 'str'), dex: num(c.dex, 'dex'), con: num(c.con, 'con'),
    int: num(c.int, 'int'), wis: num(c.wis, 'wis'), cha: num(c.cha, 'cha'),
    items: words(c.items, 'items'),
    speed: numbers(c.speed, 'speed'),
    attacks: listOf(c.attacks, 'attacks', attackOf),
    spellcasting: listOf(c.spellcasting, 'spellcasting', spellBlockOf),
    ...(rituals !== undefined ? { rituals } : {}),
    abilities: listOf(c.abilities, 'abilities', abilityOf),
    defenses: {
      ...d,
      // A hazard stored before acPrinted existed (2026-10-06) holds the ac: 10 the old builder and
      // text parser started every hazard at, which the GM never typed — and the stat block then drew
      // no hazard AC at all. Read without the flag, it keeps drawing none.
      ...(c.isHazard === true && d.acPrinted == null ? { acPrinted: false } : {}),
      ac: num(d.ac, 'defenses.ac'), fort: num(d.fort, 'defenses.fort'), ref: num(d.ref, 'defenses.ref'),
      will: num(d.will, 'defenses.will'), hp: num(d.hp, 'defenses.hp'),
      immunities: words(d.immunities, 'defenses.immunities'),
      resistances: listOf(d.resistances, 'defenses.resistances', amountOf),
      weaknesses: listOf(d.weaknesses, 'defenses.weaknesses', amountOf),
    },
  } as Creature
  // A hazard strike's page place (D13): how many abilities the page prints before it — a whole
  // number from 0 to the number of abilities. Null is "absent", as for every optional field.
  out.attacks.forEach((a, i) => {
    const n: unknown = a.afterAbility
    if (n != null && !(typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= out.abilities.length)) {
      refuse(`"attacks[${i}].afterAbility" must be a whole number from 0 to ${out.abilities.length}`)
    }
  })
  return out
}

/** `x` as a stat block every surface of the tracker can read (missing fields filled in, see above),
 *  or null when it is not one. A copy: `x` itself is never changed. */
export function toStatBlock(x: unknown): Creature | null {
  try { return readStatBlock(x) } catch (e) { if (e instanceof NotAStatBlock) return null; throw e }
}

/** Why `x` is not a stat block, in words for the GM, or null when it is one. */
export function statBlockProblem(x: unknown): string | null {
  try { readStatBlock(x); return null } catch (e) { if (e instanceof NotAStatBlock) return e.message; throw e }
}

/** A stored entry's own id: a non-empty string, else null. */
const idOf = (x: unknown): string | null => {
  const id = isFields(x) ? x.id : undefined
  return typeof id === 'string' && id !== '' ? id : null
}

/** A stored entry as the tracker uses it: a stat block with its own id — the id is how every list,
 *  edit and delete addresses it (two entries without one were edited and deleted together). Anything
 *  else — an array, null, a string, an object with no name, a field of the wrong type — is SKIPPED by
 *  every reader (2026-10-02: one array entry crashed the whole tracker each time it was opened) and
 *  refused by saveCustomCreature. Skipped is not deleted: it stays in storage as it was. */
function usableEntry(x: unknown): Creature | null {
  return idOf(x) === null ? null : toStatBlock(x)
}

export function isCustomCreature(x: unknown): boolean {
  return usableEntry(x) !== null
}

function storedCustomList(): unknown[] {
  if (_storedCustom) return _storedCustom
  let list: unknown[] = []
  try {
    const raw = localStorage.getItem(CUSTOM_KEY)
    if (raw) {
      let parsed: unknown
      try { parsed = JSON.parse(raw) } catch { parsed = raw }
      // A stored value that isn't a list rides along as one entry, so a save keeps it rather than
      // writing over it.
      list = Array.isArray(parsed) ? parsed : [parsed]
    }
  } catch { list = [] }
  _storedCustom = list
  return list
}

/** The usable view of the stored list: each usable entry as toStatBlock reads it. Never written back. */
const usableList = (list: unknown[]): Creature[] =>
  list.map(usableEntry).filter((c): c is Creature => c !== null)

function writeCustomList(next: unknown[]): void {
  _storedCustom = next
  _customCreatures = usableList(next)
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(next))
  notifyPersist(CUSTOM_KEY)
}

export function loadCustomCreatures(): Creature[] {
  if (_customCreatures) return _customCreatures
  _customCreatures = usableList(storedCustomList())
  return _customCreatures
}

/** True when some stored entry, usable or skipped, holds `id`. A NEW save picks a fresh id instead
 *  (TextConverter): a pasted copy of another creature's JSON, renamed, used to replace that creature. */
export function isCustomIdTaken(id: string): boolean {
  return storedCustomList().some(c => idOf(c) === id)
}

/** Store `creature`, replacing the entry with its id or appending. Returns false and writes nothing
 *  for a value that isn't a stat block with its own id; what is stored is the stat block as
 *  toStatBlock reads it. The entry replaced is the one the lists show under that id, else a skipped
 *  entry holding it — an explicit Overwrite of a creature whose stored copy is skipped replaces that
 *  copy rather than sitting beside it under the same id. Exactly one entry is replaced, and an entry
 *  without an id of its own is never matched. */
export function saveCustomCreature(creature: Creature): boolean {
  const entry = usableEntry(creature)
  if (!entry) return false
  // Always re-allocate so React components that received the cached array as
  // their state value see a new reference (forcing the re-render they expect).
  const current = storedCustomList()
  let at = current.findIndex(c => usableEntry(c)?.id === entry.id)
  if (at < 0) at = current.findIndex(c => idOf(c) === entry.id)
  writeCustomList(at < 0 ? [...current, entry] : current.map((c, i) => (i === at ? entry : c)))
  return true
}

/** Put an uploaded image on the stored homebrew entry for a board combatant's creature. The image
 *  goes onto the STORED entry — the board's copy written over it reverted every edit made to the
 *  homebrew since the combatant was added. A creature with no stored entry is added, as before.
 *  Returns false, writing nothing, when the entry holding that id is one the lists skip: it is kept
 *  as it is, never replaced by the board's copy. */
export function saveCustomCreatureImage(creature: Creature, image: string): boolean {
  const id = idOf(creature)
  if (id === null) return false
  const shown = usableList(storedCustomList()).find(c => c.id === id)
  if (shown) return saveCustomCreature({ ...shown, image })
  if (isCustomIdTaken(id)) return false
  return saveCustomCreature({ ...creature, image })
}

/** Remove the entry the lists show under `id`. A skipped entry is never deleted: nothing lists it. */
export function deleteCustomCreature(id: string): void {
  const current = storedCustomList()
  const next = current.filter(c => { const u = usableEntry(c); return !u || u.id !== id })
  if (next.length === current.length) return
  writeCustomList(next)
}

/** Drop the in-memory cache so the next read re-parses localStorage — the GM-device mirror
 *  (src/data/trackerSync.ts) wrote a newer list there. */
export function reloadCustomCreatures(): void {
  _storedCustom = null
  _customCreatures = null
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
