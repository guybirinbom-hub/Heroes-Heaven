import { describe, expect, it, vi } from 'vitest';
import { BLOCK_KINDS } from '../src/rules/blocks/registry';
import { legacyEntries, readTweaks, tweaksSwitchOn } from '../src/rules/blocks/stored';
import { dropChoiceTweak, dropEntries, markImported, newBlockId, setTweaksSwitch, takeAnywayWrite, writeChoiceTweak, writeTweak, type TweakDraft, type TweakHost, type TweakWrite } from '../src/rules/blocks/write';
import { withFeat } from '../src/rules/featSlots';
import type { BuildOverrides, CharacterOptions, TweakMeta } from '../src/rules/types';

/**
 * THE WRITE DOOR (Tweaks part B, plan section 5 / WP1): src/rules/blocks/write.ts. Every invariant of plan
 * 5.2 is one it() here. Pure: no content, no build. Synthetic data only.
 */

/** A draft for every kind a player writes (the registry's kinds with an editor), plus an edit of it. */
const FIXTURES: Record<string, { add: TweakDraft; update: Partial<TweakDraft> }> = {
  'number.add': { add: { kind: 'number.add', target: 'skill:athletics', value: 1, reason: 'River spirit' }, update: { value: 2 } },
  'attribute.add': { add: { kind: 'attribute.add', target: 'score:dex', value: 2, reason: 'Blessing' }, update: { value: 1 } },
  'number.set': { add: { kind: 'number.set', target: 'ac', value: 20, reason: 'GM ruling' }, update: { value: 21 } },
  'number.atLeast': { add: { kind: 'number.atLeast', target: 'perception', value: 10, reason: 'Keen' }, update: { value: 12 } },
  'number.setMaxHp': { add: { kind: 'number.setMaxHp', target: 'max-hp', value: 40, reason: 'Hardy' }, update: { value: 44 } },
  'attribute.set': { add: { kind: 'attribute.set', target: 'score:con', value: 18, reason: 'Rolled' }, update: { value: 16 } },
  'rank.atLeast': { add: { kind: 'rank.atLeast', target: 'skill:stealth', rank: 'expert', reason: 'Guild' }, update: { rank: 'master' } },
  'rank.exactly': { add: { kind: 'rank.exactly', target: 'save:will', rank: 'trained', reason: 'Cursed' }, update: { rank: 'expert' } },
  'grant.feat': { add: { kind: 'grant.feat', record: 'toughness', level: 3, category: 'general', reason: 'GM reward' }, update: { level: 5 } },
  'grant.classFeature': { add: { kind: 'grant.classFeature', record: 'shield-block', level: 1, reason: 'Retrain' }, update: { level: 2 } },
  'grant.language': { add: { kind: 'grant.language', record: 'elven', reason: 'Raised by elves' }, update: { record: 'sylvan' } },
  'grant.spell': { add: { kind: 'grant.spell', record: 'fireball', spellRank: 3, reason: 'Scroll' }, update: { spellRank: 4 } },
  'remove.feat': { add: { kind: 'remove.feat', record: 'old-feat', reason: 'Never had it' }, update: { record: 'other-feat' } },
  'choice.allowAnyway': { add: { kind: 'choice.allowAnyway', record: 'risky-feat', reason: 'GM ok' }, update: { record: 'other-risky' } },
  'text.edit': { add: { kind: 'text.edit', record: 'feats/toughness', text: { name: 'Tougher' }, reason: 'House rule' }, update: { text: { name: 'Toughest' } } },
  // tweaks p2 WP1: a write fixture per phase-2 choice kind — each carries an `editor` object, so it joins
  // WRITTEN_KINDS (plan WP1 Tests, rev 2). A choice kind stores its own fields (`fields`), never a start level.
  'choice.allowAnywayAnyPicker': { add: { kind: 'choice.allowAnywayAnyPicker', record: 'ancient-elf', fields: { picker: 'heritage' }, reason: 'Raised by elves' }, update: { record: 'desert-elf' } },
  'choice.anyList': { add: { kind: 'choice.anyList', record: 'toughness', fields: { rule: 'list' }, reason: 'GM ok' }, update: { fields: { rule: 'level' } } },
  'choice.moreTakes': { add: { kind: 'choice.moreTakes', record: 'fleet', fields: { times: 1 }, reason: 'Fleet twice' }, update: { fields: { times: 2 } } },
  'choice.addPlace': { add: { kind: 'choice.addPlace', fields: { place: 'feat', level: 4, category: 'class' }, reason: 'Boon' }, update: { fields: { category: 'general' } } },
  'remove.choicePlace': { add: { kind: 'remove.choicePlace', fields: { place: 'feat', level: 4, category: 'class', ordinal: 0 }, reason: 'Curse' }, update: { fields: { ordinal: 1 } } },
  // WP13 (re-scoped 2026-10-25): "Change an answer" (WP10) and "Edit a list" (WP9) come after the record rebuild, so
  // the door refuses them (NOT_YET_DRAFTS below); they are no WRITTEN_KINDS until their WP builds them.
};
/** WP13: a draft of each kind nothing applies yet (applies: 'not-yet') — the write door refuses every one. */
const NOT_YET_DRAFTS: Record<string, TweakDraft> = {
  'choice.changeAnswer': { kind: 'choice.changeAnswer', record: 'rogue-dedication', fields: { question: 'skillSlot', index: 0, value: 'stealth' }, reason: 'GM' },
  'choice.editOptions': { kind: 'choice.editOptions', record: 'variable-core', fields: { question: 'choice', add: ['fire'] }, reason: 'Homebrew' },
};
const WRITTEN_KINDS = BLOCK_KINDS.filter((k) => k.editor && k.applies !== 'not-yet').map((k) => k.id);

/** A character carrying an entry in every old key, a known block, two foreign blocks, a key and a meta
 *  key this version does not know, and a part-A-era meta without `of`. */
const FOREIGN_KIND = { id: 't7', kind: 'strike.extraDamage', v: 1, target: 'attack', value: '1d6 fire' };
const FOREIGN_NEWER = { id: 't9', kind: 'number.add', v: 2, target: 'skill:athletics', value: 1, curve: [1, 5] };
const BASE: BuildOverrides = {
  attributes: { str: 18 },
  proficiencies: { athletics: 'expert', 'lore:Sailing Lore': 'trained' },
  maxHp: 50,
  addedFeats: [
    { featId: 'fleet', level: 3, category: 'general' },
    { featId: 'fleet', level: 3, category: 'general' },
  ],
  addedFeatures: [{ featureId: 'reactive-strike', level: 1 }],
  addedLanguages: ['draconic'],
  addedSpells: [{ spellId: 'light', rank: 1 }],
  removedFeatIds: ['shield-block'],
  allowedFeats: ['risky'],
  contentEdits: { feats: { fleet: { name: 'Quick Feet', traits: ['general'] } } },
  blocks: [FOREIGN_KIND, { id: 't1', kind: 'number.add', v: 1, target: 'skill:athletics', value: 1, reason: 'Gift' }, FOREIGN_NEWER],
  meta: {
    'proficiencies:athletics': { reason: 'Guild training' },
    'addedFeats:fleet@3': { reason: 'first', of: 'fleet@3' },
    'addedFeats:fleet@3~2': { reason: 'second', of: 'fleet@3', on: false },
    'addedFeats:gone@9': { reason: 'orphan of an entry an older app removed', of: 'gone@9' },
    'futureMetaKey:x': { reason: 'a newer app wrote this' } as TweakMeta,
  },
  ...({ futureKey: { keep: 'me' } } as object),
};

