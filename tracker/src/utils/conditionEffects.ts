import type { AppliedCondition } from '../types/pf2e'

// ── Stat mods — every numeric stat a condition can affect ────────────────
// Defenses + offense + senses + universal + (NEW) spellcasting / class DC /
// speed / each of the 16 PF2e skills. Order grouped by category so the
// editor UI can iterate it section-by-section.
export interface StatMods {
  // Defenses
  ac: number; fort: number; ref: number; will: number
  // Offense
  attackBonus: number; meleeAttack: number; rangedAttack: number
  // Senses
  perception: number
  // Universal
  allChecks: number
  // Spellcasting / DCs
  spellAttack: number; spellDC: number; classDC: number
  // Movement
  speed: number
  // 16 PF2e skills
  acrobatics: number; arcana: number; athletics: number; crafting: number
  deception: number; diplomacy: number; intimidation: number; medicine: number
  nature: number; occultism: number; performance: number; religion: number
  society: number; stealth: number; survival: number; thievery: number
}

export const ZERO_MODS: StatMods = {
  ac:0, fort:0, ref:0, will:0,
  attackBonus:0, meleeAttack:0, rangedAttack:0,
  perception:0, allChecks:0,
  spellAttack:0, spellDC:0, classDC:0,
  speed:0,
  acrobatics:0, arcana:0, athletics:0, crafting:0,
  deception:0, diplomacy:0, intimidation:0, medicine:0,
  nature:0, occultism:0, performance:0, religion:0,
  society:0, stealth:0, survival:0, thievery:0,
}

/** All numeric mod keys — used by the editor to iterate. */
export const STAT_MOD_KEYS = Object.keys(ZERO_MODS) as (keyof StatMods)[]

/** UI grouping + display labels for the Advanced Editor's stat-effects panel. */
export const STAT_MOD_GROUPS: { title: string; keys: (keyof StatMods)[] }[] = [
  { title: 'Defenses',         keys: ['ac', 'fort', 'ref', 'will'] },
  { title: 'Offense',          keys: ['attackBonus', 'meleeAttack', 'rangedAttack'] },
  { title: 'Senses & Universal', keys: ['perception', 'allChecks'] },
  { title: 'Spellcasting & DCs', keys: ['spellAttack', 'spellDC', 'classDC'] },
  { title: 'Movement',         keys: ['speed'] },
  { title: 'Skills',           keys: [
    'acrobatics', 'arcana', 'athletics', 'crafting',
    'deception', 'diplomacy', 'intimidation', 'medicine',
    'nature', 'occultism', 'performance', 'religion',
    'society', 'stealth', 'survival', 'thievery',
  ]},
]

export const STAT_MOD_LABELS: Record<keyof StatMods, string> = {
  ac: 'AC', fort: 'Fortitude', ref: 'Reflex', will: 'Will',
  attackBonus: 'Attack bonus', meleeAttack: 'Melee attack', rangedAttack: 'Ranged attack',
  perception: 'Perception', allChecks: 'All checks / saves / DCs',
  spellAttack: 'Spell attack', spellDC: 'Spell DC', classDC: 'Class DC',
  speed: 'Speed (ft)',
  acrobatics: 'Acrobatics', arcana: 'Arcana', athletics: 'Athletics', crafting: 'Crafting',
  deception: 'Deception', diplomacy: 'Diplomacy', intimidation: 'Intimidation', medicine: 'Medicine',
  nature: 'Nature', occultism: 'Occultism', performance: 'Performance', religion: 'Religion',
  society: 'Society', stealth: 'Stealth', survival: 'Survival', thievery: 'Thievery',
}

// ── Bonus/penalty types ───────────────────────────────────────────────────
// PF2e stacking rule: bonuses/penalties of the same type don't stack — you use
// only the highest bonus and the worst penalty of each type. Untyped values
// always stack (with everything, including each other).
export type ModType = 'circumstance' | 'status' | 'item' | 'untyped'
export const MOD_TYPES: ModType[] = ['circumstance', 'status', 'item', 'untyped']

