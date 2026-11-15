/*
 * OLDER-APP REPLAY — a pre-release guard (Tweaks phase 2, WPR; plan work/tweaks-phase2-notes/plan.md, section 5).
 *
 * WHAT IT PROVES. Players still run v0.1.44 and v0.1.45. Tweaks phase 2 stores its tweaks as new kinds of
 * `overrides.blocks` element and keeps place picks under `${level}:extra${category}:${n}` keys. An older app
 * knows none of that, so the promise is: it keeps every byte, draws nothing wrongly, and applies nothing it does
 * not understand. This script replays every `overrides:p2-*` parity character (the non-`#none` ones: a twin has no
 * overrides to replay) through THOSE VERSIONS' OWN CODE and fails on any broken promise:
 *
 *   copy        the temporary copy of `pruneOverrides` + `overrideHasContent` (src/builder/shared.tsx is .tsx,
 *               which jiti cannot parse) equals the release text byte for byte;
 *   A-prune     pruneOverrides(overrides, {}) and an unrelated edit ({maxHp}) lose no `overrides` byte;
 *   A-blocks    (v0.1.45) parseStoredBlocks puts every element in known or foreign, every phase-2 kind in foreign;
 *               writeStoredBlocks with no change, with an upsert of a known id, and with a removal aimed at a
 *               foreign id returns the list unchanged (the foreign one in `refused`);
 *   A-build     buildCharacter keeps `overrides` byte for byte; deriveBuildFromCharacter (the build-less reopen)
 *               gives them back byte for byte;
 *   B-carriers  buildCharacter(spec) equals buildCharacter(the same build minus its phase-2 blocks): carriers and
 *               a removed place's answer (skill increase, boost, class-feature choice, tactic, rune, feat slot)
 *               apply exactly as the book applies them;
 *   C-places    every place pick appears as a feat with no slot (its own `extra…` key, never a real slot); every
 *               real-slot pick keeps its feat and no real slot holds a place pick;
 *   D-rekey     rekeyFeatSlots for every SLOT_TOGGLE flip (freeArchetype, ancestryParagon, dualClass, mythicEnabled)
 *               leaves every place key and its answers where they were and drops no pick;
 *   E-kept      `Character.tweakKept` (written by the new app) is ignored by the older reverse build and never
 *               written back.
 *
 * HOW. It makes two scratch `git worktree add --detach` checkouts (release/v0.1.45 and tag v0.1.44) under
 * C:\Users\r2g2\AppData\Local\Temp\hh-replay\, links the repo's node_modules into each with a directory junction,
 * loads the specs from scripts/blocks-parity-snapshot.mjs (`loadEngine().specs`, current checkout), and loads each
 * version's modules through jiti. The sheet database is the CURRENT checkout's (an older app would have older data;
 * the claims here are about code, not records). Both worktrees (and junctions, removed with `cmd /c rmdir`, never a
 * recursive delete) are removed in a finally block, then `git worktree prune`.
 *
 * RUN (under the heavy-job lock, like scripts/vt.mjs, so never beside vitest):
 *   node scripts/older-app-replay.mjs                    # every p2 spec, both versions
 *   node scripts/older-app-replay.mjs --only <regex>     # restrict spec ids (experiments)
 *   node scripts/older-app-replay.mjs --versions v45     # v44, v45 or both (default)
 *   node scripts/older-app-replay.mjs --dump <spec id>   # print the older apps' feat rows for one spec
 *   node scripts/older-app-replay.mjs --self-test        # plants a bad case for every check family (lost block, ordinal
 *                                                          key, changed prune copy, applied carrier, dropped/drawn place
 *                                                          pick, tweakKept written back, lost/stray block on reopen)
 * Exit 0 = every promise held (self-test: every plant was caught and the control run was clean).
 *
 * WARNING. A hard kill (taskkill, power loss) skips the cleanup and leaves C:\Users\r2g2\AppData\Local\Temp\hh-replay\v44|v45
 * with a node_modules directory JUNCTION that points at the REAL node_modules. NEVER recursively delete that folder by hand
 * (the delete follows the junction and empties the repo's node_modules). Run this script once (it prints a loud warning and
 * removes the junctions first, with `cmd /c rmdir`), or `cmd /c rmdir <dir>\node_modules` yourself before anything else.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createJiti } from 'jiti';
import { withHeavyLock } from './lib/heavy-lock.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
const SCRATCH = 'C:\\Users\\r2g2\\AppData\\Local\\Temp\\hh-replay';
const VERSIONS = [
  { label: 'v0.1.44', ref: 'v0.1.44', dir: join(SCRATCH, 'v44'), key: 'v44', hasStored: false },
  { label: 'v0.1.45', ref: 'release/v0.1.45', dir: join(SCRATCH, 'v45'), key: 'v45', hasStored: true },
];
const argv = process.argv.slice(2);
const has = (n) => argv.includes(n);
const arg = (n) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};

const git = (args, opts = {}) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024, ...opts });

/* ---------------------------------------------------------------------------------------------- */
/* worktrees                                                                                       */
/* ---------------------------------------------------------------------------------------------- */
function removeWorktree(dir) {
  const nm = join(dir, 'node_modules');
  // The junction goes first and alone: a recursive delete (or `git worktree remove`) would follow it.
  if (existsSync(nm)) {
    try {
      execFileSync('cmd', ['/c', 'rmdir', nm], { stdio: 'ignore' });
    } catch (e) {
      console.error(`could not remove the junction ${nm}: ${e.message} — NOT removing the worktree`);
      return false;
    }
  }
  try {
    git(['worktree', 'remove', '--force', dir]);
  } catch {
    /* not a registered worktree (or already gone): prune below clears the record */
  }
  return true;
}

