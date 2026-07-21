import type { Creature } from '../types/pf2e'

// ─────────────────────────────────────────────────────────────────────────────
// Monster Parts (Remaster Conversion) — imbued properties that FIT a creature.
// Each imbuement's "Parts" requirement is checked against the creature's traits,
// damage types, resistances/immunities, senses, ability mods, speed, etc.
// ─────────────────────────────────────────────────────────────────────────────

export type ImbueGroup =
  | 'Weapon — energy & physical'
  | 'Weapon — spirit & sanctified'
  | 'Weapon — special'
  | 'Armor & shield'
  | 'Perception item'
  | 'Skill item — attribute'
  | 'Skill item — utility'

export interface ImbueMatch {
  name: string
  group: ImbueGroup
  /** Short effect blurb. */
  effect: string
  /** Why it fit this creature (the matched requirement). */
  why: string
}

interface Ctx {
  traits: Set<string>
  dmg: Set<string>        // union of every attack's damage types
  immun: Set<string>
  resist: Set<string>
  senses: string[]        // lowercased sense strings
  fly: boolean
  hardness: boolean
  topAbilities: Set<string> // ability keys >= the 2nd-highest modifier
  hasSkills: boolean
  hasSpells: boolean
  creatureTypes: string[]   // creature-type traits present (for Bane)
}

const CREATURE_TYPES = ['aberration','animal','astral','beast','celestial','construct','dragon','dream','elemental','ethereal','fey','fiend','giant','humanoid','monitor','ooze','plant','fungus','spirit','time','undead']
const SENSE_KEYS = ['low-light vision','greater darkvision','darkvision','scent','truesight','tremorsense','lifesense']

function build(c: Creature): Ctx {
  const traits = new Set(c.traits.map(t => t.toLowerCase()))
  const dmg = new Set<string>()
  for (const a of c.attacks) for (const t of a.types) dmg.add(t.toLowerCase())
  const immun = new Set((c.defenses.immunities ?? []).map(s => s.toLowerCase()))
  const resist = new Set((c.defenses.resistances ?? []).map(r => r.name.toLowerCase()))
  const senses = (c.senses ?? []).map(s => s.toLowerCase())
  const mods: Record<string, number> = { str: c.str, dex: c.dex, con: c.con, int: c.int, wis: c.wis, cha: c.cha }
  const vals = Object.values(mods).sort((a, b) => b - a)
  const threshold = vals[1] ?? vals[0] ?? 0
  const topAbilities = new Set(Object.entries(mods).filter(([, v]) => v >= threshold).map(([k]) => k))
  return {
    traits, dmg, immun, resist, senses,
    fly: c.speed?.fly != null,
    hardness: (c.defenses.hardness ?? 0) > 0,
    topAbilities,
    hasSkills: Object.keys(c.skills ?? {}).length > 0,
    hasSpells: (c.spellcasting ?? []).length > 0,
    creatureTypes: c.traits.map(t => t.toLowerCase()).filter(t => CREATURE_TYPES.includes(t)),
  }
}

const has = (ctx: Ctx, energy: string) => ctx.traits.has(energy) || ctx.dmg.has(energy)
const resistImmune = (ctx: Ctx, names: string[]) => names.some(n => ctx.immun.has(n) || ctx.resist.has(n))
const resistImmuneLike = (ctx: Ctx, sub: string) =>
  [...ctx.immun, ...ctx.resist].some(n => n.includes(sub))

interface Def { name: string; group: ImbueGroup; effect: string; fit: (c: Ctx) => string | null }

