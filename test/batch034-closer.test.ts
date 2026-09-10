/*
 * BATCH 034 — CLOSER. Two comparer credits the gate demanded and neither family owned.
 *
 * Both run the REAL comparer as a node child, one against a STUNTED copy of public/core.json (through
 * `--core`, the anti-laundering hook), because a settle that survives its carrier being deleted is a
 * settle that hides a gap rather than recording a decision.
 *
 * ⚠ `--raw` bypasses the settle registries: a run WITHOUT it is what proves a settle still leaves the
 * record watched, which is the whole point of the stunted case below.
 */
import { describe, expect, it, vi } from 'vitest';
import { CHILD_TIMEOUT } from './_timeouts';
vi.setConfig({ testTimeout: CHILD_TIMEOUT, hookTimeout: CHILD_TIMEOUT });
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { INVENTOR_TIER_LEVEL, inventorModificationOptions } from '../src/rules/build';
import { content } from './_content';

const CLI_ROOT = join(__dirname, '..');
type Core = Record<string, any>;
const CORE: Core = JSON.parse(readFileSync(join(CLI_ROOT, 'public/core.json'), 'utf8'));

/** wg-diff has no `--ids`: it is corpus-wide by construction, so it is run to a file and indexed. */
function diffRows(args: string[] = [], tag = 'base'): Map<string, Core> {
  const rel = `work/.b034c-diff-${tag}.json`;
  try {
    execFileSync(process.execPath, [join(CLI_ROOT, 'scripts/wg-diff.mjs'), '--out', rel, ...args], {
      cwd: CLI_ROOT, encoding: 'utf8', maxBuffer: 1 << 28,
    });
    const j: Core = JSON.parse(readFileSync(join(CLI_ROOT, rel), 'utf8'));
    const idx = new Map<string, Core>();
    for (const bucket of ['theyOnly', 'weOnly', 'agree']) for (const r of j[bucket] as Core[]) idx.set(r.id, { ...r, bucket });
    return idx;
  } finally {
    rmSync(join(CLI_ROOT, rel), { force: true });
  }
}

/** Run something against a copy of public/core.json with one carrier removed. */
function stuntedCore<T>(tag: string, mutate: (core: Core) => void, run: (coreArg: string[]) => T): T {
  const rel = `work/.b034c-stunt-${tag}.json`;
  const copy: Core = JSON.parse(JSON.stringify(CORE));
  mutate(copy);
  expect(JSON.stringify(copy)).not.toBe(JSON.stringify(CORE));   // the stunt must actually bite
  writeFileSync(join(CLI_ROOT, rel), JSON.stringify(copy));
  try {
    return run(['--core', rel]);
  } finally {
    rmSync(join(CLI_ROOT, rel), { force: true });
  }
}

const ORDERS = ['animal-order', 'leaf-order', 'storm-order', 'untamed-order', 'wave-order'] as const;

/* ================================================================== *
 * SETTLE — MAIN_DRUID_ORDER is their engine writing down a subclass pick
 * ================================================================== */

describe('batch 034 closer — animal-order, leaf-order, storm-order, untamed-order and wave-order settle `specialStat` and nothing else', () => {
  /*
   * `node scripts/wg-show.mjs "Animal Order" --raw` (and Leaf / Storm / Untamed / Wave in turn) leaves
   * exactly one operation unmatched: `createValue MAIN_DRUID_ORDER = animal | leaf | storm | untamed |
   * wild`, type=str — which their own conditionals then read straight back
   * (`IF MAIN_DRUID_ORDER EQUALS animal THEN adjValue SKILL_ATHLETICS`, `… THEN giveSpell FOCUS`).
   * Print makes the order a subclass, not a statistic, and ours is that subclass:
   * classes.druid.subclass.options[<order>], selected into `build.subclassId`. Batch 033 settled the
   * same single operation for flame-order, spore-order and stone-order; these five are the orders this
   * batch cut, one entry each.
   *
   * mutation-proof — the danger of a VERIFIED_EQUIVALENT key is that it is keyed by RECORD, so it could
   * quietly cover a real gap on the same record. Stunting the carrier proves it does not: with each
   * order option's `grants.skills`, `focusSpells` and `grantedFeats` deleted, the SETTLED run (no
   * `--raw`) reports skill, spell and grantsRecord on all five — and still not `specialStat`, which is
   * the one thing these entries are allowed to silence. cultivation-order WAS the control: the same
   * printed shape, deliberately NOT in the registry. Batch 035 checked its grants and cut it too, so
   * the control is retired here — the stunt below is what still keeps the five entries honest.
   */
  // batch 034 premise: class-feature-668 "Upon becoming a druid, you align yourself with a druidic order, which grants you a class feat, an order spell (see below), and an additional trained skill tied to your order."
  // batch 035: cultivation-order#instrument
  it('the five settled orders are clear on the shipped data, and cultivation-order is settled too', () => {
    const shipped = diffRows([], 'orders-shipped');
    for (const id of ORDERS) expect(shipped.get(id)?.missing).toEqual([]);
    /* batch 035 cut the ninth order (VERIFIED_EQUIVALENT['cultivation-order'] = ['specialStat'] in
     * scripts/wg-diff.mjs); its own mutation-proof stunt is in test/batch035-instruments-1.test.ts. */
    // batch 035: cultivation-order#instrument
    expect(shipped.get('cultivation-order')?.missing).toEqual([]);
  });

  // batch 034 premise: class-feature-668 "Upon becoming a druid, you align yourself with a druidic order, which grants you a class feat, an order spell (see below), and an additional trained skill tied to your order."
  it('with the order options stunted, every settled order reports its real kinds again and never `specialStat`', () => {
    const stunted = stuntedCore('orders', (c) => {
      for (const o of c.classes.druid.subclass.options as Core[]) {
        if ((ORDERS as readonly string[]).includes(o.id)) { delete o.grants; delete o.focusSpells; delete o.grantedFeats; }
      }
    }, (core) => diffRows(core, 'orders-stunt'));
    for (const id of ORDERS) {
      const missing: string[] = stunted.get(id)?.missing ?? [];
      /* `skill` is their SKILL_* adjValue, `spell` their order focus spell. `grantsRecord` is NOT
       * asserted: an order's class feat is also reachable off the option, so deleting `grantedFeats`
       * alone does not take it away — asserting it here would be a claim this stunt does not prove. */
      expect(missing).toEqual(expect.arrayContaining(['skill', 'spell']));
      expect(missing).not.toContain('specialStat');
    }
  });
});

