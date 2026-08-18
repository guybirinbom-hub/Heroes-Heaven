/**
 * EVERY CHOICE THE BUILDER CANNOT ACTUALLY OFFER.
 *
 * Why this exists: the lane inventory (scripts/lane-confidence.mjs) scores the ENGINE — is the field
 * read, is it tested with numbers, has anyone compared it to the book. It is blind to the other half
 * of the mandate. A feat whose `choice` renders an EMPTY picker passes every engine measure: the
 * field is present, the reader exists, the tests are green, and the player still cannot choose.
 *
 * Domain Initiate is the worked example. Across all 485 deities and 1,911 deity×domain combinations
 * the engine grants the right focus spell every time — but with no deity chosen the picker offers
 * nothing and says nothing about why. The engine was never the problem.
 *
 * So: for every record carrying a `choice`, put it on a host that can legally take it, ask the
 * builder for the option list, and report the empties. Then split them, because they are not one bug:
 *
 *   DEPENDS   the list is computed from another build answer that is not set yet (deity, class,
 *             tradition). Legitimate to be empty — but the picker must SAY so, not sit blank.
 *   EMPTY     no dependency explains it. The menu is broken or the option source is missing.
 *
 * ⚠ Read before trusting a number from this file. A previous reachability sweep reported 1,433 false
 * unreachables because it used blank hosts, and prerequisite-gated feats look broken on a host that
 * cannot take them. Hosts here are chosen from the record's own traits, and any record we cannot
 * host is reported as SKIPPED rather than counted — a lie by omission is still a lie.
 */
import { content } from '../test/_content.ts';
import { buildChoiceOptions, buildCharacter, emptyBuild } from '../src/rules/build.ts';
import { openChoiceOptions } from '../src/rules/openChoice.ts';

const con = content();

/*
 * ⚠ THE DETECTOR MUST MATCH THE OUTCOME, NOT THE CONDITION.
 *
 * First run of this script reported 30 broken pickers. All 30 were false positives, in the two
 * shapes the builder deliberately handles elsewhere:
 *
 *   kind:'text'  renders a free-text <input>. It has no option list BY DESIGN — Kingdom skills and
 *                leadership roles, where the app has no data and typing one from memory would be
 *                inventing content. Zero options is correct, not a defect.
 *   kind:'open'  resolves through openChoiceOptions(def.from, …) at render time because the legal
 *                list is too long to enumerate on the record. buildChoiceOptions' narrowing path
 *                returns [] for these — asking the wrong function and believing the answer.
 *
 * This project has now shipped that mistake five times (redundantFallback 34 of 145, weapon remap
 * 6 of 40, scan:choices "TO DO 0" on a 4%-built lane, damaged-descriptions 2,897 vs 866, and this).
 * Every one looked like a finding until the outcome was checked instead of the condition.
 */

/** Build answers a menu can legitimately depend on, and how to satisfy one. */
const DEPENDS_ON = {
  domains: 'deityId',
  spells: 'a spellcasting class',
  tradition: 'archetypeTradition',
};

const firstClassFor = (traits) => {
  for (const t of traits ?? []) if (con.classes[t]) return t;
  return null;
};
const anyDeity = Object.entries(con.deities).find(([, d]) => (d.domains ?? []).length)?.[0];

const host = (classId, level, over) => ({
  ...emptyBuild(),
  name: 't',
  level: Math.max(1, Math.min(20, level || 1)),
  classId,
  ancestryId: Object.keys(con.ancestries)[0],
  backgroundId: Object.keys(con.backgrounds)[0],
  keyAbility: con.classes[classId]?.keyAbility?.length === 1 ? con.classes[classId].keyAbility[0] : null,
  subclassId: con.classes[classId]?.subclass?.options?.[0]?.id ?? null,
  ...over,
});

const SLOT = '1:class:0';
const rows = [];
let skipped = 0;

for (const [coll, key] of [['feats', 'feats'], ['classFeatures', 'classFeatures']]) {
  for (const [id, rec] of Object.entries(con[coll] ?? {})) {
    const defs = Array.isArray(rec?.choice) ? rec.choice : rec?.choice ? [rec.choice] : [];
    if (!defs.length) continue;
    /* A general, skill or ancestry feat names no class in its traits — but ANY class can take it, so
     * hosting it on an arbitrary class is correct rather than a skip. The first sweep skipped 214
     * records this way and called them "could not host", which read as coverage it did not have. */
    const classId = firstClassFor(rec.traits) ?? Object.keys(con.classes)[0];
    if (!classId) { skipped++; continue; }

    for (const def of defs) {
      /* Free text has no list to be empty. Not a defect, not a skip — simply not this scan's subject. */
      if (def.kind === 'text') continue;
      /* Two hosts: one bare, one with every dependency this kind of menu could want satisfied. The
       * difference between them is the whole finding — a menu that fills only on the rich host is
       * DEPENDS, one that stays empty on both is EMPTY. */
      const bare = host(classId, rec.level, { featPicks: { [SLOT]: id } });
      const rich = host(classId, rec.level, { featPicks: { [SLOT]: id }, deityId: anyDeity, archetypeTradition: 'divine' });
      /* Ask the SAME function the builder asks. An `open` menu is resolved by openChoiceOptions at
       * render time; putting it through the narrowing path answers a question nobody asked. */
      const optionsFor = (b) =>
        def.kind === 'open'
          ? openChoiceOptions(def.from, con, { hideLegacy: b.hideLegacy, character: buildCharacter(b, con) }).length
          : buildChoiceOptions(id, def, b, con, buildCharacter(b, con), SLOT).length;
      let onBare = -1, onRich = -1, err = null;
      try {
        onBare = optionsFor(bare);
        onRich = optionsFor(rich);
      } catch (e) { err = String(e.message ?? e).slice(0, 80); }
      if (err) { rows.push({ id, name: rec.name, coll, kind: def.kind, verdict: 'THREW', detail: err }); continue; }
      if (onRich > 0 && onBare === 0) {
        rows.push({ id, name: rec.name, coll, kind: def.kind, verdict: 'DEPENDS', detail: `empty until ${DEPENDS_ON[def.kind] ?? 'another build answer'} is set (then ${onRich})` });
      } else if (onRich === 0) {
        rows.push({ id, name: rec.name, coll, kind: def.kind, verdict: 'EMPTY', detail: 'no options on any host' });
      }
    }
  }
}

const by = (v) => rows.filter((r) => r.verdict === v);
console.log(`records with a choice that the builder cannot fill:\n`);
for (const v of ['EMPTY', 'THREW', 'DEPENDS']) {
  const list = by(v);
  console.log(`${'='.repeat(84)}\n${v}  —  ${list.length}\n`);
  const kinds = {};
  for (const r of list) kinds[r.kind ?? '?'] = (kinds[r.kind ?? '?'] ?? 0) + 1;
  console.log('  by kind: ' + Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`).join('  '));
  for (const r of list.slice(0, 30)) console.log(`   ${r.id.padEnd(38)} ${String(r.kind).padEnd(9)} ${r.detail}`);
  if (list.length > 30) console.log(`   … and ${list.length - 30} more`);
  console.log();
}
console.log(`records we could not host (reported, not hidden): ${skipped}`);
