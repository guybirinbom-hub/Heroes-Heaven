/*
 * WHICH FEATS PRINT THE "TREAT AS ONE CATEGORY SIMPLER" CLAUSE, AND WHICH ONES DELIVER IT.
 *
 *   node scripts/scan-weapon-familiarity.mjs           # counts, by how the record is authored
 *   node scripts/scan-weapon-familiarity.mjs --list    # every id in every bucket
 *
 * A large family of ancestry and archetype feats prints:
 *
 *   "…you treat <weapons> as martial weapons for the purpose of determining your proficiency."
 *
 * That is a REMAP, not a grant of "trained". It matters at every level where the character's simple
 * proficiency has outrun their martial: a fighter is Legendary in martial and Expert in simple, so
 * remapping an advanced weapon to martial is worth up to +4 to hit compared with flattening it to
 * "trained". The engine says it with `weaponFamiliarity.mirrorCategory`.
 *
 * THREE WAYS TO GET THIS WRONG, and the scan separates them, because they need different fixes:
 *   · remapped   — correct.
 *   · flattened  — a weapon grant exists but says `rank: 'trained'`. Under-delivers, silently, and
 *                  worse the higher the character's level.
 *   · no grant   — the record carries critical-specialisation or nothing at all, so the clause does
 *                  not reach the sheet in any form.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { FEAT_GRANTS } from '../src/rules/featGrants.ts';
import { FEAT_SKILL_GRANTS } from '../src/rules/featGrantsAuto.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIST = process.argv.includes('--list');
const desc = JSON.parse(readFileSync(join(root, 'public/core-descriptions.json'), 'utf8'));
const core = JSON.parse(readFileSync(join(root, 'public/core.json'), 'utf8'));

const textOf = (id) =>
  String(core.feats?.[id]?.description ?? desc.feats?.[id]?.d ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ');

/*
 * ANCHORED ON THE OUTCOME — "treat … as simple/martial weapons" inside a sentence about proficiency.
 *
 * A first attempt required "for the purposes of determining your proficiency" and found 6. The actual
 * printed phrase puts the clauses the other way round — "for the purposes of proficiency, you treat any
 * of these that are martial weapons as simple weapons" — and varies ("for the purpose of", "when
 * determining", none at all). The outcome does not vary, because it IS the mechanic.
 *
 * ⚠ NOT THE SAME CLAUSE, and excluded: "whenever you gain a class feature that grants you expert or
 * greater proficiency … you also gain that proficiency in <weapons>". That is the weapon-EXPERTISE
 * follow-up feat — the rank tracks your class's, which the same `weaponFamiliarity` field expresses a
 * different way. Two mechanics share one field; only the remap belongs in this scan.
 */
const REMAP = /\btreat[^.]{0,200}?\bas (?:simple|martial) weapons?\b/i;
const EXPERTISE_FOLLOW = /whenever you gain a class feature that grants you expert or greater proficiency/i;
const prints = (t) => {
  const sentence = t.split(/(?<=\.)\s+/).find((s) => REMAP.test(s));
  if (!sentence) return false;
  if (EXPERTISE_FOLLOW.test(sentence)) return false;
  return /proficien/i.test(sentence);
};

const famOf = (id) => {
  const g = FEAT_GRANTS?.[id];
  const raw = g?.weaponFamiliarity ?? FEAT_SKILL_GRANTS?.[id]?.weaponFamiliarity;
  if (!raw) return null;
  return Array.isArray(raw) ? raw : [raw];
};

const remapped = [];
const flattened = [];
const noGrant = [];
for (const id of Object.keys(core.feats ?? {})) {
  const t = textOf(id);
  if (!t || !prints(t)) continue;
  const fam = famOf(id);
  if (!fam) { noGrant.push(id); continue; }
  if (fam.some((f) => f.mirrorCategory || f.mirrorBestCategory || f.treatAsLowerCategory)) remapped.push(id);
  else flattened.push(id);
}

const total = remapped.length + flattened.length + noGrant.length;
console.log(`feats printing the category-remap clause   ${total}`);
console.log(`  remapped (correct)                       ${remapped.length}`);
console.log(`  FLATTENED to a plain rank                ${flattened.length}   <- under-delivers, worse at high level`);
console.log(`  NO weapon grant at all                   ${noGrant.length}   <- the clause never reaches the sheet`);

const show = (name, ids) => {
  if (!ids.length) return;
  console.log(`\n${name}:`);
  for (const id of LIST ? ids : ids.slice(0, 10)) console.log(`  ${id}`);
  if (!LIST && ids.length > 10) console.log(`  …and ${ids.length - 10} more (--list)`);
};
show('FLATTENED', flattened);
show('NO GRANT', noGrant);

export function audit() {
  return { remapped, flattened, noGrant };
}
