/**
 * A champion's cause list follows the deity's Sanctification entry BEFORE the champion answers their own
 * holy / unholy question (`feature:deity-champion`).
 *
 * Champion class-58: *"Whether you become holy, unholy, or neither will limit your choice of causes"*, and
 * Deity (Champion): *"if you "must be" holy or unholy, you gain the trait"*. Found 2026-10-27 by the Tweaks
 * WP13 browser test: a champion of Iomedae (must be holy) with the question still empty saw Desecration and
 * Iniquity as plain choices — no reason, no "Take anyway" — because the cause rule read only the champion's
 * own answer and allowed everything while it was empty.
 */
import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { hero } from './_tweaks-harness';
import { buildCharacter, effectChoiceOffered, levelChoices, setupMissing, subclassOptionState, type BuildState } from '../src/rules/build';
import { sanctificationOf } from '../src/rules/derive';
import type { BuildOverrides } from '../src/rules/types';

const db = content();
const causes = db.classes.champion.subclass!.options;
const cause = (id: string) => causes.find((o) => o.id === id)!;
const champ = (deityId: string | null, featChoices: Record<string, string> = {}, more: Partial<BuildState> = {}, blocks: object[] = []) =>
  hero(db, 'champion', 3, { v: 2, ...(blocks.length ? { blocks } : {}) } as unknown as BuildOverrides, { subclassId: 'justice', deityId, featChoices, ...more });
const refused = (b: BuildState) => causes.filter((o) => subclassOptionState(o, b, db).reason).map((o) => o.id).sort();

describe('champion causes follow the deity while the sanctification question is empty', () => {
  it('Iomedae (must be holy), unanswered: both unholy causes are refused and say why', () => {
    const b = champ('iomedae');
    expect(refused(b)).toEqual(['desecration', 'iniquity']);
    expect(subclassOptionState(cause('desecration'), b, db).reason).toBe('Needs an unholy sanctification. Iomedae allows only: holy.');
    expect(subclassOptionState(cause('grandeur'), b, db).reason).toBeNull();
  });

  it('Pharasma (no Sanctification entry = none only), unanswered: every holy and unholy cause is refused', () => {
    const b = champ('pharasma');
    expect(refused(b)).toEqual(['desecration', 'grandeur', 'iniquity', 'redemption']);
    expect(subclassOptionState(cause('grandeur'), b, db).reason).toBe('Needs a holy sanctification. Pharasma allows only: none.');
  });

  it('a deity that can be holy or unholy, unanswered: nothing is refused yet', () => {
    expect(refused(champ('abadar'))).toEqual([]);
  });

  it('no deity chosen yet: nothing is refused (a half-built champion sees the whole list)', () => {
    expect(refused(champ(null))).toEqual([]);
  });

  it("the champion's own answer still decides once given (unholy under Kostchtchie refuses the holy causes)", () => {
    const b = champ('kostchtchie', { 'feature:deity-champion': 'unholy' });
    expect(refused(b)).toEqual(['grandeur', 'redemption']);
    expect(subclassOptionState(cause('grandeur'), b, db).reason).toBe('Needs a holy sanctification.');
  });

  it('a stored unholy cause under Iomedae is named on Setup; a live "Take anyway" lifts it, paused it returns', () => {
    const name = db.classes.champion.subclass!.name;
    const stored = champ('iomedae', {}, { subclassId: 'desecration' });
    expect(setupMissing(stored, db)).toContain(name);
    const allow = (on: boolean) => ({ id: 't1_cause01', kind: 'choice.allowAnywayAnyPicker', v: 1, picker: 'subclass', record: 'desecration', classId: 'champion', ...(on ? {} : { on: false }) });
    const lifted = champ('iomedae', {}, { subclassId: 'desecration' }, [allow(true)]);
    const st = subclassOptionState(cause('desecration'), lifted, db);
    expect(st).toEqual({ bookReason: 'Needs an unholy sanctification. Iomedae allows only: holy.', reason: null, tweaked: true });
    expect(setupMissing(lifted, db)).not.toContain(name);
    const paused = champ('iomedae', {}, { subclassId: 'desecration' }, [allow(false)]);
    expect(subclassOptionState(cause('desecration'), paused, db).reason).toBe('Needs an unholy sanctification. Iomedae allows only: holy.');
  });

  it("the champion's own answer wins over the deity's limit (unholy under Iomedae, however it got there)", () => {
    // A "Take anyway" on Deity and Cause's sanctification picker is how a champion of Iomedae answers unholy;
    // from then on the causes follow that answer, not the deity's.
    expect(refused(champ('iomedae', { 'feature:deity-champion': 'unholy' }))).toEqual(['grandeur', 'redemption']);
  });
});

