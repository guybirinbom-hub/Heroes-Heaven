/*
 * MEASURE (not a guard): does the owner's Speed ruling have hits in the OTHER numeric lanes?
 *
 * The ruling was about Speed — *"we give an actual speed only when it's always; if it is dependent on
 * something it's in a *"* — but the principle is about a NUMBER standing where the text states a
 * condition. The Speed guard found 4 real defects out of 5 candidates. This asks the same question of
 * resistances, weaknesses, AC and HP before any guard is written, because a guard built on an
 * unmeasured hunch is how false positives get institutionalised here.
 *
 *   node scripts/measure-conditional-values.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8').replace(/^﻿/, ''));
const core = read('public/core.json');
const descs = read('public/core-descriptions.json');

/* Gates a condition rather than varying an amount — same split the Speed guard settled on. */
const GATE = /\b(while|whenever|when you(?:'re| are)?|as long as|during|until the (?:start|end)|for \d+ (?:round|minute|hour)|in your favored)\b/i;
const VARIES = /\bif you (?:already|have|had)\b/i;

/* field -> the words whose sentence is evidence about THAT field. */
const LANES = [
  ['resistances', /\bresistance\b/i],
  ['weaknesses', /\bweakness\b/i],
  ['acBonus', /\bbonus to (?:your )?AC\b/i],
  ['maxHpBonus', /\bHit Points\b/i],
  ['unarmoredAc', /\bbonus to (?:your )?AC\b/i],
];

for (const [field, word] of LANES) {
  const hits = [];
  for (const bucket of Object.keys(core)) {
    for (const [id, rec] of Object.entries(core[bucket] ?? {})) {
      if (!rec || typeof rec !== 'object' || rec[field] == null) continue;
      const v = rec[field];
      if (Array.isArray(v) ? !v.length : typeof v === 'object' && !Object.keys(v).length) continue;
      const text = String(descs[bucket]?.[id]?.d ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      if (!text) continue;
      const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => word.test(s));
      const gated = sentences.filter((s) => GATE.test(s) && !VARIES.test(s));
      if (gated.length && !sentences.some((s) => !GATE.test(s))) hits.push({ bucket, id, s: gated[0].trim().slice(0, 150) });
    }
  }
  console.log(`\n=== ${field}: ${hits.length} record(s) hold a value where EVERY matching sentence is gated`);
  for (const h of hits.slice(0, 12)) console.log(`   ${h.bucket}/${h.id}\n      ${h.s}`);
  if (hits.length > 12) console.log(`   … and ${hits.length - 12} more`);
}
