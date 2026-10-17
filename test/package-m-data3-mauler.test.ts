import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build, content } from './_content';
import { critSpecSources, deriveStrikes, strikeShowsCritSpec, type Strike } from '../src/rules/derive';
import type { Character, ContentDatabase, InventoryItem } from '../src/rules/types';

/**
 * PACKAGE M, ROUND 3 (c) — Mauler Dedication reaches the weapons that REQUIRE two hands, not only the
 * two-hand trait.
 *
 * feat-6368 (Mauler Dedication, Player Core 2 pg. 207) prints "You have familiarity with all melee weapons
 * that require two hands to wield or have the two-hand trait. … If you are at least an expert in such a
 * weapon, you gain access to the critical specialization effect with that weapon." The record narrowed by
 * the six two-hand trait spellings + melee + expert, so a greatsword, greataxe or maul (hands 2, no
 * two-hand trait) never matched. `critSpecWeapons.hands: 2` (types.ts) is one more ALTERNATIVE beside
 * `traits` (derive.ts weaponMatches), tested against the weapon record's own `hands` that every Strike now
 * carries; melee and the expert gate still hold.
 *
 * Wanderer's Guide (their id 31986) encodes WEAPON_CRITICAL_SPECIALIZATIONS as the six two-hand trait ids
 * (2528 Two-Hand, 2749/2750/1831/1644/1597 Two-Hand d6/d4/d8/d10/d12) under an expert-or-better test: the
 * trait half of print's OR and nothing that contradicts it. Ours now has the hands half too (MORE than WG,
 * gold-set R10 — reported, never silently).
 */
const db = content();

const held = (itemId: string): InventoryItem => ({ instanceId: `pm3-${itemId}`, itemId, quantity: 1, equipped: true });
const strikeNamed = (c: Character, d: ContentDatabase, name: string): Strike => {
  const s = deriveStrikes(c, d).find((x) => x.name === name);
  if (!s) throw new Error(`no Strike named ${name}`);
  return s;
};
const shows = (c: Character, d: ContentDatabase, name: string) => strikeShowsCritSpec(strikeNamed(c, d, name), critSpecSources(c, d), c);
const WEAPONS = ['greatsword', 'greataxe', 'maul', 'bastard-sword', 'longsword', 'crossbow'];
/** A 5th-level wizard (no crit spec of its own) with Mauler Dedication, at `rank` in each weapon it holds. */
function mauler(rank: 'trained' | 'expert', opts: { feat?: boolean } = {}): Character {
  const c = build('wizard', 5);
  const overrides = Object.fromEntries(WEAPONS.map((w) => [w, rank]));
  return {
    ...c,
    inventory: [...c.inventory, ...WEAPONS.map(held)],
    proficiencies: { ...c.proficiencies, weaponOverrides: { ...(c.proficiencies.weaponOverrides ?? {}), ...overrides } },
    feats: opts.feat === false ? c.feats : [...c.feats, { featId: 'mauler-dedication', level: 2, category: 'class' } as Character['feats'][number]],
  };
}
/** The database with the record's narrowing patched — the planted bad case, in memory only. */
const patchedNarrowing = (w: Record<string, unknown>): ContentDatabase =>
  ({ ...db, feats: { ...db.feats, 'mauler-dedication': { ...db.feats['mauler-dedication'], critSpecWeapons: w } } }) as ContentDatabase;

describe('the shipped weapons and record are what this file assumes', () => {
  it('hands and traits', () => {
    expect(db.items['greatsword']).toMatchObject({ hands: 2, traits: ['versatile-p'] });
    expect(db.items['greataxe']).toMatchObject({ hands: 2 });
    expect(db.items['maul']).toMatchObject({ hands: 2 });
    expect(db.items['bastard-sword']).toMatchObject({ hands: 1, traits: ['two-hand-d12'] });
    expect(db.items['longsword']).toMatchObject({ hands: 1 });
    expect(db.items['crossbow']).toMatchObject({ hands: 2, range: 120 });
  });

  // batch package-m premise: feat-6368 "You have familiarity with all melee weapons that require two hands to wield or have the two-hand trait."
  it('the record: the two-hand traits OR hands 2, melee, expert', () => {
    expect(db.feats['mauler-dedication']).toMatchObject({
      aonId: 'feat-6368',
      critSpec: true,
      critSpecWeapons: { traits: ['two-hand', 'two-hand-d4', 'two-hand-d6', 'two-hand-d8', 'two-hand-d10', 'two-hand-d12'], hands: 2, melee: true, minRank: 'expert' },
    });
  });

  it('a Strike carries its weapon\'s hands; the Fist none', () => {
    const c = mauler('expert');
    expect(strikeNamed(c, db, 'Greatsword').hands).toBe(2);
    expect(strikeNamed(c, db, 'Longsword').hands).toBe(1);
    expect(strikeNamed(c, db, 'Fist').hands).toBeUndefined();
  });
});

