/*
 * scripts/foundry-ui-text-check.mjs — no shipped text tells the player to use Foundry VTT's editor
 * (package I, item I6f, 2026-10-17).
 *
 * The 19 Foundry-era "Scroll of Nth-rank Spell" and "Magic Wand (Nth-rank Spell)" records ended with
 * "Note: To create a scroll or wand of a specific spell, drag the spell from the compendium or compendium
 * browser into the inventory of a PC, NPC, or loot actor." Overlay description rows removed it; this file
 * holds that closed. Each guard is shown red on a planted bad case and green on the clean fixture, at three
 * depths (a flat description, a nested note string, an overlay row's value), in process and through the real
 * script against scratch copies (--root), never the tree.
 *
 * Synthetic records only (ids zz-fui-*) beside the real shipped data.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CHILD_TIMEOUT } from './_timeouts';
import { baselineProblems, foundryUiOffenders, foundryUiPhrase } from '../scripts/foundry-ui-text-check.mjs';

vi.setConfig({ testTimeout: CHILD_TIMEOUT, hookTimeout: CHILD_TIMEOUT });

const ROOT = resolve(__dirname, '..');
const SCRIPT = join(ROOT, 'scripts/foundry-ui-text-check.mjs');
const NOTE =
  '*Note: To create a scroll or wand of a specific spell, drag the spell from the compendium or compendium browser into the inventory of a PC, NPC, or loot actor.*';

type Json = Record<string, unknown>;
const readJson = (p: string): Json => JSON.parse(readFileSync(join(ROOT, p), 'utf8').replace(/^﻿/, ''));

/** Scratch trees for the CLI cases: tiny copies of the four files the script reads. */
let scratch = '';
beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'fui-check-'));
});
afterAll(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});
let n = 0;
function tree(parts: { core?: Json; descriptions?: Json; overlay?: unknown[]; baseline?: string[] }): string {
  const dir = join(scratch, `t${++n}`);
  mkdirSync(join(dir, 'public'), { recursive: true });
  mkdirSync(join(dir, 'scripts/data'), { recursive: true });
  writeFileSync(join(dir, 'public/core.json'), JSON.stringify(parts.core ?? {}));
  writeFileSync(join(dir, 'public/core-descriptions.json'), JSON.stringify(parts.descriptions ?? {}));
  writeFileSync(join(dir, 'scripts/data/effect-backfill.json'), JSON.stringify(parts.overlay ?? []));
  writeFileSync(join(dir, 'scripts/data/foundry-ui-text-baseline.json'), JSON.stringify({ records: parts.baseline ?? [] }));
  return dir;
}
const run = (root: string) => spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });

describe('the phrase list: Foundry editor instructions, never a bare common word', () => {
  it('matches the editor note and the other Foundry-UI phrases', () => {
    expect(foundryUiPhrase(NOTE)).toBe('compendium browser');
    expect(foundryUiPhrase('drag the spell from the compendium into the inventory')).toBeTruthy();
    expect(foundryUiPhrase('Place it in a loot actor.')).toBe('loot actor');
    expect(foundryUiPhrase('The button above toggles the stance.')).toBe('The button above');
    expect(foundryUiPhrase('The effect linked here applies the bonus.')).toBe('The effect linked here');
    expect(foundryUiPhrase('For Foundry automation, use the rule element.')).toBe('Foundry automation');
    expect(foundryUiPhrase('The automation for this is unreliable.')).toBe('The automation for');
    expect(foundryUiPhrase('It cannot reference data from another actor.')).toBe('cannot reference data from another actor');
  });

  it('stays quiet on the real names and prose that merely say compendium or automated', () => {
    expect(foundryUiPhrase('Undead Compendium')).toBeNull();
    expect(foundryUiPhrase('Fulu Compendium')).toBeNull();
    expect(foundryUiPhrase('A compendium of journals costs five times as much as a single journal.')).toBeNull();
    expect(foundryUiPhrase('the spell die and the doubling are not automated')).toBeNull();
  });

  it('stays quiet on the shipped Undead Compendium, scholarly-journal and Scouring Spark text', () => {
    const core = readJson('public/core.json') as Record<string, Record<string, Json>>;
    const descriptions = readJson('public/core-descriptions.json') as Record<string, Record<string, { d?: string }>>;
    for (const id of ['undead-compendium', 'fulu-compendium', 'scholarly-journal', 'scholarly-journal-compendium']) {
      expect(foundryUiPhrase(String(descriptions.items[id]?.d ?? '')), `items/${id} description`).toBeNull();
      expect(foundryUiPhrase(String(core.items[id]?.name ?? '')), `items/${id} name`).toBeNull();
    }
    expect(JSON.stringify((core.modes as unknown as Record<string, Json>)['scouring-spark'])).toMatch(/not automated/);
    expect(foundryUiPhrase(JSON.stringify((core.modes as unknown as Record<string, Json>)['scouring-spark']))).toBeNull();
  });
});

