/**
 * AUTHORS THE `degreeShifts` LANE — the field shipped empty (0 records) and every one of the ~176
 * degree-of-success records reported as broken because of it.
 *
 * Owner ruling Q2: a shift stars **both** the skill and the action it names, and **all three saves**
 * when it applies to saves generally. One `DegreeShift` entry fans out to every surface it names
 * (`authoredSituational` + `degreeShiftMarkers` in explain.ts), which is the whole reason the field
 * exists: the two halves used to be hand-written into two registries and drifted apart.
 *
 * ── What this script does NOT author, and why ────────────────────────────────────────────────────
 *   • A shift that lands on SOMEONE ELSE'S roll — an enemy's save, an ally's check, a companion's.
 *     Ruling F: no number of theirs belongs on your sheet. Starring your Athletics because an enemy's
 *     Grapple gets worse would promise you a bonus you do not have.
 *   • A shift on a roll that has no row on the sheet — a ritual's secondary check, a counteract check.
 *   • The `aon-*` records: those are collision-suppressed duplicates (display hygiene rule
 *     "hide-never-delete"), so authoring them would put the same rule on a record nobody can reach.
 *
 * ── Where the values land ───────────────────────────────────────────────────────────────────────
 * public/core.json (so the app sees them now) AND scripts/data/effect-backfill.json (the ONLY
 * overlay that survives `npm run data`), written through scripts/lib/write-backfill.mjs — writing it
 * by hand reformats all 6,841 rows.
 *
 * Run: node scripts/apply-degree-shifts.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = process.cwd();
const p = (f) => join(ROOT, f);
const DRY = process.argv.includes('--dry');

/* ------------------------------------------------------------------------------------------------
 * The authored table.
 *
 * Key is `<bucket>/<record id>` — the bucket matters because `degreeShiftRecords` (explain.ts) walks
 * feats, heritages, ancestries, backgrounds, owned class features and items-in-use, and a row filed
 * under the wrong collection is silently never read.
 *
 * `when` is the trigger, printed verbatim beside the shift. It is NOT decoration: an entry whose
 * targets are actions-only is carried entirely by its marker note, and `when` is that note.
 * ---------------------------------------------------------------------------------------------- */
const S2C = 'successToCrit';
const CF2F = 'critFailToFail';
const F2S = 'failToSuccess';
const BETTER = 'oneBetter';
/* The DOWNGRADES (2026-08-12). `DegreeShift.shift` used to hold four values and all four improved the
 * result, so nine live records saying the opposite could not be authored at all and were listed below
 * instead. Two of them — Dragon's Presence and the even-tempered tanuki — already carried their
 * UPGRADE half here, which meant the sheet was printing the good half of a two-sided rule and hiding
 * the bad half. Showing half a rule is worse than showing none of it. */
const CS2S = 'critSuccessToSuccess';
const F2CF = 'failToCritFail';
const WORSE = 'oneWorse';

/** shorthand: e(shift, when, {sk, sv, act, p}) */
const e = (shift, when, t = {}) => ({
  shift,
  when,
  ...(t.sk ? { skills: t.sk } : {}),
  ...(t.sv ? { saves: t.sv } : {}),
  ...(t.act ? { actions: t.act } : {}),
  ...(t.p ? { perception: true } : {}),
});
const ALL = ['all'];

/** A save-line feat/feature: "on every X save, a success is a critical success instead". */
const saveShift = (shift, save, when) => [e(shift, when, { sv: [save] })];

