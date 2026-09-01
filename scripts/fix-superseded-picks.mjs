/*
 * PICK LISTS THAT OFFER A SUPERSEDED SPELL — repointed to the current printing.
 *
 * The parity read found ONE (Kitsune Spell Familiarity offering Ghost Sound). Asking the same question
 * of every pick list found SEVEN, offering twelve superseded spells between them: a player choosing any
 * of those came away casting the legacy version — Acid Splash's single-target spell attack instead of
 * Caustic Blast's burst, and so on.
 *
 * ⚠ THE SUCCESSOR IS READ FROM THE MIRROR, NOT GUESSED. Each legacy AoN page carries `remaster_id`
 * naming the record that replaced it (spell-3 → spell-1461 Caustic Blast, spell-132 → spell-1528
 * Figment, spell-245 → spell-1539 Frostbite). Our own corpus records `edition: 'superseded'` but NOT
 * the successor, so a rename table typed by hand here would be three guesses that happen to look right.
 * A legacy spell whose page names no successor is REPORTED and left alone.
 *
 *   node scripts/fix-superseded-picks.mjs           # report
 *   node scripts/fix-superseded-picks.mjs --write
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIRROR = 'C:/wonderers guide/aon-2e-archive/data/by-category/spell';
const WRITE = process.argv.includes('--write');
const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8'));
const FILE = join(ROOT, 'src/rules/featCantripGrants.ts');

if (!existsSync(MIRROR)) { console.error(`no spell mirror at ${MIRROR}`); process.exit(2); }

/** our spell id -> the current printing's id, via the mirror's own remaster_id pointer. */
const byAon = new Map(Object.entries(core.spells).map(([id, s]) => [String(s.aonId ?? ''), id]));
function successorOf(spellId) {
  const aon = String(core.spells[spellId]?.aonId ?? '');
  if (!aon) return null;
  let page;
  try { page = JSON.parse(readFileSync(join(MIRROR, `${aon}.json`), 'utf8')); } catch { return null; }
  const to = [].concat(page.remaster_id ?? [])[0];
  if (!to) return null;
  const ours = byAon.get(String(to));
  if (!ours) return null;
  if (core.spells[ours]?.edition === 'superseded') return null; // chain to another legacy record — refuse
  return ours;
}

let src = readFileSync(FILE, 'utf8');
const changes = [];
const refused = [];

for (const m of [...src.matchAll(/^(\s*'([a-z0-9-]+)':\s*\{[^\n]*options:\s*\[)([^\]]*)(\])/gm)]) {
  const [full, head, id, body, tail] = m;
  let changed = false;
  const next = body.replace(/'([a-z0-9-]+)'/g, (whole, sid) => {
    const s = core.spells[sid];
    if (!s) { refused.push(`${id}: ${sid} is not in core.spells`); return whole; }
    if (s.edition !== 'superseded') return whole;
    const to = successorOf(sid);
    if (!to) { refused.push(`${id}: ${sid} is superseded and its page names no usable successor`); return whole; }
    changes.push(`${id}: ${sid} -> ${to}`);
    changed = true;
    return `'${to}'`;
  });
  if (changed) src = src.replace(full, head + next + tail);
}

/* A list may now name the same spell twice — the legacy and current forms can both have been present. */
src = src.replace(/^(\s*'[a-z0-9-]+':\s*\{[^\n]*options:\s*\[)([^\]]*)(\])/gm, (whole, head, body, tail) => {
  const ids = [...body.matchAll(/'([a-z0-9-]+)'/g)].map((x) => x[1]);
  const uniq = [...new Set(ids)];
  if (uniq.length === ids.length) return whole;
  return head + uniq.map((x) => `'${x}'`).join(', ') + tail;
});

console.log(`${changes.length} pick option(s) repointed:`);
for (const c of changes) console.log(`   ${c}`);
if (refused.length) {
  console.log(`\n${refused.length} left alone (no usable successor):`);
  for (const r of refused) console.log(`   ${r}`);
}
if (!changes.length) process.exit(0);
if (!WRITE) { console.log('\n(report only — pass --write)'); process.exit(0); }
writeFileSync(FILE, src);
console.log('\nwrote src/rules/featCantripGrants.ts');
