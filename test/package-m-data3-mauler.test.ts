import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build, content } from './_content';
import { critSpecSources, deriveStrikes, strikeShowsCritSpec, type Strike } from '../src/rules/derive';
import type { Character, ContentDatabase, InventoryItem } from '../src/rules/types';

/**
 * MAULER DEDICATION — back to WANDERER'S GUIDE'S SHAPE (2026-10-17), the engine's `hands` key kept.
 *
 * feat-6368 (Mauler Dedication, Player Core 2 pg. 207) prints "You have familiarity with all melee weapons
 * that require two hands to wield or have the two-hand trait. … If you are at least an expert in such a
 * weapon, you gain access to the critical specialization effect with that weapon." Wanderer's Guide (their id
 * 31986) encodes WEAPON_CRITICAL_SPECIALIZATIONS as the six two-hand trait ids (2528 Two-Hand, 2749/2750/1831/
 * 1644/1597 Two-Hand d6/d4/d8/d10/d12) under an expert-or-better test: the trait half of print's OR only.
 *
 * Package M round 3 (7916e1c) added print's other half — `critSpecWeapons.hands: 2` (types.ts), one more
 * ALTERNATIVE beside `traits` in derive.ts weaponMatches — so a greatsword, greataxe or maul (hands 2, no
 * two-hand trait) matched. Asked whether to keep print or match Wanderer's Guide, the owner said
 * (2026-10-17): "alot of these things are things related to impleneting corretcky the things of pf2e , i want
 * to adress these in the future in a large endevor not now with small things. we will do in the future a new
 * pass on every player selecteble thing. so now if you find these write them but we will adress them later".
 * So the record is back to the pre-7916e1c value (the six traits + melee + expert, a superseding overlay row)
 * and the gap is written in chat-todo.md's "Future correctness pass" list. The ENGINE keeps the `hands` key:
 * no shipped record uses it now, and the block below proves it on a synthetic narrowing so the future pass
 * finds it working.
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
/** The database with the record's narrowing patched — a synthetic or planted case, in memory only. */
const patchedNarrowing = (w: Record<string, unknown>): ContentDatabase =>
  ({ ...db, feats: { ...db.feats, 'mauler-dedication': { ...db.feats['mauler-dedication'], critSpecWeapons: w } } }) as ContentDatabase;
const TWO_HAND_TRAITS = ['two-hand', 'two-hand-d4', 'two-hand-d6', 'two-hand-d8', 'two-hand-d10', 'two-hand-d12'];

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
  it("the record: Wanderer's Guide's shape — the six two-hand traits, melee, expert; no `hands` (the owner, 2026-10-17: \"we will address them later\")", () => {
    expect(db.feats['mauler-dedication']).toMatchObject({ aonId: 'feat-6368', critSpec: true });
    expect(db.feats['mauler-dedication'].critSpecWeapons).toEqual({ traits: TWO_HAND_TRAITS, melee: true, minRank: 'expert' });
  });

  it('a Strike carries its weapon\'s hands; the Fist none', () => {
    const c = mauler('expert');
    expect(strikeNamed(c, db, 'Greatsword').hands).toBe(2);
    expect(strikeNamed(c, db, 'Longsword').hands).toBe(1);
    expect(strikeNamed(c, db, 'Fist').hands).toBeUndefined();
  });
});

describe('a Mauler, as Wanderer\'s Guide has it — "If you are at least an expert in such a weapon, you gain access to the critical specialization effect"', () => {
  // batch package-m premise: feat-6368 "If you are at least an expert in such a weapon, you gain access to the critical specialization effect with that weapon."
  it('expert bastard sword yes (the two-hand trait)', () => {
    expect(shows(mauler('expert'), db, 'Bastard Sword')).toBe(true);
  });

  it('expert greatsword, greataxe and maul NO — they require two hands but carry no two-hand trait (the future-pass gap, chat-todo.md)', () => {
    const c = mauler('expert');
    expect(strikeNamed(c, db, 'Greatsword').rank).toBe('expert');
    expect(shows(c, db, 'Greatsword')).toBe(false);
    expect(shows(c, db, 'Greataxe')).toBe(false);
    expect(shows(c, db, 'Maul')).toBe(false);
  });

  it('expert longsword no; expert crossbow no (not melee); the Fist no', () => {
    const c = mauler('expert');
    expect(shows(c, db, 'Longsword')).toBe(false);
    expect(shows(c, db, 'Crossbow')).toBe(false);
    expect(shows(c, db, 'Fist')).toBe(false);
  });

  it('trained bastard sword no (the expert gate); and without the feat, nothing', () => {
    const t = mauler('trained');
    expect(strikeNamed(t, db, 'Bastard Sword').rank).toBe('trained');
    expect(shows(t, db, 'Bastard Sword')).toBe(false);
    expect(shows(mauler('expert', { feat: false }), db, 'Bastard Sword')).toBe(false);
  });

  it('with the trust gate on, as the app runs: the grant and its narrowing stay on together', () => {
    const gated = content({ trustGate: true });
    expect((gated.feats['mauler-dedication'] as { critSpecWeapons?: unknown }).critSpecWeapons).toEqual(db.feats['mauler-dedication'].critSpecWeapons);
    expect(shows(mauler('expert'), gated, 'Bastard Sword')).toBe(true);
    expect(shows(mauler('expert'), gated, 'Greatsword')).toBe(false);
  });

  it('planted: the round-3 row (hands: 2 beside the traits) lights the greatsword again — this pin catches it coming back', () => {
    const round3 = patchedNarrowing({ traits: TWO_HAND_TRAITS, hands: 2, melee: true, minRank: 'expert' });
    expect(shows(mauler('expert'), round3, 'Greatsword')).toBe(true);
    expect(db.feats['mauler-dedication'].critSpecWeapons).not.toHaveProperty('hands');
  });
});

/* The ENGINE's `critSpecWeapons.hands` (derive.ts weaponMatches) stays for the future correctness pass, proved
 * on a SYNTHETIC narrowing (the Mauler record in memory, patched): an alternative beside `traits`, read from the
 * weapon record's own `hands`, never from a Strike that does not carry it. */
describe('the engine key `critSpecWeapons.hands` (kept, synthetic narrowing)', () => {
  const synthetic = patchedNarrowing({ traits: TWO_HAND_TRAITS, hands: 2, melee: true, minRank: 'expert' });
  it('hands 2 matches the greatsword, greataxe and maul; the trait still matches the bastard sword; melee and expert still hold', () => {
    const c = mauler('expert');
    for (const w of ['Greatsword', 'Greataxe', 'Maul', 'Bastard Sword']) expect(shows(c, synthetic, w), w).toBe(true);
    expect(shows(c, synthetic, 'Longsword')).toBe(false);
    expect(shows(c, synthetic, 'Crossbow')).toBe(false);
    expect(shows(mauler('trained'), synthetic, 'Greatsword')).toBe(false);
  });

  it('planted: a Strike that does not carry its hands is never "two hands" — the match reads the weapon\'s own field', () => {
    const c = mauler('expert');
    const gs = strikeNamed(c, synthetic, 'Greatsword');
    expect(strikeShowsCritSpec(gs, critSpecSources(c, synthetic), c)).toBe(true);
    expect(strikeShowsCritSpec({ ...gs, hands: undefined }, critSpecSources(c, synthetic), c)).toBe(false);
    // and a one-handed-or-more weapon ('1+', a bow) is not two-handed
    expect(strikeShowsCritSpec({ ...gs, hands: '1+' }, critSpecSources(c, synthetic), c)).toBe(false);
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
