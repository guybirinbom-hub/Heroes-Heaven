import { create } from 'zustand'
import { PC_DETAIL_ALL, PC_DETAIL_SECTIONS, type PcDetailConfig } from '../utils/pcDetail'
import { deriveThemeVars, CUSTOM_VAR_KEYS, type ThemeColors as ThemeColorsT } from '../utils/themeColors'
import { findCustomTheme } from './customThemesStore'

const STORAGE_KEY = 'pf2e-settings'

// Theme palette IDs. CSS palettes live in src/index.css under
// `:root[data-theme="..."]`. Empty string (or "tavern") = the default Tavern
// theme that lives on the bare `:root` selector.
export type ThemeId =
  | 'tavern' | 'sepia' | 'frost' | 'ember' | 'verdant' | 'arcane'
  | 'graveyard' | 'stellar' | 'midnight' | 'celestial' | 'goatval'
  | 'bloodmoon' | 'witchlight' | 'obsidian' | 'twilight' | 'glacier' | 'sandstone'

export interface ThemeMeta {
  id:    ThemeId
  name:  string
  blurb: string
  /** Swatch tuple drawn in the picker — order: accent / linked / bg-panel. */
  swatch: [string, string, string]
}

export const THEMES: ThemeMeta[] = [
  { id: 'tavern',    name: 'Tavern',        blurb: 'Warm gold on wine — the default',      swatch: ['#d4a14a', '#82a89a', '#1e1617'] },
  { id: 'sepia',     name: 'Sepia Tome',    blurb: 'Aged parchment, mid-bright leather',   swatch: ['#6b3a14', '#4a5530', '#b5a682'] },
  { id: 'graveyard', name: 'Graveyard',     blurb: 'Mossy green on charcoal slate',        swatch: ['#a8c098', '#b8a886', '#141a1f'] },
  { id: 'frost',     name: 'Frost',         blurb: 'Cool blues with cyan accents',         swatch: ['#74c5e8', '#c0a4d8', '#161e28'] },
  { id: 'stellar',   name: 'Stellar',       blurb: 'Cosmic cyan on cobalt with amber',     swatch: ['#5cd2e6', '#ffb454', '#0a1424'] },
  { id: 'midnight',  name: 'Midnight',      blurb: 'Pearl silver on deep navy',            swatch: ['#c8d0e8', '#8896b4', '#0f1118'] },
  { id: 'ember',     name: 'Ember',         blurb: 'Fiery red with bronze',                swatch: ['#e88250', '#c9b27a', '#1f1010'] },
  { id: 'verdant',   name: 'Verdant Grove', blurb: 'Druidic — moss & bark on parchment',   swatch: ['#4a6b2a', '#7a6a4a', '#f3eed8'] },
  { id: 'celestial', name: 'Celestial',     blurb: 'Illuminated manuscript — gold on cream', swatch: ['#b8862a', '#6a4a8a', '#f1e9d0'] },
  { id: 'arcane',    name: 'Arcane',        blurb: 'Royal purple with silver-violet',      swatch: ['#bea0e8', '#e8c374', '#1a1422'] },
  { id: 'goatval',   name: 'Goatval',       blurb: 'Spectral teal on haunted slate',       swatch: ['#3df0c6', '#15a883', '#15262d'] },
  { id: 'bloodmoon', name: 'Bloodmoon',     blurb: 'Gothic crimson with bone-gold',         swatch: ['#e8b873', '#e09aaa', '#1b0c0f'] },
  { id: 'witchlight',name: 'Witchlight',    blurb: 'Eldritch acid-green + lavender',         swatch: ['#a6e84a', '#cba6f0', '#111811'] },
  { id: 'obsidian',  name: 'Obsidian',      blurb: 'Neutral graphite with electric amber',   swatch: ['#f0a830', '#74b4e4', '#141518'] },
  { id: 'twilight',  name: 'Twilight',      blurb: 'Indigo dusk with apricot',               swatch: ['#ffb86b', '#a6bcf5', '#141124'] },
  { id: 'glacier',   name: 'Glacier',       blurb: 'Icy blue on near-white — light',         swatch: ['#0e6b86', '#3a5a9c', '#eaf2f7'] },
  { id: 'sandstone', name: 'Sandstone',     blurb: 'Warm linen with bronze — light',         swatch: ['#8a5a14', '#4a6a2a', '#f5efe4'] },
]

