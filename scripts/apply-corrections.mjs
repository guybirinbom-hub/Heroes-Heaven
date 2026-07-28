/*
 * Applies the corrected bonus lists produced from the verifier's disputed-record pass.
 *
 * These 283 records were withheld from the first apply on purpose: an independent verifier disputed
 * the classifier's reading of each, so shipping them unrevised would have shipped a known-wrong
 * bonus. This script merges the corrected versions into the generated block of
 * src/rules/situationalBonuses.ts.
 *
 * Input: work/situational-lane/patches.json — [{ id, action, bonuses, reason }]
 *   action 'replace'  → ship these bonuses (the FULL list for the record)
 *   action 'drop'     → the record grants no conditional bonus, or is already applied elsewhere
 *   action 'escalate' → still needs the owner; parked in escalations, never shipped
 *
 * Usage: node scripts/apply-corrections.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const DRY = process.argv.includes('--dry');
const REGISTRY = 'src/rules/situationalBonuses.ts';
const PATCHES = 'work/situational-lane/patches.json';

/** Must match SituationalTarget.kind in the registry — a patch aimed anywhere else can't be stored. */
const KINDS = new Set([
  'skill', 'save', 'perception', 'ac', 'attack', 'strikeAttack',
  'strikeDamage', 'speed', 'hp', 'classDc', 'spell', 'ability',
]);
/** Kinds that carry no `detail`; a stray one would be silently ignored by the matcher. */
const NO_DETAIL = new Set(['perception', 'ac', 'speed', 'hp', 'classDc', 'strikeAttack', 'strikeDamage', 'attack']);

const patches = JSON.parse(readFileSync(PATCHES, 'utf8'));
const src = readFileSync(REGISTRY, 'utf8');

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\s+/g, ' ').trim();

const stats = { replaced: 0, dropped: 0, escalated: 0, badKind: 0, empty: 0 };
const rejected = [];
const entries = [];

for (const p of patches) {
  if (p.action === 'drop') { stats.dropped++; continue; }
  if (p.action === 'escalate') { stats.escalated++; continue; }
  const list = (p.bonuses ?? []).filter((b) => {
    if (!KINDS.has(b.targetKind)) { rejected.push(`${p.id}: unknown kind '${b.targetKind}'`); stats.badKind++; return false; }
    if (!b.bonus || !b.when) { rejected.push(`${p.id}: missing bonus/when`); return false; }
    return true;
  });
  if (!list.length) { stats.empty++; continue; }

  const targets = list.map((b) => {
    const detail = NO_DETAIL.has(b.targetKind) ? undefined : (b.detail || (b.targetKind === 'save' || b.targetKind === 'skill' ? 'all' : undefined));
    const t = detail ? `{ kind: '${b.targetKind}', detail: '${esc(detail)}' }` : `{ kind: '${b.targetKind}' }`;
    return `{ targets: [${t}], when: "${esc(b.when)}", bonus: "${esc(b.bonus)}" }`;
  });
  entries.push(`  "${p.id}": [${targets.join(', ')}],`);
  stats.replaced++;
}

// A corrected record may already sit in the generated block from the first apply (it shouldn't — they
// were excluded — but a re-run must not duplicate a key). Drop any prior line for these ids first.
const ids = new Set(entries.map((e) => e.match(/^ {2}"([^"]+)"/)[1]));
const kept = src.split('\n').filter((line) => {
  const m = line.match(/^ {2}"([a-z0-9-]+)":\s\[/);
  return !(m && ids.has(m[1]));
});

const banner =
  `\n  // ---- corrected records (verifier-disputed readings, revised) ----\n` +
  `  // ${stats.replaced} records. ${stats.dropped} dropped as not-situational/already-modelled,\n` +
  `  // ${stats.escalated} still escalated to the owner and deliberately NOT shipped.\n`;

const out = kept.join('\n');
const close = out.lastIndexOf('\n};');
if (close < 0) throw new Error('registry: could not find the object literal close');
const next = out.slice(0, close) + banner + entries.join('\n') + out.slice(close);

console.log(`replace ${stats.replaced} · drop ${stats.dropped} · escalate ${stats.escalated} · empty ${stats.empty} · bad-kind ${stats.badKind}`);
if (rejected.length) {
  console.log(`REJECTED ${rejected.length} bonus rows:`);
  rejected.slice(0, 12).forEach((r) => console.log('  ' + r));
}
if (DRY) { console.log('\n--dry: nothing written'); process.exit(0); }
writeFileSync(REGISTRY, next);
console.log('\nwritten:', REGISTRY);
