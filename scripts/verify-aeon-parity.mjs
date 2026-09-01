/*
 * DID WE ACTUALLY DO WHAT WANDERER'S GUIDE DID? — the aeon-stone resonance, checked rather than claimed.
 *
 * Their encoding is a `select` titled *"Is this granting the resonant power?"* with two options, No
 * (no operations) and Yes (a `giveSpell`). Ours is a `wayfinder-slotted` designation the player toggles
 * on the stone, granting the same spell. The QUESTION and the ANSWERS are the same; only the control
 * differs, which is the standing rule of this process — adopt their reading of the rule, re-expressed
 * in our own fields.
 *
 * That claim is only worth anything if it holds for every stone, so this compares the part that IS
 * comparable: for each stone they encode a resonant giveSpell on, do we grant a resonant spell with the
 * same TRADITION, RANK and CASTS? Their spell ids are their own primary keys and cannot be joined, but
 * a tradition/rank/frequency match on all of them is strong corroboration — ours were read
 * independently from the printed text, never from their data.
 *
 *   node scripts/verify-aeon-parity.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8').replace(/^﻿/, ''));
const core = read('public/core.json');
const sql = readFileSync(join(ROOT, 'work/wg/wg-data.sql'), 'utf8');

/* Their rows, by name, for anything called an Aeon Stone. */
const rows = new Map();
for (const line of sql.split(/\r?\n/)) {
  const m = /\t(Aeon Stone \([^)]*\))\t/.exec(line);
  if (!m) continue;
  rows.set(m[1], line.replace(/\\+/g, ''));
}

/*
 * The giveSpell nested inside the resonant select's "Yes" branch.
 *
 * ⚠ BOUNDED TO THE BRANCH. A fixed character window past `"title":"Yes"` overruns into whatever
 * operation follows the select, and reported five stones as carrying a resonant spell grant when their
 * Yes branch is `"operations":[]` — empty. Their `operations` array is brace-matched instead, so the
 * answer comes from the branch itself and nothing else.
 */
function theirResonant(line) {
  const sel = line.indexOf('Is this granting the resonant power?');
  if (sel < 0) return null;
  const yes = line.indexOf('"title":"Yes"', sel);
  if (yes < 0) return null;
  const opsAt = line.indexOf('"operations":[', yes);
  if (opsAt < 0) return null;
  let depth = 0;
  let end = -1;
  for (let i = opsAt + '"operations":'.length; i < line.length; i++) {
    const ch = line[i];
    if (ch === '[') depth++;
    else if (ch === ']') { depth--; if (!depth) { end = i; break; } }
  }
  if (end < 0) return null;
  const branch = line.slice(opsAt, end);
  const gs = /"type":"giveSpell","data":\{([^}]*)\}/.exec(branch);
  if (!gs) return null;
  const f = (k) => { const r = new RegExp(`"${k}":"?([A-Za-z0-9]+)"?`).exec(gs[1]); return r ? r[1] : null; };
  return { tradition: (f('tradition') ?? '').toLowerCase(), rank: f('rank'), casts: f('casts'), type: (f('type') ?? '').toLowerCase() };
}

const agree = [];
const differ = [];
const theyOnly = [];
const weOnly = [];

for (const [id, rec] of Object.entries(core.items ?? {})) {
  const name = String(rec?.name ?? '');
  if (!/^Aeon Stone \(/.test(name)) continue;
  const line = rows.get(name);
  const theirs = line ? theirResonant(line) : null;
  const ours = rec.resonant?.innateSpells?.[0] ?? null;

  if (!theirs && !ours) continue;
  if (theirs && !ours) { theyOnly.push(`${id}: they grant a resonant ${theirs.tradition} spell, we grant none`); continue; }
  if (!theirs && ours) { weOnly.push(`${id}: we grant ${ours.spellId}, their row encodes no resonant spell`); continue; }

  const ourCasts = ours.atWill ? 'atwill' : String(ours.usesPerDay ?? '');
  const theirCasts = theirs.casts === '0' || /at/i.test(theirs.casts ?? '') ? 'atwill' : String(theirs.casts ?? '');
  /*
   * ⚠ A FIELD THEY OMIT IS NOT A DISAGREEMENT. Their giveSpell frequently carries no `tradition` and
   * sometimes no `rank`, while ours has both because the PRINTED TEXT states them ("as an arcane innate
   * spell"). Counting those as differences reported seven false ones and buried the two real gaps.
   * A difference is when both sides state a value and the values differ.
   */
  const clash = (a, b) => !!a && !!b && String(a) !== String(b);
  const same =
    !clash(theirs.tradition, ours.tradition) && !clash(theirs.rank, ours.rank) && !clash(theirCasts, ourCasts);
  (same ? agree : differ).push(
    `${id}: theirs ${theirs.tradition} rank ${theirs.rank ?? '-'} casts ${theirCasts || '-'}  |  ours ${ours.spellId} ${ours.tradition} rank ${ours.rank ?? '-'} casts ${ourCasts || '-'}`,
  );
}

console.log(`${rows.size} aeon stone row(s) on their side.\n`);
console.log(`  AGREE on tradition/rank/casts : ${agree.length}`);
console.log(`  DIFFER                        : ${differ.length}`);
console.log(`  they encode one, we do not    : ${theyOnly.length}`);
console.log(`  we encode one, they do not    : ${weOnly.length}`);

for (const [label, list] of [['DIFFER', differ], ['THEY ONLY', theyOnly], ['WE ONLY', weOnly]]) {
  if (!list.length) continue;
  console.log(`\n--- ${label}`);
  for (const x of list) console.log(`   ${x}`);
}
if (agree.length) {
  console.log('\n--- AGREE (sample)');
  for (const x of agree.slice(0, 6)) console.log(`   ${x}`);
}
