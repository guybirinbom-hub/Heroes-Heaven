/*
 * Modes — user-defined, toggleable sets of bonuses/penalties (Raise a Shield, Inspire
 * Courage, a homebrew effect, …). An UNCONDITIONAL modifier (no "applies when" text) folds
 * into the targeted stat's number with PF2e stacking; a CONDITIONAL one doesn't change the
 * number — it underlines the stat and is shown (with its "applies when") in the breakdown.
 */
import type { ContentDatabase, DefenseGrants, Item, ModeDef, ModeModifier, ModeTargetKind } from './types';
import { ABILITIES, SAVES, SKILLS } from './types';

/** A stat being computed, matched against a modifier's target. */
export interface ModeTarget {
  kind: Exclude<ModeTargetKind, 'all-checks'>;
  /** save id (fortitude/reflex/will) or skill key (e.g. 'stealth'). */
  detail?: string;
}

/** The selectable targets in the mode editor. */
export const MODE_TARGETS: { kind: ModeTargetKind; label: string; needsDetail?: 'save' | 'skill' | 'ability' }[] = [
  { kind: 'all-checks', label: 'All checks (attacks, saves, skills, Perception)' },
  { kind: 'ac', label: 'Armor class' },
  { kind: 'save', label: 'Saving throw', needsDetail: 'save' },
  { kind: 'perception', label: 'Perception' },
  { kind: 'skill', label: 'Skill', needsDetail: 'skill' },
  { kind: 'attack', label: 'Attack rolls' },
  { kind: 'damage', label: 'Damage rolls' },
  { kind: 'spell-attack', label: 'Spell attack' },
  { kind: 'spell-dc', label: 'Spell DC' },
  { kind: 'class-dc', label: 'Class DC' },
  { kind: 'speed', label: 'Speed' },
  { kind: 'max-hp', label: 'Maximum HP' },
  { kind: 'initiative', label: 'Initiative' },
  { kind: 'ability', label: 'Attribute modifier', needsDetail: 'ability' },
];

/**
 * Every target as ONE flat, searchable entry — "Reflex save" and "Stealth" and "Strength" each in their
 * own right, rather than "Saving throw" plus a second dropdown to say which.
 *
 * `value` is the stable key the picker round-trips (`kind` or `kind:detail`); build it with targetKey
 * and read it back with parseTargetKey. Lores are deliberately absent: the set is per-character, so the
 * editor appends the ones this character actually has.
 */
export interface ModeTargetOption {
  value: string;
  label: string;
  /** A coarse heading for the picker, purely presentational. */
  group: string;
  kind: ModeTargetKind;
  detail?: string;
  /** Extra words the search matches on top of the label. */
  alias?: string;
}

export const targetKey = (kind: ModeTargetKind, detail?: string): string => (detail ? `${kind}:${detail}` : kind);

export function parseTargetKey(key: string): { kind: ModeTargetKind; detail?: string } {
  const i = key.indexOf(':');
  if (i < 0) return { kind: key as ModeTargetKind };
  // A lore skill's own key contains a colon ('lore:warfare'), so only the FIRST one separates.
  return { kind: key.slice(0, i) as ModeTargetKind, detail: key.slice(i + 1) };
}

const ABILITY_NAME: Record<string, string> = {
  str: 'Strength',
  dex: 'Dexterity',
  con: 'Constitution',
  int: 'Intelligence',
  wis: 'Wisdom',
  cha: 'Charisma',
};
const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The flat target list. `lores` are this character's own Lore keys ('lore:warfare'), appended so a
 *  mode can point at one; pass none for a generic (character-less) editor such as Settings → Modes. */
export function modeTargetOptions(lores: string[] = []): ModeTargetOption[] {
  const out: ModeTargetOption[] = [
    { value: 'all-checks', label: 'All checks', group: 'Broad', kind: 'all-checks', alias: 'everything attacks saves skills perception' },
    { value: 'ac', label: 'Armor class', group: 'Defence', kind: 'ac', alias: 'ac defence defense' },
    { value: 'max-hp', label: 'Maximum HP', group: 'Defence', kind: 'max-hp', alias: 'hit points health' },
    { value: 'perception', label: 'Perception', group: 'Checks', kind: 'perception', alias: 'notice senses' },
    { value: 'initiative', label: 'Initiative', group: 'Checks', kind: 'initiative', alias: 'turn order' },
    { value: 'attack', label: 'Attack rolls', group: 'Offence', kind: 'attack', alias: 'to hit strike' },
    { value: 'damage', label: 'Damage rolls', group: 'Offence', kind: 'damage' },
    { value: 'spell-attack', label: 'Spell attack', group: 'Offence', kind: 'spell-attack', alias: 'casting' },
    { value: 'spell-dc', label: 'Spell DC', group: 'Offence', kind: 'spell-dc', alias: 'casting difficulty' },
    { value: 'class-dc', label: 'Class DC', group: 'Offence', kind: 'class-dc' },
    { value: 'speed', label: 'Speed', group: 'Movement', kind: 'speed', alias: 'walk land movement feet' },
    // Each save on its own, rather than "Saving throw" plus a second control to say which.
    { value: 'save', label: 'All saving throws', group: 'Saves', kind: 'save', alias: 'saves' },
    ...SAVES.map((s) => ({ value: targetKey('save', s), label: `${titleCase(s)} save`, group: 'Saves', kind: 'save' as const, detail: s })),
    { value: 'skill', label: 'All skills', group: 'Skills', kind: 'skill' },
    ...SKILLS.map((s) => ({ value: targetKey('skill', s), label: titleCase(s), group: 'Skills', kind: 'skill' as const, detail: s })),
    ...lores.map((k) => ({ value: targetKey('skill', k), label: `${titleCase(k.slice(5))} Lore`, group: 'Skills', kind: 'skill' as const, detail: k, alias: 'lore' })),
    // An attribute modifier carries into everything derived from it (see abilityModOf in derive).
    ...ABILITIES.map((a) => ({
      value: targetKey('ability', a),
      label: `${ABILITY_NAME[a]} modifier`,
      group: 'Attributes',
      kind: 'ability' as const,
      detail: a,
      alias: `${a} attribute ability score`,
    })),
  ];
  return out;
}

