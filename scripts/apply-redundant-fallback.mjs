/*
 * AUTHOR `redundantFallback` ON EVERY GRANT WHOSE TEXT PRINTS THE CLAUSE.
 *
 *   node scripts/apply-redundant-fallback.mjs [--dry]
 *
 * A large family of feats prints some form of "if you would already be trained in <skill>, you instead
 * become trained in a skill of your choice". The app expresses that with one boolean on the record's
 * FEAT_SKILL_GRANTS entry; without it, the grant collides with training the character already has and
 * the player silently loses a skill the feat owed them. The audit found six by reading six feats.
 *
 * The set comes from scripts/scan-redundant-fallback.mjs, which is anchored on the OUTCOME phrase
 * ("trained in a skill of your choice") rather than on the condition. The condition is written half a
 * dozen ways — "if you were already trained in Crafting", "if you're already trained in Society", "If
 * you would automatically become trained in one of those skills (from your background or class, for
 * example)" — and a detector aimed at it found 34 records when 72 already carried the flag, i.e. it
 * missed most of them. The outcome is near-invariant because it IS the mechanic.
 *
 * ⚠ "you become an EXPERT instead" is deliberately excluded. Same sentence shape, different mechanic:
 * an upgrade of the same skill (conditionalSkills / conditionalRank), not a fallback to a different
 * one. Matching on the word "instead" would have authored the wrong lane onto those records.
 *
 * ⚠ SAFE ONLY BECAUSE the serialiser in scripts/aon-verify/apply-reviewed.ts is now lossless. Until it
 * was fixed it emitted four keys and dropped the rest, so the next run of it would have deleted every
 * flag this script writes — all 72 that already existed, and all of these.
 *
 * src/rules/featGrantsAuto.ts is hand-authored: its header names an extractor that does not exist on
 * disk, so this edits the file in place rather than regenerating it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { FEAT_SKILL_GRANTS } from '../src/rules/featGrantsAuto.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');
const fail = (m) => { console.error('REFUSED: ' + m); process.exit(1); };

const desc = JSON.parse(readFileSync(join(root, 'public/core-descriptions.json'), 'utf8'));
const core = JSON.parse(readFileSync(join(root, 'public/core.json'), 'utf8'));
const textOf = (id) =>
  String(core.feats?.[id]?.description ?? desc.feats?.[id]?.d ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ');

const OUTCOME = /(?:instead become trained in|become trained in) (?:a|another) skill of your choice|(?:or )?another skill of your choice,? if you(?:'re| are| were) already trained/i;
const UPGRADE_NOT_FALLBACK = /you become an expert instead/i;

const targets = Object.entries(FEAT_SKILL_GRANTS)
  .filter(([, g]) => !g.redundantFallback)
  .map(([id]) => id)
  .filter((id) => { const t = textOf(id); return !!t && OUTCOME.test(t) && !UPGRADE_NOT_FALLBACK.test(t); });

if (!targets.length) { console.log('nothing to do — every grant printing the clause already carries the flag'); process.exit(0); }

const PATH = 'src/rules/featGrantsAuto.ts';
let src = readFileSync(join(root, PATH), 'utf8');
const before = src.length;
let done = 0;

for (const id of targets) {
  /* One entry per line: `  'id': { … },`. Anchored on the quoted id at line start so a substring of
   * another id can never match, and asserted unique so a duplicated entry is a refusal, not a coin flip. */
  const re = new RegExp(`^(  '${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}': \\{)(.*)(\\},)$`, 'gm');
  const hits = src.match(re);
  if (!hits) fail(`${id}: no entry line found in ${PATH} — is it on more than one line?`);
  if (hits.length !== 1) fail(`${id}: ${hits.length} entry lines, expected exactly 1`);
  if (hits[0].includes('redundantFallback')) continue;
  /* The COMMA is the whole trick. `{ skills: {…} redundantFallback: true }` is a syntax error, and the
   * first version of this script produced exactly that on all 84 lines. The body always ends in a
   * space before the closing brace, so trim it, add `, ` and re-space. */
  src = src.replace(re, (_m, head, body, tail) => `${head}${body.replace(/\s*$/, '')}, redundantFallback: true ${tail}`);
  done++;
}

/* PARSE WHAT WAS PRODUCED before writing it. A malformed line here breaks the whole app's build, and
 * "it looked right" is not a check — the first version of this script emitted 84 syntax errors and the
 * only reason it was caught is that a later command happened to import the file. */
const bodies = [...src.matchAll(/^  '[^']+': (\{.*\}),$/gm)].map((m) => m[1]);
if (bodies.length < 300) fail(`only ${bodies.length} entry lines parsed out — the file shape changed, refusing to write`);
for (const b of bodies) {
  try { (0, eval)(`(${b})`); } catch (e) { fail(`produced an unparseable entry: ${b}\n  ${e.message}`); }
}

if (DRY) { console.log(`--dry: ${done} of ${targets.length} entries would gain the flag; nothing written`); process.exit(0); }
writeFileSync(join(root, PATH), src);
console.log(`${done} entries gained redundantFallback (${PATH}, ${before} -> ${src.length} bytes)`);
console.log('verify: npx jiti scripts/scan-redundant-fallback.mjs');