describe('a Mauler — "If you are at least an expert in such a weapon, you gain access to the critical specialization effect"', () => {
  // batch package-m premise: feat-6368 "If you are at least an expert in such a weapon, you gain access to the critical specialization effect with that weapon."
  it('expert greatsword yes (requires two hands, no two-hand trait) — and the greataxe and maul', () => {
    const c = mauler('expert');
    expect(strikeNamed(c, db, 'Greatsword').rank).toBe('expert');
    expect(shows(c, db, 'Greatsword')).toBe(true);
    expect(shows(c, db, 'Greataxe')).toBe(true);
    expect(shows(c, db, 'Maul')).toBe(true);
  });

  it('expert bastard sword yes (the two-hand trait, one hand to wield)', () => {
    expect(shows(mauler('expert'), db, 'Bastard Sword')).toBe(true);
  });

  it('expert longsword no (one hand, no two-hand trait); expert crossbow no (two hands, but not melee); the Fist no', () => {
    const c = mauler('expert');
    expect(shows(c, db, 'Longsword')).toBe(false);
    expect(shows(c, db, 'Crossbow')).toBe(false);
    expect(shows(c, db, 'Fist')).toBe(false);
  });

  it('trained greatsword no (the expert gate); and without the feat, nothing', () => {
    const t = mauler('trained');
    expect(strikeNamed(t, db, 'Greatsword').rank).toBe('trained');
    expect(shows(t, db, 'Greatsword')).toBe(false);
    expect(shows(t, db, 'Bastard Sword')).toBe(false);
    expect(shows(mauler('expert', { feat: false }), db, 'Greatsword')).toBe(false);
  });

  it('with the trust gate on, as the app runs: the grant and its narrowing stay on together', () => {
    const gated = content({ trustGate: true });
    expect((gated.feats['mauler-dedication'] as { critSpecWeapons?: unknown }).critSpecWeapons).toEqual(db.feats['mauler-dedication'].critSpecWeapons);
    expect(shows(mauler('expert'), gated, 'Greatsword')).toBe(true);
    expect(shows(mauler('expert'), gated, 'Longsword')).toBe(false);
  });

  it('planted: the old trait-only row misses the greatsword (what shipped before this round)', () => {
    const old = patchedNarrowing({ traits: ['two-hand', 'two-hand-d4', 'two-hand-d6', 'two-hand-d8', 'two-hand-d10', 'two-hand-d12'], melee: true, minRank: 'expert' });
    expect(shows(mauler('expert'), old, 'Greatsword')).toBe(false);
    expect(shows(mauler('expert'), old, 'Bastard Sword')).toBe(true);
  });

  it('planted: a Strike that does not carry its hands is never "two hands" — the match reads the weapon\'s own field', () => {
    const c = mauler('expert');
    const gs = strikeNamed(c, db, 'Greatsword');
    expect(strikeShowsCritSpec(gs, critSpecSources(c, db), c)).toBe(true);
    expect(strikeShowsCritSpec({ ...gs, hands: undefined }, critSpecSources(c, db), c)).toBe(false);
    // and a one-handed-or-more weapon ('1+', a bow) is not two-handed
    expect(strikeShowsCritSpec({ ...gs, hands: '1+' }, critSpecSources(c, db), c)).toBe(false);
  });
});

/* scripts/critspec-narrowing-check.mjs counts `hands` as a narrowing key (a hands-only grant is narrowed,
 * since weaponMatches reads it as an alternative). Run for real on a scratch copy of core.json carrying one
 * planted hands-only grant, and on a scratch copy of the check with that line taken out. */
// Each run walks the Foundry packs (~9 s on this machine), so the block has a minute per test.
describe('critspec-narrowing-check counts the new key', { timeout: 60_000 }, () => {
  let dir = '';
  let core = '';
  const HANDS_LINE = '    if (w.hands === 1 || w.hands === 2) return true;\n';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'pm3-mauler-'));
    const real = JSON.parse(readFileSync('public/core.json', 'utf8')) as Record<string, Record<string, unknown>>;
    real.feats['pm3-hands-only'] = { id: 'pm3-hands-only', name: 'PM3 Hands Only', critSpec: true, critSpecWeapons: { hands: 2 } };
    core = join(dir, 'core.json');
    writeFileSync(core, JSON.stringify(real));
  }, 60_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  // The allow file and the packs by absolute path: a scratch copy of the script resolves its own ROOT elsewhere.
  const run = (script: string) => {
    const env = { ...process.env, CORE_JSON: core, CRITSPEC_ALLOW: resolve('scripts/data/critspec-narrowing-allow.json'), FOUNDRY_PACKS: resolve('.import-src/pf2e/packs/pf2e') };
    const r = spawnSync(process.execPath, [script], { env, encoding: 'utf8' });
    return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
  };

  it('a hands-only grant is narrowed', () => {
    const r = run('scripts/critspec-narrowing-check.mjs');
    expect(r.status, r.out).toBe(0);
  });

  it('planted script: without the hands line the same grant reads as crit spec on every Strike', () => {
    const src = readFileSync('scripts/critspec-narrowing-check.mjs', 'utf8');
    expect(src.split(HANDS_LINE).length - 1).toBe(1);
    const p = join(mkdtempSync(join(dir, 'mut-')), 'critspec-narrowing-check.mjs');
    writeFileSync(p, src.replace(HANDS_LINE, ''));
    const r = run(p);
    expect(r.status).toBe(1);
    expect(r.out).toContain('UNNARROWED feats/pm3-hands-only');
  });
});
