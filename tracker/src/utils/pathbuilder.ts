// ── Pathbuilder 2e character import ─────────────────────────────────────────
// Parses a Pathbuilder 2e "Export JSON" (Menu → Export → Export JSON, or the
// "Export to JSON" API). Unlike Wanderer's Guide, Pathbuilder stores the raw
// COMPONENTS — ability scores, proficiency ranks (0/2/4/6/8), HP pieces — and
// leaves the PF2e math to the reader, so we compute the finals here.

import type { PcStats, ProfRank, ImportedSheet, ImportedMod } from './pcDetail'
import type { ImportResult } from './wanderersGuide'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

// Pathbuilder proficiency values are the bonus by rank, level excluded:
// 0 untrained, 2 trained, 4 expert, 6 master, 8 legendary.
function profRank(bonus: number): ProfRank {
  return bonus >= 8 ? 'L' : bonus >= 6 ? 'M' : bonus >= 4 ? 'E' : bonus >= 2 ? 'T' : 'U'
}
const abilityMod = (score: unknown): number =>
  typeof score === 'number' ? Math.floor((score - 10) / 2) : 0

// Skill → governing ability + the lowercase key Pathbuilder uses in `proficiencies`.
const SKILLS: { name: string; key: string; abil: keyof typeof EMPTY_MODS }[] = [
  { name: 'Acrobatics', key: 'acrobatics', abil: 'dex' },
  { name: 'Arcana', key: 'arcana', abil: 'int' },
  { name: 'Athletics', key: 'athletics', abil: 'str' },
  { name: 'Crafting', key: 'crafting', abil: 'int' },
  { name: 'Deception', key: 'deception', abil: 'cha' },
  { name: 'Diplomacy', key: 'diplomacy', abil: 'cha' },
  { name: 'Intimidation', key: 'intimidation', abil: 'cha' },
  { name: 'Medicine', key: 'medicine', abil: 'wis' },
  { name: 'Nature', key: 'nature', abil: 'wis' },
  { name: 'Occultism', key: 'occultism', abil: 'int' },
  { name: 'Performance', key: 'performance', abil: 'cha' },
  { name: 'Religion', key: 'religion', abil: 'wis' },
  { name: 'Society', key: 'society', abil: 'int' },
  { name: 'Stealth', key: 'stealth', abil: 'dex' },
  { name: 'Survival', key: 'survival', abil: 'wis' },
  { name: 'Thievery', key: 'thievery', abil: 'dex' },
]
const EMPTY_MODS = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }

// Senses Pathbuilder lists inside `specials` (it has no dedicated senses field).
const SENSE_PRECISE = new Set(['darkvision', 'greater darkvision', 'low-light vision', 'see invisibility', 'truesight'])
const SENSE_IMPRECISE = new Set(['scent', 'tremorsense', 'echolocation', 'wavesense', 'lifesense', 'motion sense'])

