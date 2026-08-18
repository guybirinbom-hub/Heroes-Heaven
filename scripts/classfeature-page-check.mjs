/**
 * A class feature must render a CLASS FEATURE page.
 *
 * `aonId` is stamped by name, and a subclass option's name is rarely unique. Twenty player-selectable
 * options were pointing at an unrelated document and rendering it in full:
 *
 *     classFeatures/bomber   -> class-sample-2    an AoN "Class Sample Build" pregen guide
 *     classFeatures/mirror   -> equipment-2735    "Mirror … Price 1 gp Hands 1"  (eleven words)
 *     classFeatures/warrior  -> background-445    a background
 *     classFeatures/battle   -> action-1422       a Kingmaker army action
 *     classFeatures/beast-eidolon -> creature-3679  an NPC stat block
 *
 * Every one is reachable in the builder — `alchemist.subclass "Research Field"`, `rogue.subclass
 * "Racket"`, `thaumaturge.extraChoices "Implements"` — so a player picking a Racket read a pregen build
 * guide instead of their racket's rules.
 *
 * ⚠ CATEGORY COMPATIBILITY IS TOO BLUNT HERE, and that is why this file exists separately from
 * aonid-integrity.mjs. `classFeatures` legitimately points into ~40 categories (bloodline, doctrine,
 * mystery, instinct…), and a few genuinely resolve to `rules` or `sidebar` — Focus Spells lives on a
 * rules page, Warden Spells in a book sidebar. Widening ALLOWED to admit those also admitted
 * `class-sample` and `creature`, which is exactly how these twenty stayed invisible. Worse, four had
 * been added to BUCKET_QUIRK as "only the id is off", actively silencing the check.
 *
 * The sharp signal is AoN's OWN BADGE — the `right=` attribute on the page title. AoN writes
 * "Rogue Racket", "Alchemist Research Field", "Thaumaturge Implement", "Class 3" for class content, and
 * "Class Sample Build", "Item 0", "Background", "Creature 10", "Archetype 2" for everything else. A
 * class feature wearing one of the latter is wrong no matter what the category table says.
 *
 *   node scripts/classfeature-page-check.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { badgeOf, isForeignToClassFeature, GROUP_BUCKET, offeredBy } from './lib/ast-badge.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8'));

const readAst = (b) => {
  for (const p of [`public/ast/${b}.json`, `public/ast/${b}.json.gz`]) {
    const f = join(ROOT, p);
    if (!existsSync(f)) continue;
    try { return JSON.parse(p.endsWith('.gz') ? gunzipSync(readFileSync(f)).toString('utf8') : readFileSync(f, 'utf8')); } catch { /* next */ }
  }
  return null;
};



const ast = readAst('classFeatures');
if (!ast) { console.error('no public/ast/classFeatures.json'); process.exit(1); }

const offers = offeredBy(core);

/**
 * The page this record SHOULD render — the same two conditions the fixer uses: the choice group that
 * offers it names the bucket, and that bucket's page must not itself carry a foreign badge.
 */
function alternatives(slug) {
  const offer = offers.get(slug);
  if (!offer) return [];
  const bucket = GROUP_BUCKET[offer.group.toLowerCase()];
  if (!bucket) return [];
  if (bucket === 'eidolon') return [{ bucket, aonId: '(export)', badge: 'Summoner Eidolon' }];
  const rec = core[bucket]?.[slug];
  if (!rec?.aonId) return [];
  const b = readAst(bucket)?.[slug] ? badgeOf(readAst(bucket)[slug]) : null;
  if (!b || isForeignToClassFeature(b)) return [];
  return [{ bucket, aonId: rec.aonId, badge: b }];
}

const bad = [];
for (const [id, rec] of Object.entries(core.classFeatures ?? {})) {
  const node = ast[id];
  if (!node) continue;
  const badge = badgeOf(node);
  if (!badge || !isForeignToClassFeature(badge)) continue;
  bad.push({ id, name: rec.name, aonId: rec.aonId ?? null, badge, alts: alternatives(id) });
}

/*
 * Two outcomes, and only one is a build failure.
 *
 * FIXABLE — a foreign badge AND another bucket already ships a page that looks like class content. That
 * pairing is unambiguous: the right page exists, we are showing the wrong one.
 *
 * REVIEW — a foreign badge with no better page anywhere. Some of these are genuinely documented that
 * way by AoN (a few class features really do live on an archetype page), so failing the build on them
 * would train people to ignore this check. Reported, not enforced.
 */
const fixable = bad.filter((b) => b.alts.length);
const review = bad.filter((b) => !b.alts.length);

console.log(`${Object.keys(core.classFeatures ?? {}).length} class features; ${Object.keys(ast).length} with a display tree`);
console.log(`  FIXABLE  wrong page, and the right one is already shipped : ${fixable.length}`);
console.log(`  review   wrong-looking page with no better candidate      : ${review.length}\n`);

if (fixable.length) {
  console.log(`${'record'.padEnd(24)} ${'renders'.padEnd(21)} ${'badge'.padEnd(20)} should render`);
  for (const b of fixable) {
    console.log(`${b.id.padEnd(24)} ${String(b.aonId).padEnd(21)} ${b.badge.slice(0, 18).padEnd(20)} ${b.alts.map((a) => `${a.aonId} (${a.badge})`).join(', ')}`);
  }
  console.log('\nFix with: node scripts/fix-classfeature-pages.mjs --write');
}
if (review.length && process.argv.includes('--review')) {
  console.log(`\n--- review (${review.length}) ---`);
  for (const b of review) console.log(`  ${b.id.padEnd(28)} ${String(b.aonId).padEnd(22)} ${b.badge}`);
}
process.exit(fixable.length ? 1 : 0);
