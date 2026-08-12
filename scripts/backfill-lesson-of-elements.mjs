/*
 * Witch Lesson of the Elements reached nothing, through a one-character id mismatch.
 *
 * `choiceOwnedFeatureIds` resolves a lesson pick by trying the raw value and then stripping the
 * importer's `aon-` prefix. Every option is `aon-lesson-of-<x>` and every record is `lesson-of-<x>`,
 * so 18 of the 19 resolve. This one's option says `aon-lesson-of-the-elements` and the record is
 * `lesson-of-elements` — no "the" — so the pick owned no feature and granted no hex.
 *
 * Verified before writing: the other 18 resolve, this one does not.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { formatBackfill } from './lib/write-backfill.mjs';

const CORE = 'public/core.json';
const BACKFILL = 'scripts/data/effect-backfill.json';
const WRONG = 'aon-lesson-of-the-elements';
const RIGHT = 'aon-lesson-of-elements';

const core = JSON.parse(readFileSync(CORE, 'utf8'));
if (!core.classFeatures['lesson-of-elements']) {
  console.error('lesson-of-elements is not a class feature — refusing to write.');
  process.exit(1);
}
if (core.classFeatures['lesson-of-the-elements']) {
  console.error('lesson-of-the-elements EXISTS — the option was right and the record is the odd one. Refusing.');
  process.exit(1);
}

const entries = [];
let fixed = 0;
for (const id of ['basic-lesson', 'greater-lesson', 'major-lesson']) {
  const def = core.feats[id]?.choice;
  if (!def?.options?.some((o) => o.value === WRONG)) continue;
  const next = { ...def, options: def.options.map((o) => (o.value === WRONG ? { ...o, value: RIGHT } : o)) };
  core.feats[id].choice = next;
  entries.push({ category: 'feats', id, field: 'choice', value: next });
  fixed++;
}
if (!fixed) {
  console.error(`no lesson feat offers "${WRONG}" — nothing to fix.`);
  process.exit(1);
}

writeFileSync(CORE, JSON.stringify(core));
const backfill = JSON.parse(readFileSync(BACKFILL, 'utf8'));
const key = (e) => `${e.category}/${e.id}/${(e.path ?? []).join('/')}/${e.field}`;
const seen = new Set(entries.map(key));
const next = [...backfill.filter((e) => !seen.has(key(e))), ...entries];
writeFileSync(BACKFILL, formatBackfill(next));
console.log(`repointed ${WRONG} -> ${RIGHT} on ${fixed} feat(s) (backfill ${backfill.length} -> ${next.length})`);
