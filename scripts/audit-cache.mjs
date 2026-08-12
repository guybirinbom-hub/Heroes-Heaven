/*
 * THE AUDIT CACHE — CLI.
 *
 * The 500-feat audit cost 17.4M tokens: it reads every feat twice, once to derive what its text
 * REQUIRES and once to judge whether the app delivers it. Most of that is recoverable on a re-run,
 * because of two properties of the audit's own design:
 *
 *   1. a requirement is derived from the feat's TEXT ALONE — phase 1 is told it has no information
 *      about any app — so building a lane cannot change one;
 *   2. a verdict only needs redoing where the EVIDENCE moved, and building one lane moves the evidence
 *      for a few hundred feats, not for all of them.
 *
 *   node scripts/audit-cache.mjs plan               # what still has to be asked, and why
 *   node scripts/audit-cache.mjs plan --force       # ask everything; the cache is not consulted
 *   node scripts/audit-cache.mjs plan --briefing-ok # the briefing changed but cannot change an answer
 *   node scripts/audit-cache.mjs apply <run.json>   # fold a run's answers back in, assemble all 500
 *   node scripts/audit-cache.mjs status             # what the cache holds, without planning anything
 *
 * `plan` prints the `args` blob to launch the workflow with:
 *   Workflow({ scriptPath: 'scripts/audit/audit-500.js', args: <blob> })
 * With no blob the workflow runs everything, exactly as it did before this existed.
 *
 * ⚠ THE FAILURE THIS IS BUILT AGAINST is not a cache miss — it is a cache HIT on input that changed.
 * Every hash is taken over what the reader itself is handed (see `scripts/lib/audit-cache.mjs`), the
 * paths and documents are read out of the workflow script rather than duplicated here, and anything
 * ambiguous resolves towards recomputing.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  briefingHashes, planRun, planArgs, foldResults, assembleResult, emptyCache, CACHE_VERSION,
} from './lib/audit-cache.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const abs = (p) => join(root, p);
const read = (p) => readFileSync(abs(p), 'utf8');
const readJson = (p) => JSON.parse(read(p));
const has = (n) => process.argv.includes(`--${n}`);
const argOf = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };

const WORKFLOW = 'scripts/audit/audit-500.js';
const CACHE = 'scripts/audit/audit-500-cache.json';
const PLAN = 'scripts/audit/audit-500-plan.json';
const ARGS = 'scripts/audit/audit-500-args.json';
const PLAN_DIR = 'scripts/audit/plan/';
/* NOT `audit-500-result.json`. That file is the 2026-08-11 run, it is committed, it is quoted in
 * CLAUDE.md, and it describes the SHEET HALF ONLY — overwriting it would erase the one record of where
 * those numbers came from. `--out` moves this. */
const RESULT = 'scripts/audit/audit-500-result-both-halves.json';

/** The paths the workflow's own prompts point at, read out of the workflow rather than repeated here.
 *  Two copies of a path is how a cache ends up hashing a document nobody reads. */
function pathsFromWorkflow(src) {
  const grab = (name) => {
    const m = new RegExp(`^const ${name} = \`\\$\\{R\\}(.+)\`$`, 'm').exec(src);
    return m ? m[1] : null;
  };
  const out = { answers: grab('ANSWERS'), lanes: grab('LANES'), exemplars: grab('EXEMPLARS'), evidence: grab('EVIDENCE') };
  for (const [k, v] of Object.entries(out)) {
    if (!v) throw new Error(`audit-cache: cannot find the ${k.toUpperCase()} path in ${WORKFLOW}. The cache would hash the wrong briefing, so it stops here.`);
  }
  return out;
}

function load() {
  const script = read(WORKFLOW);
  const paths = pathsFromWorkflow(script);
  // Exactly the documents the two prompts send a reader to open. `gold-set-answers.md` is the authority:
  // a new owner ruling can change every verdict in the file, so it has to be able to invalidate them.
  const docs = Object.fromEntries(
    [paths.answers, paths.lanes, paths.exemplars].map((p) => [p, existsSync(abs(p)) ? read(p) : '']),
  );
  const briefing = briefingHashes({ script, docs });
  if (!existsSync(abs(paths.evidence))) {
    console.error(`⛔ ${paths.evidence} does not exist — there is nothing to plan an audit over.`);
    console.error('   Build it:  npm run evidence');
    process.exit(1);
  }
  const evidence = readJson(paths.evidence);
  const cache = existsSync(abs(CACHE)) ? readJson(CACHE) : emptyCache();
  if (cache.version !== CACHE_VERSION) {
    console.error(`⛔ cache version ${cache.version} != ${CACHE_VERSION}. Delete ${CACHE} and re-run, or run with --force.`);
    process.exit(1);
  }
  return { script, paths, briefing, evidence, cache };
}

