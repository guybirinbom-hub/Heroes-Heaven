/**
 * GATE 9 — THE PLAYER EXPERIENCE. Does OUR builder ask what Wanderer's Guide asks, and does OUR sheet
 * move where theirs encodes a value?
 *
 * The four parity comparers check DATA against DATA. The kind gate maps their `select` to our `choice`
 * kind and is satisfied the moment one of twelve fields EXISTS on the record — rendered or not. That is
 * how batch 24 closed with cleric records at parity while the owner's own cleric had no cantrip
 * preparation, an auto-picked Domain Initiate spell and a doctrine grant that looked missing.
 *
 * This script:
 *   1. runs the harness — test/wg-experience.harness.test.tsx renders the REAL Builder in jsdom for a
 *      host that owns each record and one that does not, lists the controls the record ADDS
 *      (`[data-ctl]` markers on PopupSelect/SearchSelect/text/slot/spell), and diffs the derived sheet;
 *   2. reads their ops for each record out of the live dump (work/wg/wg-data.sql), including the
 *      selects and effects hidden inside a predefined option's singular `operation` key, which the
 *      kind mapping never descends;
 *   3. classifies both sides into lanes (scripts/lib/wg-experience-lanes.mjs) and writes a verdict per
 *      record to work/wg-batch-0NN-experience.json, which the batch gate reads.
 *
 *   node scripts/wg-experience.mjs --batch work/wg-batch-024.json
 *   node scripts/wg-experience.mjs --batch work/wg-batch-024.json --skip-harness   # re-judge only
 *   node scripts/wg-experience.mjs --batch work/wg-batch-024.json --verbose        # print OK rows too
 *
 * Exit 0 once the artefact is written, whatever the verdicts say — deciding pass/fail is the gate's job.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCopyBlock, parseOps, untsv, wgRowsByBucket } from './lib/wg-parse.mjs';
import { LANE_ACCEPTS, OPTION_TYPE_LANES, controlCapacity, effectOf, flattenAll, gateStatus, judgeDelivery, laneOfControl, lanesOfControl, laneOfSelect, verdictFor } from './lib/wg-experience-lanes.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const VERBOSE = process.argv.includes('--verbose');
const HOST_LEVEL = 20; // the harness builds every host at level 20 so LEVEL-gated ops are reachable

const batchPath = arg('--batch', null);
if (!batchPath) { console.error('usage: node scripts/wg-experience.mjs --batch work/wg-batch-0NN.json [--skip-harness] [--verbose]'); process.exit(2); }
const n = (batchPath.match(/wg-batch-(\d+)\.json$/) ?? [])[1];
if (!n || !existsSync(join(ROOT, batchPath))) { console.error(`batch file must be an existing work/wg-batch-0NN.json (got ${batchPath})`); process.exit(2); }
const DUMP = join(ROOT, 'work/wg/wg-data.sql');
if (!existsSync(DUMP)) { console.error("No Wanderer's Guide dump at work/wg/wg-data.sql (gitignored on purpose: GPL-3.0; differ only)."); process.exit(2); }

const RAW = `work/.experience-raw-${n}.json`;
const OUT = batchPath.replace(/\.json$/, '-experience.json');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8').replace(/^﻿/, ''));
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/* ---- 1. play the batch on the real builder ------------------------------------------------------- */
if (!process.argv.includes('--skip-harness')) {
  console.log(`experience: playing ${batchPath} on the real builder (jsdom) …`);
  const r = spawnSync('npx', ['vitest', 'run', 'test/wg-experience.harness.test.tsx', '--reporter=dot'], {
    cwd: ROOT, stdio: 'inherit', shell: true,
    env: { ...process.env, WG_EXPERIENCE_BATCH: batchPath, WG_EXPERIENCE_OUT: RAW },
  });
  if (r.status !== 0) { console.error(`experience: the harness failed (exit ${r.status}); no verdicts written`); process.exit(1); }
}
if (!existsSync(join(ROOT, RAW))) { console.error(`experience: no harness output at ${RAW}`); process.exit(1); }

