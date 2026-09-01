/*
 * GUARD: A SPEED IS A REAL NUMBER ONLY WHEN IT IS ALWAYS ON. OTHERWISE IT IS A STAR.
 *
 * Owner ruling 2026-08-22, verbatim: *"we give an actual speed only when it's always, if it is
 * dependent on something it's in a *"*. Two lanes, and putting a clause in the wrong one is a real
 * defect in either direction:
 *
 *   `speeds`      — an unconditional grant. Summiting Dragonblood: *"You gain a climb Speed of 20
 *                   feet"*. The number joins the sheet's Speed row and is true at all times.
 *   `situational` — a gated grant. Favored Terrain: *"while in your favored terrain … you gain a swim
 *                   Speed equal to your Speed"*. It stars the Speed row and states its own condition;
 *                   it must NEVER move the number, or a 1st-level ranger walks around with a
 *                   permanent swim Speed — which is exactly the shape Wanderer's Guide ships.
 *   `speedsIf`    — the middle case: gated on OWNING something (a feat), so it is permanent once the
 *                   character has it. Legitimately a number.
 *
 * FAILS when a record carries a `speeds` number and its printed text gates that Speed behind a
 * circumstance. Records already read and confirmed unconditional are settled below with their reason,
 * so this guard is silent until a NEW record arrives in the wrong lane.
 *
 *   node scripts/conditional-speed-check.mjs            # guard
 *   node scripts/conditional-speed-check.mjs --list     # every candidate with its sentence
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIST = process.argv.includes('--list');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8').replace(/^﻿/, ''));
const core = read('public/core.json');
const descs = read('public/core-descriptions.json');

/*
 * Settled: read against the printed text and confirmed to belong in `speeds`. The reason is the part
 * that matters — a bare id list would let a wrong call hide behind a name.
 */
const SETTLED = {
  /* *"You gain a climb Speed of 20 feet; IF YOU ALREADY HAVE a base climb Speed, it increases by 5
   * feet."* The `if` varies the amount, it does not gate the grant — every character with the feat has
   * a climb Speed at all times. This is the shape the naive reading gets wrong, so it is the control. */
  'summiting-dragonblood': 'the "if" varies the amount (20, or +5 on an existing climb Speed); the grant itself is unconditional',
};

/* A clause that GATES rather than varies. "if you already"/"if you have" describe a permanent state. */
const GATE = /\b(while|whenever|when you(?:'re| are)?|as long as|during|until the (?:start|end)|in your favored|for \d+ (?:round|minute|hour))\b/i;
const VARIES = /\bif you (?:already|have|had)\b/i;

const candidates = [];
for (const bucket of Object.keys(core)) {
  for (const [id, rec] of Object.entries(core[bucket] ?? {})) {
    if (!rec || typeof rec !== 'object' || !rec.speeds) continue;
    const text = String(descs[bucket]?.[id]?.d ?? '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ');
    if (!text) continue;
    /* The sentence that grants the Speed — only that one is evidence about this field. */
    const sentences = text.split(/(?<=[.!?])\s+/);
    const granting = sentences.filter((s) => /\bSpeed\b/.test(s) && /\b(gain|gains|have a|has a|increase)\b/i.test(s));
    if (!granting.length) continue;
    const gated = granting.filter((s) => GATE.test(s) && !VARIES.test(s));
    if (!gated.length) continue;
    candidates.push({ bucket, id, sentence: gated[0].trim().slice(0, 200) });
  }
}

if (LIST) {
  console.log(`${candidates.length} record(s) carry a \`speeds\` number with a gated printed clause:\n`);
  for (const c of candidates) {
    console.log(`  ${c.bucket}/${c.id}${SETTLED[c.id] ? '   [settled]' : ''}`);
    console.log(`     ${c.sentence}`);
  }
  process.exit(0);
}

const bad = candidates.filter((c) => !SETTLED[c.id]);
console.log(`${candidates.length} record(s) grant a Speed behind a printed condition; ${Object.keys(SETTLED).length} settled.`);
if (!bad.length) {
  console.log('conditional-speed: ok — no unconditional number stands where the text gates it.');
  process.exit(0);
}
console.log(`\nconditional-speed: FAIL — ${bad.length} record(s) hold a REAL Speed for a GATED clause.`);
console.log('Move each to `situational` (a star that states its condition) or settle it here with a reason:\n');
for (const c of bad) {
  console.log(`   ${c.bucket}/${c.id}`);
  console.log(`      ${c.sentence}`);
}
process.exit(1);
