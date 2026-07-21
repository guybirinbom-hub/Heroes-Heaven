// ── Wanderer's Guide character import ───────────────────────────────────────
// Parses a Wanderer's Guide v4 character export (the JSON you get from
// "Export → Export as JSON"). That file is large because it bundles all the
// referenced game content, but everything we need is already *computed* in the
// top-level `content` block (WG's own README says that section is "solely for
// you … an abundance of compiled stats"). We read from there, so we don't have
// to reimplement PF2e's character math.

import type { PcStats, ProfRank, ImportedSheet, ImportedMod } from './pcDetail'

export interface ImportedCharacter {
  name: string
  pcStats: PcStats   // the subset the party cards display/edit
  sheet: ImportedSheet  // the full compact sheet (saved even if not shown)
}

export type ImportResult =
  | { ok: true; character: ImportedCharacter }
  | { ok: false; error: string }

// WG stores proficiency as 0/2/4/6/8 (the "+level" base): U/T/E/M/L.
function profRank(v: unknown): ProfRank {
  const n = typeof v === 'number' ? v : 0
  return n >= 8 ? 'L' : n >= 6 ? 'M' : n >= 4 ? 'E' : n >= 2 ? 'T' : 'U'
}

// A modifier comes through as "+7" / "-1" / "+0" (string) or a number.
function toMod(total: unknown): number {
  if (typeof total === 'number') return total
  if (typeof total === 'string') {
    const n = parseInt(total.replace(/\s/g, ''), 10)
    return isNaN(n) ? 0 : n
  }
  return 0
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s_-])([a-z])/g, (_, sep, ch) => (sep === '_' ? ' ' : sep) + ch.toUpperCase()).trim()
}

// SKILL_<NAME> → display name for the 16 core skills.
const SKILL_KEY: Record<string, string> = {
  SKILL_ACROBATICS: 'Acrobatics', SKILL_ARCANA: 'Arcana', SKILL_ATHLETICS: 'Athletics',
  SKILL_CRAFTING: 'Crafting', SKILL_DECEPTION: 'Deception', SKILL_DIPLOMACY: 'Diplomacy',
  SKILL_INTIMIDATION: 'Intimidation', SKILL_MEDICINE: 'Medicine', SKILL_NATURE: 'Nature',
  SKILL_OCCULTISM: 'Occultism', SKILL_PERFORMANCE: 'Performance', SKILL_RELIGION: 'Religion',
  SKILL_SOCIETY: 'Society', SKILL_STEALTH: 'Stealth', SKILL_SURVIVAL: 'Survival', SKILL_THIEVERY: 'Thievery',
}

