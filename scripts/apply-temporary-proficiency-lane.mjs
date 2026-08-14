/*
 * The TEMPORARY-PROFICIENCY lane — "During your daily preparations … until you prepare again".
 *
 * Ruling Q23: a pick re-made every morning is asked at DAILY PREPARATIONS, never in the builder, and
 * defaults to yesterday's answer. Seven records print exactly that sentence and none of them reached
 * the flow built for it. Printed text, from the AoN mirror
 * (C:/wonderers guide/aon-2e-archive/data/by-category/feat) — every clause below is asserted against
 * the live description before anything is written, so this file cannot drift from the book:
 *
 *   Ageless Spirit (feat-2393)        "During your daily preparations, you can meditate upon
 *                                      fragmentary memories of your past lives to gain the trained
 *                                      proficiency rank in one skill of your choice."
 *   Ancestral Longevity (feat-4405)   "…reflect upon your life experiences to gain the trained
 *                                      proficiency rank in one skill of your choice."
 *   Ancient Memories (feat-3944)      "…explore your memories of your past lives to become trained
 *                                      in one skill of your choice."
 *   Ancestral Linguistics (feat-1407) "…recede into old memories to become fluent in one common
 *                                      language or one other language you have access to."
 *   Endless Memories (feat, level 9)  "When you choose a skill in which to become trained with
 *                                      Ancient Memories, you can also choose a skill in which you're
 *                                      already trained and become an expert in that skill."
 *   Expert Longevity (feat-4416)      the elf twin of Endless Memories, against Ancestral Longevity.
 *   Twilight Talon Dedication         "…brush up on a specific field to gain the trained proficiency
 *                                      rank in one Lore skill of your choice."
 *
 * WHAT WAS WRONG, measured rather than assumed:
 *   · THREE carried no `choice` at all, so the morning asked nothing.
 *   · Ancient Memories carried `kind: 'skills'`, which `askedAtDailyPrep` (src/rules/derive.ts) cannot
 *     render at the Rest sheet — so it fell back to the BUILDER, where 'skills' resolves through
 *     `trainedSkillOptions` (build.ts:1159), i.e. the skills you are ALREADY trained in. Every option
 *     it offered was a wasted grant and the only useful answers — untrained skills — were unpickable.
 *   · Ancient Memories and Endless Memories ALSO carried a permanent `FEAT_SKILL_GRANTS` entry, whose
 *     unanswered slot defaults to its first option (build.ts:1194). Measured: a wizard who answered
 *     nothing was silently trained in Acrobatics; a ghoran wizard 9 with Endless Memories was silently
 *     EXPERT in it. That is the store `checkPrerequisites` reads (build.ts), so the feats' own "you
 *     can't use it as a prerequisite for a skill increase or a permanent character option" was being
 *     violated by the app itself. Both entries are deleted in src/rules/featGrantsAuto.ts.
 *   · Endless Memories' 16 options carried NO grant, so the morning's answer moved nothing.
 *
 * WHY THE GRANT MUST NOT BE A BUILD GRANT. A daily answer lives in `PlayState.dailyChoices` and is
 * merged in by `deriveSkill` alone (via `dailySkillRank`), while `checkPrerequisites` reads the BUILT
 * character. Keeping the grant out of the build IS the enforcement — no extra machinery.
 *
 * THE SHAPE IS NOT INVENTED. It is copied from `haunting-memories`, which already works end to end:
 * per-option `requiresSkillRank` gate + `grant.skills`, resolved by `dailyChoiceGrants` (derive.ts)
 * and read by `deriveSkill` via `dailySkillRank`.
 *
 * FILTERED, NOT GREYED — and that is a ruling, not a shortcut. Q27 puts "already owned" in the
 * shown-and-greyed row, but Q21/Principle Q reserves REMOVAL for a grant "wasted across the whole
 * career", which is exactly what a trained-rank grant on a skill you are already trained in is: there
 * is no Canny-Acumen level that ever makes it worthwhile. `FeatChoiceDef.disableIfOwned`'s own doc
 * comment in src/rules/types.ts spells that split out, and the morning row is a chip strip that
 * already drops inert options (dailyChoices.ts).
 *
 * Lore skills are not enumerable as options — the same limit `haunting-memories` carries — and each
 * note says so rather than pretending otherwise.
 *
 * Run: node scripts/apply-temporary-proficiency-lane.mjs [--dry]
 * Writes public/core.json (so the app sees it now) AND scripts/data/effect-backfill.json (the only
 * overlay that survives `npm run data` — `feats` is not in import-core-v2's CARRY_WHOLESALE list).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = process.cwd();
const p = (f) => join(ROOT, f);
const DRY = process.argv.includes('--dry');

const SKILLS = [
  'acrobatics', 'arcana', 'athletics', 'crafting', 'deception', 'diplomacy', 'intimidation',
  'medicine', 'nature', 'occultism', 'performance', 'religion', 'society', 'stealth', 'survival',
  'thievery',
];
const cap = (s) => s[0].toUpperCase() + s.slice(1);

/** "Become trained in a skill of your choice, until you prepare again." */
const trainedMenu = () =>
  SKILLS.map((s) => ({
    value: s,
    label: cap(s),
    description: 'You are untrained in it today.',
    // Q21 — an option is removed only where the grant is WASTED for the whole career, and a
    // trained-rank grant on a skill you are already trained in is exactly that.
    requiresSkillRank: { skill: s, max: 'untrained' },
    grant: { skills: { [s]: 'trained' } },
  }));

