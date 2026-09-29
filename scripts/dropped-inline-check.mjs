/*
 * GUARD: NO SHIPPED RECORD MAY BE MISSING AN INLINE VALUE THE ARCHIVES PRINT.
 *
 * The `@Damage[…]` / `@Template[…]` / `@Check[…]` cleaner upstream of our AoN export drops what it
 * cannot parse and leaves the sentence intact, so "takes 1d4 mental damage" ships as "takes damage" —
 * a rule with no number, which reads as intentional. 1,206 records were affected before the sweep.
 *
 * This fails when `scripts/repair-dropped-inline.mjs` would have a CONFIDENT repair to make, i.e. the
 * Archives state a value in the aligned sentence and we do not. It deliberately says nothing about the
 * sites the repairer refuses — those are visible in that script's report and need a human, and holding
 * the build hostage to them would only teach everyone to skip the guard.
 *
 * Skips cleanly when the AoN mirror is not present, so it does not fail on a machine without it.
 *
 * ⚠ IT RUNS BEHIND A PHRASE PREFILTER, which is exactly as complete as whoever wrote the phrase list.
 * `DROPPED_INLINE_ALL=1` drops the RECORD filter and aligns every record instead — but the per-
 * SENTENCE hole test in the lib still applies the same HOLES list, so the env var does NOT prove the
 * list sufficient: heal/harm's terminal-shape hole ("in a . This targets") passed a full sweep
 * untouched until batch 24 added its HOLES row. The full sweep raises coverage; it is not a proof.
 * Re-run it after any AoN update, not just this guard.
 *
 *   node scripts/dropped-inline-check.mjs
 *   DROPPED_INLINE_ALL=1 node scripts/repair-dropped-inline.mjs   # the periodic re-measure
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findDroppedInline, MIRROR } from './lib/dropped-inline.mjs';
import { findStrippedSaveDc } from './repair-stripped-save-dc.mjs';
import { findDroppedDamageType } from './repair-damage-type.mjs';
import { findStrippedFlatDc } from './repair-flat-check-dc.mjs';
import { hasArtefact } from './repair-stripped-skill-links.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/*
 * THE STRIPPED-LINK HOLE — a second class of deleted value the mirror comparison above cannot see.
 *
 * The de-linkifier that builds the `d` fallback prose eats the numeric span beside a stripped auto-link,
 * so a sentence ends in "a ." — *"make its area a instead of a ."* (Directed Channel), *"attempt a ."*
 * (Hardshell Surki), *"in a instead of a ."* (Nyktera). The AST carrier renders correctly, so the app
 * usually hides it, but the fallback is what the search index, the tooltips and any AST-less bucket
 * show. Batch 27 repaired four by hand and measured 260 more across the corpus (mostly spells).
 *
 * A RATCHET, not a zero-guard: the baseline is the count on the day the detector was written, and the
 * check fails only when a regeneration or an edit makes it GROW. Lower the baseline as the sweep
 * repairs them (regenerate `d` from the AST); never raise it.
 *
 * ⚠ THE DETECTOR ONLY EVER SAW ONE OF THE FOUR ARTICLES. It was written against the "a ." shape and so
 * counted 162 records while the same strip had left 12 more sitting behind "an .", "the ." and "your ."
 * — *"You gain the ."* for *"You gain the basic spellcasting benefits."* (AoN feat-3230,
 * basic-beast-gunner-spellcasting), *"Choose an ."* for *"Choose an innovation."* (feat-3112), *"match
 * those of your ."* for *"…your draconic benefactor."* (equipment-4016). Batch 032's read found the
 * class by widening the pattern by hand; the guard now carries the wider pattern itself, so the sibling
 * articles cannot go on being invisible to it.
 *
 * HOLE_BASELINE IS UNCHANGED AT 162 DELIBERATELY. Widening the net raises the live count to 174, and
 * batch 032 repairs all 12 of the newly-visible records in the same batch (one row in
 * work/.b032-rows-data-rows.json, eleven in work/.b032-rows-gap-data-rows.json), which puts it back at
 * 162 — every remaining hole is an "a ." one. Until those rows are applied this check FAILS and names
 * them, which is the point: a ratchet that is widened and slackened in the same edit measures nothing.
 *
 * LOWERED 162 -> 116 BY PRINT BATCH P02. Its flat-check repair (scripts/repair-flat-check-dc.mjs) fills
 * 48 terminal "attempt a ." holes with the printed "DC N flat check". 46 of them were "a ." sites this
 * pattern counts; read-fate and the-carnival are "a secret .". Measured 116 on the shipped artefact
 * after --stage apply.
 */
