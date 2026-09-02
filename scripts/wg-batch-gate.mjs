/**
 * IS THIS BATCH ACTUALLY DONE?
 *
 * One command, one answer. Every problem this project found LATE was found late for the same reason: a
 * batch was declared clean on the strength of instruments that had not been asked whether they had
 * looked. This gate asks.
 *
 * It runs all four comparers over a batch and fails unless:
 *
 *   1. KINDS      — no record in the batch is in wg-diff's THEY-ONLY bucket.
 *   2. VALUES     — nothing left to adjudicate, AND no variable is still unknown to the comparer.
 *                   (Batch 8 shipped with 8 records nobody had ever value-checked, hidden behind one
 *                   lumped "no VAR mapping" label that meant both "not taught yet" and "adjudicated".)
 *   3. IDENTITY   — every named thing they grant has a counterpart on our side.
 *   4. PROSE      — every record the prose comparer raises holds SOMETHING on our side: a field, a
 *                   registry entry, or a mode. A record with nothing anywhere has not been read.
 *   5. COVERAGE   — every record in the batch was actually EXAMINED by at least one comparer. This is
 *                   the check whose absence let records slip through: "no instrument complained" and
 *                   "no instrument looked" produce the same silence.
 *   6. SETTLES    — no settle anywhere is justified with a hedge. Global rather than per-batch on
 *                   purpose: a settle silences a difference in EVERY batch, so "probably equivalent"
 *                   written into a registry is an open question that can never come back. Batch 10
 *                   found five of them by hand. If this fails, no batch is really finished.
 *   7. EXPERIENCE — every `select` Wanderer's Guide puts in front of the player is a control OUR
 *                   builder actually RENDERS, and every value-bearing effect they encode MOVES our
 *                   derived sheet. Observed on the real Builder in jsdom (scripts/wg-experience.mjs →
 *                   work/wg-batch-0NN-experience.json). Exists because Domain Initiate shipped with
 *                   matching DATA and no picker, and gates 1–6 passed it: the kind gate is satisfied
 *                   by a field EXISTING, never by the player seeing it (owner, 2026-09-02).
 *
 * Anything it prints is work, not information. Exit code 0 means the batch is finished.
 *
 *   node scripts/wg-batch-gate.mjs --batch work/wg-batch-008.json
 *   node scripts/wg-batch-gate.mjs --batch work/wg-batch-008.json --verbose
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wgRecord, wgRowsByBucket } from './lib/wg-parse.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const VERBOSE = process.argv.includes('--verbose');

const batchPath = arg('--batch', null);
if (!batchPath) { console.error('usage: node scripts/wg-batch-gate.mjs --batch work/wg-batch-00N.json'); process.exit(2); }
if (!existsSync(join(ROOT, batchPath))) { console.error(`no such batch file: ${batchPath}`); process.exit(2); }

const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8').replace(/^﻿/, ''));
const batch = Object.values(read(batchPath));
const ids = new Set(batch.map((r) => r.id));
const core = read('public/core.json');

const run = (script, extra = []) => {
  try {
    return execFileSync(process.execPath, [join(ROOT, 'scripts', script), '--batch', batchPath, ...extra], {
      cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28,
    });
  } catch (e) {
    /* A comparer that exits non-zero still prints its report on stdout; keep it rather than losing the run. */
    return String(e.stdout ?? '') + String(e.stderr ?? '');
  }
};

const failures = [];
const fail = (label, detail) => failures.push(`${label}\n      ${detail}`);
const ok = (label, detail) => { if (VERBOSE) console.log(`  ok    ${label}${detail ? `   ${detail}` : ''}`); };

/*
 * OWNER-QUEUED records — the one sanctioned parking lot. A record whose WG-vs-print divergence is
 * recorded in work/owner-questions.json's `open` list awaits HIS ruling; until then the record stays
 * as it is (the standing rule at the top of that file), so the comparers re-reporting that same
 * divergence every run is noise, not work. Gates 1–3 subtract these ids AND ANNOUNCE THEM below —
 * a skipped record is printed, never silent, and gate 5b requires each to carry an OWNER-QUEUED
 * verdict whose queue membership it checks. The queue file is the single authority.
 */