describe('foundryUiOffenders reads three depths and names where it found the phrase', () => {
  it('a flat description in core-descriptions.json goes red; the same record without the note is green', () => {
    const bad = foundryUiOffenders({
      core: { items: { 'zz-fui-scroll': { name: 'Planted Scroll' } } },
      descriptions: { items: { 'zz-fui-scroll': { d: `A scroll.\n\n---\n\n${NOTE}` } } },
      overlay: [],
    });
    expect(Object.keys(bad)).toEqual(['items/zz-fui-scroll']);
    expect(bad['items/zz-fui-scroll'].where).toMatch(/core-descriptions\.json/);
    const clean = foundryUiOffenders({
      core: { items: { 'zz-fui-scroll': { name: 'Planted Scroll' } } },
      descriptions: { items: { 'zz-fui-scroll': { d: 'A scroll.' } } },
      overlay: [],
    });
    expect(clean).toEqual({});
  });

  it('a note string nested inside effectChoices goes red, and the path says where', () => {
    const found = foundryUiOffenders({
      core: {
        feats: {
          'zz-fui-feat': { name: 'Planted Feat', effectChoices: [{ id: 'a', options: [{ id: 'o', note: 'The button above toggles the effect.' }] }] },
          'zz-fui-ok': { name: 'Fine Feat', effectChoices: [{ id: 'a', options: [{ id: 'o', note: 'Toggle this when you start raging.' }] }] },
        },
      },
      descriptions: {},
      overlay: [],
    });
    expect(Object.keys(found)).toEqual(['feats/zz-fui-feat']);
    expect(found['feats/zz-fui-feat'].where).toContain('effectChoices[0].options[0].note');
  });

  it("an overlay row's value goes red, so a future row cannot bring the note back; its `why` quoting the note does not", () => {
    const found = foundryUiOffenders({
      core: {},
      descriptions: {},
      overlay: [
        { category: 'items', id: 'zz-fui-row', field: 'description', value: `A wand.\n\n${NOTE}`, why: 'ok' },
        { category: 'items', id: 'zz-fui-created', create: true, value: { id: 'zz-fui-created', description: 'Use the loot actor.' } },
        { category: 'items', id: 'zz-fui-removal', field: 'description', value: 'A wand.', why: `Removes "${NOTE}" — Foundry VTT's editor instruction.` },
      ],
    });
    expect(Object.keys(found).sort()).toEqual(['items/zz-fui-created', 'items/zz-fui-row']);
    expect(found['items/zz-fui-row'].where).toMatch(/effect-backfill\.json row/);
  });
});

describe('the baseline only shrinks', () => {
  const hit = { phrase: 'the button above', where: 'core.json' };
  it('a new offender fails, naming the fix', () => {
    const problems = baselineProblems({ 'items/zz-fui-new': hit }, { records: [] });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('items/zz-fui-new');
    expect(problems[0]).toMatch(/never add the record/);
  });
  it('a listed record that is now clean fails until its entry is removed', () => {
    const problems = baselineProblems({}, { records: ['items/zz-fui-gone'] });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/no longer carries Foundry editor text/);
  });
  it('a listed offender that is still there is quiet', () => {
    expect(baselineProblems({ 'items/zz-fui-known': hit }, { records: ['items/zz-fui-known'] })).toEqual([]);
  });
});