// batch P02: steady-spellcasting-magus
const HOLE_BASELINE = 116;
const HOLE = /\b(?:a|an|the|your) \.(?=\s|$)/;
{
  const descs = JSON.parse(readFileSync(join(ROOT, 'public/core-descriptions.json'), 'utf8'));
  const holes = [];
  /* "New ones:" used to print the first 30 of the WHOLE list, which on a corpus already 162 deep is 30
   * records that were there yesterday. The ones a reader needs are the ones outside the "a ." shape the
   * baseline was measured on, so those go first. */
  const OLD_SHAPE = /\ba \.(?=\s|$)/;
  const widened = [];
  for (const [cat, recs] of Object.entries(descs)) {
    for (const [id, e] of Object.entries(recs ?? {})) {
      if (!e || typeof e.d !== 'string' || !HOLE.test(e.d)) continue;
      holes.push(`${cat}/${id}`);
      if (!OLD_SHAPE.test(e.d)) widened.push(`${cat}/${id}`);
    }
  }
  if (holes.length > HOLE_BASELINE) {
    console.log(`dropped-inline: FAIL — ${holes.length} record(s) end a sentence at a stripped link ("… a .", "… the .", "… an .", "… your .") — more than the ${HOLE_BASELINE} the ratchet allows. Outside the "a ." shape the baseline was measured on (${widened.length}), then the rest:`);
    for (const h of [...widened, ...holes.filter((h) => !widened.includes(h))].slice(0, 30)) console.log(`   ${h}`);
    console.log('\nRepair the fallback `d` from the AST (public/ast/<bucket>.json.gz) via a description overlay row; never raise HOLE_BASELINE.');
    process.exit(1);
  }
  console.log(`dropped-inline: ${holes.length} stripped-link hole(s) in core-descriptions.json (ratchet ${HOLE_BASELINE}; lower it as the sweep repairs them)`);
}

/*
 * THE STRIPPED SAVE DC — a third class, and the one neither check above can see.
 *
 * The same cleaner deletes `@Check[will|dc:25]` and leaves A SENTENCE THAT STILL PARSES:
 * *"Each creature must attempt a DC 25 Will save"* ships as *"Each creature must attempt a save."*
 * (Unmemorable Mantle, equipment-513, batch 29). There is no "a ." for the ratchet above to see, and
 * the alignment below used to walk past it because the lib's sentence splitter did not break before the
 * `---` rule item descriptions use — so the hole sentence swallowed the whole degrees-of-success block
 * and aligned against the wrong AoN sentence (measured: 0.75 against "Critical Success …", 0.31
 * against the real counterpart). The player is left with nothing to roll against. ⚠ The splitter is
 * FIXED (batch 29 follow-up) and the alignment below now sees 66 records more than it did; this class
 * keeps its own ratchet anyway, because it is driven by what the Archives PRINT rather than by a hole
 * shape in our own text.
 *
 * A RATCHET like the one above, over the count `scripts/repair-stripped-save-dc.mjs` would repair
 * CONFIDENTLY; its refusals are deliberately not counted, for the same reason the check below ignores
 * its own. Applying that script's rows drives this to zero — lower the baseline as they land, and
 * never raise it.
 */
