import { useState, useEffect, useRef, useMemo } from 'react'
import { searchCreatures, loadCreature, loadCustomCreatures, deleteCustomCreature, loadHiddenEntries, hideEntry, loadImages } from '../data/dataStore'
import type { IndexEntry } from '../data/dataStore'
import type { Creature } from '../types/pf2e'
import { useCombatStore } from '../store/combatStore'
import { usePartyStore } from '../store/partyStore'
import type { PartyPlayer } from '../store/partyStore'
import { TrashIcon, XIcon, SearchIcon } from './Icons'
import { RangeSlider } from './RangeSlider'
import { readThemeTokens } from '../utils/themeTokens'
import { cleanSource as cleanSourceShared } from '../utils/sources'
import { useSourcesStore } from '../store/sourcesStore'
import { useEncounterTablesStore } from '../store/encounterTablesStore'

// ── 3-state pill ────────────────────────────────────────────────────────────
type TriState = 'off' | 'yes' | 'no'
function nextTri(s: TriState): TriState { return s === 'off' ? 'yes' : s === 'yes' ? 'no' : 'off' }

// Shared with the Sources setting + global search so a disabled book matches
// here identically.
function cleanSource(s: string): string {
  return cleanSourceShared(s)
}

/**
 * Stable module-level token component. Defined OUTSIDE the parent so its
 * function identity is preserved across renders — if this lived inside
 * MonsterSearch, every state update (including the per-mousemove updates
 * from the hover preview) would unmount and remount the <img>, swallowing
 * the mouseleave that should clear the popup.
 */
interface TokenProps {
  src: string
  name: string
  onOpen: (src: string, name: string) => void
  onHover: (src: string, x: number, y: number) => void
  onMove:  (x: number, y: number) => void
  onLeave: () => void
}
function Token({ src, name, onOpen, onHover, onMove, onLeave }: TokenProps) {
  return (
    <img
      src={src}
      alt=""
      onClick={e => { e.stopPropagation(); onOpen(src, name) }}
      onMouseEnter={e => onHover(src, e.clientX, e.clientY)}
      onMouseMove={e => onMove(e.clientX, e.clientY)}
      onMouseLeave={onLeave}
      title="Click to open full image"
      style={{
        width: 30, height: 30, borderRadius: '50%',
        border: '1.5px solid var(--accent-line)',
        objectFit: 'cover', flexShrink: 0,
        cursor: 'zoom-in', display: 'block',
        boxShadow: 'var(--shadow-sm)',
      }}
    />
  )
}

// ── Trait categorization ────────────────────────────────────────────────────
const TRAIT_CATEGORIES: Record<string, string[]> = {
  Rarity:       ['Common', 'Uncommon', 'Rare', 'Unique'],
  Alignment:    ['LG', 'NG', 'CG', 'LN', 'N', 'CN', 'LE', 'NE', 'CE', 'Holy', 'Unholy'],
  Size:         ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'],
  'Creature Type': [
    'Aberration', 'Animal', 'Astral', 'Beast', 'Celestial', 'Construct',
    'Div', 'Dragon', 'Dream', 'Elemental', 'Ethereal', 'Fey', 'Fiend',
    'Fungus', 'Giant', 'Humanoid', 'Kami', 'Monitor', 'Nindoru', 'Ooze',
    'Petitioner', 'Plant', 'Spirit', 'Time', 'Undead',
  ],
  Creature: [
    'Aasimar', 'Aeon', 'Aiuvarin', 'Amphibious', 'Anadi', 'Angel', 'Aquatic',
    'Archon', 'Azarketi', 'Azata', 'Boggard', 'Caligni', 'Catfolk', 'Changeling',
    'Charau-Ka', 'Couatl', 'Daemon', 'Demon', 'Dero', 'Devil', 'Dhampir',
    'Dinosaur', 'Drow', 'Duergar', 'Duskwalker', 'Dwarf', 'Elf', 'Fetchling',
    'Ganzi', 'Genie', 'Ghost', 'Ghoul', 'Gnoll', 'Gnome', 'Goblin', 'Golem',
    'Gremlin', 'Grippli', 'Hag', 'Half-Elf', 'Half-Orc', 'Halfling', 'Herald',
    'Human', 'Ifrit', 'Incorporeal', 'Inevitable', 'Kitsune', 'Kobold', 'Leshy',
    'Lizardfolk', 'Merfolk', 'Mindless', 'Minion', 'Morlock', 'Mummy', 'Mutant',
    'Nymph', 'Oni', 'Orc', 'Oread', 'Phantom', 'Protean', 'Psychopomp', 'Qlippoth',
    'Rakshasa', 'Ratfolk', 'Sea Devil', 'Serpentfolk', 'Shoony', 'Skeleton',
    'Skulk', 'Soulbound', 'Spriggan', 'Sprite', 'Strix', 'Suli', 'Swarm', 'Sylph',
    'Tane', 'Tengu', 'Troll', 'Undine', 'Urdefhan', 'Vampire', 'Velstrac',
    'Werecreature', 'Wight', 'Wraith', 'Xulgath', 'Zombie',
  ],
  'Energy & Element': ['Acid', 'Air', 'Cold', 'Earth', 'Electricity', 'Fire', 'Metal', 'Negative', 'Positive', 'Water', 'Wood'],
  Effect:       ['Light', 'Mental', 'Poison', 'Auditory', 'Visual', 'Olfactory'],
  Tradition:    ['Arcane', 'Divine', 'Occult', 'Primal'],
  Hazard:       ['Trap', 'Haunt', 'Mechanical', 'Environmental', 'Complex'],
}
const SPEED_TYPES = ['Walk', 'Burrow', 'Climb', 'Fly', 'Swim'] as const
const SPELL_TYPES = [
  'Focus', 'Innate', 'Prepared', 'Spontaneous',
  'Innate Arcane', 'Innate Divine', 'Innate Occult', 'Innate Primal',
  'Prepared Arcane', 'Prepared Divine', 'Prepared Occult', 'Prepared Primal',
  'Spontaneous Arcane', 'Spontaneous Divine', 'Spontaneous Occult', 'Spontaneous Primal',
  'Arcane', 'Divine', 'Occult', 'Primal',
] as const

// Experimental "Similar Class" filter — humanoid creatures are heuristically
// tagged with one or more matching PF2e player classes by
// scripts/classify-similar-classes.mjs. The filter pills use this list.
const SIMILAR_CLASSES = [
  'Alchemist', 'Barbarian', 'Bard', 'Champion', 'Cleric',
  'Druid', 'Fighter', 'Gunslinger', 'Investigator', 'Inventor',
  'Kineticist', 'Magus', 'Monk', 'Oracle', 'Psychic',
  'Ranger', 'Rogue', 'Sorcerer', 'Summoner', 'Swashbuckler',
  'Thaumaturge', 'Witch', 'Wizard',
] as const

const TRAIT_TO_CAT = (() => {
  const m = new Map<string, string>()
  for (const [cat, list] of Object.entries(TRAIT_CATEGORIES)) {
    for (const t of list) m.set(t.toLowerCase(), cat)
  }
  return m
})()
function categorizeTrait(trait: string): string {
  return TRAIT_TO_CAT.get(trait.toLowerCase()) ?? 'General'
}

// Maximum values used for range slider bounds — derived from the index.
interface Bounds {
  level: { min: number; max: number }
  speed: { min: number; max: number }
  spellDC: { min: number; max: number }
  spellLvl: { min: number; max: number }
}

interface Filters {
  levelMin: number | null
  levelMax: number | null
  hazard: 'all' | 'creature' | 'hazard'
  /** Selected biome = the id of a saved encounter table; restricts results to
   *  the creatures/hazards linked in that table. null = any biome. */
  biome: string | null
  traits: Record<string, TriState>
  sources: Record<string, TriState>
  immunities: Record<string, TriState>
  weaknesses: Record<string, TriState>
  resistances: Record<string, TriState>
  speedTypes: Record<string, TriState>
  spellTypes: Record<string, TriState>
  /** Experimental — see SIMILAR_CLASSES constant above. */
  similarClasses: Record<string, TriState>
  speedMin: number | null;   speedMax: number | null
  spellDcMin: number | null; spellDcMax: number | null
  spellLvlMin: number | null; spellLvlMax: number | null
}

const EMPTY_FILTERS: Filters = {
  levelMin: null, levelMax: null, hazard: 'all', biome: null,
  traits: {}, sources: {}, immunities: {}, weaknesses: {}, resistances: {},
  speedTypes: {}, spellTypes: {}, similarClasses: {},
  speedMin: null, speedMax: null,
  spellDcMin: null, spellDcMax: null,
  spellLvlMin: null, spellLvlMax: null,
}

// ── Persistent search-modal state ──────────────────────────────────────────
// Filters / sort / collapsed-section state outlive the modal — closing the
// search and re-opening it (or restarting the app) shouldn't reset what
// the user just configured.
const SEARCH_STORAGE_KEY = 'pf2e-monster-search-state'

interface PersistedSearchState {
  filters?: Partial<Filters>
  levelSort?: 'off' | 'asc' | 'desc'
  hiddenSections?: string[]
  collapsedResultSections?: string[]
}

function loadPersistedSearchState(): PersistedSearchState {
  try {
    const raw = localStorage.getItem(SEARCH_STORAGE_KEY)
    return raw ? JSON.parse(raw) as PersistedSearchState : {}
  } catch { return {} }
}

function savePersistedSearchState(state: PersistedSearchState): void {
  try {
    localStorage.setItem(SEARCH_STORAGE_KEY, JSON.stringify(state))
  } catch { /* quota — silently drop, filters will reset on next launch */ }
}

