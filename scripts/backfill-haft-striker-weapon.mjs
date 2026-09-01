/*
 * THE HAFT IS A SIMPLE WEAPON, NOT AN UNARMED ATTACK (stances/haft-striker-stance).
 *
 * *"You treat the haft of your wielded weapon as a simple weapon dealing 1d4 damage. The haft is in
 * the club group and has the agile and finesse traits."*
 *
 * Every stance Strike in the corpus was unarmed, so deriveStrikes forced the `unarmed` trait onto all
 * of them, rolled them at unarmed proficiency and buffed them with Handwraps of Mighty Blows. The haft
 * is the one that is not unarmed, and it inherited all three: a simple weapon rolling at unarmed
 * proficiency with handwraps applied.
 *
 * Wanderer's Guide agrees with the book here — the item their feat hands out is category `simple`,
 * group `club`, damage 1d4 bludgeoning, traits agile + finesse, and carries no rune inheritance of its
 * own. So this is not a case where the two authorities disagree and the owner has to rule; ours simply
 * differed from both, and matching the text also matches them.
 *
 * ⚠ WHAT IS DELIBERATELY NOT BUILT. *"The haft shares any fundamental runes attached to the main
 * weapon"* stays prose on the record's `note`. Their side does not implement it either (their haft
 * item ships potency 0 / striking 0 with no inheritance), and the standing rule is to encode what they
 * encode. Building rune inheritance here would be us diverging in the other direction.
 *
 *   node scripts/backfill-haft-striker-weapon.mjs [--write]
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8').replace(/^﻿/, ''));

const stance = core.stances?.['haft-striker-stance'];
if (!stance) { console.error('stances/haft-striker-stance is missing'); process.exit(2); }

const strikes = stance.strikes ?? [];
if (!strikes.length) { console.error('the stance has no strikes to correct'); process.exit(2); }

/* Drop `unarmed` from the traits and name the category. The group stays `club`, which the text states
 * outright — unlike the venomous spit, whose text denies it a group. */
const next = strikes.map((s) => ({
  ...s,
  traits: (s.traits ?? []).filter((t) => t !== 'unarmed'),
  weaponCategory: 'simple',
}));

console.log('before:', JSON.stringify(strikes));
console.log('after :', JSON.stringify(next));

if (!WRITE) { console.log('\n(report only — pass --write)'); process.exit(0); }
const rows = readBackfill(ROOT);
const row = { category: 'stances', id: 'haft-striker-stance', field: 'strikes', value: next };
const at = rows.findIndex((r) => r.category === row.category && r.id === row.id && r.field === row.field);
if (at >= 0) rows[at] = row; else rows.push(row);
writeBackfill(ROOT, rows);
console.log(`\nwrote (${rows.length} rows).`);
