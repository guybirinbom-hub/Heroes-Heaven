/*
 * THE FIFTEEN RESISTANCE POTIONS GRANTED NOTHING WHEN DRUNK.
 *
 * *"Drinking this thick, fortifying potion grants resistance 15 against cold damage for 1 hour."* The
 * whole family — acid, cold, electricity, fire and sonic, in lesser/moderate/greater — shipped with no
 * consumable mode, so drinking one moved no number on the sheet and the resistance existed only in the
 * item's prose. Fifteen items, and the single most ordinary thing a potion can do.
 *
 * Found in batch 1's value gate: their side asserts a `resistances` set and ours held nothing. The
 * three grades are 5 / 10 / 15 and every one lasts an hour, so the modes are generated from each item's
 * own printed sentence rather than typed out — fifteen hand-copied numbers is fifteen chances to be
 * wrong, and the sentence is right there.
 *
 * ⚠ The printed word is "electrical damage"; the DAMAGE TYPE is `electricity`. Writing what the
 * sentence says would produce a resistance to a type no damage in the game has.
 *
 *   node scripts/backfill-resistance-potions.mjs           # report
 *   node scripts/backfill-resistance-potions.mjs --write
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8').replace(/^﻿/, ''));

const core = read('public/core.json');
const descs = read('public/core-descriptions.json');
const MODES_PATH = join(ROOT, 'scripts/data/consumable-modes.json');
const modes = read('scripts/data/consumable-modes.json');

/** The sentence says "electrical"; the damage type is `electricity`. */
const TYPE = { electrical: 'electricity' };

const made = [];
for (const [id, item] of Object.entries(core.items ?? {})) {
  if (!/^potion-of-[a-z]+-resistance-(lesser|moderate|greater)$/.test(id)) continue;
  const text = String(descs.items?.[id]?.d ?? '').replace(/\s+/g, ' ');
  const m = /resistance (\d+) (?:against|to) ([a-z]+) damage for ([^.]+?)\./i.exec(text);
  if (!m) { console.error(`${id}: could not read its own resistance sentence`); process.exit(2); }
  const value = Number(m[1]);
  const type = TYPE[m[2].toLowerCase()] ?? m[2].toLowerCase();
  const duration = m[3].trim();
  made.push({
    id: `item-${id}`,
    name: `${type.charAt(0).toUpperCase() + type.slice(1)} Resistance ${value}`,
    fromItemId: id,
    duration,
    modifiers: [],
    resistances: [{ type, value }],
    note: `${item.name}: resistance ${value} to ${type} damage for ${duration}.`,
  });
}

if (made.length !== 15) { console.error(`expected 15 resistance potions, built ${made.length}`); process.exit(2); }

const have = new Set(modes.map((m) => m.id));
const added = made.filter((m) => !have.has(m.id));
console.log(`${made.length} resistance potion(s); ${added.length} without a mode today.`);
for (const m of made) console.log(`  ${m.fromItemId.padEnd(42)} ${m.resistances[0].type} ${m.resistances[0].value} for ${m.duration}`);

if (!WRITE) { console.log('\n(report only — pass --write to author)'); process.exit(0); }

/* Replace by id so a re-run is idempotent — a backfill script gets re-run whenever any row in it
 * changes, and one that appends would duplicate every entry each time. */
const next = [...modes.filter((m) => !made.some((x) => x.id === m.id)), ...made].sort((a, b) => a.id.localeCompare(b.id));
/* Matches the file as it is on disk: 1-space indent, LF, trailing newline. A writer that "tidies" the
 * formatting turns a 15-entry change into a 250-entry diff nobody can review. */
writeFileSync(MODES_PATH, `${JSON.stringify(next, null, 1)}\n`, 'utf8');
console.log(`\nwrote ${next.length} consumable mode(s).`);
