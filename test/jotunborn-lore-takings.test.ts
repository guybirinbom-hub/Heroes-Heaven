import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { EXTRA_FEAT_TAKINGS, FEAT_FEAT_GRANTS } from '../src/rules/featFeatGrants';
import type { BuildState } from '../src/rules/build';

const db = content();

/**
 * "YOU ALSO GAIN THE ADDITIONAL LORE GENERAL FEAT FOR JOTUNBORN LORE… **SPECIAL** IF YOU HAVE THE SAGE
 * JOTUNBORN HERITAGE, YOU GAIN THE ADDITIONAL LORE FEAT A SECOND TIME FOR A LORE OF YOUR CHOICE."
 * (Jotunborn Lore, Battlecry! pg. 13) — and the heritage itself prints a third:
 * "You are trained in Society. YOU ALSO GAIN THE ADDITIONAL LORE GENERAL FEAT for a lore skill of
 * your choice." (Sage Jotunborn.)
 *
 * A sage jotunborn who takes the feat is owed THREE takings of Additional Lore, and the app delivered
 * ONE. Two separate causes, both fixed here:
 *   1. the feat->feat queue was seeded with feats and class features only, so all 34 heritage-keyed
 *      entries in featFeatGrants.ts fired for nobody (scripts/scan-heritage-grant-reach.mjs);
 *   2. the dedupe drops a feat the character already holds, which swallowed the second and third
 *      takings of a repeatable feat that two records each print.
 */
describe('Jotunborn Lore and Sage Jotunborn each grant their own Additional Lore', () => {
  const jotun = (over: Partial<BuildState> = {}) =>
    build('fighter', 1, { ancestryId: 'jotunborn', heritageId: 'sage-jotunborn', ...over } as Partial<BuildState>);
  const withFeat = (over: Partial<BuildState> = {}) =>
    jotun({ featPicks: { '1:ancestry:0': 'jotunborn-lore' }, ...over } as Partial<BuildState>);

  const lores = (c: ReturnType<typeof jotun>) =>
    Object.keys(c.proficiencies.skills).filter((k) => k.startsWith('lore:')).sort();

  it('the records exist and the feat is actually taken', () => {
    expect(db.feats['jotunborn-lore']).toBeDefined();
    expect(db.heritages['sage-jotunborn']).toBeDefined();
    expect(withFeat().feats.map((f) => f.featId)).toContain('jotunborn-lore');
  });

  it('a sage jotunborn who takes the feat holds THREE Additional Lore takings', () => {
    const takes = withFeat().feats.filter((f) => f.featId === 'additional-lore');
    expect(takes).toHaveLength(3);
    expect(takes.map((t) => `${t.grantedBy}${t.grantVariant ? `#${t.grantVariant}` : ''}`).sort()).toEqual([
      'jotunborn-lore',
      'jotunborn-lore#sage',
      'sage-jotunborn#heritage',
    ]);
  });

  it('…a NON-sage jotunborn holds one — the Special clause is gated, not decorative', () => {
    const other = Object.keys(db.heritages).find((h) => db.heritages[h]!.ancestryId === 'jotunborn' && h !== 'sage-jotunborn')!;
    const c = build('fighter', 1, {
      ancestryId: 'jotunborn',
      heritageId: other,
      featPicks: { '1:ancestry:0': 'jotunborn-lore' },
    } as Partial<BuildState>);
    expect(c.feats.filter((f) => f.featId === 'additional-lore')).toHaveLength(1);
  });

  it('…and the heritage alone grants exactly one', () => {
    /* This is the half the queue could never reach: nothing seeded a heritage id, so the entry fired
     * for nobody however it was written. */
    expect(jotun().feats.filter((f) => f.featId === 'additional-lore')).toHaveLength(1);
  });

  it('the bound taking trains Jotunborn Lore without being asked', () => {
    expect(lores(withFeat())).toContain('lore:jotunborn');
  });

  it('the two free takings train the two subjects the player typed — separately', () => {
    /* The bug this key change fixes: both free takings are granted, neither has a slot, and a bare
     * `additional-lore:0` key gave them ONE shared answer — so two feats trained one Lore. */
    const c = withFeat({
      featLoreChoices: {
        'sage-jotunborn#heritage:additional-lore:0': 'Sailing',
        'jotunborn-lore#sage:additional-lore:0': 'Warfare',
      },
    } as Partial<BuildState>);
    /* Contains, not equals — the test build's background trains a Lore of its own, and asserting the
     * whole set would make this test about the background. */
    for (const k of ['lore:jotunborn', 'lore:sailing', 'lore:warfare']) expect(lores(c)).toContain(k);
    /* The point of the two keys: one answer must not serve both takings. */
    const one = withFeat({ featLoreChoices: { 'sage-jotunborn#heritage:additional-lore:0': 'Sailing' } } as Partial<BuildState>);
    expect(lores(one)).not.toContain('lore:warfare');
  });

  it('the Special taking is NOT dragged onto the granter\'s bound subject', () => {
    /* Its granter is Jotunborn Lore, which names a Lore — so without the variant it would resolve
     * through that bound answer and print "of your choice" would deliver a second Jotunborn Lore. */
    const c = withFeat({ featLoreChoices: { 'jotunborn-lore#sage:additional-lore:0': 'Warfare' } } as Partial<BuildState>);
    expect(lores(c)).toContain('lore:warfare');
  });

  it('the heritage-keyed grant tables reach the engine at all (34 entries, none of which used to fire)', () => {
    /* Anvil Dwarf is one of the 34 and grants a feat with no sub-choice, so it is the clean probe:
     * either the heritage seeding works or the feat is absent. */
    expect(FEAT_FEAT_GRANTS['anvil-dwarf']).toEqual(['specialty-crafting']);
    const dwarf = build('fighter', 1, { ancestryId: 'dwarf', heritageId: 'anvil-dwarf' } as Partial<BuildState>);
    expect(dwarf.feats.map((f) => f.featId)).toContain('specialty-crafting');
  });

  it('every EXTRA_FEAT_TAKINGS row names records that exist', () => {
    for (const [granter, rows] of Object.entries(EXTRA_FEAT_TAKINGS)) {
      expect(db.feats[granter] ?? db.heritages[granter] ?? db.classFeatures[granter], `${granter} is nowhere`).toBeDefined();
      for (const r of rows) {
        expect(db.feats[r.feat], `${r.feat} is not a feat`).toBeDefined();
        for (const h of r.heritages ?? []) expect(db.heritages[h], `${h} is not a heritage`).toBeDefined();
        /* The variant is what keeps a granter's two takings apart; a blank one would collapse them. */
        expect(r.variant).toBeTruthy();
      }
    }
  });
});