export const MODIFIER_TYPES: ModeModifier['type'][] = ['status', 'circumstance', 'item', 'untyped'];

/** The d20 rolls a character makes — what an "all checks" bonus (e.g. Heroism) applies to. It does
 *  NOT include damage, AC, or the DCs the character imposes (spell DC / class DC); those are not checks. */
const ALL_CHECK_KINDS: ModeTarget['kind'][] = ['attack', 'spell-attack', 'save', 'perception', 'skill'];

/** Does a modifier apply to the stat being computed? `all-checks` hits every check the character rolls
 *  (attacks/saves/skills/Perception/spell attacks) but not damage, AC, or imposed DCs; save/skill match
 *  by detail (empty detail = all of that kind). */
function modeMatches(mod: ModeModifier, target: ModeTarget): boolean {
  if (mod.target === 'all-checks') return ALL_CHECK_KINDS.includes(target.kind);
  if (mod.target !== target.kind) return false;
  // Detail-bearing kinds: an empty detail means "all of this kind" (all saves / all skills), a set one
  // must match. `ability` always names one attribute — a blanket +1 to every attribute isn't a thing.
  if (mod.target === 'save' || mod.target === 'skill') return !mod.detail || mod.detail === target.detail;
  if (mod.target === 'ability') return mod.detail === target.detail;
  return true;
}

/** Net UNCONDITIONAL mode modifier for a stat, with PF2e stacking (best bonus + worst
 *  penalty per type; untyped sums). Conditional modifiers are excluded (player applies them). */
export function modeNumberBonus(modes: ModeDef[] | undefined, target: ModeTarget): number {
  if (!modes?.length) return 0;
  const bonus: Record<string, number> = { status: 0, circumstance: 0, item: 0 };
  const penalty: Record<string, number> = { status: 0, circumstance: 0, item: 0 };
  let untyped = 0;
  for (const m of modes) {
    for (const mod of m.modifiers) {
      if (mod.appliesWhen) continue;
      if (!modeMatches(mod, target)) continue;
      if (mod.type === 'untyped') untyped += mod.value;
      else if (mod.value >= 0) bonus[mod.type] = Math.max(bonus[mod.type], mod.value);
      else penalty[mod.type] = Math.max(penalty[mod.type], -mod.value);
    }
  }
  return bonus.status - penalty.status + (bonus.circumstance - penalty.circumstance) + (bonus.item - penalty.item) + untyped;
}

/** A single typed modifier for the cross-source pool (best-bonus + worst-penalty per type). */
export interface TypedMod {
  type: ModeModifier['type'];
  value: number;
}

/** The UNCONDITIONAL mode modifiers targeting a stat, as raw typed mods for the cross-source pool
 *  (so a mode's item bonus can be compared against a gear item bonus rather than blindly added). */
export function modeTypedMods(modes: ModeDef[] | undefined, target: ModeTarget): TypedMod[] {
  const out: TypedMod[] = [];
  for (const m of modes ?? []) {
    for (const mod of m.modifiers) {
      if (mod.appliesWhen) continue;
      if (!modeMatches(mod, target)) continue;
      out.push({ type: mod.type, value: mod.value });
    }
  }
  return out;
}

/** Pool typed modifiers with PF2e stacking ACROSS sources: best bonus + worst penalty PER TYPE
 *  (status / circumstance / item each capped once), untyped sums. This is the one place same-type
 *  bonuses/penalties from independent sources (gear, ABP, modes, conditions, stances) are reconciled
 *  so two "+1 item" bonuses don't become +2. */
export function poolTypedMods(mods: TypedMod[]): number {
  const bonus: Record<string, number> = { status: 0, circumstance: 0, item: 0 };
  const penalty: Record<string, number> = { status: 0, circumstance: 0, item: 0 };
  let untyped = 0;
  for (const m of mods) {
    if (!m.value) continue;
    if (m.type === 'untyped') untyped += m.value;
    else if (m.value >= 0) bonus[m.type] = Math.max(bonus[m.type], m.value);
    else penalty[m.type] = Math.max(penalty[m.type], -m.value);
  }
  return bonus.status - penalty.status + (bonus.circumstance - penalty.circumstance) + (bonus.item - penalty.item) + untyped;
}

/** All active-mode modifiers (conditional + unconditional) that target a stat, tagged with
 *  the mode they came from — for the stat-detail breakdown. */
export function modeModifiersFor(modes: ModeDef[] | undefined, target: ModeTarget): { mode: string; mod: ModeModifier }[] {
  const out: { mode: string; mod: ModeModifier }[] = [];
  for (const m of modes ?? []) for (const mod of m.modifiers) if (modeMatches(mod, target)) out.push({ mode: m.name, mod });
  return out;
}

