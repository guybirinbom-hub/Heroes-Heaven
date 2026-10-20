/*
 * BLOCKS PARITY SNAPSHOT — a measuring instrument, not a check of any rule.
 *
 * WHY. The next pieces of work refactor how every sheet number is computed (term lists read by both
 * derive.ts and the breakdown popups in explain.ts), move book-field readers onto building blocks
 * (src/rules/blocks/), and touch build-time rank code. The rule for all of it: NO sheet number may
 * change. This script takes a snapshot of every number BEFORE any of that is edited, and its compare
 * mode lists every difference afterwards.
 *
 * WHAT IT COVERS (each character has a stable id, so before/after line up):
 *   sweep:    every class x every level 1-20 in verify-characters.mjs's `mk()` shape (bare), plus the
 *             same grid "filled" (free boosts, attribute boosts, class skills, skill increases);
 *   overrides: the SAMPLE overrides object from test/overrides-write.test.tsx, plus hand-made ones;
 *   state:    6 characters (3 classes x levels 5/12) under conditions, modes, temp Speed, shield, stance;
 *   record:   one character per record that carries an "item 10" field (saveBonuses, landSpeedBonus,
 *             speedBonusType, maxHpBonus, passiveEffects.skills, whileActive[] speed, effectChoices
 *             passive.skills, a background's trainedSkill/trainedLore), each paired with a `#without`
 *             twin that lacks only that record.
 * ...each under BOTH trust-gate settings (off = full data, on = the app's default).
 *
 * WHAT IT RECORDS per character per gate: every derived number by name (skills + sheet Lores, saves,
 * Perception, class DC, initiative, AC, max HP, Speeds, spell attack/DC per entry, attribute scores and
 * modifiers, special statistics, Strike attack/damage text), the tracker's computePcStats, the party
 * card's computeSummary, every explainStat breakdown (totalText, parts, sumOk) and a hash of the stored
 * buildCharacter object (the full object too for record + overrides characters, descriptions stripped).
 *
 * THE PIPELINE IS THE APP'S (src/App.tsx): build with applyOverrides(db, build.overrides), overlay play
 * state with applyPlayState(built, initialPlay(built)+state, db), then the sheet reads
 * playerFacingContent(applyOverrides(db, ov), inventory). The db is merged the way
 * src/data/index.ts:mergeWithSeed merges it (seed + gated core + catalog modes, EXCLUDED_FEATS dropped,
 * the four hidden-list sets, ensureTraits) with descriptions written back like test/_content.ts.
 *
 * Run (jiti, NOT node: it imports .ts):
 *   npx jiti scripts/blocks-parity-snapshot.mjs [--out work/.blocks-parity-baseline.json]
 *   npx jiti scripts/blocks-parity-snapshot.mjs --compare work/.blocks-parity-baseline.json [--against <file>] [--allow <regex>]
 *   npx jiti scripts/blocks-parity-snapshot.mjs --self-test [--baseline <file>]
 *   (--only <regex> restricts which character ids are built; for quick experiments, never for a baseline)
 *
 * Exit codes: snapshot 0; compare 1 when any NUMBER differs on a character the --allow regex does not
 * match; self-test 0 only when the compare caught every planted change.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
process.chdir(ROOT);
const imp = (p) => import(pathToFileURL(ROOT + p).href);

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (name) => argv.includes(name);
const DEFAULT_OUT = 'work/.blocks-parity-baseline.json';

/* ---------------------------------------------------------------------------------------------- */
/* stable JSON + hashing                                                                           */
/* ---------------------------------------------------------------------------------------------- */
function stable(v) {
  if (v === undefined) return undefined;
  if (v === null || typeof v !== 'object') return v;
  if (v instanceof Set) return [...v].sort();
  if (v instanceof Map) return stable(Object.fromEntries([...v.entries()].sort(([a], [b]) => (a < b ? -1 : 1))));
  if (Array.isArray(v)) return v.map((x) => (x === undefined ? null : stable(x)));
  const out = {};
  for (const k of Object.keys(v).sort()) {
    const s = stable(v[k]);
    if (s !== undefined) out[k] = s;
  }
  return out;
}
const stableJson = (v) => JSON.stringify(stable(v));
const sha = (s) => createHash('sha1').update(s).digest('hex').slice(0, 16);
/** The stored character with the fields known to be nondeterministic normalised (none found yet —
 *  `id` is normalised defensively because a saved character carries one). */
function normaliseCharacter(ch) {
  return { ...ch, id: '<id>' };
}
/** A copy without description prose (kept in the hash, dropped from the stored object for size). */
function stripProse(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(stripProse);
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (k === 'description' || k === 'descRefs') continue;
    out[k] = stripProse(x);
  }
  return out;
}

/* ---------------------------------------------------------------------------------------------- */
/* compare (pure over two snapshot objects, so --self-test can feed it planted copies)              */
/* ---------------------------------------------------------------------------------------------- */
function flattenNumbers(snap) {
  const m = new Map();
  for (const [cid, c] of Object.entries(snap.characters)) {
    for (const [gate, g] of Object.entries(c.gates ?? {})) {
      for (const [k, v] of Object.entries(g.numbers ?? {})) m.set(`${cid}|${gate}|${k}`, v);
      for (const [k, b] of Object.entries(g.breakdowns ?? {})) m.set(`${cid}|${gate}|explain.${k}.total`, b.t);
      m.set(`${cid}|${gate}|build.hash`, g.buildHash);
    }
  }
  return m;
}

export function compareSnapshots(before, after, allow) {
  const allowRe = allow ? new RegExp(allow) : null;
  const numbers = [];
  const allowed = [];
  const parts = [];
  const sums = [];
  const missing = [];
  const bn = flattenNumbers(before);
  const an = flattenNumbers(after);
  const charOf = (key) => key.split('|')[0];
  for (const cid of Object.keys(before.characters)) if (!after.characters[cid]) missing.push(`character ${cid} is in the baseline but not in the new run`);
  for (const cid of Object.keys(after.characters)) if (!before.characters[cid]) missing.push(`character ${cid} is new (not in the baseline)`);
  const keys = new Set([...bn.keys(), ...an.keys()]);
  for (const k of [...keys].sort()) {
    const cid = charOf(k);
    if (!before.characters[cid] || !after.characters[cid]) continue;
    const b = bn.has(k) ? bn.get(k) : '<absent>';
    const a = an.has(k) ? an.get(k) : '<absent>';
    if (stableJson(b) === stableJson(a)) continue;
    const [, gate, stat] = k.split('|');
    const row = { cid, gate, stat, before: b, after: a };
    (allowRe && allowRe.test(cid) ? allowed : numbers).push(row);
  }
  for (const [cid, c] of Object.entries(before.characters)) {
    const ac = after.characters[cid];
    if (!ac) continue;
    for (const [gate, g] of Object.entries(c.gates ?? {})) {
      const ag = ac.gates?.[gate];
      if (!ag) continue;
      const refs = new Set([...Object.keys(g.breakdowns ?? {}), ...Object.keys(ag.breakdowns ?? {})]);
      for (const r of [...refs].sort()) {
        const bb = g.breakdowns?.[r];
        const ab = ag.breakdowns?.[r];
        const line = (p) => `${p[0]}${p[1] ? ` (${p[1]})` : ''} = ${p[2]}`;
        const bl = (bb?.p ?? []).map(line);
        const al = (ab?.p ?? []).map(line);
        if (stableJson(bl) !== stableJson(al)) {
          const removed = bl.filter((x) => !al.includes(x));
          const added = al.filter((x) => !bl.includes(x));
          parts.push({ cid, gate, ref: r, removed, added, reordered: !removed.length && !added.length });
        }
        if ((bb?.ok ?? null) !== (ab?.ok ?? null)) sums.push({ cid, gate, ref: r, before: bb?.ok ?? null, after: ab?.ok ?? null });
      }
    }
  }
  return { numbers, allowed, parts, sums, missing };
}

