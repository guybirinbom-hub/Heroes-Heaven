/*
 * GUARD: a record that turns critical specialization ON says which Strikes it reaches.
 *
 * WHY. `critSpec: true` with no narrowing means EVERY Strike the character makes shows its group's critical
 * specialization effect (derive.ts weaponMatches returns true for an unnarrowed entry). The importer wrote
 * exactly that whenever it could not read Foundry's predicate — a proficiency-rank gate, "your deity's
 * favored weapon", an item tag, a roll option — so package M (2026-10-16) found a 5th-level fighter showing
 * the effect on weapons it was only expert with, a ruffian on its longbow and greataxe, every cleric doctrine
 * on every weapon, and seven exemplar epithets whose own on-crit ability was shown as each weapon group's.
 * Each was fixed with an overlay row; this check is what stops the next one shipping.
 *
 * RULE 1 — NARROWED OR QUOTED. Every object in public/core.json, at ANY depth (effectChoices grants, options,
 * riders), whose `critSpec` is truthy must narrow it:
 *   · a record-level grant: `critSpecWeapons` with at least one narrowing key (groups, traits, bases, names,
 *     hands, melee, designated, minRank, categories, deityFavored, maxDieFaces, innovationType), or a gate
 *     (`critSpecRequiresModeGroup`, `critSpecRequiresFeat`). `critSpecCondition` alone does NOT count: it is
 *     printed beside the effect, never enforced.
 *   · an `unarmedTraits` rider: a `match` list or a `fromRecord` (a rider with neither reaches every unarmed
 *     attack).
 *   …or be listed in scripts/data/critspec-narrowing-allow.json `unnarrowed`, quoting the printed sentence
 *   that gives it to every Strike with its AoN doc id. The quote must name critical specialization and occur
 *   in that document of the Archives mirror. An entry whose record now narrows, or is gone, fails (stale).
 *
 * RULE 2 — THE RANK GATE. Every record whose Foundry CriticalSpecialization rule carried an
 * `item:proficiency:rank` predicate ("…for which you have master proficiency") and that turns crit spec on
 * must carry `critSpecWeapons.minRank`, or a `rankGate.allow` entry (quote + doc id + why) saying why print
 * needs none. The set is measured from the Foundry packs (.import-src/pf2e/packs/pf2e, gitignored) when they
 * are present and must equal the snapshot `rankGate.foundryRankRecords` — a drift fails until the snapshot
 * is updated by hand; without the packs the snapshot is the set.
 *
 * RULE 3 — THE FEATURE GATE. The same importer dropped `feature:`, `class:` and `feat:` predicate atoms too: Inventor
 * Weapon Expertise's Foundry rule says `feature:weapon-innovation`, the record kept only "the marked item",
 * and an armor-innovation inventor who marked a longsword got its critical specialization (package M round 2
 * review). Every record whose Foundry CriticalSpecialization predicate carries such an atom, and that turns
 * crit spec on, needs a `featureGate.entries` row: the atoms (`predicate`, compared with the packs when they
 * are present), the record FIELD that carries the gate (`field`, a dotted path that must be present on the
 * record, and `value`, which it must equal when given) — or no field, when print needs none — and a quote +
 * doc id + why like every other entry. The measured set must equal `featureGate.foundryFeatureRecords`.
 *
 * Reads public/core.json, the allow file, the Archives mirror and the Foundry packs. CORE_JSON,
 * CRITSPEC_ALLOW, AON_MIRROR and FOUNDRY_PACKS override the four (used to prove the guard red on planted
 * bad cases in scratch copies, never in the tree).
 *
 *   node scripts/critspec-narrowing-check.mjs
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CORE = process.env.CORE_JSON || join(ROOT, 'public/core.json');
const ALLOW = process.env.CRITSPEC_ALLOW || join(ROOT, 'scripts/data/critspec-narrowing-allow.json');
const MIRROR = process.env.AON_MIRROR || 'C:/wonderers guide/aon-2e-archive/data/by-category';
const PACKS = process.env.FOUNDRY_PACKS || join(ROOT, '.import-src/pf2e/packs/pf2e');

const core = JSON.parse(readFileSync(CORE, 'utf8'));
const allow = JSON.parse(readFileSync(ALLOW, 'utf8').replace(/^\uFEFF/, ''));
const failures = [];
const fail = (msg) => failures.push(msg);

/* ---------- the Archives mirror (quotes) ---------- */
const mirrorOn = existsSync(MIRROR);
const norm = (s) =>
  String(s ?? '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
const docText = (aonId) => {
  const cat = String(aonId).replace(/-\d+(?:-\d+)*$/, '');
  const p = join(MIRROR, cat, `${aonId}.json`);
  if (!existsSync(p)) return null;
  return norm(JSON.parse(readFileSync(p, 'utf8')).text);
};
let quotesUnchecked = 0;
/** An allow entry's citation: the record's own page (or the page it is a section of), a quote naming
 *  critical specialization, found in that page, and a reason. */
function checkCitation(label, entry, rec) {
  if (!entry.why || !String(entry.why).trim()) fail(`${label}: no \`why\``);
  const own = [rec?.aonId, rec?.aonParentId].filter(Boolean);
  if (!entry.aonId || !own.includes(entry.aonId)) fail(`${label}: aonId ${entry.aonId ?? '(none)'} is not the record's page (${own.join(', ') || 'none'})`);
  if (!/critical speciali[sz]ation/i.test(String(entry.quote ?? ''))) fail(`${label}: the quote does not name critical specialization`);
  if (!mirrorOn) { quotesUnchecked++; return; }
  const text = entry.aonId ? docText(entry.aonId) : null;
  if (text == null) fail(`${label}: ${entry.aonId} is not in the Archives mirror`);
  else if (!text.includes(norm(entry.quote))) fail(`${label}: the quote is not printed in ${entry.aonId}`);
}

/* ---------- RULE 1 ---------- */
const NARROW_ARRAYS = ['groups', 'traits', 'bases', 'names', 'categories'];
function grantNarrowed(node) {
  const w = node.critSpecWeapons;
  if (w && typeof w === 'object') {
    if (NARROW_ARRAYS.some((k) => Array.isArray(w[k]) && w[k].length)) return true;
    if (w.melee === true || w.deityFavored === true || w.designated || w.minRank || w.innovationType) return true;
    // "weapons that require two hands to wield" (Mauler Dedication, feat-6368) — derive.ts weaponMatches
    // reads it as one more alternative beside `traits`, so a hands-only block narrows too.
    if (w.hands === 1 || w.hands === 2) return true;
    if (w.maxDieFaces && typeof w.maxDieFaces === 'object' && Object.keys(w.maxDieFaces).length) return true;
  }
  if (node.critSpecRequiresModeGroup) return true;
  if (Array.isArray(node.critSpecRequiresFeat) && node.critSpecRequiresFeat.length) return true;
  return false;
}
const riderNarrowed = (node) => (Array.isArray(node.match) && node.match.length > 0) || !!node.fromRecord;

const carriers = []; // { key, path, narrowed, rider }
function walk(node, path, key, inRider) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach((el, i) => walk(el, `${path}[${i}]`, key, inRider)); return; }
  if (node.critSpec) carriers.push({ key, path: path || '', narrowed: inRider ? riderNarrowed(node) : grantNarrowed(node), rider: inRider });
  for (const [k, v] of Object.entries(node)) {
    if (v && typeof v === 'object') walk(v, path ? `${path}.${k}` : k, key, inRider || k === 'unarmedTraits');
  }
}
for (const [bucket, recs] of Object.entries(core)) {
  if (!recs || typeof recs !== 'object' || Array.isArray(recs)) continue;
  for (const [id, rec] of Object.entries(recs)) walk(rec, '', `${bucket}/${id}`, false);
}