const metaOf = (ov: BuildOverrides | undefined): Record<string, TweakMeta> => (ov?.meta ?? {}) as Record<string, TweakMeta>;
const ok = (host: TweakHost, w: TweakWrite): BuildOverrides => {
  const r = writeTweak(host, w);
  expect(r.refused, `refused: ${r.refused}`).toBeUndefined();
  return r.overrides!;
};
/** Every meta the write changed or added carries `of` = the entry's identity as readLegacyBlocks reads it. */
function expectWrittenMetaCarriesOf(prev: BuildOverrides | undefined, next: BuildOverrides | undefined) {
  const before = metaOf(prev);
  const ofByKey = new Map(legacyEntries(next).map((e) => [e.key, e.of]));
  for (const [k, m] of Object.entries(metaOf(next))) {
    if (before[k] === m) continue; // untouched
    expect(m.of, `meta "${k}" written without of`).toBeDefined();
    if (ofByKey.has(k)) expect(m.of, `meta "${k}" of`).toBe(ofByKey.get(k));
  }
}
/** Every write a player can make on BASE: an add of each kind, and update / setOn / remove / repoint of
 *  every tweak BASE holds. */
function everyOp(ov: BuildOverrides): [string, TweakWrite][] {
  const ops: [string, TweakWrite][] = WRITTEN_KINDS.map((k) => [`add ${k}`, { op: 'add', draft: FIXTURES[k].add }]);
  for (const inst of readTweaks(ov).instances) {
    ops.push([`setOn false ${inst.key}`, { op: 'setOn', key: inst.key, on: false }]);
    ops.push([`setOn true ${inst.key}`, { op: 'setOn', key: inst.key, on: true }]);
    ops.push([`update ${inst.key}`, { op: 'update', key: inst.key, draft: { reason: 'changed' } }]);
    ops.push([`remove ${inst.key}`, { op: 'remove', key: inst.key }]);
    if (inst.record) ops.push([`repoint ${inst.key}`, { op: 'repoint', key: inst.key, record: `${inst.record.startsWith('feats/') ? 'feats/' : ''}elsewhere`, ...(inst.kind === 'grant.feat' ? { category: 'skill' as const } : {}) }]);
  }
  return ops;
}

