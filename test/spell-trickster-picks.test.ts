import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { FEAT_PICK_GRANTS, pickKeysFor, pickPrompt, pickableFeats } from '../src/rules/featPickGrants';
import { dedicationBlock } from '../src/rules/build';
import type { BuildState } from '../src/rules/build';

const db = content();

/**
 * "CHOOSE UP TO TWO 4TH-LEVEL SPELL TRICKSTER ARCHETYPE FEATS FOR WHICH YOU MEET THE SPELL-CASTING
 * PREREQUISITE. YOU GAIN THOSE FEATS, IGNORING THEIR LEVEL PREREQUISITE." (Grand Bazaar pg. 122.)
 *
 * The record shipped a two-answer `choice` marked "Recorded only — the two feats are not added to your
 * sheet, so add their benefits yourself", and nothing read its flag. A player who picked Barrier Shield
 * and Tracing Sigil got the words and none of the mechanics.
 *
 * `FeatPickSpec.picks` is the lane: several feats from one pool, answers past the first stored under
 * `<key>#<i>` on the same `pickFeatChoices` map. Both halves have to exist — an engine reading `#i`
 * keys no picker writes is an inert lane wearing the costume of a working one.
 */
describe('Spell Trickster Dedication grants BOTH feats it lets you choose', () => {
  const spec = FEAT_PICK_GRANTS['spell-trickster-dedication'];
  const SLOT = '2:class:0';

  const withDedication = (picks: Record<string, string>) =>
    build('wizard', 2, {
      featPicks: { [SLOT]: 'spell-trickster-dedication' },
      pickFeatChoices: picks,
    } as Partial<BuildState>);

  it('the record no longer carries its own inert picker', () => {
    /* Two dropdowns for one printed decision is the systemic defect the batches 5-16 read found 27
     * times — and here the record's copy was the one that did nothing. */
    expect(db.feats['spell-trickster-dedication']?.choice).toBeUndefined();
    expect(spec?.picks).toBe(2);
  });

  it('offers exactly the seven 4th-level archetype feats', () => {
    const offered = pickableFeats(spec, withDedication({}), db).map((f) => f.id);
    const printed = Object.entries(db.feats)
      .filter(([, f]) => f.archetype === 'spell-trickster' && f.level === 4)
      .map(([id]) => id);
    expect([...offered].sort()).toEqual([...printed].sort());
    expect(offered).toHaveLength(7);
  });

  it('both picks reach the sheet, from the slot key and its `#1` twin', () => {
    const c = withDedication({ [SLOT]: 'barrier-shield', [`${SLOT}#1`]: 'tracing-sigil' });
    const ids = c.feats.map((f) => f.featId);
    expect(ids).toContain('barrier-shield');
    expect(ids, 'the SECOND pick is the half that never arrived').toContain('tracing-sigil');
  });

  it('…and a character saved before the lane existed keeps their first pick', () => {
    /* Index 0 is the BARE key on purpose. Renumbering it to `#0` would have silently emptied every
     * stored answer in the app. */
    expect(pickKeysFor('spell-trickster-dedication', 2)).toEqual([
      'spell-trickster-dedication',
      'spell-trickster-dedication#1',
    ]);
    const c = withDedication({ 'spell-trickster-dedication': 'agile-hand' });
    expect(c.feats.map((f) => f.featId)).toContain('agile-hand');
  });

  it('"UP TO two" — one answer is a complete answer', () => {
    const c = withDedication({ [SLOT]: 'wild-lights' });
    const granted = c.feats.filter((f) => f.grantedBy === 'spell-trickster-dedication');
    expect(granted.map((f) => f.featId)).toEqual(['wild-lights']);
  });

  it('a 2nd-level character holds 4th-level feats — the printed level waiver', () => {
    const c = withDedication({ [SLOT]: 'shining-arms' });
    expect(db.feats['shining-arms']?.level).toBe(4);
    expect(c.level).toBe(2);
    expect(c.feats.map((f) => f.featId)).toContain('shining-arms');
  });

  it('the same feat twice is one feat, not two', () => {
    const c = withDedication({ [SLOT]: 'forceful-push', [`${SLOT}#1`]: 'forceful-push' });
    expect(c.feats.filter((f) => f.featId === 'forceful-push')).toHaveLength(1);
  });

  /*
   * ⚠ "THE TWO FEATS YOU GAIN FROM TAKING THE DEDICATION DON'T COUNT TOWARD THIS TOTAL."
   *
   * The dedication's own gate demands two OTHER archetype feats before another dedication. That
   * exemption holds only because `dedicationBlock` tallies from `featPicks` — the feat-SLOT map — and
   * a pick-grant writes to `pickFeatChoices` instead. It is a property of a call site two files away,
   * so building this lane could have broken it without a single line here changing.
   */
  it('the two granted feats do NOT unlock a second dedication', () => {
    const taken = [{ id: 'spell-trickster-dedication', category: 'class' }];
    const another = db.feats['rogue-dedication'] ?? Object.values(db.feats).find((f) => f.traits.includes('dedication') && f.id !== 'spell-trickster-dedication')!;
    expect(dedicationBlock(taken, another, db), 'a second dedication must still be blocked').toBeTruthy();
  });

  it('the picker labels the two answers apart', () => {
    expect(pickPrompt(spec.prompt, 0, spec.picks)).toBe(`${spec.prompt} (1 of 2)`);
    expect(pickPrompt(spec.prompt, 1, spec.picks)).toBe(`${spec.prompt} (2 of 2)`);
    /* A one-pick spec keeps its plain prompt — no "(1 of 1)" on the other 200-odd records. */
    expect(pickPrompt('Choose a general feat', 0, undefined)).toBe('Choose a general feat');
  });
});
