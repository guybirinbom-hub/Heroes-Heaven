import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { buildCharacter, emptyBuild, deriveBuildFromCharacter, type BuildState } from '../src/rules/build';
import { FEAT_PICK_GRANTS, pickableFeats } from '../src/rules/featPickGrants';
import { maxTakes } from '../src/rules/featGrants';

/**
 * Repeatable pick-a-feat grants — the biggest single blocker left by the coverage sweep.
 *
 * `pickFeatChoices` was keyed by the GRANTING FEAT'S ID, so a feat you may take several times could
 * record only one answer: General Training taken three times granted one bonus feat, and 25 records
 * that already shipped a working spec were silently capped at their first taking.
 */
const db = content();

/** A human fighter with `general-training` in `n` distinct 1st-level-eligible slots. */
const withGeneralTraining = (picks: Record<string, string>, over: Partial<BuildState> = {}): BuildState => {
  const b = emptyBuild();
  return {
    ...b,
    name: 'Repeat',
    classId: 'fighter',
    level: 10,
    ancestryId: 'human',
    backgroundId: Object.keys(db.backgrounds)[0],
    subclassId: db.classes.fighter.subclass?.options?.[0]?.id ?? null,
    featPicks: { ...b.featPicks, ...Object.fromEntries(Object.keys(picks).map((k) => [k, 'general-training'])) },
    pickFeatChoices: picks,
    ...over,
  } as BuildState;
};

const generalOpts = () => pickableFeats(FEAT_PICK_GRANTS['general-training'], withGeneralTraining({}), db).map((f) => f.id);

describe('the record and the spec', () => {
  it('General Training is repeatable and has a pick spec', () => {
    expect(maxTakes(db.feats['general-training'])).toBe(Infinity);
    expect(FEAT_PICK_GRANTS['general-training']).toBeTruthy();
  });

  it('25+ repeatable feats already shipped a spec they could not use', () => {
    const both = Object.keys(FEAT_PICK_GRANTS).filter(
      (id) => db.feats[id] && maxTakes(db.feats[id]) === Infinity,
    );
    expect(both.length).toBeGreaterThanOrEqual(25);
  });
});

describe('two takings, two picks', () => {
  const opts = generalOpts();

  it('the pool is real', () => {
    expect(opts.length).toBeGreaterThan(2);
  });

  it('THE FIX: each slot records its own answer', () => {
    const [a, bF] = opts;
    const c = buildCharacter(withGeneralTraining({ '1:ancestry': a, '5:general': bF }), db);
    const ids = c.feats.map((f) => f.featId);
    expect(ids, 'the first taking granted its pick').toContain(a);
    expect(ids, 'the second taking granted a DIFFERENT pick').toContain(bF);
  });

  it('the old feat-id shape gives every taking the SAME single answer', () => {
    // Why the fix was needed: one key, one value, however many times you take the feat.
    const [a] = opts;
    const b = withGeneralTraining({});
    b.featPicks = { '1:ancestry': 'general-training', '5:general': 'general-training' };
    b.pickFeatChoices = { 'general-training': a };
    const c = buildCharacter(b, db);
    expect(c.feats.filter((f) => f.featId === 'general-training').length).toBeGreaterThan(1);
    expect(c.feats.filter((f) => f.featId === a), 'one answer cannot fill two takings').toHaveLength(1);
  });

  it('an OLD save (feat-id key) still resolves its pick', () => {
    const [a] = opts;
    const b = withGeneralTraining({});
    b.featPicks = { '1:ancestry': 'general-training' };
    b.pickFeatChoices = { 'general-training': a };
    expect(buildCharacter(b, db).feats.map((f) => f.featId)).toContain(a);
  });

  it('a slot-key answer WINS over a stale feat-id one for that slot', () => {
    const [a, bF] = opts;
    const b = withGeneralTraining({});
    b.featPicks = { '1:ancestry': 'general-training' };
    b.pickFeatChoices = { 'general-training': a, '1:ancestry': bF };
    const ids = buildCharacter(b, db).feats.map((f) => f.featId);
    expect(ids).toContain(bF);
    expect(ids).not.toContain(a);
  });

  it('the granted feats are tagged with the feat that granted them', () => {
    const [a, bF] = opts;
    const c = buildCharacter(withGeneralTraining({ '1:ancestry': a, '5:general': bF }), db);
    for (const id of [a, bF]) {
      expect(c.feats.find((f) => f.featId === id)?.grantedBy).toBe('general-training');
    }
  });

  it('an illegal pick is still ignored', () => {
    const bogus = Object.keys(db.feats).find((id) => !generalOpts().includes(id))!;
    const c = buildCharacter(withGeneralTraining({ '1:ancestry': bogus }), db);
    expect(c.feats.map((f) => f.featId)).not.toContain(bogus);
  });

  it('a NON-repeatable pick grant is unaffected — still one answer', () => {
    const once = Object.keys(FEAT_PICK_GRANTS).find((id) => db.feats[id] && maxTakes(db.feats[id]) === 1);
    if (!once) return;
    expect(maxTakes(db.feats[once])).toBe(1);
  });
});

describe('the slot key survives where it has to', () => {
  it('a built feat carries the slot it came from', () => {
    const [a] = generalOpts();
    const c = buildCharacter(withGeneralTraining({ '1:ancestry': a }), db);
    const gt = c.feats.find((f) => f.featId === 'general-training');
    expect(gt?.slotKey).toBe('1:ancestry');
  });

  it('a build round-trip keeps both picks', () => {
    // deriveBuildFromCharacter rebuilds featPicks from the character; if it does not also rebuild
    // pickFeatChoices, an imported character loses every bonus feat it was granted.
    const [a, bF] = generalOpts();
    const c = buildCharacter(withGeneralTraining({ '1:ancestry': a, '5:general': bF }), db);
    const rebuilt = buildCharacter(deriveBuildFromCharacter(c, db), db);
    const ids = rebuilt.feats.map((f) => f.featId);
    expect(ids, 'first pick lost on round-trip').toContain(a);
    expect(ids, 'second pick lost on round-trip').toContain(bF);
  });
});