function makeWorktree(v) {
  mkdirSync(SCRATCH, { recursive: true });
  if (existsSync(v.dir)) {
    // left by a crashed or killed run (a hard kill skips `finally`)
    if (existsSync(join(v.dir, 'node_modules')))
      console.warn(
        `\n!!! WARNING: a leftover worktree at ${v.dir} still has a node_modules JUNCTION that points at the REAL node_modules.\n` +
          `!!! Removing it with \`cmd /c rmdir\` (the junction only, never recursively). NEVER delete ${SCRATCH} by hand or with a recursive delete: it would follow the junction.\n`,
      );
    removeWorktree(v.dir);
  }
  git(['worktree', 'prune']);
  git(['worktree', 'add', '--detach', v.dir, v.ref]);
  execFileSync('cmd', ['/c', 'mklink', '/J', join(v.dir, 'node_modules'), join(ROOT, 'node_modules')], { stdio: 'ignore' });
}

function cleanup() {
  for (const v of VERSIONS) if (existsSync(v.dir)) removeWorktree(v.dir);
  try {
    git(['worktree', 'prune']);
  } catch {
    /* nothing to do */
  }
}

/* ---------------------------------------------------------------------------------------------- */
/* the verbatim copy of pruneOverrides + overrideHasContent                                         */
/* ---------------------------------------------------------------------------------------------- */
const BEGIN = '// ---BEGIN VERBATIM (git show) ---\n';
const END = '\n// ---END VERBATIM---';

/** The release text of the two functions (and the doc comments between them), cut out of shared.tsx. */
function pruneText(ref) {
  const src = git(['show', `${ref}:src/builder/shared.tsx`]).replace(/\r\n/g, '\n');
  const a = src.indexOf('export function pruneOverrides(');
  const fn = src.indexOf('function overrideHasContent(');
  if (a < 0 || fn < 0) throw new Error(`${ref}: pruneOverrides / overrideHasContent not found in shared.tsx`);
  const end = src.indexOf('\n}\n', fn);
  if (end < 0) throw new Error(`${ref}: overrideHasContent has no end`);
  // From the doc comment above overrideHasContent's neighbour is not needed: keep exactly the two functions.
  return src.slice(a, end + 2);
}

function writePruneModule(v, tamper) {
  let body = pruneText(v.ref);
  if (tamper) body = tamper(body);
  const text = `type BuildOverrides = any;\n${BEGIN}${body}${END}\nexport { overrideHasContent };\n`;
  const dir = join(v.dir, '.replay');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'prune-copy.ts');
  writeFileSync(file, text);
  return file;
}

/** The copy is the release text, byte for byte (read back from the file the module was loaded from). */
function copyMatches(v, file) {
  const text = readFileSync(file, 'utf8');
  const a = text.indexOf(BEGIN);
  const b = text.indexOf(END);
  if (a < 0 || b < 0) return false;
  return text.slice(a + BEGIN.length, b) === pruneText(v.ref);
}