const _oq = read('work/owner-questions.json') ?? {};
// deferred = parked until after the whole batching process by the owner's 2026-08-27 ruling — honored
// exactly like open, so a deferred record never fails a gate and never gets re-asked.
const ownerQueued = new Set([...(_oq.open ?? []), ...(_oq.deferred ?? [])].map((q) => q.id));
/* RULED records park only in the EXPERIENCE gate: a ruling can keep OURS where WG differs (Circle of
 * Spirits: the printed formula, not their flat +1), and the player-experience judge then rightly sees
 * their op undelivered. The data comparers are not parked for ruled ids — a ruling is implemented
 * there, and a mismatch would be a regression. */
const ownerRuled = new Set((_oq.ruled ?? []).map((q) => q.id));
/* INSTRUMENT LIMITS (experience gate only). A record whose control or effect the harness cannot observe
 * — a control that lives on the class chassis and cannot be switched off, a bonus that only exists in
 * play state the host does not enter, a Wanderer's Guide bookkeeping variable with no sheet value — and
 * that a reader has VERIFIED by hand against the running builder. Each entry names the lane and what
 * was verified; the gate parks it and PRINTS it, so the list stays visible and never silently grows.
 * Not an allowlist for defects: a real gap goes to the owner queue or gets fixed. */
const _limits = read('work/experience-instrument-limits.json') ?? {};
const instrumentLimited = new Map(Object.entries(_limits.records ?? {}));
const queuedFlagged = new Map(); // id -> [gate labels that would have flagged it]
const parkQueued = (id, gate) => { (queuedFlagged.get(id) ?? queuedFlagged.set(id, []).get(id)).push(gate); };

console.log(`gate: ${batchPath} — ${ids.size} records\n`);

/* ---- 1. KINDS ---------------------------------------------------------------------------------- */
{
  /* wg-diff is CORPUS-wide and has no --batch, so it is run once to a file and intersected here. That
   * asymmetry is exactly why a batch's kind check used to be done by hand and could be skipped. */
  const out = 'work/.gate-diff.json';
  try {
    execFileSync(process.execPath, [join(ROOT, 'scripts/wg-diff.mjs'), '--out', out], { cwd: ROOT, stdio: 'ignore', maxBuffer: 1 << 28 });
  } catch { /* it reports on stdout and may exit non-zero; the file is what matters */ }
  if (!existsSync(join(ROOT, out))) fail('KINDS: wg-diff produced no output', 'the comparer did not run — fix that before trusting anything below');
  else {
    const diff = JSON.parse(readFileSync(join(ROOT, out), 'utf8'));
    const raw = diff.theyOnly.filter((r) => ids.has(r.id));
    for (const h of raw) if (ownerQueued.has(h.id)) parkQueued(h.id, `KINDS missing=[${(h.missing ?? []).join(',')}]`);
    const hits = raw.filter((r) => !ownerQueued.has(r.id));
    if (hits.length) fail(`KINDS: ${hits.length} record(s) model a kind we do not`, hits.map((h) => `${h.id} missing=[${(h.missing ?? []).join(',')}]`).join('\n      '));
    else ok('KINDS', '0 THEY-ONLY');
  }
}

