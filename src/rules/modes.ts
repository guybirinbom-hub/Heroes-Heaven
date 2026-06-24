/*
 * Modes — user-defined, toggleable sets of bonuses/penalties (Raise a Shield, Inspire
 * Courage, a homebrew effect, …). An UNCONDITIONAL modifier (no "applies when" text) folds
 * into the targeted stat's number with PF2e stacking; a CONDITIONAL one doesn't change the
 * number — it underlines the stat and is shown (with its "applies when") in the breakdown.
 */
import type { ModeDef, ModeModifier, ModeTargetKind } from './types';

/** A stat being computed, matched against a modifier's target. */
export interface ModeTarget {
  kind: Exclude<ModeTargetKind, 'all-checks'>;
  /** save id (fortitude/reflex/will) or skill key (e.g. 'stealth'). */
  detail?: string;
}

/** The selectable targets in the mode editor. */
export const MODE_TARGETS: { kind: ModeTargetKind; label: string; needsDetail?: 'save' | 'skill' }[] = [
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
];

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
  if (mod.target === 'save' || mod.target === 'skill') return !mod.detail || mod.detail === target.detail;
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
  { id: 'cat-rotting-rage', name: 'Rotting Rage', category: 'Barbarian', classes: ['barbarian'], exclusiveGroup: 'barbarian-rage', modifiers: [m(2, 'untyped', 'damage', { appliesWhen: 'melee or unarmed Strikes while raging' })], note: 'A variant rage state — apply your instinct/feat’s specific rage effect in addition to the base benefits.' },
  { id: 'cat-wooden-rage', name: 'Wooden Rage', category: 'Barbarian', classes: ['barbarian'], exclusiveGroup: 'barbarian-rage', modifiers: [m(2, 'untyped', 'damage', { appliesWhen: 'melee or unarmed Strikes while raging' })], note: 'A variant rage state — apply your instinct/feat’s specific rage effect in addition to the base benefits.' },

  // ---- Bard — compositions (one at a time) ----
  { id: 'cat-inspire-courage', name: 'Courageous Anthem', category: 'Bard', classes: ['bard'], exclusiveGroup: 'bard-composition', modifiers: [m(1, 'status', 'attack'), m(1, 'status', 'damage'), m(1, 'status', 'save', { detail: 'will', appliesWhen: 'vs fear effects' })], note: 'Allies gain a +1 status bonus to attack rolls, damage rolls, and saves vs fear.' },
  { id: 'cat-rallying-anthem', name: 'Rallying Anthem', category: 'Bard', classes: ['bard'], exclusiveGroup: 'bard-composition', modifiers: [m(1, 'status', 'ac'), m(1, 'status', 'save')], note: 'Allies gain a +1 status bonus to AC and saving throws.' },
  { id: 'cat-song-of-strength', name: 'Song of Strength', category: 'Bard', classes: ['bard'], exclusiveGroup: 'bard-composition', modifiers: [m(1, 'status', 'skill', { detail: 'athletics' })], note: 'Allies gain a +1 status bonus to Strength-based checks (Athletics, Escape, etc.).' },
  { id: 'cat-triple-time', name: 'Triple Time', category: 'Bard', classes: ['bard'], exclusiveGroup: 'bard-composition', modifiers: [], note: 'Allies gain a +10-foot status bonus to their Speeds.' },

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

  // ---- Ancestry shapes/states (ancestries not yet in the bundled data — shown under "show all") ----
  { id: 'cat-were-animal', name: 'Animal Shape', category: 'Werecreature', ancestries: ['werecreature'], exclusiveGroup: 'werecreature-shape', modifiers: [], note: 'Changed Shape: assume your full animal form.' },
  { id: 'cat-were-hybrid', name: 'Hybrid Shape', category: 'Werecreature', ancestries: ['werecreature'], exclusiveGroup: 'werecreature-shape', modifiers: [], note: 'Changed Shape: assume your bipedal hybrid form with natural weapons.' },
  { id: 'cat-size-ancients', name: 'Size of the Ancients', category: 'Dragonkin', ancestries: ['dragonkin'], modifiers: [], note: 'Grow to Large size for a time, with the usual reach and Strike benefits.' },
  { id: 'cat-rivener-state', name: 'Rivener State', category: 'Ikeshti', ancestries: ['ikeshti'], modifiers: [], note: 'Enter your feral rivener state.' },

  // ---- Archetype trances/forms (gated to the dedication that grants them) ----
  { id: 'cat-spirit-trance', name: 'Spirit Trance', category: 'Archetype', feats: ['rivethun-invoker-dedication'], modifiers: [], note: 'Rivethun Invoker (Divine Mysteries): enter a trance to commune with spirits.' },
  { id: 'cat-sentinel-form', name: 'Sentinel Form', category: 'Archetype', feats: ['starlit-sentinel-dedication'], modifiers: [], note: 'Starlit Sentinel (Tian Xia): assume your sentinel form.' },
  { id: 'cat-daydream-trance', name: 'Daydream Trance', category: 'Archetype', feats: ['sleepwalker-dedication'], modifiers: [], note: 'Sleepwalker (Dark Archive): enter a daydream trance.' },
];

/** All predefined modes (every catalog entry is directly toggleable + usable as a template). */
export const CATALOG_MODES: ModeDef[] = RAW_MODES.map((d) => ({ predefined: true, ...d }));

/** Catalog keyed by id (for content merge). */
export const CATALOG_MODE_MAP: Record<string, ModeDef> = Object.fromEntries(CATALOG_MODES.map((d) => [d.id, d]));

/** Whether a predefined mode is relevant to a character — it must match at least one of its gates
 *  (class / ancestry / feat). A mode with NO gate is general and always relevant. A mode gated only
 *  by feats (e.g. an archetype trance) is relevant only to a character who has that dedication. */
export function modeRelevant(
  mode: ModeDef,
  classId?: string | null,
  ancestryId?: string | null,
  featIds?: ReadonlySet<string>,
): boolean {
  const gates: boolean[] = [];
  if (mode.classes) gates.push(classId != null && mode.classes.includes(classId));
  if (mode.ancestries) gates.push(ancestryId != null && mode.ancestries.includes(ancestryId));
  if (mode.feats) gates.push(!!featIds && mode.feats.some((f) => featIds.has(f)));
  if (gates.length === 0) return true; // ungated ⇒ general
  return gates.some(Boolean); // matches any gate
}