const SPEED_NAME: Record<string, string> = {
  SPEED: 'Land', SPEED_FLY: 'Fly', SPEED_CLIMB: 'Climb', SPEED_BURROW: 'Burrow', SPEED_SWIM: 'Swim',
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

/** A proficiency entry → {mod, prof}, or undefined when absent. */
function readProf(prof: Any, key: string): ImportedMod | undefined {
  const e = prof?.[key]
  if (!e) return undefined
  return { mod: toMod(e.total), prof: profRank(e.parts?.profValue) }
}

function names(arr: Any): string[] {
  return Array.isArray(arr) ? arr.map((x: Any) => x?.name).filter((n: Any): n is string => typeof n === 'string') : []
}

/**
 * Parse a parsed-JSON object from Wanderer's Guide into our character shape.
 * Returns a friendly error for the common mistakes (wrong file, the PDF, an
 * unrelated JSON).
 */
export function parseWanderersGuide(raw: unknown): ImportResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'That file isn’t a character export. Use Wanderer’s Guide → Export → JSON.' }
  }
  const root = raw as Any
  const character = root.character
  if (!character || typeof character !== 'object' || typeof character.name !== 'string') {
    return { ok: false, error: 'This doesn’t look like a Wanderer’s Guide character JSON (no character data found). Make sure you exported the JSON, not the PDF.' }
  }
  const name = String(character.name).trim()
  if (!name) return { ok: false, error: 'The character has no name.' }

  // `content` is WG's compiled, human-readable stats block. Without it we can
  // still take the basics off `character`, but most stats live here.
  const content = (root.content && typeof root.content === 'object') ? root.content as Any : {}
  const prof = content.proficiencies ?? {}
  const attr = content.attributes ?? {}
  const details = character.details ?? {}

  const ancestry = details.ancestry?.name ? String(details.ancestry.name) : undefined
  const className = details.class?.name ? String(details.class.name) : undefined
  const background = details.background?.name ? String(details.background.name) : undefined
  const heritage = content.feats_features?.heritages?.[0]?.name
    ? String(content.feats_features.heritages[0].name) : undefined

  const abil = (k: string): number | undefined => {
    const v = attr[k]?.value
    return typeof v === 'number' ? v : undefined
  }
  const abilities = {
    str: abil('ATTRIBUTE_STR'), dex: abil('ATTRIBUTE_DEX'), con: abil('ATTRIBUTE_CON'),
    int: abil('ATTRIBUTE_INT'), wis: abil('ATTRIBUTE_WIS'), cha: abil('ATTRIBUTE_CHA'),
  }

  const fort = readProf(prof, 'SAVE_FORT')
  const ref = readProf(prof, 'SAVE_REFLEX')
  const will = readProf(prof, 'SAVE_WILL')
  const perception = readProf(prof, 'PERCEPTION')

  // Skills — the 16 core ones plus any Lores (SKILL_LORE_<X>), excluding the
  // generic empty lore slot (SKILL_LORE____).
  const skills: Record<string, ImportedMod> = {}
  for (const [k, v] of Object.entries(prof as Record<string, Any>)) {
    if (SKILL_KEY[k]) {
      skills[SKILL_KEY[k]] = { mod: toMod(v.total), prof: profRank(v.parts?.profValue) }
    } else if (k.startsWith('SKILL_LORE_') && k.replace(/_/g, '') !== 'SKILLLORE') {
      const suffix = k.slice('SKILL_LORE_'.length)
      if (suffix && suffix.replace(/_/g, '').length) {
        skills[`${titleCase(suffix)} Lore`] = { mod: toMod(v.total), prof: profRank(v.parts?.profValue) }
      }
    }
  }

  // DCs: WG stores the +modifier; the actual DC is 10 + modifier.
  const classDC = prof.CLASS_DC ? 10 + toMod(prof.CLASS_DC.total) : undefined
  let spellDC: number | undefined
  let spellAttack: number | undefined
  if (prof.SPELL_DC && (prof.SPELL_DC.parts?.profValue ?? 0) > 0) {
    spellDC = 10 + toMod(prof.SPELL_DC.total)
    spellAttack = readProf(prof, 'SPELL_ATTACK')?.mod
  } else if (prof.INNATE_SPELL_DC) {
    const n = toMod(prof.INNATE_SPELL_DC.total)   // often already the full DC
    spellDC = n >= 10 ? n : 10 + n
    spellAttack = readProf(prof, 'INNATE_SPELL_ATTACK')?.mod
  }

  // Speeds: keep the ones the character actually has (value > 0).
  const speedsRaw: Any[] = Array.isArray(content.speeds) ? content.speeds : []
  const speeds = speedsRaw
    .map(s => ({ name: SPEED_NAME[s?.name] ?? titleCase(String(s?.name ?? '')), value: Number(s?.value?.value ?? 0) }))
    .filter(s => s.value > 0)
  const landSpeed = speedsRaw.find(s => s?.name === 'SPEED')
  const speed = landSpeed ? Number(landSpeed.value?.total ?? landSpeed.value?.value ?? 0) || undefined : undefined

  // Senses by precision.
  const sensesObj = content.senses ?? {}
  const senseNames = (cat: string): string[] =>
    Array.isArray(sensesObj[cat]) ? sensesObj[cat].map((x: Any) => x?.sense?.name).filter(Boolean) : []
  const senses = { precise: senseNames('precise'), imprecise: senseNames('imprecise'), vague: senseNames('vague') }

  const languages: string[] = Array.isArray(content.languages)
    ? content.languages.map((l: Any) => titleCase(String(l))) : []

  const rw = content.resist_weaks ?? {}
  const rwNames = (arr: Any): string[] => Array.isArray(arr)
    ? arr.map((x: Any) => (typeof x === 'string' ? x : x?.name)).filter(Boolean) : []

  // Feats / features, flattened with a readable category label.
  const ff = content.feats_features ?? {}
  const featCats: [string, string][] = [
    ['classFeatures', 'Class Feature'], ['classFeats', 'Class Feat'], ['ancestryFeats', 'Ancestry Feat'],
    ['generalAndSkillFeats', 'General / Skill Feat'], ['otherFeats', 'Other'],
  ]
  const feats: { name: string; category: string; level?: number }[] = []
  for (const [key, label] of featCats) {
    const list = ff[key]
    if (Array.isArray(list)) for (const f of list) {
      if (f?.name) feats.push({ name: String(f.name), category: label, level: typeof f.level === 'number' ? f.level : undefined })
    }
  }

  // Weapons / strikes.
  const weaponsRaw: Any[] = Array.isArray(content.weapons) ? content.weapons : []
  const weapons: { name: string; attack?: number; damage?: string }[] = []
  for (const w of weaponsRaw) {
    const nm = w?.item?.name
    if (!nm) continue
    const atk = w?.stats?.attack_bonus?.total
    const attackNum = Array.isArray(atk) ? Number(atk[0]) : (typeof atk === 'number' ? atk : NaN)
    const d = w?.stats?.damage
    let damage: string | undefined
    if (d && (d.die || d.dice)) {
      const bonus = Number(d.bonus?.total ?? 0)
      damage = `${d.dice ?? ''}${d.die ?? ''}${bonus ? (bonus > 0 ? `+${bonus}` : String(bonus)) : ''} ${d.damageType ?? ''}`.trim()
    }
    weapons.push({ name: String(nm), attack: Number.isFinite(attackNum) ? attackNum : undefined, damage })
  }

  const sp = content.spells ?? {}
  const spells = {
    cantrips: names(sp.cantrips),
    spells: names(sp.normal),
    focus: names(content.focus_spells),
    innate: names(content.innate_spells),
  }

  const coins = character.inventory?.coins ?? {}
  const money = {
    cp: Number(coins.cp ?? 0), sp: Number(coins.sp ?? 0),
    gp: Number(coins.gp ?? 0), pp: Number(coins.pp ?? 0),
  }

  const ac = typeof content.ac === 'number' ? content.ac : undefined
  const hpMax = typeof content.max_hp === 'number' ? content.max_hp : undefined
  const level = typeof character.level === 'number' ? character.level : undefined

  const sheet: ImportedSheet = {
    source: 'wanderers-guide',
    importedAt: Date.now(),
    name, level, ancestry, heritage, className, background,
    size: content.size ? String(content.size) : undefined,
    hpCurrent: typeof character.hp_current === 'number' ? character.hp_current : undefined,
    hpMax, hpTemp: typeof character.hp_temp === 'number' ? character.hp_temp : undefined,
    heroPoints: typeof character.hero_points === 'number' ? character.hero_points : undefined,
    ac, perception, saves: { fort, ref, will }, abilities,
    skills, classDC, spellDC, spellAttack, speeds, senses, languages,
    resistances: rwNames(rw.resists), weaknesses: rwNames(rw.weaks), immunities: rwNames(rw.immunes),
    feats, weapons, spells, money,
  }

  // The displayed/editable subset.
  const pcStats: PcStats = {
    ancestryClass: [ancestry, className].filter(Boolean).join(' ') || undefined,
    level, ac, maxHP: hpMax,
    perceptionMod: perception?.mod, perceptionProf: perception?.prof,
    fortMod: fort?.mod, fortProf: fort?.prof,
    refMod: ref?.mod, refProf: ref?.prof,
    willMod: will?.mod, willProf: will?.prof,
    str: abilities.str, dex: abilities.dex, con: abilities.con,
    int: abilities.int, wis: abilities.wis, cha: abilities.cha,
    skills: Object.keys(skills).length ? skills : undefined,
    speed, classDC, spellDC,
    senses: senses.precise.join(', ') || undefined,
    languages: languages.join(', ') || undefined,
  }

  return { ok: true, character: { name, pcStats, sheet } }
}