// How remaining spell slots / uses / focus points are drawn on a stat block.
export type SpellIndicator = 'diamond' | 'dot' | 'battery' | 'box' | 'ring' | 'hex'
export const SPELL_INDICATORS: { id: SpellIndicator; label: string }[] = [
  { id: 'diamond', label: 'Diamonds' },
  { id: 'dot',     label: 'Dots' },
  { id: 'battery', label: 'Battery' },
  { id: 'box',     label: 'Checks' },
  { id: 'ring',    label: 'Rings' },
  { id: 'hex',     label: 'Hexes' },
]
// How spell ranks flow: one per line, or packed as many per line as fit.
export type SpellLayout = 'rows' | 'grid'
export const SPELL_LAYOUTS: { id: SpellLayout; label: string }[] = [
  { id: 'grid', label: 'Packed' },
  { id: 'rows', label: 'Rows' },
]

// ── Stat-block layout customization ─────────────────────────────────────────
// The whole stat-block body (Perception … Abilities & Actions) is a reorderable,
// restyleable list. Order + per-item style + visibility + same-line grouping are
// edited ONLY in the settings preview; real stat blocks render read-only.
export type SbItemId =
  | 'recall' | 'perception' | 'languages' | 'skills' | 'abilities' | 'items'
  | 'defense' | 'hp' | 'immunities' | 'resistances' | 'weaknesses'
  | 'attacks' | 'spells' | 'rituals' | 'specials'

export interface SbItem {
  id: SbItemId
  /** Hidden from real stat blocks (still listed, dimmed, in the editor). */
  hidden?: boolean
  /** Per-item display variant; meaning depends on id (see SB_ITEM_META). */
  style?: string
  /** Render on the SAME line as the previous item (only honoured when both
   *  this item and the running line are inline-capable — see sbItemIsInline). */
  inline?: boolean
  /** Per-LINE horizontal gap in px between the items sharing this line, set on
   *  the line's LEADER (first item). Overrides the global sameLineGap for that
   *  one line. Undefined → fall back to lineGapPx(sameLineGap). The gap still
   *  collapses (items wrap) when the stat block is too narrow.
   *  Reused by the block items that own a gap of their own: the 'attacks' item
   *  (gap between Strikes) and the 'spells' item (gap between spell ranks). */
  gapPx?: number
  /** Fixed px width for this item's cubes (defense / abilities / perception /
   *  hp box rows). Undefined → cubes flex to fill the row (current behaviour).
   *  Set → every cube in the row is exactly this wide and wraps when narrow. */
  cubeWidth?: number
  /** 'attacks' item only: how many Strikes share a row (1–4). Overrides the
   *  global attacksPerLine. Undefined → fall back to the global. */
  perLine?: number
  /** 'spells' item only: spell-rank order. 'asc' = cantrips first then low→high
   *  (today's default); 'desc' = highest rank first, cantrips then constant
   *  last. Undefined → rendered in parse order (cantrips-first ascending). */
  spellRankOrder?: 'asc' | 'desc'
}