/* ================================================================== *
 * THE SETTLE REGISTRIES STATE DECISIONS, NOT PENDING WORK
 * ================================================================== */

describe('batch 034 closer — the way-of-the-pistolero note in wg-identity records a landed row, not a promise', () => {
  /*
   * The note above SETTLED_IDENTITIES said the record "keeps reporting until that row lands" and
   * pointed at a work/ verify file — written while the row was still a spec. The row landed in this
   * batch (classFeatures/pistoleros-retort name/aonId/edition -> the remaster deed), so the sentence
   * was describing work that no longer exists, and wg-settle-audit read its filename as the hedge word
   * "verify" and failed gate 6 for the whole batch. A registry comment is part of the justification a
   * settle stands on; a stale one is exactly what the hedge audit exists to catch.
   */
  // batch 034: way-of-the-pistolero
  it('way-of-the-pistolero: the retagged deed is in the overlay and the registry states a decision', () => {
    const deed = CORE.classFeatures['pistoleros-retort'];
    expect(deed.name).toBe("Pistoler's Retort");
    expect(deed.aonId).toBe('action-912');
    expect(deed.edition).toBe('remaster');
    // batch 034: way-of-the-pistolero
    // The record is NOT settled — the two sides agree because the data changed.
    const src = readFileSync(join(CLI_ROOT, 'scripts/wg-identity.mjs'), 'utf8');
    expect(src).not.toContain("'way-of-the-pistolero':");
    expect(src).not.toMatch(/keeps\s+\*?\s*reporting until that row lands/);
  });

  // batch 034: way-of-the-pistolero
  it('way-of-the-pistolero: no settle anywhere is justified with a hedge', () => {
    // wg-settle-audit exits non-zero on a hedge word in any of the three registries; gate 6 is this run.
    expect(() => execFileSync(process.execPath, [join(CLI_ROOT, 'scripts/wg-settle-audit.mjs')], {
      cwd: CLI_ROOT, encoding: 'utf8', maxBuffer: 1 << 26,
    })).not.toThrow();
  });
});

/* ================================================================== *
 * OFF-RECORD CARRIER — the innovation's tier pickers are the gate AND the choice
 * ================================================================== */

describe('batch 034 closer — weapon-innovation credits its off-record tier pickers', () => {
  /*
   * WG holds four `conditional`s on this row, each wrapping one `select optionType=ABILITY_BLOCK`
   * (IF CLASS_NAMES INCLUDES inventor / IF CLASS_FEATURE_NAMES INCLUDES breakthrough innovation /
   * … revolutionary innovation / IF FEAT_NAMES INCLUDES basic modification). The core.json record
   * carries no field at all beyond identity, so both kinds read as missing. The carrier is
   * `inventorModificationOptions` plus the three per-tier PopupSelects at
   * src/builder/shared.tsx:3582-3600, where the level gate and the picker are one mechanism — which is
   * why both `conditional` and `choice` are credited and not just `choice`.
   *
   * OFF_RECORD_CARRIERS is not one of the audited settle registries, so no `mutation-proof` marker is
   * owed here; what is owed is proof that the carrier is LIVE (a credit for a dead field is a
   * laundering) and that the credit is per id rather than a rule.
   */
  // batch 034 premise: innovation-3 "Choose one initial weapon modification to apply to your innovation, either from the following or from other initial weapon modifications to which you have access."
  it('weapon-innovation offers a real pick at each of the three printed tiers', () => {
    const db = content();
    const tiers = (['initial', 'breakthrough', 'revolutionary'] as const).map(
      (t) => inventorModificationOptions(db, 'weapon', undefined, INVENTOR_TIER_LEVEL[t]).length,
    );
    for (const n of tiers) expect(n).toBeGreaterThan(0);
    // Their four gates are level gates: a higher tier can only ever offer more, never fewer.
    expect(tiers[0]).toBeLessThanOrEqual(tiers[1]);
    expect(tiers[1]).toBeLessThanOrEqual(tiers[2]);
  });

  // batch 034 premise: innovation-3 "Choose one initial weapon modification to apply to your innovation, either from the following or from other initial weapon modifications to which you have access."
  it('the credit is written per id, not as a rule over every innovation', () => {
    const src = readFileSync(join(CLI_ROOT, 'scripts/wg-diff.mjs'), 'utf8');
    expect(src).toContain("'weapon-innovation': ['conditional', 'choice'],");
    /* Every innovation type is credited on its own line for its own kinds — armor-innovation's is
     * ['choice','grantsItem','conditional'], light-mortar-innovation's is ['choice'] alone. A rule
     * keyed on the shared `inventor-innovation` tag would have made them identical and swept in
     * construct-innovation, whose kinds this batch closed with DATA rows and which is deliberately
     * absent from the registry. */
    expect(src).toContain("'armor-innovation': ['choice', 'grantsItem', 'conditional'],");
    expect(src).toContain("'light-mortar-innovation': ['choice'],");
    expect(src).not.toContain("'construct-innovation': [");
  });
});
