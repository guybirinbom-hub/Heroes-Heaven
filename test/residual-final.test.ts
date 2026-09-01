import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveStrikes } from '../src/rules/derive';
import { checkPrerequisites } from '../src/rules/build';
import { wornArmorOf } from '../src/rules/derive';
import { characterSituationalIds } from '../src/rules/explain';
import { openChoiceOptions } from '../src/rules/openChoice';
import type { BuildState } from '../src/rules/build';

/*
 * THE LAST OF THE BATCHES 1–12 RESIDUAL FINDINGS.
 *
 * These were held back from the bulk authoring because their proposed values were malformed — several
 * fields collapsed into one field's value — so each was re-derived from the printed text by hand.
 */
const db = content();

describe('archetype gates that were unenforced', () => {
  it('Basic Death Dealing and Basic Rune Magic require their dedication', () => {
    /* Both print *"Archetype <X>. Prerequisites <X> Dedication"* and carried NEITHER field, so the
     * feat was takeable with no dedication and counted toward no archetype. */
    for (const [id, dedication, archetype] of [
      ['basic-death-dealing', 'Necromancer Dedication', 'necromancer'],
      ['basic-rune-magic', 'Runesmith Dedication', 'runesmith'],
    ] as const) {
      expect(db.feats[id].prerequisites, `${id} states its prerequisite`).toContain(dedication);
      expect(db.feats[id].archetype, `${id} belongs to its archetype`).toBe(archetype);
    }
  });

  it('the gate actually refuses a character without the dedication', () => {
    const bare = build('fighter', 6);
    expect(checkPrerequisites(db.feats['basic-death-dealing'], bare, db).met, 'no dedication: refused').toBe(false);
  });
});

describe('the acid flasks delivered a third of their damage', () => {
  /*
   * *"deals 1 acid damage, 2d6 PERSISTENT acid damage, and 2 acid SPLASH damage."* Every grade shipped
   * only the flat 1. Fixed as a family — all four print the same sentence with their own dice.
   */
  for (const [id, dice] of [
    ['acid-flask-lesser', 1],
    ['acid-flask-moderate', 2],
    ['acid-flask-greater', 3],
    ['acid-flask-major', 4],
  ] as const) {
    it(`${id} carries ${dice}d6 persistent and ${dice} splash`, () => {
      const rd = db.items[id]?.strikeDamage ?? [];
      const persistent = rd.find((r) => r.persistent);
      const splash = rd.find((r) => r.splash);
      expect(persistent, 'the persistent damage is the bulk of a flask').toMatchObject({ dice, die: 'd6', type: 'acid' });
      expect(splash, 'and the splash is why you throw it at a group').toMatchObject({ dice, type: 'acid' });
    });
  }

  it('the persistent damage reaches a thrown flask on a built character', () => {
    /* A field nothing reads is authored data that changes no sheet — no item used this lane before. */
    const ch = {
      ...build('fighter', 5),
      inventory: [{ instanceId: 'f', itemId: 'acid-flask-moderate', quantity: 1, equipped: true }],
    } as ReturnType<typeof build>;
    const flask = deriveStrikes(ch, db).find((s) => /acid flask/i.test(s.name));
    expect(flask, 'the flask is a weapon and appears as a Strike').toBeTruthy();
    expect(JSON.stringify(flask), 'its persistent acid must be on the strike').toMatch(/persistent|2d6/i);
  });
});

describe('an item can annotate an action', () => {
  it('the Shootist Bandolier reload clause is stored where a reader looks', () => {
    expect(db.items['shootist-bandolier']?.recordMarks?.[0]).toMatchObject({ on: 'action', id: 'interact' });
  });
});

