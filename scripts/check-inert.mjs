// Confirms the records the owner ruled "no effect" really do grant nothing anywhere.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const s = readFileSync(path.join(ROOT, 'src/rules/situationalBonuses.ts'), 'utf8');
const core = JSON.parse(readFileSync(path.join(ROOT, 'public/core.json'), 'utf8'));

for (const id of ['bombers-eye-elixir-lesser', 'bombers-eye-elixir-greater', 'execution-powder', 'weapon-innovation']) {
  const q = `"${id}": [`;
  const inRegistry = s.includes(`\n  ${q}`);
  const modes = Object.keys(core.modes).filter((k) => k === `item-${id}` || k === `feat-${id}`);
  const rec = core.items[id] ?? core.feats[id] ?? core.classFeatures[id];
  console.log(
    id.padEnd(28),
    'registry:', String(inRegistry).padEnd(5),
    '| modes:', modes.length,
    '| passiveEffects:', !!rec?.passiveEffects,
    '| situational field:', !!rec?.situational,
  );
}
