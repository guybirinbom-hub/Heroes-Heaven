import { describe, expect, it } from 'vitest';
import { BLOCK_KINDS, RESERVED_SOURCE_KINDS, SOURCE_KINDS, blockKind, type BlockInstance } from '../src/rules/blocks/registry';
import { TARGETS, parseTargetRef, targetBuilt, targetDefFor, targetRefKey } from '../src/rules/blocks/targets';
import { parseStoredBlocks, readLegacyBlocks, readTweaks, writeStoredBlocks, type StoredBlock } from '../src/rules/blocks/stored';
import { loreKey } from '../src/rules/build';
import type { BuildOverrides } from '../src/rules/types';

/**
 * The block registry, the target registry and the stored-tweak reader (docs/overrides-redesign.md,
 * Building blocks items 2, 3, 13, 14; checker C2–C4, C15). scripts/blocks-check.mjs fails when no it() /
 * describe() title in an entry's test file names its id. Synthetic data only.
 */

const tweak = (kind: string, more: Partial<BlockInstance> = {}): BlockInstance => ({
  kind,
  version: 1,
  key: 'blocks:t1',
  source: { kind: 'tweak', id: 'blocks:t1' },
  on: true,
  ...more,
});
const lineOf = (kind: string, more: Partial<BlockInstance> = {}) => blockKind(kind)!.line(tweak(kind, more));

describe('every registered kind: its breakdown wording (spec item 7)', () => {
  it("'number.add' — Tweak: +1 (reason); a typed one names its type; a book block shows its record", () => {
    expect(lineOf('number.add', { value: 1, reason: 'Gift from the river spirit' })).toBe('Tweak: +1 (Gift from the river spirit)');
    expect(lineOf('number.add', { value: -2, bonusType: 'status' })).toBe('Tweak: -2 status');
    expect(blockKind('number.add')!.line(tweak('number.add', { value: 2, source: { kind: 'book', id: 'feats/peerless-form', name: 'Peerless Form' } }))).toBe('Peerless Form');
  });
  it("'attribute.add' — a +/- on a score", () => {
    expect(lineOf('attribute.add', { value: 2 })).toBe('Tweak: +2');
  });
  it("'number.set' and 'number.atLeast' — set to N / at least N", () => {
    expect(lineOf('number.set', { value: 20, reason: 'GM ruling' })).toBe('Tweak: set to 20 (GM ruling)');
    expect(lineOf('number.atLeast', { value: 30 })).toBe('Tweak: at least 30');
  });
  it("'number.setMaxHp' and 'attribute.set' — the two sets that wrap an old key", () => {
    expect(lineOf('number.setMaxHp', { value: 64 })).toBe('Tweak: set to 64');
    expect(lineOf('attribute.set', { value: 18 })).toBe('Tweak: set to 18');
  });
  it("'rank.atLeast', 'rank.exactly' and 'rank.legacySet' (an old entry not sorted yet says 'set to', never 'exactly')", () => {
    expect(lineOf('rank.atLeast', { rank: 'expert' })).toBe('Tweak: at least expert');
    expect(lineOf('rank.exactly', { rank: 'trained', reason: 'Lost training' })).toBe('Tweak: exactly trained (Lost training)');
    expect(lineOf('rank.legacySet', { rank: 'trained' })).toBe('Tweak: set to trained');
  });
  it("'grant.feat', 'grant.language', 'grant.spell', 'grant.classFeature', 'remove.feat', 'choice.allowAnyway', 'text.edit'", () => {
    expect(lineOf('grant.feat', { reason: 'GM reward' })).toBe('Tweak: given (GM reward)');
    expect(lineOf('grant.language')).toBe('Tweak: given');
    expect(lineOf('grant.spell')).toBe('Tweak: given');
    expect(lineOf('grant.classFeature')).toBe('Tweak: given');
    expect(lineOf('remove.feat')).toBe('Tweak: removed');
    expect(lineOf('choice.allowAnyway')).toBe('Tweak: taken anyway');
    expect(lineOf('text.edit')).toBe('Tweak: your text');
  });
  it('the registry has exactly the kinds tested above', () => {
    expect(BLOCK_KINDS.map((k) => k.id).sort()).toEqual(
      [
        'number.add',
        'attribute.add',
        'number.set',
        'number.atLeast',
        'number.setMaxHp',
        'attribute.set',
        'rank.atLeast',
        'rank.exactly',
        'rank.legacySet',
        'grant.feat',
        'grant.language',
        'grant.spell',
        'grant.classFeature',
        'remove.feat',
        'choice.allowAnyway',
        'text.edit',
      ].sort(),
    );
  });
});