/** Whether any active CONDITIONAL modifier targets the stat (drives the underline cue). */
export function hasConditionalMode(modes: ModeDef[] | undefined, target: ModeTarget): boolean {
  return (modes ?? []).some((m) => m.modifiers.some((mod) => mod.appliesWhen && modeMatches(mod, target)));
}

const m = (
  value: number,
  type: ModeModifier['type'],
  target: ModeTargetKind,
  extra: Partial<ModeModifier> = {},
): ModeModifier => ({ value, type, target, ...extra });

/**
 * Built-in predefined modes — common combat states plus iconic class/ancestry toggle effects.
 * These are directly toggleable in the Modes panel (gated by the character's class/ancestry where
 * applicable) AND usable as templates in the mode editor. Where a Remaster effect is a clean
 * numeric bonus it's encoded as a modifier; where it's variable/non-numeric (stances, attunements,
 * apparitions) it's a toggle state with a descriptive `note` rather than an invented number.
 */
const RAW_MODES: ModeDef[] = [
  // ---- General combat states (any character) ----
  { id: 'cat-raise-shield', name: 'Raise a Shield', category: 'General', modifiers: [m(2, 'circumstance', 'ac')] },
  { id: 'cat-take-cover', name: 'Take Cover (standard)', category: 'General', modifiers: [m(2, 'circumstance', 'ac'), m(2, 'circumstance', 'save', { detail: 'reflex' })] },
  { id: 'cat-greater-cover', name: 'Take Cover (greater)', category: 'General', modifiers: [m(4, 'circumstance', 'ac'), m(4, 'circumstance', 'save', { detail: 'reflex' })] },
  { id: 'cat-aid', name: 'Aid', category: 'General', modifiers: [m(1, 'circumstance', 'all-checks', { appliesWhen: 'an ally successfully Aids this check' })] },
  { id: 'cat-bless', name: 'Bless', category: 'Divine', modifiers: [m(1, 'status', 'attack')], note: 'Allies in the aura gain a +1 status bonus to attack rolls.' },
  { id: 'cat-heroism', name: 'Heroism (4th)', category: 'Divine', modifiers: [m(1, 'status', 'all-checks')], note: 'A +1 status bonus to attack rolls, Perception, saving throws, and skill checks (+2 at 7th, +3 at 10th).' },

  // ---- Barbarian — rage states (one at a time) ----
  { id: 'cat-rage', name: 'Rage', category: 'Barbarian', classes: ['barbarian'], exclusiveGroup: 'barbarian-rage', modifiers: [m(2, 'untyped', 'damage', { appliesWhen: 'melee or unarmed Strikes while raging' })], note: 'Gain temporary Hit Points and +2 damage on melee & unarmed Strikes (more at higher levels). You can’t use concentrate actions (except Seek) while raging.' },
  { id: 'cat-rage-legacy', name: 'Rage (legacy)', category: 'Barbarian', classes: ['barbarian'], exclusiveGroup: 'barbarian-rage', modifiers: [m(2, 'untyped', 'damage', { appliesWhen: 'melee or unarmed Strikes while raging' }), m(-1, 'untyped', 'ac')], note: 'Pre-Remaster Rage: +2 Strike damage and a −1 penalty to AC while raging.' },
  // Rotting Rage (Decay) and Wooden Rage (Ligneous) are the instinct abilities of PF #202's two
  // instincts, and both are a CHOICE made as the rage begins: "you can choose to increase the
  // additional damage from Rage from 2 to 6". Both shipped as copies of the generic rage template —
  // +2 damage and a placeholder note — so the trade the whole ability consists of (the bigger die for
  // a real cost) reached the sheet as an ordinary Rage. The damage is 6 because these REPLACE the
  // base rage state (one `barbarian-rage` mode at a time), not stack with it.
  { id: 'cat-rotting-rage', name: 'Rotting Rage', category: 'Barbarian', classes: ['barbarian'], feats: ['decay-instinct'], exclusiveGroup: 'barbarian-rage', modifiers: [m(6, 'untyped', 'damage', { appliesWhen: 'melee or unarmed Strikes while raging (poison damage instead of the weapon’s type)' })], note: 'Decay: Rage’s additional damage becomes 6 and its type becomes poison; your Rage action gains the primal and poison traits. You take 1 damage at the end of each of your turns, which can’t be reduced or avoided by any means. With weapon specialization the damage is 10 and you take 5; with greater weapon specialization it is 18 and you take 10. Chosen only as the rage begins, and it lasts until the rage ends.' },
  { id: 'cat-wooden-rage', name: 'Wooden Rage', category: 'Barbarian', classes: ['barbarian'], feats: ['ligneous-instinct'], exclusiveGroup: 'barbarian-rage', modifiers: [m(6, 'untyped', 'damage', { appliesWhen: 'melee or unarmed Strikes while raging' }), m(-10, 'untyped', 'speed')], note: 'Ligneous: Rage’s additional damage becomes 6, and the bark plates reduce your Speed by 10 feet. That reduction can’t be overcome by any means, though it can be offset by Speed increases. With weapon specialization the damage is 10; with greater weapon specialization, 18.' },

  // ---- Bard — compositions (one at a time) ----
  { id: 'cat-inspire-courage', name: 'Courageous Anthem', category: 'Bard', classes: ['bard'], exclusiveGroup: 'bard-composition', modifiers: [m(1, 'status', 'attack'), m(1, 'status', 'damage'), m(1, 'status', 'save', { detail: 'will', appliesWhen: 'vs fear effects' })], note: 'Allies gain a +1 status bonus to attack rolls, damage rolls, and saves vs fear.' },
  { id: 'cat-rallying-anthem', name: 'Rallying Anthem', category: 'Bard', classes: ['bard'], exclusiveGroup: 'bard-composition', modifiers: [m(1, 'status', 'ac'), m(1, 'status', 'save')], note: 'Allies gain a +1 status bonus to AC and saving throws.' },
  { id: 'cat-song-of-strength', name: 'Song of Strength', category: 'Bard', classes: ['bard'], exclusiveGroup: 'bard-composition', modifiers: [m(1, 'status', 'skill', { detail: 'athletics' })], note: 'Allies gain a +1 status bonus to Strength-based checks (Athletics, Escape, etc.).' },
  /* *"You and all allies in the area gain a +10-foot status bonus to all Speeds for 1 round."* The
   * toggle shipped with NO modifiers, so a bard who switched this composition on saw their own Speed
   * unchanged — while its three siblings on the surrounding lines all apply their bonus to the
   * character. "Allies" in the old note was also wrong: the spell says "You and all allies". */
  { id: 'cat-triple-time', name: 'Triple Time', category: 'Bard', classes: ['bard'], exclusiveGroup: 'bard-composition', modifiers: [m(10, 'status', 'speed')], note: 'You and allies gain a +10-foot status bonus to all Speeds.' },

  // ---- Oracle — cursebound stages (one at a time) ----
  { id: 'cat-cursebound-1', name: 'Cursebound One', category: 'Oracle', classes: ['oracle'], exclusiveGroup: 'oracle-cursebound', modifiers: [], note: 'Curse escalated to stage 1 — apply your mystery’s stage-1 curse effects.' },
  { id: 'cat-cursebound-2', name: 'Cursebound Two', category: 'Oracle', classes: ['oracle'], exclusiveGroup: 'oracle-cursebound', modifiers: [], note: 'Curse escalated to stage 2 — apply your mystery’s stage-2 curse effects.' },
  { id: 'cat-cursebound-3', name: 'Cursebound Three', category: 'Oracle', classes: ['oracle'], exclusiveGroup: 'oracle-cursebound', modifiers: [], note: 'Curse escalated to stage 3 — apply your mystery’s stage-3 curse effects.' },
  { id: 'cat-cursebound-4', name: 'Cursebound Four', category: 'Oracle', classes: ['oracle'], exclusiveGroup: 'oracle-cursebound', modifiers: [], note: 'Curse at its most extreme stage — apply your mystery’s final curse effects.' },

  // ---- Solarian — attunements (one at a time; not yet in the bundled data, shown under "show all") ----
  { id: 'cat-photon-attuned', name: 'Photon-Attuned', category: 'Solarian', classes: ['solarian'], exclusiveGroup: 'solarian-attunement', modifiers: [], note: 'Offensive attunement — your solarian abilities favour fire/light and dealing damage.' },
  { id: 'cat-graviton-attuned', name: 'Graviton-Attuned', category: 'Solarian', classes: ['solarian'], exclusiveGroup: 'solarian-attunement', modifiers: [], note: 'Defensive attunement — your solarian abilities favour protection and control.' },
  { id: 'cat-perfectly-attuned', name: 'Perfectly-Attuned', category: 'Solarian', classes: ['solarian'], exclusiveGroup: 'solarian-attunement', modifiers: [], note: 'Peak attunement — gain the benefits of both photon and graviton modes.' },
  { id: 'cat-photon-attunement', name: 'Photon Attunement', category: 'Solarian', classes: ['solarian'], exclusiveGroup: 'solarian-attunement', modifiers: [], note: 'Playtest version of the offensive attunement.' },
  { id: 'cat-graviton-attunement', name: 'Graviton Attunement', category: 'Solarian', classes: ['solarian'], exclusiveGroup: 'solarian-attunement', modifiers: [], note: 'Playtest version of the defensive attunement.' },

  // ---- Inventor — overdrive (one at a time) ----
  { id: 'cat-overdrive', name: 'Overdrive', category: 'Inventor', classes: ['inventor'], exclusiveGroup: 'inventor-overdrive', modifiers: [], note: 'While overdriven, your attacks deal extra damage scaling with your Crafting proficiency.' },
  { id: 'cat-critical-overdrive', name: 'Critical Overdrive', category: 'Inventor', classes: ['inventor'], exclusiveGroup: 'inventor-overdrive', modifiers: [], note: 'A critical Overdrive: greater extra damage, plus resistance to your inventor’s damage type.' },

  // ---- Swashbuckler — panache ----
  { id: 'cat-panache', name: 'Panache', category: 'Swashbuckler', classes: ['swashbuckler'], exclusiveGroup: 'swashbuckler-panache', modifiers: [], note: 'You have panache: a status bonus to Speed (+5 ft, more at higher levels) and access to finishers and panache-only actions.' },
  { id: 'cat-panache-legacy', name: 'Panache (legacy)', category: 'Swashbuckler', classes: ['swashbuckler'], exclusiveGroup: 'swashbuckler-panache', modifiers: [], note: 'Pre-Remaster panache: a status bonus to Speed and to certain Acrobatics/Athletics actions.' },

  // ---- Magus ----
  { id: 'cat-arcane-cascade', name: 'Arcane Cascade', category: 'Magus', classes: ['magus'], modifiers: [m(1, 'untyped', 'damage', { appliesWhen: 'your Strikes while in Arcane Cascade stance' })], note: 'Stance: your Strikes deal +1 extra damage (+2 if expert in your tradition), of a type tied to your last spell.' },
  /*
   * *"While you're in Arcane Cascade stance, your staff gains the deadly d6 trait, with the damage from
   * the deadly die being the same damage type as the extra damage from Arcane Cascade."*
   *
   * A SEPARATE toggle rather than a clause of Arcane Cascade above: the stance is the requirement, the
   * trait comes from a feat, and a magus who never took Student of the Staff must not have their staff
   * gain deadly d6 for entering the stance. Exactly the reasoning Invoke Offense already uses.
   *
   * The record itself carries only `critSpec`/`critSpecWeapons`, which cover its FIRST sentence; the
   * deadly die had no carrier at all, so a staff crit never picked up the extra die.
   */
  {
    id: 'cat-student-of-the-staff',
    name: 'Student of the Staff',
    category: 'Magus',
    feats: ['student-of-the-staff'],
    modifiers: [],
    note: "While you're in Arcane Cascade stance, your staff gains deadly d6; the deadly die's damage type matches Arcane Cascade's extra damage.",
    weaponTraits: { match: { items: ['staff'] }, add: ['deadly-d6'] },
  },

  // ---- Monk ----
  { id: 'cat-mountain-stance', name: 'Mountain Stance', category: 'Monk', classes: ['monk'], modifiers: [], note: 'Stance (incl. the Supported Armor version): falling-stone unarmed Strikes and a strong defensive posture; apply the stance’s AC effect per its rules.' },

  // ---- Psychic ----
  { id: 'cat-unleash-psyche', name: 'Unleash Psyche', category: 'Psychic', classes: ['psychic'], modifiers: [], note: 'Surge: for the duration your psychic spells gain extra power; afterward you’re slowed 1 for 2 rounds.' },

  // ---- Animist — primary apparition attunements (one at a time) ----
  { id: 'cat-app-crafter', name: 'Crafter in the Vault', category: 'Animist (apparitions)', classes: ['animist'], exclusiveGroup: 'animist-apparition', modifiers: [], note: 'Primary apparition (creation & craft) — grants its vessel spells and attunement benefit.' },
  { id: 'cat-app-custodian', name: 'Custodian of Groves and Gardens', category: 'Animist (apparitions)', classes: ['animist'], exclusiveGroup: 'animist-apparition', modifiers: [], note: 'Primary apparition (nature & growth) — grants its vessel spells and attunement benefit.' },
  { id: 'cat-app-echo', name: 'Echo of Lost Moments', category: 'Animist (apparitions)', classes: ['animist'], exclusiveGroup: 'animist-apparition', modifiers: [], note: 'Primary apparition (time & memory) — grants its vessel spells and attunement benefit.' },
  { id: 'cat-app-impostor', name: 'Impostor in Hidden Places', category: 'Animist (apparitions)', classes: ['animist'], exclusiveGroup: 'animist-apparition', modifiers: [], note: 'Primary apparition (trickery & secrets) — grants its vessel spells and attunement benefit.' },
  { id: 'cat-app-lurker', name: 'Lurker in Devouring Dark', category: 'Animist (apparitions)', classes: ['animist'], exclusiveGroup: 'animist-apparition', modifiers: [], note: 'Primary apparition (darkness & fear) — grants its vessel spells and attunement benefit.' },
  { id: 'cat-app-monarch', name: 'Monarch of the Fey Courts', category: 'Animist (apparitions)', classes: ['animist'], exclusiveGroup: 'animist-apparition', modifiers: [], note: 'Primary apparition (fey & enchantment) — grants its vessel spells and attunement benefit.' },
  { id: 'cat-app-reveler', name: 'Reveler in Lost Glee', category: 'Animist (apparitions)', classes: ['animist'], exclusiveGroup: 'animist-apparition', modifiers: [], note: 'Primary apparition (joy & chaos) — grants its vessel spells and attunement benefit.' },
  { id: 'cat-app-stalker', name: 'Stalker in Darkened Boughs', category: 'Animist (apparitions)', classes: ['animist'], exclusiveGroup: 'animist-apparition', modifiers: [], note: 'Primary apparition (the hunt & wilds) — grants its vessel spells and attunement benefit.' },
  { id: 'cat-app-steward', name: 'Steward of Stone and Fire', category: 'Animist (apparitions)', classes: ['animist'], exclusiveGroup: 'animist-apparition', modifiers: [], note: 'Primary apparition (earth & fire) — grants its vessel spells and attunement benefit.' },
  { id: 'cat-app-vanguard', name: 'Vanguard of Roaring Waters', category: 'Animist (apparitions)', classes: ['animist'], exclusiveGroup: 'animist-apparition', modifiers: [], note: 'Primary apparition (water & storms) — grants its vessel spells and attunement benefit.' },
  { id: 'cat-app-witness', name: 'Witness to Ancient Battles', category: 'Animist (apparitions)', classes: ['animist'], exclusiveGroup: 'animist-apparition', modifiers: [], note: 'Primary apparition (war & weapons) — grants its vessel spells and attunement benefit.' },

  /*
   * ---- Ancestry shapes/states ----
   *
   * ⚠ `ancestries` is matched against `character.ancestryId`, a core.json ancestry KEY. None of
   * `werecreature`, `dragonkin` or `ikeshti` is an ancestry we ship (nor a heritage), so all four of
   * these modes were gated on a value no character can hold and could never be offered to anyone.
   *
   * The werecreature pair is GONE from here. Re-gating them onto the dedication made them reachable,
   * which then showed what they actually were: `modifiers: []` and no `battleForm` — prose pretending
   * to be a toggle, one generic "Animal Shape" for all nine printed types. Change Shape *"grants a
   * movement speed, unarmed attacks, and potentially other abilities based on your werecreature type"*,
   * so the real thing is eighteen forms (nine types x animal/hybrid) with per-type speeds, and those
   * live in `scripts/data/toggle-modes.json` beside the other sixteen battle forms. They gate on
   * `werecreature-dedication:<type>`, which `modeGateIds()` resolves from the record's own answer, so a
   * werebat is offered the bat's two shapes and not the werewolf's.
   *
   * The other two below have NO record of any kind on our side, so their gate is left naming the
   * ancestry it awaits: when that content ships they light up, and until then the gate names honestly
   * what is missing rather than pretending to be live.
   */
  // AWAITING CONTENT: no dragonkin ancestry, heritage or feat ships today.
  { id: 'cat-size-ancients', name: 'Size of the Ancients', category: 'Dragonkin', ancestries: ['dragonkin'], modifiers: [], note: 'Grow to Large size for a time, with the usual reach and Strike benefits.' },
  // AWAITING CONTENT: no ikeshti ancestry, heritage or feat ships today.
  { id: 'cat-rivener-state', name: 'Rivener State', category: 'Ikeshti', ancestries: ['ikeshti'], modifiers: [], note: 'Enter your feral rivener state.' },
  /* (No Dampening Harmonics here: the Hardshell Surki's force field already ships complete in
   * `scripts/data/toggle-modes.json` — gate, duration, and the `against`-qualified resistance 10 — and
   * that file is merged into `core.modes`. A second copy in this catalogue would put two identical
   * toggles in front of the player.) */

  // ---- Archetype trances/forms (gated to the dedication that grants them) ----
  { id: 'cat-spirit-trance', name: 'Spirit Trance', category: 'Archetype', feats: ['rivethun-invoker-dedication'], modifiers: [], note: 'Rivethun Invoker (Divine Mysteries): enter a trance to commune with spirits.' },
  // Its own toggle rather than a clause of Spirit Trance: the trance is only the REQUIREMENT, the
  // attack comes from a separate feat, and a Rivethun invoker who never took Invoke Offense must not
  // gain a Strike for entering a trance.
  {
    id: 'cat-invoke-offense',
    name: 'Invoke Offense',
    category: 'Archetype',
    feats: ['invoke-offense'],
    modifiers: [],
    duration: 'for the duration of your spirit trance',
    note: 'A manifested spirit attack. Requires that you are under the effects of Enter Spirit Trance.',
    grantedStrikes: [
      {
        name: 'Spirit attack',
        dice: 1,
        die: 'd8',
        damageType: 'spirit',
        group: 'brawling',
        traits: ['agile', 'finesse', 'magical'],
        // "At 5th level, this unarmed attack gains the benefits of a striking rune. At 12th level, a
        // greater striking rune. At 20th level, a major striking rune."
        strikingByLevel: [
          { level: 5, extraDice: 1 },
          { level: 12, extraDice: 2 },
          { level: 20, extraDice: 3 },
        ],
      },
    ],
  },
  { id: 'cat-sentinel-form', name: 'Sentinel Form', category: 'Archetype', feats: ['starlit-sentinel-dedication'], modifiers: [], note: 'Starlit Sentinel (Tian Xia): assume your sentinel form.' },
  /*
   * The trance shipped with NO modifiers and a note carrying none of the printed numbers, so a
   * sleepwalker who switched it on saw nothing change. Printed (Daydream Trance): *"You gain a +1
   * status bonus to Will saves. This bonus increases to +2 against mental effects. If you're legendary
   * in Occultism, the bonus against mental effects increases to +3."* and *"You take a –1 penalty to
   * Perception checks and initiative rolls."*
   *
   * The mental step is a SECOND status entry rather than a bigger single one: status bonuses do not
   * stack, the higher applies, and the legendary rung is carried in `appliesWhen` because it depends
   * on a proficiency the mode cannot read.
   */
  {
    id: 'cat-daydream-trance',
    name: 'Daydream Trance',
    category: 'Archetype',
    feats: ['sleepwalker-dedication'],
    modifiers: [
      m(1, 'status', 'save', { detail: 'will' }),
      m(2, 'status', 'save', { detail: 'will', appliesWhen: 'against mental effects (+3 instead if you are legendary in Occultism)' }),
      m(-1, 'untyped', 'perception'),
      m(-1, 'untyped', 'initiative'),
    ],
    note: 'Sleepwalker (Dark Archive): +1 status to Will saves (+2 vs mental effects, +3 if legendary in Occultism); −1 to Perception checks and initiative. Lasts 1 minute.',
  },
  /*
   * TWO TRANSFORMATIONS whose whole content is the attacks they grant.
   *
   * A printed attack that lasts "for the next minute" or "while transformed" is not a `grantedStrikes`
   * on the record — that would hand it to the character permanently — and neither feat is a stance, so
   * the stance lane could not hold it either. A toggle is what the app already has for "this is on
   * right now", and it is where Invoke Offense above puts exactly the same thing.
   *
   * Measured before authoring: 12 records in the database print an unarmed attack and ship none
   * anywhere. Two are feats and are here; eight are items and are in consumable-modes.json; one
   * (Horn of the Aoyin) grants the attack to the creatures its curse AFFECTS rather than to the
   * wielder, so it is not a player grant at all; the last three are the Tooth and Claw Tattoos, whose
   * attack has "the same damage as your best unarmed attack" — a mirror no strike field can state.
   */
  {
    id: 'cat-ursine-avenger-form',
    name: 'Ursine Avenger Form',
    category: 'Archetype',
    feats: ['ursine-avenger-form'],
    modifiers: [],
    note: 'While transformed you cannot speak complex sentences, so effects needing a shared or spoken language are unavailable.',
    grantedStrikes: [
      { name: 'Jaws', dice: 1, die: 'd8', damageType: 'piercing', group: 'brawling', traits: ['unarmed'] },
      { name: 'Claws', dice: 1, die: 'd6', damageType: 'slashing', group: 'brawling', traits: ['agile', 'unarmed'] },
    ],
  },
  {
    id: 'cat-howling-aspect',
    name: 'Howling Aspect',
    category: 'Ancestry',
    feats: ['howling-aspect'],
    modifiers: [],
    note: 'Yaksha (Tian Xia): 1 minute, once per 10 minutes.',
    grantedStrikes: [
      { name: 'Tusks', dice: 1, die: 'd6', damageType: 'piercing', group: 'brawling', traits: ['finesse', 'unarmed'] },
      { name: 'Flame-hair', dice: 1, die: 'd4', damageType: 'fire', group: 'brawling', traits: ['agile', 'finesse', 'unarmed'] },
    ],
  },
];

