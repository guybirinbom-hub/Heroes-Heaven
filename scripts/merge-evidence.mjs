/*
 * ONE EVIDENCE PACK PER FEAT — the SHEET half and the BUILDER half, merged.
 *
 * The owner's mandate has two halves: a record is right if it is *choosing the things that are supposed
 * to be chosen* **or** influencing the sheet correctly. `scripts/feat-evidence.mjs` observes the second;
 * `scripts/builder-evidence.mjs` observes the first. The 500-feat audit has only ever been handed the
 * first file, so a feat whose picker offers the wrong options — or asks a question nothing reads — has
 * been reading as "correct" to the auditor, because the only evidence in front of it was a sheet diff.
 *
 * THIS SCRIPT ADDS NO MEASUREMENT OF ITS OWN. The two producers stay separate: each is independently
 * useful, independently testable, and one can be regenerated without the other. This joins their output
 * and computes the handful of facts that need BOTH halves to be true or false — which is the only thing
 * neither producer can do alone:
 *
 *   - an empty sheet diff on a feat that ASKS something is not the same finding as an empty diff on a
 *     feat that asks nothing. The first is a gated effect; the second is an inert record.
 *   - an answer nothing reads on a feat whose sheet MOVES is a decorative picker (judge under Q20 /
 *     Ruling K); the same finding on a feat whose sheet is silent means nothing anywhere reads the feat.
 *   - the audit prompt's "a pick-a-feat grant shows an empty diff until the pick is made" stops being a
 *     caveat the reader has to remember and becomes a fact in the pack, with the picker and its option
 *     count sitting next to the empty diff that it explains.
 *
 * ⚠ IT REFUSES TO MERGE TWO HALVES THAT DO NOT DESCRIBE THE SAME APP. Both inputs are derived files. A
 * merge across a fresh half and a stale one would be a measuring instrument that lies — the failure mode
 * this project has paid for four times — so mtimes are checked against the content and the code the
 * packs were observed from, and a short half is a hard failure rather than a total that happens to look
 * plausible (the exact shape of Haiku's silent shortfall in the bake-off).
 *
 *   node scripts/merge-evidence.mjs                 # -> scripts/audit/audit-500-evidence.json
 *   node scripts/merge-evidence.mjs --allow-stale   # merge anyway, and record that it is stale
 *   node scripts/merge-evidence.mjs --allow-partial # merge anyway when a half is short
 */
