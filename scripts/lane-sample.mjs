/**
 * Emit a reproducible random sample per lane, with the PRINTED TEXT beside the ENCODING.
 *
 * This is the only instrument that finds a lane which is present, read, tested, and simply wrong
 * about the rule. Structural checks cannot: they ask "is the field there", never "does the field say
 * what the book says". This project's measured residual defect rate is ~11.5% and every sweep that
 * looked only at structure reported zero.
 *
 * Sampling is deterministic (FNV-1a of the record id) so a rerun examines the same records and a
 * defect rate is comparable across runs.
 *
 *   node scripts/lane-sample.mjs --per 6 --out scripts/audit/lane-samples.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};

const core = JSON.parse(read('public/core.json'));
/* core.json holds no prose since the split; every text lookup must merge the sidecar back. */
const descs = JSON.parse(read('public/core-descriptions.json'));

const COLLECTIONS = ['feats', 'classFeatures', 'ancestries', 'heritages', 'backgrounds', 'classes', 'items', 'spells', 'actions', 'deities'];

/** Deterministic 0..1 from a string, so the sample is stable across runs. */
const hash01 = (s) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h / 0xffffffff;
};

const descOf = (coll, id) => {
  const d = descs[coll]?.[id];
  if (typeof d === 'string') return d;
  if (d && typeof d === 'object') return d.description ?? d.text ?? '';
  const rec = core[coll]?.[id];
  return typeof rec?.description === 'string' ? rec.description : '';
};

/* Lanes worth sampling: any field that is not pure description. Reuse the inert list by importing
 * nothing — duplicated deliberately so this script stands alone and cannot be silently narrowed. */
const INERT = new Set([
  'id', 'name', 'description', 'descRefs', 'traits', 'level', 'category', 'source', 'sourceId',
  'aonId', 'aonOrigin', 'aonParentId', 'aonSection', 'rarity', 'edition', 'prerequisites', 'access',
  'frequency', 'trigger', 'requirements', 'cost', 'special', 'archetype', 'maxTakable', 'onlyAtLevel',
  'subcategory', 'price', 'bulk', 'usage', 'hands', 'group', 'itemType', 'craftReq', 'contract',
  'school', 'tradition', 'traditions', 'range', 'targets', 'area', 'duration', 'defense', 'heightened',
  'summary', 'text', 'type', 'key', 'slug', 'page', 'pfsLegal', 'legacy', 'remaster',
]);

const PER = Number(arg('--per', 6));
const ONLY = arg('--lanes', '')?.split(',').filter(Boolean);

/* field -> [{coll,id}] */
const holders = new Map();
for (const coll of COLLECTIONS) {
  for (const [id, rec] of Object.entries(core[coll] ?? {})) {
    if (!rec || typeof rec !== 'object') continue;
    for (const k of Object.keys(rec)) {
      if (INERT.has(k)) continue;
      if (!holders.has(k)) holders.set(k, []);
      holders.get(k).push({ coll, id });
    }
  }
}

const strip = (s) => String(s).replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();

const out = [];
for (const [lane, list] of holders) {
  if (ONLY?.length && !ONLY.includes(lane)) continue;
  const picked = list
    .map((h) => ({ ...h, r: hash01(lane + ':' + h.id) }))
    .sort((a, b) => a.r - b.r)
    .slice(0, PER);
  const samples = picked.map(({ coll, id }) => {
    const rec = core[coll][id];
    const mech = Object.fromEntries(Object.entries(rec).filter(([k]) => !INERT.has(k)));
    return {
      coll, id, name: rec.name ?? id, level: rec.level ?? null,
      printed: strip(descOf(coll, id)).slice(0, 1600),
      laneValue: rec[lane],
      allMechanics: mech,
    };
  });
  out.push({ lane, totalRecords: list.length, samples });
}

out.sort((a, b) => b.totalRecords - a.totalRecords);
const dest = arg('--out', 'scripts/audit/lane-samples.json');
writeFileSync(join(ROOT, dest), JSON.stringify(out, null, 1));
console.log(`${out.length} lanes, ${out.reduce((n, l) => n + l.samples.length, 0)} sampled records -> ${dest}`);
console.log(out.slice(0, 12).map((l) => `  ${String(l.totalRecords).padStart(5)}  ${l.lane}`).join('\n'));
