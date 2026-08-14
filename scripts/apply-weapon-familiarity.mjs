/*
 * AUTHOR THE CATEGORY-REMAP CLAUSE ON THE ANCESTRY WEAPON-FAMILIARITY FEATS.
 *
 *   node scripts/apply-weapon-familiarity.mjs [--dry]
 *
 * These print:
 *
 *   "You have familiarity with weapons with the dwarf trait plus the battle axe, pick, and warhammer —
 *    for the purposes of proficiency, you treat any of these that are martial weapons as simple
 *    weapons and any that are advanced weapons as martial weapons."
 *
 * That is a REMAP, and it is worth real numbers: a fighter is Legendary in martial and Expert in
 * simple, so a martial ancestry weapon treated as simple is +2 to hit over leaving it alone, and the
 * gap widens with level. 31 of these records carried no weapon grant at all, so the clause reached the
 * sheet in no form whatsoever.
 *
 * THE LIST ALREADY EXISTS. Each record carries `critSpecWeapons: { traits, bases }` — the same two
 * halves the sentence prints — used for critical specialisation and nothing else. This derives the
 * familiarity clause from it rather than re-transcribing 31 weapon lists by hand, so the two can never
 * disagree about which weapons the feat covers.
 *
 * ⚠ Requires the engine half landed alongside it: `treatAsLowerCategory` used to be computed only on
 * the chosen-weapon path, so on a static list it did nothing, and `WeaponFamiliarity.traits` did not
 * exist. Without both, this data is inert.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { FEAT_GRANTS } from '../src/rules/featGrants.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');
const fail = (m) => { console.error('REFUSED: ' + m); process.exit(1); };

const core = JSON.parse(readFileSync(join(root, 'public/core.json'), 'utf8'));
const desc = JSON.parse(readFileSync(join(root, 'public/core-descriptions.json'), 'utf8'));
const textOf = (id) =>
  String(core.feats?.[id]?.description ?? desc.feats?.[id]?.d ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ');

const REMAP = /\btreat[^.]{0,200}?\bas (?:simple|martial) weapons?\b/i;
const EXPERTISE_FOLLOW = /whenever you gain a class feature that grants you expert or greater proficiency/i;
/** The two-step form. Its absence means the sentence only demotes martial→simple. */
const TWO_STEP = /advanced weapons? as martial weapons?/i;

const remapSentence = (id) => {
  const s = textOf(id).split(/(?<=\.)\s+/).find((x) => REMAP.test(x));
  if (!s || EXPERTISE_FOLLOW.test(s) || !/proficien/i.test(s)) return null;
  return s;
};

const targets = [];
for (const [id, rec] of Object.entries(core.feats ?? {})) {
  const sentence = remapSentence(id);
  if (!sentence) continue;
  const existing = FEAT_GRANTS?.[id]?.weaponFamiliarity;
  if (existing) continue; // already authored — the flattened ones are a separate, per-record judgement
  const cw = rec.critSpecWeapons;
  if (!cw || (!cw.bases?.length && !cw.traits?.length)) continue; // no list to derive from
  targets.push({ id, bases: cw.bases ?? [], traits: cw.traits ?? [], twoStep: TWO_STEP.test(sentence), sentence });
}

if (!targets.length) { console.log('nothing to author'); process.exit(0); }

/* Emitted into featGrants.ts's hand-authored map. `treatAsLowerCategory` says the demotion in the
 * engine's own words; a per-record `mirrorCategory` would have to guess which category each weapon is
 * and would be wrong for any list mixing martial and advanced. */
const lines = targets.map((t) => {
  const parts = [`weapons: [${t.bases.map((b) => `'${b}'`).join(', ')}]`];
  if (t.traits.length) parts.push(`traits: [${t.traits.map((x) => `'${x}'`).join(', ')}]`);
  parts.push('treatAsLowerCategory: true');
  return `  '${t.id}': { weaponFamiliarity: { ${parts.join(', ')} } },`;
});

const PATH = 'src/rules/featGrantsLane.ts';
let src;
try { src = readFileSync(join(root, PATH), 'utf8'); } catch { fail(`${PATH} not found — say where these should live`); }

const MARK = '/* ── ancestry weapon familiarity: the category remap ─────────────────────────────────────── */';
if (src.includes(MARK)) fail('already applied — remove the block first if you mean to regenerate it');

const anchor = src.lastIndexOf('};');
if (anchor < 0) fail(`could not find the end of the exported map in ${PATH}`);

const block = [
  '',
  MARK,
  '  /* Derived from each record\'s own `critSpecWeapons` by scripts/apply-weapon-familiarity.mjs, so the',
  '   * weapons this feat covers and the weapons it crit-specialises can never disagree. The printed',
  '   * clause is "treat any of these that are martial weapons as simple weapons and any that are',
  '   * advanced weapons as martial weapons" — per-weapon, which is what `treatAsLowerCategory` says. */',
  ...lines,
].join('\n');

src = src.slice(0, anchor) + block + '\n' + src.slice(anchor);

// Parse what was produced before writing it — 84 syntax errors were emitted this way once already.
for (const l of lines) {
  const body = /: (\{.*\}),$/.exec(l)?.[1];
  try { (0, eval)(`(${body})`); } catch (e) { fail(`unparseable line:\n  ${l}\n  ${e.message}`); }
}

if (DRY) {
  console.log(`--dry: ${targets.length} records would gain the clause. First three:\n`);
  for (const l of lines.slice(0, 3)) console.log('  ' + l);
  console.log(`\n  two-step (advanced→martial too): ${targets.filter((t) => t.twoStep).length}`);
  process.exit(0);
}
writeFileSync(join(root, PATH), src);
console.log(`${targets.length} records gained the category remap (${PATH})`);
console.log('verify: npx jiti scripts/scan-weapon-familiarity.mjs');