/** All predefined modes (every catalog entry is directly toggleable + usable as a template). */
export const CATALOG_MODES: ModeDef[] = RAW_MODES.map((d) => ({ predefined: true, ...d }));

/** Catalog keyed by id (for content merge). */
export const CATALOG_MODE_MAP: Record<string, ModeDef> = Object.fromEntries(CATALOG_MODES.map((d) => [d.id, d]));

/**
 * Does any ACTIVE mode touch this stat?
 *
 * The sheet already flagged CONDITIONAL mode modifiers — the ones that don't change the number.
 * An unconditional one silently moved the total and marked nothing, so a player with Inspire
 * Courage running could not see which of their numbers it was responsible for. This covers both,
 * so a live mode highlights everything it affects.
 */
export function activeModesTouch(modes: ModeDef[] | undefined, target: ModeTarget): boolean {
  // Reuses modeMatches so the highlight lands on exactly the stats the maths moved — including
  // `all-checks` modes, which would be missed by a naive kind comparison.
  return (modes ?? []).some((m) => m.modifiers.some((mod) => modeMatches(mod, target)));
}

/** Human label for a mode modifier's target, for the mode detail popup ("Reflex", "Stealth", "AC"). */
export function modeTargetLabel(mod: ModeModifier): string {
  // 'str' reads as a stat code, not a word — spell the attribute out.
  if (mod.target === 'ability' && mod.detail) return `${ABILITY_NAME[mod.detail] ?? mod.detail} modifier`;
  if (mod.detail) {
    const d = mod.detail.startsWith('lore:') ? `${mod.detail.slice(5)} Lore` : mod.detail;
    return d.charAt(0).toUpperCase() + d.slice(1);
  }
  const LABEL: Record<string, string> = {
    ac: 'AC',
    perception: 'Perception',
    attack: 'attack rolls',
    damage: 'damage',
    speed: 'Speed',
    'max-hp': 'maximum HP',
    initiative: 'initiative',
    'class-dc': 'Class DC',
    'spell-dc': 'Spell DC',
    'spell-attack': 'spell attack rolls',
    save: 'saves',
    skill: 'skills',
  };
  return LABEL[mod.target] ?? mod.target;
}

