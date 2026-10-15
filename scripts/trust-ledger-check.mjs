/*
 * WHY THIS SCRIPT EXISTS.
 *
 * src/data/trust-ledger.json is GENERATED and TRACKED, and the runtime imports it as a module
 * (docs/trust-gate.md §2c). Every way it can go wrong is silent at load time: a record id that no
 * longer exists strips nothing and says nothing; a field path outside the hand-checked universe strips
 * something nobody approved; a stale coreSha means the OFF list describes a core.json we no longer
 * ship; a desk ruling with no disposition in scripts/data/trust-approvals.json ships DARK — the gate
 * blanks the very field the owner just told us to build. None of that shows up in a test run of the
 * app, so it belongs in `npm run verify`, beside the other completeness guards.
 *
 * TWO HALVES, because a clean clone is how releases are cut (docs/trust-gate.md §5):
 *
 *   · ALWAYS RUNNABLE — needs only public/core.json and the three tracked trust files. Everything a
 *     clone can check about the shipped ledger without Wanderer's Guide's dump.
 *   · REGENERATE AND DIFF — re-runs scripts/trust-ledger.mjs and compares bytes with the tracked
 *     ledger, so a hand edit or a drifted generator is caught. It needs the comparer output
 *     (work/.wg-diff-all.json), which is derived from the gitignored 50 MB dump, so it prints
 *     "skipped" instead of failing where that input is absent or stale.
 *
 *     node scripts/trust-ledger-check.mjs
 */
import { readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reprintTwinGaps } from './lib/reprint-twin-gaps.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const R = (p) => join(ROOT, p);
const read = (p) => JSON.parse(readFileSync(R(p), 'utf8').replace(/^﻿/, ''));

const failures = [];
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `   ${detail}` : ''}`);
  if (!ok) failures.push(label);
};
const skipped = (label, why) => console.log(`  --    ${label}   ${why}`);
const some = (list, n = 4) => list.slice(0, n).join(', ');

const LEDGER = 'src/data/trust-ledger.json';
if (!existsSync(R(LEDGER))) {
  console.log(`  FAIL  the ledger exists   ${LEDGER} is missing — the app imports it; regenerate with \`node scripts/trust-ledger.mjs\``);
  process.exit(1);
}
const ledgerText = readFileSync(R(LEDGER), 'utf8');
const ledger = JSON.parse(ledgerText);
const coreBytes = readFileSync(R('public/core.json'));
const core = JSON.parse(coreBytes.toString('utf8').replace(/^﻿/, ''));
const fields = read('scripts/data/trust-fields.json');
const approvals = read('scripts/data/trust-approvals.json');

/* ---- 1. the ledger describes the core.json we ship ---------------------------------------------
 * `npm run data` does not regenerate the ledger (it would need the dump, and the chain must stay
 * runnable everywhere), so a regen that added, renamed or dropped records leaves the OFF list talking
 * about a file that no longer exists. regen-durability-check.mjs pins the same invariant from the
 * other side; here it is what makes checks 2-4 below mean anything. */
check(
  'the ledger is stamped with the core.json we ship',
  ledger.coreSha === createHash('sha256').update(coreBytes).digest('hex'),
  ledger.coreSha === createHash('sha256').update(coreBytes).digest('hex') ? '' : `ledger ${String(ledger.coreSha).slice(0, 12)}… vs core.json ${createHash('sha256').update(coreBytes).digest('hex').slice(0, 12)}… — re-run \`node scripts/trust-ledger.mjs\``,
);