describe('the write door: of, and meta follows the entry (plan 5.2, open point 1)', () => {
  it('every kind a player writes has a fixture here (a new kind cannot skip the of test)', () => {
    expect(WRITTEN_KINDS.filter((k) => !FIXTURES[k])).toEqual([]);
  });

  it('WP13: every kind nothing applies yet has a draft here, and the door refuses it in its own words', () => {
    const notYet = BLOCK_KINDS.filter((k) => k.applies === 'not-yet');
    expect(notYet.map((k) => k.id).filter((id) => !NOT_YET_DRAFTS[id])).toEqual([]);
    for (const k of notYet) {
      const r = writeTweak({ overrides: BASE }, { op: 'add', draft: NOT_YET_DRAFTS[k.id] });
      expect(r.refused, k.id).toBe(`${k.title} is not in this version yet`);
      expect(r.overrides, `${k.id}: a refusal hands back what it was given, untouched`).toBe(BASE);
    }
  });

  it.each(WRITTEN_KINDS)('every write carries `of` on every meta it writes: %s (add, update, pause, resume, repoint)', (kind) => {
    const { add, update } = FIXTURES[kind];
    // BASE already sets max HP (one set per character): that kind starts from BASE without it.
    const start: BuildOverrides = kind === 'number.setMaxHp' ? { ...BASE, maxHp: undefined } : BASE;
    const added = ok({ overrides: start }, { op: 'add', draft: add });
    expectWrittenMetaCarriesOf(start, added);
    const mine = readTweaks(added).instances.find((i) => i.kind === kind && !readTweaks(start).instances.some((b) => b.key === i.key));
    expect(mine, `the added ${kind} is not read back`).toBeTruthy();
    expect(mine!.reason).toBe(add.reason);
    const updated = ok({ overrides: added }, { op: 'update', key: mine!.key, draft: update });
    expectWrittenMetaCarriesOf(added, updated);
    const edited = readTweaks(updated).instances.find((i) => i.kind === kind && i.reason === add.reason);
    expect(edited, `the edited ${kind} lost its reason`).toBeTruthy();
    const paused = ok({ overrides: updated }, { op: 'setOn', key: edited!.key, on: false });
    expectWrittenMetaCarriesOf(updated, paused);
    expect(readTweaks(paused).instances.find((i) => i.key === edited!.key)!.on).toBe(false);
    const resumed = ok({ overrides: paused }, { op: 'setOn', key: edited!.key, on: true });
    expectWrittenMetaCarriesOf(paused, resumed);
    expect(readTweaks(resumed).instances.find((i) => i.key === edited!.key)!.on).toBe(true);
  });

  it('every op on a full character writes `of` on every meta it writes (it.each over ops on BASE)', () => {
    for (const [name, w] of everyOp(BASE)) {
      const r = writeTweak({ overrides: BASE }, w);
      if (r.refused) continue;
      try {
        expectWrittenMetaCarriesOf(BASE, r.overrides);
      } catch (e) {
        throw new Error(`${name}: ${(e as Error).message}`);
      }
    }
  });

  it("editing a given feat's level moves its meta to the new key (addedFeats:fleet@3 → @5)", () => {
    const ov: BuildOverrides = { addedFeats: [{ featId: 'fleet', level: 3, category: 'general' }], meta: { 'addedFeats:fleet@3': { reason: 'GM reward', on: false, of: 'fleet@3' } } };
    const next = ok({ overrides: ov }, { op: 'update', key: 'addedFeats:fleet@3', draft: { level: 5 } });
    expect(next.addedFeats).toEqual([{ featId: 'fleet', level: 5, category: 'general' }]);
    expect(next.meta).toEqual({ 'addedFeats:fleet@5': { reason: 'GM reward', on: false, of: 'fleet@5' } });
  });

  it("editing a given spell's rank moves its meta (addedSpells:fireball@3 → @4)", () => {
    const ov: BuildOverrides = { addedSpells: [{ spellId: 'fireball', rank: 3 }], meta: { 'addedSpells:fireball@3': { reason: 'Scroll', of: 'fireball@3' } } };
    const next = ok({ overrides: ov }, { op: 'update', key: 'addedSpells:fireball@3', draft: { spellRank: 4 } });
    expect(next.addedSpells).toEqual([{ spellId: 'fireball', rank: 4 }]);
    expect(next.meta).toEqual({ 'addedSpells:fireball@4': { reason: 'Scroll', of: 'fireball@4' } });
  });

  it('a repeat entry (~2) keeps its own meta when its twin moves', () => {
    // BASE: fleet@3 ("first") and its repeat fleet@3~2 ("second", paused). Move the FIRST to level 5: the
    // repeat's key becomes plain fleet@3, and its own reason and pause go with it.
    const next = ok({ overrides: BASE }, { op: 'update', key: 'addedFeats:fleet@3', draft: { level: 5 } });
    const m = metaOf(next);
    expect(m['addedFeats:fleet@5']).toEqual({ reason: 'first', of: 'fleet@5' });
    expect(m['addedFeats:fleet@3']).toEqual({ reason: 'second', of: 'fleet@3', on: false });
    expect(m['addedFeats:fleet@3~2']).toBeUndefined();
    // …and removing the first likewise hands the repeat its plain key, with ITS meta
    const fewer = ok({ overrides: BASE }, { op: 'remove', key: 'addedFeats:fleet@3' });
    expect(metaOf(fewer)['addedFeats:fleet@3']).toEqual({ reason: 'second', of: 'fleet@3', on: false });
    expect(metaOf(fewer)['addedFeats:fleet@3~2']).toBeUndefined();
  });

  it('an edit never hands an orphan meta to an untouched twin whose key shifts onto it', () => {
    // checker WP1 fix round 2: an older app removed a feat and left its meta at `fleet@5~2`. Moving the
    // first Fleet to level 5 shifts the untouched second Fleet onto `fleet@5~2`: it must stay ON.
    const ov: BuildOverrides = {
      addedFeats: [
        { featId: 'fleet', level: 3, category: 'general' },
        { featId: 'fleet', level: 5, category: 'general' },
      ],
      meta: { 'addedFeats:fleet@5~2': { on: false, of: 'fleet@5' } },
    };
    expect(readTweaks(ov).instances.map((i) => i.on)).toEqual([true, true]);
    const next = ok({ overrides: ov }, { op: 'update', key: 'addedFeats:fleet@3', draft: { level: 5 } });
    expect(readTweaks(next).instances.map((i) => [i.key, i.on])).toEqual([
      ['addedFeats:fleet@5', true],
      ['addedFeats:fleet@5~2', true],
    ]);
    // WP10 fix round 1: the edited entry keeps its own `{ of }` (a meta-less entry is stamped "moved" at Save);
    // the untouched twin gets nothing.
    expect(next.meta).toEqual({ 'addedFeats:fleet@5': { of: 'fleet@5' } });
    // the same for a repoint and for a twin that does carry its own meta (it keeps exactly that)
    const own: BuildOverrides = { ...ov, meta: { ...ov.meta, 'addedFeats:fleet@5': { reason: 'mine', of: 'fleet@5' } } };
    const moved = ok({ overrides: own }, { op: 'repoint', key: 'addedFeats:fleet@3', record: 'fleet', category: 'general' });
    expect(moved.meta).toEqual({ ...own.meta, 'addedFeats:fleet@3': { of: 'fleet@3' } }); // nothing shifted: fleet@3 stays fleet@3
    const shifted = ok({ overrides: own }, { op: 'update', key: 'addedFeats:fleet@3', draft: { level: 5 } });
    expect(shifted.meta).toEqual({ 'addedFeats:fleet@5': { of: 'fleet@5' }, 'addedFeats:fleet@5~2': { reason: 'mine', of: 'fleet@5' } });
  });

  it('removing an entry drops its meta, so re-adding it starts clean', () => {
    const ov: BuildOverrides = { addedLanguages: ['elven'], meta: { 'addedLanguages:elven': { on: false, reason: 'paused', of: 'elven' } } };
    const gone = writeTweak({ overrides: ov }, { op: 'remove', key: 'addedLanguages:elven' });
    expect(gone.overrides).toBeUndefined();
    const back = ok({ overrides: gone.overrides }, { op: 'add', draft: { kind: 'grant.language', record: 'elven' } });
    expect(back).toEqual({ addedLanguages: ['elven'], meta: { 'addedLanguages:elven': { of: 'elven' } } }); // WP10: its own { of }, nothing of the old meta
    expect(readTweaks(back).instances[0].on).toBe(true);
    // an older app that removed the entry but left its meta behind: an add never inherits it
    const orphan: BuildOverrides = { meta: { 'addedLanguages:elven': { on: false, of: 'elven' } }, maxHp: 30 };
    const added = ok({ overrides: orphan }, { op: 'add', draft: { kind: 'grant.language', record: 'elven' } });
    expect(readTweaks(added).instances.find((i) => i.key === 'addedLanguages:elven')!.on).toBe(true);
  });

  it('a rank write keeps the rank in proficiencies (a Lore under its loreKey) and mode + of in meta', () => {
    const lore = ok({ overrides: undefined }, { op: 'add', draft: { kind: 'rank.atLeast', target: 'skill:lore:sailing', rank: 'expert' } });
    expect(lore).toEqual({ proficiencies: { 'lore:sailing': 'expert' }, meta: { 'proficiencies:lore:sailing': { mode: 'atLeast', of: 'expert' } } });
    const save = ok({ overrides: undefined }, { op: 'add', draft: { kind: 'rank.exactly', target: 'save:fortitude', rank: 'trained', reason: 'Cursed' } });
    expect(save).toEqual({ proficiencies: { fortitude: 'trained' }, meta: { 'proficiencies:fortitude': { mode: 'exactly', reason: 'Cursed', of: 'trained' } } });
    for (const [target, key] of [['perception', 'perception'], ['class-dc', 'classDc'], ['weapon:martial', 'martial'], ['armor:light', 'light']] as const) {
      const r = ok({ overrides: undefined }, { op: 'add', draft: { kind: 'rank.atLeast', target, rank: 'expert' } });
      expect(r.proficiencies, target).toEqual({ [key]: 'expert' });
    }
    // switching "at least" → "exactly" keeps the rank where it is and rewrites the mode
    const flipped = ok({ overrides: save }, { op: 'update', key: 'proficiencies:fortitude', draft: { kind: 'rank.atLeast' } });
    expect(flipped.meta).toEqual({ 'proficiencies:fortitude': { mode: 'atLeast', reason: 'Cursed', of: 'trained' } });
    // a set kind that is not a rank, a spell rank or a raw Lore name is not a rank target
    expect(writeTweak({}, { op: 'add', draft: { kind: 'rank.atLeast', target: 'skill:lore:Sailing Lore', rank: 'expert' } }).refused).toBeTruthy();
    expect(writeTweak({}, { op: 'add', draft: { kind: 'rank.atLeast', target: 'ac', rank: 'expert' } }).refused).toBeTruthy();
    expect(writeTweak({}, { op: 'add', draft: { kind: 'rank.atLeast', target: 'skill:stealth', rank: 'Expert' as never } }).refused).toBeTruthy();
    // nobody writes the old unsorted kind
    expect(writeTweak({}, { op: 'add', draft: { kind: 'rank.legacySet', target: 'skill:stealth', rank: 'expert' } }).refused).toMatch(/no player writes/);
  });

  it('the first update of an entry drops moved; setOn keeps it (B11, B26)', () => {
    const ov: BuildOverrides = {
      proficiencies: { stealth: 'expert' },
      meta: { 'proficiencies:stealth': { mode: 'atLeast', of: 'expert', moved: true, reason: 'Old' } },
    };
    const paused = ok({ overrides: ov }, { op: 'setOn', key: 'proficiencies:stealth', on: false });
    expect(metaOf(paused)['proficiencies:stealth']).toEqual({ mode: 'atLeast', of: 'expert', moved: true, reason: 'Old', on: false });
    const resumed = ok({ overrides: paused }, { op: 'setOn', key: 'proficiencies:stealth', on: true });
    expect(metaOf(resumed)['proficiencies:stealth']).toEqual({ mode: 'atLeast', of: 'expert', moved: true, reason: 'Old' });
    const edited = ok({ overrides: ov }, { op: 'update', key: 'proficiencies:stealth', draft: { reason: 'Old' } });
    expect(metaOf(edited)['proficiencies:stealth']).toEqual({ mode: 'atLeast', of: 'expert', reason: 'Old' });
    expect(readTweaks(edited).instances[0].moved).toBeUndefined();
  });

  it("the first edit of a given feat folds an old meta.from into its stored level (B10); later edits write the level, never from", () => {
    const ov: BuildOverrides = { addedFeats: [{ featId: 'fleet', level: 1, category: 'general' }], meta: { 'addedFeats:fleet@1': { from: 5, reason: 'later', of: 'fleet@1' } } };
    const next = ok({ overrides: ov }, { op: 'update', key: 'addedFeats:fleet@1', draft: { reason: 'later' } });
    expect(next.addedFeats).toEqual([{ featId: 'fleet', level: 5, category: 'general' }]);
    expect(next.meta).toEqual({ 'addedFeats:fleet@5': { reason: 'later', of: 'fleet@5' } });
    const add = ok({}, { op: 'add', draft: { kind: 'grant.feat', record: 'fleet', category: 'general', from: 7 } });
    expect(add).toEqual({ addedFeats: [{ featId: 'fleet', level: 7, category: 'general' }], meta: { 'addedFeats:fleet@7': { of: 'fleet@7' } } }); // WP10: no `from`, its { of }
  });

  // WP10 fix round 1 (the browser test, step 9): plan 5.2 said a meta reduced to `{ of }` is dropped, but an entry
  // with no meta is what the Save stamp marks "Moved from Overrides" (plan 3.3 step 3). `{ of }` stays.
  it('setOn(true) deletes on; a meta reduced to { of } alone STAYS (WP10: a meta-less entry reads as moved)', () => {
    const ov: BuildOverrides = { addedLanguages: ['elven'], meta: { 'addedLanguages:elven': { on: false, of: 'elven' } } };
    expect(ok({ overrides: ov }, { op: 'setOn', key: 'addedLanguages:elven', on: true })).toEqual({ addedLanguages: ['elven'], meta: { 'addedLanguages:elven': { of: 'elven' } } });
  });
});

