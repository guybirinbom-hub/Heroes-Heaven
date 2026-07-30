/*
 * THE ONE ENGINE GAP: a granted feat's own sub-choice is only reachable when the GRANTING feat was
 * picked in a feat slot.
 *
 * Builder.tsx renders it from `FEAT_FEAT_GRANTS[picked]` — so Seeker of Truths → Domain Initiate works,
 * because Seeker of Truths occupies a slot. A feat granted by a BACKGROUND, an ITEM or a CLASS FEATURE
 * never becomes `picked`, so its choice has no picker anywhere: Abadar's Avenger grants "Assurance with
 * Religion" and the sheet shows a bare "Assurance" that cannot say which skill.
 *
 * This counts every record whose granted feat carries a choice, by granting source — the exact set one
 * engine fix would cover without authoring a single row of data.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const core = JSON.parse(readFileSync(path.join(ROOT, 'public/core.json'), 'utf8'));

const choiceOf = (featId) => core.feats?.[featId]?.choice;
const rows = { backgrounds: [], items: [], classFeatures: [], feats: [], heritages: [], ancestries: [] };

/** Every way a record hands the character another feat. */
function grantedFeatIds(rec) {
  const out = [];
  if (rec.grantedFeatId) out.push(rec.grantedFeatId);
  for (const g of rec.grantsFeats ?? []) out.push(typeof g === 'string' ? g : g?.featId);
  for (const g of rec.grants?.feats ?? []) out.push(typeof g === 'string' ? g : g?.featId);
  return out.filter(Boolean);
}

for (const bucket of Object.keys(rows)) {
  for (const [id, rec] of Object.entries(core[bucket] ?? {})) {
    for (const gid of grantedFeatIds(rec)) {
      const ch = choiceOf(gid);
      if (!ch) continue;
      rows[bucket].push({ id, name: rec.name, granted: gid, grantedName: core.feats[gid]?.name, prompt: ch.prompt, kind: ch.kind });
    }
  }
}

console.log('Records whose GRANTED feat carries a choice the player must make:\n');
let total = 0;
for (const [bucket, list] of Object.entries(rows)) {
  if (!list.length) continue;
  total += list.length;
  console.log(`  ${bucket.padEnd(16)} ${String(list.length).padStart(4)}`);
  for (const r of list.slice(0, 6)) console.log(`      ${r.id} → ${r.grantedName} (${r.kind}: ${r.prompt ?? 'no prompt'})`);
  if (list.length > 6) console.log(`      … ${list.length - 6} more`);
}
console.log(`\n${total} records total.`);
console.log(
  '\nOf these, only the `feats` rows are reachable today (Builder walks FEAT_FEAT_GRANTS[picked]).\n' +
  `The other ${total - rows.feats.length} have a pick the builder never offers — one engine fix covers all of them.`,
);