const DEFS: Def[] = [
  // Weapon — energy & physical
  { name: 'Acid', group: 'Weapon — energy & physical', effect: 'Vitriolic acid damage.', fit: c => has(c, 'acid') ? whyEnergy(c, 'acid') : null },
  { name: 'Cold', group: 'Weapon — energy & physical', effect: 'Chilling cold damage.', fit: c => has(c, 'cold') ? whyEnergy(c, 'cold') : null },
  { name: 'Electricity', group: 'Weapon — energy & physical', effect: 'Shocking electricity damage.', fit: c => has(c, 'electricity') ? whyEnergy(c, 'electricity') : null },
  { name: 'Fire', group: 'Weapon — energy & physical', effect: 'Burning fire damage.', fit: c => has(c, 'fire') ? whyEnergy(c, 'fire') : null },
  { name: 'Force', group: 'Weapon — energy & physical', effect: 'Pure force damage.', fit: c => has(c, 'force') ? whyEnergy(c, 'force') : null },
  { name: 'Mental', group: 'Weapon — energy & physical', effect: 'Psychic (mental) power.', fit: c => (c.traits.has('astral') || c.traits.has('mental') || c.dmg.has('mental')) ? (c.traits.has('mental') ? 'mental trait' : c.traits.has('astral') ? 'astral trait' : 'deals mental damage') : null },
  { name: 'Poison', group: 'Weapon — energy & physical', effect: 'Toxic venom.', fit: c => has(c, 'poison') ? whyEnergy(c, 'poison') : null },
  { name: 'Sonic', group: 'Weapon — energy & physical', effect: 'Reverberating sound waves.', fit: c => has(c, 'sonic') ? whyEnergy(c, 'sonic') : null },
  // Weapon — spirit & sanctified
  { name: 'Holy', group: 'Weapon — spirit & sanctified', effect: 'Sanctified energy vs. unholy foes (gains holy trait).', fit: c => (c.traits.has('holy') || c.dmg.has('spirit')) ? (c.traits.has('holy') ? 'holy trait' : 'deals spirit damage') : null },
  { name: 'Unholy', group: 'Weapon — spirit & sanctified', effect: 'Profane energy vs. holy foes (gains unholy trait).', fit: c => (c.traits.has('unholy') || c.dmg.has('spirit')) ? (c.traits.has('unholy') ? 'unholy trait' : 'deals spirit damage') : null },
  { name: 'Lawful', group: 'Weapon — spirit & sanctified', effect: 'Rigid law — functions like Holy, themed as order.', fit: c => (c.traits.has('holy') || c.dmg.has('spirit')) ? (c.traits.has('holy') ? 'holy trait' : 'deals spirit damage') : null },
  { name: 'Chaotic', group: 'Weapon — spirit & sanctified', effect: 'Roiling chaos — functions like Unholy, themed as chaos.', fit: c => (c.traits.has('unholy') || c.dmg.has('spirit')) ? (c.traits.has('unholy') ? 'unholy trait' : 'deals spirit damage') : null },
  { name: 'Vitality', group: 'Weapon — spirit & sanctified', effect: 'Cleansing vitality — only harms undead / void-healing.', fit: c => (c.traits.has('holy') || c.dmg.has('vitality')) ? (c.traits.has('holy') ? 'holy trait' : 'deals vitality damage') : null },
  { name: 'Void', group: 'Weapon — spirit & sanctified', effect: 'Void energy, cosmological destruction.', fit: c => (c.traits.has('undead') || c.dmg.has('void')) ? (c.traits.has('undead') ? 'undead / void healing' : 'deals void damage') : null },
  // Weapon — special
  { name: 'Bane', group: 'Weapon — special', effect: 'Choose a creature type and hit it harder.', fit: c => c.creatureTypes.length ? `vs. ${c.creatureTypes.join(' / ')}` : 'choose any creature type' },
  { name: 'Wild', group: 'Weapon — special', effect: 'A chaotic mix of energies (any parts, slightly weaker).', fit: () => 'any parts' },
  // Armor & shield
  { name: 'Energy Resistant', group: 'Armor & shield', effect: 'Gain resistance to a chosen energy type.', fit: c => { const e = ['acid','cold','electricity','fire','force','void','vitality','sonic'].filter(x => c.immun.has(x) || c.resist.has(x)); return e.length ? `resists ${e.join(', ')}` : null } },
  { name: 'Fortification', group: 'Armor & shield', effect: 'Chance to downgrade crit hits (medium/heavy armor).', fit: c => resistImmuneLike(c, 'precision') || resistImmuneLike(c, 'critical') ? 'resists precision / critical hits' : null },
  { name: 'Sturdy', group: 'Armor & shield', effect: 'Raises a shield’s Hardness (and HP/BT).', fit: c => c.hardness ? 'has Hardness' : resistImmune(c, ['physical','bludgeoning','piercing','slashing']) ? 'resists physical damage' : null },
  { name: 'Winged', group: 'Armor & shield', effect: 'Wings sprout from the armor — Soft Landing, then flight.', fit: c => c.fly ? 'has a fly Speed' : null },
  // Perception item
  { name: 'Sensory', group: 'Perception item', effect: 'Extraordinary senses (low-light → truesight by level).', fit: c => { const s = SENSE_KEYS.filter(k => c.senses.some(x => x.includes(k))); return s.length ? `has ${s.join(', ')}` : null } },
  // Skill item — attribute
  { name: 'Charisma', group: 'Skill item — attribute', effect: 'Dazzling charisma (heroism; apex at 17th).', fit: c => c.topAbilities.has('cha') ? 'Cha is a top-2 modifier' : null },
  { name: 'Constitution', group: 'Skill item — attribute', effect: 'Resilient constitution (heal/regenerate; apex at 17th).', fit: c => c.topAbilities.has('con') ? 'Con is a top-2 modifier' : null },
  { name: 'Dexterity', group: 'Skill item — attribute', effect: 'Deft dexterity (Speed, water/air walk; apex at 17th).', fit: c => c.topAbilities.has('dex') ? 'Dex is a top-2 modifier' : null },
  { name: 'Intelligence', group: 'Skill item — attribute', effect: 'Brilliant intelligence (hypercognition; apex at 17th).', fit: c => c.topAbilities.has('int') ? 'Int is a top-2 modifier' : null },
  { name: 'Strength', group: 'Skill item — attribute', effect: 'Ferocious strength (earthbind; apex at 17th).', fit: c => c.topAbilities.has('str') ? 'Str is a top-2 modifier' : null },
  { name: 'Wisdom', group: 'Skill item — attribute', effect: 'Sagacious wisdom (augury/foresight; apex at 17th).', fit: c => c.topAbilities.has('wis') ? 'Wis is a top-2 modifier' : null },
  // Skill item — utility
  { name: 'Spell', group: 'Skill item — utility', effect: 'Imbue the item with a spell (1st rank at 4th, +1 per 2 levels).', fit: c => (c.hasSpells || c.hasSkills) ? (c.hasSpells ? 'casts spells' : 'has trained skills') : null },
]

function whyEnergy(c: Ctx, energy: string): string {
  return c.traits.has(energy) ? `${energy} trait` : `deals ${energy} damage`
}

/** The imbued properties whose "Parts" requirement this creature satisfies. */
export function matchingImbuements(creature: Creature): ImbueMatch[] {
  const ctx = build(creature)
  const out: ImbueMatch[] = []
  for (const d of DEFS) {
    const why = d.fit(ctx)
    if (why != null) out.push({ name: d.name, group: d.group, effect: d.effect, why })
  }
  return out
}

export const IMBUE_GROUP_ORDER: ImbueGroup[] = [
  'Weapon — energy & physical', 'Weapon — spirit & sanctified', 'Weapon — special',
  'Armor & shield', 'Perception item', 'Skill item — attribute', 'Skill item — utility',
]
