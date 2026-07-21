// ── Player-character detail model ──────────────────────────────────────────
// How much of a PC's PF2e sheet the DM tracks, and the stat shape itself.
// Used by the party store (data) + the settings / party-page detail controls.

export type ProfRank = 'U' | 'T' | 'E' | 'M' | 'L'
export const PROF_RANKS: ProfRank[] = ['U', 'T', 'E', 'M', 'L']
export const PROF_LABEL: Record<ProfRank, string> = {
  U: 'Untrained', T: 'Trained', E: 'Expert', M: 'Master', L: 'Legendary',
}

export interface PcSkill { mod?: number; prof?: ProfRank }

/** Flattened PC stat sheet — every field optional; the DM fills what they want. */
export interface PcStats {
  ancestryClass?: string
  level?: number
  ac?: number
  maxHP?: number
  /** Live current HP, mirrored from the combat tracker when this PC takes
   *  damage/healing there (see combatStore → partyStore.syncCurrentHpByName).
   *  Undefined until they've been in a tracked fight. */
  hpCurrent?: number
  perceptionMod?: number; perceptionProf?: ProfRank
  fortMod?: number; fortProf?: ProfRank
  refMod?: number;  refProf?: ProfRank
  willMod?: number; willProf?: ProfRank
  str?: number; dex?: number; con?: number; int?: number; wis?: number; cha?: number
  skills?: Record<string, PcSkill>
  speed?: number
  classDC?: number
  spellDC?: number
  senses?: string
  languages?: string
}

// ── Full imported sheet ────────────────────────────────────────────────────
// Everything we can pull from a Wanderer's Guide export, kept compact (NOT the
// raw multi-MB file). The displayed PcStats above is a subset; this preserves
// the rest (heritage, feats, weapons, spells, money, …) so nothing is lost
// even when the party's detail level hides it.
export interface ImportedMod { mod: number; prof: ProfRank }
export interface ImportedSheet {
  source: 'wanderers-guide' | 'pathbuilder'
  importedAt: number
  name: string
  level?: number
  ancestry?: string
  heritage?: string
  className?: string
  background?: string
  size?: string
  hpCurrent?: number
  hpMax?: number
  hpTemp?: number
  heroPoints?: number
  ac?: number
  perception?: ImportedMod
  saves?: { fort?: ImportedMod; ref?: ImportedMod; will?: ImportedMod }
  abilities?: Partial<Record<'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha', number>>
  skills?: Record<string, ImportedMod>
  classDC?: number
  spellDC?: number
  spellAttack?: number
  speeds?: { name: string; value: number }[]
  senses?: { precise: string[]; imprecise: string[]; vague: string[] }
  languages?: string[]
  resistances?: string[]
  weaknesses?: string[]
  immunities?: string[]
  feats?: { name: string; category: string; level?: number }[]
  weapons?: { name: string; attack?: number; damage?: string }[]
  spells?: { cantrips: string[]; spells: string[]; focus: string[]; innate: string[] }
  money?: { cp: number; sp: number; gp: number; pp: number }
}

// ── Detail sections (which parts of the sheet are shown) ───────────────────
export type PcDetailSection =
  | 'ancestry' | 'defenses' | 'saves' | 'perception'
  | 'abilities' | 'skills' | 'speedDCs' | 'sensesLangs'

export type PcDetailConfig = Record<PcDetailSection, boolean>

export const PC_DETAIL_SECTIONS: { key: PcDetailSection; label: string; desc: string }[] = [
  { key: 'ancestry',    label: 'Ancestry & class',    desc: 'e.g. "Elf Bard"' },
  { key: 'defenses',    label: 'Defenses',            desc: 'AC · Max HP' },
  { key: 'saves',       label: 'Saving throws',       desc: 'Fort · Ref · Will + proficiency' },
  { key: 'perception',  label: 'Perception',          desc: 'modifier + proficiency' },
  { key: 'abilities',   label: 'Ability modifiers',   desc: 'Str · Dex · Con · Int · Wis · Cha' },
  { key: 'skills',      label: 'Skills',              desc: 'all 16 + proficiency' },
  { key: 'speedDCs',    label: 'Speed & DCs',         desc: 'Speed · Class DC · Spell DC' },
  { key: 'sensesLangs', label: 'Senses & languages',  desc: 'darkvision, languages…' },
]

const mk = (on: PcDetailSection[]): PcDetailConfig => {
  const c = {} as PcDetailConfig
  for (const { key } of PC_DETAIL_SECTIONS) c[key] = on.includes(key)
  return c
}

export const PC_DETAIL_ALL: PcDetailConfig = mk(PC_DETAIL_SECTIONS.map(s => s.key))

export const PC_DETAIL_PRESETS: { id: string; label: string; config: PcDetailConfig }[] = [
  { id: 'everything', label: 'Everything', config: PC_DETAIL_ALL },
  { id: 'combat',     label: 'Combat',     config: mk(['defenses', 'saves', 'perception', 'speedDCs']) },
  { id: 'minimal',    label: 'Minimal',    config: mk(['defenses']) },
  { id: 'nameOnly',   label: 'Name only',  config: mk([]) },
]

/** Which preset (if any) a config exactly matches — for highlighting. */
export function matchPreset(c: PcDetailConfig): string | null {
  for (const p of PC_DETAIL_PRESETS) {
    if (PC_DETAIL_SECTIONS.every(s => !!c[s.key] === !!p.config[s.key])) return p.id
  }
  return null
}

export const PC_SKILLS = [
  'Acrobatics', 'Arcana', 'Athletics', 'Crafting', 'Deception', 'Diplomacy',
  'Intimidation', 'Medicine', 'Nature', 'Occultism', 'Performance', 'Religion',
  'Society', 'Stealth', 'Survival', 'Thievery',
]

export const ABILITIES: { key: keyof PcStats; label: string }[] = [
  { key: 'str', label: 'STR' }, { key: 'dex', label: 'DEX' }, { key: 'con', label: 'CON' },
  { key: 'int', label: 'INT' }, { key: 'wis', label: 'WIS' }, { key: 'cha', label: 'CHA' },
]
