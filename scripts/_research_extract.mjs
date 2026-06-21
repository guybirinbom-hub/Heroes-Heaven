import { readFileSync } from 'node:fs';
const OUT = 'C:/Users/r2g2/AppData/Local/Temp/claude/C--wonderers-guide/7a776b20-8b57-47a0-b6b1-2ce87e35f54f/tasks/wyhrdq1s2.output';
const raw = readFileSync(OUT, 'utf8');
function findTopics(o, depth = 0) {
  if (!o || typeof o !== 'object' || depth > 6) return null;
  if (Array.isArray(o.topics)) return o.topics;
  for (const k of Object.keys(o)) { const r = findTopics(o[k], depth + 1); if (r) return r; }
  return null;
}
const data = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
const topics = findTopics(data) || [];
for (const t of topics) {
  console.log('\n========================================');
  console.log('TOPIC:', t.topic);
  console.log('exists:', t.exists, '| modelable:', t.modelable, '| confidence:', t.confidence, '| verified:', t.verified);
  console.log('SUMMARY:', t.summary);
  console.log('--- DATA ---');
  console.log(t.data);
  if (t.corrections) console.log('--- CORRECTIONS ---\n' + t.corrections);
  console.log('SOURCES:', (t.sources || []).join(' | '));
}