const allowKey = (e) => `${e.record}${e.path ? '#' + e.path : ''}`;
const unnarrowedAllow = new Map((allow.unnarrowed ?? []).map((e) => [allowKey(e), e]));
const recOf = (key) => {
  const slash = key.indexOf('/');
  return core[key.slice(0, slash)]?.[key.slice(slash + 1)];
};
const unnarrowed = carriers.filter((c) => !c.narrowed);
for (const c of unnarrowed) {
  const k = `${c.key}${c.path ? '#' + c.path : ''}`;
  if (!unnarrowedAllow.has(k)) {
    fail(`UNNARROWED ${k}${c.rider ? ' (unarmedTraits rider: no match/fromRecord)' : ''} — critical specialization on every Strike. Narrow it (critSpecWeapons / a gate) or quote print's "all weapons" clause in ${ALLOW.replace(ROOT, '.')}`);
  }
}
for (const [k, e] of unnarrowedAllow) {
  const still = unnarrowed.some((c) => `${c.key}${c.path ? '#' + c.path : ''}` === k);
  if (!still) fail(`STALE allow entry ${k}: the record no longer turns critical specialization on unnarrowed — remove the entry`);
  else checkCitation(`allow ${k}`, e, recOf(e.record));
}

/* ---------- RULE 2 ---------- */
const slugify = (s) =>
  String(s ?? '').toLowerCase().normalize('NFKD').replace(/[\u2019']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const PACK_BUCKET = { 'class-features': ['classFeatures'], feats: ['feats'] };
const snapshot = new Set(allow.rankGate?.foundryRankRecords ?? []);
const featureSnapshot = new Set(allow.featureGate?.foundryFeatureRecords ?? []);
let rankSet = snapshot;
let featureSet = featureSnapshot;
/** record key → the `feature:`/`class:` atoms its Foundry crit-spec predicate carries (measured only). */
const featureAtoms = new Map();
let measured = false;
/** Every `feature:…` / `class:…` / `feat:…` string anywhere in a predicate (inside `not`, `or`, `and` too):
 *  each names another record the character must hold, the gate the importer could not carry. */
const FEATURE_ATOM = /^(feature|class|feat):/;
function atomsOf(pred) {
  const out = [];
  const visit = (x) => {
    if (typeof x === 'string') { if (FEATURE_ATOM.test(x)) out.push(x); }
    else if (Array.isArray(x)) x.forEach(visit);
    else if (x && typeof x === 'object') Object.values(x).forEach(visit);
  };
  visit(pred);
  return out;
}
if (existsSync(PACKS)) {
  measured = true;
  const found = new Set();
  const foundFeature = new Set();
  const unmapped = [];
  const unmappedFeature = [];
  const walkPacks = (dir, pack) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) { walkPacks(p, pack ?? f); continue; }
      if (!f.endsWith('.json')) continue;
      let j;
      try { j = JSON.parse(readFileSync(p, 'utf8')); } catch { continue; }
      const rules = j?.system?.rules;
      if (!Array.isArray(rules)) continue;
      const cs = rules.filter((r) => r?.key === 'CriticalSpecialization');
      if (!cs.length) continue;
      const ranked = cs.some((r) => JSON.stringify(r.predicate ?? []).includes('item:proficiency:rank'));
      const atoms = [...new Set(cs.flatMap((r) => atomsOf(r.predicate ?? [])))].sort();
      if (!ranked && !atoms.length) continue;
      const slug = j.system?.slug || slugify(j.name);
      const buckets = PACK_BUCKET[pack] ?? Object.keys(core);
      const hit = buckets.find((b) => core[b]?.[slug]);
      if (ranked) {
        if (hit) found.add(`${hit}/${slug}`);
        else unmapped.push(`${pack}/${j.name} (${slug})`);
      }
      if (atoms.length) {
        if (hit) { foundFeature.add(`${hit}/${slug}`); featureAtoms.set(`${hit}/${slug}`, atoms); }
        else unmappedFeature.push(`${pack}/${j.name} (${slug})`);
      }
    }
  };
  walkPacks(PACKS, null);
  for (const u of unmapped) fail(`RANK: Foundry's ${u} carries a proficiency-rank crit-spec predicate and matches no record — map it`);
  for (const u of unmappedFeature) fail(`FEATURE: Foundry's ${u} carries a feature:/class:/feat: crit-spec predicate and matches no record — map it`);
  const fAdd = [...foundFeature].filter((k) => !featureSnapshot.has(k));
  const fDrop = [...featureSnapshot].filter((k) => !foundFeature.has(k));
  if (fAdd.length || fDrop.length) {
    fail(`FEATURE: featureGate.foundryFeatureRecords is stale against the Foundry packs — add ${JSON.stringify(fAdd)}, remove ${JSON.stringify(fDrop)}`);
  }
  featureSet = foundFeature;
  const add = [...found].filter((k) => !snapshot.has(k));
  const drop = [...snapshot].filter((k) => !found.has(k));
  if (add.length || drop.length) {
    fail(`RANK: rankGate.foundryRankRecords is stale against the Foundry packs — add ${JSON.stringify(add)}, remove ${JSON.stringify(drop)}`);
  }
  rankSet = found;
}
const rankAllow = new Map((allow.rankGate?.allow ?? []).map((e) => [e.record, e]));
let rankCarriers = 0;
for (const key of rankSet) {
  const rec = recOf(key);
  if (!rec?.critSpec) continue; // not a carrier (the shared Weapon Expertise grants none)
  rankCarriers++;
  const hasRank = !!rec.critSpecWeapons?.minRank;
  const e = rankAllow.get(key);
  if (!hasRank && !e) fail(`RANK ${key}: Foundry gates its critical specialization on proficiency rank and the record has no critSpecWeapons.minRank — add the printed rank or a rankGate.allow entry`);
  if (hasRank && e) fail(`STALE rankGate.allow entry ${key}: the record carries minRank now — remove the entry`);
}
for (const [key, e] of rankAllow) {
  if (!rankSet.has(key)) { fail(`STALE rankGate.allow entry ${key}: Foundry carries no proficiency-rank predicate for it`); continue; }
  const rec = recOf(key);
  if (!rec?.critSpec) { fail(`STALE rankGate.allow entry ${key}: the record no longer turns critical specialization on`); continue; }
  if (!rec.critSpecWeapons?.minRank) checkCitation(`rankGate.allow ${key}`, e, rec);
}