describe("every gunslinger way grants its Slinger's Reload", () => {
  it('all six ways carry the action their printed text names', () => {
    /*
     * Each way prints *"**Slinger's Reload** Reloading Strike"* above its Deeds, and `featureIds`
     * carried the three Deeds and stopped — so the action a gunslinger uses every round reached no
     * sheet. All six action records already existed; only the grant was missing.
     */
    const pairs: [string, string][] = [
      ['way-of-the-drifter', 'reloading-strike'],
      ['way-of-the-pistolero', 'raconteurs-reload'],
      ['way-of-the-sniper', 'covered-reload'],
      ['way-of-the-spellshot', 'thoughtful-reload'],
      ['way-of-the-triggerbrand', 'touch-and-go'],
      ['way-of-the-vanguard', 'clear-a-path'],
    ];
    for (const [way, action] of pairs) {
      expect(db.classFeatures[way]?.grantsActions, `${way} grants no reload`).toContain(action);
      expect(db.actions[action], `${action} must be a real action record`).toBeTruthy();
    }
  });

  it("a built gunslinger's reload reaches the action surface", () => {
    const g = build('gunslinger', 3, { subclassId: 'way-of-the-drifter' } as Partial<BuildState>);
    expect(characterSituationalIds(g, db)).toContain('reloading-strike');
  });
});

describe('the Spellshifter archetype had no gates at all', () => {
  it('all three feats state their archetype, and the two that need it their prerequisite', () => {
    for (const id of ['spellshifter-dedication', 'analyze-magic', 'reactive-spellshift']) {
      expect(db.feats[id]?.archetype, `${id} belongs to no archetype`).toBe('spellshifter');
    }
    expect(db.feats['analyze-magic'].prerequisites).toContain('Spellshifter Dedication');
    expect(db.feats['reactive-spellshift'].prerequisites).toContain('Spellshifter Dedication');
    expect(db.feats['spellshifter-dedication'].prerequisites, 'the dedication gates on Arcana').toContain('Trained in Arcana');
  });
});

describe('parade armor is bulkier', () => {
  it('adds 1 Bulk to its host, and only to a legal host', () => {
    /* *"The armor is slightly bulkier, increasing the Bulk by 1."* The one armour-adjustment clause
     * with no carrier — a wearer was carrying a suit a full Bulk lighter than the rules say. */
    const adj = db.items['parade-armor']?.armorAdjust;
    expect(adj?.modes?.[0]?.bulk).toBe(1);
    expect(adj?.modes?.[0]?.hostCategories, 'any medium or heavy armor').toEqual(['medium', 'heavy']);

    const plateBulk = (db.items['half-plate'] as { bulk?: number }).bulk ?? 0;
    const ch = {
      ...build('fighter', 3),
      inventory: [
        { instanceId: 'a', itemId: 'half-plate', quantity: 1, worn: true },
        { instanceId: 'b', itemId: 'parade-armor', quantity: 1, worn: true },
      ],
    } as ReturnType<typeof build>;
    expect(wornArmorOf(ch, db)?.armor.bulk, 'the host gains the Bulk').toBe(plateBulk + 1);
  });
});

describe('magical medals share one investment slot', () => {
  it('every medal carries the same investmentGroup', () => {
    /*
     * *"No matter how many magical medals you have, they collectively count as one invested item."*
     * The 10-item cap is enforced for real, so each medal consumed a slot and a decorated soldier lost
     * half their investments to their own decorations.
     */
    const medals = Object.entries(db.items).filter(([, r]) => (r as { investmentGroup?: string }).investmentGroup === 'magical-medal');
    expect(medals.length, 'the whole family, computed from the shared printed clause').toBeGreaterThanOrEqual(5);
    for (const [id, r] of medals) {
      expect((r as { traits?: string[] }).traits, `${id} must actually be investable`).toContain('invested');
    }
  });

  it('an ordinary invested item is NOT grouped', () => {
    /* The grouping must not leak: everything else still counts individually against the cap. */
    const belt = db.items['belt-of-good-health'] as { investmentGroup?: string; traits?: string[] };
    expect(belt.traits).toContain('invested');
    expect(belt.investmentGroup).toBeUndefined();
  });
});

