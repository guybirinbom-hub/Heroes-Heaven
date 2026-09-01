/*
 * GUARD: the AST patches from scripts/apply-ast-patches.mjs are still in the shipped trees.
 *
 * `npm run data` rebuilds public/ast/* from the AoN export, whose parse DROPPED whole printed
 * sections for these records — so a regen silently reverts the patches and the player loses the
 * content again (the AST is what DescBody renders; the repaired `.d` does not save them).
 * If this fails, run: node scripts/apply-ast-patches.mjs
 *
 *   node scripts/ast-content-check.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const flat = (n) => (!n || typeof n !== 'object') ? '' : n.t === 'text' ? (n.v ?? '') : (n.c ?? []).map(flat).join('');

/* One probe set per patched node — the strings the export's parse dropped. */
const PROBES = [
  ['classFeatures', 'ashes', ['Breathe Fire', 'Disintegrate', 'Revelation Spells']],
  ['classFeatures', 'bloodline-elemental', ['Thunderstrike', 'Chain Lightning']],
  ['classFeatures', 'bloodline-imperial', ['Translocate', 'Retrocognition']],
  ['classFeatures', 'way-of-the-vanguard', ['Living Fortification', 'Siegebreaker']],
  ['items', 'razmiri-mask-porcelain', ['Manifestation', 'Sunburst']],
  ['items', 'whispering-staff', ['Clairvoyance', 'Truesight']],
];

const cache = new Map();
const bad = [];
for (const [bucket, slug, probes] of PROBES) {
  if (!cache.has(bucket)) cache.set(bucket, JSON.parse(readFileSync(join(ROOT, 'public/ast/' + bucket + '.json'), 'utf8')));
  const node = cache.get(bucket)[slug];
  const text = node ? flat(node) : '';
  const missing = probes.filter((x) => !text.includes(x));
  if (missing.length) bad.push(`${bucket}/${slug} missing: ${missing.join(', ')}`);
}
if (bad.length) {
  console.error('ast-content: FAIL — a regen wiped the AST patches:\n   ' + bad.join('\n   ') + '\n   Run: node scripts/apply-ast-patches.mjs');
  process.exit(1);
}
console.log(`ast-content: ok — ${PROBES.length} patched node(s) still carry their printed sections.`);