export interface StatBlockConfig {
  /** Body items in render order, each with its style / visibility / grouping. */
  items: SbItem[]
  /** Tighter vertical spacing throughout the stat block. */
  compact: boolean
  /** Draw the gold "Defense / Attacks / Spellcasting …" section dividers. */
  showSectionHeaders: boolean
  /** Separator id (see SB_SEPARATORS) between items merged onto one line.
   *  Legacy — kept for back-compat; merged rows now render as spaced blocks. */
  separator: string
  /** How items merged onto one line are laid out (see SB_MERGE_STYLES). */
  mergeStyle: string
  /** Legacy spell-rank-only spacing (see SB_SPELL_GAPS). Superseded by
   *  sameLineGap; kept so older saves migrate cleanly. */
  spellRankGap: string
  /** One spacing knob for everything that shares a line — merged item blocks,
   *  Strikes packed N-per-row, and spell ranks (see SB_LINE_GAPS / lineGapPx). */
  sameLineGap: string
  /** How many Strikes to pack onto one row (1–3). */
  attacksPerLine: number
}

// How items merged onto one line are laid out (the "Same line" feature).
export const SB_MERGE_STYLES: { id: string; label: string }[] = [
  { id: 'spaced',  label: 'Spaced blocks' },
  { id: 'divider', label: 'With divider' },
  { id: 'boxed',   label: 'Boxed' },
]

// Spacing presets for the gap between spell ranks in the Spellcasting block.
export const SB_SPELL_GAPS: { id: string; label: string }[] = [
  { id: 'tight',  label: 'Tight' },
  { id: 'normal', label: 'Normal' },
  { id: 'loose',  label: 'Loose' },
]
// How many Strikes share a row.
export const SB_ATTACK_COLS: { id: number; label: string }[] = [
  { id: 1, label: '1 / line' },
  { id: 2, label: '2 / line' },
  { id: 3, label: '3 / line' },
]

// One spacing scale for everything that shares a horizontal line. The same
// chosen level drives the gap between merged item blocks, between Strikes
// packed N-per-row, and between spell ranks — each scaled to suit its context
// (see lineGapPx). Five steps give fine control without a fiddly slider.
export const SB_LINE_GAPS: { id: string; label: string }[] = [
  { id: 'tight',  label: 'Tight' },
  { id: 'snug',   label: 'Snug' },
  { id: 'normal', label: 'Normal' },
  { id: 'roomy',  label: 'Roomy' },
  { id: 'loose',  label: 'Loose' },
]
const SB_GAP_BASE: Record<string, number> = { tight: 14, snug: 26, normal: 40, roomy: 60, loose: 88 }
/** Pixel gap for a same-line context at the chosen spacing level. Merged item
 *  blocks use the full base; Strikes and spell ranks are tighter (their content
 *  is smaller) so the same level reads consistently across all three. */
export function lineGapPx(level: string, ctx: 'merged' | 'attacks' | 'spells'): number {
  const b = SB_GAP_BASE[level] ?? SB_GAP_BASE.normal
  if (ctx === 'attacks') return Math.round(b * 0.5)
  if (ctx === 'spells')  return Math.round(b * 0.6)
  return b
}
/** Min column width for the packed spell-rank grid — wider gaps want wider
 *  columns so ranks don't crowd. */
export function spellColMin(level: string): number {
  return ({ tight: 150, snug: 170, normal: 186, roomy: 210, loose: 240 } as Record<string, number>)[level] ?? 186
}

// Separators offered for merged ("same line") items.
export const SB_SEPARATORS: { id: string; label: string; char: string }[] = [
  { id: 'dot',  label: 'Dot ·',       char: ' · ' },
  { id: 'semi', label: 'Semicolon ;', char: '; ' },
  { id: 'pipe', label: 'Pipe |',      char: ' | ' },
  { id: 'dash', label: 'Dash —',      char: ' — ' },
]
export const sbSeparatorChar = (id: string) => (SB_SEPARATORS.find(s => s.id === id) ?? SB_SEPARATORS[0]).char

// Passed to <StatBlock edit={…}> to turn it into the interactive editor in the
// settings page: items become click-to-select + drag-to-reorder, and dragging
// an item beside another merges them onto one line. The transient drag state
// lives inside StatBlock; this API is just the data mutations + selection.
export interface SbEditApi {
  selectedId: SbItemId | null
  onSelect: (id: SbItemId | null) => void
  onReorder: (from: number, to: number) => void
  onPatch: (id: SbItemId, patch: Partial<SbItem>) => void
  /** Drop `fromId` relative to `targetId`: on the same line ('beside'), or as
   *  its own line just before ('stack') or just after ('stack-after')
   *  `targetId`. Done in a single commit. */
  onDropMerge: (fromId: SbItemId, targetId: SbItemId, side: 'beside' | 'stack' | 'stack-after') => void
}