/* ---------- RULE 3 ---------- */
const getPath = (obj, path) => String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const featureEntries = new Map((allow.featureGate?.entries ?? []).map((e) => [e.record, e]));
let featureCarriers = 0;
for (const key of featureSet) {
  const rec = recOf(key);
  if (!rec?.critSpec) continue; // not a carrier (the shared Weapon Expertise, Monastic Weaponry)
  featureCarriers++;
  if (!featureEntries.has(key)) {
    fail(`FEATURE ${key}: Foundry gates its critical specialization on ${JSON.stringify(featureAtoms.get(key) ?? '(snapshot)')} and nothing says how the record carries that gate — put the gate on the record (e.g. critSpecWeapons.innovationType) and add a featureGate.entries row naming the field, or quote print saying why none is needed`);
  }
}
for (const [key, e] of featureEntries) {
  if (!featureSet.has(key)) { fail(`STALE featureGate entry ${key}: Foundry carries no feature:/class:/feat: crit-spec predicate for it`); continue; }
  const rec = recOf(key);
  if (!rec?.critSpec) { fail(`STALE featureGate entry ${key}: the record no longer turns critical specialization on`); continue; }
  const measuredAtoms = featureAtoms.get(key);
  if (!Array.isArray(e.predicate) || !e.predicate.length) fail(`featureGate ${key}: no \`predicate\` (the Foundry atoms the entry answers for)`);
  else if (measuredAtoms && JSON.stringify([...e.predicate].sort()) !== JSON.stringify(measuredAtoms)) {
    fail(`featureGate ${key}: predicate ${JSON.stringify(e.predicate)} is not Foundry's ${JSON.stringify(measuredAtoms)}`);
  }
  if (e.field) {
    const have = getPath(rec, e.field);
    if (have == null || have === false || (Array.isArray(have) && !have.length)) fail(`FEATURE ${key}: the gate is said to live in ${e.field}, and the record has none there — the gate was lost`);
    else if (e.value !== undefined && JSON.stringify(have) !== JSON.stringify(e.value)) fail(`FEATURE ${key}: ${e.field} is ${JSON.stringify(have)}, the entry says ${JSON.stringify(e.value)}`);
  }
  checkCitation(`featureGate ${key}`, e, rec);
}

/* ---------- report ---------- */
console.log(
  `critspec-narrowing: ${carriers.length} carrier(s) (${carriers.filter((c) => c.rider).length} rider(s)), ` +
    `${carriers.length - unnarrowed.length} narrowed, ${unnarrowed.length} unnarrowed (${unnarrowedAllow.size} quoted in the allow file); ` +
    `rank gate: ${rankSet.size} Foundry-ranked record(s) ${measured ? 'measured from the packs' : 'from the snapshot (no Foundry packs here)'}, ` +
    `${rankCarriers} carrier(s), ${rankAllow.size} allowed without minRank; ` +
    `feature gate: ${featureSet.size} Foundry feature/class/feat-gated record(s), ${featureCarriers} carrier(s), ${featureEntries.size} entr(y/ies).`,
);
if (!mirrorOn) console.log(`  (Archives mirror not found at ${MIRROR}: ${quotesUnchecked} quote(s) not checked against print)`);
if (failures.length) {
  console.error(`\ncritspec-narrowing: FAIL — ${failures.length} problem(s):`);
  for (const f of failures) console.error('   ' + f);
  process.exit(1);
}
console.log('critspec-narrowing: ok');
