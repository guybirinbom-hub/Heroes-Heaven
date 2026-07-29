/*
 * Choice options whose value — and sometimes whose LABEL — is a raw Foundry path.
 *
 * The importer copied Foundry's ChoiceSet values verbatim, so eight records ship options like
 * `system.skills.stealth.rank` and `Compendium.pf2e.feats-srd.Item.Pet`. Three of them use the path
 * as the label as well, which the player reads in the picker. The stored answer is equally useless:
 * nothing downstream can resolve a Foundry path to a skill, a save or a feat.
 *
 * Both patterns map cleanly onto ids this app already uses, so this is a deterministic rewrite:
 *   system.skills.<key>.rank         -> <key>
 *   system.saves.<key>.rank          -> <key>
 *   system.perception.rank           -> perception
 *   Compendium.pf2e.<bucket>.Item.X  -> the id of the record NAMED X
 *
 * Anything that fails to resolve throws rather than being guessed — a wrong id is a picker that
 * stores an answer nothing can read, which is the defect being fixed.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const db = JSON.parse(readFileSync('public/core.json', 'utf8'));
const COLS = ['feats', 'classFeatures', 'items', 'heritages', 'backgrounds', 'ancestries'];

/** name (lowercased) -> id, per bucket the Compendium paths point at. */
const byName = {
  'feats-srd': new Map(Object.values(db.feats).map((f) => [f.name.toLowerCase(), f.id])),
  feats: new Map(Object.values(db.feats).map((f) => [f.name.toLowerCase(), f.id])),
  classfeatures: new Map(Object.values(db.classFeatures).map((f) => [f.name.toLowerCase(), f.id])),
};

const titleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Resolve one option value; returns {value,label} or null when it needs no change. */
function resolve(value, label, where) {
  const skill = /^system\.skills\.([a-z-]+)\.rank$/.exec(value);
  if (skill) return { value: skill[1], label: label && !label.startsWith('system.') ? label : titleCase(skill[1]) };

  const save = /^system\.saves\.([a-z]+)\.rank$/.exec(value);
  if (save) return { value: save[1], label: label && !label.startsWith('system.') ? label : titleCase(save[1]) };

  if (value === 'system.perception.rank') return { value: 'perception', label: label && !label.startsWith('system.') ? label : 'Perception' };

  const comp = /^Compendium\.pf2e\.([a-z-]+)\.Item\.(.+)$/.exec(value);
  if (comp) {
    const [, bucket, name] = comp;
    const map = byName[bucket];
    if (!map) throw new Error(`${where}: unknown compendium bucket '${bucket}'`);
    const id = map.get(name.toLowerCase());
    if (!id) throw new Error(`${where}: '${name}' does not resolve in ${bucket}`);
    return { value: id, label: label && !label.startsWith('Compendium.') ? label : name };
  }
  return null;
}

let changed = 0;
const touched = new Set();
const patches = [];

for (const col of COLS) {
  for (const [id, rec] of Object.entries(db[col] ?? {})) {
    const opts = rec.choice?.options;
    if (!opts?.length) continue;
    let any = false;
    for (const o of opts) {
      const fixed = resolve(String(o.value), o.label, `${col}/${id}`);
      if (!fixed) continue;
      o.value = fixed.value;
      o.label = fixed.label;
      any = true;
      changed++;
    }
    if (any) {
      touched.add(`${col}/${id}`);
      patches.push({ category: col, id, field: 'choice', value: rec.choice });
    }
  }
}

writeFileSync('public/core.json', JSON.stringify(db)); // minified on purpose

const FILE = 'scripts/data/effect-backfill.json';
const existing = JSON.parse(readFileSync(FILE, 'utf8'));
const key = (p) => `${p.category}|${p.id}|${p.field}`;
const mine = new Set(patches.map(key));
writeFileSync(FILE, JSON.stringify([...existing.filter((p) => !mine.has(key(p))), ...patches], null, 2));

console.log(`${changed} option values rewritten across ${touched.size} records: ${[...touched].join(', ')}`);