/** "…you can ALSO choose a skill in which you're already trained and become an expert in that skill." */
const expertMenu = () =>
  SKILLS.map((s) => ({
    value: s,
    label: cap(s),
    description: 'You are trained in it today.',
    // The inverse gate of the trained menu, and both halves do work: an expert-rank grant on a skill
    // you are NOT yet trained in is not what the sentence offers, and one you are already expert in
    // is wasted for the whole career (Q21).
    requiresSkillRank: { skill: s, min: 'trained', max: 'trained' },
    grant: { skills: { [s]: 'expert' } },
  }));

const TEMP_NOTE =
  'This proficiency lasts until you prepare again. Since it is temporary, you can\u2019t use it as a ' +
  'prerequisite for a skill increase or a permanent character option like a feat. Lore skills are not listed here.';

const EXPERT_NOTE = (parent) =>
  `Expert in this skill until your ${parent} expires. Since it is temporary, you can\u2019t use it as a ` +
  'prerequisite for a skill increase or a permanent character option like a feat. Lore skills are not listed here.';

/*
 * Each entry names the clause it was written from. `assert` is a regex over the LIVE description: if
 * the text ever stops saying this, the script refuses rather than authoring a mechanic the book does
 * not print.
 */
const WRITES = [
  {
    id: 'ageless-spirit',
    assert: /gain the trained proficiency rank in one skill of your choice/i,
    value: { flag: 'agelessSpiritSkill', prompt: 'Skill remembered from a past incarnation', kind: 'array', daily: true, options: trainedMenu(), note: TEMP_NOTE },
  },
  {
    id: 'ancestral-longevity',
    assert: /gain the trained proficiency rank in one skill of your choice/i,
    value: { flag: 'ancestralLongevitySkill', prompt: 'Skill recalled from your long life', kind: 'array', daily: true, options: trainedMenu(), note: TEMP_NOTE },
  },
  {
    // The flag is UNCHANGED and so are the option values (bare skill keys). `flag` is half of
    // `dailyChoiceKey`, so renaming it would strand any answer already stored under
    // `ancient-memories:ancientMemoriesSkill`, and a bare skill key is what the old builder picker
    // stored too — so a legacy answer round-trips instead of reading as stale.
    id: 'ancient-memories',
    assert: /become trained in one skill of your choice/i,
    value: { flag: 'ancientMemoriesSkill', prompt: 'Skill remembered from a past life', kind: 'array', daily: true, options: trainedMenu(), note: TEMP_NOTE },
  },
  {
    id: 'ancestral-linguistics',
    assert: /become fluent in one common language or one other language you have access to/i,
    value: {
      flag: 'ancestralLanguage',
      prompt: 'Language recalled from old memories',
      kind: 'open',
      daily: true,
      // The WHOLE list, uncommon and rare included. "one common language or one other language you
      // have ACCESS TO" is an access clause, and ruling Q5 settles that an access clause gates
      // nothing in the app. `grantLanguage` is the opt-in that turns the morning's answer into a real
      // language rather than a recorded note — the same shape as Loaner Spell's `grantInnate`, and
      // opt-in so Settlement Scholastics' non-granting language picker cannot start granting.
      from: { type: 'language', grantLanguage: true },
      note:
        'You know this language until you prepare again. Since this knowledge is temporary, you can\u2019t ' +
        'use it as a prerequisite for a permanent character option. Languages you already speak are not listed.',
    },
  },
  {
    // Values and flag unchanged for the same round-trip reason; what was missing is the `grant`.
    id: 'endless-memories',
    assert: /choose a skill in which you're already trained and become an expert in that skill/i,
    value: {
      flag: 'endlessMemoriesSkill',
      prompt: 'Endless Memories — a skill you\u2019re already trained in becomes expert',
      kind: 'array',
      daily: true,
      options: expertMenu(),
      note: EXPERT_NOTE('Ancient Memories'),
    },
  },
  {
    // The elf twin of Endless Memories. It was a BUILD-time `kind: 'skills'` picker for an effect its
    // own sentence ends with "This lasts until your Ancestral Longevity expires" — a daily pick asked
    // on the wrong screen (Q23). `scripts/apply-choice-lane.mjs` still lists it, but that script
    // skips any record that "ALREADY HAS a different choice", so this write survives its re-run.
    id: 'expert-longevity',
    assert: /choose a skill in which you are already trained and become an expert in that skill/i,
    value: {
      flag: 'longevitySkill',
      prompt: 'Expert Longevity — a skill you\u2019re already trained in becomes expert',
      kind: 'array',
      daily: true,
      options: expertMenu(),
      note: EXPERT_NOTE('Ancestral Longevity'),
    },
  },
  {
    /*
     * A LORE skill, so the menu cannot be enumerated: Lore subjects are open-ended and the character
     * may hold any of them. `kind: 'text'` is the shipped shape for exactly that — Quick Study's
     * "Today's Lore subject" — and Principle I says free-text input is a legitimate choice type.
     *
     * ⚠ RECORDED, NOT GRANTED, and the note says so. A rank cannot be granted from a typed subject
     * without new machinery: `dailyChoiceGrants` reads `options[].grant`, which a text choice has
     * none of, and MainTab's Lore rows come from `character.proficiencies.skills` alone
     * (MainTab.tsx:182), so a daily-only `lore:<typed>` key would have no row to appear on. Inventing
     * a key from free text would also mint a new skill row on every typo. The question at least now
     * gets asked on the right screen, which is what Q23 requires.
     */
    id: 'twilight-talon-dedication',
    assert: /gain the trained proficiency rank in one Lore skill of your choice/i,
    value: {
      flag: 'twilightTalonLore',
      prompt: 'Lore field you brushed up on today',
      kind: 'text',
      daily: true,
      note:
        'Trained in this Lore until you prepare again \u2014 expert instead if you are a master in Espionage Lore, ' +
        'master if you are legendary. Recorded here rather than added to your skill list, because a Lore subject you ' +
        'type has no permanent row. Temporary, so it can\u2019t be a prerequisite for a skill increase or a feat.',
    },
  },
];