/**
 * The player's OWN modes — the ones they wrote and can edit, pin or delete.
 *
 * `content.modes` is everything: the hand-authored catalog, the player's saved modes, and one mode
 * per consumable. The last of those look exactly like saved modes (no `predefined` flag, no gates),
 * so every screen that listed "your modes" by excluding the catalog picked up 211 item modes and
 * offered Edit and Delete on data regenerated from core.json. Excluding `fromItemId` here, once,
 * keeps that out of every such list — including the search and "show all" paths, which deliberately
 * bypass `modeRelevant`.
 *
 * `charKey` narrows to modes scoped to that character plus the universal ones; omit it for all.
 *
 * ⚠ A GATED mode is CONTENT, never one of the player's own. The mode editor cannot write a
 * `classes` / `ancestries` / `feats` gate — only the authoring scripts do — so a gate is the reliable
 * mark of an authored record. Without this test all 113 authored toggle modes (and, with the aura
 * lane, 38 more) were listed under "Your modes", which is NOT relevance-filtered and offers Edit and
 * Delete: a 1st-level fighter was shown the champion's aura, the lantern's aura and every archetype
 * trance in the game, all editable and none of them theirs. `contentGatedModes` hands those to the
 * panel's gated section instead, where `modeRelevant` decides who sees them.
 */