// Whether an item renders as inline text (joinable onto one line) vs a block
// (cubes / its own section). Depends on the chosen style. Shared by the stat
// block renderer AND the editor so the two never disagree.
export function sbItemIsInline(it: SbItem): boolean {
  switch (it.id) {
    case 'perception': return it.style !== 'box'
    case 'abilities':  return it.style !== 'boxes'
    case 'hp':         return it.style !== 'box'
    case 'recall': case 'languages': case 'skills': case 'items':
    case 'immunities': case 'resistances': case 'weaknesses': return true
    default: return false // defense, attacks, spells, specials → always a block
  }
}

// Display variants offered per item — drives the settings editor's controls.
export interface SbItemMeta { label: string; styles?: { id: string; label: string }[]; canHide: boolean }
const FULL_COMPACT = [{ id: 'full', label: 'Full' }, { id: 'compact', label: 'Compact' }]
export const SB_ITEM_META: Record<SbItemId, SbItemMeta> = {
  recall:      { label: 'Recall Knowledge', canHide: true },
  perception:  { label: 'Perception & Senses', styles: [{ id: 'text', label: 'Text' }, { id: 'box', label: 'Cube' }], canHide: true },
  languages:   { label: 'Languages', canHide: true },
  skills:      { label: 'Skills', canHide: true },
  abilities:   { label: 'Ability Scores', styles: [{ id: 'row', label: 'Row' }, { id: 'boxes', label: 'Cubes' }], canHide: true },
  items:       { label: 'Items', canHide: true },
  defense:     { label: 'AC & Saves', styles: [{ id: 'boxes', label: 'Cubes' }, { id: 'inline', label: 'One line' }], canHide: false },
  hp:          { label: 'Hit Points', styles: [{ id: 'text', label: 'Text' }, { id: 'box', label: 'Cube' }], canHide: true },
  immunities:  { label: 'Immunities', canHide: true },
  resistances: { label: 'Resistances', canHide: true },
  weaknesses:  { label: 'Weaknesses', canHide: true },
  attacks:     { label: 'Attacks (Strikes)', styles: FULL_COMPACT, canHide: true },
  spells:      { label: 'Spellcasting', canHide: true },
  rituals:     { label: 'Rituals', canHide: true },
  specials:    { label: 'Abilities & Actions', styles: FULL_COMPACT, canHide: true },
}

// Canonical order + default styles (the classic stat-block layout).
export const SB_DEFAULT_ITEMS: SbItem[] = [
  { id: 'recall' },
  { id: 'perception', style: 'text' },
  { id: 'languages' },
  { id: 'skills' },
  { id: 'abilities', style: 'row' },
  { id: 'items' },
  { id: 'defense', style: 'boxes' },
  { id: 'hp', style: 'text' },
  { id: 'immunities' },
  { id: 'resistances' },
  { id: 'weaknesses' },
  { id: 'attacks', style: 'full' },
  { id: 'spells' },
  { id: 'rituals' },
  { id: 'specials', style: 'full' },
]
const SB_ITEM_IDS = SB_DEFAULT_ITEMS.map(i => i.id)
export const STATBLOCK_DEFAULT: StatBlockConfig = {
  items: SB_DEFAULT_ITEMS, compact: false, showSectionHeaders: true, separator: 'dot',
  mergeStyle: 'spaced', spellRankGap: 'normal', sameLineGap: 'normal', attacksPerLine: 1,
}