describe('the write door: UNKNOWN ≠ EMPTY (item 13)', () => {
  it('an unknown kind or a newer version in overrides.blocks survives every write byte for byte', () => {
    for (const [name, w] of everyOp(BASE)) {
      const next = writeTweak({ overrides: BASE }, w).overrides;
      const list = (next?.blocks ?? []) as unknown[];
      expect(list.includes(FOREIGN_KIND), `${name} dropped the unknown kind`).toBe(true);
      expect(list.includes(FOREIGN_NEWER), `${name} dropped the newer version`).toBe(true);
      expect(list.indexOf(FOREIGN_KIND), `${name} moved the unknown kind`).toBe(0);
    }
  });

  it('an unknown key inside overrides and unknown meta keys survive every write', () => {
    for (const [name, w] of everyOp(BASE)) {
      const next = writeTweak({ overrides: BASE }, w).overrides as Record<string, unknown>;
      expect(next.futureKey, name).toBe((BASE as Record<string, unknown>).futureKey);
      expect(metaOf(next as BuildOverrides)['futureMetaKey:x'], name).toBe(metaOf(BASE)['futureMetaKey:x']);
      // an orphan meta (its entry gone) is not this write's to delete
      expect(metaOf(next as BuildOverrides)['addedFeats:gone@9'], name).toBe(metaOf(BASE)['addedFeats:gone@9']);
    }
    // unknown fields on an element of an old key, and on a known block, are kept through an edit
    const ov: BuildOverrides = {
      addedFeats: [{ featId: 'fleet', level: 3, category: 'general', grantedBy: 'gm' } as never],
      blocks: [{ id: 't1', kind: 'number.add', v: 1, target: 'ac', value: 1, whileState: 'raging' }],
    };
    const a = ok({ overrides: ov }, { op: 'update', key: 'addedFeats:fleet@3', draft: { level: 4 } });
    expect(a.addedFeats).toEqual([{ featId: 'fleet', level: 4, category: 'general', grantedBy: 'gm' }]);
    const b = ok({ overrides: ov }, { op: 'update', key: 'blocks:t1', draft: { value: 2 } });
    expect(b.blocks).toEqual([{ id: 't1', kind: 'number.add', v: 1, target: 'ac', value: 2, whileState: 'raging' }]);
  });

  it('an edit aimed at a foreign block is refused and changes nothing', () => {
    for (const w of [
      { op: 'update', key: 'blocks:t7', draft: { value: 3 } },
      { op: 'setOn', key: 'blocks:t9', on: false },
      { op: 'remove', key: 'blocks:t9' },
      { op: 'repoint', key: 'blocks:t7', target: 'ac' },
    ] as TweakWrite[]) {
      const r = writeTweak({ overrides: BASE }, w);
      expect(r.refused, JSON.stringify(w)).toMatch(/newer version|cannot be read/);
      expect(r.overrides).toBe(BASE);
    }
    expect(writeTweak({ overrides: BASE }, { op: 'remove', key: 'addedFeats:nope@1' }).refused).toMatch(/no tweak/);
    expect(writeTweak({ overrides: BASE }, { op: 'add', draft: { kind: 'strike.extraDamage' } }).refused).toMatch(/not a kind/);
  });

  it('a meta this version cannot read is kept whole: a write that needs it is refused', () => {
    const odd = { addedLanguages: ['elven'], meta: 'v9-format' as never };
    const r = writeTweak({ overrides: odd }, { op: 'add', draft: { kind: 'grant.language', record: 'sylvan' } });
    expect(r.refused).toBeTruthy();
    expect(r.overrides).toBe(odd);
  });

  it('an old key in a shape this version cannot read is never overwritten by an add', () => {
    const cases: [BuildOverrides, TweakDraft][] = [
      [{ addedFeats: { x: 1 } as never }, FIXTURES['grant.feat'].add],
      [{ addedFeatures: 'shield-block' as never }, FIXTURES['grant.classFeature'].add],
      [{ addedLanguages: 'elven' as never }, { kind: 'grant.language', record: 'x' }],
      [{ addedSpells: { light: 1 } as never }, FIXTURES['grant.spell'].add],
      [{ removedFeatIds: 'old' as never }, FIXTURES['remove.feat'].add],
      [{ allowedFeats: 7 as never }, FIXTURES['choice.allowAnyway'].add],
      [{ attributes: [18] as never }, FIXTURES['attribute.set'].add],
      [{ proficiencies: 'weird' as never }, { kind: 'rank.atLeast', target: 'skill:stealth', rank: 'expert' }],
      [{ maxHp: '40' as never }, FIXTURES['number.setMaxHp'].add],
      [{ contentEdits: ['x'] as never }, FIXTURES['text.edit'].add],
      [{ contentEdits: { feats: 'v9' } as never }, FIXTURES['text.edit'].add],
    ];
    for (const [ov, draft] of cases) {
      const r = writeTweak({ overrides: ov }, { op: 'add', draft });
      expect(r.refused, JSON.stringify(ov)).toMatch(/newer version or cannot be read/);
      expect(r.overrides).toBe(ov);
    }
    // re-pointing a text edit into a bucket this version cannot read is refused too; the readable bucket is untouched
    const ce: BuildOverrides = { contentEdits: { feats: { fleet: { name: 'Quick' } }, classFeatures: 'v9' } as never };
    const r = writeTweak({ overrides: ce }, { op: 'repoint', key: 'contentEdits:feats/fleet', record: 'classFeatures/shield-block' });
    expect(r.refused).toMatch(/newer version or cannot be read/);
    expect(r.overrides).toBe(ce);
    // an edit of a readable entry beside it still works and keeps the unreadable bucket as it is
    const edited = ok({ overrides: ce }, { op: 'update', key: 'contentEdits:feats/fleet', draft: { text: { name: 'Quicker' } } });
    expect(edited.contentEdits).toEqual({ feats: { fleet: { name: 'Quicker' } }, classFeatures: 'v9' });
  });

  it('a new number block gets an id no stored element has, foreign ones included', () => {
    // tweaks p2 WP1: newBlockId v2 (plan C4) mints `t<max+1>_<4 random base-36>` — the random tail keeps two tabs'
    // new blocks apart under the roster merge — so the number part is asserted and the tail by its shape.
    expect(newBlockId(undefined)).toMatch(/^t1_[0-9a-z]{4}$/);
    expect(newBlockId(BASE)).toMatch(/^t10_[0-9a-z]{4}$/); // t9 is a foreign (newer) element
    const next = ok({ overrides: BASE }, { op: 'add', draft: FIXTURES['number.add'].add });
    const ids = (next.blocks as { id: string }[]).map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.at(-1)).toMatch(/^t10_[0-9a-z]{4}$/); // tweaks p2 WP1: v2 id (C4)
    expect(newBlockId({ blocks: [{ id: 'x5' }, 'junk', { id: 't3' }, { id: 't03' }] })).toMatch(/^t4_[0-9a-z]{4}$/); // tweaks p2 WP1: v2 id (C4)
    // tweaks p2 WP1: the scan reads a v2 id too (C4), so an older app's plain t<n> and a v2 t<n>_xxxx never collide
    expect(newBlockId({ blocks: [{ id: 't3' }, { id: 't8_k3f9' }] }, () => 0)).toBe('t9_0000');
  });
});

