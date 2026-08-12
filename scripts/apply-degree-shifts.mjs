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
/* The TWO-RUNG upgrade (2026-08-13). Four records print "when you roll a failure OR CRITICAL FAILURE
 * … you get a success instead" and were authored `failToSuccess` alone, which tells a player who has
 * just critically failed that the rule does not reach them. `oneBetter` is not the fix — it moves the
 * crit failure only to a failure and invents a success → critical success upgrade none of the four
 * grants — so the enum gained a value instead. Paired WITH `F2S` on those records, one entry per rung,
 * the same shape every other two-degree record here uses. */
const CF2S = 'critFailToSuccess';

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
  // Third Path re-picks: "Choose one of the saving throws you selected for path to perfection OR
  // SECOND PATH TO PERFECTION." Its trigger used to be byte-identical to the line above, naming only
  // the first of the two sources — so a monk who took Fortitude at 7th, Reflex at 11th and Reflex
  // again at 15th read crit-fail protection whose trigger pointed at Fortitude, which has none.
  'classFeatures/third-path-to-perfection': [e(CF2F, 'on the save you chose for Third Path to Perfection, from those you selected for path to perfection or second path to perfection', { sv: ALL })],
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
  // "However, you gain NONE OF THESE BENEFITS against effects originating from alghollthus" — the
  // revocation is plural and follows a sentence granting exactly two things, the +2 and this shift,
  // so it takes the shift with it. It lives in its own sentence, which is why the authoring pass
  // never saw it: the candidate it was written from held the benefit sentence alone.
  'feats/alghollthu-bound': [e(S2C, 'on a save against a mental effect that would make you controlled, unless the effect originates from an alghollthu', { sv: ['will'] })],
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
  'feats/reckless-abandon-goblin': [
    e(F2S, 'for the remainder of your turn after Reckless Abandon, on a save against a harmful effect', { sv: ALL }),
    e(CF2S, 'for the remainder of your turn after Reckless Abandon, on a save against a harmful effect', { sv: ALL }),
  ],
  // The fourth record of the two-rung shape, and the twin of the goblin feat directly above: "if you
  // roll a failure OR CRITICAL FAILURE on a saving throw against a harmful effect, you get a success
  // instead". Authored `failToSuccess` alone, it told a player who had just critically failed that
  // the rule did not reach them.
  'feats/reckless-abandon': [
    e(F2S, 'for the remainder of your turn after Reckless Abandon, on a save against a harmful effect', { sv: ALL }),
    e(CF2S, 'for the remainder of your turn after Reckless Abandon, on a save against a harmful effect', { sv: ALL }),
  ],
  'feats/eternal-legend-dedication': [e(S2C, 'on a save against an effect that would impose the condition you chose during daily preparations', { sv: ALL })],
  'feats/duck': [
    e(S2C, 'on a Reflex save against an area ability from a Huge or larger creature', { sv: ['reflex'] }),
    e(CF2F, 'on a Reflex save against an area ability from a Huge or larger creature', { sv: ['reflex'] }),
  ],
  // Two saves, not three. The feat's own text names none, so the narrowing words live in its sole
  // referent — which is also its printed prerequisite: Grit and Tenacity triggers on "You fail a
  // Fortitude or Will save", so there is no Reflex reroll for the shift to reach. Q2's "star all
  // three" is for a clause that applies to saves generally; this one is a reroll of two tracks.
  'feats/unshakable-grit': [
    e(S2C, 'on the reroll granted by your Grit and Tenacity reaction', { sv: ['fortitude', 'will'] }),
    e(CF2F, 'on the reroll granted by your Grit and Tenacity reaction', { sv: ['fortitude', 'will'] }),
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
  // The trigger is "a Fortitude save AFFECTED BY THIS BONUS", and the bonus is granted to three
  // saves, not two: against afflictions, against GAINING sickened, and to REMOVE sickened. The third
  // was missing, so a goblin retching off spoiled food — the heritage's own example — read a trigger
  // that excluded them. The +2 was already authored with all three clauses at situationalBonuses.ts,
  // so this was the two-registry drift within a single record.
  'heritages/irongut-goblin': [e(S2C, 'on a Fortitude save against an affliction, against gaining the sickened condition, or to remove the sickened condition — only when it came from something you ingested', { sv: ['fortitude'] })],
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
  // TWO clauses, two entries. "When you Sense Direction OR ATTEMPT A ROLL AGAINST A QUANDARY SPELL,
  // you get a result one degree of success better." The second clause was hung on the Survival row,
  // where that roll never happens: Quandary's own text is "the target can attempt an OCCULTISM check,
  // PERCEPTION check, or THIEVERY check against your spell DC to solve the puzzle", so none of the
  // three rows it really lands on was starred. Ruling D — star every skill that could perform the
  // named roll. Split rather than merged so each row's note names the trigger that reaches it.
  // `actions` stays Sense Direction only: `core.actions` has no record for the Quandary escape.
  'feats/warren-navigator': [
    e(BETTER, 'when you Sense Direction', { sk: ['survival'], act: ['sense-direction'] }),
    e(BETTER, 'on a roll to escape a Quandary spell', { sk: ['occultism', 'thievery'], p: true }),
  ],
  'feats/wandering-chef-dedication': [e(F2S, 'when you Subsist using Crafting or Cooking Lore', { sk: ['crafting', 'lore'], act: ['subsist'] })],
  'feats/impeccable-crafting': [e(S2C, 'on a Crafting check to make an item of the type you chose with Specialty Crafting', { sk: ['crafting'], act: ['craft'] })],
  'feats/meticulous-restorer': [e(CF2F, 'on a Crafting check to Repair an item', { sk: ['crafting'], act: ['repair'] })],
  'feats/warshard-warrior-dedication': [e(CF2F, 'on a Crafting check to Repair your warshard weapon', { sk: ['crafting'], act: ['repair'] })],
  'feats/spellbook-prodigy': [e(CF2F, 'on a check to Learn a Spell', { sk: ['arcana'], act: ['learn-a-spell'] })],
  'feats/assured-identification': [e(CF2F, 'on an Arcana, Nature, Occultism, or Religion check to Identify Magic', { sk: ['arcana', 'nature', 'occultism', 'religion'], act: ['identify-magic'] })],
  'feats/text-decoder': [e(CF2F, 'when you Decipher Writing', { act: ['decipher-writing'] })],
  // Ruling D / Q2: the text names the four skills that perform the shifted check — "You can use
  // Arcana, Occultism, Religion, or Society to Decipher Writing" — and the entry starred none of
  // them, which is the `sure-feet` failure (actions marked, skill rows bare) this field exists to
  // end. An actions-only entry is dropped outright by `authoredSituational`.
  'feats/crystal-keeper-dedication': [
    e(S2C, 'when you Decipher Writing by meditating before a crystal', { sk: ['arcana', 'occultism', 'religion', 'society'], act: ['decipher-writing'] }),
    e(CF2F, 'when you Decipher Writing by meditating before a crystal', { sk: ['arcana', 'occultism', 'religion', 'society'], act: ['decipher-writing'] }),
  ],
  'feats/esteemed-visitor': [e(CF2F, 'while you are in a settlement, on a Diplomacy check to Gather Information or Make an Impression', { sk: ['diplomacy'], act: ['gather-information', 'make-an-impression'] })],
  'feats/travelers-counsel': [e(CF2F, 'the first time each day you would critically fail to Gather Information or Make an Impression', { sk: ['diplomacy'], act: ['gather-information', 'make-an-impression'] })],
  'feats/hobnobber': [e(CF2F, 'when you Gather Information, if you are a master in Diplomacy', { sk: ['diplomacy'], act: ['gather-information'] })],
  'feats/shameless-request': [e(CF2F, 'on a check to Request', { sk: ['diplomacy'], act: ['request'] })],
  'feats/earned-glory': [e(CF2F, 'on a Performance check to Make an Impression on an elf', { sk: ['performance'], act: ['make-an-impression'] })],
  'feats/lord-of-the-fiends': [e(S2C, 'for 1 hour after Lord of the Fiends, on a Deception, Diplomacy, or Intimidation check against a fiend', { sk: ['deception', 'diplomacy', 'intimidation'] })],
  // The two entries do NOT share a gate. "Success: As critical success, but you only gain the
  // benefits when rolling a success on your Intimidation check" GRANTS the upgrade half on a plain
  // success of the Crafting check; its restriction strips only the crit-fail half, which is keyed to
  // rolling a critical failure. Both were authored on the crit-success gate.
  'feats/vicious-critique': [
    e(S2C, 'on the Intimidation check to Coerce, after a success or critical success on Vicious Critique’s Crafting check', { sk: ['intimidation'], act: ['coerce'] }),
    e(CF2F, 'on the Intimidation check to Coerce, after a critical success on Vicious Critique’s Crafting check', { sk: ['intimidation'], act: ['coerce'] }),
  ],
  'feats/talent-envy': [e(BETTER, 'on the Demoralize this feat grants, if you critically succeeded at the Performance check', { sk: ['intimidation'], act: ['demoralize'] })],
  'feats/sneak-adept': [e(F2S, 'on a Stealth check to Sneak', { sk: ['stealth'], act: ['sneak'] })],
  'feats/thorough-search': [e(S2C, 'on the secret Seek check when you spend the extra time to search thoroughly', { p: true, act: ['seek'] })],
  'feats/risky-surgery': [e(S2C, 'on the Medicine check to Treat Wounds after Risky Surgery', { sk: ['medicine'], act: ['treat-wounds'] })],
  // "You can attempt a Nature check instead of a Medicine check for ANY OF MEDICINE'S TRAINED AND
  // UNTRAINED USES … if the subject of your care is your megafauna and you roll a success on YOUR
  // CHECK, you get a critical success instead." Treat Wounds is only the parenthetical example of a
  // rank-gated action in the sentence ABOUT PROFICIENCY RANK; the shift is on the whole set. The
  // authored `when` already asserted that breadth while its `actions` list contradicted it.
  'feats/megafauna-veterinarian': [e(S2C, 'when the subject of your medical care is your megafauna', { sk: ['nature', 'medicine'], act: ['treat-wounds', 'treat-disease', 'treat-poison', 'administer-first-aid'] })],
  'feats/remember-your-training': [e(F2S, 'on the once-per-day Recall Knowledge check Remember Your Training grants', { act: ['recall-knowledge'] })],
  'feats/familiar-foe': [e(CF2F, 'on a check to Recall Knowledge about undead', { act: ['recall-knowledge'] })],
  'feats/eliminate-red-herrings': [e(CF2F, 'on a check to Recall Knowledge related to one of your active investigations', { act: ['recall-knowledge'] })],
  'feats/reveal-beasts': [e(S2C, 'on a check to Recall Knowledge to identify an animal, beast, fungus, or plant', { act: ['recall-knowledge'] })],
  'feats/know-your-own': [e(CF2F, 'on a check to Recall Knowledge about elves, elven society, or elven history', { act: ['recall-knowledge'] })],
  'feats/ancestral-insight': [e(CF2F, 'on an Alghollthu Lore or Azlanti Lore check to Recall Knowledge', { sk: ['lore'], act: ['recall-knowledge'] })],
  'feats/unmistakable-lore': [e(CF2F, 'when you Recall Knowledge using a Lore subcategory you are trained in', { sk: ['lore'], act: ['recall-knowledge'] })],
  'feats/golden-league-xun-dedication': [e(S2C, 'when you use Underworld Lore to Earn Income or Recall Knowledge', { sk: ['lore'], act: ['earn-income', 'recall-knowledge'] })],
  'feats/tap-into-blood': [e(CF2F, 'on the arcane Tap Into Blood check to Recall Knowledge using Arcana', { sk: ['arcana'], act: ['recall-knowledge'] })],
  // The Lore key is the one the feat names, for the same reason Explosive Entry's is: the feat prints
  // "Warfare Lore" three times and is prerequisite-gated on it, so a bare `lore` wildcard — which
  // `targetMatches` reads as EVERY `lore:*` row — stars every other Lore the character owns for a
  // rule that can never reach them. The wildcard belongs to "a Lore you're trained in", not to this.
  'feats/commitment-to-protection': [
    e(F2S, 'on the Warfare Lore check, if you are legendary in Warfare Lore', { sk: ['lore:warfare'] }),
    e(CF2S, 'on the Warfare Lore check, if you are legendary in Warfare Lore', { sk: ['lore:warfare'] }),
  ],
  'feats/practiced-guidance': [e(S2C, 'when you Aid a member of your crop', { act: ['aid'] })],
  'feats/reliable-squire': [e(CF2F, 'on a check to Aid', { act: ['aid'] })],
  'feats/proud-mentor': [e(CF2F, 'on an attempt to Aid', { act: ['aid'] })],
  'feats/cooperative-soul': [
    e(F2S, 'when you Aid a skill check you are at least an expert in', { act: ['aid'] }),
    e(CF2S, 'when you Aid a skill check you are at least an expert in', { act: ['aid'] }),
  ],
  // No action record exists for Trick a Magic Item, so the skill star is the whole surface.
  'feats/scroll-trickster-dedication': [e(CF2F, 'when you Trick a Magic Item that is a scroll', { sk: ['arcana', 'nature', 'occultism', 'religion'] })],
  'heritages/river-azarketi': [e(S2C, 'on an Athletics check to Swim', { sk: ['athletics'], act: ['swim'] })],
  'heritages/lethoci': [e(CF2F, 'on an Athletics check to Swim', { sk: ['athletics'], act: ['swim'] })],
  'heritages/vine-leshy': [e(S2C, 'on an Athletics check to Climb', { sk: ['athletics'], act: ['climb'] })],
  'heritages/kijimuna-gnome': [e(S2C, 'on the Athletics check to Climb', { sk: ['athletics'], act: ['climb'] })],
  'heritages/stickytoe-tripkee': [e(S2C, 'when ascending trees, vines, and other foliage, on the Athletics check to Climb', { sk: ['athletics'], act: ['climb'] })],
  // "within forests" is the qualifier on the preceding sentence's checks, and the shift sentence says
  // "ONE OF THESE Acrobatics checks" — anaphoric, so it inherits the terrain. Dropping it promised
  // the upgrade on any narrow surface anywhere; every sibling in this table keeps its qualifier.
  'heritages/rite-of-passage': [e(S2C, 'on an Acrobatics check to Balance on narrow surfaces or uneven ground within forests', { sk: ['acrobatics'], act: ['balance'] })],
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
  // Three entries: the feat's "Furthermore" sentence is a SECOND trigger with its own action —
  // "when you attempt a Society check to Recall Knowledge about cultural practices and roll a
  // critical failure, you get a failure instead". It was carried only as prose in
  // situationalBonuses.ts, which stars the skill and leaves the Recall Knowledge action row bare.
  'feats/emerald-boughs-accustomation': [
    e(S2C, 'on a Society check to Subsist', { sk: ['society'], act: ['subsist'] }),
    e(CF2F, 'on a Society check to Subsist', { sk: ['society'], act: ['subsist'] }),
    e(CF2F, 'on a Society check to Recall Knowledge about cultural practices', { sk: ['society'], act: ['recall-knowledge'] }),
  ],
  // "Whenever you attempt a Diplomacy check to Gather Information, you can't critically fail" is the
  // only "can't critically fail" phrasing in the corpus, which is why it was missed — the three
  // siblings (hobnobber, travelers-counsel, esteemed-visitor) all print "you get a failure instead"
  // and are authored. Same rule, so the same value: on this record it was prose-only, and prose stars
  // the skill without ever marking the Gather Information row.
  'feats/empathy-incarnate': [
    e(S2C, 'on a Diplomacy check to Make an Impression or Request against a lower-level creature', { sk: ['diplomacy'], act: ['make-an-impression', 'request'] }),
    e(CF2F, 'on a Diplomacy check to Gather Information', { sk: ['diplomacy'], act: ['gather-information'] }),
  ],
  'feats/just-the-facts': [e(BETTER, 'when you Recall Knowledge (the check is not secret, and you know which information is inaccurate)', { sk: ALL, act: ['recall-knowledge'] })],
  'feats/magical-shorthand': [e(S2C, 'on a check to Learn a Spell', { sk: ['arcana', 'nature', 'occultism', 'religion'], act: ['learn-a-spell'] })],
  'feats/intuitive-crafting': [e(CF2F, 'on a Crafting check to Repair an item', { sk: ['crafting'], act: ['repair'] })],
  // NOT `oneBetter`: the text enumerates two rungs — "if you roll a success … you get a critical
  // success instead; if you roll a critical failure … you get a failure instead" — and says nothing
  // about a failure, which `oneBetter` would have promised becomes a success. Every record that
  // legitimately carries `oneBetter` prints the blanket phrase ("a result one degree of success
  // better"); this one enumerates, exactly like the five two-entry records elsewhere in this table.
  // The trigger also narrows: the shift is on "a check to Sense Direction or otherwise orienteer",
  // not on every Survival check made under a clear sky.
  'backgrounds/nocturnal-navigator': [
    e(S2C, 'on a Survival check to Sense Direction or otherwise orienteer, whenever you can clearly identify the stars', { sk: ['survival'], act: ['sense-direction'] }),
    e(CF2F, 'on a Survival check to Sense Direction or otherwise orienteer, whenever you can clearly identify the stars', { sk: ['survival'], act: ['sense-direction'] }),
  ],
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
  // The footwear proviso governs the HANDS-FREE conjunct only — "as long as you aren't wearing
  // footwear, you can use the sticky pads on your feet to climb, leaving your hands free" — and the
  // shift opens its own sentence with "Additionally". The condition had crossed the sentence
  // boundary, so a booted lizardfolk was told the upgrade was off when it is on. The hands-free rule
  // keeps its real footwear condition as a Climb action marker in situationalBonuses.ts, which is why
  // the parenthetical goes too: repeating it here would re-assert it unconditionally.
  'heritages/cliffscale-lizardfolk': [e(S2C, 'on an Athletics check to Climb', { sk: ['athletics'], act: ['climb'] })],
  'heritages/fishseeker-shoony': [
    e(S2C, 'on a check to Grab an Edge', { sv: ['reflex'], act: ['grab-an-edge'] }),
    e(CF2F, 'on a check to Grab an Edge', { sv: ['reflex'], act: ['grab-an-edge'] }),
  ],
  'heritages/paddler-shoony': [e(S2C, 'on a check to Swim', { sk: ['athletics'], act: ['swim'] })],
  // The own-faith clause states TWO shifts in one sentence — "if you roll a failure, you get a
  // success instead, and if you roll a success, you get a critical success instead" — and only the
  // second was authored, so the stronger half was invisible. Not `oneBetter` in its place: that
  // would repeat the crit-fail rung entry #0 already prints for this same skill and action, giving
  // the player two overlapping markers on one row.
  'feats/student-of-the-canon': [
    e(CF2F, 'on a check to Recall Knowledge about the tenets of faiths, or on a Religion check to Decipher Writing of a religious nature', { sk: ['religion'], act: ['recall-knowledge', 'decipher-writing'] }),
    e(S2C, 'on a check to Recall Knowledge about your own faith', { sk: ['religion'], act: ['recall-knowledge'] }),
    e(F2S, 'on a check to Recall Knowledge about your own faith', { sk: ['religion'], act: ['recall-knowledge'] }),
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
  // The clause sits under the **Armor** affixing, not the Weapon one: "Armor The desolation locket
  // numbs you to further despair, and you gain a +4 item bonus to saving throws against emotion
  // effects. When you critically fail a saving throw against an emotion effect, you get a failure
  // instead." The Weapon affixing grants a hopelessness aura and no shift. `when` is the only place
  // a spellheart's affix state can be said — and the SAME record's +4 star already says it
  // (situationalBonuses.ts: "only while the locket is affixed to your armor").
  'items/desolation-locket-major': [e(CF2F, 'while the locket is affixed to your armor, on a save against an emotion effect', { sv: ALL })],
  'items/inextinguishable': [e(S2C, 'on a save against a death or void effect', { sv: ALL })],
  'items/living-death': [e(BETTER, 'on a save against an effect that would deal void damage to you', { sv: ALL })],
  /* All three grades print one Effect: "Each creature in a 10-foot emanation takes Nd8 void damage
   * (DC N basic FORTITUDE save). You treat the result of your saving throw as one degree of success
   * better than its outcome." You are a creature in your own emanation, so the save it improves is
   * yours — and it is a basic Fortitude save, never Reflex or Will. `sv: ALL` came from filing these
   * beside genuinely trigger-driven items (evil-reflecting-shield, hunters-hagbook) where the roll
   * really can be any track. Our own shipped text has the save type stripped to "( save)" by an
   * import defect, which is why it could not be read from the app: the type is in the Foundry source
   * (`@Check[fortitude|dc:20|basic]`) and in AoN equipment-3742. The `when` now names the item's own
   * activation rather than describing a reactive save-booster the stormshard is not. */
  'items/stormshard': [e(BETTER, 'on your own basic Fortitude save against the stormshard when you Free the Spirits', { sv: ['fortitude'] })],
  'items/stormshard-greater': [e(BETTER, 'on your own basic Fortitude save against the stormshard when you Free the Spirits', { sv: ['fortitude'] })],
  'items/stormshard-major': [e(BETTER, 'on your own basic Fortitude save against the stormshard when you Free the Spirits', { sv: ['fortitude'] })],
  'items/armbands-of-the-gorgon': [e(BETTER, 'on a save against a spell or effect with the incapacitation trait', { sv: ALL })],
  /* The next three were authored as one block off a single template — `'on the triggering save',
   * { sv: ALL }` — and only the first one's SHAPE was ever read against its text. A talisman whose
   * Trigger line names one save TRACK is not a save-general clause, and Q2's `['all']` is only for a
   * rule that applies to saves generally. `targetMatches` reads `'all'` unconditionally, so the two
   * tracks the item can never reach were being promised a rescue it cannot give there. The third is
   * not a save talisman at all. */
  // "Trigger You attempt a WILL save against a fear effect but haven't rolled yet" → "On the
  // triggering save…". One track, and both rungs land on it.
  'items/iron-medallion': [
    e(F2S, 'on the triggering Will save against a fear effect', { sv: ['will'] }),
    e(CF2F, 'on the triggering Will save against a fear effect', { sv: ['will'] }),
  ],
  // "Trigger You attempt a WILL save against a mental spell" — and its Requirement is master
  // proficiency in Will saves, so the talisman cannot even be activated off another track.
  'items/star-of-cynosure': [
    e(F2S, 'on the triggering Will save against a mental spell', { sv: ['will'] }),
    e(CF2F, 'on the triggering Will save against a mental spell', { sv: ['will'] }),
  ],
  // NO SAVE AT ALL, and no Trigger either: "Activate ⟨1⟩ … attempt a Deception check to Feint. If the
  // outcome is a success, you get a critical success instead. If the outcome is a critical failure,
  // you get a failure instead." Authored by adjacency to the two above, it starred all three save
  // rows for a rule that touches none of them and left the two surfaces it does touch bare.
  'items/mesmerizing-opal': [
    e(S2C, 'on the Deception check to Feint the opal is activated for', { sk: ['deception'], act: ['feint'] }),
    e(CF2F, 'on the Deception check to Feint the opal is activated for', { sk: ['deception'], act: ['feint'] }),
  ],
  'items/evil-reflecting-shield': [e(BETTER, 'on the saving throw this shield is activated for', { sv: ALL })],
  // The trigger is restricted twice and both restrictions were dropped: "When you attempt a saving
  // throw AGAINST A COVEN SPELL, you can immediately END THE DURATION OF A SPELL AFFECTING YOU THAT
  // YOU PREPARED FROM THIS BOOK. IF YOU DO, the result of your saving throw is one degree of success
  // better." "the saving throw you use the hagbook for" asserts a free choice of any save the player
  // likes; the shift is unusable unless a self-prepared spell is currently on you. `saves: ALL` is
  // right — a coven spell can call for any track. The same record's own situational entry already
  // reads "vs a coven spell, if you end a spell you prepared from this book", so the two halves of
  // one rule sat on the same save row disagreeing.
  'items/hunters-hagbook': [e(BETTER, 'on a save against a coven spell, if you end a spell you prepared from this book that is affecting you', { sv: ALL })],
  'items/tradecraft-tattoo': [e(CF2F, 'on a Crafting check to Earn Income', { sk: ['crafting'], act: ['earn-income'] })],
  'items/tradecraft-tattoo-greater': [e(CF2F, 'on a Crafting check to Earn Income', { sk: ['crafting'], act: ['earn-income'] })],
  'items/thurible-of-revelation': [e(CF2F, 'while holding the thurible, when you Decipher Writing of a religious nature', { sk: ['religion'], act: ['decipher-writing'] })],
  'items/thurible-of-revelation-lesser': [e(CF2F, 'while holding the thurible, when you Decipher Writing of a religious nature', { sk: ['religion'], act: ['decipher-writing'] })],
  'items/thurible-of-revelation-moderate': [e(CF2F, 'while holding the thurible, when you Decipher Writing of a religious nature', { sk: ['religion'], act: ['decipher-writing'] })],
  'items/thurible-of-revelation-greater': [e(CF2F, 'while holding the thurible, when you Decipher Writing of a religious nature', { sk: ['religion'], act: ['decipher-writing'] })],
  'items/creative-spark': [e(CF2F, 'once per day, on a Crafting check related to blacksmithing', { sk: ['crafting'], act: ['craft'] })],
  'items/elements-of-creation': [e(BETTER, 'on a Crafting check related to blacksmithing, while all four creative-spark wisps assist you', { sk: ['crafting'], act: ['craft'] })],
  // "Trigger You attempt a Diplomacy check to MAKE AN IMPRESSION." The action is named in the
  // trigger, so Q2's action half is not optional here — and the skill-only entry left the Make an
  // Impression row bare while every activated neighbour (skinstitch → Treat Wounds, tradecraft-tattoo
  // → Earn Income, cloak-of-repute-greater → Request) marks its own.
  'items/matchmaker-fulu': [e(CF2F, 'on the Diplomacy check to Make an Impression the fulu is activated for', { sk: ['diplomacy'], act: ['make-an-impression'] })],
  // "Trigger You Treat Wounds OR USE BATTLE MEDICINE." Battle Medicine is a curated activity on every
  // sheet (src/rules/actions.ts) with the reachable slug `battle-medicine`, so the second named
  // activity had a row and no mark. The salve's own +2 entry already names both.
  'items/skinstitch-salve': [e(S2C, 'on the Medicine check the salve is applied for', { sk: ['medicine'], act: ['treat-wounds', 'battle-medicine'] })],
  // A SAVE, not a skill. The activation's Trigger is "You fail or critically fail a Fortitude saving
  // throw" and its Effect is "If you failed the saving throw, it becomes a success. If you critically
  // failed, it becomes a failure instead." The word Athletics appears nowhere in the item — that star
  // promised the wearer a benefit on a row the armor never touches while leaving Fortitude, the only
  // roll it does touch, bare. The failure → success half was missing as well.
  'items/breastplate-of-the-mountain': [
    e(F2S, 'on the Fortitude save that triggered this armor’s activation', { sv: ['fortitude'] }),
    e(CF2F, 'on the Fortitude save that triggered this armor’s activation', { sv: ['fortitude'] }),
  ],
  'items/lawbringers-lasso': [e(CF2F, 'on an attempt to Grapple a chaotic creature with the lasso', { sk: ['athletics'], act: ['grapple'] })],
  'items/cryolite-eye': [e(S2C, 'on a Perception check against an illusion', { p: true })],
  // The tome's skill set is CLOSED, and its action is named in the same sentence as the shift:
  // "Choose one skill: Arcana, Crafting, Medicine, Nature, Occultism, Religion, Society, or a single
  // subcategory of Lore… just before attempting a check to RECALL KNOWLEDGE with the chosen skill…
  // if you roll a critical failure, you get a failure instead." `sk: ALL` starred Athletics, Stealth,
  // Thievery and six more the player is not allowed to choose. `lore` stays a wildcard because the
  // subject is the player's to pick (the shape `unmistakable-lore` and `the-vision` use).
  'items/possibility-tome': [
    e(CF2F, 'on the Recall Knowledge check the tome is consulted for, with the skill you chose when you Skimmed it', {
      sk: ['arcana', 'crafting', 'medicine', 'nature', 'occultism', 'religion', 'society', 'lore'],
      act: ['recall-knowledge'],
    }),
  ],
  'items/sash-of-books': [e(CF2F, 'on the Recall Knowledge check the sash is used for', { sk: ALL, act: ['recall-knowledge'] })],
  // The whole effect lives inside an activation with a frequency: "Activate ⟨free⟩ envision;
  // Frequency once per day; Effect … Attempt to Recall Knowledge … If you're already master (or
  // legendary) in that Lore, the result of YOUR Recall Knowledge check is one degree of success
  // better." Without the gate the star reads as a standing property of every Lore Recall Knowledge
  // check while the artifact is invested — `degreeShiftRecords` pushes an item on worn/invested with
  // no activation or frequency test, so the note is the only surface that can carry it.
  'items/the-vision': [e(BETTER, 'once per day, on the Recall Knowledge check you activate The Vision for, if you are already master or legendary in that Lore', { sk: ['lore'], act: ['recall-knowledge'] })],
  // "you attempt to RECALL KNOWLEDGE about the creature you hit. If you roll a critical failure, you
  // get a failure instead." `sk: ALL` is right — the Requirements line lets any of six knowledge
  // skills be the one you roll — but the named action was marked nowhere and the note never told the
  // player which check "the check the eye is activated for" was. sash-of-books, the same shape two
  // lines up, had it right all along.
  'items/eye-of-enlightenment': [e(CF2F, 'on the Recall Knowledge check the eye is activated for', { sk: ALL, act: ['recall-knowledge'] })],
  'items/enveloping-light-greater': [e(CF2F, 'on any check to Treat your Wounds', { sk: ['medicine'], act: ['treat-wounds'] })],
  'items/enveloping-light': [e(CF2F, 'the first time each day someone Treats your Wounds', { sk: ['medicine'], act: ['treat-wounds'] })],
  'items/headbands-of-translocation': [e(CF2F, 'while both headbands are invested, when you Aid an ally wearing the paired headband', { act: ['aid'] })],
  // A CLOSED two: "Your relic enhances your skill with Crafting or Performance. (Choose one.) If you
  // succeed at a check with the chosen skill, you get a critical success instead." `sk: ALL` starred
  // fourteen skills the relic can never reach — and the record's OWN `choice` block already offers
  // exactly ['crafting','performance'], so its two authored fields contradicted each other. Narrowing
  // further to the one skill picked is not possible today (no item-choice reader exists); `when`
  // carries that last step in prose, now printed only on the two rows the relic can reach.
  'items/artistic-perfection': [e(S2C, 'on a check with the skill you chose, Crafting or Performance', { sk: ['crafting', 'performance'] })],
  'items/topology-protoplasm': [e(BETTER, 'on a check to Squeeze while in the protoplasm', { sk: ['acrobatics'], act: ['squeeze'] })],
  'items/words-of-wisdom': [e(CF2F, 'during the activation, on a Diplomacy check or the associated skill', { sk: ['diplomacy', 'intimidation', 'deception', 'performance'] })],
  'items/inubrix-shield': [e(CF2F, 'on a check to Disarm a metal item, if you drop the weapon', { sk: ['athletics'], act: ['disarm'] })],
  'items/inubrix-shield-standard-grade': [e(CF2F, 'on a check to Disarm a metal item, if you drop the weapon', { sk: ['athletics'], act: ['disarm'] })],
  'items/inubrix-shield-high-grade': [e(CF2F, 'on a check to Disarm a metal item, if you drop the weapon', { sk: ['athletics'], act: ['disarm'] })],
  'items/inubrix-buckler-standard-grade': [e(CF2F, 'on a check to Disarm a metal item, if you drop the weapon', { sk: ['athletics'], act: ['disarm'] })],
  'items/inubrix-buckler-high-grade': [e(CF2F, 'on a check to Disarm a metal item, if you drop the weapon', { sk: ['athletics'], act: ['disarm'] })],
  /* ⚠ The next three sat together and shared one another's mistakes. "the triggering …" is only
   * legitimate on savior-spike, the one of the three that actually prints a Trigger line; the other
   * two are plain `Activate ⟨1⟩` talismans, so the word named something they do not have. */
  // "When you activate this talisman, USE A CLIMB ACTION with a +1 item bonus on the check. ON THIS
  // CHECK AND UNTIL THE END OF YOUR TURN, if you succeed on an Athletics check to Climb… If you roll
  // a critical failure, you get a failure instead." The fronted duration governs the whole effect
  // block (the legacy printing had no duration at all — the remaster added it), and the Climb action
  // is named three times yet was marked nowhere. All twelve other Climb shifts in this table carry
  // `act: ['climb']`.
  'items/monkey-pin': [e(CF2F, 'on Athletics checks to Climb, from activating the pin until the end of your turn', { sk: ['athletics'], act: ['climb'] })],
  // "Trigger You attempt to GRAB AN EDGE but haven't rolled." Grab an Edge is "your choice of an
  // Acrobatics check or a Reflex save" — Athletics appears in that action only in the NEXT sentence,
  // about Climbing up once you have already caught the edge, which this item does not touch. The
  // spike's own +1 entry has targeted acrobatics + reflex all along, so the two halves of one
  // activation named different statistics.
  'items/savior-spike': [
    e(S2C, 'on the triggering attempt to Grab an Edge', { sk: ['acrobatics'], sv: ['reflex'], act: ['grab-an-edge'] }),
    e(CF2F, 'on the triggering attempt to Grab an Edge', { sk: ['acrobatics'], sv: ['reflex'], act: ['grab-an-edge'] }),
  ],
  // "When you activate the bracelet, attempt to ESCAPE using ACROBATICS with a +1 item bonus to the
  // check…" The words "Swim" and "Athletics" appear nowhere in the item, in either printing. Its own
  // +1 entry says Acrobatics/Escape; the degree shift said Athletics/Swim, so one printed sentence
  // starred two disjoint pairs of rows. Acrobatics alone rather than the generic Escape pair, because
  // the text pins the skill.
  'items/shark-tooth-charm': [
    e(S2C, 'on the Acrobatics check to Escape made when you activate the charm', { sk: ['acrobatics'], act: ['escape'] }),
    e(CF2F, 'on the Acrobatics check to Escape made when you activate the charm', { sk: ['acrobatics'], act: ['escape'] }),
  ],
  // The "if you have a different ability that would improve the save in this way" clause is a second
  // entry, the same treatment its five siblings get (affliction-resistance, parthenogenic-hatchling,
  // necromantic-physiology, cantorian-reinforcement, sewer-rat) — see the note above those. This was
  // the one record printing the boilerplate that shipped with only the first half.
  'feats/well-groomed': [
    e(S2C, 'on a save against a disease', { sv: ALL }),
    e(CF2F, 'on a save against a disease, if another ability already turns such a success into a critical success', { sv: ALL }),
  ],
  'items/the-sickness': [e(S2C, 'on a save against a disease', { sv: ALL })],
  'items/grub-gloves': [e(S2C, 'on a Reflex save to Grab an Edge', { sv: ['reflex'], act: ['grab-an-edge'] })],
  'items/grub-gloves-lesser': [e(S2C, 'on a Reflex save to Grab an Edge', { sv: ['reflex'], act: ['grab-an-edge'] })],
  'items/grub-gloves-moderate': [e(S2C, 'on a Reflex save to Grab an Edge', { sv: ['reflex'], act: ['grab-an-edge'] })],
  'items/grub-gloves-greater': [e(S2C, 'on a Reflex save to Grab an Edge', { sv: ['reflex'], act: ['grab-an-edge'] })],
  // The bonus is Will-only and the shift is not: "you gain a +3 item bonus to Will saves, or +4 when
  // attempting Will saves against fear. If you roll a success on A SAVE against fear, you get a
  // critical success instead." The word Will governs the numbers, not the shift, and a fear effect
  // can call for another track (Bogeyman Breath is a fear effect with a Fortitude save). Q2's
  // `['all']` is for exactly this — an unqualified clause. The `when` also said "Will", a word none
  // of the three printed sources uses for this sentence.
  'items/bravos-brew-greater': [e(S2C, 'on a save against fear while the brew lasts', { sv: ALL })],
  'items/juggernaut-mutagen-greater': [e(S2C, 'on a Fortitude save while the mutagen lasts', { sv: ['fortitude'] })],
  'heritages/wajaghand-vanara': [e(S2C, 'on a save against an emotion effect', { sv: ALL })],
  'items/hydra-mutagen': [e(BETTER, 'once per mutagen, when you fail or critically fail a Will save against a mental effect', { sv: ['will'] })],
  'items/lovers-gloves': [e(S2C, 'while a shared Bond lasts, on a save against an emotion effect that causes negative emotions', { sv: ALL })],
  'heritages/born-of-item': [e(S2C, 'in yaoguai form, on a save against a mental effect', { sv: ALL })],
  'feats/numb': [e(S2C, 'while Deteriorated, on a save against an emotion or pain effect', { sv: ALL })],
  'feats/gorilla-stance': [e(S2C, 'on an Athletics check to Climb while in Gorilla Stance', { sk: ['athletics'], act: ['climb'] })],
  'feats/staff-acrobat-dedication': [e(S2C, 'on an Acrobatics check to Balance while wielding your staff', { sk: ['acrobatics'], act: ['balance'] })],
  // The third record of the Dragon's Presence shape, missed by the count of nine: "If you succeed at
  // a save against a mental effect, you critically succeed instead; SIMILARLY, IF YOU FAIL at a save
  // against a mental effect, YOU CRITICALLY FAIL INSTEAD." One sentence, both directions. The
  // downgrade half sat in situationalBonuses.ts prose under a comment saying `shift` had no value for
  // it — true when written, false since `failToCritFail` landed the same day.
  'feats/conceited-mindset': [
    e(S2C, 'on a save against a mental effect', { sv: ALL }),
    e(F2CF, 'on a save against a mental effect', { sv: ALL }),
  ],

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
 * WITHDRAWN — records this table used to author and must now UNSAY.
 *
 * Deleting a key from AUTHORED is not enough. The script only ever writes; the value it wrote last
 * time is still sitting in `public/core.json` and in the overlay row that survives `npm run data`, so
 * a silent removal leaves the defect shipped and makes the table lie about what the app carries.
 * Every id here has its field deleted from both, and the run prints what it removed.
 *
 * Both entries below are the same defect: a shift printed under a LATER doctrine section, authored
 * onto the level-1 subclass record that names the doctrine. `ownedFeatureIds` (derive.ts) adds a
 * chosen subclass id with no level check, and `DegreeShift` has no level field, so the entry could
 * not be gated even in principle — a 1st-level battle harbinger read a 13th-level benefit on their
 * Fortitude row, and at 13 read it twice, once from each record. The level-gated child sections
 * (`classFeatures/major-creed`, `classFeatures/fifth-doctrine-warpriest`) already carry the rule at
 * the level it starts, so nothing is lost.
 * ---------------------------------------------------------------------------------------------- */
const WITHDRAWN = [
  ['classFeatures/battle-creed', 'the clause is printed under "Major Creed (13th)"; classFeatures/major-creed carries it'],
  ['classFeatures/warpriest', 'the clause is printed under "Fifth Doctrine (15th)"; classFeatures/fifth-doctrine-warpriest carries it'],
  /* The same defect as the two above, in the ITEM bucket: a clause printed under a LATER GRADE,
   * authored onto the unpriced family head that concatenates every grade's paragraph. `DegreeShift`
   * has no grade or level field, so the head could not be gated even in principle — and Ruling A
   * (docs/mechanic-lanes.md) is that umbrella/summary records get no entries at all. Both heads are
   * hidden by `findUmbrellaIds` today (unpriced, no `UMBRELLA_MECHANICAL_FIELDS`, 3 and 4 kin), which
   * made the rows look done while doing nothing — but `degreeShifts` is one field away from that
   * list, and the day it joins, an unpriced LEVEL-1 elixir starts granting a level-11 benefit. */
  ['items/bravos-brew', 'the head\'s own paragraph has no shift; "If you roll a success" is printed only under Bravo\'s Brew (Greater), which carries it'],
  ['items/juggernaut-mutagen', 'the head\'s own Benefit is a Fortitude bonus and temporary HP; the shift is printed only under (Greater) and (Major), which carry it'],
  /* Not a scope error — a TARGET error the field cannot fix. "Make an ATTACK ROLL as you would when
   * using a grappling hook, but if you roll a critical failure on the check to secure the vine, you
   * get a failure instead." A grappling hook is "a ranged attack roll using your simple weapon
   * proficiency", so there is no skill check to secure the vine at all. The authored `athletics`
   * came from the item's OTHER sentence — "Once the vine is anchored, creatures receive a +1 status
   * bonus to Athletics checks to Climb the vine" — a different clause, a different moment, and one
   * already carried in situationalBonuses.ts. `DegreeShift` has skills/saves/actions/perception and
   * no attack-roll target, so the honest answer is to say nothing rather than borrow a row: see
   * NO_SHEET_ROW below, and the same reason `savage-critical` and `keen-flair` stay out. */
  ['items/grappling-vine', 'the shift is on an attack roll, not an Athletics check; the borrowed star came from the item\'s separate Climb clause'],
];

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
  'items/grappling-vine — the roll is an ATTACK roll ("as you would when using a grappling hook"), and DegreeShift has no attack-roll target; it was authored `athletics` from the item\'s separate Climb clause',
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

const unsay = WITHDRAWN.map(([key, why]) => {
  const i = key.indexOf('/');
  return { key, why, category: key.slice(0, i), id: key.slice(i + 1) };
});
for (const u of unsay) {
  if (AUTHORED[u.key]) throw new Error(`${u.key} is both AUTHORED and WITHDRAWN — one of the two is a mistake`);
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
if (unsay.length) {
  console.log(`\nwithdrawn — authored once, now deleted from core.json AND the overlay (${unsay.length}):`);
  for (const u of unsay) console.log(`   ${u.key} — ${u.why}`);
}

if (DRY) { console.log('\n--dry: nothing written'); process.exit(0); }

for (const w of writes) core[w.category][w.id].degreeShifts = w.value;
for (const u of unsay) delete core[u.category]?.[u.id]?.degreeShifts;
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
// A WITHDRAWN row has to leave the overlay too, or `npm run data` puts the withdrawn value straight
// back onto the record and the deletion above lasts exactly until the next regeneration.
let removed = 0;
for (const u of unsay) {
  for (let i = overlay.length - 1; i >= 0; i--) {
    const x = overlay[i];
    if (x.category === u.category && x.id === u.id && x.field === 'degreeShifts' && !x.path) { overlay.splice(i, 1); removed++; }
  }
}
writeBackfill(ROOT, overlay);
console.log(`\noverlay: ${added} added, ${updated} refreshed, ${removed} withdrawn (now ${overlay.length} rows)`);
console.log('written: public/core.json, scripts/data/effect-backfill.json');
