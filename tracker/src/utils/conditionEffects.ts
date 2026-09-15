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

/** The 16 PF2e skills, in the order the editor lists them. */
export const SKILL_KEYS: (keyof StatMods)[] = [
  'acrobatics', 'arcana', 'athletics', 'crafting',
  'deception', 'diplomacy', 'intimidation', 'medicine',
  'nature', 'occultism', 'performance', 'religion',
  'society', 'stealth', 'survival', 'thievery',
]

/** The skills keyed off a MENTAL attribute — Stupefied's reach ("skill checks that use these
 *  attribute modifiers"). Athletics (Str) and Acrobatics / Stealth / Thievery (Dex) are the four
 *  physical ones it does not touch. */
const MENTAL_SKILLS: (keyof StatMods)[] = [
  'arcana', 'crafting', 'occultism', 'society',            // Intelligence
  'medicine', 'nature', 'religion', 'survival',            // Wisdom
  'deception', 'diplomacy', 'intimidation', 'performance', // Charisma
]

/** UI grouping + display labels for the Advanced Editor's stat-effects panel. */
export const STAT_MOD_GROUPS: { title: string; keys: (keyof StatMods)[] }[] = [
  { title: 'Defenses',         keys: ['ac', 'fort', 'ref', 'will'] },
  { title: 'Offense',          keys: ['attackBonus', 'meleeAttack', 'rangedAttack'] },
  { title: 'Senses & Universal', keys: ['perception', 'allChecks'] },
  { title: 'Spellcasting & DCs', keys: ['spellAttack', 'spellDC', 'classDC'] },
  { title: 'Movement',         keys: ['speed'] },
  { title: 'Skills',           keys: SKILL_KEYS },
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
/* Two pseudo-buckets sit beside the real stats, for the rows that print a whole CLASS of skill:
 * `allSkills` is "skill checks" with no attribute qualifier (Fascinated), `mentalSkills` the ones
 * qualified by a mental attribute (Stupefied). They exist because the 16 enumerated skills are not
 * all the skills a creature has — a Lore carries an arbitrary name and no StatMods key, so
 * enumerating the 16 left a Fascinated creature's "Hell Lore" at 0 while the player sheet, which
 * asks (attribute, slot) instead of a key, said −2. */
type BucketKey = keyof StatMods | 'allSkills' | 'mentalSkills'
type Buckets = Record<BucketKey, TypeBucket>

function emptyBuckets(): Buckets {
  const b = {} as Buckets
  for (const k of [...STAT_MOD_KEYS, 'allSkills', 'mentalSkills'] as BucketKey[]) b[k] = { circumstance: [], status: [], item: [], untyped: [] }
  return b
}
function pushMod(b: Buckets, key: BucketKey, value: number, type: ModType) {
  if (value) b[key][type].push(value)
}
/** Highest bonus + worst penalty within one type. */
function resolveType(vals: number[]): number {
  let maxBonus = 0, worstPen = 0
  for (const v of vals) { if (v > 0) maxBonus = Math.max(maxBonus, v); else if (v < 0) worstPen = Math.min(worstPen, v) }
  return maxBonus + worstPen
}
/** Resolve one stat's bucket, pooled with the pseudo-buckets it draws from, to a single total. */
function resolveBucket(own: TypeBucket, extras: TypeBucket[]): number {
  let total = 0
  for (const t of ['circumstance', 'status', 'item'] as const) {
    total += resolveType(extras.length ? [...own[t], ...extras.flatMap((e) => e[t])] : own[t])
  }
  for (const e of [own, ...extras]) total += e.untyped.reduce((a, c) => a + c, 0)
  return total
}

/** Which pseudo-buckets a stat draws from. A key we don't enumerate is a LORE — a skill check, and
 *  an Int-based one (every Lore is, whatever its subject) — so it draws from all three. */
function extraBuckets(b: Buckets, key: string): TypeBucket[] {
  const lore = !(key in ZERO_MODS)
  const out: TypeBucket[] = []
  if (lore || ALL_CHECKS_TARGETS.has(key as keyof StatMods)) out.push(b.allChecks)
  if (lore || (SKILL_KEYS as string[]).includes(key)) out.push(b.allSkills)
  if (lore || (MENTAL_SKILLS as string[]).includes(key)) out.push(b.mentalSkills)
  return out
}

/**
 * Push a built-in condition's typed penalties into the buckets.
 *
 * Every row below is the Player Core (remaster) printing, quoted in its comment. The quotes are
 * load-bearing: the rows that were wrong were all wrong in the same way — an older printing's
 * wording, or a play-aid's shorthand, rather than the sentence on the page.
 */
function applyBuiltin(b: Buckets, name: string, v: number) {
  const S: ModType = 'status', C: ModType = 'circumstance'
  switch (name) {
    // "…status penalty equal to the condition value to Dexterity-based rolls and DCs, including AC,
    //  Reflex saves, RANGED ATTACK ROLLS, and skill checks using Acrobatics, Stealth, and Thievery."
    case 'clumsy':      pushMod(b,'ac',-v,S); pushMod(b,'ref',-v,S); pushMod(b,'rangedAttack',-v,S); pushMod(b,'acrobatics',-v,S); pushMod(b,'stealth',-v,S); pushMod(b,'thievery',-v,S); break
    // "…status penalty equal to your drained value on Constitution-based rolls and DCs, such as Fortitude saves."
    case 'drained':     pushMod(b,'fort',-v,S); break
    // "…status penalty equal to the condition value to Strength-based rolls and DCs, including
    //  Strength-based melee attack rolls, Strength-based damage rolls, and Athletics checks."
    //  (Damage has no StatMods key — the tracker shows rolls, not damage bonuses.)
    case 'enfeebled':   pushMod(b,'meleeAttack',-v,S); pushMod(b,'athletics',-v,S); break
    // "…status penalty equal to this value on Intelligence-, Wisdom-, and Charisma-based rolls and
    //  DCs, including Will saving throws, spell attack modifiers, spell DCs, and skill checks that
    //  use these attribute modifiers." Perception is THE Wisdom-based roll, and the 12 mental
    //  skills are the "skill checks that use these attribute modifiers".
    case 'stupefied':
      pushMod(b,'will',-v,S); pushMod(b,'perception',-v,S)
      pushMod(b,'spellAttack',-v,S); pushMod(b,'spellDC',-v,S)
      pushMod(b,'mentalSkills',-v,S)
      break
    // "You take a status penalty equal to this value to all your checks and DCs." (allChecks
    // deliberately excludes melee/ranged attack, so those are pushed explicitly — see its comment.)
    case 'frightened':
    case 'sickened':    pushMod(b,'allChecks',-v,S); pushMod(b,'meleeAttack',-v,S); pushMod(b,'rangedAttack',-v,S); break
    // "You take a –2 circumstance penalty to AC."
    case 'off-guard':
    case 'flat-footed': pushMod(b,'ac',-2,C); break
    // "You are OFF-GUARD and take a –2 circumstance penalty to attack rolls." The off-guard half
    // (−2 circ. AC) was missing; spell attacks are attack rolls too.
    case 'prone':       pushMod(b,'ac',-2,C); pushMod(b,'attackBonus',-2,C); pushMod(b,'spellAttack',-2,C); break
    // "You take a –1 status penalty to AC and saving throws."
    case 'fatigued':    pushMod(b,'ac',-1,S); pushMod(b,'fort',-1,S); pushMod(b,'ref',-1,S); pushMod(b,'will',-1,S); break
    // Grabbed: "…giving you the off-guard and immobilized conditions." Restrained: "You have the
    // off-guard and immobilized conditions, and you can't use any attack or manipulate actions…"
    // Neither prints an ATTACK penalty in the remaster — the −2 to attacks the tracker applied was
    // never on the page. (Restrained can't attack at all, so there is nothing to penalise.)
    case 'grabbed':
    case 'restrained':  pushMod(b,'ac',-2,C); break
    // "…if vision is your only precise sense, you take a –4 status penalty to Perception checks."
    // The whole entry prints no AC clause: being off-guard to what you can't see comes from the
    // detection rules, so the GM applies Off-Guard alongside it rather than it being automatic.
    case 'blinded':     pushMod(b,'perception',-4,S); break
    // "You take a –2 status penalty to Perception checks for initiative and checks that involve sound…"
    case 'deafened':    pushMod(b,'perception',-2,S); break
    // "You take a –2 status penalty to Perception AND SKILL CHECKS, and you can't use concentrate actions…"
    // Every skill, including the Lores a creature carries that no StatMods key can name.
    case 'fascinated':
      pushMod(b,'perception',-2,S); pushMod(b,'allSkills',-2,S)
      break
    // "You are OFF-GUARD, you don't treat anyone as your ally…"
    case 'confused':    pushMod(b,'ac',-2,C); break
    // "You have the OFF-GUARD condition and can't act except to Recall Knowledge…"
    case 'paralyzed':   pushMod(b,'ac',-2,C); break
    // "You take a –4 status penalty to AC, Perception, and Reflex saves, and you have the blinded
    //  and OFF-GUARD conditions."
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

/** Every applied condition's mods, bucketed by stat and type. `includeConditional` adds the
 *  situational (condMods) entries — the "*" roll — on top of the flat ones. */
function fillBuckets(conditions: AppliedCondition[], includeConditional: boolean): Buckets {
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
  return b
}

/**
 * Resolve every applied condition into a flat StatMods total, honouring PF2e's
 * typed-stacking rule (highest bonus + worst penalty per type; untyped stacks).
 */
export function computeConditionMods(conditions: AppliedCondition[]): StatMods {
  const b = fillBuckets(conditions, false)
  const m = { ...ZERO_MODS }
  for (const k of STAT_MOD_KEYS) {
    if (k === 'allChecks') continue   // pseudo-stat — folded into its targets
    m[k] = resolveBucket(b[k], extraBuckets(b, k))
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
  const b = fillBuckets(conditions, includeConditional)
  /* A stat key we have never heard of is a SKILL WE DO NOT ENUMERATE, not a bug to crash on.
   *
   * StatBlock.tsx:1042 rolls every skill on the creature through here, casting the key with
   * `as keyof StatMods` — a cast that lies for anything outside the 16 canonical skills. It went
   * unnoticed because AoN's `skill_mod` facet only ever emitted canonical skills; the moment the
   * builder started reading Lore skills out of `skill_markdown` (1,118 creatures — "Hell Lore +12"),
   * `b['hell lore']` came back undefined and `resolveBucket` threw on `.circumstance`, taking the
   * whole stat block down behind the error boundary.
   *
   * A Lore IS a skill check, so it still receives the all-checks modifiers (frightened, sickened…)
   * AND the skill-wide ones (Fascinated's −2, Stupefied's −value — every Lore is Int-based); it
   * simply has no per-stat bucket of its own. extraBuckets is what hands it those. */
  const bucket = b[statKey] ?? { circumstance: [], status: [], item: [], untyped: [] }
  return resolveBucket(bucket, extraBuckets(b, statKey))
}

/**
 * The condition modifier on ONE strike — the general `attackBonus` and the range-specific key
 * resolved in a SINGLE typed pool, plus allChecks.
 *
 * The stat block used to add the two resolved numbers (`mods.attackBonus + mods.meleeAttack`), and
 * that double-counts: Frightened 2 pushes its −2 status through allChecks (which reaches
 * attackBonus) AND explicitly onto meleeAttack/rangedAttack, so a frightened creature's melee
 * strike read −4. Both are status penalties, so PF2e takes the WORST, not the sum — and the same
 * arithmetic turned Frightened 2 + Enfeebled 1 into −3 when the printed answer is −2. Pooling them
 * once here fixes every combination instead of un-pushing one row; the condition table itself is
 * unchanged, which is what keeps it matching the player sheet's src/rules/conditions.ts.
 */
export function resolveAttackMod(
  conditions: AppliedCondition[],
  range: 'melee' | 'ranged',
  includeConditional = false,
): number {
  const b = fillBuckets(conditions, includeConditional)
  const spec = b[range === 'melee' ? 'meleeAttack' : 'rangedAttack']
  const merged = {} as TypeBucket
  for (const t of MOD_TYPES) merged[t] = [...b.attackBonus[t], ...spec[t]]
  return resolveBucket(merged, [b.allChecks])
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
  blinded:     { name:'Blinded',     hasValue:false,                 bg:'#374151', fg:'#e5e7eb', border:'#6b7280', summary:"You can't see; all terrain is difficult terrain. Auto-critically-fail Perception checks that need sight, and −4 status to Perception if vision was your only precise sense. Add Off-Guard for attackers you can't see — Blinded itself prints no AC penalty." },
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
  stupefied:   { name:'Stupefied',   hasValue:true, maxValue:4,      bg:'#1e1b4b', fg:'#c7d2fe', border:'#6366f1', summary:"−X status penalty to Int/Wis/Cha rolls and DCs — Perception, Will saves, spell attacks, spell DCs and the mental skills; DC 5 + X flat check to cast spells." },
  unconscious: { name:'Unconscious', hasValue:false,                 bg:'#1c1917', fg:'#a8a29e', border:'#57534e', summary:"Asleep or knocked out; can't act; −4 status penalty to AC, Perception, and Reflex; off-guard; blinded." },
  wounded:     { name:'Wounded',     hasValue:true, maxValue:3,      bg:'#7f1d1d', fg:'#fca5a5', border:'#ef4444', summary:"When you gain dying again, increase it by X. Increases by 1 each time you're knocked out." },
}

export const ALL_CONDITIONS = Object.keys(CONDITION_META).sort()
