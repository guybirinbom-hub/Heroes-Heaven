/*
 * THE REMAINING CATEGORY-REMAP RECORDS — the archetype dedications, authored one at a time.
 *
 *   node scripts/apply-weapon-familiarity-2.mjs [--dry]
 *
 * scripts/apply-weapon-familiarity.mjs closed the 25 ancestry feats by DERIVING their weapon lists
 * from the `critSpecWeapons` those records already carried. These have no such list — they name weapon
 * GROUPS, or one or two specific weapons — so each is transcribed from its printed sentence, and every
 * weapon id and group name is checked against the item data before anything is written. A typo here
 * authors a proficiency for a weapon that does not exist, silently.
 *
 * ⚠ TWO-STEP vs ONE-STEP MATTERS. "treat any of these that are martial weapons as simple weapons AND
 * ANY THAT ARE ADVANCED WEAPONS AS MARTIAL WEAPONS" is two clauses; some records print only the first
 * half. Authoring the second half where the text does not print it hands the player a rank they were
 * never given. Each entry below records which form its sentence uses.
 *
 * ⚠ `treatAsLowerCategory` demotes per WEAPON and only works on a named `weapons` list. A GROUP clause
 * is stored as one rule with one rank, so a group that needs both steps is TWO clauses narrowed by
 * `category` — the shape Explosive Savant already uses.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { FEAT_GRANTS } from '../src/rules/featGrants.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');
const fail = (m) => { console.error('REFUSED: ' + m); process.exit(1); };
const core = JSON.parse(readFileSync(join(root, 'public/core.json'), 'utf8'));

const ENTRIES = {
  /* "For the purposes of proficiency, treat any of these that are martial weapons as simple weapons
   * and any that are advanced weapons as martial weapons." Two-step over the two groups its own
   * critSpecWeapons already names. */
  'archer-dedication': [
    { weapons: [], groups: ['bow', 'crossbow'], category: 'martial', mirrorCategory: 'simple' },
    { weapons: [], groups: ['bow', 'crossbow'], category: 'advanced', mirrorCategory: 'martial' },
  ],
  /* "You have familiarity with weapons in the polearm and spear weapon groups — … martial as simple
   * and advanced as martial." Two-step, two groups. */
  'avenging-runelord-dedication': [
    { weapons: [], groups: ['polearm', 'spear'], category: 'martial', mirrorCategory: 'simple' },
    { weapons: [], groups: ['polearm', 'spear'], category: 'advanced', mirrorCategory: 'martial' },
  ],
  /* "You have familiarity with Aldori dueling swords, treating them as MARTIAL weapons." One named
   * weapon, and the target category is martial, not simple — it is an advanced weapon. */
  'aldori-duelist-dedication': { weapons: ['aldori-dueling-sword'], mirrorCategory: 'martial' },
  /* "…the Asp Coil and Scourge, treating them as simple weapons." */
  'sister-of-the-golden-erinys-dedication': { weapons: ['asp-coil', 'scourge'], mirrorCategory: 'simple' },
  /* ONE-STEP: "you treat any of these that are martial weapons as simple weapons" — no advanced clause,
   * and the sentence names five weapons with no trait half, so no `traits` here either. All five are
   * martial or simple, so the per-weapon demotion says exactly what the sentence says.
   * Replaces `rank: 'trained'`, which flattened a fighter's master to trained. */
  'centaur-weapon-familiarity': { weapons: ['lance', 'longbow', 'longspear', 'shortbow', 'spear'], treatAsLowerCategory: true },
  /* Two-step, named weapons. Also replaces a flattening `rank: 'trained'`. */
  'aquatic-elf-warrior': {
    weapons: ['crossbow', 'heavy-crossbow', 'dagger', 'longspear', 'spear', 'trident'],
    treatAsLowerCategory: true,
  },
};