/* ---------------------------------------------------------------------------------------------- */
/* loading a version                                                                                */
/* ---------------------------------------------------------------------------------------------- */
async function loadVersion(v, { tamperPrune = null } = {}) {
  const jiti = createJiti(pathToFileURL(join(v.dir, 'noop.mjs')).href, { fsCache: false, moduleCache: false });
  const imp = (p) => jiti.import(join(v.dir, p));
  const buildMod = await imp('src/rules/build.ts');
  const slotsMod = await imp('src/rules/featSlots.ts');
  const stored = v.hasStored ? await imp('src/rules/blocks/stored.ts') : null;
  const copyFile = writePruneModule(v, tamperPrune);
  const prune = await jiti.import(copyFile);
  return {
    ...v,
    buildCharacter: buildMod.buildCharacter,
    deriveBuildFromCharacter: buildMod.deriveBuildFromCharacter,
    rekeyFeatSlots: slotsMod.rekeyFeatSlots,
    parseStoredBlocks: stored?.parseStoredBlocks ?? null,
    writeStoredBlocks: stored?.writeStoredBlocks ?? null,
    pruneOverrides: prune.pruneOverrides,
    copyFile,
    copyOk: copyMatches(v, copyFile),
  };
}

/* ---------------------------------------------------------------------------------------------- */
/* the checks                                                                                       */
/* ---------------------------------------------------------------------------------------------- */
const J = (x) => JSON.stringify(x);
const sortedJ = (x) => JSON.stringify(x, (_k, val) => (val && typeof val === 'object' && !Array.isArray(val) ? Object.fromEntries(Object.keys(val).sort().map((k) => [k, val[k]])) : val));
const PLACE_KEY = /^\d+:extra[a-z]+:\d+$/;
const REAL_KEY = '2:class:0'; // a printed fighter class slot
const REAL_FEAT = 'sudden-charge'; // a valid fighter class feat for it
const PHASE2_KIND =/^(choice|remove)\./;
const SLOT_TOGGLES = ['freeArchetype', 'ancestryParagon', 'dualClass', 'mythicEnabled'];
const flip = (b, f) => (f === 'mythicEnabled' ? { ...b, mythicEnabled: !b.mythicEnabled } : { ...b, variantRules: { ...(b.variantRules ?? {}), [f]: !b.variantRules?.[f] } });
const without = (o, ...ks) => Object.fromEntries(Object.entries(o).filter(([k]) => !ks.includes(k)));

/** The same build with the phase-2 blocks removed: what an older app "applies" of it. */
function bookBuild(build) {
  const ov = build.overrides;
  if (!ov) return build;
  const kept = (ov.blocks ?? []).filter((b) => !PHASE2_KIND.test(b?.kind ?? ''));
  const rest = without(ov, 'blocks');
  return { ...build, overrides: kept.length ? { ...rest, blocks: kept } : rest };
}

/** The top-level `overrides` keys of `orig` that `got` lost or changed, byte for byte. ONLY `addedFeats` may grow, at
 *  its end, and only with the reverse build's overflow chip: one per stored pick it did not slot (`chipsLeft`: feat id ->
 *  unslotted copies); a feat both slotted and chipped, or any other element, or a new key, is refused. */
function lostFrom(orig, got, chipsLeft) {
  const left = new Map(chipsLeft);
  const take = (x) => {
    const n = left.get(x?.featId) ?? 0;
    if (n <= 0) return false;
    left.set(x.featId, n - 1);
    return true;
  };
  const bad = [];
  for (const [k, v] of Object.entries(orig ?? {})) {
    const g = got?.[k];
    if (k === 'addedFeats' && Array.isArray(v) && Array.isArray(g)) {
      if (!v.every((x, i) => J(x) === J(g[i]))) bad.push(k);
      else if (!g.slice(v.length).every(take)) bad.push(`${k}(stray or double-counted element)`);
    } else if (J(g) !== J(v)) bad.push(k);
  }
  for (const k of Object.keys(got ?? {})) {
    if (k in (orig ?? {})) continue;
    if (k === 'addedFeats' && Array.isArray(got[k]) && got[k].every(take)) continue;
    bad.push(`${k}(new key)`);
  }
  return bad;
}

/** A row's slot key, whichever field this version names it by. */
const rowSlot = (r) => r.slotKey ?? r.slot ?? r.key ?? null;

/**
 * All checks of one spec against one loaded version. `ctx` = { DB, headBuild, hooks }. Returns failure lines.
 * `hooks` lets --self-test replace one of the version's functions with a planted bad one.
 */