describe('a champion of a "must be" deity is holy without a click', () => {
  // Deity (Champion): *"if you "must be" holy or unholy, you gain the trait"*. Until 2026-10-27 an unanswered Deity
  // and Cause gave no trait at all, so no holy Strikes and no Radiant Armament holy rune (the independent check).
  const traits = (b: BuildState) => (buildCharacter(b, db).chosenCreatureTraits ?? []).map((t) => t.trait);

  it('Iomedae (must be holy), unanswered: holy, and sanctificationOf reads it', () => {
    expect(traits(champ('iomedae'))).toContain('holy');
    expect(sanctificationOf(buildCharacter(champ('iomedae'), db))).toBe('holy');
  });

  it('Asmodeus (must be unholy), unanswered: unholy', () => {
    expect(traits(champ('asmodeus'))).toContain('unholy');
    expect(traits(champ('asmodeus'))).not.toContain('holy');
  });

  it('no trait while the player still has a choice, or the only answer is none', () => {
    // Kostchtchie offers unholy or none: a choice, so no default.
    for (const d of ['abadar', 'kostchtchie', 'pharasma', null]) {
      const t = traits(champ(d));
      expect(t, String(d)).not.toContain('holy');
      expect(t, String(d)).not.toContain('unholy');
    }
  });

  it('a stored answer wins over the default (none under Iomedae, kept by Take anyway)', () => {
    expect(traits(champ('iomedae', { 'feature:deity-champion': 'none' }))).not.toContain('holy');
  });

  it('"choices left" names the question only while the deity leaves a choice and it is unanswered', () => {
    const owed = (b: BuildState) => levelChoices(b, db).some((m) => m.page === 1 && m.label.endsWith('Deity (Champion) — choose'));
    expect(owed(champ('abadar')), 'Abadar: holy, unholy or none').toBe(true);
    expect(owed(champ('kostchtchie')), 'Kostchtchie: unholy or none').toBe(true);
    expect(owed(champ('abadar', { 'feature:deity-champion': 'none' })), 'answered').toBe(false);
    expect(owed(champ('iomedae')), 'Iomedae answers it herself').toBe(false);
    expect(owed(champ('pharasma')), 'none is the only answer').toBe(false);
    expect(owed(champ(null)), 'no deity yet: the Deity card is what is owed').toBe(false);
  });

  it('a Fighter/Champion of Iomedae under Dual Class is holy too', () => {
    const b = hero(db, 'fighter', 3, { v: 2 } as unknown as BuildOverrides, {
      deityId: 'iomedae',
      variantRules: { dualClass: true } as BuildState['variantRules'],
      classId2: 'champion',
      subclassId2: 'justice',
    });
    expect(traits(b)).toContain('holy');
  });
});

describe("the deity card's own Sanctification question is not a champion's", () => {
  const card = db.deities['abadar'].effectChoices!.find((e) => e.id === 'sanctification')!;

  it('is not asked of a champion, and an answer stored there neither gates the causes nor gives a trait', () => {
    // Until 2026-10-27 the card asked a champion too: they picked Holy there, kept seeing the unholy causes as
    // plain choices and got no holy trait, because nothing reads that answer for a champion. Hidden, never cleared.
    const b = champ('abadar', {}, { effectChoices: { 'abadar:sanctification': 'holy' } });
    expect(effectChoiceOffered(card, b, db, 'abadar')).toBe(false);
    expect(refused(b)).toEqual([]);
    expect((buildCharacter(b, db).chosenCreatureTraits ?? []).map((t) => t.trait)).not.toContain('holy');
  });

  it('is still asked of a cleric, who reads it', () => {
    const cleric = hero(db, 'cleric', 1, { v: 2 } as unknown as BuildOverrides, { deityId: 'abadar' });
    expect(effectChoiceOffered(card, cleric, db, 'abadar')).toBe(true);
  });
});

describe("the Dual Class second class's cause follows the same rule", () => {
  const fc = (blocks: object[] = []) =>
    hero(db, 'fighter', 3, { v: 2, ...(blocks.length ? { blocks } : {}) } as unknown as BuildOverrides, {
      deityId: 'iomedae',
      variantRules: { dualClass: true } as BuildState['variantRules'],
      classId2: 'champion',
      subclassId2: 'desecration',
    });
  const name = db.classes.champion.subclass!.name;

  it('a Fighter/Champion of Iomedae holding Desecration is named on Setup; a live "Take anyway" lifts it', () => {
    expect(subclassOptionState(cause('desecration'), fc(), db, 'champion').reason).toBe('Needs an unholy sanctification. Iomedae allows only: holy.');
    expect(setupMissing(fc(), db)).toContain(name);
    const allow = { id: 't1_cause02', kind: 'choice.allowAnywayAnyPicker', v: 1, picker: 'subclass', record: 'desecration', classId: 'champion' };
    expect(setupMissing(fc([allow]), db)).not.toContain(name);
    expect(setupMissing({ ...fc(), subclassId2: 'grandeur' }, db)).not.toContain(name);
  });

  it('with Dual Class off, a leftover second cause is no class and reports nothing', () => {
    const b = fc();
    expect(setupMissing({ ...b, variantRules: { ...b.variantRules, dualClass: false } as BuildState['variantRules'] }, db)).not.toContain(name);
  });
});
