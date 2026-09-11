import { describe, expect, it } from 'vitest';
import { content, build } from './_content';
import { eligibleFeatsForSlot } from '../src/rules/featSlots';
import { emptyBuild } from '../src/rules/build';
import { FEAT_PICK_GRANTS } from '../src/rules/featPickGrants';

/**
 * REACH — records that ship in the data and no player could ever pick. Every case here was a feat or
 * feature the app downloaded, listed in no picker, and in several cases could not even open.
 */
const c = () => content();
const offered = (over: Parameters<typeof emptyBuild> extends never ? never : Record<string, unknown>, slot: { level: number; category: string; idx: number }) =>
  new Set(
    eligibleFeatsForSlot({ ...emptyBuild(), level: 20, ...over } as never, c(), slot as never).map((f) => f.id),
  );

describe('Sanguimancer archetype', () => {
  it('its dedication is takeable in a class slot', () => {
    const ids = offered({ classId: 'fighter' }, { level: 20, category: 'class', idx: 0 });
    expect(ids.has('sanguimancer-dedication')).toBe(true);
  });
  it('carries the archetype trait its four follow-ons already had', () => {
    expect(c().feats['sanguimancer-dedication']?.traits).toContain('archetype');
  });
});

describe('Samsaran ancestry feats', () => {
  it('offers the reincarnated-trait feats to a samsaran', () => {
    const ids = offered({ classId: 'fighter', ancestryId: 'samsaran' }, { level: 20, category: 'ancestry', idx: 0 });
    const reincarnated = Object.values(c().feats).filter((f) => f.traits.includes('reincarnated'));
    expect(reincarnated.length).toBe(25);
    // Every one, not just the ones that happened to also carry an ancestry trait (there were none).
    for (const f of reincarnated) expect(ids.has(f.id), f.id).toBe(true);
  });
  it('does not leak them to another ancestry', () => {
    const ids = offered({ classId: 'fighter', ancestryId: 'dwarf' }, { level: 20, category: 'ancestry', idx: 0 });
    expect(ids.has('lets-try-that-again')).toBe(false);
  });
});

describe('ancestry feats that shipped with no traits', () => {
  it('offers the plant feats to each of their four ancestries', () => {
    const PLANT = ['caustic-nectar', 'wilderness-born', 'quick-root', 'pollinate', 'one-with-the-wild', 'unfettered-growth', 'potent-nectar'];
    for (const ancestryId of ['conrasu', 'ghoran', 'leshy']) {
      const ids = offered({ classId: 'fighter', ancestryId }, { level: 20, category: 'ancestry', idx: 0 });
      for (const id of PLANT) expect(ids.has(id), `${id} for ${ancestryId}`).toBe(true);
    }
  });
  it('offers a UNIVERSAL ANCESTRY feat to any ancestry at all', () => {
    const UNIVERSAL = ['fey-influence', 'fey-ascension', 'cannibalize-magic', 'glamour', 'eldritch-calm', 'fey-transcendence'];
    for (const ancestryId of ['dwarf', 'elf', 'goblin', 'leshy']) {
      const ids = offered({ classId: 'fighter', ancestryId }, { level: 20, category: 'ancestry', idx: 0 });
      for (const id of UNIVERSAL) expect(ids.has(id), `${id} for ${ancestryId}`).toBe(true);
    }
  });
});

describe('Deviant abilities', () => {
  const deviant = () => Object.values(c().feats).filter((f) => f.traits.includes('deviant'));
  it('are hidden until the table turns them on', () => {
    expect(deviant().length).toBe(30);
    const off = offered({ classId: 'fighter' }, { level: 20, category: 'class', idx: 0 });
    for (const f of deviant()) expect(off.has(f.id), f.id).toBe(false);
  });
  it('become class-feat picks once enabled', () => {
    const on = offered({ classId: 'fighter', deviantEnabled: true }, { level: 20, category: 'class', idx: 0 });
    for (const f of deviant().filter((f) => f.level <= 20)) expect(on.has(f.id), f.id).toBe(true);
  });
});

describe('Hellknight Order Training', () => {
  /*
   * `bonus` used to mean exactly one thing — a feat Hellknight Order Training hands over — so the list
   * and the category were the same set. Batch 037 created feats/haunting-memories-skill-feat as the
   * carrier for the SECOND thing Haunting Memories gives you each morning (*"You also gain one skill
   * feat with a minimum requirement of your new rank in the chosen skill"*, feat-7701); it is granted
   * by its parent and costs no slot, which is what `bonus` means, so it is in the category and not in
   * this list. Named here one by one rather than loosened to a filter: a THIRD stray in `bonus` still
   * has to fail, because that is how an order feat would go missing from the picker.
   */
  // batch 037: haunting-memories#skill-feat-pick
  it('offers the 14 order feats it says it grants, and haunting-memories-skill-feat is the only other bonus feat', () => {
    const spec = FEAT_PICK_GRANTS['order-training'];
    expect(spec?.ids).toHaveLength(14);
    for (const id of spec!.ids!) expect(c().feats[id], id).toBeTruthy();
    const bonusIds = Object.values(c().feats).filter((f) => f.category === 'bonus').map((f) => f.id).sort();
    expect(bonusIds).toEqual([...spec!.ids!, 'haunting-memories-skill-feat'].sort());
  });
});

describe('champion first-level features', () => {
  it("grants Deific Weapon and Champion's Aura", () => {
    const ch = build('champion', 1);
    // Both records existed and were referenced by NOTHING — not the class, not a cause, not a grant.
    expect(ch.classChoices?.length ?? 0).toBeGreaterThanOrEqual(0);
    const cls = c().classes.champion;
    const l1 = cls.features.filter((f) => f.level === 1).map((f) => f.featureId);
    expect(l1).toEqual(expect.arrayContaining(['deific-weapon', 'champions-aura']));
    for (const id of ['deific-weapon', 'champions-aura']) expect(c().classFeatures[id], id).toBeTruthy();
  });
});
