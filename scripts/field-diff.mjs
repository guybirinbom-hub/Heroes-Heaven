/*
 * LEVEL and RARITY, app vs the AoN mirror.
 *
 * The price sweep found 34 real defects in a field nobody had ever compared, so this does the same
 * for the other two the mirror carries structurally and the app actually acts on: a wrong level puts
 * an item in the wrong shop tier, and a wrong rarity changes what a player may take without asking
 * their GM. 43 rarities and 20 levels were wrong.
 *
 * TRAITS are deliberately not compared. Half the records differ there because the two sides spell
 * them differently — AoN folds rarity, tradition and source into the same array — which is a mapping
 * difference, not thousands of bugs.
 *
 * ⚠ THREE TRAPS, each of which produced a wrong "fix" before it was understood:
 *
 *   NAME COLLISIONS. "Death from Above" is a level-16 Mythic feat AND a level-8 uncommon archetype
 *   feat; "Breath of the Dragon" is a level-1 dragonblood ancestry feat and a level-8 archetype one;
 *   "Touch Focus" exists at 14 and at 16. Matching on the name alone picks whichever record the
 *   loader kept. 22 rarity edits and 31 level edits were withdrawn on this rule. A name plus a SOURCE
 *   BOOK is usually an identity, and that recovers most of them.
 *
 *   FAMILY HEADS. A heading of `right="Item 4+"` is a RANGE, and a mirror level of 0 on a graded
 *   family (runes, armour materials, masks) is the family rather than the record.
 *
 *   CANTRIPS. AoN prints "Cantrip 1"; this app stores every cantrip at rank 0 by design.
 *
 *   node scripts/field-diff.mjs             # summary + the unexplained rows
 *   node scripts/field-diff.mjs --all       # also list the ones a guard is holding back
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIRROR = 'C:/wonderers guide/aon-2e-archive/data/by-category';
const db = JSON.parse(readFileSync(join(root, 'public/core.json'), 'utf8'));
const showAll = process.argv.includes('--all');

const norm = (s) => String(s).toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
/** Book names differ in decoration: "Pathfinder Player Core" / "Player Core" / "(Remastered)". */
const book = (s) => norm(String(s ?? '')).replace(/^pathfinder /, '').replace(/ remastered$/, '').replace(/^lost omens /, '').trim();
const RARITIES = ['uncommon', 'rare', 'unique'];

/** The single printed level, or null for a range / a cantrip / no heading. */
const printedLevel = (m) => {
  const md = (m._source && m._source.markdown) || m.markdown || '';
  const t = /right="(Item|Feat|Spell|Cantrip|Focus)\s+(\d+)(\+?)"/i.exec(md);
  if (!t || t[3] === '+' || /cantrip/i.test(t[1])) return null;
  return Number(t[2]);
};

const SETS = [
  ['items', ['equipment', 'weapon', 'armor', 'shield'], (r) => r.level],
  ['feats', ['feat'], (r) => r.level],
  ['spells', ['spell'], (r) => r.rank],
];

let compared = 0;
const unexplained = [];
const held = [];
for (const [coll, dirs, appLevel] of SETS) {
  const byName = new Map();
  for (const d of dirs) {
    let files;
    try { files = readdirSync(join(MIRROR, d)); } catch { continue; }
    for (const f of files) {
      const j = JSON.parse(readFileSync(join(MIRROR, d, f), 'utf8'));
      if (!j.name) continue;
      const k = norm(j.name);
      const list = byName.get(k);
      if (list) list.push(j);
      else byName.set(k, [j]);
    }
  }
  for (const [id, rec] of Object.entries(db[coll] ?? {})) {
    // A legacy / superseded record is SUPPOSED to differ from its remaster mirror entry.
    if (!rec?.name || ['superseded', 'legacy', 'legacy-era'].includes(rec.edition)) continue;
    const list = byName.get(norm(rec.name)) ?? [];
    if (!list.length) continue;
    compared++;

    // Narrow to one mirror record: by source book, then by preferring the remaster half.
    const distinct = new Set(list.map((m) => `${m.level}|${norm(m.rarity ?? 'common')}`));
    let matches = list;
    if (distinct.size > 1) {
      const appBook = book(rec.source?.book);
      matches = appBook ? list.filter((m) => (m.source ?? []).some((s) => book(s) === appBook)) : [];
      if (matches.length > 1 && matches.some((m) => !m.remaster_id)) matches = matches.filter((m) => !m.remaster_id);
      const uniq = new Set(matches.map((m) => `${m.level}|${norm(m.rarity ?? 'common')}`));
      if (!matches.length || uniq.size !== 1) {
        held.push({ coll, id, why: `name answers to ${distinct.size} records and the source book "${appBook}" does not single one out` });
        continue;
      }
    }
    const m = matches[0];

    const wantLevel = printedLevel(m) ?? m.level;
    const haveLevel = appLevel(rec);
    const isCantrip = coll === 'spells' && (rec.traits ?? []).includes('cantrip');
    if (isCantrip) held.push({ coll, id, why: 'cantrip — rank 0 by design here, printed as "Cantrip 1"' });
    else if (wantLevel === 0) held.push({ coll, id, why: 'mirror level 0 — a graded family head, not this record' });
    else if (wantLevel !== haveLevel && m.level === wantLevel) unexplained.push({ coll, id, field: 'level', have: haveLevel, want: wantLevel });

    const traits = (m.trait ?? []).map(norm);
    const wantRarity = RARITIES.find((x) => traits.includes(x)) ?? 'common';
    const haveRarity = norm(rec.rarity ?? 'common');
    // Rarity is printed as a TRAIT, so the mirror's own field must agree with its trait line.
    if (wantRarity !== haveRarity && norm(m.rarity ?? 'common') === wantRarity) {
      unexplained.push({ coll, id, field: 'rarity', have: haveRarity, want: wantRarity });
    }
  }
}

console.log(`compared against the mirror: ${compared} records`);
console.log(`held back by a guard:       ${held.length}`);
if (showAll) for (const h of held) console.log(`   ${h.coll}/${h.id.padEnd(36)} ${h.why}`);
console.log(`\nUNEXPLAINED: ${unexplained.length}`);
for (const u of unexplained) console.log(`   ${u.field.padEnd(7)} ${u.coll}/${u.id.padEnd(34)} app ${JSON.stringify(u.have)} -> mirror ${JSON.stringify(u.want)}`);
if (unexplained.length) process.exitCode = 1;
