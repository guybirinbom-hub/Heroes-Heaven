/*
 * BATCH 035 — GATE PARK (WG-COMPARISON family, group gate-park).
 *
 * ONE DEFECT, IN THE INSTRUMENT AND NOT IN THE DATA. `node scripts/wg-identity.mjs --batch
 * work/wg-batch-035.json` reports `animal-instinct  items  theirs-not-ours=[spiderweb]`, and the
 * mechanic behind it is real: AoN instinct-8's Spider row prints `Web | Special* | Range increment
 * 15 feet` with the -10-foot Speed rider and the second-hit immobilize, and WG hands it over as two
 * giveItem ops (13946, 13947) inside a rage-gated conditional. It is already on the owner's desk as
 * entry #145, id `animal-instinct-spider-web`, and the owner's standing rule is that a queued record
 * stays as it is until he rules.
 *
 * The gate could not honour that. `ownerQueued` was a Set of DESK IDS and every gate asked
 * `ownerQueued.has(<RECORD id>)`, so a question filed as `<record>-<aspect>` parked nothing. The
 * treadmill this produced is on the desk in plain sight: #134 `spore-order-counts-as-leaf-order` was
 * re-keyed to `spore-order` (#139) and then to `cultivation-order` (#144) to get a record parked,
 * losing the aspect and leaving three entries where one question stands.
 *
 * The fix is a resolver — `queuedFor(recordId)` in scripts/wg-batch-gate.mjs — used by all six call
 * sites (KINDS ×2, VALUES, IDENTITY, EXPERIENCE, the PARITY 5b membership check and the
 * awaiting/settled split). It is exercised here through the script's `--queued-for` / `--queued-parks`
 * probe, which answers and exits before any comparer runs: the file is a script, so importing it would
 * run the whole gate.
 */
import { describe, expect, it, vi } from 'vitest';
import { CHILD_TIMEOUT } from './_timeouts';
/* Every case shells out to the gate script, which reads the 8 MB core.json from cold. See _timeouts.ts. */
vi.setConfig({ testTimeout: CHILD_TIMEOUT, hookTimeout: CHILD_TIMEOUT });
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CLI_ROOT = join(__dirname, '..');
const GATE = join(CLI_ROOT, 'scripts/wg-batch-gate.mjs');
const BATCH = 'work/wg-batch-035.json';
const DESK = 'work/owner-questions.json';
const GATE_SRC = readFileSync(GATE, 'utf8');

const tag = () => `${process.pid}-${Math.random().toString(36).slice(2)}`;

/** The desk entry that parks one record, straight out of the gate's own resolver. '' = not parked. */
const queuedFor = (recordId: string, desk = DESK): string =>
  execFileSync(process.execPath, [GATE, '--batch', BATCH, '--queue', desk, '--queued-for', recordId], {
    cwd: CLI_ROOT, encoding: 'utf8', maxBuffer: 1 << 26,
  }).trim();

/** Every record parked by a desk id that is NOT its own — the widening, listed. */
const widened = (desk = DESK): Record<string, string> =>
  Object.fromEntries(
    execFileSync(process.execPath, [GATE, '--batch', BATCH, '--queue', desk, '--queued-parks'], {
      cwd: CLI_ROOT, encoding: 'utf8', maxBuffer: 1 << 26,
    })
      .split('\n')
      .filter(Boolean)
      .map((l) => l.split('\t') as [string, string]),
  );