describe('the write door: v, the switch and the empty shell (B15, B27)', () => {
  it('an overrides object holding nothing but v (and empty meta) becomes undefined', () => {
    const one: BuildOverrides = { v: 2, maxHp: 30, meta: { 'maxHp:max-hp': { reason: 'x', of: '30' } } };
    expect(writeTweak({ overrides: one, options: { overridesEnabled: true } }, { op: 'remove', key: 'maxHp:max-hp' }).overrides).toBeUndefined();
    const block: BuildOverrides = { v: 2, blocks: [{ id: 't1', kind: 'number.add', v: 1, target: 'ac', value: 1 }] };
    expect(writeTweak({ overrides: block, options: { overridesEnabled: true } }, { op: 'remove', key: 'blocks:t1' }).overrides).toBeUndefined();
    // an orphan meta still says something: kept (UNKNOWN ≠ EMPTY)
    const orphan: BuildOverrides = { v: 2, maxHp: 30, meta: { 'addedFeats:gone@1': { reason: 'x', of: 'gone@1' } } };
    expect(writeTweak({ overrides: orphan, options: { overridesEnabled: true } }, { op: 'remove', key: 'maxHp:max-hp' }).overrides).toEqual({
      v: 2,
      meta: { 'addedFeats:gone@1': { reason: 'x', of: 'gone@1' } },
    });
  });

  it('setTweaksSwitch writes v and overridesEnabled together, always returns a NEW overrides object when overrides exist, and only the option when there are none', () => {
    const opts: CharacterOptions = { ignoreBulk: true };
    const off = setTweaksSwitch({ overrides: BASE, options: opts }, false);
    expect(off.overrides).not.toBe(BASE);
    expect(off.overrides).toEqual({ ...BASE, v: 2 });
    expect(off.options).toEqual({ ignoreBulk: true, overridesEnabled: false });
    expect(tweaksSwitchOn(off)).toBe(false);
    const on = setTweaksSwitch(off, true);
    expect(on.overrides).not.toBe(off.overrides);
    expect(tweaksSwitchOn(on)).toBe(true);
    const none = setTweaksSwitch({ options: opts }, true);
    expect(none).toEqual({ options: { ignoreBulk: true, overridesEnabled: true } });
    expect('overrides' in none).toBe(false);
  });

  const hosts: [string, TweakHost][] = [
    ['v absent, option unset (an old character: reads ON)', { overrides: BASE }],
    ['v absent, option false (an old card hidden: still reads ON)', { overrides: BASE, options: { overridesEnabled: false } }],
    ['stamped, on', { overrides: { ...BASE, v: 2 }, options: { overridesEnabled: true } }],
    ['stamped, off', { overrides: { ...BASE, v: 2 }, options: { overridesEnabled: false } }],
  ];
  it.each(hosts)('no write except setTweaksSwitch changes what tweaksSwitchOn reads: %s', (_name, host) => {
    const before = tweaksSwitchOn(host);
    for (const [name, w] of everyOp(host.overrides!)) {
      const r = writeTweak(host, w);
      expect(r.overrides, `${name} emptied the fixture`).toBeDefined();
      expect(tweaksSwitchOn({ overrides: r.overrides, options: host.options }), name).toBe(before);
      if (host.overrides!.v === undefined) expect(r.overrides!.v, `${name} wrote v on an unstamped host`).toBeUndefined();
    }
  });

  it('a brand-new character switched on in Options gets v with its first tweak (the switch already reads the option)', () => {
    const r = ok({ options: { overridesEnabled: true } }, { op: 'add', draft: FIXTURES['grant.language'].add });
    expect(r.v).toBe(2);
    expect(tweaksSwitchOn({ overrides: r, options: { overridesEnabled: true } })).toBe(true);
    expect(ok({}, { op: 'add', draft: FIXTURES['grant.language'].add }).v).toBeUndefined();
  });

  it('markImported on an overrides object without v returns one without v; dropEntries likewise', () => {
    const ov: BuildOverrides = { addedFeats: [{ featId: 'fleet', level: 3, category: 'general' }], addedSpells: [{ spellId: 'light', rank: 1 }] };
    expect('v' in markImported(ov, 'addedFeats', 0)).toBe(false);
    expect('v' in markImported(ov, 'addedSpells', 0)).toBe(false);
    const dropped = dropEntries(ov, 'addedSpells', () => false)!;
    expect(dropped).toEqual({ addedFeats: [{ featId: 'fleet', level: 3, category: 'general' }] });
    expect('v' in dropped).toBe(false);
    // dropping everything leaves no overrides at all; dropping nothing returns the same object
    expect(dropEntries({ addedSpells: [{ spellId: 'light', rank: 1 }] }, 'addedSpells', () => false)).toBeUndefined();
    expect(dropEntries(ov, 'addedFeats', () => true)).toBe(ov);
  });

  it('dropEntries drops the meta of what it removes and keeps the rest with their own meta', () => {
    const next = dropEntries(BASE, 'addedFeats', (e) => (e as { featId: string }).featId !== 'fleet')!;
    expect(next.addedFeats).toBeUndefined();
    expect(metaOf(next)['addedFeats:fleet@3']).toBeUndefined();
    expect(metaOf(next)['addedFeats:fleet@3~2']).toBeUndefined();
    expect(metaOf(next)['proficiencies:athletics']).toBe(metaOf(BASE)['proficiencies:athletics']);
    const ov: BuildOverrides = {
      addedSpells: [
        { spellId: 'gone', rank: 1 },
        { spellId: 'light', rank: 1 },
        { spellId: 'light', rank: 1 },
      ],
      meta: { 'addedSpells:light@1~2': { reason: 'the second light', of: 'light@1' } },
    };
    const kept = dropEntries(ov, 'addedSpells', (e) => (e as { spellId: string }).spellId !== 'gone')!;
    expect(kept.meta).toEqual({ 'addedSpells:light@1~2': { reason: 'the second light', of: 'light@1' } });
    const firstLightGone = dropEntries({ ...ov, addedSpells: ov.addedSpells!.slice(1) }, 'addedSpells', (() => {
      let n = 0;
      return () => n++ !== 0;
    })())!;
    expect(firstLightGone.meta).toEqual({ 'addedSpells:light@1': { reason: 'the second light', of: 'light@1' } });
  });

  it('an overrides object with v: 3 keeps v: 3 through every write and setTweaksSwitch (B27)', () => {
    const host: TweakHost = { overrides: { ...BASE, v: 3 }, options: { overridesEnabled: true } };
    for (const [name, w] of everyOp(host.overrides!)) expect(writeTweak(host, w).overrides?.v, name).toBe(3);
    expect(setTweaksSwitch(host, false).overrides!.v).toBe(3);
    expect(setTweaksSwitch(host, true).overrides!.v).toBe(3);
    expect(markImported(host.overrides!, 'addedFeats', 0).v).toBe(3);
    expect(dropEntries(host.overrides!, 'addedSpells', () => false)!.v).toBe(3);
  });

  it("markImported stamps only entries from the given index, with source 'import' and of", () => {
    const ov: BuildOverrides = {
      addedFeats: [
        { featId: 'fleet', level: 3, category: 'general' },
        { featId: 'toughness', level: 1, category: 'general' },
        { featId: 'toughness', level: 1, category: 'general' },
      ],
      meta: { 'addedFeats:fleet@3': { reason: 'mine', of: 'fleet@3' }, 'addedFeats:toughness@1': { on: false, of: 'toughness@1' } },
    };
    const next = markImported(ov, 'addedFeats', 1);
    expect(next.meta).toEqual({
      'addedFeats:fleet@3': { reason: 'mine', of: 'fleet@3' },
      'addedFeats:toughness@1': { source: 'import', of: 'toughness@1' },
      'addedFeats:toughness@1~2': { source: 'import', of: 'toughness@1' },
    });
    expect(next.addedFeats).toBe(ov.addedFeats);
    expect(markImported(ov, 'addedFeats', 3)).toBe(ov);
    expect(readTweaks(next).instances.filter((i) => i.imported).map((i) => i.key)).toEqual(['addedFeats:toughness@1', 'addedFeats:toughness@1~2']);
    const spells = markImported({ addedSpells: [{ spellId: 'light', rank: 1 }, { spellId: 'consecrate', rank: 2 }] }, 'addedSpells', 1);
    expect(spells.meta).toEqual({ 'addedSpells:consecrate@2': { source: 'import', of: 'consecrate@2' } });
  });
});