function activeCountIn(map: Record<string, TriState>): number {
  return Object.values(map).filter(v => v !== 'off').length
}
// Sources are special: their default is 'yes'. Anything in the map that's
// not 'yes' (i.e., the user has actively cleared or excluded it) counts
// as a non-default filter.
function sourceModifiedCount(map: Record<string, TriState>): number {
  return Object.values(map).filter(v => v !== 'yes').length
}
function totalActive(f: Filters, b: Bounds): number {
  let n = 0
  if (f.levelMin != null && f.levelMin > b.level.min) n++
  if (f.levelMax != null && f.levelMax < b.level.max) n++
  if (f.hazard !== 'all') n++
  if (f.biome) n++
  if (f.speedMin != null && f.speedMin > b.speed.min) n++
  if (f.speedMax != null && f.speedMax < b.speed.max) n++
  if (f.spellDcMin != null && f.spellDcMin > b.spellDC.min) n++
  if (f.spellDcMax != null && f.spellDcMax < b.spellDC.max) n++
  if (f.spellLvlMin != null && f.spellLvlMin > b.spellLvl.min) n++
  if (f.spellLvlMax != null && f.spellLvlMax < b.spellLvl.max) n++
  n += activeCountIn(f.traits)
  n += sourceModifiedCount(f.sources)
  n += activeCountIn(f.immunities)
  n += activeCountIn(f.weaknesses)
  n += activeCountIn(f.resistances)
  n += activeCountIn(f.speedTypes)
  n += activeCountIn(f.spellTypes)
  n += activeCountIn(f.similarClasses)
  return n
}

function passesCategory(entryValues: string[], filterMap: Record<string, TriState>): boolean {
  const yeses: string[] = []; const nos: string[] = []
  for (const [k, v] of Object.entries(filterMap)) {
    if (v === 'yes') yeses.push(k)
    else if (v === 'no') nos.push(k)
  }
  if (yeses.length) {
    let any = false
    for (const y of yeses) if (entryValues.some(v => v.toLowerCase() === y.toLowerCase())) { any = true; break }
    if (!any) return false
  }
  if (nos.length) {
    for (const n of nos) if (entryValues.some(v => v.toLowerCase() === n.toLowerCase())) return false
  }
  return true
}

function passesFilters(entry: IndexEntry, f: Filters, cleanedSource: string, biomeNames: Set<string> | null): boolean {
  if (f.hazard === 'creature' && entry.isHazard) return false
  if (f.hazard === 'hazard' && !entry.isHazard) return false
  // Biome = membership in the selected encounter table's linked stat blocks.
  if (biomeNames && !biomeNames.has(entry.name.toLowerCase())) return false
  if (f.levelMin != null && entry.level < f.levelMin) return false
  if (f.levelMax != null && entry.level > f.levelMax) return false
  // Traits are stored as one flat map but rendered across multiple sub-
  // categories (Size, Rarity, Creature Type, etc.). To get OR-within-
  // category and AND-across-categories semantics — e.g. (Human OR Goblin)
  // AND Huge — split the active trait filters back by their displayed
  // sub-category and require each sub-bucket to pass independently.
  const traitsBySubCat: Record<string, Record<string, TriState>> = {}
  for (const [trait, state] of Object.entries(f.traits)) {
    if (state === 'off') continue
    const cat = categorizeTrait(trait)
    if (!traitsBySubCat[cat]) traitsBySubCat[cat] = {}
    traitsBySubCat[cat][trait] = state
  }
  for (const subMap of Object.values(traitsBySubCat)) {
    if (!passesCategory(entry.traits, subMap)) return false
  }
  if (!passesCategory([cleanedSource], f.sources)) return false
  if (!passesCategory(entry.immunities ?? [], f.immunities)) return false
  if (!passesCategory(entry.weaknesses ?? [], f.weaknesses)) return false
  if (!passesCategory(entry.resistances ?? [], f.resistances)) return false
  if (!passesCategory(entry.speedTypes ?? [], f.speedTypes)) return false
  if (!passesCategory(entry.spellTypes ?? [], f.spellTypes)) return false
  if (!passesCategory(entry.similarClasses ?? [], f.similarClasses)) return false

  const spd = entry.maxSpeed ?? 0
  if (f.speedMin != null && spd < f.speedMin) return false
  if (f.speedMax != null && spd > f.speedMax) return false
  const dc = entry.spellDC ?? 0
  if (f.spellDcMin != null && dc < f.spellDcMin) return false
  if (f.spellDcMax != null && dc > f.spellDcMax) return false
  const sl = entry.spellLvl ?? 0
  if (f.spellLvlMin != null && sl < f.spellLvlMin) return false
  if (f.spellLvlMax != null && sl > f.spellLvlMax) return false
  return true
}

// ── Right-click delete menu ────────────────────────────────────────────────
type CtxMenu =
  | { kind: 'custom'; x: number; y: number; creature: Creature }
  | { kind: 'bestiary'; x: number; y: number; entry: IndexEntry }

