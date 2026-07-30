// Builds the per-record input the B and C extraction agents read: id, name, the PRINTED text, and
// whatever flat bonus the record currently carries. Nothing is summarised — the agents must decide
// from the text, so the text goes in whole.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const core = JSON.parse(readFileSync(path.join(ROOT, 'public/core.json'), 'utf8'));
const axes = JSON.parse(readFileSync(path.join(ROOT, 'work/escalation-axes.json'), 'utf8'));

const strip = (html) =>
  String(html ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const pack = (list) =>
  list.map((r) => {
    const rec = core[r.collection][r.id];
    return {
      id: r.id,
      collection: r.collection,
      name: rec.name,
      level: rec.level,
      traits: rec.traits ?? [],
      // The whole printed text. Truncating it is how a restriction gets lost.
      text: strip(rec.description).slice(0, 4000),
      currentFlat: rec.passiveEffects ?? null,
      openQuestion: r.q,
    };
  });

mkdirSync(path.join(ROOT, 'work/abc'), { recursive: true });
const B = pack(axes['B. flat vs situational']);
const C = pack(axes['C. which skill(s)']);
writeFileSync(path.join(ROOT, 'work/abc/B.json'), JSON.stringify(B, null, 1));
writeFileSync(path.join(ROOT, 'work/abc/C.json'), JSON.stringify(C, null, 1));

// Chunked so each agent gets a readable slice rather than one wall of text.
const chunk = (arr, n) => {
  const out = [];
  const size = Math.ceil(arr.length / n);
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};
chunk(B, 3).forEach((c, i) => writeFileSync(path.join(ROOT, `work/abc/B${i}.json`), JSON.stringify(c, null, 1)));
chunk(C, 3).forEach((c, i) => writeFileSync(path.join(ROOT, `work/abc/C${i}.json`), JSON.stringify(c, null, 1)));

console.log(`B: ${B.length} records (${B.filter((r) => r.currentFlat).length} carry a flat bonus)`);
console.log(`C: ${C.length} records (${C.filter((r) => r.currentFlat).length} carry a flat bonus)`);
console.log(`empty text — B: ${B.filter((r) => !r.text).map((r) => r.id).join(', ') || 'none'}`);
console.log(`empty text — C: ${C.filter((r) => !r.text).map((r) => r.id).join(', ') || 'none'}`);