// "All checks / saves / DCs" (the allChecks pseudo-stat) folds onto these real
// stats at resolve time. Deliberately excludes meleeAttack / rangedAttack so a
// general attack penalty (attackBonus) isn't double-counted on weapon attacks,
// and excludes speed.
const ALL_CHECKS_TARGETS = new Set<keyof StatMods>([
  'ac', 'perception', 'fort', 'ref', 'will',
  'attackBonus', 'spellAttack', 'spellDC', 'classDC',
  'acrobatics', 'arcana', 'athletics', 'crafting', 'deception', 'diplomacy',
  'intimidation', 'medicine', 'nature', 'occultism', 'performance', 'religion',
  'society', 'stealth', 'survival', 'thievery',
])

type TypeBucket = Record<ModType, number[]>
type Buckets = Record<keyof StatMods, TypeBucket>

function emptyBuckets(): Buckets {
  const b = {} as Buckets
  for (const k of STAT_MOD_KEYS) b[k] = { circumstance: [], status: [], item: [], untyped: [] }
  return b
}
function pushMod(b: Buckets, key: keyof StatMods, value: number, type: ModType) {
  if (value) b[key][type].push(value)
}
/** Highest bonus + worst penalty within one type. */
function resolveType(vals: number[]): number {
  let maxBonus = 0, worstPen = 0
  for (const v of vals) { if (v > 0) maxBonus = Math.max(maxBonus, v); else if (v < 0) worstPen = Math.min(worstPen, v) }
  return maxBonus + worstPen
}
/** Resolve one stat's bucket (+ optional allChecks bucket) to a single total. */
function resolveBucket(own: TypeBucket, all: TypeBucket | null): number {
  let total = 0
  for (const t of ['circumstance', 'status', 'item'] as const) {
    const vals = all ? [...own[t], ...all[t]] : own[t]
    total += resolveType(vals)
  }
  total += own.untyped.reduce((a, c) => a + c, 0)
  if (all) total += all.untyped.reduce((a, c) => a + c, 0)
  return total
}

/** Push a built-in condition's typed penalties into the buckets. */
function applyBuiltin(b: Buckets, name: string, v: number) {
  const S: ModType = 'status', C: ModType = 'circumstance'
  switch (name) {
    case 'clumsy':      pushMod(b,'ac',-v,S); pushMod(b,'ref',-v,S); pushMod(b,'acrobatics',-v,S); pushMod(b,'stealth',-v,S); pushMod(b,'thievery',-v,S); break
    case 'drained':     pushMod(b,'fort',-v,S); break
    case 'enfeebled':   pushMod(b,'meleeAttack',-v,S); pushMod(b,'athletics',-v,S); break
    case 'stupefied':   pushMod(b,'will',-v,S); pushMod(b,'spellAttack',-v,S); pushMod(b,'spellDC',-v,S); break
    // Frightened / Sickened: status penalty to every check, save, DC and AC.
    case 'frightened':
    case 'sickened':    pushMod(b,'allChecks',-v,S); pushMod(b,'meleeAttack',-v,S); pushMod(b,'rangedAttack',-v,S); break
    case 'off-guard':
    case 'flat-footed': pushMod(b,'ac',-2,C); break
    case 'prone':       pushMod(b,'attackBonus',-2,C); break
    case 'fatigued':    pushMod(b,'ac',-1,S); pushMod(b,'fort',-1,S); pushMod(b,'ref',-1,S); pushMod(b,'will',-1,S); break
    case 'grabbed':
    case 'restrained':  pushMod(b,'ac',-2,C); pushMod(b,'attackBonus',-2,C); break
    case 'blinded':     pushMod(b,'perception',-4,S); pushMod(b,'ac',-2,C); break
    case 'deafened':    pushMod(b,'perception',-2,S); break
    case 'unconscious': pushMod(b,'ac',-4,S); pushMod(b,'perception',-4,S); pushMod(b,'ref',-4,S); pushMod(b,'ac',-2,C); break
  }
}