/* ---- 2. their side ------------------------------------------------------------------------------- */
const raw = read(RAW);
const ours = new Map((raw.records ?? []).map((r) => [r.id, r]));
const batch = Object.values(read(batchPath));
const core = read('public/core.json');
const sql = readFileSync(DUMP, 'utf8');
const liveRows = wgRowsByBucket(sql);
// Their ids -> names, so a `giveAbilityBlock` / `giveSpell` can be checked against what our built
// character owns (the chassis fallback; see judgeDelivery).
const blockRows = parseCopyBlock(sql, 'ability_block').rows;
const nameIndex = (table, rows = null) => new Map((rows ?? parseCopyBlock(sql, table).rows).map((r) => [String(r.id), untsv(r.name ?? '')]));
const names = { block: nameIndex('ability_block', blockRows), spell: nameIndex('spell'), trait: nameIndex('trait') };
// Ability blocks that ARE a question (their ops are a select) — "Domains", "Select a Bloodline" carriers.
const blockIsSelect = new Set(blockRows.filter((r) => parseOps(r.operations).some((op) => op.type === 'select')).map((r) => String(r.id)));

/* ---- 3. judge ------------------------------------------------------------------------------------ */
const records = [];
for (const row of batch) {
  const wgRow = liveRows?.[row.bucket]?.get(norm(row.name));
  const ops = wgRow ? parseOps(wgRow.operations) : [];
  const flatOps = ops.flatMap((o) => flattenAll(o));
  /*
   * Three select shapes are not a question the player answers:
   *   · ONE predefined option whose effect sits in the option — a labelled grant, not a choice (Sky Rider);
   *   · a CONTAINER whose options hold nothing but further selects — the nested ones are judged instead;
   *   · a Q23 DAILY choice on our side (`choice.daily`, an askable kind) — asked at Daily preparations on
   *     the sheet, deliberately NOT in the builder (owner ruling Q23), so a builder-only observer cannot
   *     see it. Reported, never failed.
   */
  const ourRec = core[row.bucket]?.[row.id] ?? {};
  const askedDaily = !!ourRec.choice?.daily && ['array', 'text', 'open'].includes(ourRec.choice?.kind);
  const isContainer = (op) => { const os = op.data?.optionsPredefined ?? []; return os.length > 0 && os.every((o) => { const inner = [...(o.operations ?? []), ...(o.operation ? [o.operation] : [])]; return inner.length > 0 && inner.every((c) => c.type === 'select'); }); };
  const isLabelledGrant = (op) => { const os = op.data?.optionsPredefined ?? []; return op.data?.modeType === 'PREDEFINED' && os.length === 1 && (((os[0].operations ?? []).length > 0) || !!os[0].operation); };
  const selects = flatOps
    .filter((x) => x.op?.type === 'select' && !isContainer(x.op) && !isLabelledGrant(x.op))
    .map((x) => ({ ...laneOfSelect(x.op), gate: askedDaily ? 'daily' : gateStatus(x.ctx.gates, HOST_LEVEL), inOption: !!x.ctx.inOption, under: x.ctx.selectTitle ?? null }));
  // A granted ability block whose own content is a SELECT is a control handed to the player, not a
  // record to own — it is judged as a select (our matching control), not as an undelivered grant.
  // `createValue SKILL_LORE_X = U` on a record whose own prerequisite is "trained in X Lore" is plumbing:
  // it mints the variable their bonuses attach to, on a character who by the prerequisite already has it.
  const prereqText = ((core[row.bucket]?.[row.id]?.prerequisites ?? []).map(String).join(' | ')).toLowerCase();
  const loreOfVar = (v) => String(v ?? '').replace(/^SKILL_LORE_/, '').toLowerCase().replace(/_/g, ' ');
  const effects = flatOps
    .map((x) => { const e = effectOf(x.op); return e ? { ...e, gate: gateStatus(x.ctx.gates, HOST_LEVEL), inOption: !!x.ctx.inOption } : null; })
    .filter(Boolean)
    .filter((e) => !(e.type === 'giveAbilityBlock' && blockIsSelect.has(String(e.data?.abilityBlockId))))
    .filter((e) => !(e.type === 'createValue' && /^SKILL_LORE_/.test(String(e.variable)) && prereqText.includes(`${loreOfVar(e.variable)} lore`)));
  const ev = ours.get(row.id);
  // An `aon-` scrape that duplicates a canonical record of the same name is HIDDEN from every picker
  // (content.duplicateIds); the player meets the canonical one, which is compared in its own batch —
  // the same deferral the COVERAGE gate makes. Judging the hidden copy would blame it for not rendering.
  const canonical = row.id.startsWith('aon-')
    ? Object.entries(core[row.bucket] ?? {}).find(([oid, r]) => oid !== row.id && !oid.startsWith('aon-') && norm(r?.name) === norm(row.name))?.[0]
    : null;
  if (canonical) {
    records.push({ id: row.id, bucket: row.bucket, name: row.name, verdict: 'OK', detail: `hidden aon- duplicate of ${canonical}, which is compared as itself`, deliveredBy: null, wg: { encoded: !!wgRow, selects: [], effects: 0, openValueEffects: 0, openEffects: [], gatedSelects: 0, delivery: null }, ours: { supported: false, duplicateOf: canonical } });
    continue;
  }
  const controls = (ev?.controlsAdded ?? []).map((c) => ({ ...c, lane: laneOfControl(c) }));
  const openEffects = effects.filter((e) => e.valueBearing && e.gate === 'open' && !e.inOption);
  // The chassis fallback: only consulted when the differential moved nothing.
  const delivery = openEffects.length && (ev?.sheetDiffCount ?? 0) === 0 ? judgeDelivery(openEffects, ev?.surface, names) : null;
  const v = verdictFor({
    supported: ev ? ev.supported !== false : false,
    error: ev ? (ev.error ?? null) : 'no harness record for this id',
    selects, controls, effects,
    sheetDiffCount: ev?.sheetDiffCount ?? 0,
    delivery,
  });
  /* CHASSIS attribution. A select the record's own controls did not answer may be answered by a picker
   * the CLASS owns and renders with or without the record — "Select a Tactic" by the commander's tactics
   * folio, "Select a Rune" by the runesmith's runes. Only a picker of an accepting lane whose title shares
   * a word with the question (tactic / rune / implement / skill / feat…) — or that sits on the record's
   * own grant level — and each such picker at most once. Recorded as deliveredBy 'chassis' so a reader
   * can tell an attributed control from one the differential proved. */
  let chassis = null;
  if (v.verdict === 'MISSING-CONTROL' && row.bucket === 'classFeatures' && Array.isArray(ev?.controlsBoth) && ev.controlsBoth.length) {
    const words = (t) => String(t ?? '').toLowerCase().replace(/^select (a|an|the) /, '').split(/[^a-z]+/).filter((w) => w.length >= 4).map((w) => w.replace(/s$/, ''));
    const grantPage = ev?.host?.grantLevel != null ? String(ev.host.grantLevel) : null;
    const used = new Map(); // control index -> selects handed to it (up to its capacity: a tactics folio answers 5× "Select a Tactic")
    const attributed = [];
    for (const s of v.unmatched) {
      const accepts = [...(LANE_ACCEPTS[s.lane] ?? [s.lane]), ...(s.lane === 'option' ? OPTION_TYPE_LANES[s.optionType] ?? [] : [])];
      const sw = words(s.title);
      const j = ev.controlsBoth.findIndex((c, k) => {
        if ((used.get(k) ?? 0) >= controlCapacity(c)) return false;
        const lanes = lanesOfControl(c);
        if (!accepts.some((w) => lanes.includes(w))) return false;
        const cw = String(c.title ?? '').toLowerCase();
        // A MULTI-pick the class renders on its chassis page (0) for a level-1 feature is that feature's
        // picker even when the words differ ("Select a Rune" ↔ "Runic repertoire").
        const chassisMulti = c.ctl === 'multi' && grantPage !== null && (c.page === grantPage || (c.page === '0' && grantPage === '1'));
        return sw.some((w) => cw.includes(w)) || chassisMulti || (grantPage !== null && c.page === grantPage && c.ctl !== 'popup');
      });
      if (j < 0) break;
      used.set(j, (used.get(j) ?? 0) + 1);
      attributed.push({ select: s.title, control: `${ev.controlsBoth[j].title} [${laneOfControl(ev.controlsBoth[j])}] p${ev.controlsBoth[j].page}` });
    }
    if (attributed.length === v.unmatched.length) chassis = attributed;
  }
  if (chassis) {
    v.verdict = v.openEffects && (ev?.sheetDiffCount ?? 0) === 0 && delivery && delivery.undelivered?.length ? 'NO-SHEET-EFFECT' : 'OK';
    v.deliveredBy = 'chassis';
    v.unmatched = [];
  }
  const describe = (e) => `${e.type}${e.variable ? ` ${e.variable}` : ''}${e.data?.abilityBlockId ? ` #${e.data.abilityBlockId} "${names.block.get(String(e.data.abilityBlockId)) ?? '?'}"` : ''}${e.data?.spellId ? ` "${names.spell.get(String(e.data.spellId)) ?? e.data.spellId}"` : ''}${e.data?.traitId ? ` "${names.trait.get(String(e.data.traitId)) ?? e.data.traitId}"` : ''}${e.type === 'addBonusToValue' && e.data?.value != null ? ` ${typeof e.data.value === 'object' ? JSON.stringify(e.data.value) : e.data.value}` : ''}`;
  let detail = ev?.reason ?? null;
  if (v.verdict === 'OK' && askedDaily && selects.length) detail = `asked at Daily preparations on the sheet (ruling Q23), not in the builder — ${selects.length} WG select(s) reported, not judged here`;
  if (v.verdict === 'MISSING-CONTROL') {
    detail = `WG asks ${v.unmatched.map((s) => `"${s.title}" [${s.lane}]`).join(', ')}; we render ${controls.length ? controls.map((c) => `"${c.title}" [${c.lane}]`).join(', ') : 'no control for this record'}`;
  } else if (v.verdict === 'NO-SHEET-EFFECT') {
    const failed = delivery?.undelivered?.length ? delivery.undelivered : openEffects;
    detail = `WG encodes ${openEffects.length} value-bearing op(s); not on our built character: ${[...new Set(failed.map(describe))].slice(0, 6).join('; ')}`;
  } else if (v.verdict === 'UNVERIFIED-EFFECT') {
    detail = `differential moved 0 values and none of WG's ${openEffects.length} op(s) has a surface predicate yet: ${[...new Set(openEffects.map(describe))].slice(0, 6).join('; ')}`;
  } else if (v.verdict === 'OK' && v.deliveredBy === 'surface') {
    detail = `delivered on the class chassis (differential 0): ${[...new Set(delivery.delivered.map(describe))].slice(0, 5).join('; ')}${delivery.unchecked.length ? ` · ${delivery.unchecked.length} unchecked` : ''}`;
  } else if (v.verdict === 'HARNESS-ERROR') {
    detail = String(ev?.error ?? 'no harness record').split('\n')[0].slice(0, 200);
  }
  records.push({
    id: row.id,
    bucket: row.bucket,
    name: row.name,
    verdict: v.verdict,
    detail,
    deliveredBy: v.deliveredBy,
    wg: {
      encoded: !!wgRow,
      selects: selects.map((s) => ({ title: s.title, lane: s.lane, optionType: s.optionType, gate: s.gate, inOption: s.inOption, under: s.under })),
      effects: effects.length,
      openValueEffects: v.openEffects,
      openEffects: openEffects.map((e) => ({ type: e.type, variable: e.variable, value: e.data?.value ?? null, block: e.data?.abilityBlockId ? names.block.get(String(e.data.abilityBlockId)) ?? null : undefined, spell: e.data?.spellId ? names.spell.get(String(e.data.spellId)) ?? null : undefined })),
      gatedSelects: selects.filter((s) => s.gate !== 'open' || s.inOption).length,
      delivery: delivery ? { delivered: delivery.delivered.length, undelivered: delivery.undelivered.length, unchecked: delivery.unchecked.length } : null,
    },
    ours: {
      supported: ev?.supported ?? false,
      host: ev?.host ?? null,
      controlsAdded: controls.map((c) => ({ page: c.page, ctl: c.ctl, title: c.title, lane: c.lane, options: c.options, live: c.live, state: c.state, subcard: c.subcard, setupcard: c.setupcard })),
      extraControls: v.extra.map((c) => `${c.title} [${c.lane}]`),
      sheetDiffCount: ev?.sheetDiffCount ?? 0,
      sheetDiffAll: ev?.sheetDiffAll ?? 0,
      sheetDiff: (ev?.sheetDiff ?? []).slice(0, 12),
      sheetError: ev?.sheetError ?? null,
      ms: ev?.ms ?? null,
    },
  });
}

const counts = {};
for (const r of records) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
const out = {
  batch: batchPath,
  generated: new Date().toISOString(),
  hostLevel: HOST_LEVEL,
  harnessMs: raw.ms ?? null,
  summary: counts,
  records,
};
writeFileSync(join(ROOT, OUT), JSON.stringify(out, null, 1));

/* ---- report -------------------------------------------------------------------------------------- */
console.log(`\nexperience: ${records.length} records — ${Object.entries(counts).map(([k, c]) => `${k} ${c}`).join(' · ')}`);
for (const r of records) {
  if (r.verdict === 'OK' && !VERBOSE) continue;
  console.log(`  ${r.verdict.padEnd(16)} ${r.bucket}/${r.id}${r.detail ? `\n      ${r.detail}` : ''}`);
}
console.log(`\nwritten: ${OUT}`);
