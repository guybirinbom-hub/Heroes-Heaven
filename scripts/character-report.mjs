/*
 * CHARACTER REPORT — one exported character (.codex.json), rebuilt with the CURRENT engine and content.
 *
 *   npx jiti scripts/character-report.mjs work/wg/bellphor-sheldane.codex.json [--json out.json]
 *
 * Prints (1) what the stored character in the file and a fresh buildCharacter() disagree on — the
 * stored one is whatever app version the owner exported from, so a difference is either a fix that
 * has not reached him or a regression; (2) the derived sheet the current engine produces, in the terms
 * a player compares against another builder (attributes, HP, AC, saves, perception, skills, spell
 * slots, focus, feats, features, languages, speed); (3) the picks the build leaves unanswered.
 *
 * Imports TypeScript from src/rules — run with `npx jiti`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { seedContent } from '../src/rules/seed';
import { additionalClassSkills, buildCharacter } from '../src/rules/build';
import { snapshot as snapshotWith } from './lib/sheet-snapshot.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const file = process.argv[2];
if (!file) { console.error('usage: npx jiti scripts/character-report.mjs <character.codex.json> [--json out.json]'); process.exit(2); }
const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;

const core = JSON.parse(read('public/core.json').replace(/^﻿/, ''));
const desc = JSON.parse(read('public/core-descriptions.json').replace(/^﻿/, ''));
for (const [bucket, records] of Object.entries(desc)) {
  if (!core[bucket]) continue;
  for (const [id, v] of Object.entries(records)) { const rec = core[bucket][id]; if (rec && v.d !== undefined) rec.description = v.d; }
}
const db = {};
for (const k of new Set([...Object.keys(seedContent), ...Object.keys(core)])) db[k] = { ...(seedContent[k] ?? {}), ...(core[k] ?? {}) };

const exp = JSON.parse(readFileSync(resolve(file), 'utf8').replace(/^﻿/, ''));
const build = exp.build;
const stored = exp.character;
const fresh = buildCharacter(build, db);
const snap = snapshotWith(fresh, db);

const name = (bucket, id) => db[bucket]?.[id]?.name ?? id;
const j = (x) => JSON.stringify(x);

/* ---- 1. stored (his app) vs fresh (this engine) ---------------------------------------------- */
const diffs = [];
const cmp = (label, a, b) => { if (j(a) !== j(b)) diffs.push({ what: label, stored: a, fresh: b }); };
cmp('abilities', stored.abilities, fresh.abilities);
for (const k of new Set([...Object.keys(stored.proficiencies?.skills ?? {}), ...Object.keys(fresh.proficiencies?.skills ?? {})])) {
  cmp(`skill ${k}`, stored.proficiencies?.skills?.[k] ?? 'untrained', fresh.proficiencies?.skills?.[k] ?? 'untrained');
}
for (const k of ['perception', 'fortitude', 'reflex', 'will', 'classDc']) cmp(`prof ${k}`, stored.proficiencies?.[k] ?? stored.proficiencies?.saves?.[k], fresh.proficiencies?.[k] ?? fresh.proficiencies?.saves?.[k]);
cmp('feats', (stored.feats ?? []).map((f) => `${f.featId}${f.grantedBy ? `<${f.grantedBy}` : ''}`).sort(), (fresh.feats ?? []).map((f) => `${f.featId}${f.grantedBy ? `<${f.grantedBy}` : ''}`).sort());
cmp('languages', [...(stored.languages ?? [])].sort(), [...(fresh.languages ?? [])].sort());
cmp('focus', stored.focus, fresh.focus);
cmp('hitPoints', stored.hitPoints, fresh.hitPoints);
const castView = (c) => (c.spellcasting ?? []).map((s) => ({ id: s.id, type: s.type, tradition: s.tradition, proficiency: s.proficiency, cantrips: s.cantrips?.length ?? null, slots: Object.fromEntries(Object.entries(s.slots ?? {}).map(([r, v]) => [r, v.max])), repertoire: Object.fromEntries(Object.entries(s.repertoire ?? {}).map(([r, v]) => [r, v.length])), prepared: Object.fromEntries(Object.entries(s.prepared ?? {}).map(([r, v]) => [r, v.length])) }));
cmp('spellcasting', castView(stored), castView(fresh));
cmp('classChoices', stored.classChoices, fresh.classChoices);
cmp('grantedSkills', stored.grantedSkills, fresh.grantedSkills);

