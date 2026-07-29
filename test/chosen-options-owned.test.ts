import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { ownedFeatureIds } from '../src/rules/derive';
import { statHasSituational } from '../src/rules/explain';
import { buildCharacter, deriveBuildFromCharacter, emptyBuild, type BuildState } from '../src/rules/build';
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