describe('the write door: values each kind can hold', () => {
  it('refuses a value the kind cannot hold, and a second set on the same thing', () => {
    expect(writeTweak({}, { op: 'add', draft: { kind: 'number.add', target: 'skill:athletics', value: Number.NaN } }).refused).toBeTruthy();
    expect(writeTweak({}, { op: 'add', draft: { kind: 'number.add', target: 'luck', value: 1 } }).refused).toBeTruthy();
    expect(writeTweak({}, { op: 'add', draft: { kind: 'number.set', target: 'max-hp', value: 1 } }).refused).toBeTruthy(); // max HP has its own set
    expect(writeTweak({}, { op: 'add', draft: { kind: 'number.set', target: 'ac', value: 1, bonusType: 'item' } }).refused).toMatch(/bonus type/);
    expect(writeTweak({ overrides: BASE }, { op: 'add', draft: { kind: 'attribute.set', target: 'score:str', value: 10 } }).refused).toMatch(/already/);
    expect(writeTweak({ overrides: BASE }, { op: 'add', draft: { kind: 'number.setMaxHp', target: 'max-hp', value: 10 } }).refused).toMatch(/already/);
    expect(writeTweak({ overrides: BASE }, { op: 'add', draft: { kind: 'grant.language', record: 'draconic' } }).refused).toMatch(/already/);
    expect(writeTweak({}, { op: 'add', draft: { kind: 'grant.feat', record: 'fleet' } }).refused).toMatch(/category/);
    // checker WP1 fix round 2: a given feat pointed at ANOTHER feat needs that feat's category (never the old one)
    const given: BuildOverrides = { addedFeats: [{ featId: 'power-attack', level: 1, category: 'class' }] };
    expect(writeTweak({ overrides: given }, { op: 'repoint', key: 'addedFeats:power-attack@1', record: 'toughness' }).refused).toMatch(/category/);
    expect(writeTweak({ overrides: given }, { op: 'update', key: 'addedFeats:power-attack@1', draft: { record: 'toughness' } }).refused).toMatch(/category/);
    expect(ok({ overrides: given }, { op: 'repoint', key: 'addedFeats:power-attack@1', record: 'toughness', category: 'general' }).addedFeats).toEqual([{ featId: 'toughness', level: 1, category: 'general' }]);
    expect(ok({ overrides: given }, { op: 'update', key: 'addedFeats:power-attack@1', draft: { level: 2 } }).addedFeats).toEqual([{ featId: 'power-attack', level: 2, category: 'class' }]);
    // …and a second rank tweak on one row is refused by TARGET: an old raw `lore:Sailing Lore` is the Sailing Lore row
    const lore: BuildOverrides = { proficiencies: { 'lore:Sailing Lore': 'trained', stealth: 'expert' } };
    expect(writeTweak({ overrides: lore }, { op: 'add', draft: { kind: 'rank.exactly', target: 'skill:lore:sailing', rank: 'untrained' } }).refused).toMatch(/already has a rank tweak/);
    expect(writeTweak({ overrides: lore }, { op: 'add', draft: { kind: 'rank.exactly', target: 'skill:stealth', rank: 'untrained' } }).refused).toMatch(/already has a rank tweak/);
    expect(writeTweak({ overrides: lore }, { op: 'update', key: 'proficiencies:stealth', draft: { target: 'skill:lore:sailing' } }).refused).toMatch(/already has a rank tweak/);
    // moving the raw Lore entry onto its own canonical row is not a second tweak
    expect(ok({ overrides: lore }, { op: 'update', key: 'proficiencies:lore:Sailing Lore', draft: { kind: 'rank.atLeast', target: 'skill:lore:sailing' } }).proficiencies).toEqual({ 'lore:sailing': 'trained', stealth: 'expert' });
    expect(writeTweak({}, { op: 'add', draft: { kind: 'text.edit', record: 'spells/fireball', text: { name: 'x' } } }).refused).toBeTruthy();
    // B25: remove, "take anyway" and a text edit have no start level — never stored, on add or update
    for (const k of ['remove.feat', 'choice.allowAnyway', 'text.edit']) {
      expect(writeTweak({}, { op: 'add', draft: { ...FIXTURES[k].add, from: 5 } }).refused, k).toMatch(/no start level/);
      const added = ok({}, { op: 'add', draft: FIXTURES[k].add });
      const key = Object.keys(metaOf(added))[0];
      expect(writeTweak({ overrides: added }, { op: 'update', key, draft: { from: 5 } }).refused, k).toMatch(/no start level/);
      expect(Object.values(metaOf(ok({ overrides: added }, { op: 'update', key, draft: { from: undefined, reason: 'y' } })))[0].from, k).toBeUndefined();
    }
  });

  it('a typed bonus is written only where the kind takes one; clearing it in an update removes it', () => {
    const a = ok({}, { op: 'add', draft: { kind: 'number.add', target: 'ac', value: 1, bonusType: 'status' } });
    // tweaks p2 WP1: the minted id is v2 (`t1_<4 random>`, plan C4); every edit keeps it
    const id = (a.blocks as { id: string }[])[0].id;
    expect(id).toMatch(/^t1_[0-9a-z]{4}$/);
    expect(a.blocks).toEqual([{ id, kind: 'number.add', v: 1, target: 'ac', value: 1, bonusType: 'status' }]); // tweaks p2 WP1: v2 id
    const b = ok({ overrides: a }, { op: 'update', key: `blocks:${id}`, draft: { bonusType: undefined, from: 5 } });
    expect(b.blocks).toEqual([{ id, kind: 'number.add', v: 1, target: 'ac', value: 1, from: 5 }]); // tweaks p2 WP1: v2 id
    const c = ok({ overrides: b }, { op: 'update', key: `blocks:${id}`, draft: { kind: 'number.set', value: 20 }, baseline: 18 });
    expect(c.blocks).toEqual([{ id, kind: 'number.set', v: 1, target: 'ac', value: 20, from: 5, baseline: 18 }]); // tweaks p2 WP1: v2 id
  });

  it("a text edit keeps the edit's other fields; a cleared name is removed; re-pointing moves it with its meta", () => {
    const ov: BuildOverrides = {
      contentEdits: { feats: { fleet: { name: 'Quick', traits: ['general'] } as never } },
      meta: { 'contentEdits:feats/fleet': { reason: 'house', of: 'feats/fleet' } },
    };
    const cleared = ok({ overrides: ov }, { op: 'update', key: 'contentEdits:feats/fleet', draft: { text: { name: '' } } });
    expect(cleared.contentEdits).toEqual({ feats: { fleet: { traits: ['general'] } } });
    const moved = ok({ overrides: ov }, { op: 'repoint', key: 'contentEdits:feats/fleet', record: 'classFeatures/shield-block' });
    expect(moved.contentEdits).toEqual({ classFeatures: { 'shield-block': { name: 'Quick', traits: ['general'] } } });
    expect(moved.meta).toEqual({ 'contentEdits:classFeatures/shield-block': { reason: 'house', of: 'classFeatures/shield-block' } });
  });

  it('a text edit typed back to the book (no field left) goes with its meta; one stored as something other than a map is refused, never replaced (WP7 fix round)', () => {
    const ov: BuildOverrides = {
      attributes: { str: 18 },
      contentEdits: { feats: { fleet: { name: 'Quick' } } },
      meta: { 'contentEdits:feats/fleet': { reason: 'house', of: 'feats/fleet' } },
    };
    // Its only field cleared: no empty edit is left standing as a tweak that changes nothing.
    expect(ok({ overrides: ov }, { op: 'update', key: 'contentEdits:feats/fleet', draft: { text: { name: undefined } } })).toEqual({ attributes: { str: 18 } });
    expect(ok({ overrides: ov }, { op: 'update', key: 'contentEdits:feats/fleet', draft: { text: { name: '', description: '' } } })).toEqual({ attributes: { str: 18 } });
    // UNKNOWN ≠ EMPTY: an edit stored as a string (a newer version's shape) is never rebuilt from nothing.
    const odd: BuildOverrides = { contentEdits: { feats: { fleet: 'v9' } } as never };
    expect(readTweaks(odd).instances.map((i) => i.key), 'premise: it reads as a row').toEqual(['contentEdits:feats/fleet']);
    const writes: TweakWrite[] = [
      { op: 'update', key: 'contentEdits:feats/fleet', draft: { text: { name: 'Quicker' } } },
      { op: 'update', key: 'contentEdits:feats/fleet', draft: { text: { name: undefined, description: undefined } } },
      { op: 'repoint', key: 'contentEdits:feats/fleet', record: 'classFeatures/shield-block' },
    ];
    for (const w of writes) {
      const r = writeTweak({ overrides: odd }, w);
      expect(r.refused, JSON.stringify(w)).toMatch(/newer version or cannot be read/);
      expect(r.overrides).toBe(odd);
    }
    // Remove still takes it away (the player's own Delete).
    expect(writeTweak({ overrides: odd }, { op: 'remove', key: 'contentEdits:feats/fleet' }).overrides).toBeUndefined();
  });

  it('a stale meta (its of names another value) keeps only its reason when its entry is edited', () => {
    const ov: BuildOverrides = { maxHp: 40, meta: { 'maxHp:max-hp': { reason: 'old', on: false, baseline: 30, of: '35' } } };
    const next = ok({ overrides: ov }, { op: 'update', key: 'maxHp:max-hp', draft: { value: 41 } });
    expect(next).toEqual({ maxHp: 41, meta: { 'maxHp:max-hp': { reason: 'old', of: '41' } } });
  });
});

