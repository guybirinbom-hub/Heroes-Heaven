/**
 * BATCH 039 — THE CLOSER'S ONE FIX: a desk question filed under a FINDING id parks its record.
 *
 * familiar#archetype-reach (AoN feat-5024 prints "Archetypes Elementalist (Level 4), Shadowcaster
 * (Level 4), Soul Warden (Level 4)") needs a class-feat-via-archetype lane the app does not have, so
 * the family parked it with desk #164, and add-owner-question.mjs filed that desk entry under the
 * finding id `familiar#archetype-reach`. Both resolvers missed it:
 *
 *   - scripts/wg-batch-close.mjs keyed `queued` / `desk` by the exact question id, so the close
 *     refused "uncited NEW verdict — familiar" instead of deriving OWNER-QUEUED #164;
 *   - scripts/wg-batch-gate.mjs parkMapOf only walked hyphens, so PARITY refused that OWNER-QUEUED
 *     verdict as "no usable verdict".
 *
 * Both now strip a `#aspect` suffix. Each half is pinned on the real desk shape AND on a stunted copy
 * with the entry removed, so the park follows the entry and nothing else.
 */
import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CHILD_TIMEOUT } from './_timeouts';

vi.setConfig({ testTimeout: CHILD_TIMEOUT, hookTimeout: CHILD_TIMEOUT });

const CLI_ROOT = join(__dirname, '..');
const CLOSE = join(CLI_ROOT, 'scripts/wg-batch-close.mjs');
const GATE = join(CLI_ROOT, 'scripts/wg-batch-gate.mjs');
const QID = 'familiar#archetype-reach';

function close(root: string): { code: number; out: string } {
  try {
    return { code: 0, out: execFileSync(process.execPath, [CLOSE, '--root', root, '--batch', '900', '--write'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

/** Batch 900 holding one record, familiar, whose only finding is unbuilt and queued (or not). */
function fixture(desk: unknown): string {
  const root = mkdtempSync(join(tmpdir(), 'wg-close-039-'));
  mkdirSync(join(root, 'work'), { recursive: true });
  const files: Record<string, unknown> = {
    'work/wg-batch-900.json': [{ bucket: 'feats', id: 'familiar', name: 'Familiar', level: 1 }],
    'work/.b900-read.json': {
      confirmed: [{ id: QID, claim: 'no class-feat-via-archetype lane', playerVisible: true, verdict: 'CONFIRMED', proposal: 'owner question' }],
      refuted: [],
      askOwner: [],
    },
    'work/.b900-specs.json': [{ file: 'work/.b900-rows-x.json', kind: 'rows', family: 'x', stage: ['work/.b900-rows-x.json'] }],
    'work/.b900-rows-x.json': { findings: [] },
    'work/owner-questions.json': desk,
  };
  for (const [rel, body] of Object.entries(files)) writeFileSync(join(root, rel), JSON.stringify(body, null, 1));
  return root;
}

describe('batch 039 closer — familiar: a desk entry filed as familiar#archetype-reach parks the record', () => {
  // batch 039: familiar#archetype-reach
  it('wg-batch-close derives familiar OWNER-QUEUED with desk #164 from a record#aspect desk id', () => {
    const root = fixture({ open: [{ id: QID, batch: 900, n: 164 }], deferred: [], ruled: [] });
    try {
      const r = close(root);
      expect(r.code, r.out).toBe(0);
      const parity = JSON.parse(readFileSync(join(root, 'work/wg-batch-900-parity.json'), 'utf8'));
      const fam = parity.records.find((x: { id: string }) => x.id === 'familiar');
      expect(fam.verdict).toBe('OWNER-QUEUED');
      expect(fam.evidence).toContain('#164');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // batch 039: familiar#archetype-reach
  it('with the familiar#archetype-reach entry removed (or only ruled), the close refuses familiar again', () => {
    // mutation-proof — stunts the desk key familiar#archetype-reach: the park must follow the entry.
    for (const desk of [
      { open: [], deferred: [], ruled: [] },
      { open: [], deferred: [], ruled: [{ id: QID, batch: 900, n: 164 }] },
    ]) {
      const root = fixture(desk);
      try {
        const r = close(root);
        expect(r.code).toBe(1);
        expect(r.out).toContain('uncited NEW verdict');
        expect(r.out).toContain('familiar');
        expect(existsSync(join(root, 'work/wg-batch-900-parity.json'))).toBe(false);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  // batch 039: familiar#archetype-reach
  it('wg-batch-gate queuedFor("familiar") resolves to familiar#archetype-reach, and to nothing on a desk without it', () => {
    // mutation-proof — stunts the desk key familiar#archetype-reach in a COPY of the desk.
    const desk = JSON.parse(readFileSync(join(CLI_ROOT, 'work/owner-questions.json'), 'utf8').replace(/^﻿/, ''));
    const probe = (rel: string) =>
      execFileSync(process.execPath, [GATE, '--batch', 'work/wg-batch-039.json', '--queue', rel, '--queued-for', 'familiar'], {
        cwd: CLI_ROOT, encoding: 'utf8', maxBuffer: 1 << 26,
      }).trim();
    const tag = `${process.pid}-${Math.random().toString(36).slice(2)}`;
    const withIt = `work/.b039closer-desk-with-${tag}.json`;
    const without = `work/.b039closer-desk-without-${tag}.json`;
    const keep = { ...desk, open: [...(desk.open ?? []).filter((q: { id: string }) => q.id !== QID), { id: QID, batch: 39, n: 164 }] };
    const gone = (q: { id: string }) => q.id !== QID;
    const stunted = { ...desk, open: (desk.open ?? []).filter(gone), deferred: (desk.deferred ?? []).filter(gone) };
    writeFileSync(join(CLI_ROOT, withIt), JSON.stringify(keep));
    writeFileSync(join(CLI_ROOT, without), JSON.stringify(stunted));
    try {
      expect(probe(withIt)).toBe(QID);
      expect(probe(without)).toBe('');
    } finally {
      rmSync(join(CLI_ROOT, withIt), { force: true });
      rmSync(join(CLI_ROOT, without), { force: true });
    }
  });
});