/* ---- 2. every key resolves to a real record ---------------------------------------------------- */
{
  const stray = Object.keys(ledger.records ?? {}).filter((k) => {
    const [bucket, ...rest] = k.split('/');
    return !core[bucket]?.[rest.join('/')];
  });
  check('every ledger key resolves to a record in public/core.json', stray.length === 0,
    `${Object.keys(ledger.records ?? {}).length} keys${stray.length ? ` — ${stray.length} resolve to nothing, e.g. ${some(stray)}` : ''}`);
  /* …and so does every record the marker calls "nothing encoded" (`unencoded`, see scripts/trust-ledger.mjs):
   * a stale key there would put the line on nothing, and a missing list would hide it on everything. */
  const strayU = (ledger.unencoded ?? []).filter((k) => {
    const [bucket, ...rest] = k.split('/');
    return !core[bucket]?.[rest.join('/')];
  });
  check('every "nothing encoded" key resolves to a record in public/core.json', Array.isArray(ledger.unencoded) && strayU.length === 0,
    `${(ledger.unencoded ?? []).length} keys${strayU.length ? ` — ${strayU.length} resolve to nothing, e.g. ${some(strayU)}` : ''}`);
  /* …and every "partly encoded" one (`partly`), which also must say WHAT is not applied. */
  const strayP = Object.entries(ledger.partly ?? {}).filter(([k, words]) => {
    const [bucket, ...rest] = k.split('/');
    return !core[bucket]?.[rest.join('/')] || typeof words !== 'string' || !words;
  }).map(([k]) => k);
  check('every "partly encoded" key resolves to a record and names what is not applied', !!ledger.partly && strayP.length === 0,
    `${Object.keys(ledger.partly ?? {}).length} keys${strayP.length ? ` — ${strayP.length} bad, e.g. ${some(strayP)}` : ''}`);
}

/* ---- 3. the buckets that are ON by construction -------------------------------------------------
 * Ruling Q2: deities are on ("there isnt realy a place to mess up here and we need this"). Classes,
 * ancestries and backgrounds are the character CHASSIS (§2 step 3) — a class in the ledger means the
 * gate could take a fighter's HP per level away. */
for (const bucket of ['deities', 'classes', 'ancestries', 'backgrounds']) {
  const named = Object.keys(ledger.records ?? {}).filter((k) => k.startsWith(`${bucket}/`));
  check(`no ${bucket} record is in the ledger`, named.length === 0, named.length ? some(named) : '');
}

/* ---- 4. the denylist is the only vocabulary the ledger has --------------------------------------
 * §2: the gate is a DENYLIST. A path it names that is not in the hand-checked universe is a path
 * nobody approved for stripping — which is how an allowlist bug empties weapon damage and armour AC. */
const universe = new Set(fields.paths.map((f) => f.path));
{
  const stray = [...new Set(Object.values(ledger.records ?? {}).flat())].filter((p) => !universe.has(p));
  check('no ledger path is outside scripts/data/trust-fields.json', stray.length === 0, stray.length ? some(stray) : `${universe.size} paths in the universe`);
}

/* ---- 5. the universe knows every field the comparer knows ---------------------------------------
 * Decision 4 (docs/trust-gate-decisions.md:21-23): every path `fieldToKinds` knows, EXCEPT
 * OUR_KINDS._noCounterpart, is in trust-fields.json as a path or under `_excluded`. A field the
 * comparer can credit but the universe has never heard of is a field the gate silently cannot reach.
 *
 * Read TEXTUALLY, not by import: importing scripts/wg-diff.mjs runs the whole comparer, which needs
 * the 50 MB dump a clean clone does not have (the same reason test/trust-approvals.test.ts does it
 * this way). `fieldToKinds` is built at wg-diff.mjs:594-598 by skipping every `_`-prefixed kind, so
 * dropping `_noCounterpart` here reproduces it exactly. */