// Rebuild a clean, complete items[] from possibly-stale/partial saved data:
// keep known ids in the user's order, drop unknowns/dupes, append any missing,
// and backfill each item's default style / clamp its visibility + grouping.
export function normalizeStatBlockItems(items: SbItem[] | undefined): SbItem[] {
  const defaultStyleFor = (id: SbItemId) => SB_DEFAULT_ITEMS.find(d => d.id === id)?.style
  const out: SbItem[] = []
  const seen = new Set<SbItemId>()
  for (const it of items ?? []) {
    if (!it || !SB_ITEM_IDS.includes(it.id) || seen.has(it.id)) continue
    seen.add(it.id)
    const meta = SB_ITEM_META[it.id]
    let style = it.style
    if (meta.styles) { if (!meta.styles.some(s => s.id === style)) style = defaultStyleFor(it.id) }
    else style = undefined
    // Carry the optional layout knobs through migration — without these they'd
    // be silently dropped on every reload (per-line spacing, cube width, etc.).
    const next: SbItem = { id: it.id, hidden: meta.canHide ? !!it.hidden : false, style, inline: !!it.inline }
    if (typeof it.gapPx === 'number') next.gapPx = it.gapPx
    if (typeof it.cubeWidth === 'number') next.cubeWidth = it.cubeWidth
    if (typeof it.perLine === 'number') next.perLine = it.perLine
    if (it.spellRankOrder === 'asc' || it.spellRankOrder === 'desc') next.spellRankOrder = it.spellRankOrder
    out.push(next)
  }
  // Splice any missing default items back in at their canonical position (the
  // slot just before the next default item that's already present), so newly
  // added items — e.g. Recall Knowledge — appear where they belong rather than
  // dumped at the end of an upgraded user's saved layout.
  for (let di = 0; di < SB_DEFAULT_ITEMS.length; di++) {
    const d = SB_DEFAULT_ITEMS[di]
    if (seen.has(d.id)) continue
    let insertAt = out.length
    for (let dj = di + 1; dj < SB_DEFAULT_ITEMS.length; dj++) {
      const pos = out.findIndex(o => o.id === SB_DEFAULT_ITEMS[dj].id)
      if (pos >= 0) { insertAt = pos; break }
    }
    out.splice(insertAt, 0, { ...d })
    seen.add(d.id)
  }
  return out
}

export interface AppSettings {
  /** Show a "Monster Parts" value + bulk next to every creature's level. */
  showMonsterParts: boolean
  /** Active colour theme — drives every CSS palette token. */
  theme: string  // a built-in ThemeId or a custom theme id ('custom-…')
  /** Show the per-turn timer chip in the top bar and record turn times. */
  turnTimerEnabled: boolean
  /** Show each creature's AC on its initiative-order card. */
  showInitAC: boolean
  /** Show each creature's Fort/Ref/Will saves on its initiative-order card. */
  showInitSaves: boolean
  /** Show the creature's level ("Lv N" tag) on its initiative-order card. */
  showInitLevel: boolean
  /** Show each PLAYER's AC + saves (from their imported/entered sheet) on its
   *  initiative-order card. Separate from the creature toggles above. */
  showInitPcDefenses: boolean
  /** Hide the mini HP bar for PLAYER characters in the initiative order (players
   *  track their own HP). Monster / NPC HP bars are unaffected. */
  hideInitPcHp: boolean
  /** Show the book/page source citation at the bottom of reference popups. */
  showSource: boolean
  /** Shape used for remaining spell slots / uses / focus points on stat blocks. */
  spellIndicator: SpellIndicator
  /** Spell-rank flow on stat blocks: 'grid' packs as many per line as fit. */
  spellLayout: SpellLayout
  /** Show a dock handle on reference popups so they can be dragged into the
   *  stat-block pane layout (where popups can stack as tabs). */
  dockablePopups: boolean
  /** Show the ⠿ block-drag button on popups (dock into the pane layout). */
  showBlockDragButton: boolean
  /** Show the tab-merge button on popups (combine popups into one tabbed window). */
  showTabDragButton: boolean
  /** Show the collapse/expand button for the initiative-order sidebar. */
  showInitCollapseButton: boolean
  /** Global default for how much of a PC's sheet is shown on party cards.
   *  Each party can override this from its own page. */
  pcDetail: PcDetailConfig
  /** How stat blocks lay out their defenses / ability scores / density. */
  statBlock: StatBlockConfig
  /** Auto-roll persistent-damage at the end of the affected creature's turn and
   *  apply it. Off by default — the GM rolls it themselves. */
  persistentDamageAutoRoll: boolean
  /** Pop a top-right reminder when a creature with persistent damage ends its
   *  turn (only when auto-roll is off — otherwise the roll itself shows). */
  persistentDamageWarn: boolean
}