function printCompare(res, fullPath) {
  const lines = [];
  const L = (s) => lines.push(s);
  const fmt = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
  L(`NUMBER differences: ${res.numbers.length}` + (res.allowed.length ? `  (+${res.allowed.length} on characters matched by --allow)` : ''));
  L(`breakdown-part differences: ${res.parts.length}`);
  L(`sumOk changes: ${res.sums.length}` + (res.sums.length ? ` (${res.sums.filter((s) => s.after === true).length} now sum, ${res.sums.filter((s) => s.after === false).length} stopped summing)` : ''));
  if (res.missing.length) L(`character set changed: ${res.missing.length}`);
  const full = [...lines];
  const F = (s) => full.push(s);
  F('');
  F('== (1) NUMBER differences ==');
  for (const r of res.numbers) F(`  ${r.cid} [gate ${r.gate}] ${r.stat}: ${fmt(r.before)} -> ${fmt(r.after)}`);
  if (res.allowed.length) {
    F('== (1b) NUMBER differences on --allow characters ==');
    for (const r of res.allowed) F(`  ${r.cid} [gate ${r.gate}] ${r.stat}: ${fmt(r.before)} -> ${fmt(r.after)}`);
  }
  F('== (2) breakdown-part differences (informational) ==');
  for (const p of res.parts) {
    F(`  ${p.cid} [gate ${p.gate}] ${p.ref}${p.reordered ? ' (reordered)' : ''}`);
    for (const x of p.removed) F(`      - ${x}`);
    for (const x of p.added) F(`      + ${x}`);
  }
  F('== (3) sumOk changes ==');
  for (const s of res.sums) F(`  ${s.cid} [gate ${s.gate}] ${s.ref}: ${s.before} -> ${s.after}`);
  if (res.missing.length) {
    F('== character set ==');
    for (const m of res.missing) F(`  ${m}`);
  }
  // Short console view: counts, then up to ~60 lines (numbers first, they are the ones that matter).
  const shortRows = [];
  for (const r of res.numbers) shortRows.push(`  NUM ${r.cid} [${r.gate}] ${r.stat}: ${fmt(r.before)} -> ${fmt(r.after)}`);
  for (const m of res.missing) shortRows.push(`  SET ${m}`);
  for (const s of res.sums) shortRows.push(`  SUM ${s.cid} [${s.gate}] ${s.ref}: ${s.before} -> ${s.after}`);
  for (const p of res.parts) shortRows.push(`  PART ${p.cid} [${p.gate}] ${p.ref}: -${p.removed.length} +${p.added.length}${p.reordered ? ' reordered' : ''}`);
  for (const l of lines) console.log(l);
  for (const r of shortRows.slice(0, 56)) console.log(r);
  if (shortRows.length > 56) console.log(`  ... ${shortRows.length - 56} more`);
  if (fullPath) {
    writeFileSync(fullPath, full.join('\n') + '\n');
    console.log(`full list: ${fullPath}`);
  }
}