describe('the real script, against scratch trees', () => {
  it('exits 1 on a planted flat description, naming the record and the baseline rule', () => {
    const r = run(tree({ core: { items: { 'zz-fui-scroll': { name: 'Planted' } } }, descriptions: { items: { 'zz-fui-scroll': { d: NOTE } } } }));
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('items/zz-fui-scroll');
    expect(r.stdout).toContain('compendium browser');
  });
  it('exits 1 on a planted nested note and on a planted overlay row', () => {
    const nested = run(tree({ core: { feats: { 'zz-fui-nested': { effectChoices: [{ note: 'The effect linked here does the work.' }] } } } }));
    expect(nested.status).toBe(1);
    expect(nested.stdout).toContain('feats/zz-fui-nested');
    const row = run(tree({ overlay: [{ category: 'items', id: 'zz-fui-row', field: 'description', value: NOTE, why: 'x' }] }));
    expect(row.status).toBe(1);
    expect(row.stdout).toContain('items/zz-fui-row');
  });
  it('exits 1 when a baselined record has gone clean, and 0 when the baseline matches and on a clean tree', () => {
    const stale = run(tree({ core: { items: { a: { name: 'A' } } }, baseline: ['items/a'] }));
    expect(stale.status).toBe(1);
    expect(stale.stdout).toContain('no longer carries Foundry editor text');
    const known = run(tree({ core: { items: { a: { note: 'The button above.' } } }, baseline: ['items/a'] }));
    expect(known.status).toBe(0);
    expect(run(tree({ core: { items: { a: { name: 'A' } } } })).status).toBe(0);
  });
  it('refuses (exit 2) rather than pass when a file it reads is missing', () => {
    const r = run(join(scratch, 'does-not-exist'));
    expect(r.status).toBe(2);
  });
});

describe('the shipped data', () => {
  const core = readJson('public/core.json') as Record<string, Record<string, Json>>;
  const descriptions = readJson('public/core-descriptions.json') as Record<string, Record<string, { d?: string }>>;
  const overlay = JSON.parse(readFileSync(join(ROOT, 'scripts/data/effect-backfill.json'), 'utf8').replace(/^﻿/, '')) as unknown[];
  const baseline = readJson('scripts/data/foundry-ui-text-baseline.json') as { records: string[] };
  const ordinal = (k: number) => `${k}${k === 1 ? 'st' : k === 2 ? 'nd' : k === 3 ? 'rd' : 'th'}`;
  const ids = [
    ...Array.from({ length: 10 }, (_, i) => `scroll-of-${ordinal(i + 1)}-rank-spell`),
    ...Array.from({ length: 9 }, (_, i) => `magic-wand-${ordinal(i + 1)}-rank-spell`),
  ];

  it('none of the 19 Foundry-era scroll and wand descriptions carries the drag-from-the-compendium note', () => {
    expect(ids).toHaveLength(19);
    for (const id of ids) {
      const d = String(descriptions.items[id]?.d ?? '');
      expect(core.items[id], `items/${id} is still shipped`).toBeTruthy();
      expect(d.length, `items/${id} keeps its printed body`).toBeGreaterThan(200);
      expect(d, `items/${id}`).not.toMatch(/compendium browser|loot actor|drag the spell/i);
      expect(d, `items/${id} ends without the rule above the note`).not.toMatch(/\n---\s*$/);
    }
  });

  it('runs in npm run verify, right after description-header-check', () => {
    const verify = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: { verify: string } }).scripts.verify;
    expect(verify).toContain('node scripts/description-header-check.mjs && node scripts/foundry-ui-text-check.mjs &&');
  });

  it('the tree passes: every offender is in the baseline and every baseline entry is still an offender', () => {
    const found = foundryUiOffenders({ core, descriptions, overlay });
    expect(baselineProblems(found, baseline)).toEqual([]);
    for (const id of ids) expect(found[`items/${id}`], `items/${id}`).toBeUndefined();
  });
});