const DEFAULTS: AppSettings = {
  showMonsterParts: false,
  theme: 'tavern',
  turnTimerEnabled: false,
  showInitAC: true,
  showInitSaves: true,
  showInitLevel: true,
  showInitPcDefenses: true,
  hideInitPcHp: false,
  showSource: true,
  spellIndicator: 'diamond',
  spellLayout: 'grid',
  dockablePopups: true,
  showBlockDragButton: true,
  showTabDragButton: true,
  showInitCollapseButton: true,
  pcDetail: PC_DETAIL_ALL,
  statBlock: STATBLOCK_DEFAULT,
  persistentDamageAutoRoll: false,
  persistentDamageWarn: true,
}

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    const merged = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<AppSettings>) }
    // Normalise pcDetail so every section key exists (back-compat / future keys).
    merged.pcDetail = { ...PC_DETAIL_ALL, ...(merged.pcDetail ?? {}) }
    for (const { key } of PC_DETAIL_SECTIONS) {
      if (typeof merged.pcDetail[key] !== 'boolean') merged.pcDetail[key] = true
    }
    // Guard the enum settings against stale / bad persisted values.
    if (!SPELL_INDICATORS.some(s => s.id === merged.spellIndicator)) merged.spellIndicator = 'diamond'
    if (!SPELL_LAYOUTS.some(s => s.id === merged.spellLayout)) merged.spellLayout = 'grid'
    // Stat-block layout: migrate the older 1.4.13 flat shape
    // ({defenseStyle, boxPerception, boxHP, abilityStyle}) into the items[]
    // model, then normalise so every item exists with a valid style.
    {
      const rawSb = (merged.statBlock ?? {}) as unknown as Record<string, unknown>
      if (!Array.isArray(rawSb.items)) {
        const items = SB_DEFAULT_ITEMS.map(d => ({ ...d }))
        const set = (id: SbItemId, patch: Partial<SbItem>) => {
          const it = items.find(i => i.id === id); if (it) Object.assign(it, patch)
        }
        if (typeof rawSb.defenseStyle === 'string') set('defense', { style: rawSb.defenseStyle })
        if (rawSb.boxPerception) set('perception', { style: 'box' })
        if (rawSb.boxHP) set('hp', { style: 'box' })
        if (rawSb.abilityStyle === 'hidden') set('abilities', { hidden: true })
        else if (typeof rawSb.abilityStyle === 'string') set('abilities', { style: rawSb.abilityStyle })
        merged.statBlock = { ...STATBLOCK_DEFAULT, items, compact: !!rawSb.compact }
      }
      const sep = typeof rawSb.separator === 'string' && SB_SEPARATORS.some(s => s.id === rawSb.separator)
        ? rawSb.separator : 'dot'
      const gap = typeof rawSb.spellRankGap === 'string' && SB_SPELL_GAPS.some(s => s.id === rawSb.spellRankGap)
        ? rawSb.spellRankGap : 'normal'
      const cols = SB_ATTACK_COLS.some(c => c.id === rawSb.attacksPerLine) ? rawSb.attacksPerLine as number : 1
      const merge = typeof rawSb.mergeStyle === 'string' && SB_MERGE_STYLES.some(s => s.id === rawSb.mergeStyle)
        ? rawSb.mergeStyle : 'spaced'
      // sameLineGap is the new unified knob; fall back to the legacy spell-only
      // gap (tight/normal/loose all exist in the new scale) for older saves.
      const lineGap = typeof rawSb.sameLineGap === 'string' && SB_LINE_GAPS.some(s => s.id === rawSb.sameLineGap)
        ? rawSb.sameLineGap : (SB_LINE_GAPS.some(s => s.id === gap) ? gap : 'normal')
      merged.statBlock = {
        items: normalizeStatBlockItems(merged.statBlock.items),
        compact: !!merged.statBlock.compact,
        showSectionHeaders: rawSb.showSectionHeaders !== false,
        separator: sep,
        mergeStyle: merge,
        spellRankGap: gap,
        sameLineGap: lineGap,
        attacksPerLine: cols,
      }
    }
    return merged
  } catch {
    return DEFAULTS
  }
}