const AUTHORED = {
  /* ═══ SAVES, general ════════════════════════════════════════════════════════════════════════════
   * Q2's "all three saves when it applies to saves generally" is expressed as `saves: ['all']`;
   * a feature that names ONE track names it, because Juggernaut does nothing for your Will save.  */
  'classFeatures/agile-mind': saveShift(S2C, 'will', 'on any Will save'),
  'classFeatures/anvils-hardness': saveShift(S2C, 'fortitude', 'on any Fortitude save'),
  'classFeatures/assured-evasion': saveShift(CF2F, 'reflex', 'on any Reflex save'),
  'classFeatures/battle-hardened': saveShift(S2C, 'fortitude', 'on any Fortitude save'),
  'classFeatures/battlefield-intuition': saveShift(S2C, 'reflex', 'on any Reflex save'),
  'classFeatures/blast-dodger': saveShift(S2C, 'reflex', 'on any Reflex save'),
  'classFeatures/battle-creed': saveShift(S2C, 'fortitude', 'on any Fortitude save'),
  'classFeatures/chemical-hardiness': saveShift(S2C, 'fortitude', 'on any Fortitude save'),
  'classFeatures/churning-mind': saveShift(S2C, 'will', 'on any Will save'),
  'classFeatures/commanding-will': saveShift(S2C, 'will', 'on any Will save'),
  'classFeatures/confident-evasion': saveShift(S2C, 'reflex', 'on any Reflex save'),
  'classFeatures/disciplined-mind': saveShift(S2C, 'will', 'on any Will save'),
  'classFeatures/divine-will': saveShift(S2C, 'will', 'on any Will save'),
  'classFeatures/dogged-will': saveShift(S2C, 'will', 'on any Will save'),
  'classFeatures/earned-resilience': saveShift(S2C, 'fortitude', 'on any Fortitude save'),
  'classFeatures/evasion': saveShift(S2C, 'reflex', 'on any Reflex save'),
  'classFeatures/evasive-reflexes': saveShift(S2C, 'reflex', 'on any Reflex save'),
  'classFeatures/explosion-dodger': saveShift(S2C, 'reflex', 'on any Reflex save'),
  'classFeatures/fifth-doctrine-warpriest': saveShift(S2C, 'fortitude', 'on any Fortitude save'),
  'classFeatures/fortress-of-will': saveShift(CF2F, 'will', 'on any Will save'),
  'classFeatures/greater-resolve': saveShift(CF2F, 'will', 'on any Will save'),
  'classFeatures/improved-evasion': saveShift(CF2F, 'reflex', 'on any Reflex save'),
  'classFeatures/indomitable-will': saveShift(S2C, 'will', 'on any Will save'),
  'classFeatures/juggernaut': saveShift(S2C, 'fortitude', 'on any Fortitude save'),
  'classFeatures/kinetic-durability': saveShift(S2C, 'fortitude', 'on any Fortitude save'),
  'classFeatures/kinetic-quickness': saveShift(S2C, 'reflex', 'on any Reflex save'),
  'classFeatures/lead-constitution': saveShift(S2C, 'fortitude', 'on any Fortitude save'),
  'classFeatures/majestic-will': saveShift(S2C, 'will', 'on any Will save'),
  'classFeatures/major-creed': saveShift(S2C, 'fortitude', 'on any Fortitude save'),
  'classFeatures/master-of-mind-and-spirit': saveShift(S2C, 'will', 'on any Will save'),
  'classFeatures/mortality-reforged': saveShift(S2C, 'fortitude', 'on any Fortitude save'),
  'classFeatures/mysterious-resolve': saveShift(S2C, 'will', 'on any Will save'),
  'classFeatures/natural-reflexes': saveShift(S2C, 'reflex', 'on any Reflex save'),
  'classFeatures/performers-heart': saveShift(S2C, 'will', 'on any Will save'),
  'classFeatures/prodigious-will': saveShift(S2C, 'will', 'on any Will save'),
  'classFeatures/reinforced-ego': saveShift(S2C, 'will', 'on any Will save'),
  'classFeatures/resolute-faith': saveShift(S2C, 'will', 'on any Will save'),
  'classFeatures/resolve': saveShift(S2C, 'will', 'on any Will save'),
  'classFeatures/rogue-resilience': saveShift(S2C, 'fortitude', 'on any Fortitude save'),
  'classFeatures/sacred-body': saveShift(S2C, 'fortitude', 'on any Fortitude save'),
  'classFeatures/savvy-reflexes': saveShift(S2C, 'reflex', 'on any Reflex save'),
  'classFeatures/tempered-reflexes': saveShift(S2C, 'reflex', 'on any Reflex save'),
  'classFeatures/unassailable-soul': saveShift(S2C, 'will', 'on any Will save'),
  'classFeatures/unyielding-resolve': saveShift(S2C, 'will', 'on any Will save'),
  'classFeatures/walls-of-will': saveShift(S2C, 'will', 'on any Will save'),
  'classFeatures/wardens-endurance': saveShift(S2C, 'fortitude', 'on any Fortitude save'),
  'classFeatures/warpriest': saveShift(S2C, 'fortitude', 'on any Fortitude save'),
  'classFeatures/wild-willpower': saveShift(S2C, 'will', 'on any Will save'),
  'classFeatures/will-of-the-pupil': saveShift(S2C, 'will', 'on any Will save'),
  // The "greater" tier of a save feature does BOTH, so it is two entries rather than one: the sheet
  // has to be able to say which half fired.
  'classFeatures/greater-dogged-will': [e(S2C, 'on any Will save', { sv: ['will'] }), e(CF2F, 'on any Will save', { sv: ['will'] })],
  'classFeatures/greater-mysterious-resolve': [e(S2C, 'on any Will save', { sv: ['will'] }), e(CF2F, 'on any Will save', { sv: ['will'] })],
  'classFeatures/greater-unassailable-soul': [e(S2C, 'on any Will save', { sv: ['will'] }), e(CF2F, 'on any Will save', { sv: ['will'] })],
  'classFeatures/perfected-mind': [e(S2C, 'on any Will save', { sv: ['will'] }), e(CF2F, 'on any Will save', { sv: ['will'] })],
  'classFeatures/greater-juggernaut': saveShift(CF2F, 'fortitude', 'on any Fortitude save'),
  'classFeatures/greater-kinetic-durability': saveShift(CF2F, 'fortitude', 'on any Fortitude save'),
  'classFeatures/greater-natural-reflexes': saveShift(CF2F, 'reflex', 'on any Reflex save'),
  'classFeatures/greater-performers-heart': saveShift(CF2F, 'will', 'on any Will save'),
  'classFeatures/greater-rogue-reflexes': saveShift(CF2F, 'reflex', 'on any Reflex save'),
  // The chosen track is a builder answer, so the entry cannot name one save: `all` is honest here —
  // the player knows which they chose and the note says so.
  'classFeatures/path-to-perfection': [e(S2C, 'on the save you chose for Path to Perfection', { sv: ALL })],
  'classFeatures/third-path-to-perfection': [e(CF2F, 'on the save you chose for Path to Perfection', { sv: ALL })],
  'classFeatures/shared-resolve': [e(S2C, 'on any Will save (yours and your eidolon’s)', { sv: ['will'] })],
  'classFeatures/twin-juggernauts': [e(S2C, 'on any Fortitude save (yours and your eidolon’s)', { sv: ['fortitude'] })],
  // Reflex only, and only for the armour-swap this feature enables — not every Reflex save.
  'classFeatures/guardian-mastery': [e(S2C, 'on a Reflex save against a damaging effect where you used your armor’s item bonus instead of Dexterity', { sv: ['reflex'] })],
  'classFeatures/paragon-benefit-regalia': [
    e(CF2F, 'on a check to Coerce, Make an Impression, or Request', { sk: ['diplomacy', 'intimidation'], act: ['coerce', 'make-an-impression', 'request'] }),
  ],

  /* ═══ SAVES, conditional (feats + heritages) ═══════════════════════════════════════════════════ */
  'feats/necromantic-tenacity': [e(S2C, 'on a save against a necromancy effect', { sv: ALL }), e(CF2F, 'on a save against a necromancy effect', { sv: ALL })],
  'feats/witch-warden': [e(S2C, 'on a save against a curse, or against a spell cast by a witch or hag', { sv: ALL })],
  'feats/kneel-for-no-god': [e(CF2F, 'on the save against a divine spell you answered with Call on Ancient Blood', { sv: ALL })],
  'feats/grim-insight': [e(S2C, 'on a save against a fear effect', { sv: ALL })],
  'feats/endure-deaths-touch': [e(S2C, 'on a save against an effect from the triggering undead’s natural attack', { sv: ALL })],
  'feats/knight-reclaimant-dedication': [e(S2C, 'on a save against an undead’s special ability', { sv: ALL })],
  'feats/survivor-of-desolation': [
    e(S2C, 'on a save against unnatural weather or an environmental hazard in a blighted region', { sv: ALL }),
    e(CF2F, 'on a save against unnatural weather or an environmental hazard in a blighted region', { sv: ALL }),
  ],
  'feats/glyph-expert': [
    e(S2C, 'on a save against a trap that features magical writing', { sv: ALL }),
    e(CF2F, 'on a save against a trap that features magical writing', { sv: ALL }),
  ],
  'feats/adhyabhau': [e(S2C, 'on a save against an emotion effect', { sv: ['will'] })],
  'feats/emotionless': [e(S2C, 'on a save against an emotion or fear effect', { sv: ALL })],
  'feats/wind-tempered': [e(S2C, 'on a save against an air effect', { sv: ALL })],
  'feats/tide-hardened': [e(S2C, 'on a save against a cold or water effect', { sv: ALL })],
  'feats/alghollthu-bound': [e(S2C, 'on a save against a mental effect that would make you controlled', { sv: ['will'] })],
  'feats/web-walker': [e(S2C, 'on a save against an effect involving a web', { sv: ALL })],
  'feats/goloma-courage': [e(S2C, 'on a save against a fear effect', { sv: ALL })],
  'feats/adaptive-vision': [e(S2C, 'on a save against a visual effect', { sv: ALL })],
  'feats/blast-resistance': [e(S2C, 'on a save against an effect that causes dazzled or deafened', { sv: ALL })],
  'feats/emotional-partitions': [e(S2C, 'on a save against an emotion effect', { sv: ALL })],
  'feats/cold-minded': [e(S2C, 'on a save against an emotion effect', { sv: ALL })],
  'feats/eldritch-calm': [e(CF2F, 'on a save against an emotion or fear effect', { sv: ALL })],
  'feats/grove-harbored': [e(S2C, 'on a save against a poison effect', { sv: ALL })],
  'feats/living-stone': [e(S2C, 'on a save against a disease or poison', { sv: ALL })],
  'feats/forlorn': [e(S2C, 'on a save against an emotion effect', { sv: ALL })],
  'feats/ancestral-suspicion': [e(S2C, 'on a save against an effect that would make you controlled', { sv: ALL })],
  'feats/undaunted': [e(S2C, 'on a save against an emotion effect', { sv: ALL })],
  'feats/called': [e(S2C, 'on a save against a mental effect that would make you controlled', { sv: ALL })],
  'feats/lawbringer': [e(S2C, 'on a save against an emotion effect', { sv: ALL })],
  'feats/raise-symbol': [e(S2C, 'while your religious symbol is raised, on a save against a vitality or void effect', { sv: ALL })],
  'feats/breath-control': [e(S2C, 'on a save against an inhaled threat, such as an inhaled poison', { sv: ALL })],
  'feats/morph-risen': [e(S2C, 'on a save against a hostile morph or polymorph effect', { sv: ALL })],
  'feats/lab-rat': [e(S2C, 'on a save against a poison or disease', { sv: ALL })],
  'feats/reckless-abandon-goblin': [e(F2S, 'for the remainder of your turn after Reckless Abandon, on a save against a harmful effect', { sv: ALL })],
  'feats/reckless-abandon': [e(F2S, 'for the remainder of your turn after Reckless Abandon, on a save against a harmful effect', { sv: ALL })],
  'feats/eternal-legend-dedication': [e(S2C, 'on a save against an effect that would impose the condition you chose during daily preparations', { sv: ALL })],
  'feats/duck': [
    e(S2C, 'on a Reflex save against an area ability from a Huge or larger creature', { sv: ['reflex'] }),
    e(CF2F, 'on a Reflex save against an area ability from a Huge or larger creature', { sv: ['reflex'] }),
  ],
  'feats/unshakable-grit': [
    e(S2C, 'on the reroll granted by your Grit and Tenacity reaction', { sv: ALL }),
    e(CF2F, 'on the reroll granted by your Grit and Tenacity reaction', { sv: ALL }),
  ],
  // The "if you also have an ability that already upgrades this save" clause is a SECOND entry rather
  // than a footnote on the first: the two halves fire on different results, and a player reading the
  // save popup has to be able to tell which one applies to the roll in front of them.
  'feats/affliction-resistance': [
    e(S2C, 'on a save against a disease or poison', { sv: ALL }),
    e(CF2F, 'on a save against a disease or poison, if another ability already turns such a success into a critical success', { sv: ALL }),
  ],
  'feats/parthenogenic-hatchling': [
    e(S2C, 'on a save against a disease', { sv: ALL }),
    e(CF2F, 'on a save against a disease, if another ability already turns such a success into a critical success', { sv: ALL }),
  ],
  'feats/necromantic-physiology': [
    e(S2C, 'on a save against a disease', { sv: ALL }),
    e(CF2F, 'on a save against a disease, if another ability already turns such a success into a critical success', { sv: ALL }),
  ],
  'feats/divine-health': [
    e(S2C, 'on a save against a disease or poison', { sv: ALL }),
    e(CF2F, 'on a save against a disease or poison, if you have the Sacred Body class feature', { sv: ALL }),
  ],
  // BOTH halves of one sentence: "When you roll a success on a saving throw against a fear effect,
  // you get a critical success instead. When you roll a failure against a fear effect, you get a
  // critical failure instead." The downgrade half was unauthorable until `failToCritFail` existed.
  'feats/dragons-presence': [
    e(S2C, 'on a save against a fear effect', { sv: ALL }),
    e(F2CF, 'on a save against a fear effect', { sv: ALL }),
  ],
  'heritages/resolute-fetchling': [e(S2C, 'on a save against an emotion effect', { sv: ALL })],
  'heritages/technological-fleshwarp': [e(S2C, 'on a save against an emotion effect', { sv: ALL })],
  'heritages/wishborn-poppet': [e(S2C, 'on a save against an emotion or fear effect', { sv: ALL })],
  'heritages/discarded-fleshwarp': [e(S2C, 'on a save against a transmutation effect', { sv: ALL })],
  'heritages/death-warden-dwarf': [e(S2C, 'on a save against an effect with the void trait or created by an undead', { sv: ALL })],
  'heritages/irongut-goblin': [e(S2C, 'on a Fortitude save to avoid becoming sickened, or against an ingested poison, from something you ate', { sv: ['fortitude'] })],
  'heritages/gutsy-halfling': [e(S2C, 'on a save against an emotion effect', { sv: ALL })],
  'heritages/jinxed-tengu': [e(S2C, 'on a save against a curse or misfortune effect', { sv: ALL })],
  'heritages/dijiang': [e(F2S, 'on a failure (but not a critical failure) on a save against an emotion effect', { sv: ALL })],
  'heritages/sewer-rat': [
    e(S2C, 'on a save against a disease or poison', { sv: ALL }),
    e(CF2F, 'on a save against a disease or poison, if another ability already turns such a success into a critical success', { sv: ALL }),
  ],
  // Both halves, same shape as Dragon's Presence: "…you get a critical success instead, but when you
  // roll a failure at a saving throw against an emotion effect, you get a critical failure instead."
  'heritages/even-tempered-tanuki': [
    e(S2C, 'on a save against an emotion effect', { sv: ALL }),
    e(F2CF, 'on a save against an emotion effect', { sv: ALL }),
  ],

  /* ═══ SKILL + ACTION shifts ════════════════════════════════════════════════════════════════════
   * Q2's "both". Where the text names no skill (Aid can be rolled with any of them) the entry is
   * actions-only and the marker on the action row carries it — starring all sixteen skills for a
   * feat about Aiding would be worse than saying nothing.                                        */
  'feats/adroit-manipulation': [e(S2C, 'on a Thievery check to Pick a Lock', { sk: ['thievery'], act: ['pick-a-lock'] })],
  'feats/forced-entry': [e(S2C, 'on a check to Force Open', { sk: ['athletics'], act: ['force-open'] })],
  'feats/extra-squishy': [e(S2C, 'on a check to Squeeze', { sk: ['acrobatics'], act: ['squeeze'] })],
  'feats/slither': [e(S2C, 'on an Acrobatics check to Squeeze', { sk: ['acrobatics'], act: ['squeeze'] })],
  'feats/flexible-form': [e(S2C, 'on a check to Squeeze', { sk: ['acrobatics'], act: ['squeeze'] })],
  'feats/amorphous-aspect': [e(CF2F, 'on a check to Squeeze', { sk: ['acrobatics'], act: ['squeeze'] })],
  'feats/fluid-contortionist': [
    e(S2C, 'on a check to Squeeze', { sk: ['acrobatics'], act: ['squeeze'] }),
    e(CF2F, 'on a check to Squeeze', { sk: ['acrobatics'], act: ['squeeze'] }),
  ],
  'feats/lightless-litheness': [
    e(CF2F, 'on a check to Squeeze', { sk: ['acrobatics'], act: ['squeeze'] }),
    e(S2C, 'on a check to Escape', { sk: ['acrobatics', 'athletics'], act: ['escape'] }),
  ],
  'feats/musetouched': [
    e(CF2F, 'on a check to Escape', { sk: ['acrobatics', 'athletics'], act: ['escape'] }),
    e(S2C, 'on a check to Escape', { sk: ['acrobatics', 'athletics'], act: ['escape'] }),
  ],
  'feats/unfettered-halfling': [
    e(S2C, 'on a check to Escape, or a save against an effect that would make you grabbed, immobilized, or restrained', { sk: ['acrobatics', 'athletics'], sv: ALL, act: ['escape'] }),
  ],
  'feats/steady-on-stone': [e(S2C, 'on an Acrobatics check to Balance on narrow surfaces or uneven ground of stone and earth', { sk: ['acrobatics'], act: ['balance'] })],
  'feats/rock-runner': [e(S2C, 'on an Acrobatics check to Balance on narrow surfaces or uneven ground of stone or earth', { sk: ['acrobatics'], act: ['balance'] })],
  'feats/marsh-runner': [e(S2C, 'on an Acrobatics check to Balance on narrow surfaces or uneven marshy ground', { sk: ['acrobatics'], act: ['balance'] })],
  'feats/steady-balance': [e(S2C, 'on a check to Balance', { sk: ['acrobatics'], act: ['balance'] })],
  'feats/shore-step': [e(S2C, 'on an Acrobatics check to Balance on a slippery or wet surface, or an Athletics check to Swim', { sk: ['acrobatics', 'athletics'], act: ['balance', 'swim'] })],
  'feats/rope-runner': [e(S2C, 'on an Athletics check to Climb or an Acrobatics check to Balance', { sk: ['athletics', 'acrobatics'], act: ['climb', 'balance'] })],
  'feats/canopy-predator': [e(S2C, 'on an Athletics check to Climb a tree or an Acrobatics check to Balance on a branch', { sk: ['athletics', 'acrobatics'], act: ['climb', 'balance'] })],
  'feats/geckos-grip': [e(S2C, 'on an Athletics check to Climb', { sk: ['athletics'], act: ['climb'] })],
  'feats/spelunker': [e(S2C, 'on a Survival check to Sense Direction or an Athletics check to Climb', { sk: ['survival', 'athletics'], act: ['sense-direction', 'climb'] })],
  'feats/viking-dedication': [e(S2C, 'on an Athletics check to Swim', { sk: ['athletics'], act: ['swim'] })],
  'feats/marine-marauder-dedication': [e(S2C, 'on an Athletics check to Swim', { sk: ['athletics'], act: ['swim'] })],
  'feats/swan-dive': [
    e(S2C, 'until the end of your turn after Swan Dive, on an Athletics check to Swim', { sk: ['athletics'], act: ['swim'] }),
    e(CF2F, 'until the end of your turn after Swan Dive, on an Athletics check to Swim', { sk: ['athletics'], act: ['swim'] }),
  ],
  'feats/practiced-brawn': [e(S2C, 'on an Athletics check to Shove', { sk: ['athletics'], act: ['shove'] })],
  'feats/flying-tackle': [e(S2C, 'on the Athletics check to Trip', { sk: ['athletics'], act: ['trip'] })],
  'feats/shackles-of-law': [e(S2C, 'on the Athletics check to Grapple while wielding a flail or spiked chain', { sk: ['athletics'], act: ['grapple'] })],
  'feats/scattering-in-spring': [e(S2C, 'on the Feint or Shove you make after the triggering attack misses', { sk: ['deception', 'athletics'], act: ['feint', 'shove'] })],
  'feats/hydraulic-maneuvers': [e(CF2F, 'on the Athletics check to Disarm, Shove, or Trip made with Hydraulic Maneuvers', { sk: ['athletics'], act: ['disarm', 'shove', 'trip'] })],
  'feats/woodcraft': [
    e(S2C, 'in a forest or jungle, on a Survival check to Sense Direction, Subsist, or Cover Tracks', { sk: ['survival'], act: ['sense-direction', 'subsist', 'cover-tracks'] }),
    e(CF2F, 'in a forest or jungle, on a Survival check to Sense Direction, Subsist, or Cover Tracks', { sk: ['survival'], act: ['sense-direction', 'subsist', 'cover-tracks'] }),
  ],
  'feats/pelagic-aptitude': [e(CF2F, 'in an aquatic environment, on a Survival check to Sense Direction or Subsist', { sk: ['survival'], act: ['sense-direction', 'subsist'] })],
  'feats/natural-orienteering': [e(S2C, 'on a Survival check to Sense Direction or Track', { sk: ['survival'], act: ['sense-direction', 'track'] })],
  'feats/warren-navigator': [e(BETTER, 'when you Sense Direction, or roll against a Quandary spell', { sk: ['survival'], act: ['sense-direction'] })],
  'feats/wandering-chef-dedication': [e(F2S, 'when you Subsist using Crafting or Cooking Lore', { sk: ['crafting', 'lore'], act: ['subsist'] })],
  'feats/impeccable-crafting': [e(S2C, 'on a Crafting check to make an item of the type you chose with Specialty Crafting', { sk: ['crafting'], act: ['craft'] })],
  'feats/meticulous-restorer': [e(CF2F, 'on a Crafting check to Repair an item', { sk: ['crafting'], act: ['repair'] })],
  'feats/warshard-warrior-dedication': [e(CF2F, 'on a Crafting check to Repair your warshard weapon', { sk: ['crafting'], act: ['repair'] })],
  'feats/spellbook-prodigy': [e(CF2F, 'on a check to Learn a Spell', { sk: ['arcana'], act: ['learn-a-spell'] })],
  'feats/assured-identification': [e(CF2F, 'on an Arcana, Nature, Occultism, or Religion check to Identify Magic', { sk: ['arcana', 'nature', 'occultism', 'religion'], act: ['identify-magic'] })],
  'feats/text-decoder': [e(CF2F, 'when you Decipher Writing', { act: ['decipher-writing'] })],
  'feats/crystal-keeper-dedication': [
    e(S2C, 'when you Decipher Writing', { act: ['decipher-writing'] }),
    e(CF2F, 'when you Decipher Writing', { act: ['decipher-writing'] }),
  ],
  'feats/esteemed-visitor': [e(CF2F, 'while you are in a settlement, on a Diplomacy check to Gather Information or Make an Impression', { sk: ['diplomacy'], act: ['gather-information', 'make-an-impression'] })],
  'feats/travelers-counsel': [e(CF2F, 'the first time each day you would critically fail to Gather Information or Make an Impression', { sk: ['diplomacy'], act: ['gather-information', 'make-an-impression'] })],
  'feats/hobnobber': [e(CF2F, 'when you Gather Information, if you are a master in Diplomacy', { sk: ['diplomacy'], act: ['gather-information'] })],
  'feats/shameless-request': [e(CF2F, 'on a check to Request', { sk: ['diplomacy'], act: ['request'] })],
  'feats/earned-glory': [e(CF2F, 'on a Performance check to Make an Impression on an elf', { sk: ['performance'], act: ['make-an-impression'] })],
  'feats/lord-of-the-fiends': [e(S2C, 'for 1 hour after Lord of the Fiends, on a Deception, Diplomacy, or Intimidation check against a fiend', { sk: ['deception', 'diplomacy', 'intimidation'] })],
  'feats/vicious-critique': [
    e(S2C, 'on the Intimidation check to Coerce, after a critical success on Vicious Critique’s Crafting check', { sk: ['intimidation'], act: ['coerce'] }),
    e(CF2F, 'on the Intimidation check to Coerce, after a critical success on Vicious Critique’s Crafting check', { sk: ['intimidation'], act: ['coerce'] }),
  ],
  'feats/talent-envy': [e(BETTER, 'on the Demoralize this feat grants, if you critically succeeded at the Performance check', { sk: ['intimidation'], act: ['demoralize'] })],
  'feats/sneak-adept': [e(F2S, 'on a Stealth check to Sneak', { sk: ['stealth'], act: ['sneak'] })],
  'feats/thorough-search': [e(S2C, 'on the secret Seek check when you spend the extra time to search thoroughly', { p: true, act: ['seek'] })],
  'feats/risky-surgery': [e(S2C, 'on the Medicine check to Treat Wounds after Risky Surgery', { sk: ['medicine'], act: ['treat-wounds'] })],
  'feats/megafauna-veterinarian': [e(S2C, 'when the subject of your medical care is your megafauna', { sk: ['nature', 'medicine'], act: ['treat-wounds'] })],
  'feats/remember-your-training': [e(F2S, 'on the once-per-day Recall Knowledge check Remember Your Training grants', { act: ['recall-knowledge'] })],
  'feats/familiar-foe': [e(CF2F, 'on a check to Recall Knowledge about undead', { act: ['recall-knowledge'] })],
  'feats/eliminate-red-herrings': [e(CF2F, 'on a check to Recall Knowledge related to one of your active investigations', { act: ['recall-knowledge'] })],
  'feats/reveal-beasts': [e(S2C, 'on a check to Recall Knowledge to identify an animal, beast, fungus, or plant', { act: ['recall-knowledge'] })],
  'feats/know-your-own': [e(CF2F, 'on a check to Recall Knowledge about elves, elven society, or elven history', { act: ['recall-knowledge'] })],
  'feats/ancestral-insight': [e(CF2F, 'on an Alghollthu Lore or Azlanti Lore check to Recall Knowledge', { sk: ['lore'], act: ['recall-knowledge'] })],
  'feats/unmistakable-lore': [e(CF2F, 'when you Recall Knowledge using a Lore subcategory you are trained in', { sk: ['lore'], act: ['recall-knowledge'] })],
  'feats/golden-league-xun-dedication': [e(S2C, 'when you use Underworld Lore to Earn Income or Recall Knowledge', { sk: ['lore'], act: ['earn-income', 'recall-knowledge'] })],
  'feats/tap-into-blood': [e(CF2F, 'on the arcane Tap Into Blood check to Recall Knowledge using Arcana', { sk: ['arcana'], act: ['recall-knowledge'] })],
  'feats/commitment-to-protection': [e(F2S, 'on the Warfare Lore check, if you are legendary in Warfare Lore', { sk: ['lore'] })],
  'feats/practiced-guidance': [e(S2C, 'when you Aid a member of your crop', { act: ['aid'] })],
  'feats/reliable-squire': [e(CF2F, 'on a check to Aid', { act: ['aid'] })],
  'feats/proud-mentor': [e(CF2F, 'on an attempt to Aid', { act: ['aid'] })],
  'feats/cooperative-soul': [e(F2S, 'when you Aid a skill check you are at least an expert in', { act: ['aid'] })],
  // No action record exists for Trick a Magic Item, so the skill star is the whole surface.
  'feats/scroll-trickster-dedication': [e(CF2F, 'when you Trick a Magic Item that is a scroll', { sk: ['arcana', 'nature', 'occultism', 'religion'] })],
  'heritages/river-azarketi': [e(S2C, 'on an Athletics check to Swim', { sk: ['athletics'], act: ['swim'] })],
  'heritages/lethoci': [e(CF2F, 'on an Athletics check to Swim', { sk: ['athletics'], act: ['swim'] })],
  'heritages/vine-leshy': [e(S2C, 'on an Athletics check to Climb', { sk: ['athletics'], act: ['climb'] })],
  'heritages/kijimuna-gnome': [e(S2C, 'on the Athletics check to Climb', { sk: ['athletics'], act: ['climb'] })],
  'heritages/stickytoe-tripkee': [e(S2C, 'when ascending trees, vines, and other foliage, on the Athletics check to Climb', { sk: ['athletics'], act: ['climb'] })],
  'heritages/rite-of-passage': [e(S2C, 'on an Acrobatics check to Balance on narrow surfaces or uneven ground', { sk: ['acrobatics'], act: ['balance'] })],
  'heritages/warrenbred-hobgoblin': [e(S2C, 'on an Acrobatics check to Squeeze', { sk: ['acrobatics'], act: ['squeeze'] })],
  'heritages/cavernstalker-kobold': [e(S2C, 'on an Acrobatics check to Squeeze', { sk: ['acrobatics'], act: ['squeeze'] })],
  'heritages/heavenscribe-kobold': [e(CF2F, 'on a Diplomacy check to Make an Impression or Request', { sk: ['diplomacy'], act: ['make-an-impression', 'request'] })],
  'heritages/runtboss-hobgoblin': [
    e(S2C, 'on an Intimidation check to Coerce a goblin', { sk: ['intimidation'], act: ['coerce'] }),
    e(CF2F, 'on an Intimidation check to Coerce a goblin', { sk: ['intimidation'], act: ['coerce'] }),
  ],

  /* ═══ CONVERTED FROM PROSE — the halves that used to live in situationalBonuses.ts ══════════════
   * Each of these had the rule written into a `bonus` or `when` string, or into a RecordMarker's
   * value. The prose is removed in the same change; leaving both would be the exact drift the
   * structured field exists to prevent.                                                          */
  'feats/steadying-stone': [e(S2C, 'on an Acrobatics check to Balance on uneven ground made of earth or rock', { sk: ['acrobatics'], act: ['balance'] })],
  'feats/athletic-might': [e(S2C, 'on an Athletics check to Climb or Swim', { sk: ['athletics'], act: ['climb', 'swim'] })],
  'feats/brine-may': [e(S2C, 'on an Athletics check to Swim', { sk: ['athletics'], act: ['swim'] })],
  'feats/jungle-strider': [e(S2C, 'to Balance on narrow surfaces or uneven ground made of plant material', { sk: ['acrobatics'], act: ['balance'] })],
  'feats/emerald-boughs-accustomation': [
    e(S2C, 'on a Society check to Subsist', { sk: ['society'], act: ['subsist'] }),
    e(CF2F, 'on a Society check to Subsist', { sk: ['society'], act: ['subsist'] }),
  ],
  'feats/empathy-incarnate': [e(S2C, 'on a Diplomacy check to Make an Impression or Request against a lower-level creature', { sk: ['diplomacy'], act: ['make-an-impression', 'request'] })],
  'feats/just-the-facts': [e(BETTER, 'when you Recall Knowledge (the check is not secret, and you know which information is inaccurate)', { sk: ALL, act: ['recall-knowledge'] })],
  'feats/magical-shorthand': [e(S2C, 'on a check to Learn a Spell', { sk: ['arcana', 'nature', 'occultism', 'religion'], act: ['learn-a-spell'] })],
  'feats/intuitive-crafting': [e(CF2F, 'on a Crafting check to Repair an item', { sk: ['crafting'], act: ['repair'] })],
  'backgrounds/nocturnal-navigator': [e(BETTER, 'on a Survival check whenever you can clearly identify the stars', { sk: ['survival'], act: ['sense-direction'] })],
  'feats/experienced-professional': [e(CF2F, 'when you use Lore to Earn Income', { sk: ['lore'], act: ['earn-income'] })],
  'feats/sturdy-bindings': [e(CF2F, 'on your check to Grapple', { sk: ['athletics'], act: ['grapple'] })],
  'feats/sure-feet': [e(S2C, 'on an Acrobatics check to Balance or an Athletics check to Climb', { sk: ['acrobatics', 'athletics'], act: ['balance', 'climb'] })],
  'feats/fire-savvy': [e(S2C, 'on a save against suffocation or choking from smoke or ash', { sv: ['fortitude'] })],
  'feats/haughty-obstinacy': [e(S2C, 'on a save against a mental effect that directly controls your actions', { sv: ALL })],
  'feats/iron-lung': [e(BETTER, 'on a save against an inhaled poison', { sv: ALL })],
  'feats/unwavering-mien': [e(BETTER, 'on a save against an effect that would make you fall asleep', { sv: ALL })],
  'feats/abjure-the-false-kin': [e(S2C, 'on a save against a mental effect that doesn’t deal damage', { sv: ALL })],
  // The parenthetical second half was inside the prose entry being removed, so it becomes its own
  // entry rather than being dropped: it fires on a different result and the player has to see it.
  'feats/irrepressible': [
    e(S2C, 'on a save against an emotion effect', { sv: ALL }),
    e(CF2F, 'on a save against an emotion effect, if you have the gutsy halfling heritage', { sv: ALL }),
  ],
  'feats/irrepressible-ganzi': [e(S2C, 'on a save against an emotion effect', { sv: ALL })],
  'feats/irrepressible-halfling': [
    e(S2C, 'on a save against an emotion effect', { sv: ALL }),
    e(CF2F, 'on a save against an emotion effect, if you have the gutsy halfling heritage', { sv: ALL }),
  ],
  'feats/irrepressible-nephilim': [e(S2C, 'on a save against an emotion effect', { sv: ALL })],
  'feats/cantorian-reinforcement': [
    e(S2C, 'on a save against a disease or poison', { sv: ALL }),
    e(CF2F, 'on a save against a disease or poison, if you also have Battle Hardened or a similar ability', { sv: ALL }),
  ],
  // Disillusionment is why `DegreeShift.perception` had to exist: its saving-throw half and its
  // "to disbelieve an illusion" Perception half are one rule, and the field could only say one of them.
  'feats/disillusionment': [
    e(S2C, 'on a save against an illusion or dream effect, and on a Perception check to disbelieve an illusion', { sv: ALL, p: true }),
    e(CF2F, 'on a save against an illusion or dream effect, and on a Perception check to disbelieve an illusion', { sv: ALL, p: true }),
  ],
  'heritages/dragonblood': [e(S2C, 'on a save against a fear effect', { sv: ALL })],
  'heritages/caveclimber-kobold': [e(S2C, 'on the Athletics check to Climb (your hands stay free)', { sk: ['athletics'], act: ['climb'] })],
  'heritages/cliffscale-lizardfolk': [e(S2C, 'while not wearing footwear, on the Athletics check to Climb (your hands stay free)', { sk: ['athletics'], act: ['climb'] })],
  'heritages/fishseeker-shoony': [
    e(S2C, 'on a check to Grab an Edge', { sv: ['reflex'], act: ['grab-an-edge'] }),
    e(CF2F, 'on a check to Grab an Edge', { sv: ['reflex'], act: ['grab-an-edge'] }),
  ],
  'heritages/paddler-shoony': [e(S2C, 'on a check to Swim', { sk: ['athletics'], act: ['swim'] })],
  'feats/student-of-the-canon': [
    e(CF2F, 'on a check to Recall Knowledge about the tenets of faiths, or on a Religion check to Decipher Writing of a religious nature', { sk: ['religion'], act: ['recall-knowledge', 'decipher-writing'] }),
    e(S2C, 'on a check to Recall Knowledge about your own faith', { sk: ['religion'], act: ['recall-knowledge'] }),
  ],
  'classFeatures/bravery': [e(S2C, 'on a Will save against a fear effect', { sv: ['will'] })],

  /* ═══ ITEMS ════════════════════════════════════════════════════════════════════════════════════
   * Only while equipped/worn/invested — `degreeShiftRecords` enforces that, the same rule the
   * situational registry uses. A +2 bonus from a cloak in your backpack is not a bonus you have.  */
  'items/cloak-of-repute': [e(S2C, 'once per day, on the Diplomacy check to Request when you activate the cloak', { sk: ['diplomacy'], act: ['request'] })],
  'items/cloak-of-repute-greater': [e(S2C, 'twice per day, on the Diplomacy check to Request when you activate the cloak', { sk: ['diplomacy'], act: ['request'] })],
  'items/cloak-of-repute-major': [
    e(S2C, 'three times per day, on the Diplomacy check to Request when you activate the cloak', { sk: ['diplomacy'], act: ['request'] }),
    e(CF2F, 'three times per day, on the Diplomacy check to Request when you activate the cloak', { sk: ['diplomacy'], act: ['request'] }),
  ],
  'items/runic-skullcap': [e(BETTER, 'on a failed or critically failed check to Recall Knowledge about rune magic or Lissala', { sk: ALL, act: ['recall-knowledge'] })],
  'items/travelers-fulu': [e(BETTER, 'on the Sense Direction check you activated the fulu for (two degrees if you are a master in Survival)', { sk: ['survival'], act: ['sense-direction'] })],
  'items/the-publican': [e(CF2F, 'while invested, on a check to Aid', { act: ['aid'] })],
  'items/hardened-harrow-deck': [e(S2C, 'while you carry more than half the deck, on a save against a fear effect', { sv: ALL })],
  'items/potion-of-stable-form': [e(S2C, 'on a save against a polymorph effect while the potion lasts', { sv: ALL })],
  'items/potion-of-stable-form-greater': [e(S2C, 'on a save against a polymorph effect while the potion lasts', { sv: ALL })],
  'items/sanguine-mutagen': [e(S2C, 'on a save against a disease, poison, or an effect that would make you fatigued', { sv: ALL })],
  'items/sanguine-mutagen-greater': [e(S2C, 'on a save against a disease, poison, or an effect that would make you fatigued', { sv: ALL })],
  'items/sanguine-mutagen-major': [
    e(S2C, 'on a save against a disease, poison, or an effect that would make you fatigued', { sv: ALL }),
    e(CF2F, 'on a save against a disease, poison, or an effect that would make you fatigued', { sv: ALL }),
  ],
  'items/juggernaut-mutagen': [e(S2C, 'on a Fortitude save while the mutagen lasts', { sv: ['fortitude'] })],
  'items/juggernaut-mutagen-major': [
    e(S2C, 'on a Fortitude save while the mutagen lasts', { sv: ['fortitude'] }),
    e(CF2F, 'on a Fortitude save while the mutagen lasts', { sv: ['fortitude'] }),
  ],
  'items/serene-mutagen': [e(S2C, 'on a Will save against a mental effect while the mutagen lasts', { sv: ['will'] })],
  'items/serene-mutagen-greater': [e(S2C, 'on a Will save against a mental effect while the mutagen lasts', { sv: ['will'] })],
  'items/serene-mutagen-major': [
    e(S2C, 'on a Will save against a mental effect while the mutagen lasts', { sv: ['will'] }),
    e(CF2F, 'on a Will save against a mental effect while the mutagen lasts', { sv: ['will'] }),
  ],
  'items/bravos-brew': [e(S2C, 'on a save against fear while the brew lasts', { sv: ALL })],
  'items/desolation-locket-major': [e(CF2F, 'on a save against an emotion effect', { sv: ALL })],
  'items/inextinguishable': [e(S2C, 'on a save against a death or void effect', { sv: ALL })],
  'items/living-death': [e(BETTER, 'on a save against an effect that would deal void damage to you', { sv: ALL })],
  'items/stormshard': [e(BETTER, 'on the saving throw the stormshard is used for', { sv: ALL })],
  'items/stormshard-greater': [e(BETTER, 'on the saving throw the stormshard is used for', { sv: ALL })],
  'items/stormshard-major': [e(BETTER, 'on the saving throw the stormshard is used for', { sv: ALL })],
  'items/armbands-of-the-gorgon': [e(BETTER, 'on a save against a spell or effect with the incapacitation trait', { sv: ALL })],
  'items/iron-medallion': [
    e(F2S, 'on the triggering save', { sv: ALL }),
    e(CF2F, 'on the triggering save', { sv: ALL }),
  ],
  'items/star-of-cynosure': [
    e(F2S, 'on the triggering save', { sv: ALL }),
    e(CF2F, 'on the triggering save', { sv: ALL }),
  ],
  'items/mesmerizing-opal': [
    e(S2C, 'on the triggering save', { sv: ALL }),
    e(CF2F, 'on the triggering save', { sv: ALL }),
  ],
  'items/evil-reflecting-shield': [e(BETTER, 'on the saving throw this shield is activated for', { sv: ALL })],
  'items/hunters-hagbook': [e(BETTER, 'on the saving throw you use the hagbook for', { sv: ALL })],
  'items/tradecraft-tattoo': [e(CF2F, 'on a Crafting check to Earn Income', { sk: ['crafting'], act: ['earn-income'] })],
  'items/tradecraft-tattoo-greater': [e(CF2F, 'on a Crafting check to Earn Income', { sk: ['crafting'], act: ['earn-income'] })],
  'items/thurible-of-revelation': [e(CF2F, 'while holding the thurible, when you Decipher Writing of a religious nature', { sk: ['religion'], act: ['decipher-writing'] })],
  'items/thurible-of-revelation-lesser': [e(CF2F, 'while holding the thurible, when you Decipher Writing of a religious nature', { sk: ['religion'], act: ['decipher-writing'] })],
  'items/thurible-of-revelation-moderate': [e(CF2F, 'while holding the thurible, when you Decipher Writing of a religious nature', { sk: ['religion'], act: ['decipher-writing'] })],
  'items/thurible-of-revelation-greater': [e(CF2F, 'while holding the thurible, when you Decipher Writing of a religious nature', { sk: ['religion'], act: ['decipher-writing'] })],
  'items/creative-spark': [e(CF2F, 'once per day, on a Crafting check related to blacksmithing', { sk: ['crafting'], act: ['craft'] })],
  'items/elements-of-creation': [e(BETTER, 'on a Crafting check related to blacksmithing, while all four creative-spark wisps assist you', { sk: ['crafting'], act: ['craft'] })],
  'items/matchmaker-fulu': [e(CF2F, 'on the Diplomacy check the fulu is activated for', { sk: ['diplomacy'] })],
  'items/skinstitch-salve': [e(S2C, 'on the Medicine check the salve is applied for', { sk: ['medicine'], act: ['treat-wounds'] })],
  'items/breastplate-of-the-mountain': [e(CF2F, 'on the check this armor is activated for', { sk: ['athletics'] })],
  'items/lawbringers-lasso': [e(CF2F, 'on an attempt to Grapple a chaotic creature with the lasso', { sk: ['athletics'], act: ['grapple'] })],
  'items/grappling-vine': [e(CF2F, 'on the check to secure the vine', { sk: ['athletics'] })],
  'items/cryolite-eye': [e(S2C, 'on a Perception check against an illusion', { p: true })],
  'items/possibility-tome': [e(CF2F, 'on the check the tome is consulted for', { sk: ALL })],
  'items/sash-of-books': [e(CF2F, 'on the Recall Knowledge check the sash is used for', { sk: ALL, act: ['recall-knowledge'] })],
  'items/the-vision': [e(BETTER, 'on a Recall Knowledge check with that Lore, if you are already a master or legendary in it', { sk: ['lore'], act: ['recall-knowledge'] })],
  'items/eye-of-enlightenment': [e(CF2F, 'on the check the eye is activated for', { sk: ALL })],
  'items/enveloping-light-greater': [e(CF2F, 'on any check to Treat your Wounds', { sk: ['medicine'], act: ['treat-wounds'] })],
  'items/enveloping-light': [e(CF2F, 'the first time each day someone Treats your Wounds', { sk: ['medicine'], act: ['treat-wounds'] })],
  'items/headbands-of-translocation': [e(CF2F, 'while both headbands are invested, when you Aid an ally wearing the paired headband', { act: ['aid'] })],
  'items/artistic-perfection': [e(S2C, 'on a check with the skill you chose', { sk: ALL })],
  'items/topology-protoplasm': [e(BETTER, 'on a check to Squeeze while in the protoplasm', { sk: ['acrobatics'], act: ['squeeze'] })],
  'items/words-of-wisdom': [e(CF2F, 'during the activation, on a Diplomacy check or the associated skill', { sk: ['diplomacy', 'intimidation', 'deception', 'performance'] })],
  'items/inubrix-shield': [e(CF2F, 'on a check to Disarm a metal item, if you drop the weapon', { sk: ['athletics'], act: ['disarm'] })],
  'items/inubrix-shield-standard-grade': [e(CF2F, 'on a check to Disarm a metal item, if you drop the weapon', { sk: ['athletics'], act: ['disarm'] })],
  'items/inubrix-shield-high-grade': [e(CF2F, 'on a check to Disarm a metal item, if you drop the weapon', { sk: ['athletics'], act: ['disarm'] })],
  'items/inubrix-buckler-standard-grade': [e(CF2F, 'on a check to Disarm a metal item, if you drop the weapon', { sk: ['athletics'], act: ['disarm'] })],
  'items/inubrix-buckler-high-grade': [e(CF2F, 'on a check to Disarm a metal item, if you drop the weapon', { sk: ['athletics'], act: ['disarm'] })],
  'items/monkey-pin': [e(CF2F, 'on the triggering Athletics check', { sk: ['athletics'] })],
  'items/savior-spike': [
    e(S2C, 'on the triggering attempt', { sk: ['athletics'] }),
    e(CF2F, 'on the triggering attempt', { sk: ['athletics'] }),
  ],
  'items/shark-tooth-charm': [
    e(S2C, 'on the triggering Athletics check to Swim', { sk: ['athletics'], act: ['swim'] }),
    e(CF2F, 'on the triggering Athletics check to Swim', { sk: ['athletics'], act: ['swim'] }),
  ],
  'feats/well-groomed': [e(S2C, 'on a save against a disease', { sv: ALL })],
  'items/the-sickness': [e(S2C, 'on a save against a disease', { sv: ALL })],
  'items/grub-gloves': [e(S2C, 'on a Reflex save to Grab an Edge', { sv: ['reflex'], act: ['grab-an-edge'] })],
  'items/grub-gloves-lesser': [e(S2C, 'on a Reflex save to Grab an Edge', { sv: ['reflex'], act: ['grab-an-edge'] })],
  'items/grub-gloves-moderate': [e(S2C, 'on a Reflex save to Grab an Edge', { sv: ['reflex'], act: ['grab-an-edge'] })],
  'items/grub-gloves-greater': [e(S2C, 'on a Reflex save to Grab an Edge', { sv: ['reflex'], act: ['grab-an-edge'] })],
  'items/bravos-brew-greater': [e(S2C, 'on a Will save against fear while the brew lasts', { sv: ['will'] })],
  'items/juggernaut-mutagen-greater': [e(S2C, 'on a Fortitude save while the mutagen lasts', { sv: ['fortitude'] })],
  'heritages/wajaghand-vanara': [e(S2C, 'on a save against an emotion effect', { sv: ALL })],
  'items/hydra-mutagen': [e(BETTER, 'once per mutagen, when you fail or critically fail a Will save against a mental effect', { sv: ['will'] })],
  'items/lovers-gloves': [e(S2C, 'while a shared Bond lasts, on a save against an emotion effect that causes negative emotions', { sv: ALL })],
  'heritages/born-of-item': [e(S2C, 'in yaoguai form, on a save against a mental effect', { sv: ALL })],
  'feats/numb': [e(S2C, 'while Deteriorated, on a save against an emotion or pain effect', { sv: ALL })],
  'feats/gorilla-stance': [e(S2C, 'on an Athletics check to Climb while in Gorilla Stance', { sk: ['athletics'], act: ['climb'] })],
  'feats/staff-acrobat-dedication': [e(S2C, 'on an Acrobatics check to Balance while wielding your staff', { sk: ['acrobatics'], act: ['balance'] })],
  'feats/conceited-mindset': [e(S2C, 'on a save against a mental effect', { sv: ALL })],

  /* ═══ DOWNGRADES ═══════════════════════════════════════════════════════════════════════════════
   * Added 2026-08-12, when `shift` gained three values that make the result worse. Every one is the
   * PLAYER'S OWN roll, checked one by one against its text — a downgrade landing on someone else
   * (an enemy's save getting worse) is still Ruling F and still stays out.                        */

  // "If the triggering attack was a critical hit, use the result one degree of success worse than
  // what you rolled." The check is the Deception roll the reaction itself calls for.
  'feats/bravos-determination': [
    e(WORSE, 'on the Deception check this reaction calls for, if the triggering Strike was a critical hit', { sk: ['deception'] }),
  ],
  // "If you roll a critical success, you get a success instead." Engineering Lore to Force Open, so
  // the Lore key is the specific one the feat names — a bare `lore` would star every Lore the
  // character has for a feat that only ever touches this one.
  'feats/explosive-entry': [
    e(CS2S, 'on the Engineering Lore check to Force Open a target you set explosives on', { sk: ['lore:engineering'], act: ['force-open'] }),
  ],
  // "the result of YOUR check against that creature is one degree of success worse" — your own
  // Intimidation roll, not the target's save, which is why this one is in and the ally-facing ones
  // are not.
  'feats/flash-your-badge': [
    e(WORSE, 'on the Intimidation check to Demoralize a creature that has not broken a law in the past week', { sk: ['intimidation'], act: ['demoralize'] }),
  ],
  // "If you're chaotic or a worshipper of Lamashtu, you take a -2 penalty to your Will save, and the
  // result of your save is one degree of success worse" — a cursed intelligent weapon dominating its
  // own wielder.
  'items/jax': [
    e(WORSE, "on the Will save against Jax's dominate, if you are chaotic or a worshipper of Lamashtu", { sv: ['will'] }),
  ],
  // "if you roll a failure on the check, you get a critical failure instead" — the price of the oil's
  // reduced Administer First Aid DC.
  'items/ladys-blessing-oil': [
    e(F2CF, 'on the Medicine check to Administer First Aid while using the oil', { sk: ['medicine'], act: ['administer-first-aid'] }),
  ],
  // The contract's hidden condition: "if you roll a failure on a saving throw against a death effect,
  // you get a critical failure instead."
  'items/devils-luck': [e(F2CF, 'on a saving throw against a death effect', { sv: ALL })],
  // "the next time you use this activation … the result of your Intimidation check is one degree of
  // success worse than the result you rolled."
  'items/cresset-of-grisly-interrogation': [
    e(WORSE, 'on the Intimidation check the next time you activate the cresset within 24 hours, after a critical failure', { sk: ['intimidation'] }),
  ],
};

