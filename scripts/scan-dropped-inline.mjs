/*
 * HOW MANY RECORDS LOST AN INLINE VALUE, BY CLASS.
 *
 * Agonizing Rebuke surfaced a dropped damage formula. Heart of the Kaiju then showed the same upstream
 * cleaner drops MORE than damage: our text reads *"Each creature in a takes damage … with a save"*
 * where the Archives print *"in a 60-foot cone takes 15d6 damage … with a basic Reflex save"*. Three
 * inline constructs, one cause. This measures each class before anything is repaired.
 *
 *   node scripts/scan-dropped-inline.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, ''));
const descs = read(join(ROOT, 'public/core-descriptions.json'));

/* Each holed phrasing, with an example of what the Archives print in its place. */
const CLASSES = [
  ['damage formula', /\btakes?\s+damage\b|\bregains?\s+Hit Points\b/i, 'takes 15d6 damage'],
  ['area template', /\bin an?\s+(?:takes?|must|is|are|you|each|that|,)\b|\bwithin an?\s+(?:takes?|must|is|are)\b/i, 'in a 60-foot cone'],
  ['save / check', /\bwith an?\s+(?:against|save against|DC)\b|\battempts? an?\s+(?:against|save)\b|\bmakes? an?\s+against\b/i, 'with a basic Reflex save'],
];

const counts = new Map(CLASSES.map(([n]) => [n, []]));
for (const bucket of Object.keys(descs)) {
  for (const [id, entry] of Object.entries(descs[bucket] ?? {})) {
    const d = String(entry?.d ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
    if (!d) continue;
    for (const [name, re] of CLASSES) if (re.test(d)) counts.get(name).push(`${bucket}/${id}`);
  }
}

for (const [name, , example] of CLASSES) {
  const hits = counts.get(name);
  console.log(`${String(hits.length).padStart(5)}  ${name.padEnd(16)} (Archives print e.g. "${example}")`);
  for (const h of hits.slice(0, 4)) console.log(`         ${h}`);
}
const all = new Set([...counts.values()].flat());
console.log(`\n${all.size} distinct record(s) affected by at least one class.`);