const SAVE_DC_BASELINE = 0;
{
  const dc = findStrippedSaveDc(ROOT);
  if (!dc) console.log(`dropped-inline: stripped-save-DC ratchet SKIPPED — no AoN mirror at ${MIRROR}`);
  else if (dc.edits.length > SAVE_DC_BASELINE) {
    console.log(`dropped-inline: FAIL — ${dc.edits.length} record(s) drop a save DC the Archives print — more than the ${SAVE_DC_BASELINE} the ratchet allows:`);
    for (const e of dc.edits.slice(0, 30)) for (const s of e.sites) console.log(`   ${(e.category + '/' + e.id).padEnd(40)} ${s.at.replace(' ▸ ', ` [missing: ${s.run}] `)}`);
    console.log('\nFix with:  node scripts/repair-stripped-save-dc.mjs --write   (the orchestrator applies the rows); never raise SAVE_DC_BASELINE.');
    process.exit(1);
  } else console.log(`dropped-inline: ${dc.edits.length} stripped-save-DC hole(s) (ratchet ${SAVE_DC_BASELINE}; repair-stripped-save-dc.mjs drives it to zero)`);

  /*
   * THE STRIPPED "<N>-foot" AREA — a fifth class, and the sibling of the save DC: the same cleaner,
   * the same survival of a grammatical sentence. Here it takes the SIZE AND THE NOUN IT QUALIFIES —
   * *"a 10-foot burst"* ships as *"a"* — so the rule reads *"…in a centered on you"* and the player
   * cannot tell how big the area is (hairpin-of-blooming-flowers#burst-text, batch 28).
   *
   * The count is the one findStrippedSaveDc measures alongside its own: a record only counts when the
   * mirror's three words before the size occur exactly once in our text and the size is not there —
   * a record-level "the mirror says -foot and we never do" count is four times larger and mostly
   * edition drift.
   *
   * A RATCHET, not a zero-guard: 366 of these are repairable and 25 more belong to
   * scripts/repair-dropped-inline.mjs, but the remainder need a rung-aware pass (AoN gives every rung
   * of an item family one document) or a human. Lower it as rows land; never raise it.
   */
  // ratchet lane 2026-09-29: measured 95 by node scripts/dropped-inline-check.mjs; pinned by test/dropped-inline-ratchets.test.ts
  const FOOT_BASELINE = 95;
  if (dc && dc.footHoles.length > FOOT_BASELINE) {
    console.log(`dropped-inline: FAIL — ${dc.footHoles.length} description(s) drop a "<N>-foot" area the Archives print — more than the ${FOOT_BASELINE} the ratchet allows:`);
    for (const h of dc.footHoles.slice(0, 30)) console.log(`   ${h}`);
    console.log('\nFix with:  node scripts/repair-stripped-skill-links.mjs --write   (the orchestrator applies the rows); never raise FOOT_BASELINE.');
    process.exit(1);
  } else if (dc) console.log(`dropped-inline: ${dc.footHoles.length} stripped-"<N>-foot" hole(s) (ratchet ${FOOT_BASELINE}; repair-stripped-skill-links.mjs lowers it)`);
}

/*
 * THE COLLAPSED LINK QUERY STRING — a sixth class, and the only one that is visible without the mirror.
 *
 * An importer turned AoN's action links into THE SLUG PLUS THE QUERY STRING, so Graceful Leaper shipped
 * *"when making a high-jump skill=acrobatics or long-jump skill=acrobatics"* for *"when making a High
 * Jump or Long Jump"* (feat-6243). The reader is shown a URL fragment where the rule should be. A grep
 * for `skill=` finds 18; the same collapse also left `traits=`, `dc=`, `show-dc=`, `statistic=`,
 * `options=` and `variant=` behind, for 47 descriptions in all. (The repair script reports 46: it can
 * only work where the mirror has a document, and actions/binding-vow carries no aonId at all.)
 *
 * A RATCHET over the RECORD COUNT — no mirror needed, because a query string in prose is a defect on
 * its own evidence. scripts/repair-stripped-skill-links.mjs drives it toward zero (30 of the 46 are
 * repairable today); the rest are refused because AoN's own sentence does not print the link in that
 * position, and need a human. Never raise it.
 */
