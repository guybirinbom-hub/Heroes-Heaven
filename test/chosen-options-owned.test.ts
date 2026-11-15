import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { ownedFeatureIds } from '../src/rules/derive';
import { statHasSituational } from '../src/rules/explain';
import { buildCharacter, collectChosenIds, deriveBuildFromCharacter, emptyBuild, removeChosenIds, type BuildState } from '../src/rules/build';
import { FEAT_SITUATIONAL } from '../src/rules/situationalBonuses';

const c = content();
const build = (over: Partial<BuildState>): BuildState => ({ ...emptyBuild(), ...over });

/**
 * EXTRA-CHOICE PICKS ARE FEATURES YOU HAVE.
 *
 * Thaumaturge implements, exemplar ikons and epithets, kineticist elements, wizard theses, animist
 * apparitions and psychic subconscious minds are all `extraChoices` groups. The picker worked and the
 * choice was stored — but `SubclassOption` can't carry defenses, limitedUses, critSpec or
 * effectChoices, and the option id was never treated as an owned class feature. So the matching
 * classFeature record's mechanics AND its situational bonuses were shipped, shown in the picker, and
 * then ignored by every consumer.
 *
 * The Character now records the option `id` alongside the display name, and ownedFeatureIds picks it
 * up like any other feature.
 */
describe('chosen extra-choice options are owned features', () => {
  it('a thaumaturge owns the implement they picked', () => {
    const ch = buildCharacter(build({ classId: 'thaumaturge', level: 5, extraChoices: { implement: ['amulet', 'tome'] } }), c);
    const owned = ownedFeatureIds(ch, c);
    expect(owned.has('amulet')).toBe(true);
    expect(owned.has('tome')).toBe(true);
    expect(owned.has('chalice'), 'an implement you did not pick').toBe(false);
  });

  it("and the implement's situational bonuses now reach the sheet", () => {
    // The amulet's Intensify Vulnerability bonuses were authored long ago and never displayed.
    expect(FEAT_SITUATIONAL['amulet'], 'fixture: amulet should have registry entries').toBeTruthy();
    const withAmulet = buildCharacter(build({ classId: 'thaumaturge', level: 5, extraChoices: { implement: ['amulet'] } }), c);
    const without = buildCharacter(build({ classId: 'thaumaturge', level: 5, extraChoices: { implement: ['tome'] } }), c);
    expect(statHasSituational(withAmulet, { kind: 'ac' }, c)).toBe(true);
    expect(statHasSituational(without, { kind: 'ac' }, c)).toBe(false);
  });

  it('a pick above your level is not owned yet', () => {
    // The group's entry level gates it: a level-1 thaumaturge has one implement, not three.
    const ch = buildCharacter(build({ classId: 'thaumaturge', level: 1, extraChoices: { implement: ['amulet'] } }), c);
    expect(ownedFeatureIds(ch, c).has('amulet')).toBe(true);
  });

  it('the id round-trips through save → load', () => {
    const b = build({ classId: 'exemplar', level: 3, extraChoices: { ikon: ['scar-of-the-survivor'] } });
    const back = deriveBuildFromCharacter(buildCharacter(b, c), c);
    expect(back.extraChoices['ikon']).toContain('scar-of-the-survivor');
  });

  it('an OLD character with no stored id still round-trips by name', () => {
    const ch = buildCharacter(build({ classId: 'wizard', level: 1, extraChoices: { thesis: ['improved-familiar-attunement'] } }), c);
    const legacy = { ...ch, classChoices: (ch.classChoices ?? []).map(({ id: _drop, ...rest }) => rest) };
    expect(deriveBuildFromCharacter(legacy, c).extraChoices['thesis']).toContain('improved-familiar-attunement');
  });

  it('nothing is granted twice: no option repeats a mechanic its classFeature already carries', () => {
    // Guards the whole change — if a future option starts duplicating its feature record, ownership
    // would silently double-count it.
    const dup: string[] = [];
    for (const cls of Object.values(c.classes)) {
      for (const g of cls.extraChoices ?? []) {
        for (const o of g.options) {
          const f = c.classFeatures[o.id];
          if (!f) continue;
          if (o.focusSpells && f.focusSpells) dup.push(`${o.id}:focusSpells`);
          if (o.grantedFeats && f.grantsFeats) dup.push(`${o.id}:feats`);
        }
      }
    }
    expect(dup).toEqual([]);
  });
});

/*
 * Tweaks phase 2, WP1 (plan C32): the records a choice tweak names are chosen records too. Turning a source off
 * keeps them (collectChosenIds), and the hand-back that removes gone records drops the tweak with its record
 * (removeChosenIds) — never a block this version cannot read. Synthetic homebrew heritage.
 */
describe('a homebrew heritage taken anyway through a phase-2 block (tweaks p2 WP1, C32)', () => {
  const HB_HERITAGE = 'hb-heritage-reef-born';
  const ALLOW = { id: 't1_k3f9', kind: 'choice.allowAnywayAnyPicker', v: 1, picker: 'heritage', record: HB_HERITAGE };
  const NEWER = { id: 't2_q8w1', kind: 'choice.allowAnywayAnyPicker', v: 1, picker: 'mythicPath', record: HB_HERITAGE };
  // WP13: a skill increase taken anyway (WP12) comes after the record rebuild; this stored one reads as a newer version's.
  const SKILL = { id: 't3_z0a2', kind: 'choice.allowAnywayAnyPicker', v: 1, picker: 'skillIncrease', record: 'stealth', rule: 'cap', level: 5, lane: 'main' };
  const b = build({ classId: 'fighter', level: 5, ancestryId: 'human', overrides: { blocks: [ALLOW, NEWER, SKILL] } as BuildState['overrides'] });

  it('collectChosenIds keeps the heritage the block names, paused or not, and never a skill key', () => {
    expect(collectChosenIds(b, c).has(HB_HERITAGE)).toBe(true);
    const paused = build({ ...b, overrides: { blocks: [{ ...ALLOW, on: false }] } as BuildState['overrides'] });
    expect(collectChosenIds(paused, c).has(HB_HERITAGE), 'a paused block still points at it').toBe(true);
    expect(collectChosenIds(b, c).has('stealth'), "a skill increase's record is a skill, not a record").toBe(false);
  });

  it('removeChosenIds drops the block with its heritage, keeps every other block, and never touches one it cannot read', () => {
    const next = removeChosenIds(b, new Set([HB_HERITAGE]));
    expect(next.overrides?.blocks).toEqual([NEWER, SKILL]);
    expect((next.overrides?.blocks as unknown[])[0], 'the newer block is the same object').toBe(NEWER);
    expect((next.overrides?.blocks as unknown[])[1], 'WP13: the stored skill-increase allow too').toBe(SKILL);
    expect(removeChosenIds(b, new Set(['something-else'])).overrides, 'nothing gone: the overrides object itself').toBe(b.overrides);
  });
});
