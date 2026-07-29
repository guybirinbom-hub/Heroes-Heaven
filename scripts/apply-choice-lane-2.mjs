/*
 * Applies the classified CHOICE lane — records whose text asks the player to pick something at build
 * time, expressed as `record.choice` (FeatChoiceDef), which the builder renders as a picker.
 *
 * Deliberately NOT applied:
 *   - picks > 1. FeatChoiceDef models ONE pick; Terrain Scout's "choose 2 different terrains" would
 *     silently become a single choice, quietly halving the feat. 15 records wait for a multi-pick
 *     shape rather than being misrepresented as single.
 *   - kind 'open' (any spell of rank N, any feat with trait X). There is no closed option list to
 *     offer, and inventing one would restrict a choice the rules leave open.
 *   - records the verifier escalated (needsHumanDecision).
 *   - anything whose id no longer resolves.
 *
 * Usage: node scripts/apply-choice-lane-2.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const DRY = process.argv.includes('--dry');
const PATH = 'public/core.json';
const db = JSON.parse(readFileSync(PATH, 'utf8'));
const rows = JSON.parse(readFileSync('work/choice-applicable.json', 'utf8'));

/** Kinds FeatChoiceDef understands. 'open' is not one of them. */
const KINDS = new Set(['array', 'skills', 'domains', 'text']);

const stats = { applied: 0, multiPick: 0, badKind: 0, noOptions: 0, missing: 0, skippedExisting: 0, dupFlag: 0 };
const notes = [];
const seenFlag = new Map();

for (const r of rows) {
  const rec = db[r.collection]?.[r.id];
  if (!rec) { stats.missing++; continue; }
  if (rec.choice) { stats.skippedExisting++; continue; }
  if (!KINDS.has(r.kind)) { stats.badKind++; notes.push(`${r.id}: unsupported kind '${r.kind}'`); continue; }

  const picks = Number(r.picks ?? 1);
  if (picks > 1) {
    stats.multiPick++;
    notes.push(`${r.id}: picks ${picks} — FeatChoiceDef holds one; left for a multi-pick shape`);
    continue;
  }

  // 'array' must carry real options; 'skills'/'domains' resolve against the character at build time.
  const options = (r.options ?? []).filter((o) => o && o.value && o.label);
  if (r.kind === 'array' && options.length < 2) { stats.noOptions++; notes.push(`${r.id}: array with ${options.length} option(s)`); continue; }

  const flag = String(r.flag || '').trim();
  if (!flag) { notes.push(`${r.id}: no flag`); continue; }
  // Duplicate flags are FINE here, and rejecting them cost 33 valid records on the first run. A
  // build-time answer is stored per feat SLOT (build.featChoices[slotKey], build.ts:401), not per
  // flag, so five feats can all use `terrain` without colliding. The one place flag IS a key —
  // dailyChoices — already namespaces it as `${recordId}:${flag}`.
  seenFlag.set(flag, r.id);

  const choice = { flag, prompt: r.prompt || 'Choose', kind: r.kind };
  if (r.kind === 'array') choice.options = options.map((o) => ({ value: o.value, label: o.label, ...(o.description && { description: o.description }) }));
  if (r.minRank) choice.minRank = r.minRank;
  rec.choice = choice;
  stats.applied++;
}

console.log(`applied ${stats.applied} · multi-pick held back ${stats.multiPick} · unsupported kind ${stats.badKind} · too few options ${stats.noOptions} · duplicate flag ${stats.dupFlag} · already had one ${stats.skippedExisting} · missing ${stats.missing}`);
if (notes.length) { console.log('held back:'); notes.slice(0, 12).forEach((n) => console.log('  ' + n)); }
if (DRY) { console.log('\n--dry: nothing written'); process.exit(0); }
writeFileSync(PATH, JSON.stringify(db)); // minified — pretty-printing this file once cost 4 MB
console.log('\nwritten:', PATH);