const ARTEFACT_BASELINE = 17;
{
  const descs = JSON.parse(readFileSync(join(ROOT, 'public/core-descriptions.json'), 'utf8'));
  const hits = [];
  for (const [cat, recs] of Object.entries(descs)) {
    for (const [id, e] of Object.entries(recs ?? {})) if (e && typeof e.d === 'string' && hasArtefact(e.d)) hits.push(`${cat}/${id}`);
  }
  if (hits.length > ARTEFACT_BASELINE) {
    console.log(`dropped-inline: FAIL — ${hits.length} description(s) print a collapsed link's query string ("<slug> skill=…") — more than the ${ARTEFACT_BASELINE} the ratchet allows:`);
    for (const h of hits.slice(0, 30)) console.log(`   ${h}`);
    console.log('\nFix with:  node scripts/repair-stripped-skill-links.mjs --write   (the orchestrator applies the rows); never raise ARTEFACT_BASELINE.');
    process.exit(1);
  }
  console.log(`dropped-inline: ${hits.length} collapsed-link query string(s) (ratchet ${ARTEFACT_BASELINE}; repair-stripped-skill-links.mjs lowers it)`);
}

/*
 * THE STRIPPED DAMAGE TYPE — a seventh class, and the only one that leaves the NUMBER behind.
 *
 * The same cleaner sometimes keeps the dice and eats the type, so the Archives'
 * *"**Damage** 6d10+6 bludgeoning plus Grab"* (AoN apparition-7, Lurker in Devouring Dark) ships as
 * *"**Damage** 6d10+6 plus Grab"*. Nothing reads as broken — there is a number and the line parses —
 * but the player has no damage type, which is the half of a Strike that resistances, weaknesses and
 * immunities are read against. Ten of the fourteen animist apparitions lost it; the three newest kept
 * theirs, which is what makes it the cleaner rather than a print variation (batch 033 finding
 * lurker-in-devouring-dark#avatar-damage-type).
 *
 * ⚠ ELEVEN, NOT THE TEN THE FINDING NAMED. Witness to Ancient Battles lost the LABEL'S BOLD MARKERS
 * as well as the type — it ships *"…, Damage 6d8+6"* — so every count taken with a `**Damage**`
 * pattern walked straight past a record carrying exactly the defect being counted. The detector
 * matches the label with or without its markup, and repairs only the type.
 *
 * ⚠ NOT A SHAPE COUNT — it counts what the ARCHIVES print. A "**Damage** <dice>" with no type is not
 * on its own a defect: AoN itself prints Devil Form's vordine hoof as "**Damage** 1d4+12 plus 1d6
 * fire" (spell-894), and print is the authority. Only a site whose own AoN document prints a type we
 * do not counts here, which is also exactly the set repair-damage-type.mjs will touch.
 *
 * A RATCHET, measured at 11 the day the detector was written. This batch's rows
 * (work/.b033-rows-repair.json, all eleven records) drive it to zero — lower it to 0 as they land,
 * and never raise it.
 */
// ratchet lane 2026-09-29: measured 0 by node scripts/dropped-inline-check.mjs; pinned by test/dropped-inline-ratchets.test.ts
const DAMAGE_TYPE_BASELINE = 0;
{
  const dt = findDroppedDamageType(ROOT);
  if (!dt) console.log(`dropped-inline: stripped-damage-type ratchet SKIPPED — no AoN mirror at ${MIRROR}`);
  else if (dt.edits.length > DAMAGE_TYPE_BASELINE) {
    console.log(`dropped-inline: FAIL — ${dt.edits.length} description(s) drop a damage TYPE the Archives print — more than the ${DAMAGE_TYPE_BASELINE} the ratchet allows:`);
    for (const e of dt.edits.slice(0, 30)) console.log(`   ${(e.category + '/' + e.id).padEnd(40)} ${e.sites.map((s) => `${s.dice} [missing: ${s.type}]`).join(', ')}`);
    console.log('\nFix with:  node scripts/repair-damage-type.mjs --write   (the orchestrator applies the rows); never raise DAMAGE_TYPE_BASELINE.');
    process.exit(1);
  } else console.log(`dropped-inline: ${dt.edits.length} stripped-damage-type hole(s) (ratchet ${DAMAGE_TYPE_BASELINE}; repair-damage-type.mjs drives it to zero)`);
}

