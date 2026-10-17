import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  hasSituationalField,
  registryKeys,
  situationalApprovalCount,
  unreachedSituationalApprovals,
} from '../scripts/lib/situational-approval-reach.mjs';

/**
 * scripts/trust-ledger-check.mjs check 6b — "every `situational` approval reaches a star" (package I, desk #163).
 *
 * Desk #163 approved three starred notes (Energy Shot, Fulminating Shot, Dispelling Bullet) on 2026-10-15, and for two
 * days nothing stood behind any of them: no FEAT_SITUATIONAL key, no record field. test/trust-approvals.test.ts and the
 * ledger stayed green because both only ask whether the approval's PATH is real. This asks whether the NOTE is.
 *
 * Every leg below plants its bad case on a throwaway source and corpus: the registry text is a string, the corpus is an
 * object literal, so nothing in the repo is touched. The last leg reads the real files.
 */

/** A registry source in the shape of src/rules/situationalBonuses.ts (CRLF, like the real file). */
const SOURCE = [
  'export const FEAT_SITUATIONAL: Record<string, SituationalBonus[]> = {',
  '  "point-blank-stance": [{ targets: [{ kind: \'strikeDamage\' }], when: "x", bonus: "y" }],',
  '  rage: [{ targets: [{ kind: \'strikeDamage\' }], when: "x", bonus: "y" }],',
  '',
  '  // ---- generated ----',
  '  "later-entry": [',
  '    { targets: [{ kind: \'perception\' }], when: "x", bonus: "y" },',
  '  ],',
  '};',
  '',
  'export const CHOICE_SITUATIONAL: Record<string, ChoiceSituational[]> = {',
  '  "cat-answers": [{ answer: "a", rows: [] }],',
  '};',
  '',
  'const NOT_A_REGISTRY = {',
  '  "decoy-entry": [1],',
  '};',
].join('\r\n');

const approvals = (...rows: object[]) => ({ approvals: rows });
const row = (n: number, record: string, fields = ['situational'], extra: object = {}) => ({ n, record, fields, ...extra });
const unreached = (a: ReturnType<typeof approvals>, core: Record<string, Record<string, unknown>> = {}, src = SOURCE) =>
  unreachedSituationalApprovals({ approvals: a, core, registrySource: src });

describe('registryKeys — the same scrape scripts/trust-ledger.mjs does', () => {
  it('reads quoted and bare keys of the named table only, across CRLF line endings and a multi-line value', () => {
    expect(registryKeys(SOURCE, 'FEAT_SITUATIONAL')).toEqual(['point-blank-stance', 'rage', 'later-entry']);
    expect(registryKeys(SOURCE, 'CHOICE_SITUATIONAL')).toEqual(['cat-answers']);
  });

  it('a renamed or deleted table scrapes to nothing (and so every approval is reported, never silently reached)', () => {
    expect(registryKeys(SOURCE, 'NO_SUCH_TABLE')).toEqual([]);
    expect(unreached(approvals(row(1, 'feats/rage')), {}, SOURCE.replace('FEAT_SITUATIONAL', 'RENAMED'))).toEqual(['#1 feats/rage']);
  });
});

describe('unreachedSituationalApprovals', () => {
  it('an approval with a registry key behind it reaches (any bucket: the registry is keyed by the bare id)', () => {
    expect(unreached(approvals(row(1, 'classFeatures/rage'), row(2, 'feats/point-blank-stance'), row(3, 'feats/later-entry'), row(4, 'feats/cat-answers')))).toEqual([]);
  });

  it('PLANTED: an approval with no star anywhere is reported by desk number and record', () => {
    expect(unreached(approvals(row(163, 'classFeatures/energy-shot'), row(1, 'classFeatures/rage')))).toEqual(['#163 classFeatures/energy-shot']);
  });

  it('a prefix or a decoy table does not count: the key must be the whole bare id, in one of the two registries', () => {
    expect(unreached(approvals(row(7, 'feats/rag'), row(8, 'feats/point-blank'), row(9, 'feats/decoy-entry')))).toEqual([
      '#7 feats/rag',
      '#8 feats/point-blank',
      '#9 feats/decoy-entry',
    ]);
  });

  it('a `situational` field on the record counts, at any depth; an empty one does not', () => {
    const core = {
      feats: {
        'top-level': { situational: [{ when: 'x' }] },
        'nested': { choice: { options: [{ grant: { situational: [{ when: 'x' }] } }] } },
        'empty-list': { situational: [] },
        'bare-record': { name: 'x' },
      },
    };
    expect(unreached(approvals(row(1, 'feats/top-level'), row(2, 'feats/nested'), row(3, 'feats/empty-list'), row(4, 'feats/bare-record'), row(5, 'feats/missing')), core)).toEqual([
      '#3 feats/empty-list',
      '#4 feats/bare-record',
      '#5 feats/missing',
    ]);
  });

  it('only `situational` approvals are asked, and a pending one is exempt (its record is not created yet)', () => {
    expect(unreached(approvals(row(1, 'feats/nothing-here', ['speeds']), row(2, 'feats/not-yet', ['situational'], { pending: true })))).toEqual([]);
    expect(situationalApprovalCount(approvals(row(1, 'a/b', ['speeds']), row(2, 'a/c', ['situational'], { pending: true }), row(3, 'a/d', ['grantsActions', 'situational'])))).toBe(1);
  });

  it('hasSituationalField stops on a cycle-free depth limit and ignores primitives', () => {
    expect(hasSituationalField(null)).toBe(false);
    expect(hasSituationalField('situational')).toBe(false);
    expect(hasSituationalField({ a: { b: { c: { situational: { when: 'x' } } } } })).toBe(true);
  });
});

describe('the shipped files', () => {
  it('every non-pending `situational` approval in scripts/data/trust-approvals.json has a star behind it today', () => {
    const shipped = JSON.parse(readFileSync('scripts/data/trust-approvals.json', 'utf8'));
    const core = JSON.parse(readFileSync('public/core.json', 'utf8').replace(/^﻿/, ''));
    const registrySource = readFileSync('src/rules/situationalBonuses.ts', 'utf8');
    expect(situationalApprovalCount(shipped)).toBeGreaterThanOrEqual(25);
    expect(unreachedSituationalApprovals({ approvals: shipped, core, registrySource })).toEqual([]);
  });

  it('the three desk #163 approvals are the proof the check can see: remove their keys from the real source and they are reported', () => {
    const shipped = JSON.parse(readFileSync('scripts/data/trust-approvals.json', 'utf8'));
    const core = JSON.parse(readFileSync('public/core.json', 'utf8').replace(/^﻿/, ''));
    const real = readFileSync('src/rules/situationalBonuses.ts', 'utf8');
    // planted, in memory only: the three entries' keys renamed so no registry key spells them
    const planted = real
      .replace(/^ {2}"energy-shot":/m, '  "energy-shot-x":')
      .replace(/^ {2}"fulminating-shot":/m, '  "fulminating-shot-x":')
      .replace(/^ {2}"dispelling-bullet":/m, '  "dispelling-bullet-x":');
    expect(planted).not.toBe(real);
    expect(unreachedSituationalApprovals({ approvals: shipped, core, registrySource: planted }).sort()).toEqual([
      '#163 classFeatures/dispelling-bullet',
      '#163 classFeatures/energy-shot',
      '#163 feats/fulminating-shot',
    ]);
  });
});