/** Apply the chosen theme to <html> so all `var(--…)` tokens flip in one go.
 *  A custom theme id resolves to its base built-in (for non-colour tokens) plus
 *  inline-applied derived colour vars; any prior custom override is cleared. */
export function applyTheme(theme: string): void {
  if (typeof document === 'undefined') return
  const el = document.documentElement
  for (const k of CUSTOM_VAR_KEYS) el.style.removeProperty(k)
  const custom = findCustomTheme(theme)
  if (custom) {
    if (custom.base === 'tavern') el.removeAttribute('data-theme')
    else el.setAttribute('data-theme', custom.base)
    const vars = deriveThemeVars(custom.colors)
    for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v)
    return
  }
  // Default Tavern lives on bare `:root`; clearing the attribute keeps the
  // selector specificity simple and avoids redundant overrides.
  if (theme === 'tavern') el.removeAttribute('data-theme')
  else el.setAttribute('data-theme', theme)
}

/** Live-preview helper used by the theme editor (no persistence). */
export function previewThemeColors(base: string, colors: ThemeColorsT): void {
  if (typeof document === 'undefined') return
  const el = document.documentElement
  if (base === 'tavern') el.removeAttribute('data-theme'); else el.setAttribute('data-theme', base)
  const vars = deriveThemeVars(colors)
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v)
}

interface SettingsStore extends AppSettings {
  setSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void
  toggle: (key: keyof AppSettings) => void
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  ...loadSettings(),
  setSetting(key, value) {
    set({ [key]: value } as Partial<AppSettings>)
    const next: AppSettings = { ...(get() as AppSettings), [key]: value }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      showMonsterParts: next.showMonsterParts,
      theme: next.theme,
      turnTimerEnabled: next.turnTimerEnabled,
      showInitAC: next.showInitAC,
      showInitSaves: next.showInitSaves,
      showInitLevel: next.showInitLevel,
      showInitPcDefenses: next.showInitPcDefenses,
      hideInitPcHp: next.hideInitPcHp,
      showSource: next.showSource,
      spellIndicator: next.spellIndicator,
      spellLayout: next.spellLayout,
      dockablePopups: next.dockablePopups,
      showBlockDragButton: next.showBlockDragButton,
      showTabDragButton: next.showTabDragButton,
      showInitCollapseButton: next.showInitCollapseButton,
      pcDetail: next.pcDetail,
      statBlock: next.statBlock,
      persistentDamageAutoRoll: next.persistentDamageAutoRoll,
      persistentDamageWarn: next.persistentDamageWarn,
    }))
    if (key === 'theme') applyTheme(value as string)
  },
  toggle(key) {
    const cur = get()[key]
    if (typeof cur === 'boolean') {
      // Cast through unknown since keyof is broader than boolean-only keys.
      (get().setSetting as (k: keyof AppSettings, v: boolean) => void)(key, !cur)
    }
  },
}))

// Apply on module load so the persisted theme is live before React mounts —
// otherwise the first paint flashes the default palette and then snaps.
applyTheme(loadSettings().theme)