/* ---- 2. the derived sheet --------------------------------------------------------------------- */
const sheet = {
  name: build.name, level: build.level,
  ancestry: name('ancestries', build.ancestryId), heritage: name('heritages', build.heritageId),
  background: build.backgroundId === '__custom__' ? `custom: ${build.customBackground?.name}` : name('backgrounds', build.backgroundId),
  class: `${name('classes', build.classId)}${build.subclassId ? ` (${name('classFeatures', build.subclassId) ?? build.subclassId})` : ''}`,
  deity: name('deities', build.deityId),
  abilities: fresh.abilities,
  hp: snap.maxHp ?? snap.hp ?? null,
  ac: snap.ac ?? null,
  perception: snap.perception ?? null,
  saves: snap.saves ?? null,
  classDc: snap.classDc ?? null,
  speeds: snap.speeds ?? null,
  skills: Object.fromEntries(Object.entries(fresh.proficiencies.skills).filter(([, r]) => r !== 'untrained')),
  skillTotals: Object.fromEntries(Object.entries(snap.skills ?? {}).map(([k, v]) => [k, v?.modifier ?? v?.total ?? v])),
  spellcasting: castView(fresh),
  focus: fresh.focus,
  feats: (fresh.feats ?? []).map((f) => `${name('feats', f.featId)}${f.grantedBy ? ` (granted by ${name('feats', f.grantedBy) === f.grantedBy ? name('classFeatures', f.grantedBy) : name('feats', f.grantedBy)})` : ''}${f.choice ? ` — ${f.choice.label}` : ''}`),
  features: (snap.ownedFeatures ?? []).map((id) => name('classFeatures', id)),
  languages: fresh.languages,
  senses: snap.senses ?? null,
  strikes: (snap.strikes ?? []).map((s) => `${s.name}: ${s.attack ?? s.attackBonus ?? '?'} / ${s.damage ?? '?'}`),
};

/* ---- 3. unanswered picks (a slot with no feat, a choice with no answer) ------------------------ */
const pending = [];
for (const [slot, id] of Object.entries(build.featPicks ?? {})) if (!id) pending.push(`empty feat slot ${slot}`);
// Class skill picks the character is owed (2 + Int and so on) but has not chosen yet.
const owedSkills = additionalClassSkills(build, db);
const grantedSkills = new Set(Object.keys(fresh.grantedSkills ?? {}));
const chosenSkills = (build.classSkills ?? []).filter((s) => !grantedSkills.has(s)).length;
if (chosenSkills < owedSkills) pending.push(`${owedSkills - chosenSkills} class skill pick(s) unchosen (${chosenSkills} of ${owedSkills})`);
for (const f of fresh.feats ?? []) {
  const rec = db.feats[f.featId];
  if (rec?.choice && !f.choice && rec.choice.kind !== 'text') pending.push(`${rec.name}: "${rec.choice.prompt}" not answered`);
}

const out = { file, diffs, sheet, pending };
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(out, null, 1));
console.log(`\n== ${sheet.name} — level ${sheet.level} ${sheet.class}, ${sheet.ancestry} (${sheet.heritage}), ${sheet.background}, deity ${sheet.deity}\n`);
console.log(`-- stored (his app) vs rebuilt (this engine): ${diffs.length} difference(s)`);
for (const d of diffs) console.log(`   ${d.what}\n      stored: ${j(d.stored)}\n      fresh : ${j(d.fresh)}`);
console.log(`\n-- sheet`);
for (const [k, v] of Object.entries(sheet)) if (!['name', 'level', 'class', 'ancestry', 'heritage', 'background', 'deity'].includes(k)) console.log(`   ${k}: ${typeof v === 'string' ? v : j(v)}`);
console.log(`\n-- pending: ${pending.length ? pending.join('; ') : 'nothing unanswered'}`);