function checkSpec(V, spec, ctx) {
  const out = [];
  const fail = (check, detail) => out.push({ version: V.label, spec: spec.id, check, detail });
  const build = spec.build;
  const ov = build.overrides;
  const origOv = J(ov);
  const fn = { ...V, ...(ctx.hooks?.[V.key] ?? {}) };

  // A-prune
  try {
    const kept = fn.pruneOverrides(ov, {});
    if (J(kept) !== origOv) fail('A-prune', `pruneOverrides(overrides, {}) changed the overrides`);
    const edited = fn.pruneOverrides(ov, { maxHp: 41 });
    if (!edited || J(without(edited, 'maxHp')) !== origOv) fail('A-prune', `an unrelated edit ({maxHp}) changed other overrides keys`);
  } catch (e) {
    fail('A-prune', `threw: ${e.message}`);
  }

  // A-blocks (v0.1.45)
  if (fn.parseStoredBlocks && ov?.blocks) {
    try {
      const { known, foreign } = fn.parseStoredBlocks(ov.blocks);
      if (known.length + foreign.length !== ov.blocks.length) fail('A-blocks', `parse partition ${known.length}+${foreign.length} != ${ov.blocks.length}`);
      const knownIds = new Set(known.map((k) => k.key.slice('blocks:'.length)));
      for (const b of ov.blocks) if (PHASE2_KIND.test(b.kind) && knownIds.has(b.id)) fail('A-blocks', `phase-2 kind ${b.kind} is read as known`);
      const same = fn.writeStoredBlocks(ov.blocks, {});
      if (J(same.list) !== J(ov.blocks)) fail('A-blocks', 'writeStoredBlocks(list, {}) changed the list');
      if (known.length) {
        const id = known[0].key.slice('blocks:'.length);
        const raw = ov.blocks.find((b) => b.id === id);
        const up = fn.writeStoredBlocks(ov.blocks, { upsert: [{ ...raw }] });
        const others = (l) => J((l).filter((b) => b.id !== id));
        if (others(up.list) !== others(ov.blocks)) fail('A-blocks', 'an upsert of a known block changed another element');
      }
      if (foreign.length) {
        const fid = foreign[0].id ?? ov.blocks.find((b) => b === foreign[0].raw)?.id;
        if (fid) {
          const rm = fn.writeStoredBlocks(ov.blocks, { removeIds: [fid] });
          if (J(rm.list) !== J(ov.blocks)) fail('A-blocks', 'a removal aimed at a foreign block changed the list');
          if (!rm.refused.includes(fid)) fail('A-blocks', 'a removal aimed at a foreign block was not refused');
        }
      }
    } catch (e) {
      fail('A-blocks', `threw: ${e.message}`);
    }
  }

  // build once, with the older engine
  let ch;
  let ch0;
  try {
    ch = fn.buildCharacter(build, ctx.DB);
    ch0 = fn.buildCharacter(bookBuild(build), ctx.DB);
  } catch (e) {
    fail('build', `buildCharacter threw: ${String(e.message).split('\n')[0]}`);
    return out;
  }

  // A-build
  if (J(ch.overrides) !== origOv) fail('A-build', 'buildCharacter changed the overrides');
  if ('tweakKept' in ch) fail('E-kept', 'the older buildCharacter wrote a tweakKept');

  // B-carriers
  if (sortedJ(without(ch, 'overrides')) !== sortedJ(without(ch0, 'overrides'))) {
    const a = Object.keys(ch).filter((k) => k !== 'overrides' && sortedJ(ch[k]) !== sortedJ(ch0[k]));
    fail('B-carriers', `the character differs from the same build without its phase-2 blocks in: ${a.join(', ') || '(key sets)'}`);
  }

  // C-places
  const picks = build.featPicks ?? {};
  const rows = ch.feats ?? [];
  for (const [k, id] of Object.entries(picks)) {
    if (!id) continue;
    const atKey = rows.filter((r) => rowSlot(r) === k);
    if (PLACE_KEY.test(k)) {
      ctx.stats && (ctx.stats[V.label] ??= { places: 0, flips: 0 }).places++;
      if (!atKey.some((r) => r.featId === id)) fail('C-places', `place pick ${id} at ${k} is not a feat with no slot (rows: ${atKey.map((r) => r.featId).join(',') || 'none'})`);
    } else if (!atKey.some((r) => r.featId === id)) {
      // a real slot's pick may have been refused by its own picker rules, but the older app must hold it
      if (!rows.some((r) => r.featId === id)) fail('C-places', `real-slot pick ${id} at ${k} was emptied (no feat row)`);
    }
  }
  // …and no place pick's feat sits in a real slot (filled or EMPTY) unless that slot's own pick is that feat
  const placeFeatIds = new Set(Object.entries(picks).filter(([k, id]) => PLACE_KEY.test(k) && id).map(([, id]) => id));
  for (const r of rows) {
    const k = rowSlot(r);
    if (k && /^\d+:[a-z]+:\d+$/.test(k) && !PLACE_KEY.test(k) && placeFeatIds.has(r.featId) && picks[k] !== r.featId)
      fail('C-places', `a place pick (${r.featId}) is drawn in the real slot ${k}`);
  }

  // D-rekey
  const placeKeys = Object.keys(picks).filter((k) => PLACE_KEY.test(k));
  for (const f of SLOT_TOGGLES) {
    try {
      ctx.stats && (ctx.stats[V.label] ??= { places: 0, flips: 0 }).flips++;
      const next = flip(build, f);
      const out2 = fn.rekeyFeatSlots(build, next, ctx.DB);
      for (const k of placeKeys) {
        if (out2.featPicks?.[k] !== picks[k]) fail('D-rekey', `flip ${f}: place key ${k} (${picks[k]}) is now ${out2.featPicks?.[k] ?? 'gone'}`);
        for (const m of ['featChoices', 'pickFeatChoices']) {
          if (build[m]?.[k] !== undefined && J(out2[m]?.[k]) !== J(build[m][k])) fail('D-rekey', `flip ${f}: ${m}[${k}] moved`);
        }
      }
      const ids = (b) => Object.values(b.featPicks ?? {}).filter(Boolean).sort().join(',');
      if (ids(out2) !== ids(next)) fail('D-rekey', `flip ${f}: a pick was dropped or duplicated`);
    } catch (e) {
      fail('D-rekey', `flip ${f} threw: ${String(e.message).split('\n')[0]}`);
    }
  }

  // E-kept: the NEW app's character (with tweakKept) through the older reverse build
  try {
    const cNew = ctx.headBuild(build);
    const b1 = fn.deriveBuildFromCharacter(cNew, ctx.DB);
    const b2 = fn.deriveBuildFromCharacter(without(cNew, 'tweakKept'), ctx.DB);
    if (J(b1).includes('tweakKept')) fail('E-kept', 'the older reverse build wrote tweakKept back');
    if (sortedJ(b1) !== sortedJ(b2)) fail('E-kept', 'tweakKept changed the older reverse build (not ignored)');
    // the reading direction on EVERY spec (cNew may carry none): a made-up tweakKept must change nothing either
    const b3 = fn.deriveBuildFromCharacter({ ...without(cNew, 'tweakKept'), tweakKept: { planted: true, feats: [], boosts: [], skillIncreases: [] } }, ctx.DB);
    if (sortedJ(b3) !== sortedJ(b2)) fail('E-kept', 'the older reverse build READS Character.tweakKept (a made-up one changed the build)');
    // the chip is for any stored pick the reverse build cannot slot (a place pick, or a real pick its slot refuses)
    // an appended chip is allowed only for a stored pick the reverse build did NOT slot: per feat id, copies in the input
    // featPicks minus copies in the reverse build's featPicks (a feat both slotted and chipped is a double count)
    const count = (m) => {
      const c = new Map();
      for (const id of Object.values(m ?? {})) if (id) c.set(id, (c.get(id) ?? 0) + 1);
      return c;
    };
    const was = count(picks);
    const slotted = count(b1.featPicks);
    const placeFeats = new Map([...was].map(([id, n]) => [id, Math.max(0, n - (slotted.get(id) ?? 0))]));
    const lost = lostFrom(ov, b1.overrides, placeFeats);
    if (lost.length) fail('A-build', `the older reverse build (build-less reopen) lost or changed overrides: ${lost.join(', ')}`);
    else if (J(b1.overrides) !== origOv) ctx.notes?.add(`${V.label}: the build-less reopen ADDS to overrides (overflow chip in addedFeats), losing nothing`);
  } catch (e) {
    fail('E-kept', `reverse build threw: ${String(e.message).split('\n')[0]}`);
  }
  return out;
}