describe('sources: homebrew is reserved (item 14)', () => {
  it('is a known source kind that nothing in phase 1 writes', () => {
    expect(SOURCE_KINDS).toContain('homebrew');
    expect(RESERVED_SOURCE_KINDS).toEqual(['homebrew']);
  });
});

describe('the target registry (item 3)', () => {
  it('round-trips a key: character, Lore, casting entry', () => {
    for (const key of ['skill:athletics', 'save:fortitude', 'speed:land', 'score:str', 'max-hp', 'spell-dc@casting-entry:wizard']) {
      expect(targetRefKey(parseTargetRef(key)!)).toBe(key);
    }
    expect(parseTargetRef('skill:lore:sailing')).toEqual({ kind: 'skill', detail: 'lore:sailing', owner: 'character' });
  });
  it('keys a Lore through loreKey — a "Sailing Lore" tweak and a background Lore are one target (spec item 11)', () => {
    expect(targetDefFor(`skill:${loreKey('Sailing Lore')}`, 'rank')).not.toBeNull();
    expect(targetDefFor(`skill:${loreKey('Lore of the Sea')}`, 'number')).not.toBeNull();
  });
  it('refuses what is not a target: unknown stat, bad detail, an owner without its id', () => {
    expect(parseTargetRef('luck')).toBeNull();
    expect(targetDefFor('save:sanity', 'number')).toBeNull();
    expect(targetDefFor('spell-dc', 'number')).toBeNull(); // the spell DC belongs to a casting entry
    expect(parseTargetRef('spell-dc@casting-entry')).toBeNull();
  });
  it('phase 1 builds the character and casting-entry owners only, land Speed only, and no casting-entry rank', () => {
    expect(TARGETS.filter((t) => t.built).every((t) => t.owner === 'character' || t.owner === 'casting-entry')).toBe(true);
    expect(targetBuilt('speed:land', 'number')).toBe(true);
    expect(targetBuilt('speed:fly', 'number')).toBe(false);
    expect(targetDefFor('speed:fly', 'number')).not.toBeNull(); // known, kept, not yet applied
    // overrides.proficiencies cannot hold a casting entry's rank (it would become a fake skill): phase 5.
    expect(targetBuilt('spell@casting-entry:wizard', 'rank')).toBe(false);
    for (const id of ['rank.atLeast', 'rank.exactly', 'rank.legacySet']) {
      const a = blockKind(id)!.accepts;
      expect('kinds' in a && a.kinds.includes('spell')).toBe(false);
    }
  });
});

const SAMPLE: BuildOverrides = {
  allowedFeats: ['risky-feat'],
  addedFeats: [
    { featId: 'fleet', level: 3, category: 'general' },
    { featId: 'fleet', level: 7, category: 'general' },
    { featId: 'fleet', level: 7, category: 'general' },
  ],
  addedFeatures: [{ featureId: 'some-feature', level: 1 }],
  removedFeatIds: ['old-feat'],
  attributes: { str: 18 },
  proficiencies: { stealth: 'expert', 'lore:sailing': 'trained', fortitude: 'master', classDc: 'expert', martial: 'trained' },
  addedLanguages: ['draconic'],
  addedSpells: [{ spellId: 'light', rank: 1 }],
  maxHp: 64,
  contentEdits: { feats: { fleet: { name: 'Quick Feet' } } },
  meta: {
    'proficiencies:stealth': { mode: 'atLeast', reason: "Thieves' guild training", from: 5, of: 'expert' },
    'maxHp:max-hp': { on: false, of: '64' },
    'addedFeats:fleet@7': { reason: 'GM reward', of: 'fleet@7' },
  },
};

