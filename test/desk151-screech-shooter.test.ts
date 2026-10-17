import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { build, content } from './_content';
import { CHILD_TIMEOUT } from './_timeouts';
import { deriveStrikes } from '../src/rules/derive';
import type { Character, ContentDatabase } from '../src/rules/types';

/**
 * DESK #151 (2026-09-12, work/desk-answers-2026-09-12.json) — the Screech Shooter's own runes, and the major's text
 * (package I, 2026-10-17).
 *
 * Print (AoN equipment-1169, Guns & Gears (Remastered) pg. 155): "a screech shooter is a special +1 striking harmona
 * gun designed to fire terrifying blasts of sound"; the greater (equipment-1169-1109): "a +2 greater striking harmona
 * gun"; the major (equipment-1169-1110) prints no rune sentence at all, only "The DC for the activation is 37 and it
 * affects creatures in a 50-foot emanation". Ruling: builtInRunes on all three — base {potency 1, striking}, greater
 * {potency 2, greater}, and the major inherits the greater's (a higher grade inherits the previous grade's runes
 * unless it restates them) — and the major's text drops the unprinted "+2 greater striking" words (a pure deletion;
 * the Effect line keeps the major's own DC 37 / 50-foot emanation, desk #72 option A).
 *
 * Before: none of the three carried builtInRunes, so all three Struck as a plain harmona gun (26 / 1d10+8 at level
 * 17). scripts/backfill-builtin-weapon-runes.mjs never caught the family because its pattern needed the "+N" right
 * after the article and print says "a SPECIAL +1 striking".
 */
const gated = content({ trustGate: true });
vi.setConfig({ testTimeout: CHILD_TIMEOUT, hookTimeout: CHILD_TIMEOUT });

const RUNES = {
  'screech-shooter': { potency: 1, striking: 'striking' },
  'screech-shooter-greater': { potency: 2, striking: 'greater' },
  'screech-shooter-major': { potency: 2, striking: 'greater' },
} as const;

/** A level-17 gunslinger holding exactly one equipped weapon. */
const holding = (itemId: string): Character => {
  const base = build('gunslinger', 17, {});
  return { ...base, inventory: [{ instanceId: 'g1', itemId, quantity: 1, equipped: true }] } as unknown as Character;
};
const strike = (itemId: string, d: ContentDatabase = gated) => {
  const s = deriveStrikes(holding(itemId), d).find((x) => x.instanceId === 'g1')!;
  return { attack: s.attack[0], damage: s.damage };
};
const text = (id: string): string => String((gated.items[id] as unknown as { description?: string }).description ?? '');

describe('desk 151 — each Screech Shooter carries the runes print names', () => {
  it('builtInRunes per grade equal the ruling', () => {
    for (const [id, runes] of Object.entries(RUNES)) {
      expect((gated.items[id] as unknown as { builtInRunes?: unknown }).builtInRunes, id).toEqual(runes);
    }
  });

  it('the Strike matches the book: +1 and 2 dice for the base, +2 and 3 dice for the greater and the major — the plain harmona gun stays the control', () => {
    expect(strike('harmona-gun')).toEqual({ attack: 26, damage: '1d10+8 B' });
    expect(strike('screech-shooter')).toEqual({ attack: 27, damage: '2d10+8 sonic' });
    expect(strike('screech-shooter-greater')).toEqual({ attack: 28, damage: '3d10+8 sonic' });
    expect(strike('screech-shooter-major')).toEqual({ attack: 28, damage: '3d10+8 sonic' });
  });

  // mutation-proof
  it('planted: without the builtInRunes rows a grade Strikes as a plain harmona gun again (the shape this ruling corrects)', () => {
    for (const id of Object.keys(RUNES)) {
      const { builtInRunes: _dropped, ...rest } = gated.items[id] as unknown as Record<string, unknown>;
      const bad = { ...gated, items: { ...gated.items, [id]: rest } } as unknown as ContentDatabase;
      expect(strike(id, bad), id).toEqual({ attack: 26, damage: '1d10+8 sonic' });
    }
  });
});