/* ---------------------------------------------------------------------------------------------- */
/* run                                                                                             */
/* ---------------------------------------------------------------------------------------------- */
async function loadSpecs() {
  const mainJiti = createJiti(pathToFileURL(join(ROOT, 'noop.mjs')).href, {});
  const snap = await import(pathToFileURL(join(ROOT, 'scripts/blocks-parity-snapshot.mjs')).href);
  const E = await snap.loadEngine((p) => mainJiti.import(join(ROOT, p)));
  E.setGate('off');
  const base = E.specs.filter((s) => /^overrides:p2-/.test(s.id) && !s.id.endsWith('#none') && s.build?.overrides);
  /* "+real" twins (made here, not in the parity spec file): each feat-place spec with ONE printed class slot filled, so
   * "no real slot emptied" and "no place pick drawn in a real slot" are measured on a character that has both. */
  const aug = base
    .filter((s) => /^overrides:p2-feat-place-/.test(s.id) && Object.keys(s.build.featPicks ?? {}).every((k) => PLACE_KEY.test(k)))
    .map((s) => ({ ...s, id: `${s.id}+real`, build: { ...s.build, featPicks: { ...s.build.featPicks, [REAL_KEY]: REAL_FEAT } } }));
  return { E, specs: [...base, ...aug], augCount: aug.length };
}

