// Read-only: what the A/B/C ruling records look like RIGHT NOW, before anything is changed.
// Nothing here is planned from memory — each number is measured.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const core = JSON.parse(readFileSync(path.join(ROOT, 'public/core.json'), 'utf8'));
const src = readFileSync(path.join(ROOT, 'src/rules/situationalBonuses.ts'), 'utf8');
const axes = JSON.parse(readFileSync(path.join(ROOT, 'work/escalation-axes.json'), 'utf8'));

const registryIds = new Set([...src.matchAll(/^\s*"([a-z0-9-]+)": \[/gm)].map((m) => m[1]));
const entryOf = (id) => {
  const i = src.indexOf(`\n  "${id}": [`);
  if (i < 0) return null;
  return src.slice(i + 1, src.indexOf('\n', i + 1));
};

for (const [key, label] of [['A. umbrella records', 'A'], ['B. flat vs situational', 'B'], ['C. which skill(s)', 'C']]) {
  const list = axes[key];
  const inReg = list.filter((r) => registryIds.has(r.id));
  const notInCore = list.filter((r) => !core[r.collection]?.[r.id]);
  const withPassive = list.filter((r) => core[r.collection]?.[r.id]?.passiveEffects);
  console.log(`\n=== ${label} (${list.length}) — in registry: ${inReg.length}, has passiveEffects: ${withPassive.length}, not in core: ${notInCore.length}`);
  if (notInCore.length) console.log('   MISSING:', notInCore.map((r) => `${r.collection}/${r.id}`).join(', '));
  if (label === 'B') {
    for (const r of withPassive) {
      console.log(`   ${r.id}: ${JSON.stringify(core[r.collection][r.id].passiveEffects)}`);
    }
  }
  if (label === 'C') {
    for (const r of inReg.slice(0, 30)) console.log('   ' + entryOf(r.id)?.trim().slice(0, 190));
  }
  if (label === 'A') {
    for (const r of inReg) console.log('   IN REGISTRY: ' + entryOf(r.id)?.trim().slice(0, 160));
  }
}

// ---- The umbrella TEST from the ruling: no price, and a graded twin at the same base name. ----
const GRADES = /-(lesser|moderate|greater|major|true)$/;
const items = Object.entries(core.items);
const byId = new Map(items);
const umbrella = [];
for (const [id, it] of items) {
  if (GRADES.test(id)) continue;
  const graded = ['lesser', 'moderate', 'greater', 'major', 'true'].filter((g) => byId.has(`${id}-${g}`));
  if (graded.length < 2) continue;          // one twin could be a genuine base + upgrade
  if (it.price && Object.values(it.price).some(Boolean)) continue; // priced ⇒ you can actually buy it
  umbrella.push({ id, name: it.name, grades: graded.length, level: it.level });
}
console.log(`\n=== umbrella items by the ruling's test (no price + 2+ graded twins): ${umbrella.length}`);
for (const u of umbrella.slice(0, 25)) console.log(`   ${u.id} (${u.grades} grades)`);
if (umbrella.length > 25) console.log(`   … ${umbrella.length - 25} more`);

// How many of the A list this test actually catches, and what it misses.
const aIds = new Set(axes['A. umbrella records'].map((r) => r.id));
const caught = umbrella.filter((u) => aIds.has(u.id)).map((u) => u.id);
console.log(`\n   of the 24 A records, this test catches ${caught.length}: ${caught.join(', ')}`);
console.log(`   A records the test MISSES: ${[...aIds].filter((id) => !umbrella.some((u) => u.id === id)).join(', ')}`);