const pct = (n, of) => (of ? `${Math.round((n / of) * 100)}%` : '—');

function reportReasons(label, reasons) {
  const rows = Object.entries(reasons).filter(([r]) => r !== 'reused').sort((a, b) => b[1] - a[1]);
  for (const [reason, n] of rows) console.log(`      ${String(n).padStart(4)} ${label} — ${reason}`);
}

function cmdPlan() {
  const { paths, briefing, evidence, cache } = load();
  if ((evidence.stale || evidence.partial) && !has('allow-stale')) {
    console.error(`⛔ ${paths.evidence} is marked ${evidence.stale ? 'stale' : 'partial'}. Planning over it would plan an audit of an app that no longer exists.`);
    console.error('   Regenerate:  npm run evidence      (--allow-stale plans anyway)');
    process.exit(1);
  }
  const packs = evidence.packs ?? [];
  const plan = planRun({ packs, cache, briefing, force: has('force'), briefingOk: has('briefing-ok') });

  /* Stale batch files are worse than missing ones: an agent told to read batch-003.json would read the
   * PREVIOUS plan's requirements for feats that are not even in this batch. The directory is rebuilt. */
  rmSync(abs(PLAN_DIR), { recursive: true, force: true });
  mkdirSync(abs(PLAN_DIR), { recursive: true });
  let files = 0;
  for (const b of plan.batches) {
    if (!b.carriedFor?.length) continue;
    writeFileSync(abs(`${PLAN_DIR}batch-${String(b.i).padStart(3, '0')}.json`), JSON.stringify({
      batch: b.i,
      note: 'Requirements extracted in an earlier run from text that has not changed since. Same shape as the requirements inlined in the prompt.',
      requirements: b.carriedFor.map((featId) => ({ featId, requirements: plan.feats[featId].cachedRequirements })),
    }, null, 1));
    files++;
  }

  writeFileSync(abs(PLAN), JSON.stringify({ generated: new Date().toISOString(), evidence: paths.evidence, ...plan }, null, 1));
  const blob = planArgs(plan, PLAN_DIR);
  writeFileSync(abs(ARGS), JSON.stringify(blob, null, 1));

  const t = plan.totals;
  console.log(`feats in the sample        ${t.feats}`);
  console.log('');
  console.log('WHAT THIS RUN WOULD COST');
  console.log(`  requirements  reused ${String(t.reqReused).padStart(4)} (${pct(t.reqReused, t.feats)})   recompute ${String(t.reqRecompute).padStart(4)}`);
  reportReasons('requirements', t.reasons.req);
  console.log(`  verdicts      reused ${String(t.verifyReused).padStart(4)} (${pct(t.verifyReused, t.feats)})   recompute ${String(t.verifyRecompute).padStart(4)}`);
  reportReasons('verdicts', t.reasons.verify);
  console.log(`  agent calls   ${plan.batches.filter((b) => b.req.length).length} requirement + ${plan.batches.filter((b) => b.verify.length).length} verify, in ${t.batchesWithWork} of ${t.batchesTotal} batches`);
  if (t.reasons.req['briefing-changed'] || t.reasons.verify['briefing-changed']) {
    console.log('');
    console.log('  ⚠ THE BRIEFING CHANGED — the prompts, or a document they send the reader to read:');
    for (const [p, h] of Object.entries(briefing.docs)) console.log(`      ${p}  ${h}`);
    console.log('    Every affected answer is recomputed. If the change cannot alter an answer (a typo, a');
    console.log('    comment), re-plan with --briefing-ok, which is a decision, not a default.');
  }
  console.log('');
  console.log(`wrote ${PLAN}`);
  console.log(`wrote ${ARGS}   <- pass this as the workflow's args`);
  console.log(`wrote ${files} batch file(s) of carried requirements under ${PLAN_DIR}`);
  console.log('');
  if (!t.reqRecompute && !t.verifyRecompute) {
    console.log('Nothing to ask. Every feat is answered in the cache at its current evidence.');
    return plan;
  }
  console.log('  Workflow({ scriptPath: "scripts/audit/audit-500.js", args: <the contents of the args file> })');
  console.log('  then:  node scripts/audit-cache.mjs apply <the workflow output file>');
  return plan;
}