/*
 * THE STRIPPED FLAT-CHECK DC — a ninth class, and the one the save-DC pass above was blind to.
 *
 * AoN prints *"If a reaction would disrupt your spellcasting action, attempt a DC 15 flat check."*
 * (feat-2857, Steady Spellcasting (Magus)); we shipped *"…attempt a check."* — the player cannot tell
 * what to roll (batch P02 finding steady-spellcasting-magus). findStrippedSaveDc keys on
 * `DC <n> [save type]* save|check` and "flat" is not one of the words it lets sit before "check", so
 * every printed "DC <n> flat check" went unmeasured. Most sites are the terminal-hole shape ("attempt
 * a .") the HOLE ratchet above counts without knowing what belongs there; a few kept a grammatical
 * sentence ("attempt a check") that no hole pattern can see at all.
 *
 * A RATCHET over the count scripts/repair-flat-check-dc.mjs would repair CONFIDENTLY (insertion only;
 * its refusals — docs naming several DCs, anchors that do not occur exactly once — are not counted).
 * Measured at 53 on the day the detector was written (425 records whose Archives text prints a flat
 * check; 101 sites refused). Applying that script's rows drives it to zero, and takes the same
 * records' terminal holes out of HOLE_BASELINE's count — lower both as the rows land; never raise either.
 */
// batch P02: steady-spellcasting-magus — lowered 53 -> 0 once the driver applied the 53 repair rows
// (work/.bP02-rows-repair.json); measured 0 on the shipped artefact after --stage apply.
const FLAT_DC_BASELINE = 0;
{
  const fc = findStrippedFlatDc(ROOT);
  if (!fc) console.log(`dropped-inline: stripped-flat-check-DC ratchet SKIPPED — no AoN mirror at ${MIRROR}`);
  else if (fc.edits.length > FLAT_DC_BASELINE) {
    console.log(`dropped-inline: FAIL — ${fc.edits.length} description(s) drop a flat-check DC the Archives print — more than the ${FLAT_DC_BASELINE} the ratchet allows:`);
    for (const e of fc.edits.slice(0, 30)) for (const s of e.sites) console.log(`   ${(e.category + '/' + e.id).padEnd(40)} ${s.at.replace(' ▸ ', ` [missing: ${s.run}] `)}`);
    console.log('\nFix with:  node scripts/repair-flat-check-dc.mjs --write   (the orchestrator applies the rows); never raise FLAT_DC_BASELINE.');
    process.exit(1);
  } else console.log(`dropped-inline: ${fc.edits.length} stripped-flat-check-DC hole(s) (ratchet ${FLAT_DC_BASELINE}; repair-flat-check-dc.mjs drives it to zero)`);
}

/*
 * THE BLANK STAT-BLOCK LABEL — an eighth class, and the first one whose hole is in THE ARCHIVES
 * rather than in our own pipeline.
 *
 * Every other class here compares our text against AoN's and fails where AoN prints a value we do
 * not. This one has no counterpart to compare against: AoN's own document is the thing with the hole
 * in it. The Impossible Magic eidolon pages print an attribute array with the Strength, Dexterity and
 * AC tokens missing —
 *
 *     ours & AoN   "- Str \n- Dex \n- Con 2\n- Int 1\n- Wis 1\n- Cha -1\n-  AC ( Dex cap)"
 *     legacy AoN   "- Str 18\n- Dex 14\n- Con 16\n- Int 8\n- Wis 12\n- Cha 10\n- +2 AC (+3 Dex cap)"
 *
 * — measured over the mirror's own bytes: 13 of 13 Impossible Magic eidolon pages (eidolon-14 …
 * eidolon-26) are blank in both places, 0 of 13 older pages are. No structured field carries the
 * numbers either (the documents have no `strength`/`ac` keys at all), so there is nothing to repair
 * FROM and nothing to type in that would not be invented. That is the one thing this repo never does:
 * *"a confident wrong number is far worse than a visible missing one"* (lib/dropped-inline.mjs).
 *
 * NOT A COUNT — AN ALLOW LIST OF IDS. A numeric ratchet set to today's 2 would pass a third record
 * that appeared while one of these two was repaired, which is exactly how a hole spreads silently. A
 * site not named below fails the build whatever the total is, and the list shrinks to empty when AoN
 * corrects the pages (or an owner ruling supplies the numbers). Never add to it without the AoN doc
 * id and the same measurement.
 */