describe('the animist archetype can prepare its apparition spells', () => {
  const apparitions = (db.classes.animist.extraChoices ?? []).find((g) => g.id === 'apparition')?.options ?? [];
  const firstId = (apparitions[0] as { value?: string; id?: string }).value ?? (apparitions[0] as { id?: string }).id!;

  it("the bonded apparition's spells widen the archetype pool", () => {
    /*
     * *"In addition to standard divine tradition spells, you can prepare YOUR BONDED APPARITION'S
     * apparition spells in your spell slots of the appropriate level."* The archetype shipped a fixed
     * divine pool, so the defining feature of the class it borrows from could not be prepared in it.
     */
    const ch = build('fighter', 8, {
      featPicks: { '2:class': 'animist-dedication', '4:class': 'basic-animist-spellcasting' },
      primaryApparition: firstId,
    } as never);
    const adds = (ch as { spellListAdditions?: Record<string, string[]> }).spellListAdditions ?? {};
    const pool = adds['animist-dedication-casting'] ?? [];
    expect(pool.length, 'the apparition ladder must reach the archetype entry').toBeGreaterThan(0);

    const expected = (apparitions.find((o) => ((o as { value?: string; id?: string }).value ?? (o as { id?: string }).id) === firstId) as { grantedSpells?: string[] })?.grantedSpells ?? [];
    for (const s of expected) expect(pool, `${s} is one of this apparition's spells`).toContain(s);
  });

  it('a character with no apparition bonded gets no widening', () => {
    /* The grant resolves against the character, so it must be silent when there is nothing to resolve. */
    const ch = build('fighter', 8, { featPicks: { '2:class': 'animist-dedication', '4:class': 'basic-animist-spellcasting' } } as never);
    const pool = ((ch as { spellListAdditions?: Record<string, string[]> }).spellListAdditions ?? {})['animist-dedication-casting'] ?? [];
    expect(pool).toEqual([]);
  });
});

describe('Free Heart grants a second background package', () => {
  /*
   * *"Choose a COMMON BACKGROUND that relates to a passion you've pursued; you're TRAINED IN THE
   * SKILLS and gain the SKILL FEAT associated with that background, in addition to those in your
   * normal background."* The feat shipped a free-text box whose own note admitted the answer changed
   * nothing: *"Recorded only. Heroes Heaven can't apply a background's package from a feat yet."*
   */
  const withPassion = (bgId: string) =>
    build('fighter', 4, { featPicks: { '2:skill': 'free-heart' }, featChoices: { '2:skill': bgId } } as never);

  it('offers common backgrounds and excludes the character’s own', () => {
    const def = db.feats['free-heart'].choice!;
    expect(def.kind, 'a live picker, not a text box').toBe('open');
    expect(def.from?.type).toBe('background');
    expect(def.from?.rarity, 'the printed restriction').toBe('common');
    expect((def as { inert?: string }).inert, 'it is no longer inert').toBeUndefined();

    const opts = openChoiceOptions(def.from, db, {});
    expect(opts.length).toBeGreaterThan(100);
    for (const o of opts) expect((db.backgrounds[o.id] as { rarity?: string }).rarity ?? 'common').toBe('common');
  });

  it("grants the chosen background's skill feat", () => {
    /* Acrobat grants Steady Balance — and the control proves it arrives from the CHOICE, not from
     * anything the fighter would have had anyway. */
    expect(db.backgrounds['acrobat']?.grantedFeatId).toBe('steady-balance');
    expect(withPassion('acrobat').feats.map((f) => f.featId)).toContain('steady-balance');
    expect(build('fighter', 4).feats.map((f) => f.featId), 'control').not.toContain('steady-balance');
  });

  it("grants the chosen background's trained skill", () => {
    /* A background whose skill a fighter does NOT get by default, so the assertion means something. */
    const bg = Object.values(db.backgrounds).find(
      (b) => (b as { trainedSkill?: string }).trainedSkill === 'occultism' && (b.rarity ?? 'common') === 'common',
    ) as { id: string } | undefined;
    if (!bg) return;
    expect(build('fighter', 4).proficiencies.skills.occultism ?? 'untrained', 'control').toBe('untrained');
    expect(withPassion(bg.id).proficiencies.skills.occultism).toBe('trained');
  });
});