function cmdApply() {
  const file = process.argv[3];
  if (!file || file.startsWith('--')) {
    console.error('usage: node scripts/audit-cache.mjs apply <workflow-output.json> [--out <file>]');
    process.exit(1);
  }
  const { paths, briefing, evidence, cache } = load();
  if (!existsSync(abs(PLAN))) {
    console.error(`⛔ no ${PLAN}. A run's answers can only be folded in against the plan they were computed from.`);
    process.exit(1);
  }
  const plan = readJson(PLAN);
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const out = raw.result ?? raw;

  /* Fold under the briefing the READERS saw, which is the plan's, not today's. If a document changed
   * while the run was in flight, stamping these answers with today's hash would mark them valid under
   * rules nobody applied. Saying so is the whole job. */
  if (plan.briefing?.verify !== briefing.verify || plan.briefing?.extract !== briefing.extract) {
    console.log('⚠ the briefing changed while this run was in flight. Its answers are stored under the briefing');
    console.log('  they were produced under, so the next plan will offer to recompute them.');
  }

  let verdicts = out.verdicts;
  if (!verdicts) {
    // An output from before the workflow returned every verdict. The defects and the uncertain pile can
    // still be cached; the `correct` verdicts were never written down and cannot be recovered.
    verdicts = [...(out.defects ?? []), ...(out.uncertain ?? [])];
    console.log(`⚠ this output has no \`verdicts\` array — only ${verdicts.length} defect/uncertain verdicts can be cached.`);
    console.log('  Every "correct" verdict it counted was discarded by the run and will have to be recomputed.');
  }

  const { cache: next, rejected } = foldResults({
    cache, plan, packs: evidence.packs ?? [], briefing: plan.briefing ?? briefing,
    fresh: { requirements: out.requirements ?? [], verdicts },
  });
  writeFileSync(abs(CACHE), JSON.stringify(next, null, 1));

  const result = assembleResult({ cache: next, packs: evidence.packs ?? [], briefing, briefingOk: has('briefing-ok') });
  const outPath = argOf('out', RESULT);
  writeFileSync(abs(outPath), JSON.stringify({
    generated: new Date().toISOString(),
    evidence: paths.evidence,
    assembledFrom: { cache: CACHE, run: file },
    // Where each verdict came from, so a reader can tell a fresh judgement from a reused one.
    reuse: { verdictsThisRun: verdicts.length, requirementsThisRun: (out.requirements ?? []).length, verdictsTotal: result.judged },
    ...result,
  }, null, 1));

  console.log(`folded in                 ${verdicts.length} verdicts, ${(out.requirements ?? []).length} requirement sets`);
  if (rejected.length) {
    console.log(`⛔ REJECTED ${rejected.length} — their evidence moved after the plan was made, so the reader judged a pack that no longer exists:`);
    for (const r of rejected.slice(0, 10)) console.log(`     ${r.featId}  ${r.why}`);
    console.log('   Re-plan and re-run those feats.');
  }
  console.log(`cache now holds           ${Object.keys(next.entries).length} feats`);
  console.log('');
  console.log(`ASSEMBLED — all ${result.requested} feats, from the cache rather than from this run alone`);
  console.log(`  judged                  ${result.judged}`);
  console.log(`  counts                  ${JSON.stringify(result.counts)}`);
  console.log(`  defects by half         ${JSON.stringify(result.defectsByHalf)}`);
  if (result.missingVerdicts.length) console.log(`  ⚠ NO VERDICT AT ALL     ${result.missingVerdicts.length}  (${result.missingVerdicts.slice(0, 8).join(', ')}${result.missingVerdicts.length > 8 ? ' …' : ''})`);
  if (result.staleVerdicts.length) console.log(`  ⚠ STALE                 ${result.staleVerdicts.length}  verdicts whose evidence has moved since they were judged`);
  console.log(`wrote ${outPath}`);
  return result;
}

function cmdStatus() {
  const { briefing, evidence, cache } = load();
  const packs = evidence.packs ?? [];
  const plan = planRun({ packs, cache, briefing });
  const t = plan.totals;
  console.log(`cache                     ${CACHE}  (${Object.keys(cache.entries ?? {}).length} feats, generated ${cache.generated ?? 'never'})`);
  console.log(`requirements usable       ${t.reqReused}/${t.feats}`);
  console.log(`verdicts usable           ${t.verifyReused}/${t.feats}`);
  const result = assembleResult({ cache, packs, briefing });
  console.log(`verdicts stored           ${result.judged}  (stale ${result.staleVerdicts.length}, absent ${result.missingVerdicts.length})`);
  return plan;
}

const CMDS = { plan: cmdPlan, apply: cmdApply, status: cmdStatus };
const isCli = /audit-cache\.mjs$/.test(String(process.argv[1] ?? '').replace(/\\/g, '/'));
if (isCli) {
  const cmd = CMDS[process.argv[2] ?? 'plan'];
  if (!cmd) {
    console.error(`unknown command "${process.argv[2]}". One of: ${Object.keys(CMDS).join(', ')}`);
    process.exit(1);
  }
  cmd();
}