// ── Monster Parts tables (Battlezoo) ──────────────────────────────────────
/**
 * Which of the three Monster Parts variants is in play. The gp a monster yields differs a LOT
 * between them — a level-10 monster is 125 gp on Light but 500 gp on Full — so this is not a
 * cosmetic preference, it decides the numbers.
 */
export type MonsterPartsMode = 'full' | 'light' | 'hybrid'

/**
 * Parts gained per part-granting monster, by creature level and variant (Battlezoo Tables 2A/2B/2C).
 * Creature level is the only input — there is no trait, rarity or size term.
 *
 * This used to be the LIGHT column alone, hardwired, which silently under-reported by up to 4x for
 * anyone playing Full or Hybrid. Kept in sync with Heroes Heaven's MP_PARTS_PER_MONSTER
 * (src/rules/monsterParts.ts) — duplicated rather than imported because the tracker must build and
 * run with no Heroes Heaven present.
 */
const MONSTER_PARTS_VALUE: Record<MonsterPartsMode, Record<number, number>> = {
  light: {
    [-1]: 1.5, 0: 2.25, 1: 3.5, 2: 5, 3: 7, 4: 12, 5: 18, 6: 30, 7: 45, 8: 64, 9: 90, 10: 125, 11: 175,
    12: 250, 13: 375, 14: 560, 15: 810, 16: 1250, 17: 1875, 18: 3000, 19: 5000, 20: 8750, 21: 10000,
    22: 17500, 23: 20000, 24: 35000, 25: 40000,
  },
  hybrid: {
    [-1]: 3.5, 0: 5, 1: 7, 2: 12, 3: 18, 4: 27, 5: 45, 6: 65, 7: 100, 8: 140, 9: 200, 10: 275, 11: 390,
    12: 560, 13: 840, 14: 1250, 15: 1850, 16: 2800, 17: 4300, 18: 7000, 19: 12000, 20: 17500, 21: 24000,
    22: 35000, 23: 48000, 24: 70000, 25: 96000,
  },
  full: {
    [-1]: 6.5, 0: 9, 1: 13, 2: 22, 3: 30, 4: 50, 5: 80, 6: 125, 7: 180, 8: 250, 9: 360, 10: 500, 11: 720,
    12: 1030, 13: 1560, 14: 2300, 15: 3400, 16: 5150, 17: 8000, 18: 13000, 19: 22500, 20: 30000, 21: 45000,
    22: 60000, 23: 90000, 24: 120000, 25: 180000,
  },
}

/** Format the value in gp with thousand-separators (e.g. "1,250 gp"). */
function formatGp(amount: number): string {
  if (amount < 1) {
    // Sub-1gp values like 1.5 / 2.25 — keep decimals
    return `${amount} gp`
  }
  return `${amount.toLocaleString('en-US')} gp`
}

/** Bulk of monster parts based on the creature's size trait. */
function bulkForSize(size: string): string {
  switch (size.toLowerCase()) {
    case 'small':      return 'L'      // light
    case 'medium':     return '1'
    case 'large':      return '2'
    case 'huge':       return '4'
    case 'gargantuan': return '8'
    case 'tiny':       return 'L'      // not in the official table; assume light
    default:           return '—'
  }
}

/**
 * Resolve the monster-parts value + bulk for a creature, for the variant in play.
 * Returns null if the level is out of range or no size trait is present.
 *
 * `mode` defaults to 'light' only to preserve the standalone tracker's long-standing numbers; inside
 * a campaign the variant actually chosen in Heroes Heaven is passed in.
 */
export function monsterPartsFor(
  level: number,
  traits: string[],
  mode: MonsterPartsMode = 'light',
): { value: string; bulk: string } | null {
  const gp = MONSTER_PARTS_VALUE[mode][level]
  if (gp == null) return null
  const SIZES = ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan']
  const size = traits.find(t => SIZES.includes(t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()))
  if (!size) return null
  return {
    value: formatGp(gp),
    bulk: bulkForSize(size),
  }
}
