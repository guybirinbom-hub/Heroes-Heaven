/*
 * DOES A RECORD WEAR THE ACTION COST OF SOMETHING IT MERELY GRANTS?
 *
 * AoN states a page's own cost in its `<title>` glyph, and an EMPTY `<actions string="" />` there is
 * the Archives saying "passive". Some pages then describe a GRANTED activity inline, with its own
 * glyph bound to a named line:
 *
 *     **Activate—Host of Wrath** <actions string="Two Actions" />
 *
 * `grantedCost()` in scripts/lib/aon-facets.mjs used to read any inline body glyph, so that Two
 * Actions landed on the feat. The six mythic Avenger feats made it unmistakable: five stored Two
 * Actions and Avenger of Lust stored a REACTION, each exactly matching its own nested activity, while
 * every one of the six bodies is pure grant language.
 *
 * THE DEFECT THIS FAILS ON, precisely: the page's own glyph is EMPTY, our stored cost equals the
 * nested named activity's glyph, AND that activity ships as its own record. The last clause is what
 * makes it a defect rather than a judgement call — the cost already lives on the activity, so the copy
 * on the feat is redundant and puts a passive feat in the encounter action list.
 *
 * ⚠ IT DELIBERATELY DOES NOT FIRE when the granted activity has NO record of its own. Seven feats are
 * in that position — Tengu Feather Fan, the three Dreaming Heirloom feats, the two Razmiri masks and
 * Living God — and for them the cost on the feat is the player's only route to the ability. Treating
 * those the same way would have deleted seven abilities in the name of tidiness. The distinction is
 * computed, not listed, so a new record lands on the right side of it automatically: ship the activity
 * and the feat must go passive; don't, and the feat keeps the cost.
 *
 *   node scripts/nested-activate-check.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ARCHIVE = 'C:/wonderers guide/aon-2e-archive/data/by-category/feat';

const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8').replace(/^\ufeff/, ''));

if (!existsSync(ARCHIVE)) {
  /* The mirror is a separate checkout. Absent, this check cannot run — say so rather than passing
   * silently, because "no findings" and "never looked" are the same output otherwise. */
  console.log(`nested-activate: SKIPPED — no AoN mirror at ${ARCHIVE}`);
  process.exit(0);
}

const titleGlyph = (md) => {
  const t = /<title\b[^>]*>([\s\S]*?)<\/title>/.exec(md);
  if (!t) return undefined;
  const g = /<actions\s+string="([^"]*)"\s*\/?>/.exec(t[1]);
  return g ? g[1] : undefined;
};
const bodyOf = (md) => {
  const t = /<title\b[^>]*>[\s\S]*?<\/title>/.exec(md);
  return t ? md.slice(t.index + t[0].length) : md;
};
const parseGlyph = (s) => {
  const v = String(s).toLowerCase();
  if (v.includes('reaction')) return 'reaction';
  if (v.includes('free')) return 'free';
  if (v.includes('single')) return '1';
  if (v.includes('two')) return '2';
  if (v.includes('three')) return '3';
  return null;
};
const ourCost = (rec) => {
  const a = rec?.actionCost;
  if (!a) return 'passive';
  return a.type === 'actions' ? String(a.value) : a.type;
};

/* Match the granted activity by NAME, normalised — slugs disagree about apostrophes ("Sorshen's
 * Devotion" is `sorshens-devotion` here and would slug to `sorshen-s-devotion`), and a slug mismatch
 * would silently read as "does not ship" and hide the defect. */
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const shippedActivities = new Map();
for (const bucket of ['actions', 'feats']) {
  for (const [id, r] of Object.entries(core[bucket] ?? {})) {
    if (r?.name) shippedActivities.set(norm(r.name), { bucket, id, cost: ourCost(r) });
  }
}

const byAonId = new Map();
for (const [id, r] of Object.entries(core.feats ?? {})) if (r?.aonId) byAonId.set(r.aonId, id);