/*
 * Plan B WP8 (wp2-report, Out of scope): the Builder's "Take anyway" appended the id to `allowedFeats` by hand,
 * so a feat whose "Take anyway" was PAUSED came out listed twice. `takeAnywayWrite` is the one write it makes now.
 */
describe('takeAnywayWrite: "Take anyway" resumes a paused entry, never lists a feat twice', () => {
  const on: CharacterOptions = { overridesEnabled: true };
  it('none stored: a new choice.allowAnyway with its own { of } (and v 2 where the switch reads the option)', () => {
    const host: TweakHost = { options: on };
    const w = takeAnywayWrite(host, 'risky-feat');
    expect(w).toEqual({ op: 'add', draft: { kind: 'choice.allowAnyway', record: 'risky-feat' } });
    // WP10 fix round 1: the add writes `{ of }` (with no meta the Save stamp would mark it "Moved from Overrides").
    expect(ok(host, w!)).toEqual({ allowedFeats: ['risky-feat'], meta: { 'allowedFeats:risky-feat': { of: 'risky-feat' } }, v: 2 });
  });
  it('a paused entry is switched back on: one entry, its reason kept', () => {
    const ov: BuildOverrides = { v: 2, allowedFeats: ['risky-feat'], meta: { 'allowedFeats:risky-feat': { of: 'risky-feat', on: false, reason: 'GM ok' } } };
    const host: TweakHost = { overrides: ov, options: on };
    const w = takeAnywayWrite(host, 'risky-feat');
    expect(w).toEqual({ op: 'setOn', key: 'allowedFeats:risky-feat', on: true });
    const next = ok(host, w!);
    expect(next?.allowedFeats).toEqual(['risky-feat']);
    expect(next?.meta?.['allowedFeats:risky-feat']).toMatchObject({ of: 'risky-feat', reason: 'GM ok' });
    expect(next?.meta?.['allowedFeats:risky-feat']?.on).not.toBe(false);
  });
  it('an entry already on: nothing to write', () => {
    expect(takeAnywayWrite({ overrides: { allowedFeats: ['risky-feat'] }, options: on }, 'risky-feat')).toBeNull();
  });
  it('another feat stored: the new one is added beside it', () => {
    const host: TweakHost = { overrides: { v: 2, allowedFeats: ['other-feat'] }, options: on };
    expect(ok(host, takeAnywayWrite(host, 'risky-feat')!)?.allowedFeats).toEqual(['other-feat', 'risky-feat']);
  });
  it('the old hand-written append is what the door refuses (planted: a second add of a listed feat)', () => {
    const ov: BuildOverrides = { v: 2, allowedFeats: ['risky-feat'], meta: { 'allowedFeats:risky-feat': { of: 'risky-feat', on: false } } };
    const r = writeTweak({ overrides: ov, options: on }, { op: 'add', draft: { kind: 'choice.allowAnyway', record: 'risky-feat' } });
    expect(r.refused).toMatch(/already listed/);
  });
});

