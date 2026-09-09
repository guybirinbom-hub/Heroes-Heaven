/*
 * THE STRIPPED DAMAGE TYPE — a seventh dropped-inline class, and the one that leaves a NUMBER behind.
 *
 * The same `@Damage[…]` cleaner that deletes whole values sometimes keeps the dice and eats the TYPE:
 * the Archives print the Lurker in Devouring Dark's avatar Strike as
 *
 *   **Damage** 6d10+6 bludgeoning plus Grab          (AoN apparition-7)
 *
 * and we ship *"**Damage** 6d10+6 plus Grab"* (batch 033 finding lurker-in-devouring-dark#avatar-damage-type).
 * Nothing looks broken — there is a number, the sentence parses — but the player has no damage type,
 * which is the half of a Strike that resistances, weaknesses and immunities are read against. Ten of
 * the fourteen animist apparitions lost it the same way; the three newest kept theirs, so this is the
 * cleaner, not a print variation.
 *
 * HOW A REPAIR IS DERIVED SAFELY. Insertions only, never a substitution and never a replacement of our
 * wording with the mirror's: the type word is spliced in immediately after the dice run we already
 * print, and everything else in the description — our links, glyphs, authored corrections — is left
 * byte-for-byte alone.
 *
 * Four refusals, because a confident WRONG damage type is worse than a visible missing one:
 *   1. ORDERED ALIGNMENT — a record prints several Strikes and two of them often share a dice run
 *      (Crafter in the Vault rolls 6d6+6 slashing in melee and 6d6+6 piercing at range), so a
 *      dice-string lookup would pick the wrong type. The doc's **Damage** sites are paired with ours
 *      BY ORDER, and the record is refused unless the counts match and every pair's dice run is
 *      identical. That is the alignment proof; nothing weaker is accepted.
 *   2. TAIL AGREEMENT — the word following the site must be the same on both sides ("plus", "Ranged",
 *      or nothing at the end of the block). A doc that has drifted from our text fails here.
 *   3. VOCABULARY — the inserted run must be a PF2e damage type (plus an optional "persistent" /
 *      "splash" qualifier). Anything else is not a type and is refused.
 *   4. ALREADY CORRECT — a site that already carries its type is skipped, so re-running is a no-op.
 *      Where the Archives THEMSELVES print no type (Devil Form's vordine hoof, "**Damage** 1d4+12
 *      plus 1d6 fire", AoN spell-894) there is nothing to insert and the site is left alone: our text
 *      matches print, and print is the authority.
 *
 * Rows go to a SPEC the orchestrator applies — anything written straight into public/ dies at the next
 * `npm run data`.
 *
 *   node scripts/repair-damage-type.mjs            # report only
 *   node scripts/repair-damage-type.mjs --write    # …and write work/.b033-rows-repair.json
 *
 * The count this measures is the baseline of the stripped-damage-type ratchet in
 * scripts/dropped-inline-check.mjs; applying this script's rows drives that baseline to zero.
 *
 * ⚠ IT ONLY SEES public/core-descriptions.json. A class option keeps its OWN copy of the same
 * class-feature prose inside public/core.json (classes.animist.extraChoices[apparition].options[…]
 * .description), and an overlay row cannot reach it — a `description` row with a `path` is refused by
 * apply-parity-fixes.mjs on purpose. Those copies stay stale until import-core.mjs re-syncs an option's
 * description from the backfilled classFeatures record; see the batch 033 repair report.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MIRROR, plain, mirrorIndex } from './repair-stripped-save-dc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(p, 'utf8').replace(/^\ufeff/, ''));

/** Every PF2e damage type, plus the two qualifiers that ride in front of one. */
const TYPE =
  '(?:persistent\\s+|splash\\s+)*(?:bludgeoning|piercing|slashing|acid|cold|electricity|fire|sonic|vitality|void|force|mental|poison|bleed|precision|untyped|spirit|negative|positive|chaotic|evil|good|lawful)';