const ourKindsBlock = (() => {
  const src = readFileSync(R('scripts/wg-diff.mjs'), 'utf8');
  const start = src.indexOf('const OUR_KINDS = {');
  if (start < 0) return null;
  return src.slice(start, src.indexOf('\n};', start));
})();
const excluded = new Set();
for (const group of Object.values(fields._excluded ?? {})) {
  if (!group || typeof group !== 'object') continue;   // `_excluded._` is the block's own prose
  if (Array.isArray(group.paths)) for (const p of group.paths) excluded.add(p);
  for (const [k, v] of Object.entries(group)) if (k !== '_' && k !== 'paths' && typeof v === 'string') excluded.add(k);
}
if (!ourKindsBlock) {
  check('OUR_KINDS still lives in scripts/wg-diff.mjs', false, 'no `const OUR_KINDS = {` — the completeness check below cannot run');
} else {
  const fieldToKinds = new Set();
  for (const m of ourKindsBlock.matchAll(/^ {2}(_?[A-Za-z][A-Za-z0-9_]*):\s*\[([\s\S]*?)\],?\s*$/gm)) {
    if (m[1].startsWith('_')) continue;            // _noCounterpart: no WG op can ever credit it
    for (const f of m[2].matchAll(/'([^']+)'/g)) fieldToKinds.add(f[1]);
  }
  const unknown = [...fieldToKinds].filter((p) => !universe.has(p) && !excluded.has(p));
  check('every fieldToKinds path is in trust-fields.json or its _excluded list', unknown.length === 0,
    `${fieldToKinds.size} comparer fields${unknown.length ? ` — ${unknown.length} the universe has never heard of: ${some(unknown)}` : ''}`);
}

/* ---- 6. the approvals point at something real ---------------------------------------------------
 * The approvals file is the ONE hand-maintained input, and the one place a mistake is silent: a
 * typo'd path approves nothing while looking like it approved something. Same plausibility rule as
 * test/trust-approvals.test.ts, per decision 5: "a real field on that record OR a path in
 * trust-fields OR a pending record" — widened, as that decision requires, to the nested container
 * paths the desk FIXES create (`choice.options[].grant.grantsFeats`), which no record carries yet. */
const VOCABULARY = new Set(ourKindsBlock ? [...ourKindsBlock.matchAll(/'([A-Za-z][A-Za-z0-9_.]*)'/g)].map((m) => m[1]) : []);
const CONTAINERS = ['choice.options[].grant.passive.', 'effectChoices[].options[].grant.passive.',
  'choice.options[].grant.', 'effectChoices[].options[].grant.', 'whileActive[].', 'enhancement.grant.'];
