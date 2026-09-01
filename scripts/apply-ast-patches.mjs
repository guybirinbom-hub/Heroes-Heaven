/*
 * Repair AST nodes whose SOURCE DOC dropped whole printed sections.
 *
 * public/ast/* is regenerated wholesale from the AoN export by `npm run data`, and for these six
 * records the EXPORT's own ast lacks content the printed page carries (the mirror has it; the
 * export's parse dropped it): ashes' Granted/Revelation ladders, bloodline-elemental's whole
 * per-element gifts list, bloodline-imperial's Sorcerous Gifts line, way-of-the-vanguard's deed
 * NAMES, razmiri-mask-porcelain's higher-grade Activates (incl. its own Power of the Living God),
 * whispering-staff's spell list. The AST is the surface DescBody actually renders, so the drop is
 * player-visible even though the plain `.d` was repaired in the residue pass.
 *
 * Content is transplanted from the repaired core-descriptions `.d` (itself restored verbatim from
 * the mirror), appended as paragraph nodes. Idempotent — a node already carrying its probes is
 * skipped — and MUST be re-run after any `npm run data`; scripts/ast-content-check.mjs in
 * `npm run verify` fails if a regen wiped the patches.
 *
 *   node scripts/apply-ast-patches.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// md-ish line -> p node ( **bold** runs + plain text; everything else literal )
const p = (line) => {
  const c = [];
  let rest = line;
  while (rest.length) {
    const m = /\*\*([^*]+)\*\*/.exec(rest);
    if (!m) { c.push({ t: 'text', v: rest }); break; }
    if (m.index > 0) c.push({ t: 'text', v: rest.slice(0, m.index) });
    c.push({ t: 'b', c: [{ t: 'text', v: m[1] }] });
    rest = rest.slice(m.index + m[0].length);
  }
  return { t: 'p', c };
};
const flat = (n) => (!n || typeof n !== 'object') ? '' : n.t === 'text' ? (n.v ?? '') : (n.c ?? []).map(flat).join('');

const descs = JSON.parse(readFileSync(ROOT + '/public/core-descriptions.json', 'utf8'));
const dOf = (cat, id) => descs[cat][id].d;
const lines = (cat, id, from, to) => {
  const t = dOf(cat, id);
  const i = t.indexOf(from);
  const j = to ? t.indexOf(to, i) : t.length;
  if (i < 0 || (to && j < 0)) throw new Error('segment not found ' + cat + '/' + id);
  return t.slice(i, to ? j : undefined).split('\n').map((l) => l.replace(/^-\s+/, '').trim()).filter(Boolean);
};

/* Each patch: the paragraphs to APPEND (content transplanted verbatim from the repaired .d, which
 * was itself restored from the AoN mirror in the residue pass), and probe strings that must be
 * ABSENT before and PRESENT after. */
const PATCHES = [
  { bucket: 'classFeatures', slug: 'ashes',
    add: lines('classFeatures', 'ashes', '**Granted Spells**', '**Related Domains'),
    probes: ['Breathe Fire', 'Disintegrate', 'Revelation Spells'] },
  { bucket: 'classFeatures', slug: 'bloodline-elemental',
    add: lines('classFeatures', 'bloodline-elemental', '- **Air', undefined),
    probes: ['Thunderstrike', 'Chain Lightning'] },
  { bucket: 'classFeatures', slug: 'bloodline-imperial',
    add: lines('classFeatures', 'bloodline-imperial', '**Sorcerous Gifts**', '\n\n**Bloodline Spells'),
    probes: ['Translocate', 'Retrocognition'] },
  { bucket: 'classFeatures', slug: 'way-of-the-vanguard',
    add: ['**Deeds** *Initial* Living Fortification; *Advanced* Spinning Crush; *Greater* Siegebreaker'],
    probes: ['Living Fortification', 'Siegebreaker'] },
  { bucket: 'items', slug: 'razmiri-mask-porcelain',
    add: lines('items', 'razmiri-mask-porcelain', "**Activate—Call Upon Razmir's Mercy**", undefined),
    probes: ['Manifestation', 'Sunburst'] },
  { bucket: 'items', slug: 'whispering-staff',
    add: lines('items', 'whispering-staff', '- **Cantrip** Detect Magic', undefined).slice(0, 7),
    probes: ['Clairvoyance', 'Truesight'] },
];

const byBucket = new Map();
for (const patch of PATCHES) {
  if (!byBucket.has(patch.bucket)) byBucket.set(patch.bucket, JSON.parse(readFileSync(ROOT + '/public/ast/' + patch.bucket + '.json', 'utf8')));
  const ast = byBucket.get(patch.bucket);
  const node = ast[patch.slug];
  const before = flat(node);
  const missing = patch.probes.filter((x) => !before.includes(x));
  if (!missing.length) { console.log('  = ' + patch.slug + ' already carries its probes — skipped'); continue; }
  if (!patch.add.length) { console.log('  ⚠ ' + patch.slug + ' has no lines to add'); continue; }
  node.c.push(...patch.add.map(p));
  const after = flat(node);
  const still = patch.probes.filter((x) => !after.includes(x));
  if (still.length) throw new Error(patch.slug + ' still missing ' + still.join(','));
  console.log('  ✓ ' + patch.bucket + '/' + patch.slug + ' +' + patch.add.length + ' paragraph(s)');
}
for (const [bucket, ast] of byBucket) {
  const json = JSON.stringify(ast);
  writeFileSync(ROOT + '/public/ast/' + bucket + '.json', json);
  writeFileSync(ROOT + '/public/ast/' + bucket + '.json.gz', gzipSync(json, { level: 9 }));
  console.log('wrote', bucket, (json.length / 1e6).toFixed(1) + ' MB');
}
