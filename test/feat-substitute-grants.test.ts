import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { FEAT_FEAT_GRANTS, FEAT_SUBSTITUTE_GRANTS } from '../src/rules/featFeatGrants';
import type { BuildState } from '../src/rules/build';

const db = content();

/**
 * "YOU GAIN THE BREATH CONTROL, DIEHARD, AND FAST RECOVERY FEATS… FOR EACH OF THESE FEATS YOU ALREADY
 * HAVE, YOU CAN INSTEAD GAIN A DIFFERENT FEAT FROM THE FOLLOWING LIST: CANNY ACUMEN, FLEET, AND
 * TOUGHNESS." (Three Clear Breaths — the only feat in the data whose text has this shape.)
 *
 * Only the unconditional half shipped. The flat grant loop drops a feat the character already holds
 * (`if (takenFeats.has(gid)) continue`), so someone who arrived with Breath Control lost a third of a
 * 6th-level feat and was offered nothing back — and someone holding all three got a feat worth
 * nothing whatsoever. That silence is the entire content of the printed "instead".
 *
 * The gate has to read the feats held BEFORE this granter's own grants ran. Read afterwards, Breath
 * Control is present either way and every character alive would collect a fourth feat.
 */
describe('Three Clear Breaths replaces the grants you already had', () => {
  const SLOT = '6:class:0';
  /* Cultivator Dedication is the printed prerequisite, so the feat is taken the way a player takes it.
   * The base three are general feats, which is why they can be held in a general slot beforehand. */
  const withFeat = (extra: Record<string, string> = {}, subs: Record<string, string> = {}) =>
    build('fighter', 6, {
      featPicks: { '2:class:0': 'cultivator-dedication', [SLOT]: 'three-clear-breaths', ...extra },
      pickFeatChoices: subs,
    } as Partial<BuildState>);

  const idsOf = (c: ReturnType<typeof withFeat>) => c.feats.map((f) => f.featId);

  it('the unconditional half is untouched — all three arrive for a character who had none', () => {
    const ids = idsOf(withFeat());
    expect(FEAT_FEAT_GRANTS['three-clear-breaths']).toEqual(['breath-control', 'diehard', 'fast-recovery']);
    for (const id of ['breath-control', 'diehard', 'fast-recovery']) expect(ids).toContain(id);
  });

  it('…and such a character is owed NO replacement', () => {
    /* The gate is the point: three feats is what the record grants, not four. */
    expect(withFeat().featSubstitutions ?? []).toHaveLength(0);
    const ids = idsOf(withFeat({}, { 'three-clear-breaths:sub:breath-control': 'fleet' }));
    expect(ids, 'an answer with no gate behind it must grant nothing').not.toContain('fleet');
  });

  it('a character who already has Breath Control is owed exactly one replacement, and gets it', () => {
    const held = { '1:general:0': 'breath-control' };
    const owed = withFeat(held).featSubstitutions ?? [];
    expect(owed).toHaveLength(1);
    expect(owed[0]).toMatchObject({ featId: 'three-clear-breaths', ifHave: 'breath-control', key: 'three-clear-breaths:sub:breath-control' });

    const c = withFeat(held, { [owed[0].key]: 'toughness' });
    const ids = idsOf(c);
    expect(ids).toContain('toughness');
    expect(ids.filter((i) => i === 'breath-control')).toHaveLength(1);
    /* The other two grants are unaffected — the substitution is per-feat, not per-record. */
    expect(ids).toContain('diehard');
    expect(ids).toContain('fast-recovery');
  });

  it('two owned feats owe two replacements, answered independently', () => {
    const held = { '1:general:0': 'breath-control', '3:general:0': 'diehard' };
    const owed = withFeat(held).featSubstitutions ?? [];
    expect(owed.map((o) => o.ifHave).sort()).toEqual(['breath-control', 'diehard']);
    const c = withFeat(held, {
      'three-clear-breaths:sub:breath-control': 'fleet',
      'three-clear-breaths:sub:diehard': 'toughness',
    });
    const ids = idsOf(c);
    expect(ids).toContain('fleet');
    expect(ids).toContain('toughness');
  });

  it('"a DIFFERENT feat" — two replacements can never collapse onto one', () => {
    const c = withFeat(
      { '1:general:0': 'breath-control', '3:general:0': 'diehard' },
      { 'three-clear-breaths:sub:breath-control': 'fleet', 'three-clear-breaths:sub:diehard': 'fleet' },
    );
    expect(idsOf(c).filter((i) => i === 'fleet')).toHaveLength(1);
  });

  it('…nor onto a feat the character already holds', () => {
    const c = withFeat(
      { '1:general:0': 'breath-control', '3:general:0': 'toughness' },
      { 'three-clear-breaths:sub:breath-control': 'toughness' },
    );
    expect(idsOf(c).filter((i) => i === 'toughness')).toHaveLength(1);
  });

  it('an answer outside the printed list is ignored', () => {
    const c = withFeat({ '1:general:0': 'breath-control' }, { 'three-clear-breaths:sub:breath-control': 'incredible-initiative' });
    expect(idsOf(c)).not.toContain('incredible-initiative');
  });

  it('Canny Acumen still asks its own question when it arrives this way', () => {
    /* It is the one substitute with a sub-choice (which save, or Perception). A granted feat that
     * cannot reach its own picker is a grant that half-arrives. */
    expect(db.feats['canny-acumen']?.choice).toBeDefined();
    const c = withFeat({ '1:general:0': 'breath-control' }, { 'three-clear-breaths:sub:breath-control': 'canny-acumen' });
    const granted = c.feats.find((f) => f.featId === 'canny-acumen');
    expect(granted?.grantedBy).toBe('three-clear-breaths');
  });

  it('the table names only feats that exist', () => {
    for (const [granter, rows] of Object.entries(FEAT_SUBSTITUTE_GRANTS)) {
      expect(db.feats[granter], `${granter} is not a feat`).toBeDefined();
      for (const row of rows) {
        expect(db.feats[row.ifHave], `${row.ifHave} is not a feat`).toBeDefined();
        for (const o of row.options) expect(db.feats[o], `${o} is not a feat`).toBeDefined();
        /* A substitution offering a feat the record also grants outright could never be taken. */
        expect(row.options).not.toContain(row.ifHave);
      }
    }
  });
});