/* ---------------------------------------------------------------------------------------------- */
/* self-test: plant changes in a copy of the baseline and prove the compare catches each            */
/* ---------------------------------------------------------------------------------------------- */
function selfTest(path) {
  const base = JSON.parse(readFileSync(path, 'utf8'));
  const clone = () => JSON.parse(JSON.stringify(base));
  const firstChar = Object.keys(base.characters).find((cid) => Object.keys(base.characters[cid].gates ?? {}).length);
  const gate = Object.keys(base.characters[firstChar].gates)[0];
  const results = [];
  const check = (label, ok) => {
    results.push({ label, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  };
  check('an unchanged copy compares clean', (() => {
    const r = compareSnapshots(base, clone());
    return !r.numbers.length && !r.parts.length && !r.sums.length && !r.missing.length;
  })());
  // 1. bump one derived number
  {
    const m = clone();
    const nums = m.characters[firstChar].gates[gate].numbers;
    const key = Object.keys(nums).find((k) => typeof nums[k] === 'number');
    nums[key] += 1;
    const r = compareSnapshots(base, m);
    check(`a bumped number (${firstChar} ${key}) is reported as a NUMBER difference`, r.numbers.length === 1 && r.numbers[0].stat === key);
    const r2 = compareSnapshots(base, m, '^' + firstChar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
    check('--allow on that character moves it out of the failing list', r2.numbers.length === 0 && r2.allowed.length === 1);
  }
  // 2. change a build hash
  {
    const m = clone();
    m.characters[firstChar].gates[gate].buildHash = 'planted';
    const r = compareSnapshots(base, m);
    check('a changed buildCharacter hash is a NUMBER difference', r.numbers.some((x) => x.stat === 'build.hash'));
  }
  // 3. remove a number entirely
  {
    const m = clone();
    const nums = m.characters[firstChar].gates[gate].numbers;
    const key = Object.keys(nums)[0];
    delete nums[key];
    const r = compareSnapshots(base, m);
    check('a number that disappears is reported', r.numbers.some((x) => x.stat === key && x.after === '<absent>'));
  }
  // 4. a breakdown part and a sumOk flag
  {
    const m = clone();
    const bds = m.characters[firstChar].gates[gate].breakdowns;
    const ref = Object.keys(bds).find((k) => bds[k].p.length);
    bds[ref].p[0] = [bds[ref].p[0][0] + ' (planted)', bds[ref].p[0][1], bds[ref].p[0][2]];
    bds[ref].ok = !bds[ref].ok;
    const r = compareSnapshots(base, m);
    check('a changed breakdown line is reported as a part difference', r.parts.some((p) => p.ref === ref && p.added.length === 1 && p.removed.length === 1));
    check('a flipped sumOk is reported', r.sums.some((s) => s.ref === ref));
    check('…and neither is counted as a NUMBER difference', r.numbers.length === 0);
  }
  // 5. a breakdown TOTAL is a number
  {
    const m = clone();
    const bds = m.characters[firstChar].gates[gate].breakdowns;
    const ref = Object.keys(bds)[0];
    bds[ref].t = bds[ref].t + '9';
    const r = compareSnapshots(base, m);
    check('a changed breakdown total is a NUMBER difference', r.numbers.some((x) => x.stat === `explain.${ref}.total`));
  }
  // 6. a dropped character
  {
    const m = clone();
    delete m.characters[firstChar];
    const r = compareSnapshots(base, m);
    check('a character missing from the new run is reported', r.missing.length === 1);
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? `\nSELF-TEST FAILED (${failed} of ${results.length})` : `\nself-test passed (${results.length} checks): the compare can fail.`);
  // …and the CLI exit code on the planted number, through the same path --compare uses.
  return failed ? 1 : 0;
}

if (has('--self-test')) {
  const path = arg('--baseline') ?? DEFAULT_OUT;
  if (!existsSync(path)) {
    console.error(`no baseline at ${path} — take one first`);
    process.exit(2);
  }
  const code = selfTest(path);
  // The exit-code half: the planted number must make the compare's own verdict non-zero.
  const base = JSON.parse(readFileSync(path, 'utf8'));
  const m = JSON.parse(JSON.stringify(base));
  const cid = Object.keys(m.characters)[0];
  const g = Object.keys(m.characters[cid].gates)[0];
  const nums = m.characters[cid].gates[g].numbers;
  const k = Object.keys(nums).find((x) => typeof nums[x] === 'number');
  nums[k] += 1;
  const verdict = compareSnapshots(base, m).numbers.length ? 1 : 0;
  console.log(`${verdict === 1 ? 'PASS' : 'FAIL'}  the compare's exit code on a planted number is ${verdict} (must be 1)`);
  process.exit(code || (verdict === 1 ? 0 : 1));
}

if (has('--compare') && has('--against')) {
  const before = JSON.parse(readFileSync(arg('--compare'), 'utf8'));
  const after = JSON.parse(readFileSync(arg('--against'), 'utf8'));
  const res = compareSnapshots(before, after, arg('--allow'));
  printCompare(res, arg('--compare').replace(/\.json$/, '') + '.compare.txt');
  process.exit(res.numbers.length || res.missing.length ? 1 : 0);
}

/* ---------------------------------------------------------------------------------------------- */
/* the engine                                                                                      */
/* ---------------------------------------------------------------------------------------------- */
const T0 = Date.now();
const { buildCharacter, emptyBuild, applyOverrides } = await imp('src/rules/build.ts');
const derive = await imp('src/rules/derive.ts');
const { deriveInitiative } = await imp('src/rules/initiative.ts');
const { explainStat, sheetLoreKeys } = await imp('src/rules/explain.ts');
const { applyPlayState, initialPlay } = await imp('src/rules/play.ts');
const { playerFacingContent } = await imp('src/rules/cursedItems.ts');
const { computePcStats } = await imp('src/integration/computePcStats.ts');
const { computeSummary } = await imp('src/sheet/partySummary.ts');
const { seedContent } = await imp('src/rules/seed.ts');
const { CATALOG_MODE_MAP } = await imp('src/rules/modes.ts');
const { SKILLS } = await imp('src/rules/types.ts');
const dataIndex = await imp('src/data/index.ts');
const { applyTrustGate, clearTrustGate } = await imp('src/data/trustGate.ts');
const { EXCLUDED_FEATS, ensureTraits, findCombinationFormIds, findDuplicateIds, findHiddenTwins, findUmbrellaIds } = dataIndex;

/* ---- the databases --------------------------------------------------------------------------- */
const core = JSON.parse(readFileSync('public/core.json', 'utf8'));
{
  // Descriptions back onto the records (as test/_content.ts and the app's loadDescriptions do): a
  // number that read prose would otherwise differ from the app's.
  const desc = JSON.parse(readFileSync('public/core-descriptions.json', 'utf8'));
  for (const [bucket, records] of Object.entries(desc)) {
    const target = core[bucket];
    if (!target) continue;
    for (const [id, v] of Object.entries(records)) {
      const rec = target[id];
      if (!rec) continue;
      if (v.d !== undefined) rec.description = v.d;
      if (v.r !== undefined) rec.descRefs = v.r;
    }
  }
}
/** Player-made modes the state variants need that no printed record offers: the app merges the
 *  player's own saved modes on top of everything (mergeWithSeed's `loadModes()`), ungated. */
const USER_MODES = {
  'parity-user-str-mod': {
    id: 'parity-user-str-mod',
    name: 'Parity: +1 Strength modifier',
    category: 'Custom',
    modifiers: [{ value: 1, type: 'status', target: 'ability', detail: 'str' }],
  },
};
const mergeLikeApp = (c) => {
  const S = seedContent;
  const merge = (a, b) => ({ ...(a ?? {}), ...(b ?? {}) });
  const db = {
    ancestries: merge(S.ancestries, c.ancestries),
    heritages: merge(S.heritages, c.heritages),
    backgrounds: merge(S.backgrounds, c.backgrounds),
    classes: merge(S.classes, c.classes),
    classFeatures: merge(S.classFeatures, c.classFeatures),
    feats: merge(S.feats, c.feats),
    spells: merge(S.spells, c.spells),
    items: merge(S.items, c.items),
    deities: merge(S.deities, c.deities),
    languages: merge(S.languages, c.languages),
    animalCompanions: merge(S.animalCompanions, c.animalCompanions),
    familiarAbilities: merge(S.familiarAbilities, c.familiarAbilities),
    companionSpecializations: merge(S.companionSpecializations, c.companionSpecializations),
    companionAdvanced: merge(S.companionAdvanced, c.companionAdvanced),
    specificFamiliars: merge(S.specificFamiliars, c.specificFamiliars),
    followers: merge(S.followers, c.followers),
    pets: merge(S.pets, c.pets),
    services: merge(S.services, c.services),
    vehicles: merge(S.vehicles, c.vehicles),
    siegeWeapons: merge(S.siegeWeapons, c.siegeWeapons),
    conditions: merge(S.conditions, c.conditions),
    actions: merge(S.actions, c.actions),
    modes: merge(merge(CATALOG_MODE_MAP, c.modes), USER_MODES),
    stances: merge(S.stances, c.stances),
    runes: c.runes ?? {},
    runesmithRune: c.runesmithRune ?? {},
  };
  for (const id of EXCLUDED_FEATS) delete db.feats[id];
  for (const k in c) if (!(k in db)) db[k] = c[k];
  db.duplicateIds = findDuplicateIds(db);
  db.hiddenTwins = findHiddenTwins(db, db.duplicateIds);
  db.umbrellaIds = findUmbrellaIds(db.items);
  db.combinationFormIds = findCombinationFormIds(db.items);
  ensureTraits(db);
  return db;
};
const gatedCore = applyTrustGate(core);
const DB = { off: mergeLikeApp(core), on: mergeLikeApp(gatedCore) };
clearTrustGate();
/** applyTrustGate also writes three CODE-side lanes (situational stars, engine lanes, feat-grant
 *  registry); they are global, so each gate's pass sets them before it runs. */
const setGate = (gate) => {
  if (gate === 'on') applyTrustGate(core);
  else clearTrustGate();
};

/* ---- helpers --------------------------------------------------------------------------------- */
const ABILS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const dbOff = DB.off;
const firstHumanHeritage = Object.values(dbOff.heritages).find((h) => h.ancestryId === 'human')?.id ?? null;
const firstBackground = Object.keys(dbOff.backgrounds)[0];
const keyOf = (classId) => {
  const cls = dbOff.classes[classId];
  return cls?.keyAbility?.length === 1 ? cls.keyAbility[0] : (cls?.keyAbility?.[0] ?? 'str');
};
/** scripts/verify-characters.mjs `mk()`, verbatim in shape. */
const mk = (classId, level, subclassId) => {
  const cls = dbOff.classes[classId];
  return {
    ...emptyBuild(),
    name: 'verify',
    level,
    classId,
    keyAbility: keyOf(classId),
    ancestryId: 'human',
    heritageId: firstHumanHeritage,
    backgroundId: firstBackground,
    subclassId: subclassId !== undefined ? subclassId : (cls?.subclass?.options?.[0]?.id ?? null),
  };
};
/** mk() filled the way a player would: four free boosts, the attribute boosts at 5/10/15/20, three
 *  trained class skills and a skill increase offered at every level (the engine keeps only the levels
 *  the class really has — build.ts filters them by skillIncreaseLevels). */
const FILL_SKILLS = ['athletics', 'stealth', 'society'];
const fill = (b) => {
  const key = b.keyAbility ?? 'str';
  const four = [...new Set([key, 'con', 'dex', 'wis', 'str', 'int', 'cha'])].slice(0, 4);
  const attributeBoosts = {};
  for (const L of [5, 10, 15, 20]) if (L <= b.level) attributeBoosts[L] = [...four];
  const skillIncreases = {};
  for (let L = 2; L <= b.level; L++) skillIncreases[L] = FILL_SKILLS[L % FILL_SKILLS.length];
  return { ...b, levelBoosts: four, attributeBoosts, classSkills: [...FILL_SKILLS], skillIncreases };
};
const clampLvl = (n) => Math.max(1, Math.min(20, Number(n) || 1));

/* ---- character specs ------------------------------------------------------------------------- */
/** spec: { id, group, build, play?: partial PlayState, dbPatch?: (db) => db, keepFull?: bool, meta? } */
const specs = [];
const add = (s) => specs.push(s);
const classIds = Object.keys(dbOff.classes).sort();

// 1. the sweep — bare mk() and the filled grid
const SWEEP_LEVELS = Array.from({ length: 20 }, (_, i) => i + 1);
for (const cid of classIds)
  for (const L of SWEEP_LEVELS) {
    add({ id: `sweep:${cid}:L${L}`, group: 'sweep', build: mk(cid, L) });
    add({ id: `sweep-filled:${cid}:L${L}`, group: 'sweep-filled', build: fill(mk(cid, L)) });
  }

// 2. overrides
/* The SAMPLE object from test/overrides-write.test.tsx (2026-10-20), copied verbatim: a non-empty
 * value for every BuildOverrides key that test declares. Put on a level-5 fighter. */
const SAMPLE = {
  allowedFeats: ['toughness'],
  addedFeats: [{ featId: 'toughness', level: 1, category: 'general' }],
  addedFeatures: [{ featureId: 'shield-block', level: 1 }],
  removedFeatIds: ['shield-block'],
  attributes: { dex: 8 },
  proficiencies: { athletics: 'expert' },
  addedLanguages: ['draconic'],
  addedSpells: [{ spellId: 'shield', rank: 0 }],
  maxHp: 30,
  contentEdits: { feats: { toughness: { name: 'Tougher' } } },
  blocks: [{ id: 't1', kind: 'number.add', v: 1, target: 'skill:athletics', value: 1 }],
  meta: { 'proficiencies:athletics': { reason: 'Guild training', of: 'expert' } },
};
add({ id: 'overrides:test-sample:fighter-L5', group: 'overrides', keepFull: true, build: { ...fill(mk('fighter', 5)), overrides: SAMPLE } });
add({ id: 'overrides:test-sample:wizard-L5', group: 'overrides', keepFull: true, build: { ...fill(mk('wizard', 5)), overrides: SAMPLE } });
// proficiencies: a skill set to trained plus a later skill increase on it; a rank set LOWER than computed
add({
  id: 'overrides:proficiencies:fighter-L7',
  group: 'overrides',
  keepFull: true,
  build: {
    ...fill(mk('fighter', 7)),
    skillIncreases: { 3: 'athletics', 5: 'thievery', 7: 'stealth' },
    overrides: { proficiencies: { thievery: 'trained', fortitude: 'trained', perception: 'trained' } },
  },
});
add({ id: 'overrides:proficiencies:fighter-L7#none', group: 'overrides', keepFull: true, build: { ...fill(mk('fighter', 7)), skillIncreases: { 3: 'athletics', 5: 'thievery', 7: 'stealth' } } });
// addedFeats: Flexible Spellcaster Dedication given to a caster, and Toughness
const FLEX = dbOff.feats['flexible-spellcaster-dedication'] ? 'flexible-spellcaster-dedication' : null;
for (const [cls, L] of [['cleric', 4], ['wizard', 8]]) {
  const added = [...(FLEX ? [{ featId: FLEX, level: 2, category: 'class' }] : []), { featId: 'toughness', level: 3, category: 'general' }];
  add({ id: `overrides:addedFeats:${cls}-L${L}`, group: 'overrides', keepFull: true, build: { ...fill(mk(cls, L)), overrides: { addedFeats: added } } });
  add({ id: `overrides:addedFeats:${cls}-L${L}#none`, group: 'overrides', keepFull: true, build: fill(mk(cls, L)) });
}
// maxHp
add({ id: 'overrides:maxHp:wizard-L5', group: 'overrides', keepFull: true, build: { ...fill(mk('wizard', 5)), overrides: { maxHp: 77 } } });
add({ id: 'overrides:maxHp:wizard-L5#drained', group: 'overrides', keepFull: true, build: { ...fill(mk('wizard', 5)), overrides: { maxHp: 77 } }, play: { conditions: [{ id: 'drained', value: 2 }] } });
// attributes
add({ id: 'overrides:attributes:champion-L3', group: 'overrides', keepFull: true, build: { ...fill(mk('champion', 3)), overrides: { attributes: { str: 18, dex: 8, wis: 14 } } } });
add({ id: 'overrides:attributes:champion-L3#none', group: 'overrides', keepFull: true, build: fill(mk('champion', 3)) });

// 3. state variants
const SHIELD_ITEM = dbOff.items['steel-shield'] ? 'steel-shield' : 'wooden-shield';
const STATE_BASES = [
  ['fighter', null],
  ['wizard', null],
  ['monk', null],
];
const STANCE = dbOff.stances?.['mountain-stance'] ? 'mountain-stance' : Object.keys(dbOff.stances ?? {}).sort()[0];
for (const [cls] of STATE_BASES)
  for (const L of [5, 12]) {
    const base = fill(mk(cls, L));
    const id = `state:${cls}-L${L}`;
    const withShield = { ...base, inventory: [{ itemId: SHIELD_ITEM, quantity: 1, equipped: true }] };
    add({ id: `${id}:base`, group: 'state', build: base });
    add({ id: `${id}:conditions`, group: 'state', build: base, play: { conditions: [{ id: 'frightened', value: 1 }, { id: 'clumsy', value: 1 }, { id: 'drained', value: 2 }, { id: 'enfeebled', value: 1 }, { id: 'sickened', value: 1 }] } });
    add({ id: `${id}:mode-heroism`, group: 'state', build: base, play: { activeModes: ['cat-heroism'] } });
    add({ id: `${id}:mode-rallying-anthem`, group: 'state', build: base, play: { activeModes: ['cat-rallying-anthem'] } });
    add({ id: `${id}:mode-ability-str`, group: 'state', build: base, play: { activeModes: ['parity-user-str-mod'] } });
    add({ id: `${id}:mode-max-hp`, group: 'state', build: base, play: { activeModes: ['item-azatas-grace'] } });
    add({ id: `${id}:mode-battle-form`, group: 'state', build: base, play: { activeModes: ['bat-form'] } });
    add({ id: `${id}:mode-triple-time`, group: 'state', build: base, play: { activeModes: ['cat-triple-time'] } });
    add({ id: `${id}:speed-override`, group: 'state', build: base, play: { tempSpeed: 15 } });
    add({ id: `${id}:shield-raised`, group: 'state', build: withShield, play: { activeModes: ['cat-raise-shield'] } });
    add({ id: `${id}:shield-held`, group: 'state', build: withShield });
    if (STANCE) add({ id: `${id}:stance-${STANCE}`, group: 'state', build: base, play: { activeStance: STANCE } });
  }
for (const L of [5, 12]) {
  // the resource states whileActive clauses read (panache / rage), on their own classes
  add({ id: `state:swashbuckler-L${L}:base`, group: 'state', build: fill(mk('swashbuckler', L)) });
  add({ id: `state:swashbuckler-L${L}:panache`, group: 'state', build: fill(mk('swashbuckler', L)), play: { resources: { panache: 1 } } });
  add({ id: `state:barbarian-L${L}:base`, group: 'state', build: fill(mk('barbarian', L)) });
  add({ id: `state:barbarian-L${L}:rage`, group: 'state', build: fill(mk('barbarian', L)), play: { resources: { rage: 1 }, activeModes: ['cat-rage'] } });
}

// 4. item-10 records — scanned at ANY depth over the full (gate-off) database
const ITEM10 = [
  { name: 'saveBonuses', test: (p) => /(^|\.)saveBonuses$/.test(p) },
  { name: 'landSpeedBonus', test: (p) => /(^|\.)landSpeedBonus$/.test(p) && !/whileActive/.test(p) },
  { name: 'speedBonusType', test: (p) => /(^|\.)speedBonusType$/.test(p) && !/whileActive/.test(p) },
  { name: 'maxHpBonus', test: (p) => /(^|\.)maxHpBonus$/.test(p) },
  { name: 'passiveEffects.skills', test: (p) => /(^|\.)passiveEffects\.skills$/.test(p) },
  { name: 'whileActive.landSpeedBonus', test: (p) => /whileActive\[\]\.landSpeedBonus$/.test(p) },
  { name: 'whileActive.speedBonusType', test: (p) => /whileActive\[\]\.speedBonusType$/.test(p) },
  { name: 'effectChoices.passive.skills', test: (p) => /effectChoices\[\].*grant\.passive\.skills$/.test(p) },
  { name: 'trainedSkill', test: (p) => /(^|\.)trainedSkill$/.test(p) },
  { name: 'trainedLore', test: (p) => /(^|\.)trainedLore$/.test(p) },
];
function scanPaths(node, path, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) scanPaths(n, path + '[]', out);
    return;
  }
  for (const [k, v] of Object.entries(node)) {
    const p = path ? `${path}.${k}` : k;
    if (v !== undefined && v !== null) for (const f of ITEM10) if (f.test(p)) out.add(`${f.name}@${p}`);
    scanPaths(v, p, out);
  }
}
const records = []; // { bucket, id, fields: Set(name), paths: string[] }
for (const [bucket, recs] of Object.entries(dbOff)) {
  if (!recs || typeof recs !== 'object' || recs instanceof Set || recs instanceof Map) continue;
  for (const [id, rec] of Object.entries(recs)) {
    if (!rec || typeof rec !== 'object') continue;
    const hit = new Set();
    scanPaths(rec, '', hit);
    if (!hit.size) continue;
    const paths = [...hit].map((h) => h.split('@')[1]);
    records.push({ bucket, id, fields: [...new Set([...hit].map((h) => h.split('@')[0]))].sort(), paths: [...new Set(paths)].sort() });
  }
}
records.sort((a, b) => (a.bucket + '/' + a.id < b.bucket + '/' + b.id ? -1 : 1));

const getPath = (rec, segs) => {
  if (rec == null) return undefined;
  if (!segs.length) return rec;
  const [h, ...rest] = segs;
  const isArr = h.endsWith('[]');
  const key = isArr ? h.slice(0, -2) : h;
  const child = rec[key];
  if (child === undefined) return undefined;
  if (!isArr) return getPath(child, rest);
  if (!Array.isArray(child)) return undefined;
  const found = child.map((c) => getPath(c, rest)).filter((x) => x !== undefined);
  return found.length ? found : undefined;
};
/** Deep copy of `rec` with every listed path removed — the class-feature twin (a feature cannot be
 *  taken away from its class, so its twin is the same character with the record's item-10 fields gone). */
function stripPaths(rec, paths) {
  const copy = JSON.parse(JSON.stringify(rec));
  for (const p of paths) {
    const segs = p.split('.');
    const walk = (node, i) => {
      if (!node || typeof node !== 'object') return;
      const h = segs[i];
      const isArr = h.endsWith('[]');
      const key = isArr ? h.slice(0, -2) : h;
      if (i === segs.length - 1) {
        delete node[key];
        return;
      }
      const child = node[key];
      if (isArr) for (const c of Array.isArray(child) ? child : []) walk(c, i + 1);
      else walk(child, i + 1);
    };
    walk(copy, 0);
  }
  return copy;
}

const ancestryIds = new Set(Object.keys(dbOff.ancestries));
const versatileHeritage = (t) => {
  const h = dbOff.heritages[t];
  return h && !h.ancestryId ? t : null;
};
const recordPlans = []; // { rec, charId, twinId, extra?: [{charId, twinId, label}], skipped?: reason }
const unreachable = [];

/** Owner of a class feature: a class's feature list, subclass option, or extra-choice option. */
function featureOwner(fid) {
  // An inventor innovation MODIFICATION is reached through build.inventorModifications (initial at 1st,
  // breakthrough at 7th, revolutionary at 15th), on the innovation its tag names.
  const rec = dbOff.classFeatures[fid];
  const modTag = (rec?.otherTags ?? []).find((t) => /-innovation-modification$/.test(t));
  if (modTag) {
    const innovation = modTag.replace(/-modification$/, '');
    const L = clampLvl(rec.level);
    const tier = L >= 15 ? 'revolutionary' : L >= 7 ? 'breakthrough' : 'initial';
    const mods = { [tier]: fid };
    if (tier !== 'initial' && rec.requiresModification?.[0]) mods.initial = rec.requiresModification[0];
    return { classId: 'inventor', level: L, subclassId: innovation, inventorModifications: mods };
  }
  for (const cid of classIds) {
    const cls = dbOff.classes[cid];
    const f = (cls.features ?? []).find((x) => x.featureId === fid);
    if (f) return { classId: cid, level: f.level, subclassId: undefined };
    const opt = (cls.subclass?.options ?? []).find((o) => o.id === fid);
    if (opt) return { classId: cid, level: 1, subclassId: fid };
    for (const ec of cls.extraChoices ?? []) {
      const o = (ec.options ?? []).find((x) => x.id === fid);
      if (o) return { classId: cid, level: clampLvl(ec.level ?? 1), extra: { group: ec.id, value: fid } };
    }
  }
  // a subclass option's own feature list (cls.subclass.options[].features)
  for (const cid of classIds) {
    for (const opt of dbOff.classes[cid].subclass?.options ?? []) {
      const f = (opt.features ?? opt.grants?.features ?? []).find?.((x) => (x.featureId ?? x) === fid);
      if (f) return { classId: cid, level: clampLvl(f.level ?? 1), subclassId: opt.id };
    }
  }
  return null;
}

const stateOf = (rec) => {
  const states = new Set();
  for (const wa of rec.whileActive ?? []) if (wa?.state) states.add(wa.state);
  return [...states].sort();
};

for (const r of records) {
  const rec = dbOff[r.bucket][r.id];
  const rid = `${r.bucket}/${r.id}`;
  const base = { group: 'record', keepFull: true, meta: { record: rid, fields: r.fields, paths: r.paths } };
  if (r.bucket === 'feats') {
    const L = clampLvl(rec.level);
    const traits = rec.traits ?? [];
    const cls = traits.find((t) => dbOff.classes[t] && t !== 'archetype') ?? 'fighter';
    let ancestryId = 'human';
    let heritageId = firstHumanHeritage;
    const anc = traits.find((t) => ancestryIds.has(t));
    if (anc) {
      ancestryId = anc;
      heritageId = Object.values(dbOff.heritages).find((h) => h.ancestryId === anc)?.id ?? null;
    } else {
      const vh = traits.map(versatileHeritage).find(Boolean);
      if (vh) heritageId = vh;
    }
    const cat = rec.category === 'class' || traits.includes('archetype') ? 'class' : rec.category ?? 'general';
    const twinBuild = fill({ ...mk(cls, L), ancestryId, heritageId });
    const slot = `${L}:${cat}:0`;
    const b = { ...twinBuild, featPicks: { [slot]: r.id } };
    const charId = `record:${rid}`;
    const twinId = `twin:feats:${cls}:${ancestryId}:${heritageId}:L${L}`;
    add({ ...base, id: charId, build: b, meta: { ...base.meta, slot } });
    add({ id: twinId, group: 'twin', build: twinBuild });
    const plan = { rec: r, charId, twinId, extra: [] };
    for (const st of stateOf(rec)) {
      add({ ...base, id: `${charId}#${st}`, build: b, play: { resources: { [st]: 1 } } });
      add({ id: `${twinId}#${st}`, group: 'twin', build: twinBuild, play: { resources: { [st]: 1 } } });
      plan.extra.push({ charId: `${charId}#${st}`, twinId: `${twinId}#${st}`, label: `${st} on` });
    }
    recordPlans.push(plan);
  } else if (r.bucket === 'classFeatures') {
    const own = featureOwner(r.id);
    if (!own) {
      unreachable.push({ rid, fields: r.fields, reason: 'no class, subclass option or extra choice lists it (granted only through another record)' });
      continue;
    }
    // The feature's own level when it is later than the slot that offers it (Blessed Swiftness is a
    // 3rd-level blessing offered by a choice group with no level of its own).
    const L = clampLvl(Math.max(own.level ?? 1, rec.level ?? 1));
    let b = fill(mk(own.classId, L, own.subclassId));
    if (own.extra) b = { ...b, extraChoices: { ...b.extraChoices, [own.extra.group]: [own.extra.value] } };
    if (own.inventorModifications) b = { ...b, inventorModifications: own.inventorModifications };
    const charId = `record:${rid}`;
    const twinId = `${charId}#without`;
    // Stripped from THAT gate's copy of the record, so the gate-on twin starts from the gated record.
    const dbPatch = (db) => ({ ...db, classFeatures: { ...db.classFeatures, [r.id]: stripPaths(db.classFeatures[r.id], r.paths) } });
    add({ ...base, id: charId, build: b, meta: { ...base.meta, owner: own } });
    add({ id: twinId, group: 'twin', build: b, dbPatch, meta: { twin: 'field-stripped', record: rid } });
    const plan = { rec: r, charId, twinId, extra: [] };
    for (const st of stateOf(rec)) {
      add({ ...base, id: `${charId}#${st}`, build: b, play: { resources: { [st]: 1 } } });
      add({ id: `${twinId}#${st}`, group: 'twin', build: b, dbPatch, play: { resources: { [st]: 1 } }, meta: { twin: 'field-stripped', record: rid } });
      plan.extra.push({ charId: `${charId}#${st}`, twinId: `${twinId}#${st}`, label: `${st} on` });
    }
    recordPlans.push(plan);
  } else if (r.bucket === 'heritages') {
    const ancestryId = rec.ancestryId && dbOff.ancestries[rec.ancestryId] ? rec.ancestryId : 'human';
    const L = 5;
    const twinBuild = fill({ ...mk('fighter', L), ancestryId, heritageId: null });
    const charId = `record:${rid}`;
    const twinId = `twin:heritages:${ancestryId}:L${L}`;
    add({ ...base, id: charId, build: { ...twinBuild, heritageId: r.id } });
    add({ id: twinId, group: 'twin', build: twinBuild });
    recordPlans.push({ rec: r, charId, twinId, extra: [] });
  } else if (r.bucket === 'backgrounds') {
    const L = 1;
    // No free class skills: the filled grid trains athletics/society, which would mask a background
    // that trains the same skill (measured: 8 backgrounds read "no difference" for that reason).
    const twinBuild = { ...fill({ ...mk('fighter', L), backgroundId: null }), classSkills: [] };
    const charId = `record:${rid}`;
    const twinId = `twin:backgrounds:L${L}`;
    add({ ...base, id: charId, build: { ...twinBuild, backgroundId: r.id } });
    add({ id: twinId, group: 'twin', build: twinBuild });
    recordPlans.push({ rec: r, charId, twinId, extra: [] });
  } else if (r.bucket === 'items') {
    const L = clampLvl(rec.level);
    /* A bonus to a LORE moves no number unless the character has that Lore's row (sheetLoreKeys lists
     * trained Lores), so a Lore the item names is trained on BOTH the item character and its twin. */
    const twinFor = (skills) => {
      const lores = Object.keys(skills ?? {}).filter((k) => k.startsWith('lore:')).sort();
      const tb = fill(mk('fighter', L));
      // FIRST in the list: the class grants a fixed number of free skills, and a Lore appended after
      // the three fill skills was silently dropped (measured on pactmasters-grace).
      const twinBuild = lores.length ? { ...tb, classSkills: [...lores, ...tb.classSkills] } : tb;
      const twinId = `twin:items:L${L}${lores.length ? ':' + lores.join('+') : ''}`;
      add({ id: twinId, group: 'twin', build: twinBuild });
      return { twinBuild, twinId };
    };
    const inv = { itemId: r.id, quantity: 1, worn: true, equipped: true, invested: true };
    const ecs = (rec.effectChoices ?? []).filter((ec) => (ec.options ?? []).some((o) => o?.grant?.passive?.skills));
    if (ecs.length) {
      const plan = { rec: r, charId: null, twinId: null, extra: [] };
      for (const ec of ecs)
        for (const o of ec.options ?? []) {
          const { twinBuild, twinId } = twinFor(o?.grant?.passive?.skills);
          const charId = `record:${rid}@${ec.id}=${o.value}`;
          add({ ...base, id: charId, build: { ...twinBuild, inventory: [inv], effectChoices: { [`${r.id}:${ec.id}`]: o.value } }, meta: { ...base.meta, option: `${ec.id}=${o.value}` } });
          if (!plan.charId) {
            plan.charId = charId;
            plan.twinId = twinId;
          } else plan.extra.push({ charId, twinId, label: `${ec.id}=${o.value}` });
        }
      recordPlans.push(plan);
    } else {
      const { twinBuild, twinId } = twinFor(rec.passiveEffects?.skills);
      const charId = `record:${rid}`;
      add({ ...base, id: charId, build: { ...twinBuild, inventory: [inv] } });
      recordPlans.push({ rec: r, charId, twinId, extra: [] });
    }
  } else if (r.bucket === 'runes') {
    const host = rec.slot === 'armor' ? { itemId: 'leather-armor', quantity: 1, worn: true, invested: true } : rec.slot === 'shield' ? { itemId: SHIELD_ITEM, quantity: 1, equipped: true } : { itemId: 'longsword', quantity: 1, equipped: true };
    const L = clampLvl(rec.level);
    const twinBuild = { ...fill(mk('fighter', L)), inventory: [{ ...host, runes: { potency: 1 } }] };
    const charId = `record:${rid}`;
    const twinId = `twin:runes:${host.itemId}:L${L}`;
    add({ ...base, id: charId, build: { ...twinBuild, inventory: [{ ...host, runes: { potency: 1, property: [r.id] } }] }, meta: { ...base.meta, host: host.itemId } });
    add({ id: twinId, group: 'twin', build: twinBuild });
    recordPlans.push({ rec: r, charId, twinId, extra: [] });
  } else {
    unreachable.push({ rid, fields: r.fields, reason: `bucket "${r.bucket}" has no character plan in this script` });
  }
}

/* ---- --only filter (experiments only) -------------------------------------------------------- */
const ONLY = arg('--only') ? new RegExp(arg('--only')) : null;
// de-duplicate ids (shared twins are added once per record that uses them)
{
  const seen = new Set();
  for (let i = specs.length - 1; i >= 0; i--) {
    if (seen.has(specs[i].id)) specs.splice(i, 1);
    else seen.add(specs[i].id);
  }
  specs.reverse();
  specs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
const runSpecs = ONLY ? specs.filter((s) => ONLY.test(s.id)) : specs;

/* ---- one character -> its numbers ------------------------------------------------------------ */
const err = (e) => `ERR: ${String(e?.message ?? e).split('\n')[0].slice(0, 160)}`;
const tryv = (fn) => {
  try {
    return fn();
  } catch (e) {
    return err(e);
  }
};
const parseTotal = (t) => {
  const m = /^\s*([+\-−]?\d+(?:\.\d+)?)/.exec(String(t ?? '').replace('−', '-'));
  return m ? Number(m[1]) : null;
};

function snapCharacter(spec, gate) {
  const baseDb = spec.dbPatch ? spec.dbPatch(DB[gate]) : DB[gate];
  const build = spec.build;
  const out = { numbers: {}, breakdowns: {} };
  let built;
  try {
    built = buildCharacter(build, applyOverrides(baseDb, build.overrides));
  } catch (e) {
    out.buildError = err(e);
    out.buildHash = out.buildError;
    return out;
  }
  const norm = normaliseCharacter(built);
  out.buildHash = sha(stableJson(norm));
  if (spec.keepFull) out.full = stripProse(stable(norm));
  let ch;
  let db;
  try {
    const play = { ...initialPlay(built, baseDb), ...(spec.play ?? {}) };
    ch = applyPlayState(built, play, baseDb);
    db = playerFacingContent(applyOverrides(baseDb, built.overrides), ch.inventory);
  } catch (e) {
    out.playError = err(e);
    return out;
  }
  if (spec.group === 'record' && spec.meta?.record) {
    // Does the character actually HOLD the record it was made for? (the no-difference reason reads it)
    const [bucket, rid] = spec.meta.record.split('/');
    out.holdsRecord = tryv(() =>
      bucket === 'feats' ? (ch.feats ?? []).some((f) => f.featId === rid)
      : bucket === 'classFeatures' ? derive.ownedFeatureIds(ch, db).has(rid)
      : bucket === 'heritages' ? ch.heritageId === rid || ch.secondHeritageId === rid
      : bucket === 'backgrounds' ? ch.backgroundId === rid
      : bucket === 'items' ? (ch.inventory ?? []).some((i) => i.itemId === rid)
      : bucket === 'runes' ? (ch.inventory ?? []).some((i) => (i.runes?.property ?? []).includes(rid))
      : null,
    );
  }
  const N = out.numbers;
  const put = (k, v) => {
    if (v !== undefined) N[k] = v;
  };
  // attributes
  for (const a of ABILS) {
    put(`ability.${a}.score`, ch.abilities?.[a]);
    put(`ability.${a}.mod`, tryv(() => derive.abilityModOf(ch, a)));
  }
  // skills + Lores
  const lores = tryv(() => sheetLoreKeys(ch, db));
  const skillKeys = [...SKILLS, ...(Array.isArray(lores) ? lores : [])];
  if (!Array.isArray(lores)) put('lores', lores);
  for (const k of skillKeys) {
    const s = tryv(() => derive.deriveSkill(ch, k, db));
    if (typeof s === 'string') put(`skill.${k}`, s);
    else {
      put(`skill.${k}`, s.modifier);
      put(`skill.${k}.rank`, s.rank);
      if (s.substitutedFrom) put(`skill.${k}.substitutedFrom`, s.substitutedFrom.skill);
    }
  }
  for (const sv of ['fortitude', 'reflex', 'will']) {
    const s = tryv(() => derive.deriveSave(ch, sv, db));
    if (typeof s === 'string') put(`save.${sv}`, s);
    else {
      put(`save.${sv}`, s.modifier);
      put(`save.${sv}.rank`, s.rank);
    }
  }
  {
    const p = tryv(() => derive.derivePerception(ch, db));
    if (typeof p === 'string') put('perception', p);
    else {
      put('perception', p.modifier);
      put('perception.rank', p.rank);
    }
  }
  {
    const d = tryv(() => derive.deriveClassDc(ch));
    if (typeof d === 'string') put('classDc', d);
    else {
      put('classDc', d.dc);
      put('classDc.mod', d.modifier);
      put('classDc.rank', d.rank);
    }
  }
  {
    const i = tryv(() => deriveInitiative(ch, db));
    if (typeof i === 'string') put('initiative', i);
    else {
      put('initiative', i.modifier);
      put('initiative.stat', i.stat);
    }
  }
  {
    const ac = tryv(() => derive.deriveAc(ch, db));
    if (typeof ac === 'string') put('ac', ac);
    else {
      put('ac', ac.value);
      put('ac.rank', ac.rank);
      put('ac.dexCap', ac.dexCap);
      if (ac.fromBattleForm) put('ac.fromBattleForm', true);
    }
  }
  put('hp.max', tryv(() => derive.deriveMaxHp(ch, db)));
  {
    const sp = tryv(() => derive.deriveSpeeds(ch, db));
    if (typeof sp === 'string') put('speed', sp);
    else for (const [k, v] of Object.entries(sp ?? {})) put(`speed.${k}`, typeof v === 'object' ? stableJson(v) : v);
    if (ch.speedOverride != null) put('speed.override', ch.speedOverride);
  }
  for (const e of ch.spellcasting ?? []) {
    const s = tryv(() => derive.deriveSpellcasting(ch, e));
    if (typeof s === 'string') put(`spell.${e.id}`, s);
    else {
      put(`spell.${e.id}.attack`, s.attack);
      put(`spell.${e.id}.dc`, s.dc);
      put(`spell.${e.id}.rank`, s.rank);
    }
  }
  const specials = tryv(() => derive.deriveSpecialStats(ch, db));
  if (typeof specials === 'string') put('special', specials);
  else for (const s of specials) put(`special.${s.key}`, s.value);
  const strikes = tryv(() => derive.deriveStrikes(ch, db));
  if (typeof strikes === 'string') put('strikes', strikes);
  else
    for (const s of strikes) {
      put(`strike.${s.instanceId}.attack`, (s.attack ?? []).join('/'));
      put(`strike.${s.instanceId}.damage`, s.damage);
      put(`strike.${s.instanceId}.dmgBonus`, s.dmgBonus);
    }
  // tracker + party card
  {
    const pc = tryv(() => computePcStats(ch, db));
    if (typeof pc === 'string') put('pc', pc);
    else
      for (const [k, v] of Object.entries(pc)) {
        if (k === 'skills') for (const [sk, sv] of Object.entries(v ?? {})) put(`pc.skills.${sk}`, `${sv.mod}${sv.prof}`);
        else if (v !== undefined) put(`pc.${k}`, v);
      }
  }
  {
    const sm = tryv(() => computeSummary(ch, db));
    if (typeof sm === 'string') put('summary', sm);
    else
      for (const k of ['level', 'hpCur', 'hpMax', 'hpTemp', 'ac', 'perception', 'perceptionRank']) put(`summary.${k}`, sm[k]);
    if (typeof sm !== 'string') {
      put('summary.conditions', stableJson(sm.conditions));
      put('summary.modes', stableJson(sm.modes));
    }
  }
  // breakdowns
  const refs = [];
  for (const k of skillKeys) refs.push([`skill.${k}`, { kind: 'skill', skill: k }]);
  for (const sv of ['fortitude', 'reflex', 'will']) refs.push([`save.${sv}`, { kind: 'save', save: sv }]);
  refs.push(['perception', { kind: 'perception' }], ['initiative', { kind: 'initiative' }], ['ac', { kind: 'ac' }], ['classDc', { kind: 'classDc' }], ['hp', { kind: 'hp' }], ['speed', { kind: 'speed' }]);
  for (const e of ch.spellcasting ?? []) refs.push([`spell.${e.id}.attack`, { kind: 'spell', entryId: e.id, which: 'attack' }], [`spell.${e.id}.dc`, { kind: 'spell', entryId: e.id, which: 'dc' }]);
  for (const a of ABILS) refs.push([`ability.${a}`, { kind: 'ability', ability: a }]);
  if (Array.isArray(specials)) for (const s of specials) refs.push([`special.${s.key}`, { kind: 'specialStat', statKey: s.key }]);
  for (const [key, ref] of refs) {
    const b = tryv(() => explainStat(ch, db, ref, build));
    if (typeof b === 'string') {
      out.breakdowns[key] = { t: b, p: [], ok: null };
      continue;
    }
    const total = parseTotal(b.totalText);
    const sum = (b.parts ?? []).reduce((s, p) => s + (Number(p.value) || 0), 0);
    out.breakdowns[key] = {
      t: b.totalText,
      p: (b.parts ?? []).map((p) => [p.label, p.note ?? '', p.value]),
      ok: total == null ? null : sum === total,
    };
  }
  return out;
}

/* ---- --plant: a real engine-side bad case (Fleet worth +10 instead of +5, in memory only) ------ */
const PLANT = has('--plant');
if (PLANT)
  for (const g of ['off', 'on']) if (DB[g].feats.fleet) DB[g].feats = { ...DB[g].feats, fleet: { ...DB[g].feats.fleet, landSpeedBonus: 10 } };

/* ---- run ------------------------------------------------------------------------------------- */
const result = {};
for (const s of runSpecs) result[s.id] = { group: s.group, ...(s.meta ? { meta: s.meta } : {}), gates: {} };
for (const gate of ['off', 'on']) {
  setGate(gate);
  const t = Date.now();
  let n = 0;
  for (const s of runSpecs) {
    result[s.id].gates[gate] = snapCharacter(s, gate);
    if (++n % 500 === 0) console.error(`  gate ${gate}: ${n}/${runSpecs.length} (${((Date.now() - t) / 1000).toFixed(0)} s)`);
  }
  console.error(`gate ${gate}: ${runSpecs.length} characters in ${((Date.now() - t) / 1000).toFixed(1)} s`);
}
clearTrustGate();

/* ---- summary --------------------------------------------------------------------------------- */
const numericDiff = (a, b) => {
  const out = [];
  const keys = new Set([...Object.keys(a?.numbers ?? {}), ...Object.keys(b?.numbers ?? {})]);
  for (const k of keys) {
    const x = a?.numbers?.[k];
    const y = b?.numbers?.[k];
    if (stableJson(x) === stableJson(y)) continue;
    out.push({ k, rec: x, twin: y, delta: typeof x === 'number' && typeof y === 'number' ? x - y : null });
  }
  return out.sort((p, q) => (p.k < q.k ? -1 : 1));
};
const recordSummary = [];
const noDiff = { off: [], on: [] };
for (const plan of recordPlans) {
  if (ONLY && !result[plan.charId]) continue;
  const pairs = [{ charId: plan.charId, twinId: plan.twinId, label: 'base' }, ...plan.extra];
  const rid = `${plan.rec.bucket}/${plan.rec.id}`;
  const row = { record: rid, fields: plan.rec.fields, gates: {} };
  for (const gate of ['off', 'on']) {
    const per = [];
    for (const p of pairs) {
      const A = result[p.charId]?.gates?.[gate];
      const B = result[p.twinId]?.gates?.[gate];
      if (!A || !B) continue;
      const d = numericDiff(A, B).filter((x) => !x.k.startsWith('pc.') && !x.k.startsWith('summary.'));
      per.push({ label: p.label, changed: d.map((x) => `${x.k}: ${x.twin} -> ${x.rec}`) });
    }
    row.gates[gate] = per;
    if (per.every((p) => !p.changed.length)) {
      // why? gate dark / build error / not reachable / skill already trained
      const A = result[plan.charId]?.gates?.[gate];
      let reason;
      const gatedRec = DB.on[plan.rec.bucket]?.[plan.rec.id];
      const darkPaths = gate === 'on' ? plan.rec.paths.filter((p) => getPath(gatedRec, p.split('.')) === undefined) : [];
      if (A?.buildError) reason = `build throws: ${A.buildError}`;
      else if (gate === 'on' && darkPaths.length === plan.rec.paths.length) reason = `gate dark (trust ledger strips ${darkPaths.join(', ')})`;
      else {
        const bucket = plan.rec.bucket;
        if (A?.holdsRecord === false) reason = 'not reachable: the built character does not hold the record';
        else if (bucket === 'backgrounds') {
          const bg = dbOff.backgrounds[plan.rec.id];
          const twin = result[plan.twinId]?.gates?.[gate];
          const sk = bg.trainedSkill;
          const lore = bg.trainedLore ? `lore:${String(bg.trainedLore).toLowerCase().replace(/\s+lore$/i, '').replace(/[^a-z0-9]+/g, '-')}` : null;
          const already = sk && twin?.numbers?.[`skill.${sk}.rank`] && twin.numbers[`skill.${sk}.rank`] !== 'untrained';
          reason = already ? `skill ${sk} already trained without the background${lore ? '; its Lore adds no number row either' : ''}` : 'effect not modeled (no number moves)';
        } else if (gate === 'on' && darkPaths.length) reason = `partly gate dark (${darkPaths.join(', ')}); the rest moves no number`;
        else reason = 'effect not modeled, or it moves no number this character shows';
      }
      noDiff[gate].push({ record: rid, fields: plan.rec.fields, reason });
    }
  }
  recordSummary.push(row);
}

// today's breakdown-sum failures, by stat kind
const sumFails = { off: {}, on: {} };
for (const [cid, c] of Object.entries(result))
  for (const [gate, g] of Object.entries(c.gates))
    for (const [ref, b] of Object.entries(g.breakdowns ?? {})) {
      if (b.ok !== false) continue;
      const kind = ref.startsWith('skill.lore:') ? 'lore' : ref.split('.')[0];
      const bucket = (sumFails[gate][kind] ??= { count: 0, characters: new Set(), example: null });
      bucket.count++;
      bucket.characters.add(cid);
      if (!bucket.example) {
        const sum = b.p.reduce((s, p) => s + (Number(p[2]) || 0), 0);
        bucket.example = { character: cid, ref, total: b.t, partsSum: sum, parts: b.p.map((p) => `${p[0]}${p[1] ? ` (${p[1]})` : ''} ${p[2]}`) };
      }
    }
for (const g of Object.values(sumFails)) for (const k of Object.keys(g)) g[k] = { count: g[k].count, characters: g[k].characters.size, example: g[k].example };

// known cases — the instrument checked against records whose effect we already know
const known = [];
const expectDelta = (label, rid, gate, stat, want) => {
  const plan = recordPlans.find((p) => `${p.rec.bucket}/${p.rec.id}` === rid);
  if (!plan) return known.push({ label, gate, ok: false, got: 'record has no plan' });
  const A = result[plan.charId]?.gates?.[gate]?.numbers?.[stat];
  const B = result[plan.twinId]?.gates?.[gate]?.numbers?.[stat];
  const got = typeof A === 'number' && typeof B === 'number' ? A - B : `${B} -> ${A}`;
  known.push({ label, gate, stat, ok: typeof want === 'function' ? want(A, B) : got === want, got });
};
for (const gate of ['off', 'on']) {
  expectDelta('Peerless Form: Fortitude +2', 'feats/peerless-form', gate, 'save.fortitude', 2);
  expectDelta('Peerless Form: Will +2', 'feats/peerless-form', gate, 'save.will', 2);
  expectDelta('Peerless Form: Reflex unchanged', 'feats/peerless-form', gate, 'save.reflex', 0);
  expectDelta('Fleet: land Speed +5', 'feats/fleet', gate, 'speed.land', 5);
  expectDelta('Toughness: max HP +level', 'feats/toughness', gate, 'hp.max', clampLvl(dbOff.feats.toughness?.level));
  const mis = dbOff.backgrounds.missionary;
  if (mis?.trainedSkill) expectDelta(`Missionary: trained in ${mis.trainedSkill}`, 'backgrounds/missionary', gate, `skill.${mis.trainedSkill}.rank`, (a, b) => a === 'trained' && b === 'untrained');
  // the first item whose passive skill bonus names a plain skill (not a Lore)
  const it = recordPlans.find((p) => p.rec.bucket === 'items' && Object.entries(dbOff.items[p.rec.id]?.passiveEffects?.skills ?? {}).some(([k, v]) => !k.startsWith('lore:') && v > 0));
  if (it) {
    const [sk, v] = Object.entries(dbOff.items[it.rec.id].passiveEffects.skills).find(([k, x]) => !k.startsWith('lore:') && x > 0);
    expectDelta(`${dbOff.items[it.rec.id].name}: ${sk} +${v}`, `items/${it.rec.id}`, gate, `skill.${sk}`, v);
  }
  expectDelta("Trudd's Strength (rune): athletics +1", 'runes/trudds-strength', gate, 'skill.athletics', 1);
  expectDelta('Belt of Good Health: max HP +', 'items/belt-of-good-health', gate, 'hp.max', (a, b) => typeof a === 'number' && a > b);
}

/** Record characters that do not hold the record they were made for (whatever their numbers say). */
const notHeld = { off: [], on: [] };
for (const [cid, c] of Object.entries(result))
  if (c.group === 'record') for (const [g, x] of Object.entries(c.gates)) if (x.holdsRecord !== true) notHeld[g].push(`${cid}: ${x.holdsRecord ?? x.buildError ?? x.playError}`);

const fieldCounts = {};
for (const r of records) for (const f of r.fields) {
  fieldCounts[f] ??= {};
  fieldCounts[f][r.bucket] = (fieldCounts[f][r.bucket] ?? 0) + 1;
}
const groupCounts = {};
for (const s of runSpecs) groupCounts[s.group] = (groupCounts[s.group] ?? 0) + 1;
const errors = { off: 0, on: 0 };
for (const c of Object.values(result)) for (const [g, x] of Object.entries(c.gates)) if (x.buildError || x.playError) errors[g]++;

const summary = {
  takenAt: new Date().toISOString(),
  headSha: (() => {
    try {
      return readFileSync('.git/HEAD', 'utf8').trim();
    } catch {
      return null;
    }
  })(),
  coreSha: sha(readFileSync('public/core.json')),
  sweepLevels: SWEEP_LEVELS,
  only: ONLY ? String(ONLY) : null,
  gates: ['off', 'on'],
  characters: runSpecs.length,
  charactersByGroup: groupCounts,
  buildOrPlayErrors: errors,
  item10RecordsByField: fieldCounts,
  item10Records: records.length,
  item10Unreachable: unreachable,
  sumRule:
    'sumOk = (sum of parts[].value) === the number at the start of totalText. Every explainStat case is checked by that one rule: ' +
    'AC, class DC, spell DC, special DC and attribute scores carry their base as an explicit "Base 10" part; HP and Speed are plain sums ' +
    '(ancestry + per-level / ancestry Speed + increases + penalty + temporary); a battle-form AC and a manual max HP are a single part; ' +
    'initiative reuses the parts of the statistic it is rolled with. A totalText with no leading number gives ok: null.',
  breakdownSumFailuresToday: sumFails,
  knownCases: known,
  recordsWithNoDifference: noDiff,
  recordCharactersNotHoldingTheirRecord: notHeld,
  seconds: Math.round((Date.now() - T0) / 1000),
};

/* ---- write or compare ------------------------------------------------------------------------ */
const snapshot = { summary, records: recordSummary, characters: result };
if (has('--compare')) {
  const basePath = arg('--compare');
  const before = JSON.parse(readFileSync(basePath, 'utf8'));
  // With --only the new run is a slice on purpose: compare that slice, never call the rest "missing".
  if (ONLY) before.characters = Object.fromEntries(Object.entries(before.characters).filter(([cid]) => ONLY.test(cid)));
  const res = compareSnapshots(before, snapshot, arg('--allow'));
  // A sliced or planted run never overwrites the full latest run.
  const newPath = basePath.replace(/\.json$/, '') + (ONLY || PLANT ? '.slice.json' : '.latest.json');
  writeFileSync(newPath, JSON.stringify(snapshot));
  console.log(`(new run written to ${newPath}; ${summary.seconds} s)`);
  printCompare(res, basePath.replace(/\.json$/, '') + '.compare.txt');
  process.exit(res.numbers.length || res.missing.length ? 1 : 0);
}
const out = arg('--out') ?? DEFAULT_OUT;
writeFileSync(out, JSON.stringify(snapshot));
const kb = Math.round(JSON.stringify(snapshot).length / 1024);
console.log(`wrote ${out} (${kb} KB) in ${summary.seconds} s`);
console.log(`characters: ${summary.characters} x 2 gates  ${JSON.stringify(groupCounts)}`);
console.log(`build/play errors: ${JSON.stringify(errors)}`);
console.log(`item-10 records: ${records.length} (${unreachable.length} not reachable)`);
console.log('breakdown-sum failures today (count of breakdowns / characters):');
for (const gate of ['off', 'on']) console.log(`  gate ${gate}: ` + Object.entries(sumFails[gate]).map(([k, v]) => `${k} ${v.count}/${v.characters}`).join(', '));
console.log('known cases:');
for (const k of known) console.log(`  ${k.ok ? 'ok  ' : 'MISS'} [gate ${k.gate}] ${k.label}: ${JSON.stringify(k.got)}`);
console.log(`records whose twin shows no number difference: off ${noDiff.off.length}, on ${noDiff.on.length}`);
for (const gate of ['off', 'on']) {
  const by = {};
  for (const r of noDiff[gate]) (by[r.reason.replace(/\(.*\)/, '(...)')] ??= []).push(r.record);
  for (const [why, ids] of Object.entries(by)) console.log(`  [gate ${gate}] ${ids.length} — ${why}: ${ids.slice(0, 8).join(' ')}${ids.length > 8 ? ' …' : ''}`);
}
console.log(`record characters not holding their record: off ${notHeld.off.length}, on ${notHeld.on.length}`);
for (const x of [...notHeld.off.slice(0, 10)]) console.log(`  [off] ${x}`);
