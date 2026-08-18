import { FEAT_SITUATIONAL, RECORD_MARKERS } from '../../src/rules/situationalBonuses.ts';
import { readFileSync, writeFileSync } from 'node:fs';
const core = JSON.parse(readFileSync('public/core.json', 'utf8'));
const structured = new Set();
for (const b of ['feats','classFeatures','heritages','ancestries','backgrounds','items'])
  for (const [id, r] of Object.entries(core[b] ?? {})) if (r?.degreeShifts?.length) structured.add(id);
const RE = /(critical success instead|becomes a critical success|is a critical success|is a failure instead|becomes a failure instead|critical failure is a failure|is a success instead|one degree of success|one degree better|success → crit|success -> crit|crit fail → fail|crit fail -> fail)/i;
const rows = [];
for (const [id, list] of Object.entries(FEAT_SITUATIONAL)) {
  if (!structured.has(id)) continue;
  list.forEach((b, i) => { if (RE.test(`${b.when} ${b.bonus}`)) rows.push({ reg: 'SB', id, i, n: list.length, when: b.when, bonus: b.bonus }); });
}
for (const [id, list] of Object.entries(RECORD_MARKERS)) {
  if (!structured.has(id)) continue;
  list.forEach((m, i) => { if (RE.test(`${m.value ?? ''} ${m.note ?? ''}`)) rows.push({ reg: 'MK', id, i, n: list.length, value: m.value, note: m.note }); });
}
writeFileSync('work/round9/offenders.json', JSON.stringify(rows, null, 1));
console.log(rows.length);
for (const r of rows) console.log(`${r.reg} ${r.id} [${r.i}/${r.n}] ${r.reg === 'SB' ? `WHEN=${r.when} || BONUS=${r.bonus}` : `VAL=${r.value} || NOTE=${r.note}`}`);