/** A dice run as either side writes it: `6d10+6`, `2d6`, `1d4 + 1`. */
const DICE = '\\d+d\\d+(?:\\s*[+-]\\s*\\d+)?';
/*
 * Our side keeps its markup, so the label is USUALLY bold — but not always, and the exception is not
 * cosmetic. Witness to Ancient Battles ships *"final strike (agile, fatal d12, reach 15 feet), Damage
 * 6d8+6"* with the bold markers gone as well as the type, so a `\*\*Damage\*\*` pattern walks past a
 * record with exactly the defect it is hunting. The label's markup is OUR formatting, not a printed
 * value, so it is matched optionally and left exactly as it is; only the missing type is inserted.
 */
const OURS_SITE = new RegExp(`(?<![A-Za-z])(?:\\*\\*)?Damage(?:\\*\\*)?\\s+(${DICE})(?![\\dd+-])`, 'g');
/** The mirror is read through `plain`, so the label is a bare word. */
const THEIRS_SITE = new RegExp(`\\bDamage\\s+(${DICE})(?![\\dd+-])(\\s+${TYPE}\\b)?`, 'gi');

const norm = (s) => s.replace(/\s+/g, '');
/*
 * The first WORD after a site, with markup and punctuation stripped — "" at the end of the block.
 *
 * ⚠ Leading punctuation is skipped rather than emptied. The Archives end the melee line with a
 * semicolon (*"6d10+6 fire; **Ranged** …"*) where we end it with a blank line, so taking the first
 * whitespace token and deleting its non-letters turns ";" into "" and calls two aligned sites a
 * mismatch — which is exactly how the first run of this script refused five of the ten apparitions.
 */
const tail = (rest) => (plain(rest).replace(/^[^A-Za-z]+/, '').split(/\s+/)[0] ?? '').replace(/[^A-Za-z]/g, '').toLowerCase();

/**
 * Restore every damage type the cleaner ate from ONE description.
 *
 * Pure and side-effect free so the fixtures in test/batch033-repair.test.ts can drive it directly.
 *
 * @param ours    our description, markup and all
 * @param theirs  the Archives' markdown for the same record
 * @returns {{ next: string, sites: {dice: string, type: string}[] } | { refuse: string } | null}
 *          null when there is nothing to do (no hole, or no typed counterpart to take one from)
 */
export const restoreDamageTypes = (ours, theirs) => {
  const mine = [...ours.matchAll(OURS_SITE)];
  if (!mine.length) return null;
  const holes = mine.filter((m) => !new RegExp(`^\\s+${TYPE}\\b`, 'i').test(ours.slice(m.index + m[0].length)));
  if (!holes.length) return null;

  const flat = plain(theirs);
  const yours = [...flat.matchAll(THEIRS_SITE)];

  /* 1 — ORDERED ALIGNMENT. */
  if (yours.length !== mine.length)
    return { refuse: `the Archives print ${yours.length} **Damage** site(s) and we print ${mine.length} — the sites cannot be paired` };
  for (let i = 0; i < mine.length; i++)
    if (norm(mine[i][1]) !== norm(yours[i][1]))
      return { refuse: `site ${i + 1} rolls ${norm(mine[i][1])} for us and ${norm(yours[i][1])} in the Archives — the sites are not aligned` };

  const sites = [];
  let next = ours;
  /* Right-to-left, so an insertion never moves the index of a site still to come. */
  for (let i = mine.length - 1; i >= 0; i--) {
    if (!holes.includes(mine[i])) continue; // 4 — already correct
    const printed = yours[i][2]?.trim();
    if (!printed) continue; // 4 — the Archives print no type here either; print is the authority
    /* 3 — VOCABULARY is guaranteed by THEIRS_SITE's own pattern; assert it rather than trust it. */
    if (!new RegExp(`^${TYPE}$`, 'i').test(printed)) return { refuse: `"${printed}" is not a damage type` };
    /* 2 — TAIL AGREEMENT. */
    const end = mine[i].index + mine[i][0].length;
    const ourTail = tail(ours.slice(end));
    const theirTail = tail(flat.slice(yours[i].index + yours[i][0].length));
    if (ourTail !== theirTail)
      return { refuse: `site ${i + 1} is followed by "${ourTail || '(end)'}" for us and "${theirTail || '(end)'}" in the Archives — the sites are not aligned` };
    next = `${next.slice(0, end)} ${printed}${next.slice(end)}`;
    sites.unshift({ dice: norm(mine[i][1]), type: printed });
  }
  return sites.length ? { next, sites } : null;
};