export function playerModeLibrary(modes: Iterable<ModeDef>, charKey?: string): ModeDef[] {
  return [...modes].filter(
    (m) =>
      !CATALOG_MODE_MAP[m.id] &&
      !m.fromItemId &&
      !isGated(m) &&
      (charKey === undefined || !m.charId || m.charId === charKey),
  );
}

/** Does this mode carry a content gate? See `playerModeLibrary` for why that is the dividing line. */
const isGated = (m: ModeDef): boolean => !!(m.classes?.length || m.ancestries?.length || m.feats?.length);

/**
 * The authored, gated modes out of `content.modes` — the other half of `playerModeLibrary`.
 *
 * They join `CATALOG_MODES` in the Modes panel's predefined list, so `modeRelevant` gates them to the
 * character who actually has the feat, class feature, class or ancestry they name. Item modes stay
 * out: they belong to their consumable and appear only by using it.
 */
export function contentGatedModes(modes: Iterable<ModeDef>): ModeDef[] {
  return [...modes].filter((m) => !CATALOG_MODE_MAP[m.id] && !m.fromItemId && isGated(m));
}

/** Whether a predefined mode is relevant to a character — it must match at least one of its gates
 *  (class / ancestry / feat). A mode with NO gate is general and always relevant. A mode gated only
 *  by feats (e.g. an archetype trance) is relevant only to a character who has that dedication. */