/* ------------------------------------------------------------------ verify against the book */
const core = JSON.parse(readFileSync(p('public/core.json'), 'utf8'));
const descFile = JSON.parse(readFileSync(p('public/core-descriptions.json'), 'utf8'));
const plain = (s) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const fail = (m) => {
  console.error('REFUSED: ' + m);
  process.exit(1);
};

for (const w of WRITES) {
  if (!core.feats?.[w.id]) fail(`${w.id} is not in core.json`);
  // Descriptions live in the SECOND file; core.json's copy may be absent.
  const text = plain(descFile.feats?.[w.id]?.d ?? core.feats[w.id].description);
  if (!text) fail(`${w.id} has no description to check the clause against`);
  if (!w.assert.test(text)) fail(`${w.id}: the printed text no longer says ${w.assert}`);
}
for (const w of WRITES) {
  if (w.value.kind !== 'array') continue;
  if ((w.value.options ?? []).length !== SKILLS.length) fail(`${w.id}: option count is wrong`);
  if (!w.value.options.every((o) => o.grant?.skills)) fail(`${w.id}: an option carries no grant`);
}

if (DRY) {
  console.log(WRITES.map((w) => `${w.id}: kind ${w.value.kind}, daily, ${(w.value.options ?? []).length} options`).join('\n'));
  process.exit(0);
}

/* ------------------------------------------------------------------ write */
for (const w of WRITES) core.feats[w.id].choice = w.value;
writeFileSync(p('public/core.json'), JSON.stringify(core)); // MINIFIED on purpose

// The overlay is the ONLY thing that carries an authored field through `npm run data`. Written
// through write-backfill.mjs (1-space indent, CRLF, no trailing newline) — a hand-rolled stringify
// reformats every row into an unreviewable diff. Rows are replaced in place on (category, id, field),
// so re-running is idempotent and the pre-existing rows are refreshed rather than duplicated.
const overlay = readBackfill(ROOT);
let added = 0;
let updated = 0;
for (const w of WRITES) {
  const at = overlay.findIndex((x) => x.category === 'feats' && x.id === w.id && x.field === 'choice' && !x.path);
  if (at >= 0) {
    overlay[at] = { category: 'feats', id: w.id, field: 'choice', value: w.value };
    updated++;
  } else {
    overlay.push({ category: 'feats', id: w.id, field: 'choice', value: w.value });
    added++;
  }
}
writeBackfill(ROOT, overlay);
console.log(`overlay: ${added} added, ${updated} refreshed (now ${overlay.length} rows)`);
console.log('written: public/core.json, scripts/data/effect-backfill.json');
