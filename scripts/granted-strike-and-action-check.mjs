/*
 * GUARD: TWO WAYS A GRANTED THING ARRIVES BROKEN.
 *
 * 1. A GRANTED STRIKE NAMED AFTER A TEMPLATE. Venom Spit shipped a Strike literally called
 *    "StrikeLabel" — an unsubstituted Foundry placeholder that a leshy read on their own sheet. Wild
 *    Witch's Armaments had the same name, and under it two wrong fields (bludgeoning in the brawling
 *    group where the text prints piercing quills in the dart group), which is the real cost of a name
 *    nobody can sanity-check: it hides whatever else came through with it.
 *
 * 2. A FEAT WEARING THE COST OF THE ACTION IT GRANTS. *"You gain the Steady Balance skill feat … and
 *    you can use the Anchor action."* Anchoring Roots stored Anchor's 1-action cost as its own and did
 *    not grant Anchor at all, so the sentence delivered nothing and charged an action for it.
 *
 *    ⚠ This is deliberately NOT the bare-badge inference. An empty AoN badge is also what a page looks
 *    like when the scrape lost the glyph, and that direction is not evidence — see the action-cost
 *    guard. What this checks is narrower and self-evidencing: the feat's own text names an action that
 *    exists as its own record with its own cost, the feat stores a cost too, and it does not grant it.
 *    Ten other feats of the same shape DO grant their action; only the non-granting ones are flagged.
 *
 *   node scripts/granted-strike-and-action-check.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8').replace(/^﻿/, ''));
const core = read('public/core.json');
const descs = read('public/core-descriptions.json');

const bad = [];

/* 1 — a granted strike whose name is a placeholder rather than a weapon. */
const TEMPLATE_NAME = /^(?:strikelabel|strike label|label)$|[{}@\[\]]|^\s*$/i;
for (const bucket of Object.keys(core)) {
  for (const [id, rec] of Object.entries(core[bucket] ?? {})) {
    for (const s of rec?.grantedStrikes ?? []) {
      if (TEMPLATE_NAME.test(String(s?.name ?? ''))) bad.push(`${bucket}/${id} — granted strike named ${JSON.stringify(s?.name)}, a template placeholder`);
    }
  }
}

/* 2 — a feat wearing the cost of an action it names but never grants. */
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
for (const [id, rec] of Object.entries(core.feats ?? {})) {
  if (rec?.actionCost?.type !== 'actions') continue;
  const d = String(descs.feats?.[id]?.d ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  // "granting you the X action" is how the ostilli pages phrase it — same claim, third shape.
  const m = /\b(?:you (?:can use|gain)|granting you) the ([A-Z][A-Za-z' ]{2,28}?) (?:action|activity)\b/.exec(d);
  if (!m) continue;
  const target = slug(m[1]);
  if (!core.actions?.[target] || (rec.grantsActions ?? []).includes(target)) continue;
  bad.push(`feats/${id} — stores ${rec.actionCost.value} action(s) and names the "${m[1]}" action, but never grants it`);
}

/*
 * 3 — A STRIKE GIVEN A WEAPON GROUP ITS OWN TEXT DENIES.
 *
 * Hooded Nagaji and Venom Spit both print *"Your spit doesn't have a weapon group or a critical
 * specialization effect"* and both shipped `group: 'brawling'` — not a cosmetic label, because
 * critSpecWeapons matches on group, so the brawling critical specialization was reachable on an
 * attack the book says has none. Wanderer's Guide agrees with the book here (the item both of their
 * records hand out carries category `unarmed_attack` and no weapon group), so this was ours
 * diverging from the text AND from theirs at the same time.
 *
 * Evidence runs one way only: it fires when the record's own text DENIES a group and the record sets
 * one. Text that simply does not mention a group says nothing either way and is never flagged.
 */
const DENIES_GROUP = /(?:does\s?n[o’']t have|has no|lacks)\s+a\s+weapon\s+group|\bno weapon group\b/i;
for (const bucket of Object.keys(core)) {
  for (const [id, rec] of Object.entries(core[bucket] ?? {})) {
    const strikes = [...(rec?.grantedStrikes ?? []), ...(rec?.strikes ?? [])];
    if (!strikes.some((s) => s?.group)) continue;
    const d = String(rec?.description ?? descs[bucket]?.[id]?.d ?? '').replace(/<[^>]+>/g, ' ');
    if (!DENIES_GROUP.test(d)) continue;
    const named = strikes.filter((s) => s?.group).map((s) => `${s.name}=${s.group}`).join(', ');
    bad.push(`${bucket}/${id} — its text says the attack has no weapon group, but it sets one (${named})`);
  }
}

if (!bad.length) {
  console.log('granted-strike-and-action: ok — no placeholder names, no feat wearing a granted action’s cost, no group the text denies');
  process.exit(0);
}
console.log(`granted-strike-and-action: FAIL — ${bad.length} record(s):\n`);
for (const b of bad) console.log(`   ${b}`);
process.exit(1);