/*
 * Tweaks phase 2, WP1 (plan WP1 Tests; C21, C44): `writeChoiceTweak` writes one or more choice tweaks AND the pick
 * they go with as ONE returned build — the caller's one `setBuild`, one persist and one Ctrl+Z step — and a feat it
 * places goes through featSlots.ts `withFeat`, the Builder's own `setFeat` body.
 */
describe('writeChoiceTweak: the tweaks and the pick are one change (tweaks p2 WP1)', () => {
  type PickHost = { overrides?: BuildOverrides; featPicks: Record<string, string>; featChoices: Record<string, string> };
  const anyList = (rule: string) => ({ kind: 'choice.anyList', record: 'toughness', fields: { rule } });

  it('one returned build holds every tweak AND the pick; the host build is untouched, so one undo step restores it whole', () => {
    const host: PickHost = { featPicks: { '4:class:0': 'power-attack' }, featChoices: {} };
    let patches = 0;
    const r = writeChoiceTweak(host, [anyList('list'), anyList('level')], (b) => {
      patches++;
      return withFeat(b, '4:class:0', 'toughness');
    });
    expect(r.refused).toBeUndefined();
    expect(patches, 'the patch is laid over the build once').toBe(1);
    expect(r.build.featPicks['4:class:0']).toBe('toughness');
    expect(readTweaks(r.build.overrides).instances.map((i) => [i.kind, i.params?.rule])).toEqual([
      ['choice.anyList', 'list'],
      ['choice.anyList', 'level'],
    ]);
    expect(r.keys).toHaveLength(2);
    // The Builder's history holds builds: the one before the write is the host itself, unchanged.
    expect(host).toEqual({ featPicks: { '4:class:0': 'power-attack' }, featChoices: {} });
    // An object patch is laid over the same way.
    expect(writeChoiceTweak(host, [anyList('list')], { featPicks: { '2:class:0': 'toughness' } }).build.featPicks).toEqual({ '2:class:0': 'toughness' });
  });

  it('the first refusal refuses everything: the host build itself comes back, the patch never runs', () => {
    const host: PickHost = { featPicks: { '4:class:0': 'power-attack' }, featChoices: {} };
    let patches = 0;
    const r = writeChoiceTweak(host, [anyList('list'), { kind: 'choice.moreTakes', record: 'fleet', fields: { times: 12 } }], (b) => {
      patches++;
      return b;
    });
    expect(r.refused).toMatch(/wrong kind of value/);
    expect(r.build).toBe(host);
    expect(r.keys).toEqual([]);
    expect(patches).toBe(0);
    expect(writeChoiceTweak(host, [{ kind: 'number.add', target: 'ac', value: 1 }]).refused).toMatch(/not a choice tweak/);
  });

  it("a replace through writeChoiceTweak clears the old feat's featChoices[key] and key#n answers (C44), and only those", () => {
    const host: PickHost = {
      featPicks: { '4:class:0': 'splinter-faith', '4:class:1': 'power-attack' },
      featChoices: { '4:class:0': 'old', '4:class:0#0': 'nature', '4:class:0#1': 'pain', '4:class:1': 'keep', '4:class:10': 'keep too' },
    };
    const r = writeChoiceTweak(host, [anyList('list')], (b) => withFeat(b, '4:class:0', 'toughness'));
    expect(r.build.featPicks).toEqual({ '4:class:0': 'toughness', '4:class:1': 'power-attack' });
    expect(r.build.featChoices, "the old feat's answers go; another slot's stay").toEqual({ '4:class:1': 'keep', '4:class:10': 'keep too' });
    // withFeat with null empties the slot the same way
    expect(withFeat(host, '4:class:0', null)).toEqual({ featPicks: { '4:class:1': 'power-attack' }, featChoices: { '4:class:1': 'keep', '4:class:10': 'keep too' } });
  });

  it('an extra feat place drafted without n gets one no stored place and no key of the build uses at its level (C4)', () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0); // every draw is 100000
    try {
      const host: PickHost = { featPicks: { '4:extraclass:100000': 'toughness' }, featChoices: {} };
      const place = { kind: 'choice.addPlace', fields: { place: 'feat', level: 4, category: 'general' } };
      const r = writeChoiceTweak(host, [place, place]);
      expect(r.refused).toBeUndefined();
      expect(readTweaks(r.build.overrides).instances.map((i) => i.params?.n), 'a key of the build and the first new place are both skipped').toEqual([100001, 100002]);
    } finally {
      spy.mockRestore();
    }
  });

  it('dropChoiceTweak removes the block only; it refuses a key that is no choice tweak', () => {
    const host: PickHost = { featPicks: { '4:extraclass:100000': 'toughness' }, featChoices: { '4:extraclass:100000': 'x' } };
    const w = writeChoiceTweak(host, [{ kind: 'choice.addPlace', fields: { place: 'feat', level: 4, category: 'class', n: 100000 } }]);
    const d = dropChoiceTweak(w.build, w.keys[0]);
    expect(d.refused).toBeUndefined();
    expect(d.build.overrides).toBeUndefined();
    expect(d.build.featPicks).toBe(host.featPicks);
    expect(d.build.featChoices).toBe(host.featChoices);
    expect(dropChoiceTweak(host, 'proficiencies:stealth').refused).toBeTruthy();
  });
});
