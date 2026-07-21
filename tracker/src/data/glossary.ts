// ── Static glossary ─────────────────────────────────────────────────────────
// Short reference text for terms that aren't in the Archives-of-Nethys data
// files (traits.json / conditions.json): the physical damage categories and the
// special senses. Used to give immunities/resistances/weaknesses and the
// Perception senses a hover popup when no trait/condition entry exists.

export interface GlossaryEntry { title: string; text: string }

export const GLOSSARY: Record<string, GlossaryEntry> = {
  // ── Damage types / categories ──
  physical: {
    title: 'Physical damage',
    text: 'Bludgeoning, piercing, and slashing are the three physical damage types. Resistance or immunity to "physical" applies to all three — often with an exception, e.g. "physical 10 (except adamantine)".',
  },
  bludgeoning: {
    title: 'Bludgeoning damage (B)',
    text: 'Physical damage from blunt force — hammers, falls, constriction, and the like.',
  },
  piercing: {
    title: 'Piercing damage (P)',
    text: 'Physical damage from punctures — spears, arrows, fangs, and the like.',
  },
  slashing: {
    title: 'Slashing damage (S)',
    text: 'Physical damage from cuts — swords, axes, claws, and the like.',
  },
  precision: {
    title: 'Precision damage',
    text: 'Extra damage from precise attacks (sneak attack, hunt prey, etc.). It is the same damage type as the attack; a creature immune to precision damage simply ignores this bonus damage.',
  },
  bleed: {
    title: 'Persistent bleed damage',
    text: 'Physical damage that recurs at the end of the creature’s turn until the bleed ends — by healing, Administer First Aid, or a successful DC 15 flat check.',
  },
  persistent: {
    title: 'Persistent damage',
    text: 'Damage of a given type dealt again at the end of the affected creature’s turn, ending on a DC 15 flat check. Resistance and immunity apply as for the underlying damage type.',
  },
  'critical hits': {
    title: 'Immunity to critical hits',
    text: 'The creature takes normal (not doubled) damage from critical hits and ignores critical specialization effects.',
  },
  'precision damage': {
    title: 'Precision damage',
    text: 'Extra damage from precise attacks (sneak attack, hunt prey, etc.), of the same type as the attack. A creature immune to precision ignores this bonus damage.',
  },
  'object immunities': {
    title: 'Object immunities',
    text: 'Objects are immune to bleed, death effects, disease, healing, mental effects, void/necromancy, nonlethal attacks, poison, spirit, vitality, and most conditions.',
  },
  all: {
    title: 'All damage',
    text: 'Applies to damage of every type, up to the listed amount — usually with an exception, e.g. "all 5 (except force)".',
  },
  area: {
    title: 'Area damage',
    text: 'Affects damage from effects with the area trait — bursts, cones, lines, and emanations. Swarms typically have a weakness to area damage.',
  },
  'non-magical': {
    title: 'Non-magical',
    text: 'Applies only to attacks or damage that aren’t magical.',
  },

  // ── Precious materials (weapons of these bypass certain resistances; many
  //    creatures have a weakness to one) ──
  'cold iron': {
    title: 'Cold iron',
    text: 'A precious metal anathema to fey and many demons. Their resistances don’t apply to cold iron, and they often have a weakness to it.',
  },
  silver: {
    title: 'Silver',
    text: 'A precious metal effective against many devils, lycanthropes, and undead — it bypasses their resistances, and such creatures often have a weakness to it.',
  },
  adamantine: {
    title: 'Adamantine',
    text: 'An extremely hard precious metal. It bypasses many physical resistances and a creature’s Hardness.',
  },
  orichalcum: {
    title: 'Orichalcum',
    text: 'A rare, time-attuned precious metal whose weapons can pierce resistances.',
  },
  mithral: {
    title: 'Mithral (dawnsilver)',
    text: 'A light, magical silvery metal that counts as silver for bypassing resistances and weaknesses.',
  },
  dawnsilver: {
    title: 'Dawnsilver (mithral)',
    text: 'A light, magical silvery metal that counts as silver for bypassing resistances and weaknesses.',
  },
  'sovereign steel': {
    title: 'Sovereign steel',
    text: 'A magic-disrupting metal; weapons of it are especially effective against some magical creatures.',
  },

  // ── Special senses ──
  darkvision: {
    title: 'Darkvision (precise)',
    text: 'Sees in darkness and dim light as well as in bright light, though in black and white. Magical darkness can still block it.',
  },
  'greater darkvision': {
    title: 'Greater darkvision (precise)',
    text: 'Like darkvision, but even magical darkness doesn’t impede it.',
  },
  'low-light vision': {
    title: 'Low-light vision (precise)',
    text: 'Sees in dim light as though it were bright light, ignoring the concealed condition from dim light.',
  },
  scent: {
    title: 'Scent (imprecise)',
    text: 'Detects creatures and objects by smell within the listed range. It can find a creature’s rough location but not pinpoint it — that needs a precise sense or a Seek action.',
  },
  tremorsense: {
    title: 'Tremorsense (imprecise)',
    text: 'Detects creatures and objects moving in contact with the ground (or the same body of water) within range, through vibrations.',
  },
  lifesense: {
    title: 'Lifesense (imprecise)',
    text: 'Detects the vital essence of living and undead creatures within range.',
  },
  blindsight: {
    title: 'Blindsight (precise)',
    text: 'A precise sense that works regardless of light or line of sight within range — darkness and invisibility don’t hamper it.',
  },
  echolocation: {
    title: 'Echolocation (precise)',
    text: 'The creature uses hearing as a precise sense (blindsight) within range. Deafness or magical silence negates it.',
  },
  wavesense: {
    title: 'Wavesense (imprecise)',
    text: 'Detects motion in water within range.',
  },
  'motion sense': {
    title: 'Motion sense (imprecise)',
    text: 'Detects the movement of nearby creatures within range.',
  },
  thoughtsense: {
    title: 'Thoughtsense (imprecise)',
    text: 'Detects the thoughts of intelligent creatures within range, regardless of barriers.',
  },
  'see invisibility': {
    title: 'See invisibility',
    text: 'The creature sees invisible creatures and objects; they are merely concealed to it rather than undetected.',
  },
  spiritsense: {
    title: 'Spiritsense (imprecise)',
    text: 'Detects spirits and the spiritual essence of creatures within range.',
  },
  'all-around vision': {
    title: 'All-around vision',
    text: 'The creature sees in every direction at once and therefore can’t be flanked.',
  },
  'true seeing': {
    title: 'True seeing',
    text: 'Sees through illusions and transmutations within range, perceiving things as they actually are (as the true seeing spell).',
  },
  truesight: {
    title: 'Truesight',
    text: 'Sees through illusions and the true form of disguised or transmuted creatures within range.',
  },
  'see the unseen': {
    title: 'See the unseen',
    text: 'The creature can see invisible and incorporeal creatures (they’re concealed to it rather than undetected).',
  },
  'detect magic': {
    title: 'Detect magic',
    text: 'The creature constantly senses magical auras around it, as if using the detect magic spell.',
  },
  'light blindness': {
    title: 'Light blindness',
    text: 'When first exposed to bright light, the creature is blinded until the end of its next turn, then dazzled in bright light for as long as it remains there. (A weakness, not a sense.)',
  },
  greensight: {
    title: 'Greensight (precise)',
    text: 'Sees through fungi, foliage, and plant matter as though they weren’t there, within range.',
  },
  'smoke vision': {
    title: 'Smoke vision',
    text: 'The creature ignores the concealed condition from smoke and fog.',
  },

  // ── Sizes (grid space in feet + metres) ──
  tiny: { title: 'Tiny', text: 'Space 2½ ft (0.75 m). A Tiny creature takes up less than a full square and can share a space.' },
  small: { title: 'Small', text: 'Space 5 ft (1.5 m). A Small creature occupies a single 5-foot square.' },
  medium: { title: 'Medium', text: 'Space 5 ft (1.5 m). A Medium creature occupies a single 5-foot square.' },
  large: { title: 'Large', text: 'Space 10 ft (3 m). A Large creature occupies a 2×2 area of squares.' },
  huge: { title: 'Huge', text: 'Space 15 ft (4.5 m). A Huge creature occupies a 3×3 area of squares.' },
  gargantuan: { title: 'Gargantuan', text: 'Space 20 ft (6 m). A Gargantuan creature occupies a 4×4 (or larger) area of squares.' },
}