import { readFileSync, writeFileSync, statSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { textHashOf, evidenceHashOf } from './lib/audit-cache.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const abs = (p) => join(root, p);
const readJson = (p) => JSON.parse(readFileSync(abs(p), 'utf8'));
const has = (n) => process.argv.includes(`--${n}`);

/* All four are parameters. The frozen 500 is one work list; a level-ordered batch (batch-NNN.json,
 * cut by scripts/feat-audit-order.mjs) is another, and both must be mergeable without editing this
 * file. Defaults are the 500 so existing invocations are unchanged.
 *   node scripts/merge-evidence.mjs --sheet scripts/audit/batch-001-sheet-evidence.json \
 *     --builder scripts/audit/batch-001-builder-evidence.json \
 *     --sample scripts/audit/batch-001.json --out scripts/audit/batch-001-evidence.json */
const argOf = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const SHEET_IN = argOf('sheet', 'scripts/audit/feat-500-evidence.json');
const BUILDER_IN = argOf('builder', 'scripts/audit/builder-500-evidence.json');
const SAMPLE = argOf('sample', 'scripts/audit/feat-500.json');
const OUT = argOf('out', 'scripts/audit/audit-500-evidence.json');

/* ── Staleness ─────────────────────────────────────────────────────────────────────────────────
 * What an evidence pack is a photograph OF: the content it built characters from, the engine that
 * derived them, the sample it drew, and the producer that took the picture. If any of those is newer
 * than the pack, the pack describes an app that no longer exists.
 *
 * `scripts/data/effect-backfill.json` is deliberately NOT here. It only reaches a built character
 * through `npm run data`, which rewrites core.json — so core.json's own mtime already covers it, and
 * listing it would report a pack as stale for an edit that has not been imported yet. */
const SOURCES = [
  'public/core.json',
  'public/core-descriptions.json',
  'src/rules',
  SAMPLE,
];

function newestMtime(rel) {
  const p = abs(rel);
  if (!existsSync(p)) return 0;
  const st = statSync(p);
  if (!st.isDirectory()) return st.mtimeMs;
  let newest = st.mtimeMs;
  for (const e of readdirSync(p, { withFileTypes: true })) {
    newest = Math.max(newest, newestMtime(join(rel, e.name).replace(/\\/g, '/')));
  }
  return newest;
}

/** Each half is stale if its own producer, or anything it observed, has changed since it ran. */
export function stalenessReport(now = Date.now()) {
  const sourceAge = Math.max(...SOURCES.map(newestMtime));
  const halves = [
    { half: 'sheet', file: SHEET_IN, producer: 'scripts/feat-evidence.mjs', regen: 'npx jiti scripts/feat-evidence.mjs' },
    { half: 'builder', file: BUILDER_IN, producer: 'scripts/builder-evidence.mjs', regen: 'npx jiti scripts/builder-evidence.mjs' },
  ];
  return halves.map((h) => {
    const at = newestMtime(h.file);
    const against = Math.max(sourceAge, newestMtime(h.producer));
    return {
      ...h,
      exists: at > 0,
      generatedAt: at ? new Date(at).toISOString() : null,
      newestInput: new Date(against).toISOString(),
      stale: at > 0 && at < against,
      ageHours: at ? Math.round(((now - at) / 3_600_000) * 10) / 10 : null,
    };
  });
}

/* ── The cross-half facts ──────────────────────────────────────────────────────────────────────
 * Facts, not verdicts. Every finding in this project is a candidate until verified, and a merge that
 * started deciding would be the third instrument in the chain to have an opinion. */

/** The lanes whose answer is a FEAT the player picks later — the sheet half cannot see the grant yet. */
const PICK_LANES = new Set(['pickFeat', 'grantedFeatChoice']);
/** Conservative: only phrases that name another sheet. `familiar` and `minion` included — both are
 *  Companions-tab records, and the sheet harness builds neither. */
const COMPANION_TEXT = /\beidolons?\b|\banimal companion\b|\bconstruct companion\b|\byour companion\b|\bminions?\b|\bfamiliars?\b/i;

export function harnessLimitsFor(sheet, builder) {
  const out = [];
  const registries = sheet?.registries ?? [];
  const pickers = builder?.presentsChoices ?? [];
  const pickPickers = pickers.filter((p) => PICK_LANES.has(p.lane));

  if (registries.includes('featPickGrants') || pickPickers.length) {
    const opts = pickPickers.reduce((t, p) => t + (p.optionCount ?? 0), 0);
    out.push({
      limit: 'pick-a-feat-grant',
      affects: 'sheetDiff',
      why:
        `what this feat grants is a feat the player picks. The sheet half builds the character with NO pick made, so its ` +
        `diff is empty by construction — that is the harness, never the feat.` +
        (pickPickers.length ? ` The builder half proves the picker exists: ${pickPickers.length} picker(s), ${opts} option(s).` : ''),
    });
  }
  if (registries.includes('companionGrants')) {
    out.push({
      limit: 'companion-tab',
      affects: 'sheetDiff, answerIsRead',
      why: 'registry companionGrants: the effect lands on a companion. Neither harness builds one, so both halves report silence.',
    });
  } else {
    const m = COMPANION_TEXT.exec(String(sheet?.text ?? builder?.text ?? ''));
    if (m) {
      out.push({
        limit: 'companion-tab?',
        affects: 'sheetDiff, answerIsRead',
        why: `the text names "${m[0]}". CANDIDATE only — confirm from the text that the effect really lands on the companion's sheet rather than on yours.`,
      });
    }
  }
  if (builder?.checks?.zeroOptionsHostDependent?.length) {
    out.push({
      limit: 'host-owns-nothing',
      affects: 'presentsChoices',
      why: `${builder.checks.zeroOptionsHostDependent.join(', ')} resolves its options from what the CHARACTER owns (a weapon, a spell, a companion). The reference host owns none, so the empty list is the host, not the app.`,
    });
  }
  if ((builder?.answerIsRead ?? []).some((a) => a.verdict === 'daily')) {
    out.push({
      limit: 'daily-choice',
      affects: 'answerIsRead',
      why: 'per Q23 a daily choice is answered in Daily preparations, not in the builder. Neither harness enters play state, so it cannot move a value here.',
    });
  }
  /* `sheetDiff: null` and `sheetDiff: []` look alike at a glance and mean opposite things — "never
   * measured" against "measured, and nothing moved". The sheet producer reports 500/500 placed today,
   * so this fires on nothing; it exists because on the day it does fire, silence is the wrong answer. */
  if (sheet && sheet.placed === false) {
    out.push({
      limit: 'sheet-unplaceable',
      affects: 'sheetDiff',
      why: 'no slot accepted this feat in the sheet harness, so there is no diff at all — sheetDiff is null, not empty. Judge the sheet half from the record fields and the text.',
    });
  }
  if (builder && builder.placed && !builder.slotRendered) {
    out.push({
      limit: 'forced-placement',
      affects: 'presentsChoices, eligibleHosts',
      why: 'no slot the builder renders for this host offered the feat, so it was forced into one to be measurable. The pickers below are real; the fact that this host is offered the feat is NOT evidenced.',
    });
  }
  return out;
}

export function crossChecksFor(sheet, builder) {
  const sheetSilent = !!sheet?.placed && (sheet.sheetDiff?.length ?? 0) === 0;
  const answers = builder?.answerIsRead ?? [];
  const asks = (builder?.choiceCount ?? 0) > 0;
  /* `slot-budget` is a read: the language lane's answer is a language, and writing one into the build
   * moves character.languages by construction — so the producer measures the BUDGET it grants instead,
   * and a positive budget is the answer being consumed. */
  const anyRead = answers.some((a) => a.verdict === 'read' || a.verdict === 'slot-budget');
  const dead = answers.filter((a) => a.verdict === 'not-read' || a.verdict === 'echo-only');

  return {
    sheetSilent,
    asksNothing: !!builder && !asks,
    /* Neither half saw anything. The strongest defect candidate in the merged pack — and still a
     * candidate: read harnessLimits first, because a companion or ally-facing feat lands here too. */
    silentOnBothHalves: sheetSilent && !!builder && !asks,
    /* An empty sheet diff on a feat that DOES ask something. Do not read the diff as "changes nothing":
     * the effect may be waiting on the answer. */
    sheetSilentButBuilderAsks: sheetSilent && asks,
    /* It asks, and no answer to it moves anything either. Both halves failing on the same feat. */
    sheetSilentAndNoAnswerRead: sheetSilent && asks && !anyRead,
    /* The feat works; the ANSWER is decorative. Q20/Ruling K may make this correct — but only when the
     * choice names no stat the player looks a number up on (Assurance's skill still needs its `*`). */
    answerDeadButSheetMoves: !sheetSilent && !!sheet?.placed && dead.length > 0,
    answersNothingReads: dead.map((a) => ({ key: a.key, verdict: a.verdict, prompt: a.prompt })),
    /* Builder-half findings the sheet half is structurally blind to. */
    declaredWithoutPicker: builder?.checks?.declaredWithoutPicker ?? [],
    pickerWithZeroOptions: builder?.checks?.pickerWithZeroOptions ?? [],
    offeredToNoReferenceHost: builder ? (builder.eligibleHosts?.length ?? 0) === 0 : null,
    nativeHostEligible: builder?.nativeHostEligible ?? null,
  };
}

/* ── The merged pack ───────────────────────────────────────────────────────────────────────── */

/**
 * One feat, both halves. Either may be absent — a half that did not produce a pack for this feat is
 * reported as absent rather than silently standing in for the other, because "the builder asks nothing"
 * and "the builder half never ran on this feat" are opposite findings that look identical once merged.
 */
export function mergePack(featId, sheet, builder) {
  const src = sheet ?? builder ?? null;
  if (!src) return { featId, halves: { sheet: false, builder: false }, missing: true };

  return {
    featId,
    name: src.name ?? null,
    level: src.level ?? null,
    category: src.category ?? null,
    traits: src.traits ?? [],
    actionCost: sheet?.actionCost ?? null,
    // The builder half truncates text at 900 chars for size; the sheet half keeps it whole. Prefer the
    // whole one — the audit's requirement extraction is downstream of this string.
    text: sheet?.text ?? builder?.text ?? '',
    halves: { sheet: !!sheet, builder: !!builder },

    // ── THE SHEET HALF (scripts/feat-evidence.mjs), field names unchanged ─────────────────────
    placed: sheet?.placed ?? null,
    host: sheet?.host ?? null,
    storedFields: sheet?.storedFields ?? null,
    registries: sheet?.registries ?? [],
    textNumbers: sheet?.textNumbers ?? [],
    sheetDiff: sheet?.sheetDiff ?? null,
    sheetDiffTruncated: sheet?.sheetDiffTruncated ?? 0,

    // ── THE BUILDER HALF (scripts/builder-evidence.mjs) ───────────────────────────────────────
    builder: builder
      ? {
          host: builder.host ?? null,
          slotRendered: builder.slotRendered ?? null,
          eligibleHosts: builder.eligibleHosts ?? [],
          nativeHostEligible: builder.nativeHostEligible ?? null,
          declared: builder.declared ?? [],
          choiceCount: builder.choiceCount ?? 0,
          presentsChoices: builder.presentsChoices ?? [],
          answerIsRead: builder.answerIsRead ?? [],
          unansweredState: builder.unansweredState ?? null,
          checks: builder.checks ?? null,
        }
      : null,

    crossChecks: crossChecksFor(sheet, builder),
    harnessLimits: harnessLimitsFor(sheet, builder),
  };
}

export function mergeAll(featIds, sheetPacks, builderPacks) {
  const sheetBy = new Map(sheetPacks.map((p) => [p.featId, p]));
  const builderBy = new Map(builderPacks.map((p) => [p.featId, p]));
  // Ordered by the frozen sample, because the audit slices its batches BY INDEX into that array — a
  // merged file in any other order makes "the feats at indices 40–44" mean two different things.
  const ids = featIds.length ? featIds : [...new Set([...sheetBy.keys(), ...builderBy.keys()])];
  const packs = ids.map((id) => mergePack(id, sheetBy.get(id), builderBy.get(id)));

  const count = (f) => packs.filter(f).length;
  const cc = (k) => packs.filter((p) => p.crossChecks?.[k] === true).length;
  const limitCount = {};
  for (const p of packs) for (const l of p.harnessLimits ?? []) limitCount[l.limit] = (limitCount[l.limit] ?? 0) + 1;

  /* ── What the audit's cache keys on ──────────────────────────────────────────────────────────
   * Two hashes per feat, taken over exactly what each of the audit's two readers is given:
   *   textHash      the `text` field, the only thing phase 1 may read;
   *   evidenceHash  the whole pack as written, because phase 2 reads the feat's full entry.
   * They live in the file HEADER rather than inside each pack, so the hash covers the pack exactly as
   * the reader sees it and there is nothing to exclude — and so the reader's context is not padded
   * with 500 hex strings it has no use for. `scripts/audit-cache.mjs` turns them into a run plan.
   *
   * ⚠ The planner RECOMPUTES these from the packs rather than trusting this header, and that is on
   * purpose: the header can only be as fresh as the last merge, and anything that edits the file
   * afterwards (a hand fix, a partial rewrite) leaves an index describing packs that are no longer
   * there. The header's job is the delta report below, which is a convenience; the plan's job is
   * correctness. */
  const cacheIndex = Object.fromEntries(packs.map((p) => [p.featId, { textHash: textHashOf(p), evidenceHash: evidenceHashOf(p) }]));

  return {
    packs,
    cacheIndex,
    totals: {
      feats: packs.length,
      bothHalves: count((p) => p.halves.sheet && p.halves.builder),
      sheetOnly: count((p) => p.halves.sheet && !p.halves.builder),
      builderOnly: count((p) => !p.halves.sheet && p.halves.builder),
      neither: count((p) => !p.halves.sheet && !p.halves.builder),
      sheetDiffEmpty: cc('sheetSilent'),
      featsPresentingAChoice: count((p) => (p.builder?.choiceCount ?? 0) > 0),
      pickers: packs.reduce((t, p) => t + (p.builder?.choiceCount ?? 0), 0),
      crossChecks: {
        silentOnBothHalves: cc('silentOnBothHalves'),
        sheetSilentButBuilderAsks: cc('sheetSilentButBuilderAsks'),
        sheetSilentAndNoAnswerRead: cc('sheetSilentAndNoAnswerRead'),
        answerDeadButSheetMoves: cc('answerDeadButSheetMoves'),
        declaredWithoutPicker: packs.reduce((t, p) => t + (p.crossChecks?.declaredWithoutPicker?.length ?? 0), 0),
        pickerWithZeroOptions: packs.reduce((t, p) => t + (p.crossChecks?.pickerWithZeroOptions?.length ?? 0), 0),
        forcedPlacement: count((p) => p.builder && p.builder.slotRendered === false),
      },
      harnessLimits: limitCount,
    },
  };
}

/* ── Run ───────────────────────────────────────────────────────────────────────────────────── */
export function main() {
  const staleness = stalenessReport();
  const missingHalf = staleness.filter((s) => !s.exists);
  if (missingHalf.length) {
    for (const s of missingHalf) console.error(`⛔ ${s.file} does not exist. Run:  ${s.regen}`);
    process.exitCode = 1;
    return null;
  }
  const stale = staleness.filter((s) => s.stale);
  if (stale.length && !has('allow-stale')) {
    for (const s of stale) {
      console.error(`⛔ STALE: ${s.file} was written ${s.generatedAt} but its inputs changed at ${s.newestInput}.`);
      console.error(`         It describes an app that no longer exists. Run:  ${s.regen}`);
    }
    console.error('         (--allow-stale merges anyway and records the staleness in the output header.)');
    process.exitCode = 1;
    return null;
  }

  const sample = readJson(SAMPLE);
  const sheetPacks = readJson(SHEET_IN);
  const builderFile = readJson(BUILDER_IN);
  const builderPacks = builderFile.packs ?? [];

  const { packs, totals, cacheIndex } = mergeAll(sample.featIds ?? [], sheetPacks, builderPacks);

  /* How many feats a re-run of the audit would actually have to re-judge. Measured against the merged
   * file this one replaces, so it is available BEFORE the run is launched — which is the moment the
   * decision to spend the tokens is made. */
  const previous = existsSync(abs(OUT)) ? readJson(OUT).cacheIndex ?? null : null;
  const evidenceMoved = previous
    ? Object.entries(cacheIndex).filter(([id, h]) => previous[id]?.evidenceHash !== h.evidenceHash).map(([id]) => id)
    : null;
  const textMoved = previous
    ? Object.entries(cacheIndex).filter(([id, h]) => previous[id]?.textHash !== h.textHash).map(([id]) => id)
    : null;

  // Completion accounting across BOTH halves. A shortfall must be visible, never inferred from a total
  // that happens to look plausible — the sheet producer skips a feat whose id is not in content, and it
  // does so silently.
  const short = packs.filter((p) => !p.halves.sheet || !p.halves.builder);
  if (short.length && !has('allow-partial')) {
    console.error(`⛔ ${short.length} of ${packs.length} feats are missing a half:`);
    for (const p of short.slice(0, 20)) console.error(`   ${p.featId}  sheet=${p.halves.sheet} builder=${p.halves.builder}`);
    if (short.length > 20) console.error(`   … and ${short.length - 20} more`);
    console.error('   (--allow-partial merges anyway; each pack records which half it has.)');
    process.exitCode = 1;
    return null;
  }

  const out = {
    generated: new Date().toISOString(),
    sample: SAMPLE,
    inputs: staleness.map(({ half, file, generatedAt, stale: st }) => ({ half, file, generatedAt, stale: st })),
    stale: stale.length > 0,
    partial: short.length > 0,
    totals,
    cacheIndex,
    packs,
  };
  writeFileSync(abs(OUT), JSON.stringify(out, null, 1));

  console.log(`feats merged             ${totals.feats}   (both halves ${totals.bothHalves}, sheet only ${totals.sheetOnly}, builder only ${totals.builderOnly})`);
  console.log(`  empty sheet diff       ${totals.sheetDiffEmpty}`);
  console.log(`  present >=1 choice     ${totals.featsPresentingAChoice}  (${totals.pickers} pickers)`);
  console.log('');
  console.log('CROSS-HALF — facts neither producer can state alone');
  console.log(`  silent on BOTH halves          ${totals.crossChecks.silentOnBothHalves}   <- changes nothing AND asks nothing`);
  console.log(`  sheet silent, builder asks     ${totals.crossChecks.sheetSilentButBuilderAsks}   <- do not read the empty diff as "does nothing"`);
  console.log(`   …and no answer is read        ${totals.crossChecks.sheetSilentAndNoAnswerRead}`);
  console.log(`  answer dead, sheet moves       ${totals.crossChecks.answerDeadButSheetMoves}   <- decorative picker; Q20/Ruling K may make it correct`);
  console.log(`  declared choice, no picker     ${totals.crossChecks.declaredWithoutPicker}`);
  console.log(`  picker with zero options       ${totals.crossChecks.pickerWithZeroOptions}`);
  console.log(`  forced placement               ${totals.crossChecks.forcedPlacement}   <- the builder offers this feat to no slot of its own host`);
  console.log(`  harness limits flagged         ${JSON.stringify(totals.harnessLimits)}`);
  console.log('');
  console.log('WHAT A RE-RUN WOULD COST');
  if (!evidenceMoved) {
    // Never "0 changed" when there is nothing to compare with: that reads as "nothing to re-judge",
    // which is the one wrong answer that costs correctness rather than money.
    console.log('  no previous merged pack to compare against — every feat would be judged fresh');
  } else {
    console.log(`  evidence moved for             ${evidenceMoved.length} of ${totals.feats} feats  <- only these need re-verifying`);
    console.log(`  text moved for                 ${textMoved.length} of ${totals.feats} feats  <- only these need their requirements re-derived`);
    if (evidenceMoved.length && evidenceMoved.length <= 12) console.log(`    ${evidenceMoved.join(', ')}`);
  }
  console.log('  plan the run with:             node scripts/audit-cache.mjs plan');
  console.log(`wrote ${OUT}`);
  return out;
}

const isCli = /merge-evidence\.mjs$/.test(String(process.argv[1] ?? '').replace(/\\/g, '/'));
if (isCli) main();
