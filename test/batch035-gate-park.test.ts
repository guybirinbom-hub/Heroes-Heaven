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

/*
 * ── RE-PINNED 2026-09-11, and the reason is the desk working rather than the resolver breaking ──
 *
 * The record this file is named for is no longer parked. #145 `animal-instinct-spider-web` was one of
 * the 128 questions the owner ANSWERED in his 2026-09-10 desk pass, batch 037 built the Web from that
 * ruling, and the 2026-09-11 desk pass moved the entry out of `open` and into `ruled` in
 * work/owner-questions.json. A ruled question parks nothing on purpose: scripts/wg-batch-gate.mjs:117
 * builds the park map from `open` + `deferred` only (deferred being parked-until-later under the
 * 2026-08-27 ruling), because a park is "the owner has not spoken yet", and he has. Every fixture the
 * four cases below used — #145, #64 `weapon-expertise`, #42 `divine-font`, #78 `instinct-ability`,
 * #139 `spore-order`, #144 `cultivation-order` — went the same way in the same pass.
 *
 * The MECHANISM is untouched and still load-bearing: five records are parked through a widened key
 * today. So the cases are re-pointed at entries that are still live — #151
 * `screech-shooter-major-rune-grade` for the `<record>-<aspect>` shape animal-instinct had, and the
 * deferred relic family for the anti-over-park direction — and animal-instinct is asserted on the
 * OTHER side of the desk, so this file still fails if the entry silently vanishes.
 */