/** The six creature sizes (also keys into GLOSSARY). */
export const SIZES = new Set(['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'])

// ── Prose auto-linking ───────────────────────────────────────────────────────
// Which terms to turn into hover/click links wherever they appear in flowing
// description text (popup bodies AND main stat-block prose). Shared by
// TagRenderer and FloatingWindow's RichText so both stay consistent.

// Glossary keys too common as everyday words to auto-link in prose — they'd
// match ordinary sentences. Sizes are already linked as trait pills.
const GLOSSARY_PROSE_EXCLUDE = new Set([
  'all', 'area', 'non-magical', 'silver',
  'tiny', 'small', 'medium', 'large', 'huge', 'gargantuan',
])
/** Glossary keys safe to auto-link in prose (damage categories, senses,
 *  materials, …). */
export const PROSE_GLOSSARY_KEYS = new Set(
  Object.keys(GLOSSARY).filter(k => !GLOSSARY_PROSE_EXCLUDE.has(k)),
)
/** Damage / energy-type traits worth linking in prose (→ trait popup). NOT the
 *  full trait list — that would link every "Magical"/"Good" in flavor text. */
export const PROSE_DAMAGE_TRAITS = [
  'fire', 'cold', 'acid', 'electricity', 'sonic', 'force',
  'mental', 'poison', 'vitality', 'void', 'spirit', 'positive', 'negative',
]