/** Fold one condition's flat mods (with their types) into the buckets. */
function applyCustomFlat(b: Buckets, cond: AppliedCondition) {
  if (!cond.mods) return
  const mult = cond.scalesByValue ? Math.max(1, cond.value ?? 0) : 1
  for (const k of STAT_MOD_KEYS) {
    const delta = cond.mods[k]
    if (delta) pushMod(b, k, delta * mult, (cond.modTypes?.[k] as ModType) ?? 'untyped')
  }
}

/**
 * Resolve every applied condition into a flat StatMods total, honouring PF2e's
 * typed-stacking rule (highest bonus + worst penalty per type; untyped stacks).
 */
export function computeConditionMods(conditions: AppliedCondition[]): StatMods {
  const b = emptyBuckets()
  for (const cond of conditions) {
    if (cond.mods) applyCustomFlat(b, cond)
    else applyBuiltin(b, cond.name.toLowerCase(), cond.value ?? 0)
  }
  const m = { ...ZERO_MODS }
  for (const k of STAT_MOD_KEYS) {
    if (k === 'allChecks') continue   // pseudo-stat — folded into its targets
    m[k] = resolveBucket(b[k], ALL_CHECKS_TARGETS.has(k) ? b.allChecks : null)
  }
  return m
}

/**
 * Resolve the total modifier for a single stat, optionally including
 * situational (conditional) mods. Used both for the displayed number
 * (includeConditional = false) and the "*" roll (= true). Honours typed
 * stacking across flat AND conditional mods of the same type.
 */
export function resolveStatMod(
  conditions: AppliedCondition[],
  statKey: keyof StatMods,
  includeConditional: boolean,
): number {
  const b = emptyBuckets()
  for (const cond of conditions) {
    if (cond.mods) applyCustomFlat(b, cond)
    else applyBuiltin(b, cond.name.toLowerCase(), cond.value ?? 0)
    if (includeConditional && cond.condMods) {
      const mult = cond.scalesByValue ? Math.max(1, cond.value ?? 0) : 1
      for (const k of STAT_MOD_KEYS) {
        const cm = cond.condMods[k]
        if (cm && cm.value) pushMod(b, k, cm.value * mult, (cm.type as ModType) ?? 'untyped')
      }
    }
  }
  return resolveBucket(b[statKey], ALL_CHECKS_TARGETS.has(statKey) ? b.allChecks : null)
}

// ── Conditional (situational) modifiers ───────────────────────────────────
export interface ConditionalModEntry { value: number; when: string; source: string; type: ModType }

/**
 * Gather every situational modifier from the applied conditions that targets
 * any of `keys` (e.g. ['will','allChecks'] for a Will save). Value-scaling
 * conditions multiply by their current value, matching computeConditionMods.
 * Returned for tooltip display; the actual roll total uses resolveStatMod so
 * typed stacking is respected.
 */
export function conditionalModsFor(
  conditions: AppliedCondition[],
  keys: string[],
): ConditionalModEntry[] {
  const out: ConditionalModEntry[] = []
  for (const c of conditions) {
    if (!c.condMods) continue
    const mult = c.scalesByValue ? Math.max(1, c.value ?? 1) : 1
    for (const k of keys) {
      const cm = c.condMods[k]
      if (cm && cm.value) out.push({ value: cm.value * mult, when: cm.when, source: c.name, type: (cm.type as ModType) ?? 'untyped' })
    }
  }
  return out
}

export interface ConditionMeta {
  name: string; hasValue: boolean; maxValue?: number
  /** Auto-reduces its value over the creature's turn (removed at 0). By default
   *  this happens at the END of the turn (e.g. Frightened). Conditions consumed
   *  at the START of the turn (e.g. Stunned, which eats your actions) set
   *  `tickAtStart`. The amount reduced each tick is `decrementBy` (default 1). */
  autoDecrement?: boolean
  tickAtStart?: boolean
  decrementBy?: number
  bg: string; fg: string; border: string; summary: string
}