describe('desk 151 — the major\'s text is the Archives\' own block, without the unprinted rune words', () => {
  it('no "+2 greater striking" in the major; its activation still reads DC 37 and the 50-foot emanation', () => {
    const major = text('screech-shooter-major');
    expect(major).not.toMatch(/\+2 greater striking/);
    expect(major).toContain('is a special *harmona gun* designed to fire');
    expect(major).toContain('DC 37');
    expect(major).toContain('50-foot');
  });

  it('the greater keeps its printed "+2 greater striking", and the base its "+1 striking"', () => {
    expect(text('screech-shooter-greater')).toContain('+2 greater striking');
    expect(text('screech-shooter')).toContain('+1 striking');
  });
});

/**
 * THE GENERIC GUARD: `node scripts/backfill-builtin-weapon-runes.mjs --check` (in `npm run verify`) fails on any
 * weapon whose opening clause names its own runes and has no builtInRunes — with "a special +1 striking …" now in
 * its detector. The real run is the first leg; the planted legs run a COPY of the script against a throwaway corpus
 * (the script resolves its data from its own location), so nothing in the repo is touched.
 */
const ROOT = path.join(__dirname, '..');
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

/** A tiny repo with the script copy and one magic weapon whose description is `desc`. */
function check(desc: string, builtInRunes?: object) {
  const dir = mkdtempSync(path.join(tmpdir(), 'builtin-runes-'));
  dirs.push(dir);
  mkdirSync(path.join(dir, 'scripts', 'lib'), { recursive: true });
  mkdirSync(path.join(dir, 'public'));
  copyFileSync(path.join(ROOT, 'scripts/backfill-builtin-weapon-runes.mjs'), path.join(dir, 'scripts/backfill-builtin-weapon-runes.mjs'));
  copyFileSync(path.join(ROOT, 'scripts/lib/write-backfill.mjs'), path.join(dir, 'scripts/lib/write-backfill.mjs'));
  const items = {
    'harmona-gun': { itemType: 'weapon', level: 0, name: 'Harmona Gun', group: 'firearm' },
    'test-shooter': { itemType: 'weapon', level: 3, name: 'Test Shooter', group: 'firearm', ...(builtInRunes ? { builtInRunes } : {}) },
  };
  writeFileSync(path.join(dir, 'public/core.json'), JSON.stringify({ items }));
  writeFileSync(path.join(dir, 'public/core-descriptions.json'), JSON.stringify({ items: { 'test-shooter': { d: desc } } }));
  const r = spawnSync(process.execPath, [path.join(dir, 'scripts/backfill-builtin-weapon-runes.mjs'), '--check'], { cwd: dir, encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

describe('desk 151 — the widened self-description guard (scripts/backfill-builtin-weapon-runes.mjs --check)', () => {
  it('the shipped data passes: no weapon names its own runes without carrying them', () => {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/backfill-builtin-weapon-runes.mjs'), '--check'], { cwd: ROOT, encoding: 'utf8' });
    expect(r.stdout + r.stderr).toContain('check: ok');
    expect(r.status).toBe(0);
  });

  // mutation-proof
  it('planted: "a special +1 striking harmona gun" with no builtInRunes FAILS (the Screech Shooter shape)', () => {
    const r = check('Built from the larynx of a terror shrike, a test shooter is a special *+1 striking harmona gun* designed to fire terrifying blasts of sound.');
    expect(r.status).toBe(1);
    expect(r.out).toContain('items/test-shooter');
  });

  it('the same weapon with its builtInRunes passes', () => {
    const r = check('a test shooter is a special *+1 striking harmona gun* designed to fire blasts of sound.', { potency: 1, striking: 'striking' });
    expect(r.status).toBe(0);
  });

  // mutation-proof
  it('planted: the plain "a +2 greater striking harmona gun" (no adjective) still FAILS — the old pattern is kept, not replaced', () => {
    const r = check('A greater test shooter is a +2 greater striking harmona gun.');
    expect(r.status).toBe(1);
  });

  it('only "special" is allowed in the slot: another adjective is left alone (a wrong rune is a wrong attack roll for a career)', () => {
    expect(check('a test shooter is a peculiar +1 striking harmona gun that hums.').status).toBe(0);
  });
});
