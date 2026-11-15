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
 *   overrides: the SAMPLE overrides object from test/overrides-write.test.tsx, plus hand-made ones —
 *             every one with a `<id>#none` twin (the same build without overrides, same play state),
 *             so test/fixtures/tweaks-legacy-before.json can pin each one as a DELTA (see below);
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
 * THE PIPELINE IS THE APP'S (src/App.tsx): build with buildCharacter(build, db) — which lays the
 * character's own Overrides content-edits over db itself through contentFor (src/rules/blocks/content.ts,
 * the one content path, Tweaks item 7) — overlay play state with applyPlayState(built,
 * initialPlay(built)+state, db) (the same door inside), then the sheet reads
 * playerFacingContent(contentFor(db, character), inventory). The db is merged the way
 * src/data/index.ts:mergeWithSeed merges it (seed + gated core + catalog modes, EXCLUDED_FEATS dropped,
 * the four hidden-list sets, ensureTraits) with descriptions written back like test/_content.ts.
 *
 * Run (jiti, NOT node: it imports .ts):
 *   npx jiti scripts/blocks-parity-snapshot.mjs [--out work/.blocks-parity-baseline.json]
 *   npx jiti scripts/blocks-parity-snapshot.mjs --compare work/.blocks-parity-baseline.json [--against <file>]
 *                                               [--allow <regex on character id>] [--allow-stat <regex on stat key>]
 *   npx jiti scripts/blocks-parity-snapshot.mjs --self-test [--baseline <file>]
 *   npx jiti scripts/blocks-parity-snapshot.mjs --write-fixture [--fixture-out <file>] [--allow-dirty]
 *   (--only <regex> restricts which character ids are built; for quick experiments, never for a baseline)
 *
 * --allow / --allow-stat: a NUMBER difference moves out of the failing list only when its character id
 * matches --allow AND (when given) its stat key matches --allow-stat — so "Thievery on this character may
 * move" never also lets that character's AC move (Tweaks part B, plan section 3.6).
 *
 * SKILL ORDER (work/skill-rank-level-by-level/plan.md, WP0 step 6): each gate also carries `rankStats` (the
 * rank-shaped stats of the stored character, compared like numbers but kept OUT of `numbers`, so part B's
 * legacy deltas never see them); the `skillorder:*` family holds every guard case of
 * test/fixtures/skill-order-cases.ts and `tweaks-browser:*` part B's three browser characters;
 *   --allow-pairs <json file>   an array of "<cid>|<stat>": exactly those pairs may move (any gate);
 *   --legacy-check <baseline>   every `legacy.*` rank stat (the engine's live path, from WP3) must equal the
 *                               baseline's `build.*` twin (the default, `--legacy-twin build`);
 *   --legacy-twin build|legacy  `legacy`: the baseline's OWN `legacy.*` of the same character and gate (Tweaks
 *                               phase 2 WP0: like with like; a baseline with none fails);
 *   --legacy-allow <regex>      character ids to skip, counted ("allowed: N") with their spec cases printed
 *                               ("skipped cases: …"); with none given there is no allow.
 *
 * THE HEAVY-JOB LOCK. Every run that builds characters (a snapshot, an engine compare, --write-fixture)
 * takes scripts/lib/heavy-lock.mjs's lock first — the one scripts/vt.mjs takes — so a compare never runs
 * beside vitest (the load that makes vitest start no worker and report a green run of nothing, and makes
 * this run's 20 s take minutes). It waits for a live holder and never fails on one. --self-test and
 * `--compare A --against B` only read two JSON files and take no lock.
 *
 * FOR VITEST (import, never a child process): `snapshotSubset(onlyRegex)` builds the matching characters
 * through the same pipeline and returns `{ characters }` in the snapshot's own shape; `legacyDeltas(characters)`
 * turns the `overrides:*` ones into per-stat deltas against their `#none` twins, the shape of
 * test/fixtures/tweaks-legacy-before.json. Importing this file runs no CLI and loads no engine until one
 * of those is called. A test calling them already runs under vt.mjs's lock (HEAVY_LOCK is inherited).
 *
 * THE LEGACY FIXTURE (--write-fixture). test/fixtures/tweaks-legacy-before.json holds, per `overrides:*`
 * character, its per-stat DELTA against its `#none` twin (with overrides minus without; a rank or text
 * that differs is stored as { twin, with }), never absolute numbers — so an `npm run data` that moves a
 * book number moves both twins and the fixture still holds. Stats a character's `fixtureAbsolute` names
 * (a manual max HP has no meaningful twin) are stored as values instead. It records the engine commit it
 * was taken at, and refuses to write while src/ has uncommitted changes (--allow-dirty overrides, for
 * experiments only), because the commit is the claim "these are that engine's numbers".
 * RE-TAKE RECIPE (after `npm run data` changed a DELTA itself): never on a newer engine, which would
 * bake its own numbers in. Make a worktree at the fixture's `engineCommit` (git worktree add <dir>
 * <engineCommit>), copy THIS script (and scripts/lib/heavy-lock.mjs) plus the new public/core.json,
 * public/core-descriptions.json and the re-stamped src/data/trust-ledger.json (src/data/trustGate.ts
 * imports it, so the gate-on half reads it) into it, run `npx jiti scripts/blocks-parity-snapshot.mjs
 * --write-fixture` there, and copy the fixture back. The dirty-src refusal ignores exactly the copied
 * data files (DATA_IN_SRC), so the recipe needs no --allow-dirty. The fixture's `header.retake` says the same.
 *
 * THE SAMPLE BELOW IS FROZEN IN THE OLD SHAPE (no `mode` / `source` / `moved` in its meta, no `v`): the
 * `overrides:test-sample:*` characters are the main old-character fixture of Tweaks part B and must stay
 * an OLD character. The vitest SAMPLE (test/overrides-write.test.tsx) may move on; this copy does not.
 *
 * Exit codes: snapshot 0; compare 1 when any NUMBER differs that --allow/--allow-stat does not cover;
 * self-test 0 only when the compare caught every planted change.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { withHeavyLock } from './lib/heavy-lock.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const at = (p) => join(ROOT, p);
const defaultImp = (p) => import(pathToFileURL(at(p)).href);
/** Run as a CLI (node / jiti put this file in argv[1]) — never when vitest imports it. */
const IS_MAIN = (() => {
  try {
    return !!process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
  } catch {
    return false;
  }
})();

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (name) => argv.includes(name);
const DEFAULT_OUT = 'work/.blocks-parity-baseline.json';
export const LEGACY_FIXTURE = 'test/fixtures/tweaks-legacy-before.json';

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
 *  `id` is normalised defensively because a saved character carries one). `skillHistory` (the engine's
 *  per-level skill history, skill-order plan D12) is DROPPED, so `build.hash` stays history-blind (plan
 *  D18): one new derived field would otherwise move every hash and hide the real moves. Its content is
 *  compared through the `history.<key>` rank stats of the `skillorder:*` family instead. */