export const CONDITION_META: Record<string, ConditionMeta> = {
  blinded:     { name:'Blinded',     hasValue:false,                 bg:'#374151', fg:'#e5e7eb', border:'#6b7280', summary:"−4 status penalty to sight-based Perception; everything is concealed from you; off-guard to anything you can't see." },
  clumsy:      { name:'Clumsy',      hasValue:true, maxValue:4,      bg:'#92400e', fg:'#fde68a', border:'#d97706', summary:"−X status penalty to AC, Reflex saves, and Dexterity-based checks." },
  concealed:   { name:'Concealed',   hasValue:false,                 bg:'#1e3a5f', fg:'#bfdbfe', border:'#3b82f6', summary:"Attackers must succeed at a DC 5 flat check or the attack misses." },
  confused:    { name:'Confused',    hasValue:false,                 bg:'#7c3aed', fg:'#ddd6fe', border:'#8b5cf6', summary:"Off-guard; act randomly each turn; treat everyone as an enemy." },
  dazzled:     { name:'Dazzled',     hasValue:false,                 bg:'#d97706', fg:'#fef3c7', border:'#f59e0b', summary:"All creatures and objects are concealed from you." },
  deafened:    { name:'Deafened',    hasValue:false,                 bg:'#374151', fg:'#d1d5db', border:'#6b7280', summary:"−2 status penalty to Perception (and initiative); auto-fail purely auditory checks." },
  doomed:      { name:'Doomed',      hasValue:true, maxValue:3,      bg:'#7f1d1d', fg:'#fca5a5', border:'#ef4444', summary:"Dying value at which you die is reduced by X." },
  drained:     { name:'Drained',     hasValue:true, maxValue:4,      bg:'#831843', fg:'#fbcfe8', border:'#ec4899', summary:"−X status penalty to Fortitude saves and Constitution checks; lose X × level max HP." },
  dying:       { name:'Dying',       hasValue:true, maxValue:4,      bg:'#991b1b', fg:'#fecaca', border:'#dc2626', summary:"Unconscious and near death. At dying 4 you die." },
  enfeebled:   { name:'Enfeebled',   hasValue:true, maxValue:4,      bg:'#7c2d12', fg:'#fed7aa', border:'#f97316', summary:"−X status penalty to Strength-based rolls (melee attack/damage, Athletics)." },
  fascinated:  { name:'Fascinated',  hasValue:false,                 bg:'#4c1d95', fg:'#ddd6fe', border:'#7c3aed', summary:"−2 status penalty to Perception and skill checks; can't use concentrate actions except on the source." },
  fatigued:    { name:'Fatigued',    hasValue:false,                 bg:'#44403c', fg:'#d6d3d1', border:'#78716c', summary:"−1 status penalty to AC and saving throws." },
  fleeing:     { name:'Fleeing',     hasValue:false,                 bg:'#7c3aed', fg:'#ede9fe', border:'#a78bfa', summary:"Must spend each action trying to move away from the source." },
  frightened:  { name:'Frightened',  hasValue:true, maxValue:4,      autoDecrement:true, bg:'#4a044e', fg:'#f0abfc', border:'#d946ef', summary:"−X status penalty to all checks and DCs (including AC). Reduces by 1 at end of each turn." },
  grabbed:     { name:'Grabbed',     hasValue:false,                 bg:'#1e3a5f', fg:'#93c5fd', border:'#2563eb', summary:"Immobilized and off-guard (−2 circumstance penalty to AC)." },
  hidden:      { name:'Hidden',      hasValue:false,                 bg:'#1c1917', fg:'#a8a29e', border:'#57534e', summary:"Foes know roughly where you are but not exactly; they target you with a DC 11 flat check." },
  immobilized: { name:'Immobilized', hasValue:false,                 bg:'#374151', fg:'#9ca3af', border:'#4b5563', summary:"Can't use any action with the move trait." },
  invisible:   { name:'Invisible',   hasValue:false,                 bg:'#1c1917', fg:'#d1d5db', border:'#6b7280', summary:"Undetected by all; foes must Seek and target you with a DC 11 flat check." },
  'off-guard': { name:'Off-Guard',   hasValue:false,                 bg:'#1e3a5f', fg:'#93c5fd', border:'#2563eb', summary:"−2 circumstance penalty to AC." },
  paralyzed:   { name:'Paralyzed',   hasValue:false,                 bg:'#374151', fg:'#e5e7eb', border:'#9ca3af', summary:"Off-guard (−2 circ. AC); can't act except to Recall Knowledge and use purely mental actions." },
  'persistent damage': { name:'Persistent Damage', hasValue:false,   bg:'#7c2d12', fg:'#fed7aa', border:'#f97316', summary:"At the end of your turn you take this damage, then attempt a DC 15 flat check to end it (lower with appropriate help). Set the amount, type, and how many rounds to track it." },
  petrified:   { name:'Petrified',   hasValue:false,                 bg:'#6b7280', fg:'#f3f4f6', border:'#9ca3af', summary:"Turned to stone — can't act or sense; Hardness 8." },
  prone:       { name:'Prone',       hasValue:false,                 bg:'#44403c', fg:'#d6d3d1', border:'#78716c', summary:"Off-guard (−2 circ. AC); −2 circumstance penalty to your attack rolls. Crawl or Stand to move." },
  quickened:   { name:'Quickened',   hasValue:false,                 bg:'#064e3b', fg:'#6ee7b7', border:'#10b981', summary:"Gain 1 extra action at the start of your turn (use limited by the effect's source)." },
  restrained:  { name:'Restrained',  hasValue:false,                 bg:'#1e3a5f', fg:'#93c5fd', border:'#2563eb', summary:"Immobilized and off-guard (−2 circ. AC); can't use attack or manipulate actions." },
  sickened:    { name:'Sickened',    hasValue:true, maxValue:4,      bg:'#365314', fg:'#bbf7d0', border:'#22c55e', summary:"−X status penalty to all checks and DCs (including AC). Fortitude save to reduce; can't ingest." },
  slowed:      { name:'Slowed',      hasValue:true, maxValue:3,      bg:'#1e3a5f', fg:'#bfdbfe', border:'#3b82f6', summary:"Lose X actions at the start of your turn." },
  stunned:     { name:'Stunned',     hasValue:true, maxValue:99,     autoDecrement:true, tickAtStart:true, decrementBy:3, bg:'#7f1d1d', fg:'#fca5a5', border:'#ef4444', summary:"At the start of your turn you lose actions equal to the value (reducing the value by the actions lost). Most creatures lose all 3, so Stunned 1–3 clears in one turn." },
  stupefied:   { name:'Stupefied',   hasValue:true, maxValue:4,      bg:'#1e1b4b', fg:'#c7d2fe', border:'#6366f1', summary:"−X status penalty to Int/Wis/Cha checks, Will saves, and spell DCs; DC 5 + X flat check to cast spells." },
  unconscious: { name:'Unconscious', hasValue:false,                 bg:'#1c1917', fg:'#a8a29e', border:'#57534e', summary:"Asleep or knocked out; can't act; −4 status penalty to AC, Perception, and Reflex; off-guard; blinded." },
  wounded:     { name:'Wounded',     hasValue:true, maxValue:3,      bg:'#7f1d1d', fg:'#fca5a5', border:'#ef4444', summary:"When you gain dying again, increase it by X. Increases by 1 each time you're knocked out." },
}

export const ALL_CONDITIONS = Object.keys(CONDITION_META).sort()