export function parsePathbuilder(raw: unknown): ImportResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'That file isn’t a Pathbuilder export. In Pathbuilder, use Menu → Export → Export JSON.' }
  }
  const root = raw as Any
  const b = root.build
  if (!b || typeof b !== 'object' || typeof b.name !== 'string') {
    return { ok: false, error: 'This doesn’t look like a Pathbuilder JSON (no “build” block). Make sure you used Pathbuilder’s “Export JSON”, not Wanderer’s Guide.' }
  }

  const name = String(b.name).trim() || 'Unnamed'
  const level: number = typeof b.level === 'number' ? b.level : 1

  // Ability modifiers (Pathbuilder stores scores).
  const sc = b.abilities ?? {}
  const mods = {
    str: abilityMod(sc.str), dex: abilityMod(sc.dex), con: abilityMod(sc.con),
    int: abilityMod(sc.int), wis: abilityMod(sc.wis), cha: abilityMod(sc.cha),
  }

  const prof = b.proficiencies ?? {}
  const rankBonus = (key: string): number => (typeof prof[key] === 'number' ? prof[key] : 0)
  // Final check modifier = ability + (trained or better ? level + rank-bonus : 0).
  const total = (rb: number, abil: number): number => (rb > 0 ? abil + level + rb : abil)
  const mkMod = (key: string, abil: number): ImportedMod => {
    const rb = rankBonus(key)
    return { mod: total(rb, abil), prof: profRank(rb) }
  }

  const perception = mkMod('perception', mods.wis)
  const fort = mkMod('fortitude', mods.con)
  const ref = mkMod('reflex', mods.dex)
  const will = mkMod('will', mods.wis)

  // Skills (all 16) + Lores.
  const skills: Record<string, ImportedMod> = {}
  for (const s of SKILLS) skills[s.name] = mkMod(s.key, mods[s.abil])
  if (Array.isArray(b.lores)) {
    for (const lore of b.lores) {
      const lname = Array.isArray(lore) ? lore[0] : lore?.[0]
      const lrank = Array.isArray(lore) ? Number(lore[1]) : 0
      if (typeof lname === 'string' && lname.trim()) {
        skills[`${lname.trim()} Lore`] = { mod: total(lrank || 0, mods.int), prof: profRank(lrank || 0) }
      }
    }
  }

  // Class DC = 10 + key-ability mod + (trained+ ? level + rank : 0).
  const keyAbil = (typeof b.keyability === 'string' ? b.keyability : 'str') as keyof typeof mods
  const classRb = rankBonus('classDC')
  const classDC = 10 + (mods[keyAbil] ?? 0) + (classRb > 0 ? level + classRb : 0)

  // HP = ancestry + (class + Con) × level + flat bonuses.
  const at = b.attributes ?? {}
  const hpMax = (Number(at.ancestryhp) || 0)
    + ((Number(at.classhp) || 0) + mods.con) * level
    + (Number(at.bonushp) || 0) + (Number(at.bonushpPerLevel) || 0) * level
  const speed = (Number(at.speed) || 0) + (Number(at.speedBonus) || 0) || undefined

  const ac = typeof b.acTotal?.acTotal === 'number' ? b.acTotal.acTotal : undefined

  // Spellcasting — take the strongest caster (highest computed DC) for the card.
  let spellDC: number | undefined
  let spellAttack: number | undefined
  const casters: Any[] = Array.isArray(b.spellCasters) ? b.spellCasters : []
  const spells = { cantrips: [] as string[], spells: [] as string[], focus: [] as string[], innate: [] as string[] }
  for (const c of casters) {
    const abil = mods[(c?.ability as keyof typeof mods)] ?? 0
    const rb = typeof c?.proficiency === 'number' ? c.proficiency : 0
    if (rb > 0) {
      const dc = 10 + total(rb, abil)
      if (spellDC == null || dc > spellDC) { spellDC = dc; spellAttack = total(rb, abil) }
    }
    const lists: Any[] = Array.isArray(c?.spells) ? c.spells : []
    for (const entry of lists) {
      const list: string[] = Array.isArray(entry?.list) ? entry.list.filter((x: Any) => typeof x === 'string') : []
      const bucket = c?.innate ? spells.innate : (entry?.spellLevel === 0 ? spells.cantrips : spells.spells)
      for (const nm of list) if (!bucket.includes(nm)) bucket.push(nm)
    }
  }

  // Senses — pulled out of `specials`.
  const specials: string[] = Array.isArray(b.specials) ? b.specials.filter((x: Any) => typeof x === 'string') : []
  const precise: string[] = [], imprecise: string[] = []
  for (const s of specials) {
    const low = s.toLowerCase()
    if (SENSE_PRECISE.has(low)) precise.push(s)
    else if (SENSE_IMPRECISE.has(low)) imprecise.push(s)
  }
  const senses = { precise, imprecise, vague: [] as string[] }

  const languages: string[] = Array.isArray(b.languages)
    ? b.languages.map((l: Any) => String(l)).filter((l: string) => l && l.toLowerCase() !== 'none selected')
    : []

  // Feats + class features (specials that aren't senses/spells).
  const feats: { name: string; category: string; level?: number }[] = []
  if (Array.isArray(b.feats)) {
    for (const f of b.feats) {
      const fn = Array.isArray(f) ? f[0] : f?.name
      if (typeof fn === 'string' && fn.trim()) {
        feats.push({ name: fn, category: (Array.isArray(f) && typeof f[2] === 'string') ? f[2] : 'Feat', level: (Array.isArray(f) && typeof f[3] === 'number') ? f[3] : undefined })
      }
    }
  }

  // Weapons / Strikes (often empty on an unfinished build).
  const weapons: { name: string; attack?: number; damage?: string }[] = []
  if (Array.isArray(b.weapons)) {
    for (const w of b.weapons) {
      const wn = w?.display ?? w?.name
      if (typeof wn !== 'string' || !wn.trim()) continue
      const die = w?.die ?? ''
      const dmgType = w?.damageType ?? ''
      const damage = die ? `${die} ${dmgType}`.trim() : undefined
      weapons.push({ name: String(wn), attack: typeof w?.attack === 'number' ? w.attack : undefined, damage })
    }
  }

  const m = b.money ?? {}
  const money = { cp: Number(m.cp) || 0, sp: Number(m.sp) || 0, gp: Number(m.gp) || 0, pp: Number(m.pp) || 0 }

  const ancestry = b.ancestry ? String(b.ancestry) : undefined
  const heritage = b.heritage ? String(b.heritage) : undefined
  const className = b.class ? String(b.class) : undefined
  const background = b.background ? String(b.background) : undefined

  const sheet: ImportedSheet = {
    source: 'pathbuilder', importedAt: Date.now(),
    name, level, ancestry, heritage, className, background,
    size: b.sizeName ? String(b.sizeName) : undefined,
    hpMax, ac, perception, saves: { fort, ref, will }, abilities: mods,
    skills, classDC, spellDC, spellAttack,
    speeds: speed ? [{ name: 'Land', value: speed }] : [],
    senses, languages, resistances: [], weaknesses: [], immunities: [],
    feats, weapons, spells, money,
  }

  const sensesStr = [...precise, ...imprecise].join(', ') || undefined

  const pcStats: PcStats = {
    ancestryClass: [ancestry, className].filter(Boolean).join(' ') || undefined,
    level, ac, maxHP: hpMax,
    perceptionMod: perception.mod, perceptionProf: perception.prof,
    fortMod: fort.mod, fortProf: fort.prof,
    refMod: ref.mod, refProf: ref.prof,
    willMod: will.mod, willProf: will.prof,
    str: mods.str, dex: mods.dex, con: mods.con, int: mods.int, wis: mods.wis, cha: mods.cha,
    skills: Object.keys(skills).length ? skills : undefined,
    speed, classDC, spellDC,
    senses: sensesStr,
    languages: languages.join(', ') || undefined,
  }

  return { ok: true, character: { name, pcStats, sheet } }
}