const findings = [];
const exempt = [];
let scanned = 0;

for (const f of readdirSync(ARCHIVE)) {
  if (!f.endsWith('.json')) continue;
  let doc;
  try { doc = JSON.parse(readFileSync(join(ARCHIVE, f), 'utf8')); } catch { continue; }
  const md = String(doc.markdown ?? doc?.data?.markdown ?? '');
  if (!md) continue;
  if (titleGlyph(md) !== '') continue; // the page states a cost of its own — nothing to inherit

  // Both named-activity shapes: "**Activate—Name** <glyph>" AND a bare bolded action NAME with a
  // glyph ("**Drape Ambient Magic** <actions .../>", the hole the ostilli family shipped through).
  // The unnamed "**Activate**" form is the record's own cost and is excluded.
  const named =
    /\*\*Activate[—–-]\s*([^*]+?)\*\*\s*<actions\s+string="([^"]+)"/.exec(bodyOf(md)) ??
    /\*\*(?!Activate\*\*)([^*]+?)\*\*\s*<actions\s+string="([^"]+)"/.exec(bodyOf(md));
  if (!named) continue;

  const hhId = byAonId.get(f.replace(/\.json$/, ''));
  if (!hhId) continue;
  scanned++;

  const nestedCost = parseGlyph(named[2]);
  const stored = ourCost(core.feats[hhId]);
  if (!nestedCost || stored !== nestedCost) continue; // our cost is not a copy of the nested glyph

  const activity = shippedActivities.get(norm(named[1]));
  // A page may restate the FEAT'S OWN activity in the body ("**Primal Howl** <glyph>") while the
  // title glyph is empty — the record IS the activity and correctly wears the cost. Not a finding.
  if (activity && activity.bucket === 'feats' && activity.id === hhId) continue;
  // The claim is "the activity ALREADY HOLDS that cost" — so require it. A shipped activity storing
  // a DIFFERENT cost is a different defect (one of the two records is wrong) and must be shouted,
  // not silently converted into a passive feat that loses the number.
  if (activity && activity.cost !== nestedCost) {
    findings.push({ hhId, name: doc.name, activity: named[1].trim(), at: `${activity.bucket}/${activity.id}`, cost: nestedCost, mismatch: activity.cost });
    continue;
  }
  if (activity) findings.push({ hhId, name: doc.name, activity: named[1].trim(), at: `${activity.bucket}/${activity.id}`, cost: nestedCost });
  else exempt.push({ hhId, activity: named[1].trim(), cost: nestedCost });
}

console.log(`nested-activate: ${scanned} record(s) carry an empty title glyph and a named **Activate—X** glyph.`);
if (exempt.length) {
  console.log(`  ${exempt.length} keep that cost legitimately — the activity they grant ships nowhere else:`);
  for (const e of exempt) console.log(`      ${e.hhId} -> "${e.activity}" (${e.cost})`);
}

if (findings.length) {
  console.log(`\nFAIL — ${findings.length} record(s) wear the cost of an activity that already carries it:\n`);
  for (const d of findings) {
    console.log(`   feats/${d.hhId}`);
    console.log(`      stores ${d.cost}, which is the glyph on "**Activate—${d.activity}**"`);
    if (d.mismatch) console.log(`      but ${d.at} stores ${d.mismatch}, NOT ${d.cost} — one of the two records is wrong; read the page.`);
    else console.log(`      and ${d.at} already holds that cost — so the feat itself is passive.`);
  }
  console.log(
    `\n   The page's own <title> glyph is EMPTY, which is how the Archives say "no action cost".` +
      `\n   Fix the DATA in scripts/data/effect-backfill.json (a value only in public/core.json dies at` +
      `\n   the next \`npm run data\`), and check that the feat also GRANTS the activity, or making it` +
      `\n   passive leaves the player no route to it.`,
  );
  process.exit(1);
}
console.log('nested-activate: no record wears a granted activity\'s cost.');