describe("today's 10 Overrides keys read as blocks (checker C3)", () => {
  const inst = readLegacyBlocks(SAMPLE);
  const byKey = new Map(inst.map((i) => [i.key, i]));
  it('reads every key, each keyed by what the entry is; only a true repeat gets ~2 (checker C15)', () => {
    expect([...byKey.keys()]).toEqual([
      'attributes:str',
      'proficiencies:stealth',
      'proficiencies:lore:sailing',
      'proficiencies:fortitude',
      'proficiencies:classDc',
      'proficiencies:martial',
      'maxHp:max-hp',
      'addedFeats:fleet@3',
      'addedFeats:fleet@7',
      'addedFeats:fleet@7~2',
      'addedFeatures:some-feature@1',
      'addedLanguages:draconic',
      'addedSpells:light@1',
      'removedFeatIds:old-feat',
      'allowedFeats:risky-feat',
      'contentEdits:feats/fleet',
    ]);
  });
  it('deleting one given feat does not move its reason or pause onto another', () => {
    const fewer = readLegacyBlocks({ ...SAMPLE, addedFeats: [{ featId: 'fleet', level: 3, category: 'general' }] });
    expect(fewer.find((i) => i.key === 'addedFeats:fleet@3')?.reason).toBeUndefined();
  });
  it('takes reason, pause and start level from meta', () => {
    expect(byKey.get('proficiencies:stealth')).toMatchObject({ kind: 'rank.atLeast', target: 'skill:stealth', rank: 'expert', reason: "Thieves' guild training", gate: { startLevel: 5 }, on: true });
    expect(byKey.get('maxHp:max-hp')).toMatchObject({ kind: 'number.setMaxHp', value: 64, on: false });
    expect(byKey.get('addedFeats:fleet@7')!.reason).toBe('GM reward');
  });
  it('ignores stale meta: an entry an older app deleted and re-added with another value is not paused', () => {
    const later = readLegacyBlocks({ ...SAMPLE, maxHp: 70, proficiencies: { stealth: 'master' } });
    expect(later.find((i) => i.key === 'maxHp:max-hp')!.on).toBe(true);
    const stealth = later.find((i) => i.key === 'proficiencies:stealth')!;
    expect(stealth.reason).toBeUndefined();
    expect(stealth.kind).toBe('rank.legacySet'); // its "at least" was for 'expert', not this entry
  });
  it("an old rank with no 'at least' / 'exactly' recorded is 'rank.legacySet' — today's behaviour, never the final clamp (checker C2)", () => {
    expect(byKey.get('proficiencies:fortitude')).toMatchObject({ kind: 'rank.legacySet', target: 'save:fortitude', rank: 'master' });
    expect(byKey.get('proficiencies:classDc')!.target).toBe('class-dc');
    expect(byKey.get('proficiencies:martial')!.target).toBe('weapon:martial');
    expect(byKey.get('proficiencies:lore:sailing')!.target).toBe('skill:lore:sailing');
  });
  it('maps each old key to its registry kind', () => {
    expect(byKey.get('attributes:str')).toMatchObject({ kind: 'attribute.set', target: 'score:str', value: 18 });
    expect(byKey.get('addedFeats:fleet@7~2')).toMatchObject({ kind: 'grant.feat', record: 'fleet', params: { level: 7 } });
    expect(byKey.get('addedSpells:light@1')).toMatchObject({ kind: 'grant.spell', params: { rank: 1 } });
    expect(byKey.get('contentEdits:feats/fleet')).toMatchObject({ kind: 'text.edit', record: 'feats/fleet' });
    for (const i of inst) expect(blockKind(i.kind)?.storage.in).toBe('legacy');
  });
  it('lists an entry it cannot read as broken, never skips it (decision 13)', () => {
    const odd = readLegacyBlocks({ proficiencies: { athletics: 'Expert' as never }, attributes: { dex: 'high' as never }, maxHp: 'lots' as never });
    expect(odd.map((i) => [i.key, !!i.broken])).toEqual([
      ['attributes:dex', true],
      ['proficiencies:athletics', true],
      ['maxHp:max-hp', true],
    ]);
    // …but a stored null max HP is "no set" to the build, so it is no tweak at all.
    expect(readLegacyBlocks({ maxHp: null as never })).toEqual([]);
  });
  it('reading never changes the stored overrides (a load is not an edit, checker C4)', () => {
    const before = JSON.stringify(SAMPLE);
    readTweaks(SAMPLE);
    expect(JSON.stringify(SAMPLE)).toBe(before);
    expect('v' in SAMPLE).toBe(false);
  });
});