/* ------------------------------------------------------------------------------------------------
 * Records the text describes but this lane deliberately does NOT carry. Printed by the run so the
 * next pass sees them rather than rediscovering them.
 * ---------------------------------------------------------------------------------------------- */
/* ⚠ EMPTIED 2026-08-12. This list held nine records the lane could not express, because every value
 * of `DegreeShift.shift` improved the result. `critSuccessToSuccess`, `failToCritFail` and `oneWorse`
 * now exist and all nine are authored above — see the DOWNGRADES block in AUTHORED.
 *
 * The list is kept, empty, because it was the honest record of a limit rather than a to-do: anything
 * added here again means the vocabulary has run out a second time, and that is worth seeing in the
 * run's output rather than discovering from a record that silently says nothing. */
const DOWNGRADES = [];
const OTHERS_ROLL = [
  'feats/elven-aloofness', 'feats/wardens-guidance', 'feats/swimmers-guidance', 'feats/heightened-instincts',
  'feats/hey-over-here', 'feats/command-attention', 'feats/assured-ritualist', 'feats/blowgun-poisoner',
  'feats/heralds-strike', 'feats/bloody-denial', 'feats/tenacious-jaws', 'feats/absolve-sins',
  'feats/defensive-dismissal', 'feats/shield-your-eyes', 'feats/horselords-bond',
  'classFeatures/devotion-phantom-eidolon', 'items/oneiric-crystals-of-the-slumberer', 'items/radiant-lance',
  'items/radiant-spark', 'items/drovers-band', 'items/duelists-beacon', 'items/grease-snare',
  'items/discord-fulu', 'items/witch-token', 'items/monsoon-curtain', 'items/perception-filter',
  'items/wand-of-contagious-frailty', 'items/flawless-celestial-shawl', 'items/stone-circle-greater',
  'items/researcher', 'items/crimson-bluff',
];
const NO_SHEET_ROW = [
  'feats/witness-of-earth — an atone ritual check',
  'feats/the-bitter-scholars-promotion — a ritual check',
  'feats/the-immortal-attains-the-summit — a ritual check',
  'feats/wake-to-strife — the shift sits inside the ability\'s own critical-failure entry',
  'feats/fiend-eternal — "either" has no antecedent in the imported text',
  'feats/cheaters-always-prosper — Dirty Trick has no action record to mark',
  'items/awakened-metal-shot (+3 variants) — a counteract check, which has no sheet row',
  'items/penetrating-ammunition — improves a critical hit\'s reach across targets, not a check',
  'items/daredevil-boots (+greater) — "proficiency rank one degree better", not a degree of success',
  'items/successor-doll — a die roll that "might improve the degree", not a shift',
  'items/reflected-moonlight-fulu — describes the reflected effect, not your roll',
  'items/singing-muse / orchestral-brooch / greased-axle / ensnaring-disk / sanitizing-pin / jug-of-fond-remembrance — "the triggering check" names no skill, save or action to star',
];
/* `savage-critical` and `keen-flair` stay as situational prose: they widen the CRITICAL RANGE on a
 * Strike ("a natural 19 that would be a success"), which is a different mechanic from a degree shift
 * and has no strike target on DegreeShift. `on-my-best-day` likewise scales a bonus BY degree of
 * success rather than shifting one. */