/* NOT AUTHORED, deliberately — each needs a reading I am not confident enough to write:
 *   gunslinger-dedication   "martial crossbows and firearms" — does "martial" distribute over both, or
 *                           only over crossbows? The two readings differ by every advanced firearm.
 *   bullet-dancer-dedication  names "martial combination weapons"; there is no verified group for
 *                           combination weapons, so the set cannot be expressed without guessing. */

const groups = new Set();
for (const it of Object.values(core.items ?? {})) if (it?.itemType === 'weapon' && it.group) groups.add(it.group);

for (const [id, clause] of Object.entries(ENTRIES)) {
  if (!core.feats?.[id]) fail(`${id} is not in core.json`);
  for (const c of Array.isArray(clause) ? clause : [clause]) {
    for (const w of c.weapons ?? []) {
      const it = core.items?.[w];
      if (!it) fail(`${id}: no item "${w}"`);
      if (it.itemType !== 'weapon') fail(`${id}: "${w}" is a ${it.itemType}, not a weapon`);
    }
    for (const g of c.groups ?? []) if (!groups.has(g)) fail(`${id}: no weapon group "${g}" — known: ${[...groups].sort().join(', ')}`);
  }
}
console.log(`${Object.keys(ENTRIES).length} records: every weapon id and group verified against the item data`);

const lit = (v) => {
  if (Array.isArray(v)) return `[${v.map(lit).join(', ')}]`;
  if (v && typeof v === 'object') return `{ ${Object.entries(v).map(([k, x]) => `${k}: ${lit(x)}`).join(', ')} }`;
  return typeof v === 'string' ? `'${v}'` : JSON.stringify(v);
};
const lines = Object.entries(ENTRIES).map(([id, clause]) => `  '${id}': { weaponFamiliarity: ${lit(clause)} },`);
for (const l of lines) {
  const body = /: (\{.*\}),$/.exec(l)?.[1];
  try { (0, eval)(`(${body})`); } catch (e) { fail(`unparseable:\n  ${l}\n  ${e.message}`); }
}

const PATH = 'src/rules/featGrantsLane.ts';
let src = readFileSync(join(root, PATH), 'utf8');
const MARK = '/* ── archetype weapon familiarity: the category remap ──────────────────────────────────── */';
if (src.includes(MARK)) fail('already applied');

/* centaur and aquatic-elf-warrior are already authored elsewhere with a flattening `rank: trained`.
 * A second entry for the same id would be shadowed by whichever the object literal defines last, so
 * the old ones are removed rather than left to fight. */
const AUTO = 'src/rules/featGrantsAuto.ts';
let auto = readFileSync(join(root, AUTO), 'utf8');
let autoTouched = false;
for (const id of ['centaur-weapon-familiarity', 'aquatic-elf-warrior']) {
  if (!FEAT_GRANTS?.[id]?.weaponFamiliarity) continue;
  // ⚠ \r? on both ends: featGrantsAuto.ts is CRLF, so `$` alone never matches its line ends.
  const re = new RegExp(`^  '${id}': \\{ weaponFamiliarity:.*\\},\\r?\\n`, 'm');
  if (re.test(src)) { src = src.replace(re, ''); console.log(`  removed the flattening entry for ${id} from ${PATH}`); continue; }
  if (re.test(auto)) {
    auto = auto.replace(re, '');
    autoTouched = true;
    console.log(`  removed the flattening entry for ${id} from ${AUTO}`);
    continue;
  }
  fail(`${id} carries a weaponFamiliarity this script cannot find in ${PATH} or ${AUTO} — remove it by hand first`);
}

const anchor = src.lastIndexOf('};');
if (anchor < 0) fail(`could not find the end of the map in ${PATH}`);
src = src.slice(0, anchor) + ['', MARK, ...lines].join('\n') + '\n' + src.slice(anchor);

if (DRY) { console.log('\n--dry, would write:\n' + lines.join('\n')); process.exit(0); }
writeFileSync(join(root, PATH), src);
if (autoTouched) writeFileSync(join(root, AUTO), auto);
console.log(`written: ${PATH}${autoTouched ? `, ${AUTO}` : ''}`);
console.log('verify: npm run scan:weapons');