export function normaliseCharacter(ch) {
  const { skillHistory: _history, ...rest } = ch;
  return { ...rest, id: '<id>' };
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
/**
 * The compared stats of a snapshot: every `numbers` entry, every breakdown total, the build hash and —
 * skill-order plan D18 — the rank stats of `g.rankStats` (a SIBLING of `numbers`, never inside it: part B's
 * `legacyDeltas` and the save-stamp test compare `numbers` whole, so a new key there would move all three).
 * The `legacy.*` rank stats are left out: they are the live path's own reading and only `--legacy-check`
 * compares them (against the baseline's `build.*` twins). `rankStatKeys` names the keys that came from
 * `rankStats`, and `withRankStats` the `<cid>|<gate>` rows that carry the field at all.
 */
function flattenNumbers(snap) {
  const m = new Map();
  m.rankStatKeys = new Set();
  m.withRankStats = new Set();
  for (const [cid, c] of Object.entries(snap.characters)) {
    for (const [gate, g] of Object.entries(c.gates ?? {})) {
      for (const [k, v] of Object.entries(g.numbers ?? {})) m.set(`${cid}|${gate}|${k}`, v);
      for (const [k, b] of Object.entries(g.breakdowns ?? {})) m.set(`${cid}|${gate}|explain.${k}.total`, b.t);
      m.set(`${cid}|${gate}|build.hash`, g.buildHash);
      if (g.rankStats) {
        m.withRankStats.add(`${cid}|${gate}`);
        for (const [k, v] of Object.entries(g.rankStats)) {
          if (k.startsWith('legacy.')) continue;
          m.set(`${cid}|${gate}|${k}`, v);
          m.rankStatKeys.add(`${cid}|${gate}|${k}`);
        }
      }
    }
  }
  return m;
}

/** `allow` matches character ids; `allowStat` (optional) narrows it to stat keys — a difference is
 *  allowed only when BOTH match. `allowStat` without `allow` allows nothing. `allowPairs` (optional, an
 *  iterable of `"<cid>|<stat>"`, `--allow-pairs <json file>`) allows exactly the listed character + stat
 *  pairs, in every gate — a classified move outside a gate's stat regex (an `initiative` that follows a rank). */
export function compareSnapshots(before, after, allow, allowStat, allowPairs) {
  const allowRe = allow ? new RegExp(allow) : null;
  const allowStatRe = allowStat ? new RegExp(allowStat) : null;
  const pairs = new Set(allowPairs ?? []);
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
    // A rank stat is comparable only when BOTH runs took rank stats for that row (a baseline older than the
    // field has none at all; that is a different instrument, not 40 000 moved numbers).
    if (bn.rankStatKeys.has(k) || an.rankStatKeys.has(k)) {
      const row = k.split('|').slice(0, 2).join('|');
      if (!bn.withRankStats.has(row) || !an.withRankStats.has(row)) continue;
    }
    const b = bn.has(k) ? bn.get(k) : '<absent>';
    const a = an.has(k) ? an.get(k) : '<absent>';
    // stableJson: a string stat compares as `!==` would, a number as a number, an object by its content.
    if (stableJson(b) === stableJson(a)) continue;
    const [, gate, stat] = k.split('|');
    const row = { cid, gate, stat, before: b, after: a };
    const ok = (!!allowRe && allowRe.test(cid) && (!allowStatRe || allowStatRe.test(stat))) || pairs.has(`${cid}|${stat}`);
    (ok ? allowed : numbers).push(row);
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
  L(`NUMBER differences: ${res.numbers.length}` + (res.allowed.length ? `  (+${res.allowed.length} allowed by --allow${has('--allow-stat') ? ' + --allow-stat' : ''})` : ''));
  L(`breakdown-part differences: ${res.parts.length}`);
  L(`sumOk changes: ${res.sums.length}` + (res.sums.length ? ` (${res.sums.filter((s) => s.after === true).length} now sum, ${res.sums.filter((s) => s.after === false).length} stopped summing)` : ''));
  if (res.missing.length) L(`character set changed: ${res.missing.length}`);
  const full = [...lines];
  const F = (s) => full.push(s);
  F('');
  F('== (1) NUMBER differences ==');
  for (const r of res.numbers) F(`  ${r.cid} [gate ${r.gate}] ${r.stat}: ${fmt(r.before)} -> ${fmt(r.after)}`);
  if (res.allowed.length) {
    F('== (1b) NUMBER differences allowed by --allow / --allow-stat ==');
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

/**
 * `--legacy-check <baseline>` (skill-order plan G11): the engine's LIVE path — the skill ranks it computes in
 * today's code order, which the Builder notice compares against and part B's at-slot sort reads — must equal
 * the baseline engine's own result on every character. For every character and gate of `snap` that carries
 * `legacy.*` rank stats, each must equal the baseline's `build.*` twin (`legacy.skillRanks` ↔
 * `build.skillRanks`, …). Any difference fails. Pure over two snapshot objects.
 *
 * Tweaks phase 2 WP0 (plan section 1, round 2 s1 + round 3 t3), two options:
 *   `twin: 'build'` (the default, byte for byte what this was) or `'legacy'`: compare the new `legacy.*` with
 *     the baseline's OWN `legacy.*` of the same character and gate (like with like). The skill-order job made a
 *     snapshot's `legacy.*` and `build.*` differ on purpose (61 `skillorder:*` stats), so the default fails on a
 *     baseline taken after it; a baseline character or gate with no `legacy.*` stat is a difference
 *     ("no legacy twin in the baseline"), so an old baseline cannot pass silently.
 *   `allow`: a regex (or its source text) over character ids. A matching character is skipped and counted
 *     (`allowed` = legacy stats skipped, `allowedChars` = characters skipped), and its spec case is returned in
 *     `skippedCases` (sorted, distinct): an `overrides:p2-<case>[…]:<class>-L<n>[#none]` id is cut to
 *     `overrides:p2-<case>[…]`, any other id is listed whole. A checker reads that list to see WHICH characters
 *     the allow hid, not only how many.
 */
export function legacyCheck(baseline, snap, { twin: twinMode = 'build', allow = null } = {}) {
  if (twinMode !== 'build' && twinMode !== 'legacy') throw new Error(`--legacy-twin: expected build or legacy, got "${twinMode}"`);
  const re = allow == null || allow === '' ? null : allow instanceof RegExp ? allow : new RegExp(allow);
  const bad = [];
  let checked = 0;
  let allowed = 0;
  const skipped = new Set();
  const skippedCases = new Set();
  for (const [cid, c] of Object.entries(snap.characters)) {
    const skip = !!re && re.test(cid);
    for (const [gate, g] of Object.entries(c.gates ?? {})) {
      for (const [k, v] of Object.entries(g.rankStats ?? {})) {
        if (!k.startsWith('legacy.')) continue;
        if (skip) {
          allowed++;
          skipped.add(cid);
          const parts = cid.split(':');
          skippedCases.add(/^overrides:p2-/.test(cid) && parts.length >= 3 ? `${parts[0]}:${parts[1]}` : cid);
          continue;
        }
        checked++;
        const twin = twinMode === 'legacy' ? k : `build.${k.slice('legacy.'.length)}`;
        const bg = baseline.characters?.[cid]?.gates?.[gate];
        const want = bg?.rankStats?.[twin];
        if (want === undefined) bad.push({ cid, gate, stat: k, before: twinMode === 'legacy' ? `<no legacy twin (${twin}) in the baseline>` : `<no ${twin} in the baseline>`, after: v });
        else if (stableJson(want) !== stableJson(v)) bad.push({ cid, gate, stat: k, before: want, after: v });
      }
    }
  }
  return { bad, checked, allowed, allowedChars: skipped.size, skippedCases: [...skippedCases].sort() };
}

/* ---------------------------------------------------------------------------------------------- */
/* self-test: plant changes in a copy of the baseline and prove the compare catches each            */
/* ---------------------------------------------------------------------------------------------- */
function selfTest(path) {
  const base = JSON.parse(readFileSync(path, 'utf8'));
  const clone = () => JSON.parse(JSON.stringify(base));
  const firstChar = Object.keys(base.characters).find((cid) => Object.keys(base.characters[cid].gates ?? {}).length);
  const gate = Object.keys(base.characters[firstChar].gates)[0];
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
    const r2 = compareSnapshots(base, m, '^' + esc(firstChar) + '$');
    check('--allow on that character moves it out of the failing list', r2.numbers.length === 0 && r2.allowed.length === 1);
    // 1b. --allow-stat: the character AND the stat must both match
    const r3 = compareSnapshots(base, m, '^' + esc(firstChar) + '$', '^' + esc(key) + '$');
    check('--allow + an --allow-stat naming that stat allows it', r3.numbers.length === 0 && r3.allowed.length === 1);
    const r4 = compareSnapshots(base, m, '^' + esc(firstChar) + '$', '^planted-other-stat$');
    check('--allow + an --allow-stat naming ANOTHER stat still fails it', r4.numbers.length === 1 && r4.allowed.length === 0);
    const r5 = compareSnapshots(base, m, undefined, '^' + esc(key) + '$');
    check('--allow-stat alone allows nothing', r5.numbers.length === 1 && r5.allowed.length === 0);
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
  // 7. the legacy-fixture deltas see a moved number on a with-overrides character, and only there
  {
    const ov = Object.keys(base.characters).find((cid) => /^overrides:/.test(cid) && !isTwinId(cid) && base.characters[twinIdOf(cid)]);
    if (ov) {
      const m = clone();
      const g0 = Object.keys(m.characters[ov].gates)[0];
      const nums = m.characters[ov].gates[g0].numbers;
      const key = Object.keys(nums).find((k) => typeof nums[k] === 'number');
      const d0 = legacyDeltas(base.characters);
      nums[key] += 1;
      const d1 = legacyDeltas(m.characters);
      check(`a moved number on ${ov} changes its legacy delta (${key})`, stableJson(d0[ov].gates[g0]) !== stableJson(d1[ov].gates[g0]));
      const others = Object.keys(d0).filter((c) => c !== ov);
      check('…and no other character\'s delta', others.every((c) => stableJson(d0[c]) === stableJson(d1[c])));
    } else check('the baseline has an overrides character with a #none twin (legacy deltas)', false);
  }
  // 8. skill-order plan D18 / G8 / G11 — the rank stats, `--allow-pairs` and `--legacy-check`. A baseline taken
  // before the rank stats existed has no `rankStats`: plant one on BOTH sides first (a field both runs carry).
  {
    const withRank = (snap) => {
      for (const c of Object.values(snap.characters))
        for (const g of Object.values(c.gates ?? {}))
          g.rankStats ??= { 'build.skillRanks': 'athletics:trained', 'build.skillFallbacks': '', 'build.skillIncreases': '', 'build.hashSansSkill': 'h' };
      return snap;
    };
    const b8 = withRank(clone());
    const clone8 = () => JSON.parse(JSON.stringify(b8));
    // 8a. a planted skillHistory does not move build.hash (normaliseCharacter drops it)
    {
      const ch = { id: 'x', name: 't', proficiencies: { skills: { athletics: 'trained' } } };
      const h0 = sha(stableJson(normaliseCharacter(ch)));
      const h1 = sha(stableJson(normaliseCharacter({ ...ch, skillHistory: { v: 1, steps: [{ level: 1, key: 'athletics' }], at: {} } })));
      check('a planted skillHistory leaves the build hash unchanged (history-blind hash)', h0 === h1);
      const h2 = sha(stableJson(normaliseCharacter({ ...ch, skillFallbacks: [{ featId: 'f', skill: 'athletics' }] })));
      check('…while any other new field still moves it', h0 !== h2);
    }
    // 8b. a planted skillFallbacks change is a difference in build.skillFallbacks, and nowhere else
    {
      const m = clone8();
      m.characters[firstChar].gates[gate].rankStats['build.skillFallbacks'] = 'kholo-lore:stealth';
      const r = compareSnapshots(b8, m);
      check('a planted skillFallbacks change is a NUMBER difference in build.skillFallbacks', r.numbers.length === 1 && r.numbers[0].stat === 'build.skillFallbacks');
    }
    // 8c. a rank stat never reaches legacyDeltas (it lives outside `numbers`)
    {
      const ov = Object.keys(b8.characters).find((cid) => /^overrides:/.test(cid) && !isTwinId(cid) && b8.characters[twinIdOf(cid)]);
      if (ov) {
        const m = clone8();
        for (const g of Object.values(m.characters[ov].gates)) g.rankStats['build.skillRanks'] = 'planted:legendary';
        check(`a planted rankStats change on ${ov} never appears in legacyDeltas`, stableJson(legacyDeltas(b8.characters)) === stableJson(legacyDeltas(m.characters)));
      } else check('the baseline has an overrides character with a #none twin (rank stats vs legacy deltas)', false);
    }
    // 8d. a baseline with NO rankStats against a run with them: the rank stats are skipped, not 40 000 rows
    {
      const r = compareSnapshots(clone(), b8);
      check('rank stats are compared only when both runs carry them', !r.numbers.length && !r.missing.length);
    }
    // 8e. --allow-pairs allows its exact pair and only it
    {
      const m = clone8();
      const nums = m.characters[firstChar].gates[gate].numbers;
      const [k1, k2] = Object.keys(nums).filter((k) => typeof nums[k] === 'number');
      nums[k1] += 1;
      nums[k2] += 1;
      const r = compareSnapshots(b8, m, undefined, undefined, [`${firstChar}|${k1}`]);
      check('--allow-pairs allows its listed character|stat pair', r.allowed.length === 1 && r.allowed[0].stat === k1);
      check('…and only it (the other moved stat still fails)', r.numbers.length === 1 && r.numbers[0].stat === k2);
      const r2 = compareSnapshots(b8, m, undefined, undefined, [`other-character|${k1}`]);
      check('…a pair naming another character allows nothing here', r2.numbers.length === 2);
    }
    // 8f. --legacy-check: a legacy stat equal to the baseline's build twin passes; a planted difference fails
    {
      const m = clone8();
      /* From WP3 on a snapshot carries the engine's own `legacy.*` stats on every character; the planted one is the
       * only one this check may count, so the copy drops them first (the baseline side keeps whatever it has). */
      for (const c of Object.values(m.characters))
        for (const g of Object.values(c.gates ?? {}))
          for (const k of Object.keys(g.rankStats ?? {})) if (k.startsWith('legacy.')) delete g.rankStats[k];
      const rs = m.characters[firstChar].gates[gate].rankStats;
      rs['legacy.skillRanks'] = b8.characters[firstChar].gates[gate].rankStats['build.skillRanks'];
      const ok = legacyCheck(b8, m);
      check('--legacy-check passes a legacy stat equal to the baseline', ok.checked === 1 && ok.bad.length === 0);
      rs['legacy.skillRanks'] = 'planted:legendary';
      const r = legacyCheck(b8, m);
      check('--legacy-check fails a planted legacy.skillRanks difference', r.bad.length === 1 && r.bad[0].stat === 'legacy.skillRanks');
      check('…and the legacy stat is never a NUMBER row of the plain compare', !compareSnapshots(b8, m).numbers.some((x) => x.stat.startsWith('legacy.')));
    }
    // 8g. Tweaks phase 2 WP0 (plan section 1, round 2 s1, round 3 t3): `--legacy-twin legacy`, `--legacy-allow` and the
    // skipped-cases list. A skillorder: id and an overrides:p2- id each carry ONE legacy.skillRanks, equal on both sides.
    {
      /* Both ids are PLANTED as copies of an existing character (the self-test needs no p2 or skill-order character in
       * the baseline it is pointed at: the default baseline predates both). */
      const so = 'skillorder:planted-case';
      const p2 = 'overrides:p2-planted-case:fighter-L5';
      if (!b8.characters[firstChar].gates[gate].rankStats) check('the baseline carries rank stats (the legacy flags)', false);
      else {
        const gateOf = (snap, cid) => Object.keys(snap.characters[cid].gates)[0];
        const pair = () => {
          const b = clone8();
          const m = clone8();
          for (const side of [b, m]) for (const cid of [so, p2]) side.characters[cid] = JSON.parse(JSON.stringify(side.characters[firstChar]));
          for (const side of [b, m])
            for (const c of Object.values(side.characters))
              for (const g of Object.values(c.gates ?? {})) for (const k of Object.keys(g.rankStats ?? {})) if (k.startsWith('legacy.')) delete g.rankStats[k];
          for (const cid of [so, p2]) for (const side of [b, m]) side.characters[cid].gates[gateOf(side, cid)].rankStats['legacy.skillRanks'] = 'athletics:trained';
          return { b, m };
        };
        const plant = (m, cid) => (m.characters[cid].gates[gateOf(m, cid)].rankStats['legacy.skillRanks'] = 'planted:legendary');
        const caseOfP2 = p2.split(':').slice(0, 2).join(':');
        {
          const { b, m } = pair();
          const r = legacyCheck(b, m, { twin: 'legacy' });
          check('--legacy-twin legacy: an unchanged copy passes (both ids checked)', r.checked === 2 && r.bad.length === 0 && r.allowed === 0);
          const d = legacyCheck(b, m);
          check('…and the default twin (build) is unchanged: it reads the baseline build.* twin', d.checked === 2);
        }
        {
          const { b, m } = pair();
          plant(m, so);
          const r = legacyCheck(b, m, { twin: 'legacy', allow: '^overrides:p2-' });
          check('--legacy-allow ^overrides:p2- never hides a planted skillorder: difference', r.bad.length === 1 && r.bad[0].cid === so && r.allowed === 1);
        }
        {
          const { b, m } = pair();
          plant(m, p2);
          const withAllow = legacyCheck(b, m, { twin: 'legacy', allow: '^overrides:p2-' });
          check('the same difference on an overrides:p2- id passes with the allow (counted and listed)', withAllow.bad.length === 0 && withAllow.allowed === 1 && withAllow.skippedCases.includes(caseOfP2));
          const noAllow = legacyCheck(b, m, { twin: 'legacy' });
          check('…and fails without it', noAllow.bad.length === 1 && noAllow.bad[0].cid === p2);
        }
        {
          const { b, m } = pair();
          delete b.characters[so].gates[gateOf(b, so)].rankStats['legacy.skillRanks'];
          const r = legacyCheck(b, m, { twin: 'legacy' });
          check('a baseline gate with its legacy.* stats deleted fails ("no legacy twin in the baseline")', r.bad.length === 1 && r.bad[0].cid === so && /no legacy twin/.test(String(r.bad[0].before)));
        }
        {
          const { b, m } = pair();
          const wide = legacyCheck(b, m, { twin: 'legacy', allow: 'p2-|skillorder:' });
          check('a too-wide allow (p2-|skillorder:) shows the skillorder: id in the skipped-cases list', wide.skippedCases.includes(so) && wide.skippedCases.includes(caseOfP2));
          const tight = legacyCheck(b, m, { twin: 'legacy', allow: '^overrides:p2-' });
          check('…and ^overrides:p2- never does', tight.skippedCases.length > 0 && tight.skippedCases.every((c) => /^overrides:p2-/.test(c)) && !tight.skippedCases.includes(so));
        }
      }
    }
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? `\nSELF-TEST FAILED (${failed} of ${results.length})` : `\nself-test passed (${results.length} checks): the compare can fail.`);
  // …and the CLI exit code on the planted number, through the same path --compare uses.
  return failed ? 1 : 0;
}

/* ---------------------------------------------------------------------------------------------- */
/* the legacy fixture: per overrides character, its numbers as deltas against its #none twin        */
/* ---------------------------------------------------------------------------------------------- */
export const twinIdOf = (cid) => `${cid}#none`;
export const isTwinId = (cid) => cid.endsWith('#none');

/**
 * Per OLD `overrides:*` character (isLegacyCharacter: twins and new-shape characters excluded), per gate: every NUMBER that differs from its `#none`
 * twin — a number as `with − twin`, anything else (a rank, a Strike's text, a stat only one side has)
 * as `{ twin, with }`. Stats the character's `meta.fixtureAbsolute` regex names are recorded as their own
 * values under `absolute` instead (no meaningful twin: a manual max HP). A build or play error is
 * recorded as such. Pure over a snapshot's `characters` map.
 */
/**
 * An OLD-Overrides character of the legacy fixture: an `overrides:*` id, not a twin, and not a NEW-shape
 * character (part B's own stamped meta — `overrides:new-shape:*` or `meta.newShape`, plan WP1). The one
 * place that decides it, so the fixture writer and the coverage test agree.
 */
export const isLegacyCharacter = (cid, c) => /^overrides:/.test(cid) && !isTwinId(cid) && !/^overrides:new-shape:/.test(cid) && !c?.meta?.newShape;

export function legacyDeltas(characters) {
  const out = {};
  for (const cid of Object.keys(characters).sort()) {
    if (!isLegacyCharacter(cid, characters[cid])) continue;
    const c = characters[cid];
    const tid = twinIdOf(cid);
    const t = characters[tid];
    const absRe = c.meta?.fixtureAbsolute ? new RegExp(c.meta.fixtureAbsolute) : null;
    const row = { twin: t ? tid : null, gates: {} };
    for (const [gate, g] of Object.entries(c.gates ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))) {
      const tg = t?.gates?.[gate];
      const err = g.buildError ?? g.playError ?? tg?.buildError ?? tg?.playError;
      if (err) {
        row.gates[gate] = { error: err };
        continue;
      }
      const deltas = {};
      const absolute = {};
      const keys = new Set([...Object.keys(g.numbers ?? {}), ...Object.keys(tg?.numbers ?? {})]);
      for (const k of [...keys].sort()) {
        const a = g.numbers?.[k];
        if (absRe && absRe.test(k)) {
          absolute[k] = a === undefined ? '<absent>' : a;
          continue;
        }
        if (!tg) continue;
        const b = tg.numbers?.[k];
        if (stableJson(a) === stableJson(b)) continue;
        if (typeof a === 'number' && typeof b === 'number') deltas[k] = a - b;
        else deltas[k] = { twin: b === undefined ? '<absent>' : b, with: a === undefined ? '<absent>' : a };
      }
      row.gates[gate] = { deltas, ...(Object.keys(absolute).length ? { absolute } : {}) };
    }
    out[cid] = row;
  }
  return out;
}

/* ---------------------------------------------------------------------------------------------- */
/* the engine — loaded once, on first use                                                           */
/* ---------------------------------------------------------------------------------------------- */
let ENGINE = null;
/**
 * `importer(repoRelativePath)` loads an engine module. The default works when this file is the jiti
 * entry or is loaded by vitest; a jiti ENTRY that imports this file must pass its own (jiti loads an
 * imported .mjs natively, and a native import() cannot load .ts): `loadEngine((p) => import(ROOT + p))`.
 */
export async function loadEngine(importer) {
  if (ENGINE) return ENGINE;
  const imp = importer ?? defaultImp;
  const buildModule = await imp('src/rules/build.ts');
  const { buildCharacter, emptyBuild, levelGrants } = buildModule;
  /* Skill order (plan D19): from WP3 the engine exports the live path's own result; absent before that. */
  const skillOrderLegacyOf = typeof buildModule.skillOrderLegacyOf === 'function' ? buildModule.skillOrderLegacyOf : null;
  const { FEAT_RANK_FEAT_GRANTS } = await imp('src/rules/featFeatGrants.ts');
  const { importCharacter } = await imp('src/data/transfer.ts');
  const { SKILL_ORDER_CASES } = await imp('test/fixtures/skill-order-cases.ts');
  const { contentFor } = await imp('src/rules/blocks/content.ts');
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

  /* ---- the databases ------------------------------------------------------------------------- */
  const core = JSON.parse(readFileSync(at('public/core.json'), 'utf8'));
  {
    // Descriptions back onto the records (as test/_content.ts and the app's loadDescriptions do): a
    // number that read prose would otherwise differ from the app's.
    const desc = JSON.parse(readFileSync(at('public/core-descriptions.json'), 'utf8'));
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
    // Tweaks part B case C: a Con shift is a max-HP term every trust gate keeps (Azata's Grace's own
    // max-HP bonus is dark at gate on).
    'parity-user-con-mod': {
      id: 'parity-user-con-mod',
      name: 'Parity: +1 Constitution modifier',
      category: 'Custom',
      modifiers: [{ value: 1, type: 'status', target: 'ability', detail: 'con' }],
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

  /* ---- helpers ------------------------------------------------------------------------------- */
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
  /** The featPicks key of the first `cat` slot a class has at `level` — `${level}:${cat}:${i}`, where i is
   *  the slot's index in levelGrants' featSlots (build.ts reads featPicks by that key). */
  const slotOf = (classId, level, cat) => {
    const g = levelGrants(level, classId, dbOff, null, undefined, null, null, false, []);
    const i = g.featSlots.findIndex((s) => s === cat);
    if (i < 0) throw new Error(`no ${cat} slot at level ${level} for ${classId}`);
    return `${level}:${cat}:${i}`;
  };

  /* ---- character specs ----------------------------------------------------------------------- */
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

  // 2. overrides — every character with a `<id>#none` twin: the same build and play, no overrides
  const withTwin = (s) => {
    add({ group: 'overrides', keepFull: true, ...s });
    const { overrides: _drop, ...bare } = s.build;
    add({ id: twinIdOf(s.id), group: 'overrides', keepFull: true, build: bare, ...(s.play ? { play: s.play } : {}) });
  };
  /* The SAMPLE object from test/overrides-write.test.tsx (2026-10-20), copied verbatim: a non-empty
   * value for every BuildOverrides key that test declares. Put on a level-5 fighter.
   * FROZEN in the old shape (no mode / source / moved, no `v`) — see the header. */
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
  // A max HP set has no meaningful twin for its HP numbers: those are recorded as values in the fixture.
  const HP_ABSOLUTE = '^(hp\\.max|pc\\.maxHP|pc\\.hpCurrent|summary\\.hpCur|summary\\.hpMax)$';
  withTwin({ id: 'overrides:test-sample:fighter-L5', build: { ...fill(mk('fighter', 5)), overrides: SAMPLE }, meta: { fixtureAbsolute: HP_ABSOLUTE } });
  withTwin({ id: 'overrides:test-sample:wizard-L5', build: { ...fill(mk('wizard', 5)), overrides: SAMPLE }, meta: { fixtureAbsolute: HP_ABSOLUTE } });
  // proficiencies: a skill set to trained plus a later skill increase on it; a rank set LOWER than computed
  const PROF_L7 = { ...fill(mk('fighter', 7)), skillIncreases: { 3: 'athletics', 5: 'thievery', 7: 'stealth' } };
  withTwin({ id: 'overrides:proficiencies:fighter-L7', build: { ...PROF_L7, overrides: { proficiencies: { thievery: 'trained', fortitude: 'trained', perception: 'trained' } } } });
  // …the same character with the old card hidden (overridesEnabled false, no `v`): its changes always
  // counted, so every number equals its sibling's (Tweaks part B reads it ON, decision B4).
  withTwin({
    id: 'overrides:hidden-card:fighter-L7',
    build: { ...PROF_L7, options: { ...(PROF_L7.options ?? {}), overridesEnabled: false }, overrides: { proficiencies: { thievery: 'trained', fortitude: 'trained', perception: 'trained' } } },
  });
  // addedFeats: Flexible Spellcaster Dedication given to a caster, and Toughness
  const FLEX = dbOff.feats['flexible-spellcaster-dedication'] ? 'flexible-spellcaster-dedication' : null;
  for (const [cls, L] of [['cleric', 4], ['wizard', 8]]) {
    const added = [...(FLEX ? [{ featId: FLEX, level: 2, category: 'class' }] : []), { featId: 'toughness', level: 3, category: 'general' }];
    withTwin({ id: `overrides:addedFeats:${cls}-L${L}`, build: { ...fill(mk(cls, L)), overrides: { addedFeats: added } } });
  }
  // maxHp — and case C's fixture: the set plus a mode with a max-HP bonus (Azata's Grace), with and
  // without Drained (today the set returns early and the mode is lost; part B keeps the mode on top).
  const WIZ5 = fill(mk('wizard', 5));
  withTwin({ id: 'overrides:maxHp:wizard-L5', build: { ...WIZ5, overrides: { maxHp: 77 } }, meta: { fixtureAbsolute: HP_ABSOLUTE } });
  withTwin({ id: 'overrides:maxHp:wizard-L5#drained', build: { ...WIZ5, overrides: { maxHp: 77 } }, play: { conditions: [{ id: 'drained', value: 2 }] }, meta: { fixtureAbsolute: HP_ABSOLUTE } });
  withTwin({ id: 'overrides:maxHp:wizard-L5#mode', build: { ...WIZ5, overrides: { maxHp: 77 } }, play: { activeModes: ['item-azatas-grace'] }, meta: { fixtureAbsolute: HP_ABSOLUTE } });
  withTwin({
    id: 'overrides:maxHp:wizard-L5#mode-drained',
    build: { ...WIZ5, overrides: { maxHp: 77 } },
    play: { activeModes: ['item-azatas-grace'], conditions: [{ id: 'drained', value: 2 }] },
    meta: { fixtureAbsolute: HP_ABSOLUTE },
  });
  withTwin({ id: 'overrides:maxHp:wizard-L5#con-mode', build: { ...WIZ5, overrides: { maxHp: 77 } }, play: { activeModes: ['parity-user-con-mod'] }, meta: { fixtureAbsolute: HP_ABSOLUTE } });
  // attributes
  withTwin({ id: 'overrides:attributes:champion-L3', build: { ...fill(mk('champion', 3)), overrides: { attributes: { str: 18, dex: 8, wis: 14 } } } });

  /* ---- Tweaks part B, WP0: the old characters the read-time sort must keep (plan section 3.6) ---- */
  // Lore-row move: an old entry under a RAW Lore key wrote its own row ("Sailing Lore Lore").
  withTwin({ id: 'overrides:lore:bard-L5', build: { ...fill(mk('bard', 5)), overrides: { proficiencies: { 'lore:Sailing Lore': 'trained' } } } });
  // A canonical Lore key (its own loreKey form) sorts like a skill: the Sailor background trains Sailing
  // Lore, increases at 3 and 5 raise it; the old `=` set it back to trained.
  {
    const b = fill({ ...mk('rogue', 7), backgroundId: dbOff.backgrounds.sailor ? 'sailor' : firstBackground });
    withTwin({
      id: 'overrides:lore-canonical:rogue-L7',
      build: { ...b, skillIncreases: { ...b.skillIncreases, 3: 'lore:sailing', 5: 'lore:sailing' }, overrides: { proficiencies: { 'lore:sailing': 'trained' } } },
    });
  }
  // A bare `lore:Lore` names no subject: unsortable, it stays today's `=`.
  withTwin({ id: 'overrides:lore-bare:fighter-L3', build: { ...fill(mk('fighter', 3)), overrides: { proficiencies: { 'lore:Lore': 'expert' } } } });
  // Case B through the sort: a level-3 increase trains Medicine BEFORE the old slot, the old entry says
  // untrained (below that), and Medic Dedication raises Medicine AFTER the slot (FEAT_GRANTS maxRank).
  {
    const b = fill(mk('fighter', 4));
    withTwin({
      id: 'overrides:lowered-raise:fighter-L4',
      build: { ...b, skillIncreases: { ...b.skillIncreases, 3: 'medicine' }, featPicks: { [slotOf('fighter', 2, 'class')]: 'medic-dedication' }, overrides: { proficiencies: { medicine: 'untrained' } } },
    });
  }
  // THE BLOCKER (expected NUMBER 0 forever): Intimidation trained before the slot (a class-skill pick),
  // Blackjacket Dedication makes it expert AFTER the slot (conditionalSkills "expert if already trained"),
  // and a REDUNDANT old entry `intimidation: trained`. Old sheet: expert. Sorted against the FINAL rank it
  // would drop to trained; against the at-slot rank it stays expert (plan B1).
  {
    const b = fill(mk('fighter', 4));
    withTwin({
      id: 'overrides:at-slot:fighter-L4',
      build: { ...b, classSkills: ['intimidation', ...b.classSkills], featPicks: { [slotOf('fighter', 2, 'class')]: 'blackjacket-dedication' }, overrides: { proficiencies: { intimidation: 'trained' } } },
    });
  }
  // B26 (a), expected NUMBER 0: Molten Wit answered on Deception; the asOf replay reads Deception
  // untrained before the feat (the old entry is invisible to it), so the feat takes its "train
  // Deception" branch. Acolyte trains neither Deception nor Diplomacy.
  {
    const b = fill({ ...mk('fighter', 5), backgroundId: dbOff.backgrounds.acolyte ? 'acolyte' : firstBackground });
    const slot = slotOf('fighter', 1, 'ancestry');
    withTwin({
      id: 'overrides:asof:fighter-L5',
      build: { ...b, featPicks: { [slot]: 'molten-wit' }, featChoices: { [slot]: 'deception' }, overrides: { proficiencies: { deception: 'trained' } } },
    });
  }
  // B26 (c), expected NUMBER 0: an old `martial: trained` below the gunslinger's class rank (it sorts
  // "exactly"); the firearm Strike keeps `firearmProf`, the longsword Strike shows the lowered rank.
  withTwin({
    id: 'overrides:firearm:gunslinger-L5',
    build: {
      ...fill(mk('gunslinger', 5)),
      inventory: [
        { itemId: 'arquebus', quantity: 1, equipped: true },
        { itemId: 'longsword', quantity: 1, equipped: true },
      ],
      overrides: { proficiencies: { martial: 'trained' } },
    },
  });
  // B26 (c), expected NUMBER 0: a daily-preparation pick (Ancestral Longevity: trained in a skill you are
  // untrained in, stored in play.dailyChoices) on Arcana, which an old entry lowers below the wizard's
  // class rank. The shown Arcana keeps the daily rank.
  {
    const elfHeritage = Object.values(dbOff.heritages).find((h) => h.ancestryId === 'elf')?.id ?? null;
    const b = fill({ ...mk('wizard', 5), ancestryId: 'elf', heritageId: elfHeritage });
    withTwin({
      id: 'overrides:daily:wizard-L5',
      build: { ...b, featPicks: { [slotOf('wizard', 1, 'ancestry')]: 'ancestral-longevity' }, overrides: { proficiencies: { arcana: 'untrained' } } },
      play: { dailyChoices: { 'ancestral-longevity:ancestralLongevitySkill': 'arcana' } },
    });
  }
  // …and the same with a daily grant the trust gate keeps (Ancestral Longevity's skill grant is dark at
  // gate on): Haunting Memories, "expert in a skill you are untrained in" — so the shown Arcana (expert)
  // beats both the old entry (untrained) and the class rank (trained) under BOTH gates.
  withTwin({
    id: 'overrides:daily:wizard-L8',
    build: { ...fill(mk('wizard', 8)), featPicks: { [slotOf('wizard', 8, 'class')]: 'haunting-memories' }, overrides: { proficiencies: { arcana: 'untrained' } } },
    play: { dailyChoices: { 'haunting-memories:hauntingMemory': 'expert-arcana' } },
  });
  // Expected NUMBER 0 forever: the old keys part B lists but never re-reads (languages, a ritual and a
  // spell, a removed feat, a "take anyway", a given class feature). Each key that has a sheet reader moves
  // something the fixture holds: the languages and the spells show as rows, and the removed feat is
  // Fleet, PICKED in the level-3 general slot (twin included), so removing it moves Speed by −5 — a broken
  // removedFeatIds reader (WP2 rewires it through liveRemovedFeatIds) moves that delta. `addedFeatures` only
  // fills the display list `grantedFeatures` (nothing derives from it) and `allowedFeats` only widens the
  // Builder's picker (the build never checks legality, B25): no number can show them, so
  // test/tweaks-legacy-fixture.test.ts pins those two on the built character instead.
  {
    const b = fill(mk('cleric', 3));
    withTwin({
      id: 'overrides:legacy-misc:cleric-L3',
      build: {
        ...b,
        featPicks: { ...b.featPicks, [slotOf('cleric', 3, 'general')]: 'fleet' },
        overrides: {
          addedLanguages: ['draconic'],
          addedSpells: [
            { spellId: 'bless', rank: 1 },
            { spellId: 'consecrate', rank: 2 },
          ],
          removedFeatIds: ['fleet'],
          allowedFeats: ['toughness'],
          addedFeatures: [{ featureId: 'shield-block', level: 1 }],
        },
      },
    });
  }
  // Expected NUMBER 0: a given feat stamped by an import (meta.source 'import', part B spec 2).
  withTwin({
    id: 'overrides:import-meta:fighter-L4',
    build: {
      ...fill(mk('fighter', 4)),
      overrides: { addedFeats: [{ featId: 'fleet', level: 3, category: 'general' }], meta: { 'addedFeats:fleet@3': { source: 'import', of: 'fleet@3' } } },
    },
  });
  // Tweaks part B WP1: the SAMPLE in part B's stamped shape (meta `mode`, `of`, `moved`, `source`; `v: 2` +
  // `options.overridesEnabled: true`) — the new shape's numbers, measured from WP1 on. A NEW id, so a compare
  // against an earlier baseline lists it as added; `meta.newShape` keeps it out of the legacy fixture
  // (isLegacyCharacter). The frozen SAMPLE above stays the old-character fixture.
  const NEW_SHAPE = {
    ...SAMPLE,
    meta: {
      'proficiencies:athletics': { reason: 'Guild training', mode: 'atLeast', of: 'expert', moved: true },
      'addedFeats:toughness@1': { source: 'import', of: 'toughness@1' },
      'maxHp:max-hp': { of: '30', moved: true },
    },
    v: 2,
  };
  const FIGHTER5 = fill(mk('fighter', 5));
  withTwin({
    id: 'overrides:new-shape:fighter-L5',
    build: { ...FIGHTER5, options: { ...(FIGHTER5.options ?? {}), overridesEnabled: true }, overrides: NEW_SHAPE },
    meta: { newShape: true },
  });

  /* ---- Tweaks phase 2 (Choices), WP0: the p2 parity characters (plan work/tweaks-phase2-notes/plan.md WP0) ----
   * Id `overrides:p2-<case>[-paused|-off]:<class>-L<n>` (+ its `#none` twin). Every one is in the NEW shape
   * (`v: 2`, `options.overridesEnabled`, `meta.newShape`) so the legacy fixture never sees it. Their blocks are
   * phase-2 kinds that today's engine does not know: the baseline therefore builds each like its twin plus
   * whatever its `featPicks` / normal stores already hold, and each WP's compare shows the row that WP moves.
   * `-paused` = every block `on: false` (a legacy-list tweak: its `meta` entry); `-off` = `overridesEnabled: false`.
   * Synthetic characters only. */
  let p2Seq = 0;
  const p2Block = (kind, rest = {}) => {
    p2Seq++;
    return { id: `t${p2Seq}_p2${String(p2Seq).padStart(3, '0')}`, kind, v: 1, ...rest };
  };
  /** An extra feat place's storage key: `${level}:extra${category}:${n}` (plan section 4). */
  const placeKey = (level, cat, n) => `${level}:extra${cat}:${n}`;
  const p2Case = (kase, cls, L, b, blocks, o = {}) => {
    const { variants = true, legacy = {}, pauseMeta, play } = o;
    const idOf = (sfx) => `overrides:p2-${kase}${sfx}:${cls}-L${L}`;
    const mkb = (bl, enabled, ovMeta) => ({
      ...b,
      options: { ...(b.options ?? {}), overridesEnabled: enabled },
      overrides: { ...legacy, v: 2, ...(bl.length ? { blocks: bl } : {}), ...(ovMeta ? { meta: ovMeta } : {}) },
    });
    const extra = { ...(play ? { play } : {}), meta: { newShape: true } };
    withTwin({ id: idOf(''), build: mkb(blocks, true), ...extra });
    if (!variants) return;
    withTwin({ id: idOf('-paused'), build: mkb(blocks.map((x) => ({ ...x, on: false })), true, pauseMeta), ...extra });
    withTwin({ id: idOf('-off'), build: mkb(blocks, false), ...extra });
  };
  const P2 = {
    any: (picker, record, rest = {}) => p2Block('choice.allowAnywayAnyPicker', { picker, record, ...rest }),
    list: (record, rule) => p2Block('choice.anyList', { record, rule }),
    more: (record, times) => p2Block('choice.moreTakes', { record, times }),
    addFeat: (level, category, n) => p2Block('choice.addPlace', { place: 'feat', level, category, n }),
    addSkill: (level, skill) => p2Block('choice.addPlace', { place: 'skillIncrease', level, skill }),
    addBoost: (level, attribute) => p2Block('choice.addPlace', { place: 'boost', level, attribute }),
    remove: (rest) => p2Block('remove.choicePlace', rest),
    answer: (rest) => p2Block('choice.changeAnswer', rest),
    options: (rest) => p2Block('choice.editOptions', { question: 'choice', index: 0, ...rest }),
  };
  const F = (cls, L, patch = {}, sub) => ({ ...fill(mk(cls, L, sub)), ...patch });
  const picksOf = (b, picks) => ({ ...(b.featPicks ?? {}), ...picks });
  {
    const elfHeritage = 'desert-elf';
    const NOW = 'kostchtchie'; // a deity whose sanctification entry allows "unholy" or "none" only
    const HOLY_ONLY = 'otolmens'; // holy or none only
    // — feature 10: permissions in the other pickers (heritage, background, deity, subclass, spell, sanctification)
    p2Case('heritage-anyway', 'fighter', 3, F('fighter', 3, { heritageId: elfHeritage }), [P2.any('heritage', elfHeritage)]);
    p2Case('background-anyway', 'fighter', 3, F('fighter', 3, { backgroundId: 'sewer-dragon' }), [P2.any('background', 'sewer-dragon')]);
    {
      const b = F('fighter', 4, { deityId: NOW });
      b.featPicks = picksOf(b, { [slotOf('fighter', 2, 'class')]: 'razmiran-priest-dedication', [slotOf('fighter', 4, 'class')]: 'cleric-dedication' });
      p2Case('deity-anyway', 'fighter', 4, b, [P2.any('deity', NOW)]);
    }
    p2Case('subclass-anyway', 'champion', 3, F('champion', 3, { deityId: NOW, effectChoices: { [`${NOW}:sanctification`]: 'unholy' } }, 'grandeur'), [P2.any('subclass', 'grandeur', { classId: 'champion' })]);
    p2Case('spell-anyway', 'wizard', 3, F('wizard', 3, { spells: { 1: ['heal'] } }), [P2.any('spell', 'heal')]);
    {
      const b = F('wizard', 5);
      const s1 = slotOf('wizard', 1, 'ancestry');
      const s5 = slotOf('wizard', 5, 'ancestry');
      b.featPicks = picksOf(b, { [s1]: 'adapted-cantrip', [s5]: 'adaptive-adept' });
      b.featChoices = { ...(b.featChoices ?? {}), [s1]: 'healing-plaster', [s5]: 'join-pasts' };
      p2Case('spell-anyway-open', 'wizard', 5, b, [P2.any('spell', 'join-pasts')]);
    }
    {
      const b = F('wizard', 3);
      const s1 = slotOf('wizard', 1, 'ancestry');
      b.featPicks = picksOf(b, { [s1]: 'adapted-cantrip' });
      b.featChoices = { ...(b.featChoices ?? {}), [s1]: 'frosts-touch' };
      p2Case('spell-anyway-adapted', 'wizard', 3, b, [P2.any('spell', 'frosts-touch')]);
    }
    {
      const b = F('fighter', 2, { deityId: HOLY_ONLY });
      const s2 = slotOf('fighter', 2, 'class');
      b.featPicks = picksOf(b, { [s2]: 'cleric-dedication' });
      b.featChoices = { ...(b.featChoices ?? {}), [s2]: 'unholy' };
      p2Case('sanctification-anyway', 'fighter', 2, b, [P2.any('sanctification', 'cleric-dedication', { value: 'unholy' })]);
    }
    // a stored heritage off its ancestry and NO block (an import's shape): C45 is display only
    p2Case('heritage-stored-foreign', 'fighter', 3, F('fighter', 3, { heritageId: elfHeritage }), [], { variants: false });
    // dedication-early: Magaambyan Attendant Dedication (a `dedicationGate` record) at 2, a second dedication at 4 + allowedFeats (a legacy list)
    {
      // trained in Nature (the dedication's skill prerequisite), so the Builder's skill-order notice stays silent here
      const b = F('fighter', 4, { classSkills: ['athletics', 'stealth', 'nature'] });
      b.featPicks = picksOf(b, { [slotOf('fighter', 2, 'class')]: 'magaambyan-attendant-dedication', [slotOf('fighter', 4, 'class')]: 'blackjacket-dedication' });
      p2Case('dedication-early', 'fighter', 4, b, [], {
        legacy: { allowedFeats: ['magaambyan-attendant-dedication', 'blackjacket-dedication'] },
        pauseMeta: { 'allowedFeats:magaambyan-attendant-dedication': { on: false }, 'allowedFeats:blackjacket-dedication': { on: false } },
      });
    }
    // — feature 11: pick from any list
    {
      const b = F('fighter', 3);
      b.featPicks = picksOf(b, { [slotOf('fighter', 2, 'class')]: 'toughness' });
      p2Case('anylist-general-in-class', 'fighter', 3, b, [P2.list('toughness', 'list')]);
    }
    {
      const b = F('fighter', 4);
      b.featPicks = picksOf(b, { [slotOf('fighter', 2, 'class')]: 'pain-tolerance' }); // a 6th-level feat in a 2nd-level slot
      p2Case('anylist-above-level', 'fighter', 4, b, [P2.list('pain-tolerance', 'level')]);
    }
    {
      const b = F('fighter', 5);
      const g3 = slotOf('fighter', 3, 'general');
      b.featPicks = picksOf(b, { [g3]: 'ancestral-paragon' });
      b.pickFeatChoices = { ...(b.pickFeatChoices ?? {}), [g3]: 'elven-lore' }; // an elf feat for a human: off Ancestral Paragon's list
      // WP5: the allow names the PICKED feat (elven-lore), the one Ancestral Paragon's list refuses — not the granter.
      p2Case('anylist-pickafeat', 'fighter', 5, b, [P2.list('elven-lore', 'list')]);
    }
    p2Case('anylist-bonusfeat', 'fighter', 3, F('fighter', 3, { heritageId: 'versatile-human', heritageFeatId: 'prescient-planner' }), [P2.list('prescient-planner', 'level')]);
    p2Case('anylist-bonusfeat', 'wizard', 3, F('wizard', 3, { umtFeatId: 'cantrip-expansion' }, 'school-of-unified-magical-theory'), [P2.list('cantrip-expansion', 'level')]);
    // — feature 13: remove a printed feat place (filled / empty)
    {
      const rm = [P2.remove({ place: 'feat', level: 4, category: 'class', ordinal: 0 })];
      const b = F('fighter', 4);
      p2Case('remove-place-filled', 'fighter', 4, { ...b, featPicks: picksOf(b, { [slotOf('fighter', 4, 'class')]: 'sudden-charge' }) }, rm);
      p2Case('remove-place-empty', 'fighter', 4, b, rm);
    }
    // — feature 12: extra feat places (the pick lives under the place's derived key)
    {
      const b = F('fighter', 4);
      const k = placeKey(4, 'general', 483920);
      p2Case('feat-place-general', 'fighter', 4, { ...b, featPicks: picksOf(b, { [k]: 'toughness' }) }, [P2.addFeat(4, 'general', 483920)]);
    }
    {
      const b = F('fighter', 4, { classSkills: ['athletics', 'stealth', 'medicine'] }); // Medic Dedication: trained in Medicine
      const k = placeKey(4, 'archetype', 483921);
      p2Case('feat-place-archetype', 'fighter', 4, { ...b, featPicks: picksOf(b, { [k]: 'medic-dedication' }) }, [P2.addFeat(4, 'archetype', 483921)]);
    }
    {
      const b = F('fighter', 4);
      const k = placeKey(4, 'archetype', 483922);
      p2Case('feat-place-dedskill', 'fighter', 4, { ...b, featPicks: picksOf(b, { [k]: 'rogue-dedication' }), dedicationSkillFeats: { 'rogue-dedication': 'charlatan' } }, [P2.addFeat(4, 'archetype', 483922)]);
    }
    {
      const b = F('fighter', 4);
      const k = placeKey(4, 'class', 483923);
      p2Case('feat-place-pickfocus', 'fighter', 4, { ...b, featPicks: picksOf(b, { [k]: 'social-purview' }), pickFeatChoices: { [k]: 'student-of-perfection-dedication' } }, [P2.addFeat(4, 'class', 483923)]);
    }
    {
      const b = F('fighter', 4);
      const k = placeKey(4, 'archetype', 483924);
      p2Case(
        'feat-place-spell',
        'fighter',
        4,
        { ...b, featPicks: picksOf(b, { [k]: 'wizard-dedication' }), archetypeTradition: 'arcane', archetypeKeyAbility: 'int', archetypeSpells: { cantrips: ['prestidigitation', 'shield'], spells: {}, tradition: 'arcane', keyAbility: 'int' } },
        [P2.addFeat(4, 'archetype', 483924)],
      );
    }
    {
      // the extra key with NO block (a deleted place): the old engine still counts it
      const b = F('fighter', 4);
      p2Case('feat-place-noblock', 'fighter', 4, { ...b, featPicks: picksOf(b, { [placeKey(4, 'general', 483925)]: 'toughness' }) }, [], { variants: false });
    }
    // — feature 11: the same feat more times
    {
      const b = F('fighter', 7);
      p2Case('moretakes-fleet2', 'fighter', 7, { ...b, featPicks: picksOf(b, { [slotOf('fighter', 3, 'general')]: 'fleet', [slotOf('fighter', 7, 'general')]: 'fleet' }) }, [P2.more('fleet', 1)]);
    }
    {
      // a second copy of a non-repeatable pick-a-feat granter (Natural Ambition: a class feat of your class, level 1) whose pick answers a question
      const b = F('fighter', 5);
      const a1 = slotOf('fighter', 1, 'ancestry');
      const a5 = slotOf('fighter', 5, 'ancestry');
      p2Case(
        'moretakes-granter',
        'fighter',
        5,
        { ...b, featPicks: picksOf(b, { [a1]: 'natural-ambition', [a5]: 'natural-ambition' }), pickFeatChoices: { [a1]: 'sudden-charge', [a5]: 'double-slice' } },
        [P2.more('natural-ambition', 1)],
      );
    }
    // — feature 14: change an answer (V = a carrier the engine reads; P = a permission and the value in today's store)
    // WP13 (re-scoped 2026-10-25), KEPT as evidence: "Change an answer" comes after the record rebuild (WP10), so each
    // block below now reads as made in a newer version (stored.ts readOne) — kept, never applied: every answer-* and
    // options-* case must equal its baseline (NUMBER 0, the newer-place shape). WP10 turns them back into its own cases.
    {
      const b = F('fighter', 4);
      const s2 = slotOf('fighter', 2, 'class');
      const base = { ...b, featPicks: picksOf(b, { [s2]: 'rogue-dedication' }) };
      p2Case('answer-skillslot', 'fighter', 4, { ...base, featSkillChoices: { 'rogue-dedication:0': 'medicine' } }, [P2.answer({ question: 'skillSlot', record: 'rogue-dedication', index: 0, value: 'medicine' })]);
      p2Case('answer-lore', 'fighter', 4, { ...base, featSkillChoices: { 'rogue-dedication:0': 'lore:sailing' } }, [P2.answer({ question: 'skillSlot', record: 'rogue-dedication', index: 0, value: 'lore:sailing' })]);
    }
    p2Case('answer-background', 'fighter', 3, F('fighter', 3, { backgroundId: 'magaambya-academic', backgroundSkillChoice: 'medicine' }), [P2.answer({ question: 'backgroundSkill', record: 'magaambya-academic', index: 0, value: 'medicine' })]);
    p2Case('answer-subclass', 'investigator', 3, F('investigator', 3, { subclassSkill: 'medicine' }, 'empiricism-methodology'), [P2.answer({ question: 'subclassSkill', record: 'empiricism-methodology', index: 0, value: 'medicine' })]);
    p2Case('answer-bglore', 'fighter', 3, F('fighter', 3, { backgroundId: 'reputation-seeker', backgroundLore: 'ocean' }), [P2.answer({ question: 'backgroundLore', record: 'reputation-seeker', index: 0, value: 'ocean' })]);
    {
      const b = F('monk', 10);
      const s10 = slotOf('monk', 10, 'class');
      p2Case('answer-choice-energy', 'monk', 10, { ...b, featPicks: picksOf(b, { [s10]: 'entwined-energy-ki' }), featChoices: { ...(b.featChoices ?? {}), [s10]: 'void' } }, [P2.answer({ question: 'choice', record: 'entwined-energy-ki', index: 0, value: 'void' })]);
    }
    p2Case('answer-keyattr', 'fighter', 3, F('fighter', 3, { keyAbility: 'con' }), [P2.answer({ question: 'keyAttribute', record: 'fighter', index: 0, value: 'con' })]);
    // a stored answer that drifted off its list and NO tweak: it maps to the first option (the critic's trap)
    p2Case('offlist-old', 'fighter', 3, F('fighter', 3, { backgroundId: 'magaambya-academic', backgroundSkillChoice: 'medicine' }), [], { variants: false });
    // — feature 15: edit a list's options (WP13: after the record rebuild, WP9 steps 1-3; read as a newer version's, see above)
    {
      const b = F('inventor', 3);
      const s1 = slotOf('inventor', 1, 'class');
      const base = { ...b, featPicks: picksOf(b, { [s1]: 'variable-core' }) };
      p2Case('options-add-fire', 'inventor', 3, { ...base, featChoices: { ...(b.featChoices ?? {}), [s1]: 'fire' } }, [P2.options({ record: 'variable-core', add: ['fire'] })]);
      p2Case('options-remove-answered', 'inventor', 3, { ...base, featChoices: { ...(b.featChoices ?? {}), [s1]: 'cold' } }, [P2.options({ record: 'variable-core', remove: ['cold'] })]);
    }
    // — feature 12: extra skill increase and boost places; feature 10: a skill increase past a rule
    p2Case('skill-place', 'fighter', 5, F('fighter', 5), [P2.addSkill(5, 'stealth')]);
    p2Case('boost-place', 'fighter', 5, F('fighter', 5), [P2.addBoost(5, 'dex')]);
    p2Case('boost-place-partial', 'fighter', 10, F('fighter', 10, { ancestryBoosts: ['dex', 'con'], backgroundBoosts: ['dex', 'wis'] }), [P2.addBoost(10, 'dex')]);
    // WP13, KEPT as evidence: the skill-increase picker (cap / locked / narrowed, WP12) comes after the record rebuild;
    // `picker: 'skillIncrease'` is off ANY_PICKERS, so overcap / increase-locked / increase-narrowed read as a newer
    // version's block and must equal their baseline (NUMBER 0).
    {
      const b = F('fighter', 5);
      p2Case('overcap', 'fighter', 5, { ...b, skillIncreases: { ...b.skillIncreases, 3: 'stealth', 5: 'stealth' } }, [P2.any('skillIncrease', 'stealth', { rule: 'cap', level: 5, lane: 'main' })]);
    }
    {
      const b = F('bard', 3);
      p2Case('increase-locked', 'bard', 3, { ...b, featPicks: picksOf(b, { [slotOf('bard', 2, 'class')]: 'bardic-lore' }), skillIncreases: { ...b.skillIncreases, 3: 'lore:bardic' } }, [P2.any('skillIncrease', 'lore:bardic', { rule: 'locked', level: 3, lane: 'main' })]);
    }
    {
      const b = F('swashbuckler', 3);
      p2Case('increase-narrowed', 'swashbuckler', 3, { ...b, bonusSkillIncreases: { 3: 'stealth' } }, [P2.any('skillIncrease', 'stealth', { rule: 'narrowed', level: 3, lane: 'bonus' })]);
    }
    // — feature 13 for skill increases and boosts (WP14)
    {
      const b = F('fighter', 5);
      const rm = [P2.remove({ place: 'skillIncrease', level: 5, lane: 'main' })];
      p2Case('remove-skillinc-filled', 'fighter', 5, { ...b, skillIncreases: { ...b.skillIncreases, 5: 'stealth' } }, rm);
      const { 5: _drop, ...without } = b.skillIncreases;
      p2Case('remove-skillinc-empty', 'fighter', 5, { ...b, skillIncreases: without }, rm);
    }
    {
      const b = F('fighter', 10);
      const rm = [P2.remove({ place: 'boost', set: 'level', level: 10, index: 2 })];
      p2Case('remove-boost-filled', 'fighter', 10, { ...b, attributeBoosts: { ...b.attributeBoosts, 10: ['str', 'con', 'dex', 'wis'] } }, rm);
      p2Case('remove-boost-empty', 'fighter', 10, { ...b, attributeBoosts: { ...b.attributeBoosts, 10: ['str', 'con'] } }, rm);
    }
    // — feature 13 for class-feature choices (WP16): a thaumaturge's 5th-level implement (ordinal 1) and a wizard's only thesis (ordinal 0)
    // WP13, KEPT as evidence: class-choice, tactic and rune places (WP16, WP17) come after the record rebuild; they are off
    // REMOVE_PLACES, so every remove-classchoice-* / remove-tactic-* / remove-rune-* block reads as a newer version's and
    // must equal its baseline (NUMBER 0).
    {
      const rm = [P2.remove({ place: 'classChoice', classId: 'thaumaturge', group: 'implement', ordinal: 1 })];
      const b = F('thaumaturge', 5);
      p2Case('remove-classchoice-filled', 'thaumaturge', 5, { ...b, extraChoices: { implement: ['amulet', 'bell'] } }, rm);
      p2Case('remove-classchoice-empty', 'thaumaturge', 5, { ...b, extraChoices: { implement: ['amulet'] } }, rm);
    }
    p2Case('remove-classchoice-only', 'wizard', 1, F('wizard', 1, { extraChoices: { thesis: ['spell-blending'] } }), [P2.remove({ place: 'classChoice', classId: 'wizard', group: 'thesis', ordinal: 0 })]);
    // — feature 13 for tactics and runes (WP17): the commander's folio holds 5 at level 1, the runesmith's repertoire 4
    {
      const TACTICS = ['coordinating-maneuvers', 'defensive-retreat', 'double-team', 'end-it', 'gather-to-me'];
      const rm = [P2.remove({ place: 'tactic', ordinal: 4 })];
      const b = F('commander', 1);
      p2Case('remove-tactic-filled', 'commander', 1, { ...b, commanderTactics: TACTICS }, rm);
      p2Case('remove-tactic-empty', 'commander', 1, { ...b, commanderTactics: TACTICS.slice(0, 4) }, rm);
    }
    {
      const RUNES = ['atryl-rune-of-fire', 'baruiel-rune-of-holds-bravery', 'camonica-rune-of-perplexity', 'esvadir-rune-of-whetstones'];
      const rm = [P2.remove({ place: 'rune', ordinal: 3 })];
      const b = F('runesmith', 1);
      p2Case('remove-rune-filled', 'runesmith', 1, { ...b, runesmithRunes: RUNES }, rm);
      p2Case('remove-rune-empty', 'runesmith', 1, { ...b, runesmithRunes: RUNES.slice(0, 3) }, rm);
    }
    // a place kind a NEWER app wrote: unknown to this one, kept, never read (0 forever)
    p2Case('newer-place', 'fighter', 3, F('fighter', 3), [p2Block('choice.addPlace', { place: 'cantrip', level: 3 })], { variants: false });
  }

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

  // 5. skill order (skill-order plan WP0 step 6): every guard case of test/fixtures/skill-order-cases.ts, so
  // each number a skill-order work package moves is listed and explained. `historyKeys` names the keys whose
  // per-level history (`history.<key>` rank stats) the case is about. Every gate allows `^skillorder:`.
  for (const c of SKILL_ORDER_CASES)
    add({ id: `skillorder:${c.id}`, group: 'skillorder', keepFull: true, build: c.build, meta: { historyKeys: Object.keys(c.expect?.skills ?? {}) } });

  // 6. part B's three browser characters (work/tweaks-part-b-notes/browser-report.md, "Fixtures"), copied byte
  // for byte to test/fixtures/skill-order-tweaks/ and read the way the roster reads a file — importCharacter
  // (the app's import path), then the stored build through the gate pipeline. OUTSIDE `skillorder:` on purpose:
  // every gate allows that family, which would hide their moves; they must hold at NUMBER 0 (plan 3.4).
  for (const [id, file] of [
    ['fixture-fighter', 'old-overrides'],
    ['broken', 'broken-tweaks'],
    ['cleric-l4', 'cleric-l4'],
  ]) {
    const { saved } = importCharacter(readFileSync(at(`test/fixtures/skill-order-tweaks/${file}.codex.json`), 'utf8'), dbOff);
    add({ id: `tweaks-browser:${id}`, group: 'tweaks-browser', keepFull: true, build: saved.build, meta: { file: `${file}.codex.json` } });
  }

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

  ENGINE = {
    buildCharacter, contentFor, derive, deriveInitiative, explainStat, sheetLoreKeys, applyPlayState, initialPlay,
    playerFacingContent, computePcStats, computeSummary, SKILLS, DB, dbOff, setGate, clearTrustGate,
    FEAT_RANK_FEAT_GRANTS, skillOrderLegacyOf,
    specs, records, recordPlans, unreachable, getPath, clampLvl, SWEEP_LEVELS, mk, fill,
  };
  return ENGINE;
}

/* ---- one character -> its numbers ------------------------------------------------------------ */
const ABILS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
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

/**
 * The rank-shaped stats of one built character (skill-order plan WP0 step 6, D18) — a gate's `rankStats`,
 * beside `buildHash` and NEVER inside `numbers`. Every value is a sorted, joined string, so a move reads as
 * one row: `build.skillRanks` (`key:rank`), `build.skillFallbacks` (`featId:skill[:slot]`),
 * `build.skillIncreases` (`level:skill`, lane left out), `build.grantedSkills` (keys), `build.featRows`
 * (`id@level`), `build.rankGated` (`grantedBy>featId` for a FEAT_RANK_FEAT_GRANTS feat from its carrier), and
 * `build.hashSansSkill` (the character minus every skill-shaped field and the feat rows: what must NOT move
 * when only skill order moves). Once the engine exports `skillOrderLegacyOf` (plan WP3), the live path's
 * `legacy.*` twins in the same formats (read only by `--legacy-check`). For a `skillorder:*` case, the
 * per-level history of the keys it is about: `history.<key>` = `level:to:source` joined by `|`, `none` when
 * the character has no history.
 */
function rankStatsOf(E, built, norm, spec) {
  const join = (xs) => [...xs].sort().join(',');
  const ranks = (skills) => join(Object.entries(skills ?? {}).map(([k, r]) => `${k}:${r}`));
  const fbs = (list) => join((list ?? []).map((f) => (typeof f === 'string' ? f : `${f.featId}:${f.skill}${f.slot ? `:${f.slot}` : ''}`)));
  const incs = (list) => join((list ?? []).map((s) => (typeof s === 'string' ? s : `${s.level}:${s.skill}`)));
  const gatedFeats = (rows) =>
    join(
      (rows ?? [])
        .filter((f) => (typeof f === 'string' ? true : f.grantedBy && (E.FEAT_RANK_FEAT_GRANTS[f.grantedBy] ?? []).some((e) => e.feat === f.featId)))
        .map((f) => (typeof f === 'string' ? f : `${f.grantedBy}>${f.featId}`)),
    );
  const rs = {};
  rs['build.skillRanks'] = ranks(built.proficiencies?.skills);
  rs['build.skillFallbacks'] = fbs(built.skillFallbacks);
  rs['build.skillIncreases'] = incs(built.skillIncreases);
  rs['build.grantedSkills'] = join(Object.keys(built.grantedSkills ?? {}));
  rs['build.featRows'] = join((built.feats ?? []).map((f) => `${f.featId}@${f.level}`));
  rs['build.rankGated'] = gatedFeats(built.feats);
  {
    const { proficiencies, skillFallbacks: _f, skillIncreases: _i, skillRankBefore: _b, grantedSkills: _g, feats: _r, ...rest } = norm;
    const { skills: _s, ...profRest } = proficiencies ?? {};
    rs['build.hashSansSkill'] = sha(stableJson({ ...rest, proficiencies: profRest }));
  }
  if (E.skillOrderLegacyOf) {
    const L = E.skillOrderLegacyOf(built);
    if (L) {
      rs['legacy.skillRanks'] = ranks(L.skills);
      rs['legacy.skillFallbacks'] = fbs(L.skillFallbacks);
      rs['legacy.skillIncreases'] = incs(L.skillIncreases);
      rs['legacy.rankGated'] = gatedFeats(L.rankGated);
    }
  }
  for (const key of spec.meta?.historyKeys ?? []) {
    const h = built.skillHistory;
    rs[`history.${key}`] = h ? (h.steps ?? []).filter((s) => s.key === key).map((s) => `${s.level}:${s.to}:${s.source}`).join('|') : 'none';
  }
  return rs;
}

function snapCharacter(E, spec, gate) {
  const { derive } = E;
  const baseDb = spec.dbPatch ? spec.dbPatch(E.DB[gate]) : E.DB[gate];
  const build = spec.build;
  const out = { numbers: {}, breakdowns: {} };
  let built;
  try {
    // App.tsx onCreate: the plain db; buildCharacter applies the content-edits itself (contentFor).
    built = E.buildCharacter(build, baseDb);
  } catch (e) {
    out.buildError = err(e);
    out.buildHash = out.buildError;
    return out;
  }
  const norm = normaliseCharacter(built);
  out.buildHash = sha(stableJson(norm));
  out.rankStats = rankStatsOf(E, built, norm, spec);
  if (spec.keepFull) out.full = stripProse(stable(norm));
  let ch;
  let db;
  try {
    const play = { ...E.initialPlay(built, baseDb), ...(spec.play ?? {}) };
    ch = E.applyPlayState(built, play, baseDb);
    // The host itself (plan B B13): `contentFor(db, host)` reads the switch from `options` and refuses a
    // bare overrides object, so the sheet db keeps exactly the edits the app lays over.
    db = E.playerFacingContent(E.contentFor(baseDb, built), ch.inventory);
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
  const lores = tryv(() => E.sheetLoreKeys(ch, db));
  const skillKeys = [...E.SKILLS, ...(Array.isArray(lores) ? lores : [])];
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
    const i = tryv(() => E.deriveInitiative(ch, db));
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
    const pc = tryv(() => E.computePcStats(ch, db));
    if (typeof pc === 'string') put('pc', pc);
    else
      for (const [k, v] of Object.entries(pc)) {
        if (k === 'skills') for (const [sk, sv] of Object.entries(v ?? {})) put(`pc.skills.${sk}`, `${sv.mod}${sv.prof}`);
        else if (v !== undefined) put(`pc.${k}`, v);
      }
  }
  {
    const sm = tryv(() => E.computeSummary(ch, db));
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
    const b = tryv(() => E.explainStat(ch, db, ref, build));
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

/* ---- run ------------------------------------------------------------------------------------- */
/** Build every spec `only` matches (all when null) under both gates. `plant` = the --plant bad case. */
async function runSpecsOf({ only = null, plant = false, quiet = false } = {}) {
  const E = await loadEngine();
  const runSpecs = only ? E.specs.filter((s) => only.test(s.id)) : E.specs;
  /* --plant: a real engine-side bad case (Fleet worth +10 instead of +5, in memory only). It edits the
   * shared DB, so it is a CLI-only switch (one process, one run). */
  if (plant)
    for (const g of ['off', 'on']) if (E.DB[g].feats.fleet) E.DB[g].feats = { ...E.DB[g].feats, fleet: { ...E.DB[g].feats.fleet, landSpeedBonus: 10 } };
  const result = {};
  for (const s of runSpecs) result[s.id] = { group: s.group, ...(s.meta ? { meta: s.meta } : {}), gates: {} };
  try {
    for (const gate of ['off', 'on']) {
      E.setGate(gate);
      const t = Date.now();
      let n = 0;
      for (const s of runSpecs) {
        result[s.id].gates[gate] = snapCharacter(E, s, gate);
        if (!quiet && ++n % 500 === 0) console.error(`  gate ${gate}: ${n}/${runSpecs.length} (${((Date.now() - t) / 1000).toFixed(0)} s)`);
      }
      if (!quiet) console.error(`gate ${gate}: ${runSpecs.length} characters in ${((Date.now() - t) / 1000).toFixed(1)} s`);
    }
  } finally {
    E.clearTrustGate();
  }
  return { E, runSpecs, result };
}

/**
 * For vitest: build the characters whose id matches `only` (a RegExp or a regex string) through the
 * snapshot's own pipeline, both gates, and return `{ characters }` in the snapshot's shape. Never
 * writes a file. Run it under vt.mjs (which holds the heavy-job lock).
 */
export async function snapshotSubset(only) {
  const re = only instanceof RegExp ? only : new RegExp(only);
  const { result } = await runSpecsOf({ only: re, quiet: true });
  return { characters: result };
}

/**
 * One character through the same pipeline, one gate: `{ numbers, breakdowns, buildHash, full? }` as a
 * snapshot row holds it. `spec` = { id, build, play?, keepFull? } (scripts/tweaks-browser-fixture.mjs).
 */
export async function snapOne(spec, gate = 'on') {
  const E = await loadEngine();
  E.setGate(gate);
  try {
    return snapCharacter(E, { group: 'one', ...spec }, gate);
  } finally {
    E.clearTrustGate();
  }
}

/** The engine commit (full sha), or null when git cannot say. */
function headCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}
/**
 * DATA that lives under src/ and that `npm run data` + the ledger re-stamp change (MIGRATION.md "After every
 * `npm run data`"): the re-take recipe copies it into the engineCommit worktree, so a modified copy of it is
 * new data, not a different engine. Exactly these paths — any other src/ change still refuses.
 */
export const DATA_IN_SRC = ['src/data/trust-ledger.json'];
/** Uncommitted changes under src/ (the engine), as `git status --porcelain` lines, minus DATA_IN_SRC. */
export function engineDirtyLines(porcelain) {
  return porcelain
    .split('\n')
    .filter(Boolean)
    .filter((l) => !DATA_IN_SRC.includes(l.slice(3).trim().replace(/^"|"$/g, '')));
}
function srcDirty() {
  try {
    return engineDirtyLines(execFileSync('git', ['status', '--porcelain', '--', 'src'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch {
    return ['(git status failed)'];
  }
}

const RETAKE =
  'Re-take only when a DELTA itself changed after `npm run data` (a book number that moves both twins never changes a delta). ' +
  'Never on a newer engine: that would bake its own numbers in. Make a worktree at this header\'s engineCommit ' +
  '(git worktree add <dir> <engineCommit>), copy the CURRENT scripts/blocks-parity-snapshot.mjs and scripts/lib/heavy-lock.mjs ' +
  'plus the new public/core.json, public/core-descriptions.json and the re-stamped src/data/trust-ledger.json (the trust gate reads it) ' +
  'into it, run `npx jiti scripts/blocks-parity-snapshot.mjs --write-fixture` there (no --allow-dirty: the copied ledger is data, not engine), ' +
  'and copy test/fixtures/tweaks-legacy-before.json back.';

async function writeFixture() {
  const dirty = srcDirty();
  if (dirty.length && !has('--allow-dirty')) {
    console.error(`--write-fixture refused: src/ has uncommitted changes, so the fixture would not be the engine at HEAD:\n  ${dirty.join('\n  ')}`);
    return 2;
  }
  const { result } = await runSpecsOf({ only: /^overrides:/ });
  const characters = legacyDeltas(result);
  const fixture = {
    header: {
      what:
        'Tweaks part B "before" numbers (plan WP0 step 5): per overrides:* character of scripts/blocks-parity-snapshot.mjs, per trust gate, ' +
        'every sheet number that differs from its #none twin (same build and play, no overrides) — a number as with minus twin, anything else as ' +
        '{ twin, with }; stats named by the character\'s fixtureAbsolute regex are stored as values under `absolute`. Synthetic characters only.',
      engineCommit: headCommit(),
      engineDirty: dirty.length ? dirty : undefined,
      coreSha: sha(readFileSync(at('public/core.json'))),
      takenAt: new Date().toISOString(),
      retake: RETAKE,
    },
    characters,
  };
  const out = arg('--fixture-out') ?? LEGACY_FIXTURE;
  mkdirSync(dirname(at(out)), { recursive: true });
  writeFileSync(at(out), JSON.stringify(fixture, null, 1) + '\n');
  console.log(`wrote ${out}: ${Object.keys(characters).length} characters at engine ${fixture.header.engineCommit}`);
  for (const [cid, c] of Object.entries(characters)) {
    const n = Object.values(c.gates).map((g) => (g.error ? 'ERR' : Object.keys(g.deltas).length)).join('/');
    console.log(`  ${cid}: twin ${c.twin ?? '(none)'}; deltas off/on ${n}`);
  }
  return 0;
}

/* ---- the full run's summary ------------------------------------------------------------------ */
function summarize(E, result, runSpecs, ONLY) {
  const { dbOff, recordPlans, records, unreachable, getPath, clampLvl, DB } = E;
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
  for (const r of records)
    for (const f of r.fields) {
      fieldCounts[f] ??= {};
      fieldCounts[f][r.bucket] = (fieldCounts[f][r.bucket] ?? 0) + 1;
    }
  const groupCounts = {};
  for (const s of runSpecs) groupCounts[s.group] = (groupCounts[s.group] ?? 0) + 1;
  const errors = { off: 0, on: 0 };
  for (const c of Object.values(result)) for (const [g, x] of Object.entries(c.gates)) if (x.buildError || x.playError) errors[g]++;

  const summary = {
    takenAt: new Date().toISOString(),
    headSha: headCommit(),
    coreSha: sha(readFileSync(at('public/core.json'))),
    sweepLevels: E.SWEEP_LEVELS,
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
  };
  return { summary, recordSummary, groupCounts, errors, sumFails, known, noDiff, notHeld };
}

/* ---- the CLI --------------------------------------------------------------------------------- */
async function main() {
  process.chdir(ROOT);
  if (has('--self-test')) {
    const path = arg('--baseline') ?? DEFAULT_OUT;
    if (!existsSync(path)) {
      console.error(`no baseline at ${path} — take one first`);
      return 2;
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
    return code || (verdict === 1 ? 0 : 1);
  }

  /** `--allow-pairs <json file>`: an array of `"<cid>|<stat>"` (skill-order plan WP0 step 6). */
  const allowPairs = () => {
    const p = arg('--allow-pairs');
    if (!p) return undefined;
    const list = JSON.parse(readFileSync(p, 'utf8'));
    if (!Array.isArray(list) || list.some((x) => typeof x !== 'string' || x.split('|').length !== 2)) throw new Error(`--allow-pairs ${p}: expected a JSON array of "<cid>|<stat>" strings`);
    return list;
  };
  /** `--legacy-check <baseline>` (G11): 0 when every `legacy.*` stat of `snap` equals the baseline's twin. */
  const runLegacyCheck = (snap) => {
    const p = arg('--legacy-check');
    if (!p) return 0;
    const base = JSON.parse(readFileSync(p, 'utf8'));
    const twin = arg('--legacy-twin') ?? 'build';
    if (twin !== 'build' && twin !== 'legacy') throw new Error(`--legacy-twin: expected build or legacy, got "${twin}"`);
    const allow = arg('--legacy-allow');
    const { bad, checked, allowed, allowedChars, skippedCases } = legacyCheck(base, snap, { twin, allow });
    console.log(
      `--legacy-check ${p}: ${checked} legacy stats checked, ${bad.length} differ from the baseline's ${twin === 'legacy' ? 'legacy.*' : 'build.*'} twin` +
        (allow ? `, allowed: ${allowed} (${allowedChars} characters, --legacy-allow ${allow})` : ''),
    );
    if (allow) console.log(`  skipped cases: ${skippedCases.length ? skippedCases.join(', ') : '(none)'}`);
    for (const r of bad.slice(0, 40)) console.log(`  LEGACY ${r.cid} [${r.gate}] ${r.stat}: ${r.before} -> ${r.after}`);
    if (bad.length > 40) console.log(`  ... ${bad.length - 40} more`);
    return bad.length ? 1 : 0;
  };

  if (has('--compare') && has('--against')) {
    const before = JSON.parse(readFileSync(arg('--compare'), 'utf8'));
    const after = JSON.parse(readFileSync(arg('--against'), 'utf8'));
    const res = compareSnapshots(before, after, arg('--allow'), arg('--allow-stat'), allowPairs());
    printCompare(res, arg('--compare').replace(/\.json$/, '') + '.compare.txt');
    const legacy = runLegacyCheck(after);
    return res.numbers.length || res.missing.length || legacy ? 1 : 0;
  }

  // Everything below builds characters: one heavy job on this machine at a time (scripts/vt.mjs's lock).
  const label = `blocks-parity-snapshot ${argv.join(' ')}`.slice(0, 120);
  return await withHeavyLock(label, async () => {
    if (has('--write-fixture')) return await writeFixture();
    const T0 = Date.now();
    const ONLY = arg('--only') ? new RegExp(arg('--only')) : null;
    const PLANT = has('--plant');
    const { E, runSpecs, result } = await runSpecsOf({ only: ONLY, plant: PLANT });
    const s = summarize(E, result, runSpecs, ONLY);
    s.summary.seconds = Math.round((Date.now() - T0) / 1000);
    const snapshot = { summary: s.summary, records: s.recordSummary, characters: result };
    if (has('--compare')) {
      const basePath = arg('--compare');
      const before = JSON.parse(readFileSync(basePath, 'utf8'));
      // With --only the new run is a slice on purpose: compare that slice, never call the rest "missing".
      if (ONLY) before.characters = Object.fromEntries(Object.entries(before.characters).filter(([cid]) => ONLY.test(cid)));
      const res = compareSnapshots(before, snapshot, arg('--allow'), arg('--allow-stat'), allowPairs());
      // A sliced or planted run never overwrites the full latest run.
      const newPath = basePath.replace(/\.json$/, '') + (ONLY || PLANT ? '.slice.json' : '.latest.json');
      writeFileSync(newPath, JSON.stringify(snapshot));
      console.log(`(new run written to ${newPath}; ${s.summary.seconds} s)`);
      printCompare(res, basePath.replace(/\.json$/, '') + '.compare.txt');
      const legacy = runLegacyCheck(snapshot);
      return res.numbers.length || res.missing.length || legacy ? 1 : 0;
    }
    const out = arg('--out') ?? DEFAULT_OUT;
    const legacyOut = runLegacyCheck(snapshot);
    writeFileSync(out, JSON.stringify(snapshot));
    const kb = Math.round(JSON.stringify(snapshot).length / 1024);
    console.log(`wrote ${out} (${kb} KB) in ${s.summary.seconds} s`);
    console.log(`characters: ${s.summary.characters} x 2 gates  ${JSON.stringify(s.groupCounts)}`);
    console.log(`build/play errors: ${JSON.stringify(s.errors)}`);
    console.log(`item-10 records: ${E.records.length} (${E.unreachable.length} not reachable)`);
    console.log('breakdown-sum failures today (count of breakdowns / characters):');
    for (const gate of ['off', 'on']) console.log(`  gate ${gate}: ` + Object.entries(s.sumFails[gate]).map(([k, v]) => `${k} ${v.count}/${v.characters}`).join(', '));
    console.log('known cases:');
    for (const k of s.known) console.log(`  ${k.ok ? 'ok  ' : 'MISS'} [gate ${k.gate}] ${k.label}: ${JSON.stringify(k.got)}`);
    console.log(`records whose twin shows no number difference: off ${s.noDiff.off.length}, on ${s.noDiff.on.length}`);
    for (const gate of ['off', 'on']) {
      const by = {};
      for (const r of s.noDiff[gate]) (by[r.reason.replace(/\(.*\)/, '(...)')] ??= []).push(r.record);
      for (const [why, ids] of Object.entries(by)) console.log(`  [gate ${gate}] ${ids.length} — ${why}: ${ids.slice(0, 8).join(' ')}${ids.length > 8 ? ' …' : ''}`);
    }
    console.log(`record characters not holding their record: off ${s.notHeld.off.length}, on ${s.notHeld.on.length}`);
    for (const x of [...s.notHeld.off.slice(0, 10)]) console.log(`  [off] ${x}`);
    return legacyOut;
  });
}

if (IS_MAIN) process.exit(await main());