const leafOf = (path) => CONTAINERS.reduce((p, c) => (p.startsWith(c) ? p.slice(c.length) : p), path);
{
  const badRecord = [];
  const badPath = [];
  for (const list of ['approvals', 'noMechanic']) {
    for (const e of approvals[list] ?? []) {
      const [bucket, id] = String(e.record ?? '').split('/');
      const rec = core[bucket]?.[id];
      /* A `pending` approval names a record the desk fix has not created yet (decision 5); it carries
       * `modelledOn` so its paths can still be checked against a record of the same shape. */
      if (!rec && !e.pending) { badRecord.push(`#${e.n} ${e.record}`); continue; }
      const [mb, mi] = String(e.pending ? e.modelledOn ?? '' : e.record).split('/');
      const target = core[mb]?.[mi] ?? {};
      for (const p of e.fields ?? []) {
        const head = p.split(/[.[]/)[0];
        const nested = p !== leafOf(p) && VOCABULARY.has(leafOf(p));
        if (universe.has(p) || excluded.has(p) || nested || Object.prototype.hasOwnProperty.call(target, head)) continue;
        badPath.push(`#${e.n} ${e.record}: ${p}`);
      }
    }
  }
  check('every approvals entry names a real record (or is pending)', badRecord.length === 0, badRecord.length ? some(badRecord) : `${(approvals.approvals ?? []).length} approvals, ${(approvals.noMechanic ?? []).length} noMechanic`);
  check('every approved field path is plausible', badPath.length === 0, badPath.length ? some(badPath) : '');
}

/* ---- 7. every desk ruling has exactly one disposition -------------------------------------------
 * §2b: every desk number an answers file answers must appear in exactly one of the lists. A number in
 * NO list is a ruling that ships dark; a number in TWO is a ruling whose disposition the file contradicts
 * itself about. Counted by LIST, not by row: one ruling may own several approvals rows (#28 is five quah
 * emblems).
 *
 * EVERY work/desk-answers-*.json, not only 2026-09-10's (package K, 2026-10-15). Reading one file meant a
 * later ruling could never be approved — its number had to sit in `unruled` — so the gate kept dark the
 * rule he had just asked for. An ANSWERED number may not hide in `unruled` either: that list is for
 * numbers no answers file speaks for. And each approvals / noMechanic / engine row cites the file that
 * holds his words (`answers`; none = work/desk-answers-2026-09-10.json), which must answer that number.
 * test/trust-approvals.test.ts asserts the same over the same files. */
{
  const files = existsSync(R('work'))
    ? readdirSync(R('work')).filter((f) => /^desk-answers-.+\.json$/.test(f)).map((f) => `work/${f}`).sort() : [];
  if (!files.length) {
    /* A clone without the desk's answers files has no roster to check against, and `npm run verify` must
     * stay green there. test/trust-approvals.test.ts makes the same check where the files ARE present. */
    skipped('every desk number has exactly one disposition in trust-approvals.json', 'skipped (no work/desk-answers-*.json)');
  } else {
    const FIRST = 'work/desk-answers-2026-09-10.json';
    const answeredIn = new Map();
    for (const f of files) for (const n of (read(f).answers ?? []).flatMap((a) => a.ns ?? [])) answeredIn.set(n, [...(answeredIn.get(n) ?? []), f]);
    const deskNumbers = [...answeredIn.keys()].sort((a, b) => a - b);
    const LISTS = ['approvals', 'noMechanic', 'engine'];
    const listsOf = (n) => LISTS.filter((k) => (approvals[k] ?? []).some((e) => e.n === n));
    const none = deskNumbers.filter((n) => listsOf(n).length === 0);
    const twice = deskNumbers.filter((n) => listsOf(n).length > 1);
    const hidden = (approvals.unruled ?? []).map((e) => e.n).filter((n) => answeredIn.has(n));
    check('every answered desk number has exactly one disposition in trust-approvals.json', none.length === 0 && twice.length === 0 && hidden.length === 0,
      `${deskNumbers.length} answered over ${files.length} answers file(s)${none.length ? ` — ${none.length} with none: ${some(none)}` : ''}${twice.length ? ` — ${twice.length} filed twice: ${some(twice)}` : ''}${hidden.length ? ` — ${hidden.length} answered but still \`unruled\`: ${some(hidden)}` : ''}`);
    const miscited = LISTS.flatMap((k) => (approvals[k] ?? [])
      .filter((e) => !(answeredIn.get(e.n) ?? []).includes(e.answers ?? FIRST))
      .map((e) => `${k} #${e.n} cites ${e.answers ?? FIRST}`));
    const doubled = [...answeredIn].filter(([, fs]) => fs.length > 1).map(([n]) => `#${n}`);
    check('every disposition cites the answers file that holds its ruling', miscited.length === 0 && doubled.length === 0,
      `${miscited.length ? `${miscited.length} cite a file that does not answer them: ${some(miscited)}` : ''}${doubled.length ? ` — answered in two files: ${some(doubled)}` : ''}`);
    /* …and a ruling made from a file NOT named desk-answers-*.json (rule-owner-questions.mjs takes any
     * --answers path) would sit in `unruled` as "ruled" with every check above green while it ships dark.
     * The RULED numbers no answers file speaks for are pinned to the eleven known ones (the same list as
     * test/trust-approvals.test.ts); a new one must come through an answers file. */
    const RULED_WITHOUT_ANSWERS_FILE = [1, 2, 6, 8, 31, 33, 165, 166, 167, 169, 170];
    const ruledUnfiled = (approvals.unruled ?? []).filter((e) => e.status === 'ruled').map((e) => e.n).sort((a, b) => a - b);
    const newOnes = ruledUnfiled.filter((n) => !RULED_WITHOUT_ANSWERS_FILE.includes(n));
    check('no new ruling sits in `unruled` without an answers file', newOnes.length === 0,
      newOnes.length ? `${some(newOnes.map((n) => `#${n}`))} — write his words into a work/desk-answers-*.json file and give each a real disposition` : `${ruledUnfiled.length} known`);
  }
}

/* ---- 8. every whole-class rule is one the generator implements ----------------------------------
 * The 2026-09-11 rules (`rules` in trust-approvals.json) are the owner's *"switch them back on"* —
 * "a rogue gets sneak attack dice again, a barbarian gets Rage, a staff offers its spells". They are
 * matched by NAME in scripts/trust-ledger.mjs, so a renamed or misspelt rule turns nothing back on.
 * The generator itself refuses on an unknown name; this repeats the question from the tracked side,
 * where a clean clone can ask it without the comparer input the generator needs.
 *
 * RULE_NAMES is read TEXTUALLY for the same reason OUR_KINDS is above: importing the generator runs
 * it, and running it needs work/.wg-diff-all.json. */
{
  const src = readFileSync(R('scripts/trust-ledger.mjs'), 'utf8');
  const m = /^const RULE_NAMES = \[([^\]]*)\];/m.exec(src);
  const known = new Set(m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : []);
  const named = (approvals.rules ?? []).map((r) => r?.rule);
  if (!m) {
    check('every trust-approvals rule is one the generator implements', false, 'scripts/trust-ledger.mjs has no top-level `const RULE_NAMES = [...]` — the rule names cannot be checked');
  } else {
    const unknown = named.filter((r) => !known.has(r));
    check('every trust-approvals rule is one the generator implements', unknown.length === 0,
      `${named.length} rule(s): ${named.join(', ') || 'none'}${unknown.length ? ` — ${unknown.length} the generator has never heard of: ${some(unknown)}` : ''}`);
  }
}

/* ---- 9. what the rules turn on is actually on ---------------------------------------------------
 * A rule that is listed and does nothing is the silent failure of this whole file: the census would
 * still print, the ledger would still be valid, and the rogue would still be dark. So the two rules
 * are asserted from the OTHER end — against the shipped OFF list, not against the generator's own
 * bookkeeping.
 *
 * ⚠ The class-owned walk below is a DELIBERATE SECOND COPY of the one in scripts/trust-ledger.mjs,
 * for the same reason FEATGRANT_KEY_KINDS is copied between wg-diff.mjs and the generator: a guard
 * that asks the generator for its own answer cannot catch the generator getting it wrong. Check 10
 * catches the two copies drifting, because a changed derivation changes the ledger bytes. */
{
  const off = ledger.records ?? {};
  if ((approvals.rules ?? []).some((r) => r?.rule === 'class-owned-features')) {
    const owned = new Set();
    const add = (id) => { if (id && core.classFeatures?.[id]) owned.add(id); };
    for (const cls of Object.values(core.classes ?? {})) {
      const subIds = (cls.subclass?.options ?? []).map((o) => o.id);
      for (const f of cls.features ?? []) {
        add(f.featureId);
        add(`${f.featureId}-${cls.id}`);
        for (const s of subIds) add(`${f.featureId}-${s}`);
      }
      for (const o of cls.subclass?.options ?? []) {
        add(o.id);
        for (const e of o.featureIds ?? []) add(typeof e === 'string' ? e : e?.id);
      }
      for (const g of cls.extraChoices ?? []) for (const o of g.options ?? []) add(o.id);
    }
    for (const stack = [...owned]; stack.length;) {
      for (const g of core.classFeatures[stack.pop()]?.grantsClassFeatures ?? []) {
        if (core.classFeatures[g] && !owned.has(g)) { owned.add(g); stack.push(g); }
      }
    }
    const dark = Object.keys(off).filter((k) => k.startsWith('classFeatures/') && owned.has(k.slice('classFeatures/'.length)));
    /* …and the hard-coded lanes, which is where Sneak Attack's dice and Hunt Prey actually live: a
     * record with no OFF path can still have its engine lane gated, and then the rule bought nothing.
     * ALL FIVE lanes, not the three the rule visibly moved: `kindOn` answers for every kind, so a
     * class-owned record left on `modes` or `stances` would be the same bug with a quieter symptom
     * (the kinetic-gate auras and the deviant/curse modes are carried by class-owned features, and
     * 18 of them came off `modes` when the rule landed). Both are 0 today; unasserted is how they
     * would come back. */
    const lanes = [
      ...(ledger.lanes?.engine ?? []).map((id) => `engine/${id}`),
      ...(ledger.lanes?.situational ?? []).map((id) => `situational/${id}`),
      ...(ledger.lanes?.modes ?? []).map((id) => `modes/${id}`),
      ...(ledger.lanes?.stances ?? []).map((id) => `stances/${id}`),
      ...Object.keys(ledger.lanes?.featGrants ?? {}).map((id) => `featGrants/${id}`),
    ].filter((k) => owned.has(k.split('/')[1]));
    check('no class-owned class feature is on the OFF list', dark.length === 0 && lanes.length === 0,
      `${owned.size} class-owned features${dark.length ? ` — ${dark.length} with off paths: ${some(dark)}` : ''}${lanes.length ? ` — ${lanes.length} still lane-gated: ${some(lanes)}` : ''}`);
    /* …and not vacuously: the three the owner named by hand. */
    const named = ['sneak-attack', 'rage', 'hunt-prey'].filter((id) => !owned.has(id));
    check('the features the owner named are class-owned', named.length === 0, named.length ? `not derived: ${some(named)}` : 'sneak-attack, rage, hunt-prey');
  }
  const itemRule = (approvals.rules ?? []).find((r) => r?.rule === 'item-held-spells');
  if (itemRule) {
    const onPath = (p) => (itemRule.fields ?? []).some((f) => p === f || p.endsWith(`.${f}`) || p.startsWith(`${f}.`));
    const dark = Object.entries(off).filter(([k]) => k.startsWith('items/')).flatMap(([k, ps]) => ps.filter(onPath).map((p) => `${k}: ${p}`));
    const carriers = Object.values(core.items ?? {}).filter((r) => r?.heldSpells || r?.spellSlot || r?.innateSpells || r?.resonant).length;
    check('no item-held-spell path is on the OFF list', dark.length === 0,
      dark.length ? some(dark) : `${itemRule.fields?.join(', ')} across ${carriers} items`);
  }
}

/* ---- 9b. the records a rule NAMES BY HAND ------------------------------------------------------
 * `alsoRecords` is the escape hatch for a record the owner named that a rule's derivation cannot
 * reach — Deadly Simplicity is a class FEAT (feats/deadly-simplicity, feat-4642), so the class-owned
 * walk, which starts at the class feature table, never sees it. Its failure mode is the quiet one: a
 * typo'd key, or a generator that reads the list and does nothing with it, leaves the record exactly
 * as dark as before while the file says it was turned on. So it is asserted against the SHIPPED
 * ledger — real record, no OFF path, on no lane. */
{
  const named = (approvals.rules ?? []).flatMap((r) => (r.alsoRecords ?? []).map((rec) => [r.rule, rec]));
  if (named.length) {
    const laneIds = new Set([
      ...(ledger.lanes?.engine ?? []), ...(ledger.lanes?.situational ?? []),
      ...(ledger.lanes?.modes ?? []), ...(ledger.lanes?.stances ?? []),
      ...Object.keys(ledger.lanes?.featGrants ?? {}),
    ]);
    const bad = named
      .filter(([, rec]) => {
        const [bucket, id] = String(rec).split('/');
        return !core[bucket]?.[id] || (ledger.records ?? {})[rec] || laneIds.has(id);
      })
      .map(([rule, rec]) => `${rule}: ${rec}`);
    check('every rule `alsoRecords` entry is a real record with nothing switched off', bad.length === 0,
      bad.length ? some(bad) : named.map(([, rec]) => rec).join(', '));
  }
}

/* ---- 9c. a reprint twin that does less than its legacy printing is never trust-silent -----------
 * "Hide legacy data" offers the reprint in the legacy half's place, and 56 of them arrived as their
 * page's text alone — Greater Singing Shortbow an Equipment card with no Strike — with no marker, beside
 * Keep Pace's "Not yet verified" (2026-09-25). Asserted from the shipped ledger's side: every same-level,
 * same-price item twin lacking a rule field its legacy printing carries (scripts/lib/reprint-twin-gaps.mjs)
 * is `unencoded` or `partly`. A repriced one is not held to it: its legacy printing is no evidence of what
 * it lacks (Arboreal Boots prints no activation), though the ledger still marks it when it applies nothing. */
{
  const rows = reprintTwinGaps(core);
  const marked = (k) => (ledger.unencoded ?? []).includes(k) || !!(ledger.partly ?? {})[k];
  const silent = rows.filter((r) => r.samePrice && !marked(r.key)).map((r) => `${r.key} (lacks ${r.lost.join(', ')})`);
  check('no reprint twin that does less than its legacy printing is trust-silent', silent.length === 0,
    `${rows.filter((r) => r.samePrice).length} same-price twin(s) lack a rule field${silent.length ? ` — ${silent.length} unmarked: ${some(silent)}` : ', every one marked'}`);
}

/* ---- 10. regenerate and diff (the half a clean clone skips) -------------------------------------
 * The tracked ledger must be exactly what the generator produces from the same inputs — otherwise a
 * hand edit, or a generator that drifted from the file it wrote months ago, ships unnoticed. The
 * generator is deterministic (no clock, sorted keys: test/trust-ledger.test.ts pins that), so a byte
 * compare is the whole check.
 *
 * It exits 2 to REFUSE when its comparer input is missing or older than public/core.json. That is not
 * a defect in the tracked ledger, it is an input this machine does not have, so it prints skipped
 * with the generator's own message — the nine checks above already stand on their own. Any other
 * non-zero exit is the generator actually failing, and that is red. */
{
  const DIFF = 'work/.wg-diff-all.json';
  const DUMP = 'work/wg/wg-data.sql';
  if (!existsSync(R(DIFF)) && !existsSync(R(DUMP))) {
    skipped('the tracked ledger is what the generator produces', `skipped (no ${DIFF} and no ${DUMP})`);
  } else {
    const OUT = 'work/.trust-ledger-verify.json';
    const r = spawnSync(process.execPath, [R('scripts/trust-ledger.mjs'), '--out', OUT], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
    const said = `${r.stderr ?? ''}${r.stdout ?? ''}`.split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 300);
    if (r.status === 2) {
      skipped('the tracked ledger is what the generator produces', `skipped — the generator refused: ${said}`);
    } else if (r.status !== 0) {
      check('the tracked ledger is what the generator produces', false, `the generator exited ${r.status}: ${said}`);
    } else {
      const fresh = readFileSync(R(OUT), 'utf8');
      check('the tracked ledger is what the generator produces', fresh === ledgerText,
        fresh === ledgerText ? `${Math.round(ledgerText.length / 1024)} KB, byte-identical` : `a fresh run differs from ${LEDGER} — commit the regenerated ledger (or find out who hand-edited it)`);
      rmSync(R(OUT), { force: true });
    }
  }
}

console.log(failures.length ? `\n${failures.length} TRUST LEDGER CHECK(S) FAILED` : '\ntrust ledger: all checks passed');
process.exit(failures.length ? 1 : 0);