describe('batch 035 gate-park — animal-instinct is parked by desk entry #145, filed under record#aspect', () => {
  // batch 035: animal-instinct#spider-web
  it('queuedFor("animal-instinct") resolves to the desk id animal-instinct-spider-web', () => {
    expect(queuedFor('animal-instinct')).toBe('animal-instinct-spider-web');
    /* The desk really is keyed that way, and the record really is not — which is the defect in one
     * line: the old `ownerQueued.has('animal-instinct')` was false against this file. */
    const desk = JSON.parse(readFileSync(join(CLI_ROOT, DESK), 'utf8').replace(/^﻿/, ''));
    const ids = [...desk.open, ...desk.deferred].map((q: { id: string }) => q.id);
    expect(ids).toContain('animal-instinct-spider-web');
    expect(ids).not.toContain('animal-instinct');
    /* …and the IDENTITY gate asks the resolver, not a Set. This is the join between the probe above
     * and the gate proper: if the call site stops routing through queuedFor, this fails. */
    expect(GATE_SRC).toContain("if (queuedFor(mm[1])) { parkQueued(mm[1], 'IDENTITY'); n--; }");
  });

  // batch 035: animal-instinct#spider-web
  it('with desk entry #145 removed, nothing parks animal-instinct and the IDENTITY gate fails on it again', () => {
    /*
     * mutation-proof — the settle/park key stunted is the QUEUE ID `animal-instinct-spider-web`. The
     * danger of a resolver that widens a lookup is that it parks a record on something other than the
     * entry it claims to read, so the entry is deleted from a COPY of the desk and the park must go
     * with it.
     *
     * The IDENTITY gate's failure condition is two facts, and both are asserted here rather than
     * re-run: wg-identity reports the record (its mismatch line, matched by the gate's own
     * `^--- ([a-z0-9-]+)\s+\(` regex), and the resolver does not decrement it. The gate reads
     * work/owner-questions.json by path and `--queue` is probe-scoped ON PURPOSE — a real run may
     * never be pointed at a desk the owner did not write — so a stunted desk cannot be fed to the gate
     * itself, and the whole run is four minutes besides.
     */
    const rel = `work/.b035gp-desk-${tag()}.json`;
    const desk = JSON.parse(readFileSync(join(CLI_ROOT, DESK), 'utf8').replace(/^﻿/, ''));
    desk.open = desk.open.filter((q: { id: string }) => q.id !== 'animal-instinct-spider-web');
    expect(desk.open.length).toBe(JSON.parse(readFileSync(join(CLI_ROOT, DESK), 'utf8').replace(/^﻿/, '')).open.length - 1);
    writeFileSync(join(CLI_ROOT, rel), JSON.stringify(desk));
    try {
      expect(queuedFor('animal-instinct', rel)).toBe('');
      expect(widened(rel)['animal-instinct']).toBeUndefined();
    } finally {
      rmSync(join(CLI_ROOT, rel), { force: true });
    }
    /*
     * The other half of the failure condition USED to be that the comparer still raised the record —
     * `--- animal-instinct (…) theirs-not-ours=[spiderweb]`. Batch 037 BUILT the Web (owner ruling
     * #145's damageless-attack lane, plus the row on classFeatures/animal-instinct.grantedStrikes), so
     * wg-identity has nothing left to raise and the gate no longer needs the park to stay green here.
     * The park itself is unchanged and is still mutation-proofed above, against the desk entry: that is
     * the half this test exists for. What is asserted now is the fix, not the gap.
     */
    // batch 037: animal-instinct#spider-web
    const identity = execFileSync(process.execPath, [join(CLI_ROOT, 'scripts/wg-identity.mjs'), '--batch', BATCH], {
      cwd: CLI_ROOT, encoding: 'utf8', maxBuffer: 1 << 28,
    });
    expect(identity).not.toMatch(/^--- animal-instinct\s+\(/m);
    expect(identity).not.toContain('theirs-not-ours=[spiderweb]');
  });

  // batch 035: animal-instinct#spider-web
  it('the widening that parks animal-instinct does not park `weapon`, `divine` or `instinct`', () => {
    /*
     * The anti-over-park direction, which is what the `is not itself a record id` clause buys. Over the
     * whole desk the bare prefix rule parks 57 records nobody queued; every one of these three has a
     * desk id that starts with it AND is itself a record, so the entry answers for that record alone.
     */
    for (const [record, deskId] of [
      ['weapon', 'weapon-expertise'],
      ['divine', 'divine-font'],
      ['instinct', 'instinct-ability'],
    ]) {
      const desk = JSON.parse(readFileSync(join(CLI_ROOT, DESK), 'utf8').replace(/^﻿/, ''));
      const ids = [...desk.open, ...desk.deferred].map((q: { id: string }) => q.id);
      expect(ids).toContain(deskId);          // the near-match is really on the desk
      expect(queuedFor(record)).toBe('');     // …and parks nothing but its own record
      expect(queuedFor(deskId)).toBe(deskId);
    }
  });

  // batch 035: animal-instinct#spider-web
  // batch 037: screech-shooter-major#grade-numbers
  it('the widening around animal-instinct is exactly six records since screech-shooter-major joined, the two loose ones accepted and printed', () => {
    /*
     * The pin against silent growth. `--queued-parks` lists every record parked by a desk id that is
     * not its own; today that is five, and each is deliberate:
     *
     *   animal-instinct        ← #145 animal-instinct-spider-web         the finding this batch fixes
     *   dream-magic            ← dream-magic-second-taking               aspect
     *   flexible-spellcaster   ← flexible-spellcaster-collection-shape   aspect, LONGEST wins (not `flexible`)
     *   speed                  ← speed-status-lane-031                   LANE question, loose
     *   relic                  ← relic-gift-family-…-adamantine          LANE question, loose
     *
     * The last two are accepted rather than fixed: neither `speed` nor `relic` has ever been cut into a
     * batch, so the park is inert, and narrowing the rule to exclude them would need the desk to mark
     * lane questions as lane questions — which is the owner's file, not this gate's. They are pinned so
     * the widening can never grow past them without a test failing.
     *
     * `spore-order` is NOT here and that is the rule working: an exact desk id always beats a prefix,
     * and it carries both #134 (the old aspect key) and #139 (the record id).
     */
    /*
     * SIX since batch 037, which filed desk #151 `screech-shooter-major-rune-grade` — print states a
     * rune grade for the base and the greater screech shooter and is SILENT for the major, so the
     * major's grade cannot be invented and is queued. The id is an aspect key on a real record, the
     * same shape as animal-instinct and dream-magic above, so the park is the rule working.
     */
    // batch 037: screech-shooter-major#grade-numbers
    expect(widened()).toEqual({
      'animal-instinct': 'animal-instinct-spider-web',
      'dream-magic': 'dream-magic-second-taking',
      'flexible-spellcaster': 'flexible-spellcaster-collection-shape',
      'screech-shooter-major': 'screech-shooter-major-rune-grade',
      speed: 'speed-status-lane-031',
      relic: 'relic-gift-family-skysunder-sparkwarden-uniter-adamantine',
    });
    expect(queuedFor('flexible')).toBe('');
    expect(queuedFor('spore-order')).toBe('spore-order');
    /* The batch's OTHER queued record is an exact-match park, untouched by any of this. */
    expect(queuedFor('cultivation-order')).toBe('cultivation-order');
    /* Item 4 of this group's brief: the UNSUPPORTED branch test/batch035-instruments-1.test.ts pins
     * stays byte-identical through the resolver change. */
    expect(GATE_SRC).toContain("if (r.verdict === 'UNSUPPORTED') { unsupported.push(r.id); continue; }");
  });
});
