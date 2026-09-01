import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { effectChoiceOffered } from '../src/rules/build';
import type { BuildState } from '../src/rules/build';

const db = content();

/**
 * "CHOOSE A SECOND DEITY… IF YOU ARE A CLOISTERED CLERIC, select one of that deity's domains, gaining
 * the benefits of the Expanded Domain Initiate feat with that domain. IF YOU ARE A WARPRIEST, you gain
 * the favored weapon of that deity as a second favored weapon." (Gods & Magic.)
 *
 * The record shipped a free-text deity marked "Recorded only — the second deity's domain (cloistered
 * cleric) or second favored weapon (warpriest) isn't applied", and nothing in src/ read it. Both
 * printed branches move a number the sheet shows, and neither moved.
 *
 * The gate is the whole difficulty: authoring either branch ungated hands a warpriest a free domain
 * focus spell and a Focus Point, or a cloistered cleric a weapon proficiency. `requiresFeature` is a
 * gate on the WHOLE question, read by the builder's picker and both appliers through one predicate.
 */
describe('Syncretism delivers the branch your doctrine earns — and only that one', () => {
  const SLOT = '1:class:0';
  const cleric = (doctrine: string, over: Partial<BuildState> = {}, level = 1) =>
    build('cleric', level, {
      subclassId: doctrine,
      deityId: 'sarenrae',
      featPicks: { [SLOT]: 'syncretism' },
      ...over,
    } as Partial<BuildState>);

  const choices = () => db.feats.syncretism!.effectChoices!;
  const domainCh = () => choices().find((c) => c.id === 'domain')!;
  const weaponCh = () => choices().find((c) => c.id === 'favored-weapon')!;

  it('the record carries both branches, each gated on its doctrine', () => {
    expect(domainCh().requiresFeature).toBe('cloistered-cleric');
    expect(weaponCh().requiresFeature).toBe('warpriest');
    expect(db.feats.syncretism!.choice?.inert, 'the "recorded only" marker should be gone').toBeUndefined();
  });

  it('a cloistered cleric is asked for a domain and NOT for a weapon', () => {
    const b = { classId: 'cleric', subclassId: 'cloistered-cleric', level: 1 } as BuildState;
    expect(effectChoiceOffered(domainCh(), b, db)).toBe(true);
    expect(effectChoiceOffered(weaponCh(), b, db)).toBe(false);
  });

  it('…and a warpriest the other way round', () => {
    const b = { classId: 'cleric', subclassId: 'warpriest', level: 1 } as BuildState;
    expect(effectChoiceOffered(domainCh(), b, db)).toBe(false);
    expect(effectChoiceOffered(weaponCh(), b, db)).toBe(true);
  });

  it("the cloistered branch grants the domain's focus spell and its Focus Point", () => {
    const opt = domainCh().options!.find((o) => o.value === 'air')!;
    const spell = opt.grant!.focusSpells![0];
    const c = cleric('cloistered-cleric', { effectChoices: { 'syncretism:domain': 'air' } });
    const plain = cleric('cloistered-cleric');
    /* A focus entry stores its spells under `repertoire` keyed by RANK, not as a flat list. */
    const spellsOf = (ch: typeof c) =>
      Object.values(ch.spellcasting.find((s) => s.type === 'focus')?.repertoire ?? {}).flat();
    expect(spellsOf(c), `${spell} should reach the focus pool`).toContain(spell);
    expect(c.focus?.max ?? 0, 'a domain spell brings a Focus Point').toBeGreaterThan(plain.focus?.max ?? 0);
  });

  it('…and a WARPRIEST who somehow holds that answer gains neither', () => {
    /* The doctrine changed after the pick was stored. The gate has to hold in the APPLIER, not only in
     * the picker, or the grant keeps arriving from a control nobody can see or clear. */
    const opt = domainCh().options!.find((o) => o.value === 'air')!;
    const spell = opt.grant!.focusSpells![0];
    const c = cleric('warpriest', { effectChoices: { 'syncretism:domain': 'air' } });
    expect(Object.values(c.spellcasting.find((s) => s.type === 'focus')?.repertoire ?? {}).flat()).not.toContain(spell);
  });

  it('the warpriest branch makes the chosen weapon a SECOND favored weapon', () => {
    const weapon = 'longsword';
    expect(db.items[weapon]).toBeDefined();
    const c = cleric('warpriest', { effectChoices: { 'syncretism:favored-weapon': weapon } });
    expect(c.proficiencies.weaponOverrides?.[weapon]).toBe('trained');
  });

  it('…and it rides the doctrine ladder, as "a second FAVORED weapon" means', () => {
    /* Warpriest: expert at 7th, master at 19th. A flat `trained` would look right at 1st and be wrong
     * for thirteen levels — which is precisely the shape of the bug this record used to have. */
    const at7 = cleric('warpriest', { effectChoices: { 'syncretism:favored-weapon': 'longsword' } }, 7);
    const at19 = cleric('warpriest', { effectChoices: { 'syncretism:favored-weapon': 'longsword' } }, 19);
    expect(at7.proficiencies.weaponOverrides?.longsword).toBe('expert');
    expect(at19.proficiencies.weaponOverrides?.longsword).toBe('master');
  });

  it('…and a CLOISTERED cleric holding that answer gains no weapon', () => {
    const c = cleric('cloistered-cleric', { effectChoices: { 'syncretism:favored-weapon': 'longsword' } });
    expect(c.proficiencies.weaponOverrides?.longsword).toBeUndefined();
  });

  it('a warpriest WITHOUT the feat gains nothing from a stale answer', () => {
    const c = build('cleric', 7, {
      subclassId: 'warpriest',
      deityId: 'sarenrae',
      effectChoices: { 'syncretism:favored-weapon': 'longsword' },
    } as Partial<BuildState>);
    expect(c.proficiencies.weaponOverrides?.longsword).toBeUndefined();
  });

  it("the deity's OWN favored weapon is untouched by any of this", () => {
    /* The two overrides merge; the second must not replace the first. */
    const c = cleric('warpriest', { effectChoices: { 'syncretism:favored-weapon': 'longsword' } });
    for (const w of db.deities.sarenrae?.favoredWeapons ?? []) {
      if (db.items[w]) expect(c.proficiencies.weaponOverrides?.[w], `${w} should still be favored`).toBe('trained');
    }
  });
});