/** Every record the Archives let us re-type confidently, plus every record refused and why. */
export const findDroppedDamageType = (root = ROOT) => {
  if (!existsSync(MIRROR)) return null;
  const core = read(join(root, 'public/core.json'));
  const descs = read(join(root, 'public/core-descriptions.json'));
  const byId = mirrorIndex();

  const edits = [];
  const refused = [];
  for (const [bucket, recs] of Object.entries(descs)) {
    for (const [id, entry] of Object.entries(recs ?? {})) {
      const raw = String(entry?.d ?? '');
      if (!/(?<![A-Za-z])(?:\*\*)?Damage/.test(raw)) continue;
      const file = core[bucket]?.[id]?.aonId ? byId.get(core[bucket][id].aonId) : null;
      if (!file) continue;
      let doc = null;
      try { doc = read(file); } catch { continue; }
      const r = restoreDamageTypes(raw, String(doc.markdown ?? ''));
      if (!r) continue;
      if (r.refuse) { refused.push({ where: `${bucket}/${id}`, why: r.refuse }); continue; }
      edits.push({ category: bucket, id, field: 'description', value: r.next, sites: r.sites, aonId: core[bucket][id].aonId });
    }
  }
  return { edits, refused };
};

/* Run as a script, not when imported by the test or by the guard. (Windows: process.argv[1] is a
 * `C:\…` path, so comparing it to import.meta.url needs pathToFileURL, not string surgery.) */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const found = findDroppedDamageType();
  if (!found) { console.log(`damage-type: SKIPPED — no AoN mirror at ${MIRROR}`); process.exit(0); }
  const { edits, refused } = found;

  const siteCount = edits.reduce((n, e) => n + e.sites.length, 0);
  console.log(`damage-type: ${edits.length} record(s) repairable, ${siteCount} site(s); ${refused.length} record(s) refused.`);
  for (const e of edits) console.log(`   ${(e.category + '/' + e.id).padEnd(40)} ${e.sites.map((s) => `${s.dice} + ${s.type}`).join(', ')}`);
  console.log(`\n   refused:`);
  for (const r of refused.slice(0, 30)) console.log(`   ${r.where.padEnd(40)} ${r.why}`);
  if (refused.length > 30) console.log(`   …and ${refused.length - 30} more`);

  if (process.argv.includes('--write')) {
    const spec = {
      findings: [
        {
          id: 'lurker-in-devouring-dark#avatar-damage-type',
          backfillRows: edits.map((e) => ({
            category: e.category,
            id: e.id,
            field: 'description',
            value: e.value,
            why: `AoN ${e.aonId} prints "**Damage** ${e.sites[0].dice} ${e.sites[0].type}" and our import dropped the type, leaving the player a Strike with no damage type to check resistances against (restored by scripts/repair-damage-type.mjs, insertions only).`,
          })),
          note: `${edits.length} description(s) re-typed by insertion of the printed damage type; ${refused.length} record(s) refused (see the script's report).`,
        },
      ],
    };
    writeFileSync(join(ROOT, 'work/.b033-rows-repair.json'), JSON.stringify(spec, null, 2));
    console.log(`\nwrote work/.b033-rows-repair.json (${edits.length} row(s))`);
  } else {
    console.log('\n(dry run — pass --write to emit work/.b033-rows-repair.json; the orchestrator applies the rows)');
  }
}
