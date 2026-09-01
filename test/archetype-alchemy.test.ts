import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { ownedFeatureIds } from '../src/rules/derive';

/**
 * Two gaps found by re-reading the whole conversation for things that were noted and never done.
 */
const db = content();

describe('an archetype alchemist gets the daily items they are entitled to', () => {
  it('the alchemy dedications carry a budget, read from their own text', () => {
    for (const [id, items] of [['herbalist-dedication', 4], ['poisoner-dedication', 4]] as const) {
      expect(db.feats[id]?.advancedAlchemy?.items, id).toBe(items);
    }
  });

  /*
   * ⚠ ALCHEMIST DEDICATION IS NOT ONE OF THEM, though it was grouped with them here. Our record is the
   * PC2 remaster (feat-6184) and it grants the QUICK Alchemy benefits, not Advanced:
   *   *"You gain the Quick Alchemy benefits, creating up to 4 VERSATILE VIALS during your daily
   *   preparations."*
   * That `4` is vials, which is the `versatile-vials` class resource — a different subsystem from the
   * daily-consumable budget, and from a different feat (Advanced Alchemy, PC2 p.175). Their own data
   * agrees: the row grants ability block 33683 "Quick Alchemy Benefits", not 33684 "Advanced Alchemy
   * Benefits". Reading the 4 as advanced-alchemy items gave a dedicated alchemist a budget the feat
   * never grants while leaving them no vials at all.
   */
  it('the alchemist dedication grants VIALS, not an advanced-alchemy budget', async () => {
    expect(db.feats['alchemist-dedication'].advancedAlchemy).toBeUndefined();
    expect(build('fighter', 6, { featPicks: { '2:class': 'alchemist-dedication' } }).advancedAlchemy).toBeUndefined();
    const { resourcesForCharacter } = await import('../src/rules/classResources');
    const vials = resourcesForCharacter('fighter', new Set(['alchemist-dedication'])).find((r) => r.id === 'versatile-vials');
    expect(vials?.maxBase).toBe(4);
  });

  /*
   * …and having the vials, they must be able to SPEND them.
   *
   * Removing the wrong `advancedAlchemy` budget above was correct but left the archetype alchemist
   * with a 4-point counter and no control anywhere: the feat granted no Quick Alchemy action, and the
   * sheet gated the whole Alchemy panel on `advancedAlchemy`. Both halves of the printed sentence have
   * to land — the vials AND the Quick Alchemy they exist for.
   */
  it('the dedication grants the Quick Alchemy action itself', () => {
    expect(db.feats['alchemist-dedication'].grantsActions).toContain('quick-alchemy');
    expect(db.actions['quick-alchemy'], 'the action it names must exist').toBeTruthy();
  });

  it('the printed sentence survives in the description — the link label was being stripped', () => {
    // "You gain the benefits, creating up to 4 versatile vials" is what it read: the words naming
    // WHICH benefits were dropped with the link, which is how the grant lost its name.
    const d = JSON.stringify(db.feats['alchemist-dedication'].description ?? '');
    expect(d).toMatch(/Quick Alchemy benefits/);
  });

  it("resolves the archetype's flat 4 vials, not the class's 2 + Int", async () => {
    // Two `versatile-vials` entries exist. A raw `.find` over CLASS_RESOURCES.alchemist returns the
    // CLASS one first, which is what the sheet panel used to show an archetype alchemist.
    const { resourcesForCharacter } = await import('../src/rules/classResources');
    const arch = resourcesForCharacter('fighter', new Set(['alchemist-dedication'])).find((r) => r.id === 'versatile-vials');
    const real = resourcesForCharacter('alchemist', new Set()).find((r) => r.id === 'versatile-vials');
    expect(arch?.maxBase).toBe(4);
    expect(arch?.feat).toBe('alchemist-dedication');
    expect(real?.feat, 'the class entry is ungated').toBeUndefined();
    expect(real?.maxBase).not.toBe(4);
  });

  it("none of them adds Intelligence — only the alchemist CLASS's 4 + Int does", () => {
    // Adding `addInt` would hand an archetype more than its text gives it.
    for (const id of ['herbalist-dedication', 'poisoner-dedication']) {
      expect(db.feats[id].advancedAlchemy!.addInt, id).toBeUndefined();
    }
  });

  it('a fighter with an alchemy dedication has a budget; a plain fighter has none', () => {
    expect(build('fighter', 6, { featPicks: { '2:class': 'poisoner-dedication' } }).advancedAlchemy).toEqual({
      max: 4,
      source: 'Poisoner Dedication',
    });
    expect(build('fighter', 6, {}).advancedAlchemy).toBeUndefined();
  });

  /* Munitions Crafter (feat-3158, G&G Remastered): *"a number of daily consumables equal to 4 + half
   * your level (rounded up)"*. It carried no `advancedAlchemy` at all, so the count was zero. */
  it('Munitions Crafter scales with level', () => {
    expect(build('fighter', 6, { featPicks: { '2:class': 'munitions-crafter' } }).advancedAlchemy?.max).toBe(4 + 3);
    expect(build('fighter', 11, { featPicks: { '2:class': 'munitions-crafter' } }).advancedAlchemy?.max).toBe(4 + 6);
  });

  it("the alchemist class's own budget still wins where it is bigger", () => {
    const c = build('alchemist', 5, {});
    expect(c.advancedAlchemy!.max).toBeGreaterThan(0);
  });
});

describe('Intense Implement gives the THIRD implement its adept benefit', () => {
  const base = { extraChoices: { implement: ['amulet', 'bell', 'chalice'] } };
  const owned = (over: Record<string, unknown> = {}) =>
    [...ownedFeatureIds(build('thaumaturge', 18, { ...base, ...over }), db)].filter((x) => /^adept-benefit-/.test(x)).sort();

  it('the third implement has no adept benefit without it', () => {
    // The code said so in as many words — "never the third implement, which never gains adept" —
    // which is exactly the line this feat exists to change.
    expect(owned()).not.toContain('adept-benefit-chalice');
  });

  it('and has one with it', () => {
    expect(owned({ featPicks: { '18:class': 'intense-implement' } })).toContain('adept-benefit-chalice');
  });

  it('the first two are unaffected either way', () => {
    for (const list of [owned(), owned({ featPicks: { '18:class': 'intense-implement' } })]) {
      expect(list).toContain('adept-benefit-amulet');
      expect(list).toContain('adept-benefit-bell');
    }
  });

  it('every implement has an adept-benefit record, so the lane cannot half-resolve', () => {
    const opts = (db.classes.thaumaturge.extraChoices ?? []).find((g) => g.id === 'implement')?.options ?? [];
    expect(opts.length).toBe(10);
    for (const o of opts) expect(db.classFeatures[`adept-benefit-${o.id}`], o.id).toBeTruthy();
  });
});