export function modeRelevant(
  mode: ModeDef,
  classId?: string | null,
  ancestryId?: string | null,
  featIds?: ReadonlySet<string>,
): boolean {
  // An item mode belongs to its consumable, not to the player's own list: it appears by USING the
  // item and nowhere else, so it is never offered in the Modes panel or its search.
  if (mode.fromItemId) return false;
  const gates: boolean[] = [];
  if (mode.classes) gates.push(classId != null && mode.classes.includes(classId));
  if (mode.ancestries) gates.push(ancestryId != null && mode.ancestries.includes(ancestryId));
  if (mode.feats) gates.push(!!featIds && mode.feats.some((f) => featIds.has(f)));
  // The background gate matches through the same gate-id set the feat gate uses — modeGateIds adds
  // the character's backgroundId, so callers need no extra argument.
  if (mode.backgrounds) gates.push(!!featIds && mode.backgrounds.some((b) => featIds.has(b)));
  if (gates.length === 0) return true; // ungated ⇒ general
  return gates.some(Boolean); // matches any gate
}

/* -------------------------------------------------------------------------------------------------
 * Records that change an item MODE rather than the character.
 *
 * Mutagens and elixirs ship as item-driven modes: `duration` is a PRINTED string (the app has no
 * clock, so the player reads it and switches the mode off) and a mutagen's drawback is a genuine
 * negative modifier. Neither could be touched by anything, so Extend Elixir ("that elixir's duration
 * is doubled") and Perfect Mutagen ("you do not suffer its drawback") did nothing at all.
 * ---------------------------------------------------------------------------------------------- */