const BLANK_STAT_ALLOW = new Map([
  ['classFeatures/aberrant-eidolon', 'AoN eidolon-14 prints the Str, Dex and AC slots blank itself; new in Impossible Magic, so no earlier printing exists'],
  ['classFeatures/ooze-eidolon', 'AoN eidolon-23, same blanks, same book, no earlier printing'],
  ['classes.summoner option aberrant-eidolon', 'the picker copy of classFeatures/aberrant-eidolon'],
  ['classes.summoner option ooze-eidolon', 'the picker copy of classFeatures/ooze-eidolon'],
]);
/* A stat-block bullet whose LABEL is all that is left: "- Str" at the end of its line, or an AC line
 * that lost its bonus or its Dex cap number. Both shapes are the same defect — a token deleted from
 * between the label and the line end — and neither can be seen by the "a ." or "<N>-foot" patterns
 * above, which need a following word or a sentence to align. */
const BLANK_ATTR = /^[-*]\s*(?:Str|Dex|Con|Int|Wis|Cha)\s*$/m;
const BLANK_AC = /^[-*]\s+AC \(\s*Dex cap\)\s*$|^[-*]\s*\s+AC \(/m;
{
  const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8'));
  const descs = JSON.parse(readFileSync(join(ROOT, 'public/core-descriptions.json'), 'utf8'));
  const holed = (t) => typeof t === 'string' && (BLANK_ATTR.test(t) || BLANK_AC.test(t));
  const hits = [];
  for (const [cat, recs] of Object.entries(descs)) {
    for (const [id, e] of Object.entries(recs ?? {})) if (holed(e?.d)) hits.push(`${cat}/${id}`);
  }
  /* The picker reads the subclass OPTION's own inline copy, not the description bucket, so a guard
   * that only walked core-descriptions.json would pass while the page a player chooses on had the
   * hole on it. That is how these two shipped. */
  for (const [clsId, cls] of Object.entries(core.classes ?? {})) {
    for (const o of cls?.subclass?.options ?? []) if (holed(o?.description)) hits.push(`classes.${clsId} option ${o.id}`);
  }
  const unallowed = hits.filter((h) => !BLANK_STAT_ALLOW.has(h));
  if (unallowed.length) {
    console.log(`dropped-inline: FAIL — ${unallowed.length} record(s) print a stat-block label with no value after it ("- Str", "- AC ( Dex cap)"), and are not on the blank-stat allow list:`);
    for (const h of unallowed) console.log(`   ${h}`);
    console.log('\nEither the value exists upstream and the importer dropped it (repair it), or AoN itself prints the blank — then add the id here with the AoN doc id and the measurement. Never a bare count.');
    process.exit(1);
  }
  console.log(`dropped-inline: ${hits.length} blank stat-block label(s), all ${BLANK_STAT_ALLOW.size} allowed by id (AoN's own pages are blank; awaiting an upstream correction or an owner ruling)`);
}

const found = findDroppedInline(ROOT);

if (!found) {
  console.log(`dropped-inline: SKIPPED — no AoN mirror at ${MIRROR}`);
  process.exit(0);
}

const { edits, refused } = found;
if (!edits.length) {
  console.log(`dropped-inline: ok — no record is missing a value the Archives print (${refused.length} site(s) refused as unsafe to repair automatically; see scripts/repair-dropped-inline.mjs)`);
  process.exit(0);
}

const siteCount = edits.reduce((n, e) => n + e.sites.length, 0);
console.log(`dropped-inline: FAIL — ${edits.length} record(s) are missing ${siteCount} value(s) the Archives print:\n`);
for (const e of edits.slice(0, 25)) for (const s of e.sites) console.log(`   ${(e.category + '/' + e.id).padEnd(34)} ${s.at.replace(' ▸ ', ` [missing: ${s.run}] `)}`);
if (edits.length > 25) console.log(`   …and ${edits.length - 25} more record(s)`);
console.log(`\nFix with:  node scripts/repair-dropped-inline.mjs --write  &&  npm run data`);
process.exit(1);
