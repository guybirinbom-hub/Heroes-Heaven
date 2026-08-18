// Scan the situational registries for degree-of-success prose (the ~60-70 duplicates the brief warns
// about). Read through jiti so we see the real objects rather than re-parsing TypeScript by regex.
import { FEAT_SITUATIONAL, RECORD_MARKERS, CHOICE_SITUATIONAL } from '../../src/rules/situationalBonuses.ts';
import { writeFileSync } from 'node:fs';

const RE = /critical success instead|a success instead|a failure instead|critical failure instead|one degree|degree of success|success → |success -> |crit fail|becomes a critical success|is a critical success|counts as (a )?failure|count as failures/i;

const rows = [];
for (const [id, list] of Object.entries(FEAT_SITUATIONAL)) {
  for (const [i, b] of list.entries()) {
    const text = `${b.when} | ${b.bonus}`;
    if (RE.test(text)) rows.push({ reg: 'FEAT_SITUATIONAL', id, i, when: b.when, bonus: b.bonus, targets: b.targets });
  }
}
for (const [id, list] of Object.entries(RECORD_MARKERS)) {
  for (const [i, mk] of list.entries()) {
    const text = `${mk.value ?? ''} | ${mk.note ?? ''}`;
    if (RE.test(text)) rows.push({ reg: 'RECORD_MARKERS', id, i, on: mk.on, mkId: mk.id, value: mk.value, note: mk.note });
  }
}
for (const [id, list] of Object.entries(CHOICE_SITUATIONAL)) {
  for (const [i, b] of list.entries()) {
    const text = `${b.when ?? ''} | ${b.bonus ?? ''}`;
    if (RE.test(text)) rows.push({ reg: 'CHOICE_SITUATIONAL', id, i, ...b });
  }
}
writeFileSync(new URL('./prose-degree.json', import.meta.url), JSON.stringify(rows, null, 1));
console.log('total', rows.length);
const byReg = {};
for (const r of rows) byReg[r.reg] = (byReg[r.reg] ?? 0) + 1;
console.log(byReg);
console.log('distinct ids', new Set(rows.map((r) => r.id)).size);
