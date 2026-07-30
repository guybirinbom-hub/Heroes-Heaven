// Input for the D/F/G/H extraction: id, name, the PRINTED text, and the open question each record
// was escalated with. Nothing summarised — the agents decide from the text.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const core = JSON.parse(readFileSync(path.join(ROOT, 'public/core.json'), 'utf8'));
const axes = JSON.parse(readFileSync(path.join(ROOT, 'work/escalation-axes.json'), 'utf8'));
const consum = JSON.parse(readFileSync(path.join(ROOT, 'work/consumable-modes-raw.json'), 'utf8'));

const strip = (h) =>
  String(h ?? '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();

const pack = (list) =>
  list
    .map((r) => {
      const rec = core[r.collection]?.[r.id];
      if (!rec) return { id: r.id, collection: r.collection, missing: true, openQuestion: r.q };
      return {
        id: r.id,
        collection: r.collection,
        name: rec.name,
        level: rec.level,
        traits: rec.traits ?? [],
        text: strip(rec.description).slice(0, 4500),
        currentFlat: rec.passiveEffects ?? null,
        openQuestion: r.q,
      };
    })
    .filter((r) => !r.missing);

mkdirSync(path.join(ROOT, 'work/dfgh'), { recursive: true });
const out = (name, data) => writeFileSync(path.join(ROOT, `work/dfgh/${name}.json`), JSON.stringify(data, null, 1));

const D = pack(axes['D. no target kind exists']);
const F = pack(axes['F. ally / not-yours']);
const GH = pack([...axes['G. where the marker lives'], ...axes['H. wording / verbosity']]);

// The consumables the E pass classified as landing on someone else. Ruling F governs them: nothing on
// your sheet, but a display-only mode on the activator if it runs for a stated time.
const NOT_YOURS = consum.notYours.map((r) => {
  const rec = core.items[r.id];
  return {
    id: r.id,
    collection: 'items',
    name: rec?.name ?? r.id,
    level: rec?.level,
    text: strip(rec?.description).slice(0, 4000),
    whyNotYours: r.reason,
  };
});

out('D', D);
out('F', F);
out('GH', GH);
out('notYours', NOT_YOURS);

const half = (arr) => [arr.slice(0, Math.ceil(arr.length / 2)), arr.slice(Math.ceil(arr.length / 2))];
half(D).forEach((c, i) => out(`D${i}`, c));
half([...F, ...NOT_YOURS]).forEach((c, i) => out(`F${i}`, c));

console.log(`D: ${D.length}  F: ${F.length}  GH: ${GH.length}  notYours: ${NOT_YOURS.length}`);
console.log(`chunks: D0/D1, F0/F1 (F + notYours interleaved), GH`);