// Spelling variants seen in bestiary immunities that map onto a canonical
// trait / condition / glossary term so they still get a popup.
export const TERM_ALIASES: Record<string, string> = {
  magic: 'magical',                 // trait
  paralysis: 'paralyzed', paralyze: 'paralyzed', // condition
  confusion: 'confused',            // condition
  fatigue: 'fatigued',              // condition
  blindness: 'blinded', blind: 'blinded',        // condition
  unconsciousness: 'unconscious', unconcious: 'unconscious', // condition
  petrification: 'petrified',       // condition
  poisoned: 'poison',               // trait
  diseased: 'disease',              // trait
  curses: 'curse',                  // trait
  grappled: 'grabbed',              // condition
  'area damage': 'area',            // glossary
}

/** Normalise a defense term: underscores → spaces, then map known spelling
 *  variants to their canonical trait/condition/glossary key. */
export function aliasTerm(term: string): string {
  const t = term.toLowerCase()
    .replace(/_/g, ' ')
    .replace(/-\s+/g, '-')   // "non- magical" → "non-magical"
    .replace(/\s+/g, ' ')
    .trim()
  return TERM_ALIASES[t] ?? t
}

/** Find the GLOSSARY key for a term, peeling trailing words so "physical 5
 *  (except adamantine)" or "scent 30 feet" still resolve. */
export function glossaryKey(term: string): string | undefined {
  let key = term.toLowerCase().replace(/\s*\([^)]*\)\s*$/, '').trim()
  while (key) {
    if (GLOSSARY[key]) return key
    const sp = key.lastIndexOf(' ')
    if (sp < 0) break
    key = key.slice(0, sp)
  }
  return undefined
}

export function lookupGlossary(term: string): GlossaryEntry | undefined {
  const k = glossaryKey(term)
  return k ? GLOSSARY[k] : undefined
}