function summarise(failures, specCount, versions) {
  const by = new Map();
  for (const f of failures) by.set(`${f.version}|${f.check}`, (by.get(`${f.version}|${f.check}`) ?? 0) + 1);
  for (const v of versions) console.log(`${v.label}: ${specCount} p2 specs replayed, ${failures.filter((f) => f.version === v.label).length} failures`);
  for (const [k, n] of by) console.log(`  ${k.replace('|', ' ')}: ${n}`);
}

async function main() {
  const only = arg('--only') ? new RegExp(arg('--only')) : null;
  const which = arg('--versions');
  const versions = VERSIONS.filter((v) => !which || which === 'both' || which === v.key);
  const selfTest = has('--self-test');
  let code = 1;
  const onSignal = () => {
    cleanup();
    process.exit(130);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  try {
    const { E, specs: all, augCount } = await loadSpecs();
    const specs = only ? all.filter((s) => only.test(s.id)) : all;
    console.log(`p2 specs found: ${all.length - augCount} (non-twin, with overrides) + ${augCount} "+real" twins; replaying ${specs.length}`);
    const ctx = { DB: E.DB.off, headBuild: (b) => E.buildCharacter(b, E.DB.off), hooks: {}, notes: new Set(), stats: {} };
    for (const v of versions) makeWorktree(v);
    const loaded = [];
    for (const v of versions) loaded.push(await loadVersion(v));

    if (has('--dump')) {
      const spec = all.find((s) => s.id === arg('--dump'));
      for (const V of loaded) {
        const ch = V.buildCharacter(spec.build, ctx.DB);
        console.log(`\n${V.label} feats for ${spec.id}`);
        for (const r of ch.feats ?? []) console.log(' ', J(r));
        console.log('  featPicks', J(spec.build.featPicks));
      }
      code = 0;
      return code;
    }

    const run = (list, extraCtx = ctx) => {
      const fails = [];
      for (const V of loaded) {
        if (!V.copyOk) fails.push({ version: V.label, spec: '-', check: 'copy', detail: 'the pruneOverrides copy differs from the release text' });
        for (const s of list) fails.push(...checkSpec(V, s, extraCtx));
      }
      return fails;
    };

    if (!selfTest) {
      const fails = run(specs);
      summarise(fails, specs.length, loaded);
      for (const [k, s] of Object.entries(ctx.stats)) console.log(`${k}: ${s.places} place picks checked, ${s.flips} SLOT_TOGGLE flips rekeyed`);
      for (const n of ctx.notes) console.log(`note: ${n}`);
      for (const f of fails.slice(0, 60)) console.log(`FAIL [${f.version}] ${f.spec} ${f.check}: ${f.detail}`);
      if (fails.length > 60) console.log(`... and ${fails.length - 60} more`);
      console.log(fails.length ? `FAILED (${fails.length})` : 'OK: every promise held');
      code = fails.length ? 1 : 0;
      return code;
    }

    /* ---- --self-test: a control run, then three planted bad cases; each must fail on its own ------- */
    const pickIds = (re) => specs.filter((s) => re.test(s.id));
    const augSpecs = pickIds(/\+real$/);
    const sample = [...specs.filter((s) => Object.keys(s.build.featPicks ?? {}).some((k) => PLACE_KEY.test(k)) && !/-(paused|off):/.test(s.id)).slice(0, 2), ...specs.slice(0, 2), ...augSpecs.slice(0, 1)];
    if (!augSpecs.length) throw new Error('self-test: no "+real" twin was made');
    if (!sample.some((s) => (s.build.overrides.blocks ?? []).length)) throw new Error('self-test sample has no block');
    let bad = 0;
    const expect = (name, fails, want) => {
      const hit = fails.filter((f) => f.check === want);
      const ok = hit.length > 0;
      console.log(`${ok ? 'PLANT CAUGHT' : 'PLANT MISSED'}: ${name}${ok ? `\n   ${hit[0].version} ${hit[0].spec} ${hit[0].check}: ${hit[0].detail}` : ''}`);
      if (!ok) bad++;
    };
    const control = run(sample);
    console.log(control.length ? `CONTROL FAILED (${control.length}): ${control[0].check} ${control[0].detail}` : `control run clean (${sample.length} specs, ${loaded.length} versions)`);
    if (control.length) bad++;

    // 1. a lost block: writeStoredBlocks (v0.1.45) drops the last element; pruneOverrides (v0.1.44) drops `blocks`
    {
      const hooks = {
        v45: { writeStoredBlocks: (prev, ch) => { const r = loaded.find((l) => l.key === 'v45').writeStoredBlocks(prev, ch); return { ...r, list: Array.isArray(r.list) ? r.list.slice(0, -1) : r.list }; } },
        v44: { pruneOverrides: (prev, next) => { const r = loaded.find((l) => l.key === 'v44').pruneOverrides(prev, next); return r && without(r, 'blocks'); } },
      };
      expect('a lost block (list write drops the last element / prune drops `blocks`)', run(sample, { ...ctx, hooks }), 'A-blocks');
      expect('…the same lost block through the Overrides-card prune', run(sample, { ...ctx, hooks }), 'A-prune');
    }
    // 2. an ordinal-captured key: the rekey re-keys a place by its ordinal (`extra…:0`) instead of leaving its key
    {
      const rekey = (key) => (prev, next, db) => {
        const out = loaded.find((l) => l.key === key).rekeyFeatSlots(prev, next, db);
        const featPicks = Object.fromEntries(Object.entries(out.featPicks ?? {}).map(([k, v]) => [PLACE_KEY.test(k) ? k.replace(/:\d+$/, ':0') : k, v]));
        return { ...out, featPicks };
      };
      const hooks = { v44: { rekeyFeatSlots: rekey('v44') }, v45: { rekeyFeatSlots: rekey('v45') } };
      expect('an ordinal-captured place key (rekey rewrites `extra…:n` to its ordinal)', run(sample, { ...ctx, hooks }), 'D-rekey');
    }
    // 3. a changed copy of pruneOverrides
    {
      const tampered = [];
      for (const v of versions) tampered.push(await loadVersion(v, { tamperPrune: (t) => t.replace('overrideHasContent(v, 1)', 'overrideHasContent(v, 0)') }));
      const fails = tampered.filter((t) => !t.copyOk).map((t) => ({ version: t.label, spec: '-', check: 'copy', detail: 'the pruneOverrides copy differs from the release text' }));
      expect('a changed copy of pruneOverrides (depth 1 -> 0)', fails, 'copy');
    }
    // 4-8. one plant per remaining check family, each by wrapping the older version's own function
    {
      const both = (mk) => Object.fromEntries(loaded.map((l) => [l.key, mk(l)]));
      const bareCtx = (hooks) => ({ ...ctx, hooks, stats: null, notes: new Set() });
      const live = (b) => (b.overrides?.blocks ?? []).filter((x) => x.on !== false && b.options?.overridesEnabled !== false);
      const boostSpecs = pickIds(/p2-boost-place/).filter((s) => !/-(paused|off):/.test(s.id));
      if (!boostSpecs.length) throw new Error('self-test: no live boost-place spec');
      // 4. buildCharacter applies a live boost carrier
      expect('the older build applies a live boost carrier (+2 to the attribute)', run(boostSpecs, bareCtx(both((l) => ({
        buildCharacter: (b, db) => {
          const ch = l.buildCharacter(b, db);
          const bl = live(b).find((x) => x.kind === 'choice.addPlace' && x.place === 'boost' && x.attribute);
          if (!bl) return ch;
          const cur = ch.abilities[bl.attribute];
          const abilities = { ...ch.abilities, [bl.attribute]: typeof cur === 'number' ? cur + 2 : { ...cur, score: (cur.score ?? 0) + 2, mod: (cur.mod ?? 0) + 1 } };
          return { ...ch, abilities };
        },
      })))), 'B-carriers');
      // 5. buildCharacter drops the place picks
      expect('the older build drops the place picks', run(augSpecs, bareCtx(both((l) => ({
        buildCharacter: (b, db) => l.buildCharacter({ ...b, featPicks: Object.fromEntries(Object.entries(b.featPicks ?? {}).filter(([k]) => !PLACE_KEY.test(k))) }, db),
      })))), 'C-places');
      // 6. a place pick drawn into an EMPTY real slot, and over a FILLED one
      const drawIn = (keyOf) => both((l) => ({
        buildCharacter: (b, db) => {
          const ch = l.buildCharacter(b, db);
          const place = (ch.feats ?? []).find((r) => PLACE_KEY.test(rowSlot(r) ?? ''));
          if (!place) return ch;
          const k = keyOf(b);
          return { ...ch, feats: [...(ch.feats ?? []).filter((r) => rowSlot(r) !== k), { ...place, slotKey: k, category: 'class' }] };
        },
      }));
      expect('a place pick drawn into an EMPTY real slot', run(augSpecs, bareCtx(drawIn(() => '4:class:0'))), 'C-places');
      expect('a place pick drawn over a FILLED real slot (its pick emptied)', run(augSpecs, bareCtx(drawIn(() => REAL_KEY))), 'C-places');
      // 7. the reverse build writes tweakKept back
      expect('the older reverse build copies tweakKept into the build', run(sample, bareCtx(both((l) => ({
        deriveBuildFromCharacter: (c, db) => ({ ...l.deriveBuildFromCharacter(c, db), tweakKept: c.tweakKept ?? { planted: true } }),
      })))), 'E-kept');
      expect('the older reverse build READS c.tweakKept (adds a pick when one is present)', run(sample, bareCtx(both((l) => ({
        deriveBuildFromCharacter: (c, db) => {
          const b = l.deriveBuildFromCharacter(c, db);
          return c.tweakKept ? { ...b, featPicks: { ...b.featPicks, '9:general:0': 'planted-feat' } } : b;
        },
      })))), 'E-kept');
      // 7b. a feat the reverse build BOTH slots and appends as an overflow chip (double count)
      expect('the older reverse build keeps sudden-charge slotted AND chips it into addedFeats', run(augSpecs, bareCtx(both((l) => ({
        deriveBuildFromCharacter: (c, db) => {
          const b = l.deriveBuildFromCharacter(c, db);
          return { ...b, overrides: { ...b.overrides, addedFeats: [...(b.overrides?.addedFeats ?? []), { featId: REAL_FEAT, level: 2, category: 'class' }] } };
        },
      })))), 'A-build');
      // 8. the reverse build drops overrides.blocks / appends a stray element to them
      expect('the older reverse build drops overrides.blocks', run(sample, bareCtx(both((l) => ({
        deriveBuildFromCharacter: (c, db) => { const b = l.deriveBuildFromCharacter(c, db); return { ...b, overrides: b.overrides && without(b.overrides, 'blocks') }; },
      })))), 'A-build');
      expect('the older reverse build appends a stray element to overrides.blocks', run(sample, bareCtx(both((l) => ({
        deriveBuildFromCharacter: (c, db) => { const b = l.deriveBuildFromCharacter(c, db); return { ...b, overrides: { ...b.overrides, blocks: [...(b.overrides?.blocks ?? []), { id: 'stray', kind: 'choice.addPlace', v: 1 }] } }; },
      })))), 'A-build');
      expect('the older reverse build appends a non-place feat to addedFeats', run(sample, bareCtx(both((l) => ({
        deriveBuildFromCharacter: (c, db) => { const b = l.deriveBuildFromCharacter(c, db); return { ...b, overrides: { ...b.overrides, addedFeats: [...(b.overrides?.addedFeats ?? []), { featId: 'not-a-place-feat', level: 1, category: 'general' }] } }; },
      })))), 'A-build');
    }
    console.log(bad ? `SELF-TEST FAILED: ${bad} problem(s)` : 'SELF-TEST OK: every planted case failed the script; the control passed');
    code = bad ? 1 : 0;
  } finally {
    cleanup();
    const left = git(['worktree', 'list']).split('\n').filter((l) => /hh-replay/i.test(l));
    console.log(left.length ? `WARNING: scratch worktrees still listed:\n${left.join('\n')}` : 'scratch worktrees removed (git worktree list shows neither)');
  }
  return code;
}

const exit = await withHeavyLock('older-app-replay', async () => {
  let c = 1;
  try {
    c = (await main()) ?? c;
  } catch (e) {
    console.error(e?.stack ?? e);
    c = 1;
  }
  return c;
});
process.exit(exit);