/* ---- 2. VALUES -------------------------------------------------------------------------------- */
const valuesOut = run('wg-values.mjs', ['--verbose']);
{
  const adjudicate = /^(\d+) records with at least one value to adjudicate/m.exec(valuesOut);
  let n = adjudicate ? Number(adjudicate[1]) : null;
  if (n !== null && n > 0) {
    // Subtract the owner-queued mismatch records (announced below) — mismatches print as "--- id (Name)".
    for (const m of valuesOut.matchAll(/^--- ([a-z0-9-]+)\s+\(/gm)) {
      if (ownerQueued.has(m[1])) { parkQueued(m[1], 'VALUES'); n--; }
    }
  }
  if (n === null) fail('VALUES: could not read the comparer\'s summary', 'wg-values changed its output shape — the gate is blind until it is re-read');
  else if (n > 0) fail(`VALUES: ${n} record(s) disagree on a number or a set`, 'run: node scripts/wg-values.mjs --batch ' + batchPath);
  else ok('VALUES', '0 to adjudicate');

  const unknown = [...valuesOut.matchAll(/NO VAR MAPPING — nobody has taught this yet: ([^\n]+)\n\s+([^\n]+)/g)];
  if (unknown.length) {
    fail(`VALUES: ${unknown.length} variable(s) nothing has ever compared`,
      unknown.map((m) => `${m[2].trim()}  →  ${m[1].trim()}`).join('\n      ')
      + '\n      Read each record, then either teach wg-values the variable or record it in NOT_A_SCALAR with the lane that covers it.');
  } else ok('VALUES', 'no unknown variables');
}

/* ---- 3. IDENTITY ------------------------------------------------------------------------------ */
{
  const out = run('wg-identity.mjs');
  const m = /^(\d+) records where a named thing on their side has no counterpart on ours/m.exec(out);
  let n = m ? Number(m[1]) : null;
  if (n !== null && n > 0) {
    // Subtract the owner-queued mismatch records (announced below) — mismatches print as "--- id (Name)".
    for (const mm of out.matchAll(/^--- ([a-z0-9-]+)\s+\(/gm)) {
      if (ownerQueued.has(mm[1])) { parkQueued(mm[1], 'IDENTITY'); n--; }
    }
  }
  if (n === null) fail('IDENTITY: could not read the comparer\'s summary', 'wg-identity changed its output shape');
  else if (n > 0) fail(`IDENTITY: ${n} record(s) grant something we do not`, 'run: node scripts/wg-identity.mjs --batch ' + batchPath);
  else ok('IDENTITY', '0 mismatches');
}

/* ---- 4. PROSE: every raised record must hold something on our side ---------------------------- */
{
  /* Repo-relative: every comparer resolves `--out` against ROOT, so an absolute temp path lands at
   * `<repo>/C:/Users/...` and the write fails. */
  const dest = 'work/.gate-prose.json';
  run('wg-prose.mjs', ['--out', dest]);
  if (!existsSync(join(ROOT, dest))) ok('PROSE', 'nothing raised');
  else {
    const rows = JSON.parse(readFileSync(join(ROOT, dest), 'utf8'));
    const bare = rows.filter((r) => {
      const fields = Object.keys(r.ourFields ?? {}).filter((k) => k !== 'actionCost');
      const modes = Object.values(core.modes ?? {}).some((m) => m?.fromItemId === r.id || (m?.feats ?? []).includes(r.id));
      return !fields.length && !(r.ourRegistries ?? []).length && !modes;
    });
    if (bare.length) {
      fail(`PROSE: ${bare.length} record(s) assert something and hold NOTHING on our side`,
        bare.map((r) => `${r.id} :: ${String(r.printed).replace(/\s+/g, ' ').slice(0, 120)}`).join('\n      '));
    } else ok('PROSE', `${rows.length} raised, all hold something`);
  }
}

/* ---- 5. COVERAGE: was every record actually looked at? ---------------------------------------- */
{
  /*
   * The check whose absence is the reason for this file. A comparer that never examined a record prints
   * nothing about it, which reads identically to "examined and agreed". wg-values names the records it
   * compared and the ones it skipped, so the union of those is what was actually looked at.
   */
  const seen = new Set();
  for (const m of valuesOut.matchAll(/^ok\s+([a-z0-9-]+)\s+\(/gm)) seen.add(m[1]);
  for (const m of valuesOut.matchAll(/^--- ([a-z0-9-]+)\s+\(/gm)) seen.add(m[1]);
  /* …and the skip lines, which --verbose prints as a comma-joined id list under each reason. */
  for (const m of valuesOut.matchAll(/^\s{8}([a-z0-9-]+(?:,\s*[a-z0-9-]+)*)\s*$/gm)) {
    for (const id of m[1].split(',')) seen.add(id.trim());
  }
  /*
   * A record that DEFERS to a sibling is covered by that sibling, not uncovered.
   *
   * `wgOwnsComparison` sends two kinds of record to a sibling: an `actions` record whose feat or class
   * feature shares its id, and an `aon-` twin shadowed by the canonical of the same name. Both are
   * deliberately skipped by all four comparers — so without this they arrive here as "examined by
   * nothing", which is the one thing this check exists to catch. Reporting them would train the reader
   * to ignore the check, which is worse than not having it.
   *
   * The deferral only counts if the SIBLING was itself examined. A twin whose canonical nobody looked
   * at is still an unexamined record, just under a different name.
   */
  const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  /* Resolve each id in the bucket its batch row was cut from — 'warrior' is a background AND a
   * class feature, and the bare id resolved to the wrong one (batch 23). */
  const bucketHintOf = new Map(batch.map((r) => [r.id, r.bucket]));
  const siblingOf = (id) => {
    const { rec, bucket } = wgRecord(core, id, bucketHintOf.get(id));
    if (!rec) return null;
    if (id.startsWith('aon-')) {
      for (const [otherId, other] of Object.entries(core[bucket] ?? {})) {
        if (otherId !== id && !otherId.startsWith('aon-') && norm(other?.name) === norm(rec.name)) return otherId;
      }
      return null;
    }
    if (bucket === 'actions' && (core.feats?.[id] || core.classFeatures?.[id])) return id;
    return null;
  };
  const unexamined = [...ids].filter((id) => !seen.has(id));
  /*
   * Three reasons a record can go unexamined, and only one of them is a failure.
   *
   *   DEFERRED — `wgOwnsComparison` sent it to a sibling: an `actions` record whose feat or class
   *     feature shares its id, or an `aon-` twin shadowed by the canonical of the same name. The
   *     canonical is the record a character can reach and the one the mechanics are authored on; the
   *     twin is suppressed in the app. It carries no mechanics BY DESIGN, so comparing it produced a
   *     finding about a record no player can select. Note the sibling is compared in ITS OWN batch,
   *     not this one, so `seen` cannot confirm it here — the deferral is named in the pass line
   *     instead of being swallowed, because a silent exemption is how this check stops working.
   *
   *   NOT ENCODED — their side has the record but encodes nothing. The owner's rule is that where
   *     they encode nothing we stay as we are.
   *
   *   REAL GAP — anything else: their side encodes it and no instrument looked. This is the case the
   *     whole file exists for.
   */
  const deferred = unexamined.filter((id) => siblingOf(id));
  const rest = unexamined.filter((id) => !siblingOf(id));
  /*
   * `theirOps` is a CUT-TIME snapshot, and the pairing has since learned things the snapshot
   * predates — notably that the dump carries STARFINDER rows sharing PF2e names (batch 18's
   * Bloodsense was "encoded" only by Starfinder's Blood Sense; wgRowsByBucket now drops those
   * sources). So a snapshot that says "they encode it" is confirmed against the LIVE pairing
   * before it can fail the gate: no live row for the name in the record's bucket means their side
   * has nothing for this record today, which is the owner's "they encode nothing" case.
   */
  const liveRows = rest.length ? wgRowsByBucket(readFileSync(join(ROOT, 'work/wg/wg-data.sql'), 'utf8')) : null;
  const livelyEncoded = (id) => {
    const { rec, bucket } = wgRecord(core, id, bucketHintOf.get(id));
    const row = rec?.name ? liveRows?.[bucket]?.get(norm(rec.name)) : undefined;
    return !!row && String(row.operations ?? '').length > 2;
  };
  const theirsMissing = rest.filter((id) => !batch.find((r) => r.id === id)?.theirOps?.length || !livelyEncoded(id));
  const realGap = rest.filter((id) => batch.find((r) => r.id === id)?.theirOps?.length && livelyEncoded(id));
  if (realGap.length) {
    fail(`COVERAGE: ${realGap.length} record(s) their side encodes that NO comparer examined`,
      realGap.join(', ') + '\n      Read each one by hand — "no comparer complained" is not "no problem".');
  } else {
    const bits = [`${ids.size - theirsMissing.length - deferred.length} examined`, `${theirsMissing.length} not encoded on their side`];
    if (deferred.length) bits.push(`${deferred.length} deferred to a canonical sibling (${deferred.map((id) => `${id} → ${siblingOf(id)}`).join(', ')})`);
    ok('COVERAGE', bits.join(', '));
  }
}

/* ---- 7. RESIDUAL: were the records READ, not just compared? ------------------------------------ */
{
  /*
   * THE GATE ONLY PROVES WE AGREE WITH WANDERER'S GUIDE. It cannot see a printed clause NEITHER side
   * models, and that is where the defects actually are.
   *
   * MEASURED on batch 13, after all six gates were green: reading all 100 records against their
   * printed text found 21 real defects, 13 of them player-visible — a 21% rate against the 11.5% this
   * project had on record. The barbarian's Fast Movement granted no Speed, Daydream Trance's toggle
   * changed nothing, a Fighter Bright Lion rolled their focus spell off DEXTERITY as an occult spell,
   * and three "you gain X" feats granted nothing at all. Every one of those passed the comparers,
   * because Wanderer's Guide does not model them either.
   *
   * OWNER RULING (2026-08-21): *"the cost is worth doing if it means better accuracy"* — so the read is
   * part of finishing a batch, not an extra. This gate makes it unskippable: a batch is not done until
   * its residual audit is on disk beside it.
   *
   * The artefact is `work/wg-batch-0NN-residual.json`, holding at least `{ examined, confirmed: [] }`.
   * `examined` must cover every record in the batch — a sample is not a read, and half a read reports
   * the same silence as a clean one.
   */
  /*
   * ⚠ THE GRANDFATHER CLAUSE IS GONE. EVERY BATCH NEEDS THE READ.
   *
   * Batches 1–12 closed on the six comparer gates alone, and this gate used to let them pass with a
   * warning while batches 13+ were held to the read. That debt has been paid: all 1,201 records were
   * read against their printed text, and the 262 confirmed findings are closed — the batch-by-batch
   * accounting is in each `work/wg-batch-0NN-residual.json`.
   *
   * Nothing is exempt now, so a batch can never again be called done without a read. That is the whole
   * point of removing the clause rather than leaving it switched off: there is no `RESIDUAL_FROM` for
   * a future batch to slip under.
   */
  const residualPath = batchPath.replace(/\.json$/, '-residual.json');
  if (!existsSync(join(ROOT, residualPath))) {
    fail(
      'RESIDUAL: the batch has not been read against its printed text',
      `no ${residualPath}\n      The six gates above only prove we agree with THEIR encoding. Read every record's` +
        `\n      printed text, fix what neither side models, and write the result to that file.`,
    );
  } else {
    const r = read(residualPath);
    const examined = Number(r?.examined ?? 0);
    if (examined < ids.size) {
      fail(
        `RESIDUAL: only ${examined} of ${ids.size} record(s) were read`,
        'A sample is not a read — an unread record reports the same silence as a correct one.',
      );
    } else {
      const open = (r.confirmed ?? []).filter((f) => !f.fixed);
      if (open.length) {
        fail(`RESIDUAL: ${open.length} confirmed defect(s) still open`,
          open.map((f) => `${f.id}: ${String(f.summary ?? '').slice(0, 90)}`).join('\n      '));
      } else ok('RESIDUAL', `${examined} read, ${(r.confirmed ?? []).length} defect(s) found and fixed`);
    }
  }
}

/* ---- 5b. PARITY: every record they encode has been compared to them, one by one ----------------- */
{
  /*
   * THE GATE THE OTHERS CANNOT BE. Gates 1–4 ask "does their encoding mention a KIND we do not have?"
   * — necessary, but satisfied two ways: ours delivers the same thing, OR the reader was taught a new
   * field and stopped reporting. Batch 16's KINDS count fell 26 → 21 the moment wg-diff learned about
   * `resonant`, and nothing was proven by that drop.
   *
   * And a record can pass all six and still differ. The aeon-stone resonance was built from the printed
   * text and never compared to their rows: six of sixteen were wrong — four missing a rank they store,
   * two granting no spell at all — and no gate said a word, because those gaps live in a VALUE the
   * comparer does not model for that field. The owner found it by asking; that is not a process.
   *
   * The owner's rule is the EXACT same implementation as theirs. The only way to know is to look at
   * both, per record, and write the answer down. This gate refuses a batch until every record they
   * encode anything for carries a verdict in `work/wg-batch-0NN-parity.json`:
   *
   *   MATCHES                      ours already delivers the same thing — say WHERE ours lives.
   *   FIXED                        it did not, and now does — say what changed.
   *   OWNER-RULED                  he decided this one (see work/owner-questions.json).
   *   OWNER-QUEUED                 the divergence awaits his ruling. Not a hedge: the gate CHECKS the
   *                                id really is in work/owner-questions.json's open list, so this
   *                                verdict cannot park a record nobody queued. Until ruled, the
   *                                record stays as it is — that meanwhile-behaviour is itself his
   *                                standing rule, recorded at the top of the queue file.
   *   THEY-ENCODE-NOTHING-USEFUL   their ops carry no mechanical content for a player.
   *
   * A verdict is a claim, and the tests and guards are what check it — but an unwritten verdict is not
   * a claim at all, which is how six wrong records shipped inside a green batch.
   */
  const parityPath = batchPath.replace(/\.json$/, '-parity.json');
  const encoded = Object.values(batch).filter((r) => (r.theirOps ?? []).length);
  if (!existsSync(join(ROOT, parityPath))) {
    fail(
      'PARITY: the batch has not been compared to Wanderer\'s Guide record by record',
      `no ${parityPath}\n      ${encoded.length} record(s) in this batch have an encoding on their side. Run` +
        `\n      node scripts/wg-parity-dump.mjs --batch ${batchPath} --open` +
        `\n      and write a verdict for each. A quiet gate is not the same as a matching implementation.`,
    );
  } else {
    const p = read(parityPath);
    const seen = new Map((p.records ?? []).map((r) => [r.id, r]));
    const missing = encoded.filter((r) => !seen.has(r.id));
    const _oq2 = read('work/owner-questions.json') ?? {};
    const queuedIds = new Set([...(_oq2.open ?? []), ...(_oq2.deferred ?? [])].map((q) => q.id));
    const bad = [...seen.values()].filter(
      (r) =>
        !['MATCHES', 'FIXED', 'OWNER-RULED', 'THEY-ENCODE-NOTHING-USEFUL'].includes(r.verdict) &&
        // OWNER-QUEUED is only usable when the queue actually holds the id — the claim is checked here.
        !(r.verdict === 'OWNER-QUEUED' && queuedIds.has(r.id)),
    );
    if (missing.length) {
      fail(
        `PARITY: ${missing.length} of ${encoded.length} record(s) never compared`,
        missing.slice(0, 12).map((r) => r.id).join(', ') + (missing.length > 12 ? ` … and ${missing.length - 12} more` : ''),
      );
    } else if (bad.length) {
      fail(`PARITY: ${bad.length} record(s) carry no usable verdict`, bad.map((r) => `${r.id}: ${r.verdict}`).join(', '));
    } else {
      const byVerdict = {};
      for (const r of seen.values()) byVerdict[r.verdict] = (byVerdict[r.verdict] ?? 0) + 1;
      ok('PARITY', `${encoded.length} compared — ${Object.entries(byVerdict).map(([k, v]) => `${v} ${k}`).join(', ')}`);
    }
  }
}

/* ---- 6. SETTLES: no settle anywhere is justified with a hedge ---------------------------------- */
{
  /*
   * GLOBAL, not per-batch, and that is the point. A settle silences a difference in EVERY future
   * batch, so a hedged one — "probably equivalent", "assuming their row means X" — is an open question
   * written as a closed one, and nothing will ever raise it again. Five were found by hand in batch 10.
   *
   * Failing an unrelated batch on a hedge elsewhere is the intended behaviour: if a registry entry is
   * unsound then the gates that lean on it are not sound either, and no batch is really finished.
   */
  try {
    execFileSync(process.execPath, [join(ROOT, 'scripts/wg-settle-audit.mjs')], { cwd: ROOT, encoding: 'utf8' });
  } catch (e) {
    const out = String(e.stdout ?? e.message ?? '').trim();
    fail('SETTLES: a settle is justified with a hedge, not a decision', out.split('\n').join('\n      '));
  }
}

/* ---- 7. KEPT OURS: every settle in this batch, on the record ----------------------------------- */
{
  /*
   * THE ESCAPE HATCH, MADE VISIBLE.
   *
   * The owner's rule is: where both sides encode a thing differently, adopt THEIRS. The gates above
   * enforce that — a batch cannot close on an unadopted difference — except through one door: the
   * settle registries (VERIFIED_EQUIVALENT / SETTLED_VALUES / SETTLED_IDENTITIES), where a difference
   * is recorded as "ours kept, with the printed text as evidence". Those entries live as code comments
   * in three files, which means every place we did NOT do it their way was invisible at exactly the
   * moment it mattered: batch close.
   *
   * So the gate prints them. This section is not a failure — it is the list of decisions the owner is
   * entitled to veto. Any line here can be flipped to their encoding on his say-so; the full evidence
   * for each is printed by --settles.
   */
  const parseSettles = (file, blockName) => {
    const src = readFileSync(join(ROOT, 'scripts', file), 'utf8');
    const start = src.indexOf(`const ${blockName} = {`);
    if (start < 0) return new Map();
    const body = src.slice(start, src.indexOf('\n};', start));
    const out = new Map();
    let note = '';
    for (const m of body.matchAll(/\/\*([\s\S]*?)\*\/|^\s{2}(?:['"]([a-z0-9|:-]+)['"]|([a-z][a-zA-Z0-9-]*))\s*:\s*\[([^\]]*)\]/gm)) {
      if (m[1] !== undefined) {
        const text = m[1].replace(/^[\s*]+/gm, ' ').replace(/\s+/g, ' ').trim();
        if (!text.startsWith('---')) note = text; // "---- batch NNN ----" section headers are not evidence
        continue;
      }
      const id = m[2] ?? m[3];
      out.set(id, { kinds: m[4].replace(/['"\s]/g, ''), note, registry: blockName });
      /* No note reset: consecutive keys under one comment share it (the fascination-blood shape). */
    }
    return out;
  };
  const registries = [
    parseSettles('wg-diff.mjs', 'VERIFIED_EQUIVALENT'),
    parseSettles('wg-values.mjs', 'SETTLED_VALUES'),
    parseSettles('wg-identity.mjs', 'SETTLED_IDENTITIES'),
  ];
  const kept = [];
  for (const reg of registries) for (const [id, s] of reg) if (ids.has(id)) kept.push({ id, ...s });
  if (kept.length) {
    console.log(`\n  KEPT OURS — ${kept.length} settle(s) answer for records in this batch. Each is a recorded decision`);
    console.log('  NOT to adopt their encoding, justified by the printed text. Reviewable; any line can be vetoed.');
    for (const k of kept) {
      const full = process.argv.includes('--settles');
      const note = full ? k.note : k.note.length > 100 ? k.note.slice(0, 100) + '…' : k.note;
      console.log(`      ${k.id.padEnd(34)} [${k.kinds}] (${k.registry.replace(/^(VERIFIED_|SETTLED_)/, '').toLowerCase()})`);
      if (note) console.log(`        ${note}`);
    }
    if (!process.argv.includes('--settles')) console.log('      (full evidence: re-run with --settles)');
  }
}

/* ---- 8. EXPERIENCE: does the PLAYER get what Wanderer's Guide gives them? ---------------------- */
{
  /*
   * EVERY GATE ABOVE PROVES OUR DATA MATCHES THEIRS. Not one of them opens the builder.
   *
   * Batch 24 closed with cleric-spellcasting FIXED and doctrine MATCHES, and the owner opened his own
   * cleric and found: no place to prepare cantrips, a Domain Initiate spell WG lets him pick and we
   * auto-picked, a doctrine grant that looked missing because it merged into a slot take. All three
   * lived in the one place no comparer looks — what the player is shown and what actually moves.
   *
   * The artefact is `work/wg-batch-0NN-experience.json`, written by `node scripts/wg-experience.mjs
   * --batch …`, which renders the REAL Builder for a host that owns each record and one that does not
   * (test/wg-experience.harness.test.tsx), lists the controls the record ADDS, diffs the derived sheet,
   * and compares both against their `select` ops and value-bearing effects. Verdicts:
   *   OK · MISSING-CONTROL (they ask, we don't) · NO-SHEET-EFFECT (they encode a value, ours moves
   *   nothing) · UNSUPPORTED (the harness cannot play this bucket yet — items live on the sheet) ·
   *   HARNESS-ERROR. Only OK and a queued id pass. UNSUPPORTED is PRINTED, never counted as a pass.
   *
   * Staleness is a lie with a timestamp: the evidence must be newer than src/builder, src/rules, the
   * data and the batch file, or the gate asks for a re-run rather than trusting it.
   */
  const newestMtime = (p) => {
    let newest = 0;
    const walk = (f) => {
      let st;
      try { st = statSync(f); } catch { return; }
      if (st.isDirectory()) { for (const c of readdirSync(f)) walk(join(f, c)); } else if (st.mtimeMs > newest) newest = st.mtimeMs;
    };
    walk(p);
    return newest;
  };
  const expPath = batchPath.replace(/\.json$/, '-experience.json');
  if (!existsSync(join(ROOT, expPath))) {
    fail(
      'EXPERIENCE: the batch has not been PLAYED — nothing has checked what the player sees',
      `no ${expPath}\n      node scripts/wg-experience.mjs --batch ${batchPath}`,
    );
  } else {
    const x = read(expPath);
    const gen = Date.parse(x?.generated ?? '') || 0;
    const newest = Math.max(...['src/builder', 'src/rules', 'public/core.json', batchPath].map((p) => newestMtime(join(ROOT, p))));
    if (gen < newest) {
      fail('EXPERIENCE: the evidence is older than the code or data it describes',
        `re-run: node scripts/wg-experience.mjs --batch ${batchPath}`);
    }
    const rows = new Map((x?.records ?? []).map((r) => [r.id, r]));
    const missing = [...ids].filter((id) => !rows.has(id));
    if (missing.length) fail(`EXPERIENCE: ${missing.length} record(s) were never played`, missing.slice(0, 12).join(', '));
    const bad = [];
    const unsupported = [];
    const limited = [];
    for (const r of rows.values()) {
      if (!ids.has(r.id)) continue;
      if (r.verdict === 'UNSUPPORTED') { unsupported.push(r.id); continue; }
      if (r.verdict === 'OK') continue;
      if (ownerQueued.has(r.id)) { parkQueued(r.id, `EXPERIENCE ${r.verdict}`); continue; }
      if (ownerRuled.has(r.id)) { parkQueued(r.id, `EXPERIENCE ${r.verdict} (ruled — ours kept by ruling)`); continue; }
      if (instrumentLimited.has(r.id)) { limited.push(r); parkQueued(r.id, `EXPERIENCE ${r.verdict} (instrument limit: ${instrumentLimited.get(r.id)?.lane ?? '?'})`); continue; }
      bad.push(r);
    }
    if (bad.length) {
      fail(
        `EXPERIENCE: ${bad.length} record(s) do not give the player what Wanderer's Guide gives them`,
        bad.map((r) => `${r.id}: ${r.verdict}${r.detail ? ` — ${String(r.detail).slice(0, 140)}` : ''}`).join('\n      '),
      );
    } else ok('EXPERIENCE', `${rows.size - unsupported.length} played, 0 differences`);
    if (unsupported.length) {
      console.log(`\n  EXPERIENCE — ${unsupported.length} record(s) the harness cannot play yet (recorded, NOT passed):`);
      console.log(`      ${unsupported.slice(0, 10).join(', ')}${unsupported.length > 10 ? ` … +${unsupported.length - 10}` : ''}`);
    }
    if (limited.length) {
      console.log(`\n  EXPERIENCE — ${limited.length} record(s) verified by hand where the harness cannot see (work/experience-instrument-limits.json):`);
      for (const r of limited) console.log(`      ${r.id}: ${r.verdict} — ${instrumentLimited.get(r.id)?.lane ?? '?'}: ${String(instrumentLimited.get(r.id)?.verified ?? '').slice(0, 120)}`);
    }
  }
}

/* ---- owner-queued announcement ---------------------------------------------------------------- */
if (queuedFlagged.size) {
  console.log(`\n  OWNER-QUEUED — ${queuedFlagged.size} flagged record(s) in this batch await his ruling`);
  console.log('  (work/owner-questions.json). Their diffs are recorded there, not counted above:');
  for (const [id, gates] of queuedFlagged) console.log(`      ${id.padEnd(34)} ${gates.join(', ')}`);
}

/* ---- verdict ---------------------------------------------------------------------------------- */
if (!failures.length) {
  console.log(`\nBATCH DONE — all nine gates pass for ${batchPath}.`);
  process.exit(0);
}
console.log(`\n${failures.length} GATE(S) FAILED — this batch is not finished:\n`);
for (const f of failures) console.log(`  · ${f}\n`);
process.exit(1);