function ContextMenu({ menu, onDelete, onClose }: { menu: CtxMenu; onDelete: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const name = menu.kind === 'custom' ? menu.creature.name : menu.entry.name

  return (
    <div ref={ref} style={{
      position: 'fixed', left: menu.x, top: menu.y, zIndex: 9999,
      background: 'var(--bg-panel)', border: 'var(--app-bw) solid var(--border-strong)',
      borderRadius: 8, boxShadow: 'var(--shadow-md)',
      minWidth: 210, padding: '4px 0',
    }}>
      <div style={{ padding: '5px 14px', fontSize: 11, color: 'var(--text-muted)', borderBottom: 'var(--app-bw) solid var(--border)', marginBottom: 3 }}
        className="truncate">{name}</div>
      {!confirming ? (
        <button className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--danger-soft)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'none')}
          onClick={() => setConfirming(true)}>
          <TrashIcon size={12} /> Delete
        </button>
      ) : (
        <div style={{ padding: '8px 12px' }}>
          <div style={{ fontSize: 12, color: 'var(--text)', marginBottom: 8 }}>Delete "{name}" permanently?</div>
          <div className="flex gap-2">
            <button style={{ flex: 1, background: 'var(--danger)', border: 'var(--app-bw) solid var(--danger)', borderRadius: 5, color: 'var(--text-on-danger)', fontSize: 11, padding: '4px 8px', cursor: 'pointer', fontWeight: 700 }}
              onClick={onDelete}>Yes, Delete</button>
            <button style={{ flex: 1, background: 'var(--bg-elevated)', border: 'var(--app-bw) solid var(--border-strong)', borderRadius: 5, color: 'var(--text-muted)', fontSize: 11, padding: '4px 8px', cursor: 'pointer' }}
              onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── 3-state pill ───────────────────────────────────────────────────────────
// "yes" uses a translucent fill of the base colour over dark + the colour
// itself for the text/border; this reads as "selected" without the eye-burning
// brightness of solid pastel backgrounds.
function TriPill({ label, state, onClick, baseColor }: {
  label: string; state: TriState; onClick: () => void
  /** Optional explicit colour for the "yes" state. When omitted, the pill
   *  uses theme tokens (`--accent` / `--danger`) so the selection colour
   *  flips with the active theme. */
  baseColor?: string
}) {
  // Default: theme-driven. "yes" → accent tint; "no" → danger tint.
  // When `baseColor` is passed (e.g. for source pills) we keep the custom
  // colour for "yes", but "no" still uses the theme's danger so all
  // exclude-states read the same colour.
  let bg = 'transparent'
  let color = 'var(--text-muted)'
  let border = 'var(--border-strong)'
  let deco = 'none'
  let weight = 600
  if (state === 'yes') {
    if (baseColor) {
      bg     = baseColor + '38'
      color  = baseColor
      border = baseColor
    } else {
      bg     = 'color-mix(in srgb, var(--accent) 22%, transparent)'
      color  = 'var(--accent)'
      border = 'var(--accent)'
    }
    weight = 700
  } else if (state === 'no') {
    bg     = 'color-mix(in srgb, var(--danger) 28%, transparent)'
    color  = 'var(--danger)'
    border = 'var(--danger)'
    deco   = 'line-through'
  }
  return (
    <button
      onClick={onClick}
      title={state === 'off' ? `Include "${label}"` : state === 'yes' ? `Exclude "${label}"` : `Clear "${label}"`}
      style={{
        fontSize: 10, fontWeight: weight, padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
        background: bg, color, border: `var(--app-bw) solid ${border}`, textDecoration: deco,
        letterSpacing: '0.04em', textTransform: 'uppercase',
        whiteSpace: 'nowrap', transition: 'all 0.1s',
      }}
    >{label}</button>
  )
}

function SectionHeader({ title, count, hidden, onAll, onClear, onNone, onToggleHide }: {
  title: string; count: number; hidden: boolean
  onAll?: () => void; onClear?: () => void; onNone?: () => void; onToggleHide?: () => void
}) {
  const linkBtn: React.CSSProperties = {
    background: 'none', border: 'none', cursor: 'pointer', fontSize: 10,
    color: 'var(--text-muted)', padding: '0 2px',
  }
  // Click anywhere on the title (or the chevron) to toggle hide.
  const stop = (fn?: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn?.() }
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      borderBottom: 'var(--app-bw) solid var(--border)', paddingBottom: 3,
    }}>
      <div
        onClick={onToggleHide}
        title={onToggleHide ? (hidden ? 'Click to expand' : 'Click to collapse') : undefined}
        style={{
          fontSize: 11, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.06em',
          cursor: onToggleHide ? 'pointer' : 'default',
          flex: 1, display: 'flex', alignItems: 'center', gap: 5,
        }}>
        <span style={{ fontSize: 9, color: 'var(--text-faded)', width: 8, display: 'inline-block' }}>
          {hidden ? '▸' : '▾'}
        </span>
        {title}
        {count > 0 && (
          <span style={{
            fontSize: 9, padding: '0 5px', borderRadius: 8,
            background: 'var(--accent)', color: 'var(--text-on-accent)', fontWeight: 800,
          }}>{count}</span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {!hidden && onAll   && <button style={linkBtn} onClick={stop(onAll)}   title="Mark all values as required">All</button>}
        {!hidden && onClear && <button style={linkBtn} onClick={stop(onClear)} title="Clear all values">Clear</button>}
        {!hidden && onNone  && <button style={linkBtn} onClick={stop(onNone)}  title="Mark all values as excluded">None</button>}
        {onToggleHide && <button style={linkBtn} onClick={stop(onToggleHide)}>{hidden ? 'Show' : 'Hide'}</button>}
      </div>
    </div>
  )
}

interface Props {
  onClose: () => void
  /** Pick-mode: when set, clicking a result calls this with the resolved Creature
   *  instead of adding it to the initiative tracker. Used by the party member
   *  "Link Stat Block" flow so we get the full filter UI here as well. */
  onPick?: (creature: Creature) => void
  title?: string
}

export function MonsterSearch({ onClose, onPick, title }: Props) {
  const pickMode = !!onPick
  const { addCombatant } = useCombatStore()
  const { parties } = usePartyStore()

  const [creatureQuery, setCreatureQuery] = useState('')
  const [filterQuery, setFilterQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')

  const [results, setResults] = useState<IndexEntry[]>([])
  const [allResults, setAllResults] = useState<IndexEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [adding, setAdding] = useState<Set<string>>(new Set())
  // ── Cart-style multi-add ─────────────────────────────────────────────
  // Every click on a creature / hazard / party member appends to this list
  // (or +1's an existing entry). The "Add to Tracker" button at the end
  // commits the whole cart in one shot. Pick-mode bypasses the cart and
  // returns the loaded creature directly.
  type CartItem =
    | { kind: 'bestiary'; key: string; entry: IndexEntry; qty: number; creature?: Creature; loading?: boolean; error?: string }
    | { kind: 'custom';   key: string; creature: Creature; qty: number }
    | { kind: 'party';    key: string; player: PartyPlayer & { partyName: string } }
  const [cart, setCart] = useState<CartItem[]>([])
  // Hydrate filter + sort + collapsed-section state from localStorage on
  // first mount so reopening the modal or relaunching the app keeps the
  // configuration the user last set.
  const _persisted = useMemo(() => loadPersistedSearchState(), [])
  const [filters, setFilters] = useState<Filters>(() =>
    _persisted.filters ? { ...EMPTY_FILTERS, ...(_persisted.filters as Filters) } : EMPTY_FILTERS
  )
  const [showFilters, setShowFilters] = useState(false)
  // Globally-disabled books (Settings → Sources): their creatures are hidden
  // from results and from the source filter's pills entirely.
  const disabledSources = useSourcesStore(s => s.disabled)
  const disabledSourceSet = useMemo(() => new Set(disabledSources), [disabledSources])
  // Saved encounter tables double as "biomes" — selecting one filters the list
  // to the creatures/hazards it links.
  const encounterTables = useEncounterTablesStore(s => s.tables)
  const [hiddenSections, setHiddenSections] = useState<Set<string>>(
    () => new Set(_persisted.hiddenSections ?? [])
  )
  const [traitInput, setTraitInput] = useState('')
  const [customCreatures, setCustomCreatures] = useState<Creature[]>([])
  const [hiddenEntries, setHiddenEntries] = useState<Set<string>>(new Set())
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null)
  const [error, setError] = useState('')
  // Bigger pages so scrolling feels snappier — 200 rows still renders fast.
  const PAGE_SIZE = 200
  const [displayLimit, setDisplayLimit] = useState(PAGE_SIZE)
  const sentinelRef = useRef<HTMLDivElement>(null)
  // Ref to the scrolling results container — needed as the IntersectionObserver
  // `root` because the modal scrolls internally, not the page.
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  // Level sort cycles: off (alphabetical) → asc → desc → off
  const [levelSort, setLevelSort] = useState<'off' | 'asc' | 'desc'>(
    () => _persisted.levelSort ?? 'off'
  )
  // Sections the user has collapsed in the results list
  const [collapsedResultSections, setCollapsedResultSections] = useState<Set<string>>(
    () => new Set(_persisted.collapsedResultSections ?? [])
  )
  const toggleResultSection = (name: string) =>
    setCollapsedResultSections(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name); else next.add(name)
      return next
    })

  useEffect(() => {
    setCustomCreatures(loadCustomCreatures())
    setHiddenEntries(loadHiddenEntries())
  }, [])

  // ── Token images for search rows ──────────────────────────────────────
  // images.json is name-keyed (lowercase). Loaded once when the modal opens
  // and used to look up a small thumbnail per result row.
  const [imageMap, setImageMap] = useState<Map<string, string>>(new Map())
  useEffect(() => {
    let alive = true
    loadImages().then(m => { if (alive) setImageMap(m) }).catch(() => {})
    return () => { alive = false }
  }, [])
  /** Hover-preview popup state — coordinates anchor a larger image right
   *  next to the cursor while the user hovers a token. Cleared on leave. */
  const [hoverImg, setHoverImg] = useState<{ src: string; x: number; y: number } | null>(null)
  const openImageViewer = (src: string, name: string) => {
    if (window.electronAPI?.openImageWindow) {
      void window.electronAPI.openImageWindow(src, name, readThemeTokens())
    } else {
      window.open(src, '_blank')
    }
  }
  // Token callbacks — pulled out so the Token component (module-level) only
  // sees stable handlers, and so they can be passed without rebuilding them
  // inline at every row.
  const tokenOnOpen  = (s: string, n: string) => openImageViewer(s, n)
  const tokenOnHover = (s: string, x: number, y: number) => setHoverImg({ src: s, x, y })
  const tokenOnMove  = (x: number, y: number) => setHoverImg(h => h ? { ...h, x, y } : null)
  const tokenOnLeave = () => setHoverImg(null)

  // Track mounted state so async creature loads don't try to setState after
  // the user has closed the modal (would leak the closure).
  const mountedRef = useRef(true)
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(creatureQuery), 100)
    return () => clearTimeout(id)
  }, [creatureQuery])

  // Fetch happens only when the query changes. Filtering against the current
  // `filters` map is a separate pure derivation (below), so changing a filter
  // pill no longer triggers a re-fetch.
  useEffect(() => {
    let cancelled = false
    setLoading(true); setError('')
    searchCreatures(debouncedQuery, 5000).then(res => {
      if (cancelled) return
      setAllResults(res)
      setLoading(false)
    }).catch(() => {
      if (cancelled) return
      setError('Data not loaded. Run: npm run setup-data')
      setAllResults([])
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [debouncedQuery])

  // Creatures from books switched off in Settings → Sources drop out FIRST, so
  // every derivation below — results, range-slider bounds, the trait / immunity
  // / weakness / resistance / spell-type facet pills, and the source pills —
  // sees only enabled-book creatures.
  const sourcedResults = useMemo(
    () => allResults.filter(e => !disabledSourceSet.has(cleanSource(e.source))),
    [allResults, disabledSourceSet],
  )

  // Lowercased name-set of the selected biome's linked stat blocks (null = no
  // biome filter). Derived from the chosen encounter table.
  const biomeNames = useMemo<Set<string> | null>(() => {
    if (!filters.biome) return null
    const t = encounterTables.find(x => x.id === filters.biome)
    if (!t) return null
    const set = new Set<string>()
    for (const e of [...t.creatures, ...t.hazards]) if (e.creature?.name) set.add(e.creature.name.toLowerCase())
    return set
  }, [filters.biome, encounterTables])

  // Re-filter when the sourced set or filters change. O(n) over the index — fast.
  useEffect(() => {
    setResults(sourcedResults.filter(e => passesFilters(e, filters, cleanSource(e.source), biomeNames)))
  }, [sourcedResults, filters, biomeNames])

  useEffect(() => { setDisplayLimit(PAGE_SIZE) }, [debouncedQuery, filters])

  // Infinite-scroll observer. Crucially the `root` is the scrolling results
  // container, NOT the viewport — otherwise the sentinel never reports
  // "intersecting" when it scrolls into view inside the modal.
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver(es => {
      if (es[0].isIntersecting) {
        // Bump by a larger chunk so the user gets a noticeable jump instead
        // of a single page that immediately demands another fetch.
        setDisplayLimit(l => l + PAGE_SIZE)
      }
    }, {
      root: scrollContainerRef.current,
      rootMargin: '400px',  // start loading well before the user reaches it
      threshold: 0,
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [results.length, displayLimit])

  // ── Bounds for range sliders, derived once from the index ────────────────
  const bounds = useMemo<Bounds>(() => {
    let lvlMin =  99, lvlMax = -99
    let spdMax = 0, dcMax = 0, slMax = 0
    for (const e of sourcedResults) {
      if (e.level < lvlMin) lvlMin = e.level
      if (e.level > lvlMax) lvlMax = e.level
      if ((e.maxSpeed ?? 0) > spdMax) spdMax = e.maxSpeed!
      if ((e.spellDC ?? 0) > dcMax) dcMax = e.spellDC!
      if ((e.spellLvl ?? 0) > slMax) slMax = e.spellLvl!
    }
    if (lvlMin === 99)  lvlMin = -1
    if (lvlMax === -99) lvlMax = 25
    return {
      level:   { min: lvlMin, max: lvlMax },
      speed:   { min: 0,      max: Math.max(60, spdMax) },
      spellDC: { min: 0,      max: Math.max(20, dcMax) },
      spellLvl:{ min: 0,      max: Math.max(10, slMax) },
    }
  }, [sourcedResults])

  // ── Sources: include bestiary + custom-creature sources, with Homebrew first ─
  const customSourceSet = useMemo(() => {
    const set = new Set<string>(['Homebrew'])
    for (const c of customCreatures) {
      const s = cleanSource(c.source ?? '')
      if (s) set.add(s)
    }
    return set
  }, [customCreatures])

  const sourceOptions = useMemo(() => {
    const set = new Set<string>()
    for (const e of sourcedResults) if (e.source) set.add(cleanSource(e.source))
    for (const s of customSourceSet) set.add(s)
    const arr = Array.from(set)
    // Homebrew/custom sources first (alphabetised), then everything else.
    const customs = arr.filter(s => customSourceSet.has(s)).sort((a, b) => {
      if (a === 'Homebrew') return -1
      if (b === 'Homebrew') return 1
      return a.localeCompare(b)
    })
    // Disabled books are already gone from sourcedResults, so they never reach
    // the source pills.
    const rest = arr.filter(s => !customSourceSet.has(s)).sort()
    return [...customs, ...rest]
  }, [sourcedResults, customSourceSet])

  // Default-select sources: any source the user has never touched gets 'yes'
  // by default. We keep "off" stored explicitly in the map (rather than deleting
  // the key) so we know which sources the user has actively cleared and don't
  // re-enable them. New sources discovered later (e.g. when the user creates a
  // custom creature with a brand-new source) are auto-enabled too.
  useEffect(() => {
    setFilters(f => {
      let changed = false
      const next = { ...f.sources }
      for (const s of sourceOptions) {
        if (!(s in next)) { next[s] = 'yes'; changed = true }
      }
      return changed ? { ...f, sources: next } : f
    })
  }, [sourceOptions])

  // Persist filter / sort / collapsed-section state on any change so the
  // search modal remembers everything across close/reopen and across app
  // restarts. localStorage write is cheap (~few KB) — no debounce needed.
  useEffect(() => {
    savePersistedSearchState({
      filters,
      levelSort,
      hiddenSections: [...hiddenSections],
      collapsedResultSections: [...collapsedResultSections],
    })
  }, [filters, levelSort, hiddenSections, collapsedResultSections])

  // ── Trait grouping ──────────────────────────────────────────────────────
  const traitsByCategory = useMemo(() => {
    const present = new Set<string>()
    for (const e of sourcedResults) for (const t of e.traits ?? []) present.add(t)
    const buckets: Record<string, string[]> = {}
    for (const cat of Object.keys(TRAIT_CATEGORIES)) buckets[cat] = []
    buckets.General = []
    for (const t of present) {
      const cat = categorizeTrait(t)
      if (!buckets[cat]) buckets[cat] = []
      buckets[cat].push(t)
    }
    for (const [cat, list] of Object.entries(TRAIT_CATEGORIES)) {
      const set = new Set(buckets[cat])
      for (const t of list) if (!set.has(t)) buckets[cat].push(t)
    }
    for (const cat of Object.keys(buckets)) buckets[cat].sort((a, b) => a.localeCompare(b))
    return buckets
  }, [sourcedResults])

  // ── Pre-computed sets for the new filter sections ───────────────────────
  const allImmunities = useMemo(() => {
    const set = new Set<string>()
    for (const e of sourcedResults) for (const v of e.immunities ?? []) set.add(v)
    return Array.from(set).sort()
  }, [sourcedResults])
  const allWeaknesses = useMemo(() => {
    const set = new Set<string>()
    for (const e of sourcedResults) for (const v of e.weaknesses ?? []) set.add(v)
    return Array.from(set).sort()
  }, [sourcedResults])
  const allResistances = useMemo(() => {
    const set = new Set<string>()
    for (const e of sourcedResults) for (const v of e.resistances ?? []) set.add(v)
    return Array.from(set).sort()
  }, [sourcedResults])
  const allSpellTypesPresent = useMemo(() => {
    const set = new Set<string>()
    for (const e of sourcedResults) for (const v of e.spellTypes ?? []) set.add(v)
    // Always show canonical types even if absent from the current filtered set
    for (const t of SPELL_TYPES) set.add(t)
    return Array.from(set).sort()
  }, [sourcedResults])

  // ── Filter the visible filter pills by the in-panel search ───────────────
  // Inline filter matching so the useMemos below only re-run when their actual
  // data changes (sourceOptions, traitsByCategory) or the query changes —
  // not whenever a useCallback identity is replaced.
  const lowerFilterQuery = filterQuery.trim().toLowerCase()
  const matchesFilterQuery = (label: string) =>
    !lowerFilterQuery || label.toLowerCase().includes(lowerFilterQuery)

  const visibleSources = useMemo(
    () => sourceOptions.filter(s => !lowerFilterQuery || s.toLowerCase().includes(lowerFilterQuery)),
    [sourceOptions, lowerFilterQuery],
  )
  const visibleTraitsByCategory = useMemo(() => {
    const out: Record<string, string[]> = {}
    for (const [cat, list] of Object.entries(traitsByCategory)) {
      const filtered = !lowerFilterQuery
        ? list
        : list.filter(t => t.toLowerCase().includes(lowerFilterQuery))
      if (filtered.length) out[cat] = filtered
    }
    return out
  }, [traitsByCategory, lowerFilterQuery])

  // True when the current filter-panel search has at least one pill / option
  // somewhere — used to show a "no filters match" fallback when everything
  // is hidden. Computed broadly so it covers every section type rendered
  // in the panel below.
  const anyFilterMatches = !lowerFilterQuery || (
    visibleSources.length > 0 ||
    Object.keys(visibleTraitsByCategory).length > 0 ||
    allImmunities.some(matchesFilterQuery) ||
    allWeaknesses.some(matchesFilterQuery) ||
    allResistances.some(matchesFilterQuery) ||
    SPEED_TYPES.some(matchesFilterQuery) ||
    allSpellTypesPresent.some(matchesFilterQuery) ||
    SIMILAR_CLASSES.some(matchesFilterQuery) ||
    // Range-section titles + Kind options can also produce a visible section
    ['level', 'speed', 'highest spell level', 'spell dc', 'source', 'kind', 'general', 'all', 'creature', 'hazard', 'similar class']
      .some(t => t.includes(lowerFilterQuery))
  )

  const allMembers: (PartyPlayer & { partyName: string })[] = parties.flatMap(p =>
    p.players.map(pl => ({ ...pl, partyName: p.name }))
  )
  const matchingMembers = allMembers.filter(pl =>
    !creatureQuery || pl.name.toLowerCase().includes(creatureQuery.toLowerCase())
  )
  const suppressedNames = new Set(
    matchingMembers
      .filter(pl => pl.memberType === 'npc' && pl.creature &&
        pl.name.toLowerCase() === pl.creature.name.toLowerCase())
      .map(pl => pl.creature!.name.toLowerCase())
  )

  // ── Cart helpers ─────────────────────────────────────────────────────
  // Each click on a result row either appends a fresh CartItem or +1's an
  // existing one (matched by `key`). The bestiary case kicks off an async
  // creature load in the background so Add-All can run instantly later.
  const cartKeyForEntry  = (e: IndexEntry) => `bestiary::${e.file}::${e.name}`
  const cartKeyForCustom = (c: Creature)   => `custom::${c.id}`
  const cartKeyForParty  = (pl: PartyPlayer) => `party::${pl.id}`

  const addEntryToCart = (entry: IndexEntry) => {
    const key = cartKeyForEntry(entry)
    setCart(prev => {
      const idx = prev.findIndex(c => c.key === key)
      if (idx >= 0) {
        const next = [...prev]
        const item = next[idx]
        if (item.kind === 'bestiary' || item.kind === 'custom') {
          next[idx] = { ...item, qty: item.qty + 1 }
        }
        return next
      }
      return [...prev, { kind: 'bestiary', key, entry, qty: 1, loading: true }]
    })
    // Fire the load; result is patched into the cart entry. Safe even if
    // the user closed the modal — we just no-op via mountedRef.
    loadCreature(entry)
      .then(c => {
        if (!mountedRef.current) return
        setCart(prev => prev.map(it =>
          it.key === key && it.kind === 'bestiary' ? { ...it, creature: c, loading: false } : it
        ))
      })
      .catch(() => {
        if (!mountedRef.current) return
        setCart(prev => prev.map(it =>
          it.key === key && it.kind === 'bestiary' ? { ...it, loading: false, error: 'Load failed' } : it
        ))
      })
  }
  const addCustomToCart = (creature: Creature) => {
    const key = cartKeyForCustom(creature)
    setCart(prev => {
      const idx = prev.findIndex(c => c.key === key)
      if (idx >= 0) {
        const next = [...prev]
        const item = next[idx]
        if (item.kind === 'custom') next[idx] = { ...item, qty: item.qty + 1 }
        return next
      }
      return [...prev, { kind: 'custom', key, creature, qty: 1 }]
    })
  }
  const addPartyToCart = (pl: PartyPlayer & { partyName: string }) => {
    const key = cartKeyForParty(pl)
    setCart(prev => prev.some(c => c.key === key) ? prev : [...prev, { kind: 'party', key, player: pl }])
  }

  const incCart = (key: string) => setCart(prev => prev.map(it =>
    it.key === key && (it.kind === 'bestiary' || it.kind === 'custom') ? { ...it, qty: it.qty + 1 } : it
  ))
  const decCart = (key: string) => setCart(prev => {
    const next: CartItem[] = []
    for (const it of prev) {
      if (it.key === key && (it.kind === 'bestiary' || it.kind === 'custom')) {
        if (it.qty <= 1) continue   // drop entirely when going below 1
        next.push({ ...it, qty: it.qty - 1 })
      } else {
        next.push(it)
      }
    }
    return next
  })
  const removeCart = (key: string) =>
    setCart(prev => prev.filter(it => it.key !== key))
  const clearCart = () => setCart([])

  const cartKeys = useMemo(() => new Set(cart.map(c => c.key)), [cart])
  const cartTotalUnits = useMemo(() =>
    cart.reduce((n, it) => n + (it.kind === 'party' ? 1 : it.qty), 0),
  [cart])
  const cartAnyLoading = cart.some(it => it.kind === 'bestiary' && it.loading)
  /** Cart key for any row in the unified results list — handles both the
   *  bestiary case and the "custom::<id>" file prefix. */
  const cartKeyOfRow = (entry: IndexEntry) =>
    entry.file.startsWith('custom::') ? entry.file : cartKeyForEntry(entry)
  /** How many of this row are currently sitting in the cart (0 = none). */
  const cartQtyOf = (key: string) => {
    const it = cart.find(c => c.key === key)
    if (!it) return 0
    return it.kind === 'party' ? 1 : it.qty
  }

  /** Resolve a token image URL for any result row (bestiary or custom). */
  const imageFor = (entry: IndexEntry): string | undefined => {
    if (entry.file.startsWith('custom::')) {
      const id = entry.file.slice('custom::'.length)
      return customById.get(id)?.image
    }
    return imageMap.get(entry.name.toLowerCase())
  }
  // Note: the Token component itself lives at module scope (above) so it
  // stays a stable React type across renders — otherwise every mousemove
  // remounted the <img> and swallowed the mouseleave that should clear
  // the hover popup.

  /** Commit the entire cart to the combat tracker and close. */
  const addAll = () => {
    if (cart.length === 0) return
    for (const it of cart) {
      if (it.kind === 'bestiary') {
        // If the creature is still loading we kick off a fresh load and let
        // the addCombatant call land asynchronously — the same fire-and-forget
        // pattern the previous single-add path used.
        const qty = it.qty
        if (it.creature) addCombatant(it.creature, { count: qty })
        else void loadCreature(it.entry).then(c => addCombatant(c, { count: qty })).catch(() => {})
      } else if (it.kind === 'custom') {
        addCombatant(it.creature, { count: it.qty })
      } else {
        // Party member — single instance, original signature.
        const pl = it.player
        if (pl.memberType === 'npc') addCombatant(pl.creature ?? null, { name: pl.name, isPC: false })
        else addCombatant(null, { name: pl.name, isPC: true, maxHP: pl.pcStats?.maxHP })
      }
    }
    onClose()
  }

  const handleAddPartyMember = (pl: PartyPlayer & { partyName: string }) => {
    if (pickMode) return    // pick-mode never adds party members
    addPartyToCart(pl)
  }

  const handleAdd = (entry: IndexEntry) => {
    // Pick mode — load the creature and hand it back to the caller (no cart).
    if (pickMode) {
      setAdding(prev => new Set(prev).add(entry.name))
      loadCreature(entry)
        .then(c => { onPick!(c); onClose() })
        .catch(() => { if (mountedRef.current) setError(`Failed to load ${entry.name}`) })
        .finally(() => {
          if (!mountedRef.current) return
          setAdding(prev => { const n = new Set(prev); n.delete(entry.name); return n })
        })
      return
    }
    addEntryToCart(entry)
  }

  const handleAddCustom = (creature: Creature) => {
    if (pickMode) { onPick!(creature); onClose(); return }
    addCustomToCart(creature)
  }

  const handleDelete = (menu: CtxMenu) => {
    if (menu.kind === 'custom') {
      deleteCustomCreature(menu.creature.id)
      setCustomCreatures(prev => prev.filter(c => c.id !== menu.creature.id))
    } else {
      const key = `${menu.entry.file}::${menu.entry.name}`
      hideEntry(key)
      setHiddenEntries(prev => new Set([...prev, key]))
    }
    setCtxMenu(null)
  }

  // ── Filter mutators ──────────────────────────────────────────────────────
  // For 'sources' we keep 'off' stored explicitly so the auto-enable effect
  // doesn't immediately re-add any source the user just turned off.
  const cycleIn = (cat: keyof Filters, key: string) => {
    setFilters(f => {
      const map = f[cat] as Record<string, TriState>
      const cur = map[key] ?? 'off'
      const next = nextTri(cur)
      const newMap = { ...map }
      if (cat === 'sources') {
        newMap[key] = next
      } else if (next === 'off') {
        delete newMap[key]
      } else {
        newMap[key] = next
      }
      return { ...f, [cat]: newMap }
    })
  }
  const setBatch = (cat: keyof Filters, keys: string[], state: TriState) => {
    setFilters(f => {
      const map = { ...(f[cat] as Record<string, TriState>) }
      for (const k of keys) {
        if (cat === 'sources') {
          map[k] = state
        } else if (state === 'off') {
          delete map[k]
        } else {
          map[k] = state
        }
      }
      return { ...f, [cat]: map }
    })
  }
  const addTraitFilter = () => {
    const t = traitInput.trim()
    if (!t) return
    setFilters(f => f.traits[t] ? f : { ...f, traits: { ...f.traits, [t]: 'yes' } })
    setTraitInput('')
  }

  // Master Reset: all sources to "yes", everything else cleared.
  const handleMasterReset = () => {
    const allSources: Record<string, TriState> = {}
    for (const s of sourceOptions) allSources[s] = 'yes'
    setFilters({ ...EMPTY_FILTERS, sources: allSources })
    setHiddenSections(new Set())
    setFilterQuery('')
  }

  const allSectionKeys = useMemo(
    () => ['Source', 'Level', ...Object.keys(TRAIT_CATEGORIES), 'General',
           'Immunities', 'Weaknesses', 'Resistances', 'Speed', 'Speed Types',
           'Spellcasting Type', 'Highest Spell Level', 'Spell DC', 'Similar Class'],
    [],
  )
  const handleHideAll = () => setHiddenSections(new Set(allSectionKeys))
  const handleShowAll = () => setHiddenSections(new Set())
  const toggleHide = (sec: string) =>
    setHiddenSections(prev => {
      const n = new Set(prev); n.has(sec) ? n.delete(sec) : n.add(sec); return n
    })

  const totalActiveCount = totalActive(filters, bounds)

  const visibleResults = results.filter(e =>
    !hiddenEntries.has(`${e.file}::${e.name}`) && !suppressedNames.has(e.name.toLowerCase())
  )
  // Treat every custom creature as a regular index entry — they get sorted
  // and bucketed (Creatures vs Hazards) alongside the bestiary, with no
  // special "Custom" section. We also build an id-→-creature map so the row
  // click handler can resolve the saved Creature object.
  const customById = useMemo(() => {
    const m = new Map<string, Creature>()
    for (const c of customCreatures) m.set(c.id, c)
    return m
  }, [customCreatures])

  const customAsEntries: IndexEntry[] = useMemo(() => customCreatures.map(c => ({
    name: c.name,
    level: c.level,
    traits: c.traits,
    source: c.source,
    file: `custom::${c.id}`,
    isHazard: c.isHazard,
    immunities: c.defenses?.immunities ?? [],
    weaknesses: (c.defenses?.weaknesses ?? []).map(w => typeof w === 'string' ? w : (w as { name: string }).name),
    resistances: (c.defenses?.resistances ?? []).map(r => typeof r === 'string' ? r : (r as { name: string }).name),
    speedTypes: Object.keys(c.speed ?? {}).filter(k => (c.speed as Record<string, number>)?.[k] > 0)
      .map(k => k.charAt(0).toUpperCase() + k.slice(1)),
    maxSpeed: Math.max(0, ...Object.values(c.speed ?? {}).filter(v => typeof v === 'number')),
  })), [customCreatures])

  const visibleCustomEntries = customAsEntries.filter(e => {
    if (creatureQuery && !e.name.toLowerCase().includes(creatureQuery.toLowerCase())) return false
    if (suppressedNames.has(e.name.toLowerCase())) return false
    return passesFilters(e, filters, cleanSource(e.source), biomeNames)
  })

  // Merge bestiary + custom into one sorted list, then split into Creatures vs Hazards.
  const combinedEntries = useMemo(() => {
    const all = [...visibleResults, ...visibleCustomEntries]
    const byName  = (a: IndexEntry, b: IndexEntry) => a.name.localeCompare(b.name)
    const byLevel = (dir: 1 | -1) => (a: IndexEntry, b: IndexEntry) =>
      (a.level - b.level) * dir || byName(a, b)
    if (levelSort === 'asc')  return [...all].sort(byLevel(1))
    if (levelSort === 'desc') return [...all].sort(byLevel(-1))
    return [...all].sort(byName)
  }, [visibleResults, visibleCustomEntries, levelSort])

  const creatureEntries = combinedEntries.filter(e => !e.isHazard)
  const hazardEntries   = combinedEntries.filter(e => e.isHazard)

  // Click handler — dispatches custom or bestiary based on entry.file prefix
  const handleEntryClick = (entry: IndexEntry) => {
    if (entry.file.startsWith('custom::')) {
      const id = entry.file.slice('custom::'.length)
      const c = customById.get(id)
      if (c) handleAddCustom(c)
      return
    }
    handleAdd(entry)
  }
  const handleEntryContext = (entry: IndexEntry, e: React.MouseEvent) => {
    e.preventDefault()
    if (entry.file.startsWith('custom::')) {
      const id = entry.file.slice('custom::'.length)
      const c = customById.get(id)
      if (c) setCtxMenu({ kind: 'custom', x: e.clientX, y: e.clientY, creature: c })
    } else {
      setCtxMenu({ kind: 'bestiary', x: e.clientX, y: e.clientY, entry })
    }
  }

  // Level-sort cycle button: off → asc → desc → off
  const cycleLevelSort = () => {
    setLevelSort(s => s === 'off' ? 'asc' : s === 'asc' ? 'desc' : 'off')
  }
  const sortLabel = levelSort === 'asc' ? 'Level ↑' : levelSort === 'desc' ? 'Level ↓' : 'Sort by Level'

  const rowBase: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '7px 12px', borderBottom: 'var(--app-bw) solid var(--border)',
    cursor: 'pointer', transition: 'background 0.1s',
  }
  const sectionHeaderS: React.CSSProperties = {
    padding: '5px 12px', fontSize: 11, fontWeight: 700, color: 'var(--accent)',
    background: 'var(--bg-elevated)', borderBottom: 'var(--app-bw) solid var(--border)',
    position: 'sticky', top: 0,
    letterSpacing: '0.06em', textTransform: 'uppercase',
  }

  // ── Reusable section renderers ───────────────────────────────────────────
  // `baseColor` left undefined so TriPill falls back to theme tokens
  // (--accent for "yes", --danger for "no"). Pass a hex string to override.
  const renderTraitSection = (cat: string, baseColor?: string) => {
    const all = traitsByCategory[cat] ?? []
    const visible = visibleTraitsByCategory[cat] ?? []
    if (!all.length) return null
    // When the user is searching the filter panel, drop entire sections
    // that contain no matching pills — the user only wants to see categories
    // with hits.
    if (lowerFilterQuery && !visible.length) return null
    const hidden = hiddenSections.has(cat)
    const count = all.reduce((n, t) => n + (filters.traits[t] && filters.traits[t] !== 'off' ? 1 : 0), 0)
    return (
      <div key={cat} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <SectionHeader title={cat} count={count} hidden={hidden}
          onAll={() => setBatch('traits', all, 'yes')}
          onClear={() => setBatch('traits', all, 'off')}
          onNone={() => setBatch('traits', all, 'no')}
          onToggleHide={() => toggleHide(cat)} />
        {!hidden && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {visible.map(t => (
              <TriPill key={t} label={t}
                state={filters.traits[t] ?? 'off'}
                onClick={() => cycleIn('traits', t)}
                baseColor={baseColor} />
            ))}
          </div>
        )}
      </div>
    )
  }

  const renderPillSection = (
    title: string, cat: keyof Filters, all: string[], baseColor?: string,
  ) => {
    const visible = all.filter(matchesFilterQuery)
    const hidden = hiddenSections.has(title)
    const map = filters[cat] as Record<string, TriState>
    const count = activeCountIn(map)
    if (!all.length) return null
    // Hide the whole section when the filter search has no hits here.
    if (lowerFilterQuery && !visible.length) return null
    return (
      <div key={title} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <SectionHeader title={title} count={count} hidden={hidden}
          onAll={() => setBatch(cat, all, 'yes')}
          onClear={() => setBatch(cat, all, 'off')}
          onNone={() => setBatch(cat, all, 'no')}
          onToggleHide={() => toggleHide(title)} />
        {!hidden && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {visible.map(v => (
              <TriPill key={v} label={v}
                state={map[v] ?? 'off'}
                onClick={() => cycleIn(cat, v)}
                baseColor={baseColor} />
            ))}
          </div>
        )}
      </div>
    )
  }

  const renderRangeSection = (
    title: string, sectionKey: string,
    bound: { min: number; max: number },
    valMin: number | null, valMax: number | null,
    setVal: (mn: number | null, mx: number | null) => void,
  ) => {
    // Range sliders aren't searchable as filter pills — hide them whenever
    // the user is searching, unless the section title itself matches.
    if (lowerFilterQuery && !title.toLowerCase().includes(lowerFilterQuery)) return null
    const hidden = hiddenSections.has(sectionKey)
    const count = (valMin != null && valMin > bound.min ? 1 : 0)
                + (valMax != null && valMax < bound.max ? 1 : 0)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <SectionHeader title={title} count={count} hidden={hidden}
          onClear={() => setVal(null, null)}
          onToggleHide={() => toggleHide(sectionKey)} />
        {!hidden && (
          <RangeSlider min={bound.min} max={bound.max}
            valueMin={valMin} valueMax={valMax}
            onChange={setVal} />
        )}
      </div>
    )
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: 'var(--bg-panel)',
        border: 'var(--app-bw) solid var(--border-strong)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-lg)',
        padding: '0', maxWidth: 920, width: '100%',
        maxHeight: '90vh', display: 'flex', flexDirection: 'column',
        margin: '0 16px',
        overflow: 'hidden',
      }}>
        {/* Header — display font title */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '18px 22px', borderBottom: 'var(--app-bw) solid var(--border)',
        }}>
          <h2 className="page-title-display" style={{
            fontSize: 20, fontWeight: 500, fontVariationSettings: '"opsz" 72',
            color: 'var(--text)', margin: 0, letterSpacing: '-0.015em',
          }}>
            {showFilters ? 'Filters' : (title ?? 'Add Combatants')}
          </h2>
          <button className="ico-btn" style={{ width: 30, height: 30 }} onClick={onClose}>
            <XIcon size={16} />
          </button>
        </div>

        <div style={{ padding: '16px 22px', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>

        {/* Search input — switches purpose with the filter panel */}
        <div className="flex gap-2 mb-2">
          <div className="flex-1 relative">
            <SearchIcon size={13} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--accent)', pointerEvents: 'none' }} />
            <input autoFocus className="input-dark w-full"
              placeholder={showFilters ? 'Search filters...' : 'Search by name...'}
              style={{ paddingLeft: 26 }}
              value={showFilters ? filterQuery : creatureQuery}
              onChange={e => showFilters ? setFilterQuery(e.target.value) : setCreatureQuery(e.target.value)} />
            {showFilters && filterQuery && (
              <button onClick={() => setFilterQuery('')}
                title="Clear filter search"
                style={{
                  position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4,
                }}>
                <XIcon size={12} />
              </button>
            )}
          </div>
          <button
            onClick={() => setShowFilters(v => !v)}
            className="btn-secondary btn btn-sm"
            style={{
              flexShrink: 0,
              background: showFilters || totalActiveCount > 0 ? 'var(--accent-soft)' : 'transparent',
              borderColor: totalActiveCount > 0 ? 'var(--accent)' : 'var(--border-strong)',
              color: totalActiveCount > 0 ? 'var(--accent)' : 'var(--text)',
            }}
          >
            Filters {showFilters ? '▲' : '▼'}
            {totalActiveCount > 0 && (
              <span style={{
                marginLeft: 4, background: 'var(--accent)', color: 'var(--text-on-accent)',
                borderRadius: 8, padding: '0 6px', fontSize: 10, fontWeight: 800,
              }}>{totalActiveCount}</span>
            )}
          </button>
        </div>

        {/* Filter panel — fills the modal when open */}
        {showFilters && (
          <div style={{
            flex: 1, minHeight: 0,
            background: 'var(--bg-elevated)', border: 'var(--app-bw) solid var(--border)',
            borderRadius: 6, padding: '12px 14px', marginBottom: 8,
            display: 'flex', flexDirection: 'column', gap: 14,
            overflowY: 'auto',
          }}>
            {/* Toolbar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: 'var(--app-bw) solid var(--border)', paddingBottom: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--text-faded)', fontStyle: 'italic' }}>
                Click a pill to <span style={{ color: 'var(--accent)', fontWeight: 700 }}>require</span> it,
                again to <span style={{ color: 'var(--danger)', fontWeight: 700, textDecoration: 'line-through' }}>exclude</span> it,
                a third time to clear.
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={handleShowAll} className="btn-secondary btn btn-sm" style={{ fontSize: 10, padding: '2px 8px' }}>Show All</button>
                <button onClick={handleHideAll} className="btn-secondary btn btn-sm" style={{ fontSize: 10, padding: '2px 8px' }}>Hide All</button>
                <button onClick={handleMasterReset} className="btn-primary btn btn-sm" style={{ fontSize: 10, padding: '2px 10px' }}>Reset</button>
              </div>
            </div>

            {/* Fallback when the filter search hides every section. */}
            {lowerFilterQuery && !anyFilterMatches && (
              <div style={{
                fontSize: 12, color: 'var(--text-faded)', fontStyle: 'italic',
                textAlign: 'center', padding: '20px 0',
              }}>
                No filters match "{filterQuery}".
              </div>
            )}

            {/* Source — homebrew first, then by alpha */}
            {(() => {
              const cat = 'Source'
              const visible = visibleSources
              const hidden = hiddenSections.has(cat)
              const count = sourceModifiedCount(filters.sources)
              // Skip the whole Source section when the filter search has
              // no matching source names (and the title itself doesn't match).
              if (lowerFilterQuery && !visible.length && !'source'.includes(lowerFilterQuery)) return null
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <SectionHeader title={`Source (${sourceOptions.length})`} count={count} hidden={hidden}
                    onAll={() => setBatch('sources', sourceOptions, 'yes')}
                    onClear={() => setBatch('sources', sourceOptions, 'off')}
                    onNone={() => setBatch('sources', sourceOptions, 'no')}
                    onToggleHide={() => toggleHide(cat)} />
                  {!hidden && (
                    <div style={{
                      display: 'flex', flexWrap: 'wrap', gap: 4,
                      // alignContent:flex-start stops wrapped flex lines from
                      // being stretched/distributed (which broke vertical
                      // scrolling with 142 sources); overscroll-contain keeps
                      // the wheel inside this box instead of chaining to the
                      // filter panel.
                      alignContent: 'flex-start',
                      maxHeight: 160, overflowY: 'auto', overscrollBehavior: 'contain',
                      background: 'var(--bg-base)', borderRadius: 4, padding: 6,
                      border: 'var(--app-bw) solid var(--border)',
                    }}>
                      {visible.map(s => (
                        <TriPill key={s} label={s}
                          state={filters.sources[s] ?? 'off'}
                          onClick={() => cycleIn('sources', s)}
                          /* baseColor omitted — uses theme accent via TriPill */ />
                      ))}
                    </div>
                  )}
                </div>
              )
            })()}

            {/* Level (range slider) + Kind */}
            {renderRangeSection('Level', 'Level', bounds.level, filters.levelMin, filters.levelMax,
              (mn, mx) => setFilters(f => ({ ...f, levelMin: mn, levelMax: mx })))}

            {(() => {
              const hidden = hiddenSections.has('Kind')
              const count = filters.hazard !== 'all' ? 1 : 0
              // Hide the Kind dropdown when searching unless the title or one
              // of its options matches the query.
              if (lowerFilterQuery && !['kind', 'all', 'creature', 'hazard'].some(o => o.includes(lowerFilterQuery))) return null
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <SectionHeader title="Kind" count={count} hidden={hidden}
                    onClear={() => setFilters(f => ({ ...f, hazard: 'all' }))}
                    onToggleHide={() => toggleHide('Kind')} />
                  {!hidden && (
                    <select className="input-dark" style={{ fontSize: 11, padding: '2px 6px', maxWidth: 180 }}
                      value={filters.hazard}
                      onChange={e => setFilters(f => ({ ...f, hazard: e.target.value as Filters['hazard'] }))}>
                      <option value="all">All Kinds</option>
                      <option value="creature">Creatures Only</option>
                      <option value="hazard">Hazards Only</option>
                    </select>
                  )}
                </div>
              )
            })()}

            {/* Biome — restricts to the creatures linked in a saved encounter table */}
            {encounterTables.length > 0 && (() => {
              const hidden = hiddenSections.has('Biome')
              if (lowerFilterQuery && !'biome'.includes(lowerFilterQuery)
                  && !encounterTables.some(t => t.name.toLowerCase().includes(lowerFilterQuery))) return null
              const sel = encounterTables.some(t => t.id === filters.biome) ? filters.biome! : ''
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <SectionHeader title="Biome" count={sel ? 1 : 0} hidden={hidden}
                    onClear={() => setFilters(f => ({ ...f, biome: null }))}
                    onToggleHide={() => toggleHide('Biome')} />
                  {!hidden && (
                    <select className="input-dark" style={{ fontSize: 11, padding: '2px 6px', maxWidth: 220 }}
                      value={sel}
                      onChange={e => setFilters(f => ({ ...f, biome: e.target.value || null }))}>
                      <option value="">Any biome</option>
                      {encounterTables.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  )}
                </div>
              )
            })()}

            {/* Trait subcategories (two columns) */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              {renderTraitSection('Rarity', '#c08856')}
              {renderTraitSection('Alignment', '#9a8a7a')}
              {renderTraitSection('Size', '#7da8c8')}
              {renderTraitSection('Creature Type', '#a07810')}
              {renderTraitSection('Energy & Element', '#d09050')}
              {renderTraitSection('Effect', '#c89858')}
              {renderTraitSection('Tradition', '#9078d0')}
              {renderTraitSection('Hazard', '#c48030')}
            </div>

            {renderTraitSection('Creature', '#a07810')}

            {/* Defenses */}
            {renderPillSection('Immunities',  'immunities',  allImmunities,  '#6aa078')}
            {renderPillSection('Weaknesses',  'weaknesses',  allWeaknesses,  '#c87878')}
            {renderPillSection('Resistances', 'resistances', allResistances, '#7da8c8')}

            {/* Speed */}
            {renderRangeSection('Speed', 'Speed', bounds.speed, filters.speedMin, filters.speedMax,
              (mn, mx) => setFilters(f => ({ ...f, speedMin: mn, speedMax: mx })))}
            {renderPillSection('Speed Types', 'speedTypes', [...SPEED_TYPES], '#7da8c8')}

            {/* Spellcasting */}
            {renderPillSection('Spellcasting Type', 'spellTypes', allSpellTypesPresent, '#9078d0')}
            {renderRangeSection('Highest Spell Level', 'Highest Spell Level', bounds.spellLvl,
              filters.spellLvlMin, filters.spellLvlMax,
              (mn, mx) => setFilters(f => ({ ...f, spellLvlMin: mn, spellLvlMax: mx })))}
            {renderRangeSection('Spell DC', 'Spell DC', bounds.spellDC,
              filters.spellDcMin, filters.spellDcMax,
              (mn, mx) => setFilters(f => ({ ...f, spellDcMin: mn, spellDcMax: mx })))}

            {/* Experimental — hidden tag set per humanoid by
                scripts/classify-similar-classes.mjs. Useful when looking
                for "a Fighter-flavoured NPC" or "any Cleric". */}
            {renderPillSection('Similar Class', 'similarClasses', [...SIMILAR_CLASSES], '#c2956b')}

            {/* General — no inner scroll, just wraps */}
            {(() => {
              const cat = 'General'
              const all = traitsByCategory[cat] ?? []
              const visible = visibleTraitsByCategory[cat] ?? []
              const hidden = hiddenSections.has(cat)
              const count = all.reduce((n, t) => n + (filters.traits[t] && filters.traits[t] !== 'off' ? 1 : 0), 0)
              // Hide the whole General section when the filter search has no
              // hits among its traits (and the title itself doesn't match).
              if (lowerFilterQuery && !visible.length && !'general'.includes(lowerFilterQuery)) return null
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <SectionHeader title={`General (${all.length})`} count={count} hidden={hidden}
                    onAll={() => setBatch('traits', all, 'yes')}
                    onClear={() => setBatch('traits', all, 'off')}
                    onNone={() => setBatch('traits', all, 'no')}
                    onToggleHide={() => toggleHide(cat)} />
                  {!hidden && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                      <input
                        value={traitInput}
                        onChange={e => setTraitInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTraitFilter() } }}
                        placeholder="add trait + Enter"
                        className="input-dark"
                        style={{ fontSize: 11, padding: '2px 6px', width: 140 }}
                      />
                      {visible.map(t => (
                        <TriPill key={t} label={t}
                          state={filters.traits[t] ?? 'off'}
                          onClick={() => cycleIn('traits', t)} />
                      ))}
                    </div>
                  )}
                </div>
              )
            })()}

            {/* Sticky footer */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              borderTop: 'var(--app-bw) solid var(--border)', paddingTop: 8, marginTop: 'auto', flexShrink: 0 }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {visibleResults.length} match{visibleResults.length === 1 ? '' : 'es'}
              </span>
              <button onClick={() => setShowFilters(false)}
                className="btn-primary btn btn-sm"
                style={{ fontSize: 11, padding: '3px 16px' }}>
                Done
              </button>
            </div>
          </div>
        )}

        {/* ── Cart bar ─ shows every result the user has clicked, with per-item
              quantity controls + a single "Add to Tracker" button that commits
              the whole cart at once. Hidden in pick-mode (single-pick flow). */}
        {!showFilters && !pickMode && cart.length > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 10px', marginBottom: 8,
            background: 'var(--bg-elevated)',
            border: 'var(--app-bw) solid var(--accent-line)',
            borderRadius: 'var(--radius-sm)',
          }}>
            {/* Horizontally-scrolling chip strip — caps the row height so the
                modal stays predictable even with many cart entries. */}
            <div style={{
              display: 'flex', gap: 6, flexWrap: 'wrap',
              flex: 1, minWidth: 0,
              maxHeight: 86, overflowY: 'auto',
            }}>
              {cart.map(it => {
                const label = it.kind === 'bestiary' ? it.entry.name
                  : it.kind === 'custom' ? it.creature.name
                  : it.player.name
                const isParty = it.kind === 'party'
                const qty = isParty ? 1 : it.qty
                const isLoading = it.kind === 'bestiary' && it.loading
                const hasErr   = it.kind === 'bestiary' && !!it.error
                return (
                  <div key={it.key}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      padding: '2px 4px 2px 8px',
                      background: hasErr ? 'var(--danger-soft)' : 'var(--bg-panel)',
                      border: `var(--app-bw) solid ${hasErr ? 'var(--danger)' : 'var(--border-strong)'}`,
                      borderRadius: 'var(--radius-full)',
                      fontSize: 11.5, color: 'var(--text)',
                      fontFamily: 'var(--font-ui)',
                    }}
                    title={hasErr ? it.error : (isLoading ? 'Loading creature…' : label)}
                  >
                    {isParty && (
                      <span style={{
                        fontSize: 8.5, padding: '0 4px', borderRadius: 3,
                        background: it.player.memberType === 'pc' ? 'var(--accent-soft)' : 'var(--linked-soft)',
                        color: it.player.memberType === 'pc' ? 'var(--accent)' : 'var(--linked)',
                        border: `var(--app-bw) solid ${it.player.memberType === 'pc' ? 'var(--accent-line)' : 'var(--linked)'}`,
                        fontWeight: 700, letterSpacing: '0.06em',
                      }}>{it.player.memberType === 'pc' ? 'PC' : 'NPC'}</span>
                    )}
                    <span style={{ maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>
                      {label}
                    </span>
                    {isLoading && <span style={{ fontSize: 9.5, color: 'var(--text-faded)', fontStyle: 'italic' }}>loading…</span>}
                    {!isParty && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, marginLeft: 4 }}>
                        <button onClick={() => decCart(it.key)}
                          title="Decrease (or remove)"
                          style={{
                            width: 18, height: 18, border: 'var(--app-bw) solid var(--border-strong)',
                            background: 'var(--bg-elevated)', color: 'var(--text-muted)',
                            borderRadius: 3, cursor: 'pointer', fontSize: 12, lineHeight: 1,
                            padding: 0, display: 'grid', placeItems: 'center',
                          }}>−</button>
                        <span style={{
                          minWidth: 16, textAlign: 'center',
                          fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', fontWeight: 700,
                        }}>{qty}</span>
                        <button onClick={() => incCart(it.key)}
                          title="Increase"
                          style={{
                            width: 18, height: 18, border: 'var(--app-bw) solid var(--border-strong)',
                            background: 'var(--bg-elevated)', color: 'var(--text-muted)',
                            borderRadius: 3, cursor: 'pointer', fontSize: 12, lineHeight: 1,
                            padding: 0, display: 'grid', placeItems: 'center',
                          }}>+</button>
                      </span>
                    )}
                    <button onClick={() => removeCart(it.key)}
                      title="Remove from cart"
                      style={{
                        width: 18, height: 18,
                        border: 'var(--app-bw) solid transparent',
                        background: 'transparent', color: 'var(--danger)',
                        borderRadius: 3, cursor: 'pointer', fontSize: 13, lineHeight: 1,
                        padding: 0, marginLeft: 2,
                        display: 'grid', placeItems: 'center',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--danger-soft)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >×</button>
                  </div>
                )
              })}
            </div>
            {/* Cart actions — Add All (primary) + Clear */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <button onClick={clearCart}
                className="btn btn-secondary btn-sm"
                style={{ fontSize: 10.5, padding: '4px 10px' }}
                title="Empty the cart">Clear</button>
              <button onClick={addAll}
                disabled={cartAnyLoading && cart.every(it => it.kind === 'bestiary' && !it.creature)}
                className="btn btn-primary btn-sm"
                style={{
                  fontSize: 11.5, padding: '5px 14px',
                  opacity: cartAnyLoading && cart.every(it => it.kind === 'bestiary' && !it.creature) ? 0.6 : 1,
                }}
                title={cartAnyLoading ? 'Still loading some creatures — Add All will wait or skip' : 'Add every cart entry to the tracker'}
              >Add to Tracker ({cartTotalUnits})</button>
            </div>
          </div>
        )}

        {/* Sort + match count — replaces the old Count row */}
        {!showFilters && <div className="flex items-center gap-2 mb-2 text-xs">
          <span style={{ color: 'var(--text-faded)', fontSize: 10 }}>
            {combinedEntries.length} match{combinedEntries.length === 1 ? '' : 'es'}
          </span>
          <button
            className="btn btn-sm ml-auto"
            onClick={cycleLevelSort}
            title="Click to cycle: Alphabetical → Level ↑ → Level ↓ → Alphabetical"
            style={levelSort !== 'off' ? {
              background: 'var(--accent-soft)',
              borderColor: 'var(--accent-line)',
              color: 'var(--accent)',
              fontFamily: 'var(--font-mono)',
            } : { fontFamily: 'var(--font-mono)' }}
          >{sortLabel}</button>
        </div>}

        {!showFilters && error && (
          <div style={{ background: 'var(--danger-soft)', border: 'var(--app-bw) solid var(--danger)', borderRadius: 'var(--radius-sm)', color: 'var(--danger)', fontSize: 12, padding: '7px 12px', marginBottom: 10 }}>
            {error}
          </div>
        )}

        {/* Results */}
        {!showFilters && <div ref={scrollContainerRef} className="overflow-y-auto flex-1 rounded" style={{ border: 'var(--app-bw) solid var(--border)' }}>
          {loading && <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 13 }}>Searching…</div>}

          {/* ── Party Members section (hidden in pick-mode — we're choosing a
                stat block for a member, not enlisting other members) ────── */}
          {!pickMode && matchingMembers.length > 0 && (() => {
            const name = 'Party Members'
            const collapsed = collapsedResultSections.has(name)
            return (<>
              <div style={{ ...sectionHeaderS, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                onClick={() => toggleResultSection(name)}
                title={collapsed ? 'Click to expand' : 'Click to collapse'}>
                <span style={{ fontSize: 9, color: 'var(--text-faded)', width: 10, display: 'inline-block' }}>
                  {collapsed ? '▸' : '▾'}
                </span>
                {name}
                <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', color: 'var(--text-faded)', fontSize: 10 }}>
                  {matchingMembers.length}
                </span>
              </div>
              {!collapsed && matchingMembers.map(pl => {
                const inCart = cartKeys.has(cartKeyForParty(pl))
                // Party NPC creatures may carry their own image (or fall back
                // to the bestiary image-map by name). PCs typically don't.
                const img = pl.creature?.image
                  ?? (pl.creature ? imageMap.get(pl.creature.name.toLowerCase()) : undefined)
                  ?? imageMap.get(pl.name.toLowerCase())
                return (
                <div key={pl.id} style={{
                  ...rowBase,
                  background: inCart ? 'var(--accent-soft)' : undefined,
                  gap: 8,
                }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent-soft)')}
                  onMouseLeave={e => (e.currentTarget.style.background = inCart ? 'var(--accent-soft)' : '')}
                  onClick={() => handleAddPartyMember(pl)}>
                  {img && <Token src={img} name={pl.name}
                    onOpen={tokenOnOpen} onHover={tokenOnHover} onMove={tokenOnMove} onLeave={tokenOnLeave} />}
                  <div className="flex items-center gap-2 min-w-0" style={{ flex: 1 }}>
                    {pl.memberType === 'npc'
                      ? <span style={{ fontSize: 9, padding: '1px 5px', background: 'var(--linked-soft)', border: 'var(--app-bw) solid var(--linked)', color: 'var(--linked)', borderRadius: 3, fontWeight: 700, flexShrink: 0, letterSpacing: '0.08em' }}>NPC</span>
                      : <span style={{ fontSize: 9, padding: '1px 5px', background: 'var(--accent-soft)', border: 'var(--app-bw) solid var(--accent-line)', color: 'var(--accent)', borderRadius: 3, fontWeight: 700, flexShrink: 0, letterSpacing: '0.08em' }}>PC</span>}
                    <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }} className="truncate">{pl.name}</span>
                    {pl.memberType === 'npc' && pl.creature && pl.creature.name !== pl.name && (
                      <span style={{ fontSize: 11, color: 'var(--accent)' }}>→ {pl.creature.name}</span>
                    )}
                    {inCart && <span style={{ fontSize: 10, padding: '0 5px', background: 'var(--accent)', color: 'var(--text-on-accent)', borderRadius: 3, fontWeight: 700 }}>IN CART</span>}
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0, marginLeft: 8 }}>{pl.partyName}</span>
                </div>
              )})}
            </>)
          })()}

          {/* Empty state */}
          {!loading && creatureEntries.length === 0 && hazardEntries.length === 0 && matchingMembers.length === 0 && !error && (
            <div style={{ padding: 16, color: 'var(--text-faded)', fontSize: 13, textAlign: 'center' }}>
              No results match your filters
              {totalActiveCount > 0 && (
                <button onClick={handleMasterReset}
                  style={{ marginLeft: 8, background: 'none', border: 'none', color: 'var(--accent)', textDecoration: 'underline', cursor: 'pointer', fontSize: 12 }}>
                  Reset
                </button>
              )}
            </div>
          )}

          {/* ── Creature Stat Blocks section ──────────────────────────── */}
          {creatureEntries.length > 0 && (() => {
            const name = 'Creature Stat Blocks'
            const collapsed = collapsedResultSections.has(name)
            return (<>
              <div style={{ ...sectionHeaderS, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                onClick={() => toggleResultSection(name)}
                title={collapsed ? 'Click to expand' : 'Click to collapse'}>
                <span style={{ fontSize: 9, color: 'var(--text-faded)', width: 10, display: 'inline-block' }}>
                  {collapsed ? '▸' : '▾'}
                </span>
                {name}
                <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', color: 'var(--text-faded)', fontSize: 10 }}>
                  {creatureEntries.length}
                </span>
              </div>
              {!collapsed && creatureEntries.slice(0, displayLimit).map(entry => {
                const qty = cartQtyOf(cartKeyOfRow(entry))
                const img = imageFor(entry)
                return (
                <div key={`${entry.file}::${entry.name}`} style={{
                  ...rowBase,
                  background: qty > 0 ? 'var(--accent-soft)' : undefined,
                  gap: 8,
                }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent-soft)')}
                  onMouseLeave={e => (e.currentTarget.style.background = qty > 0 ? 'var(--accent-soft)' : '')}
                  onClick={() => handleEntryClick(entry)}
                  onContextMenu={e => handleEntryContext(entry, e)}>
                  {img && <Token src={img} name={entry.name}
                    onOpen={tokenOnOpen} onHover={tokenOnHover} onMove={tokenOnMove} onLeave={tokenOnLeave} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {adding.has(entry.name)
                      ? <span style={{ color: 'var(--accent)', fontSize: 12 }}>Loading…</span>
                      : <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>{entry.name}</span>}
                    <span style={{ marginLeft: 6, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)' }}>LV {entry.level}</span>
                    {qty > 0 && <span style={{ marginLeft: 6, fontSize: 10, padding: '0 5px', background: 'var(--accent)', color: 'var(--text-on-accent)', borderRadius: 3, fontWeight: 700 }}>× {qty}</span>}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 8 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{entry.traits.slice(0, 3).join(', ')}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-faded)', fontStyle: 'italic' }}>{cleanSource(entry.source)}</div>
                  </div>
                </div>
              )})}
            </>)
          })()}

          {/* ── Hazards section ───────────────────────────────────────── */}
          {hazardEntries.length > 0 && (() => {
            const name = 'Hazards'
            const collapsed = collapsedResultSections.has(name)
            return (<>
              <div style={{ ...sectionHeaderS, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                onClick={() => toggleResultSection(name)}
                title={collapsed ? 'Click to expand' : 'Click to collapse'}>
                <span style={{ fontSize: 9, color: 'var(--text-faded)', width: 10, display: 'inline-block' }}>
                  {collapsed ? '▸' : '▾'}
                </span>
                {name}
                <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', color: 'var(--text-faded)', fontSize: 10 }}>
                  {hazardEntries.length}
                </span>
              </div>
              {!collapsed && hazardEntries.slice(0, displayLimit).map(entry => {
                const qty = cartQtyOf(cartKeyOfRow(entry))
                const img = imageFor(entry)
                return (
                <div key={`${entry.file}::${entry.name}`} style={{
                  ...rowBase,
                  background: qty > 0 ? 'var(--accent-soft)' : undefined,
                  gap: 8,
                }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent-soft)')}
                  onMouseLeave={e => (e.currentTarget.style.background = qty > 0 ? 'var(--accent-soft)' : '')}
                  onClick={() => handleEntryClick(entry)}
                  onContextMenu={e => handleEntryContext(entry, e)}>
                  {img && <Token src={img} name={entry.name}
                    onOpen={tokenOnOpen} onHover={tokenOnHover} onMove={tokenOnMove} onLeave={tokenOnLeave} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {adding.has(entry.name)
                      ? <span style={{ color: 'var(--accent)', fontSize: 12 }}>Loading…</span>
                      : <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>{entry.name}</span>}
                    <span style={{ marginLeft: 6, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)' }}>LV {entry.level}</span>
                    {qty > 0 && <span style={{ marginLeft: 6, fontSize: 10, padding: '0 5px', background: 'var(--accent)', color: 'var(--text-on-accent)', borderRadius: 3, fontWeight: 700 }}>× {qty}</span>}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 8 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{entry.traits.slice(0, 3).join(', ')}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-faded)', fontStyle: 'italic' }}>{cleanSource(entry.source)}</div>
                  </div>
                </div>
              )})}
            </>)
          })()}

          {combinedEntries.length > displayLimit && (
            <div ref={sentinelRef} style={{
              padding: 10, textAlign: 'center',
              fontFamily: 'var(--font-mono)', fontSize: 11,
              color: 'var(--text-faded)', fontStyle: 'italic',
            }}>
              Loading more… ({combinedEntries.length - displayLimit} remaining)
            </div>
          )}
        </div>}
        </div>
      </div>

      {ctxMenu && (
        <ContextMenu menu={ctxMenu} onDelete={() => handleDelete(ctxMenu)} onClose={() => setCtxMenu(null)} />
      )}

      {/* Floating hover-preview — large image anchored near the cursor.
          Pointer-events disabled so it never blocks clicks underneath. */}
      {hoverImg && (
        <div style={{
          position: 'fixed',
          left: Math.min(hoverImg.x + 18, (typeof window !== 'undefined' ? window.innerWidth : 1600) - 240),
          top:  Math.min(hoverImg.y + 18, (typeof window !== 'undefined' ? window.innerHeight : 900) - 240),
          zIndex: 10000,
          pointerEvents: 'none',
          padding: 4,
          background: 'var(--bg-panel)',
          border: 'var(--app-bw) solid var(--accent-line)',
          borderRadius: 'var(--radius-sm)',
          boxShadow: 'var(--shadow-md)',
        }}>
          <img src={hoverImg.src} alt=""
            style={{
              display: 'block',
              maxWidth: 220, maxHeight: 220,
              borderRadius: 3, objectFit: 'contain',
            }}
          />
        </div>
      )}
    </div>
  )
}