describe('overrides.blocks: unknown and newer kinds are kept, never dropped (item 13)', () => {
  const mine: StoredBlock = { id: 't1', kind: 'number.add', v: 1, target: 'skill:athletics', value: 1, reason: 'Gift' };
  const fromPhase3 = { id: 't2', kind: 'strike.extraDamage', v: 1, target: 'attack', value: '1d6 fire' };
  const newer = { id: 't3', kind: 'number.add', v: 2, target: 'skill:athletics', value: 1, curve: [1, 5, 10] };
  const junk = 'not a block';

  it('reads what it knows and returns the rest as foreign, the same objects', () => {
    const { known, foreign } = parseStoredBlocks([mine, fromPhase3, newer, junk]);
    expect(known).toHaveLength(1);
    expect(known[0]).toMatchObject({ kind: 'number.add', key: 'blocks:t1', target: 'skill:athletics', value: 1, reason: 'Gift', on: true });
    expect(foreign.map((f) => f.why)).toEqual(['unknown-kind', 'newer-version', 'unreadable']);
    expect(foreign[0].raw).toBe(fromPhase3);
    expect(foreign[1].raw).toBe(newer);
  });
  it('a block whose target this app does not know is kept and shown broken, not dropped (decision 13)', () => {
    const { known } = parseStoredBlocks([{ ...mine, target: 'luck' }]);
    expect(known).toHaveLength(1);
    expect(known[0].broken).toMatch(/luck/);
  });
  it("a set's baseline is read (decision 9 needs it)", () => {
    const { known } = parseStoredBlocks([{ id: 't9', kind: 'number.set', v: 1, target: 'ac', value: 20, baseline: 18 }]);
    expect(known[0].params).toEqual({ baseline: 18 });
  });
  it('editing a known tweak next to unknown ones keeps them byte for byte, in place', () => {
    const prev = [fromPhase3, mine, newer, junk];
    const { list, refused } = writeStoredBlocks(prev, { upsert: [{ ...mine, value: 2 }] });
    expect(refused).toEqual([]);
    expect(list).toHaveLength(4);
    const l = list as unknown[];
    expect(l[0]).toBe(fromPhase3);
    expect(l[1]).toEqual({ ...mine, value: 2 });
    expect(l[2]).toBe(newer);
    expect(l[3]).toBe(junk);
  });
  it('editing a known tweak keeps the fields a newer app added to it; a field this app knows and leaves out is cleared', () => {
    const withNewField = { ...mine, whileState: 'raging' };
    const { list } = writeStoredBlocks([withNewField], { upsert: [{ id: 't1', kind: 'number.add', v: 1, target: 'skill:athletics', value: 1, on: false }] });
    expect(list).toEqual([{ id: 't1', kind: 'number.add', v: 1, target: 'skill:athletics', value: 1, on: false, whileState: 'raging' }]);
  });
  it('pausing or deleting a known tweak never takes an unknown one with it', () => {
    const { list } = writeStoredBlocks([fromPhase3, mine], { removeIds: ['t1'] });
    expect(list).toEqual([fromPhase3]);
    expect((list as unknown[])[0]).toBe(fromPhase3);
  });
  it('refuses to replace or remove a block it cannot read', () => {
    const { list, refused } = writeStoredBlocks([fromPhase3, newer], { upsert: [{ ...mine, id: 't3' }], removeIds: ['t2'] });
    expect(refused.sort()).toEqual(['t2', 't3']);
    expect((list as unknown[])[0]).toBe(fromPhase3);
    expect((list as unknown[])[1]).toBe(newer);
  });
  it('a stored value that is not a list is kept whole, and every edit to it refused', () => {
    const odd = { version: 3, entries: [] };
    expect(parseStoredBlocks(odd).foreign).toEqual([{ raw: odd, why: 'unreadable' }]);
    const { list, refused } = writeStoredBlocks(odd, { upsert: [mine] });
    expect(list).toBe(odd);
    expect(refused).toEqual(['t1']);
  });
  it('appends a new tweak at the end', () => {
    const { list } = writeStoredBlocks([fromPhase3], { upsert: [mine] });
    expect(list).toEqual([fromPhase3, mine]);
    expect(writeStoredBlocks(undefined, { upsert: [mine] }).list).toEqual([mine]);
  });
  it('readTweaks lists the old keys first, then the blocks, and keeps the foreign ones beside them', () => {
    const { instances, foreign } = readTweaks({ maxHp: 50, blocks: [mine, fromPhase3] });
    expect(instances.map((i) => i.kind)).toEqual(['number.setMaxHp', 'number.add']);
    expect(foreign).toHaveLength(1);
  });
});