describe('batch 035 gate-park — a question filed under record#aspect parks its record', () => {
  // batch 035: animal-instinct#spider-web
  // batch 037: screech-shooter-major#grade-numbers
  it('queuedFor("screech-shooter-major") resolves to the desk id screech-shooter-major-rune-grade, and the answered animal-instinct parks nothing', () => {
    /* The desk really is keyed that way, and the record really is not — which is the defect in one
     * line: the old `ownerQueued.has('<record>')` was false against this file. */
    const desk = JSON.parse(readFileSync(join(CLI_ROOT, DESK), 'utf8').replace(/^﻿/, ''));
    const arrayOf = (id: string) =>
      (['open', 'deferred', 'ruled', 'authorisedExceptions'] as const).find((a) =>
        ((desk[a] ?? []) as { id?: string }[]).some((q) => q.id === id));
    expect(arrayOf('screech-shooter-major-rune-grade'), 'the desk holds the question under record#aspect').toBeTruthy();
    expect(arrayOf('screech-shooter-major'), 'and never under the bare record id').toBeUndefined();
    /* …and the resolver parks the record for exactly as long as the question is unanswered. Read from
     * the desk rather than written as a literal: #151 is ruled but held for a later batch (its items
     * are level 9+), and the day it moves to `ruled` the park correctly stops — a literal here would
     * report the desk working as a regression. The PAIRING above is what this case pins. */
    const parked = ['open', 'deferred'].includes(arrayOf('screech-shooter-major-rune-grade')!);
    expect(queuedFor('screech-shooter-major')).toBe(parked ? 'screech-shooter-major-rune-grade' : '');
    /* The original fixture, asserted where it now lives: ruled, therefore not parked. If #145 is ever
     * dropped from the file altogether — rather than answered — this is what says so. */
    expect((desk.ruled ?? []).map((q: { id: string }) => q.id)).toContain('animal-instinct-spider-web');
    expect(queuedFor('animal-instinct')).toBe('');
    /* …and the IDENTITY gate asks the resolver, not a Set. This is the join between the probe above
     * and the gate proper: if the call site stops routing through queuedFor, this fails. */
    expect(GATE_SRC).toContain("if (queuedFor(mm[1])) { parkQueued(mm[1], 'IDENTITY'); n--; }");
  });

  // batch 035: animal-instinct#spider-web
  // batch 037: screech-shooter-major#grade-numbers
  it('with desk entry #151 removed, nothing parks screech-shooter-major', () => {
    /*
     * mutation-proof — the settle/park key stunted is the QUEUE ID `screech-shooter-major-rune-grade`
     * (it was #145 `animal-instinct-spider-web` until that question was answered; see the header). The
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
    /* Deleted from BOTH unanswered arrays, and the copy is then asserted to hold the entry nowhere.
     * It used to be filtered out of `open` alone with a length check — which silently stopped deleting
     * anything the day the owner answered #151 (desk pass 2026-09-12: the entry moved to `ruled`, so
     * the filter removed nothing and the case proved a park was gone that the real desk had already
     * ended). What the case is FOR is that the park follows the entry, wherever the entry lives. */
    const gone = (q: { id: string }) => q.id !== 'screech-shooter-major-rune-grade';
    for (const arr of ['open', 'deferred'] as const) desk[arr] = (desk[arr] ?? []).filter(gone);
    expect(
      [...(desk.open ?? []), ...(desk.deferred ?? [])].some((q: { id: string }) => q.id === 'screech-shooter-major-rune-grade'),
      'the copy the gate is pointed at holds no unanswered entry for that record',
    ).toBe(false);
    writeFileSync(join(CLI_ROOT, rel), JSON.stringify(desk));
    try {
      expect(queuedFor('screech-shooter-major', rel)).toBe('');
      expect(widened(rel)['screech-shooter-major']).toBeUndefined();
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
  it('a desk id that is ITSELF a record parks only itself — `adamantine-echo` never parks `adamantine`', () => {
    /*
     * The anti-over-park direction, which is what the `is not itself a record id` clause buys. Over the
     * whole desk the bare prefix rule parks 57 records nobody queued; a desk id that is itself a record
     * answers for that record alone.
     *
     * The three fixtures this case used (weapon/weapon-expertise, divine/divine-font,
     * instinct/instinct-ability) were all answered in the 2026-09-10 desk pass and are `ruled` now, so
     * they park nothing at all and prove nothing either way. The live pair is the deferred relic family:
     * #62 `adamantine-echo` is a record AND has the shorter record `adamantine` as a prefix.
     */
    const desk = JSON.parse(readFileSync(join(CLI_ROOT, DESK), 'utf8').replace(/^﻿/, ''));
    const ids = [...desk.open, ...desk.deferred].map((q: { id: string }) => q.id);
    expect(ids).toContain('adamantine-echo');          // the near-match is really on the desk
    expect(queuedFor('adamantine')).toBe('');          // …and parks nothing but its own record
    expect(queuedFor('adamantine-echo')).toBe('adamantine-echo');
    /*
     * The same clause from the other side: #63 `spectacles-of-understanding` and #64
     * `spectacles-of-understanding-greater` are BOTH on the desk and both are records, so the base
     * record must resolve to its own entry and never to the longer one sitting next to it.
     */
    expect(ids).toContain('spectacles-of-understanding-greater');
    expect(queuedFor('spectacles-of-understanding')).toBe('spectacles-of-understanding');
  });

  // batch 035: animal-instinct#spider-web
  // batch 037: screech-shooter-major#grade-numbers
  // batch 037 premise: feat-8166 "Your Speed increases by 5 feet for each mode of movement available to you."
  it('the widening is exactly six records — the five still-open aspect keys and the deferred relic family', () => {
    /*
     * The pin against silent growth. `--queued-parks` lists every record parked by a desk id that is
     * not its own; today that is five, and each is deliberate:
     *
     *   screech-shooter-major  ← #151 screech-shooter-major-rune-grade   aspect: print states a rune
     *                                                                    grade for the base and greater
     *                                                                    shooter and is SILENT for the
     *                                                                    major, so it cannot be invented
     *   timewracked-dedication ← #153 timewracked-dedication-speed-clause  aspect: feat-8166's "for each
     *                                                                    mode of movement available to
     *                                                                    you" reads two ways and the
     *                                                                    shipped flat +5 is neither
     *   speed                  ← #154 speed-plural-while-a-state-is-on   LANE question, loose
     *   flexible-spellcaster   ← #155 flexible-spellcaster-book-casters  aspect, LONGEST wins (not `flexible`)
     *   spell-parry            ← #161 spell-parry-badge                  aspect: the 2026-09-12 repoint
     *                                                                    moved it to feat-9049, which
     *                                                                    reprints the Secrets of Magic
     *                                                                    text unchanged but carries no
     *                                                                    action badge on either printing
     *   relic                  ← #58  relic-gift-family-…-adamantine     LANE question, loose, deferred
     *
     * `speed` and `relic` are accepted rather than fixed: neither has ever been cut into a batch, so the
     * park is inert, and narrowing the rule to exclude them would need the desk to mark lane questions
     * as lane questions — which is the owner's file, not this gate's. They are pinned so the widening
     * can never grow past them without a test failing.
     *
     * WAS SEVEN until 2026-09-11, and the two that left are the desk working (see the header): #145
     * `animal-instinct-spider-web` and `dream-magic-second-taking` were both answered in the owner's
     * 2026-09-10 pass and are `ruled`. The two that CHANGED key are the same story one level down —
     * `flexible-spellcaster-collection-shape` and `speed-status-lane-031` were answered, and the
     * still-open #155 and #154 took over the same two records. The count is stable at five either way.
     *
     * `spore-order` and `cultivation-order` are not here and no longer park at all: both were answered
     * in the same pass. They USED to be the demonstration that an exact desk id beats a prefix; that
     * demonstration now lives on `adamantine-echo` in the case above.
     */
    // batch 037: screech-shooter-major#grade-numbers
    // batch 037 premise: feat-8166 "Your Speed increases by 5 feet for each mode of movement available to you."
    /* The six pairs are the pin: nothing may widen past them silently. WHICH of them is still parked
     * is the desk's business, so the expectation drops a pair the moment its question is answered —
     * the same thing the header records happening twice already (#145, dream-magic), written once
     * instead of re-edited every desk pass. An UNKNOWN pair still fails: it is not in this table. */
    const PARKS: Record<string, string> = {
      'flexible-spellcaster': 'flexible-spellcaster-book-casters',
      'screech-shooter-major': 'screech-shooter-major-rune-grade',
      'timewracked-dedication': 'timewracked-dedication-speed-clause',
      speed: 'speed-plural-while-a-state-is-on',
      'spell-parry': 'spell-parry-badge',
      relic: 'relic-gift-family-skysunder-sparkwarden-uniter-adamantine',
    };
    const deskNow = JSON.parse(readFileSync(join(CLI_ROOT, DESK), 'utf8').replace(/^﻿/, ''));
    const unanswered = new Set(
      (['open', 'deferred'] as const).flatMap((a) => ((deskNow[a] ?? []) as { id?: string }[]).map((q) => q.id)),
    );
    expect(widened()).toEqual(Object.fromEntries(Object.entries(PARKS).filter(([, q]) => unanswered.has(q))));
    expect(queuedFor('flexible')).toBe('');
    /* Answered 2026-09-10, so parked no longer — asserted rather than deleted, because a record that
     * silently stopped being parked for any OTHER reason is exactly the bug this file watches for. */
    expect(queuedFor('spore-order')).toBe('');
    expect(queuedFor('cultivation-order')).toBe('');
    const ruledIds = ((JSON.parse(readFileSync(join(CLI_ROOT, DESK), 'utf8').replace(/^﻿/, '')).ruled ?? []) as { id: string }[]).map((q) => q.id);
    for (const id of ['spore-order', 'cultivation-order', 'dream-magic-second-taking']) expect(ruledIds).toContain(id);
    /* Item 4 of this group's brief: the UNSUPPORTED branch test/batch035-instruments-1.test.ts pins
     * stays byte-identical through the resolver change. */
    expect(GATE_SRC).toContain("if (r.verdict === 'UNSUPPORTED') { unsupported.push(r.id); continue; }");
  });
});