/* ---------------------------------------------------------------------------------- apply ------ */
const core = JSON.parse(readFileSync(p('public/core.json'), 'utf8'));

const writes = [];
const missing = [];
for (const [key, shifts] of Object.entries(AUTHORED)) {
  const i = key.indexOf('/');
  const category = key.slice(0, i);
  const id = key.slice(i + 1);
  if (!core[category]?.[id]) { missing.push(key); continue; }
  writes.push({ category, id, field: 'degreeShifts', value: shifts });
}

const byCat = {};
for (const w of writes) byCat[w.category] = (byCat[w.category] ?? 0) + 1;
console.log(`authored ${Object.keys(AUTHORED).length} records · resolvable ${writes.length}`);
console.log('  by collection: ' + Object.entries(byCat).map(([k, v]) => `${k} ${v}`).join(' · '));
console.log(`  entries total: ${writes.reduce((n, w) => n + w.value.length, 0)}`);
if (missing.length) {
  console.log(`\nNOT IN core.json (${missing.length}) — nothing written for these:`);
  for (const m of missing) console.log('   ' + m);
}
console.log(
  DOWNGRADES.length
    ? `\n⚠ not authored — a downgrade the enum still cannot say (${DOWNGRADES.length}):`
    : '\nevery downgrade the corpus prints is authored (the enum can say all three directions)',
);
for (const d of DOWNGRADES) console.log('   ' + d);
console.log(`not authored — someone else's roll, ruling F (${OTHERS_ROLL.length}): ${OTHERS_ROLL.join(', ')}`);
console.log(`not authored — no row on the sheet to star (${NO_SHEET_ROW.length}):`);
for (const n of NO_SHEET_ROW) console.log('   ' + n);

if (DRY) { console.log('\n--dry: nothing written'); process.exit(0); }

for (const w of writes) core[w.category][w.id].degreeShifts = w.value;
writeFileSync(p('public/core.json'), JSON.stringify(core));

// The overlay is the ONLY thing that carries an authored field through `npm run data`. Written
// through write-backfill.mjs — a hand-rolled stringify reformats all 6,841 rows into an unreviewable
// diff. Rows are replaced in place when they already exist so re-running is idempotent.
const overlay = readBackfill(ROOT);
let added = 0;
let updated = 0;
for (const w of writes) {
  const at = overlay.findIndex((x) => x.category === w.category && x.id === w.id && x.field === 'degreeShifts' && !x.path);
  if (at >= 0) { overlay[at].value = w.value; updated++; }
  else { overlay.push({ category: w.category, id: w.id, field: 'degreeShifts', value: w.value }); added++; }
}
writeBackfill(ROOT, overlay);
console.log(`\noverlay: ${added} added, ${updated} refreshed (now ${overlay.length} rows)`);
console.log('written: public/core.json, scripts/data/effect-backfill.json');