/** Minutes in a printed duration string, or 0 when it names no time ("until your next daily preparations"). */
export function durationMinutes(printed: string | undefined): number {
  const m = /(\d+)\s*(minute|hour|day)/i.exec(printed ?? '');
  if (!m) return 0;
  const n = Number(m[1]);
  return m[2].toLowerCase() === 'hour' ? n * 60 : m[2].toLowerCase() === 'day' ? n * 1440 : n;
}

/** Double every number in a printed duration, keeping its units and wording. */
function doublePrinted(printed: string): string {
  return printed.replace(/(\d+)/g, (d) => String(Number(d) * 2));
}

/** Does `adj.match` describe this mode? All present conditions must hold. */
function adjustMatches(
  mode: ModeDef,
  item: Item | undefined,
  match: NonNullable<DefenseGrants['modeAdjust']>[number]['match'],
): boolean {
  if (match.ids?.length && !match.ids.includes(mode.id)) return false;
  // Traits live on the ITEM the mode came from — a mode is a toggle, not a game object with traits.
  if (match.traits?.length) {
    const traits = new Set(item?.traits ?? []);
    if (!match.traits.every((t) => traits.has(t))) return false;
  }
  if (match.minDurationMinutes && durationMinutes(mode.duration) < match.minDurationMinutes) return false;
  return true;
}

/**
 * Apply every `modeAdjust` the character's feats and class features carry to the modes they have
 * switched on.
 *
 * Returns new objects — the catalog and the content database are shared, and mutating a ModeDef here
 * would leak one character's feats into every other character's copy of the same elixir.
 *
 * ⚠ `featureIds` is not optional decoration. `modeAdjust` is declared on `DefenseGrants`, so a class
 * feature has always been ABLE to carry one, and this reader looked only in `content.feats` — so any
 * class feature that rewrote a mode was written and never read. The aura lane is where that bites:
 * Blessed Swiftness (champion, 3rd) rewrites the champion's aura, and the thaumaturge's Adept and
 * Paragon regalia benefits rewrite the inspiring aura. All three are class features, and all three
 * would have been silent. Pass `ownedFeatureIds(character, content)`.
 */
export function adjustModes(
  modes: readonly ModeDef[],
  feats: readonly { featId: string }[],
  content: ContentDatabase,
  featureIds?: ReadonlySet<string>,
): ModeDef[] {
  const adjusts = [
    ...feats.flatMap((f) => content.feats[f.featId]?.modeAdjust ?? []),
    ...[...(featureIds ?? [])].flatMap((id) => content.classFeatures[id]?.modeAdjust ?? []),
  ];
  if (!adjusts.length) return [...modes];
  return modes.map((mode) => {
    const item = mode.fromItemId ? content.items[mode.fromItemId] : undefined;
    const hits = adjusts.filter((a) => adjustMatches(mode, item, a.match));
    if (!hits.length) return mode;
    let out = mode;
    // Doubling is applied ONCE however many records ask for it: two feats that each say "doubled"
    // do not quadruple a duration.
    if (hits.some((a) => a.doubleDuration) && out.duration) out = { ...out, duration: doublePrinted(out.duration) };
    if (hits.some((a) => a.suppressNegativeModifiers)) {
      out = { ...out, modifiers: out.modifiers.filter((m) => m.value >= 0) };
    }
    const notes = hits.map((a) => a.note).filter(Boolean);
    if (notes.length) out = { ...out, note: [out.note, ...notes].filter(Boolean).join(' ') };
    return out;
  });
}
