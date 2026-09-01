import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveSkill } from '../src/rules/derive';
import { FEAT_GRANTS } from '../src/rules/featGrants';
import type { BuildState } from '../src/rules/build';

const db = content();

/** Records the Wanderer's Guide parity pass found broken in batch 6. */

describe('records that shipped with nothing at all', () => {
  it('Powerful Tail grants its tail, and its Enhancement a climb Speed', () => {
    /* "You gain a tail unarmed attack that deals 1d6 bludgeoning damage. This tail is in the brawling
     * group. **Enhancement** … You gain a climb Speed of 10 feet." The record was empty. */
    const s = db.feats['powerful-tail'].grantedStrikes?.[0];
    expect([s?.name, s?.die, s?.damageType, s?.group]).toEqual(['Tail', 'd6', 'bludgeoning', 'brawling']);
    expect((db.feats['powerful-tail'] as { enhancement?: { grant?: { speeds?: Record<string, number> } } }).enhancement?.grant?.speeds)
      .toEqual({ climb: 10 });
  });

  it('reaches a built character', () => {
    const ch = build('fighter', 1, { featPicks: { '1:ancestry': 'powerful-tail' } as BuildState['featPicks'] });
    expect((ch.naturalAttacks ?? []).map((n) => String(n.name).toLowerCase())).toContain('tail');
  });

  it('Death Speaker carries both printed clauses', () => {
    const sit = (db.feats['death-speaker'] as { situational?: { bonus: string }[] }).situational ?? [];
    expect(sit).toHaveLength(2);
    expect(sit[0].bonus).toBe('+1 circumstance');
    expect(sit[1].bonus).toMatch(/mindless/);
  });

  it('Elven Aloofness carries both printed clauses', () => {
    const sit = (db.feats['elven-aloofness'] as { situational?: { when: string }[] }).situational ?? [];
    expect(sit).toHaveLength(2);
    expect(sit[0].when).toMatch(/Coerces you/);
    expect(sit[1].when).toMatch(/Demoralizes you/);
  });

  it('Native Waters asks fresh-or-salt and states the rest benefit', () => {
    const opts = (db.feats['native-waters'].effectChoices?.[0]?.options ?? []).map((o) => o.value);
    expect(opts).toEqual(['fresh', 'salt']);
    expect(db.feats['native-waters'].note).toMatch(/additional Hit Points equal to your level/);
  });

  it('Twin Stars records which ikon carries it', () => {
    /* The flag was `twinStarsIkon` on an inert free-text box. The adversarial settle audit ruled that
     * an unreadable answer is not a recorded one, so the three imbue feats now share the `imbuedIkon`
     * flag on a real `kind: 'ikons'` picker narrowed to the type each one's Usage line prints. */
    const def = db.feats['twin-stars'].choice;
    expect(def?.flag).toBe('imbuedIkon');
    expect(def?.kind).toBe('ikons');
    expect(def?.ikonType).toBe('weapon');
    expect(def?.inert).toBeUndefined();
  });
});

describe('records missing half their text', () => {
  /* "You know the EMPYREAN language." The Society training and the Multilingual grant both shipped. */
  it('Angelkin grants Empyrean', () => {
    expect((db.feats['angelkin'] as { grantsLanguages?: string[] }).grantsLanguages).toEqual(['empyrean']);
    expect(db.languages?.['empyrean'], 'the language must ship').toBeTruthy();
  });

  it('Angelkin reaches a built character', () => {
    const ch = build('fighter', 1, { featPicks: { '1:ancestry': 'angelkin' } as BuildState['featPicks'] });
    expect(ch.languages.map((l) => String(l).toLowerCase())).toContain('empyrean');
  });

  /* "You can cast the Tangle Vine cantrip as an innate PRIMAL OR ARCANE spell at will." The spell
   * shipped with no tradition, so the choice the feat prints was never asked. */
  it('Springsoul asks which tradition, and grants Tangle Vine at it', () => {
    const opts = db.feats['springsoul'].effectChoices?.[0]?.options ?? [];
    expect(opts.map((o) => o.value)).toEqual(['arcane', 'primal']);
    for (const o of opts) {
      expect(o.grant?.innateSpells?.[0]).toMatchObject({ spellId: 'tangle-vine', tradition: o.value, atWill: true });
    }
  });

  /* The six we shipped are the SUBSTITUTE list a physical-breath benefactor picks from, not the types
   * a benefactor can have — the same defect as Draconic Resistance in batch 3. */
  it("Benefactor's Resistance offers all ten damage types", () => {
    const opts = (db.feats['benefactors-resistance'].effectChoices?.[0]?.options ?? []).map((o) => o.value);
    expect(opts).toEqual(['acid', 'cold', 'electricity', 'fire', 'poison', 'sonic', 'force', 'mental', 'spirit', 'void']);
    for (const o of db.feats['benefactors-resistance'].effectChoices![0].options!) {
      expect(o.grant?.resistances?.[0]?.type, `${o.value} must resist its own type`).toBe(o.value);
    }
  });

  /* The third kineticist armour impulse, and the third to ship nothing. */
  it('Armor in Earth creates both tiers with the printed statistics', () => {
    expect(db.feats['armor-in-earth'].grantsItems?.map((g) => g.itemId))
      .toEqual(['armor-in-earth-medium', 'armor-in-earth-heavy']);
    const m = db.items['armor-in-earth-medium'];
    expect([m.category, m.acBonus, m.dexCap, m.checkPenalty, m.speedPenalty, m.strength, m.bulk, m.group])
      .toEqual(['medium', 4, 1, -2, -10, 3, 1, 'plate']);
    const h = db.items['armor-in-earth-heavy'];
    expect([h.category, h.acBonus, h.traits]).toEqual(['heavy', 5, ['bulwark']]);
  });

  /* Their side names the ancestry TRAIT; ours enumerated and so stopped covering the feat the moment a
   * refresh added a weapon. */
  it('Conrasu and Vanara weapon familiarity name their ancestry trait', () => {
    for (const [id, trait] of [['conrasu-weapon-familiarity', 'conrasu'], ['vanara-weapon-familiarity', 'vanara']] as const) {
      /*
       * ANY clause, not the first. These feats print two rules — a flat trained rank for the named
       * weapons, and a category demotion for the ancestry-trait ones — and the trait now lives in the
       * second clause. Reading only wf[0] asserted the shape rather than the requirement.
       */
      const wf = FEAT_GRANTS[id]?.weaponFamiliarity;
      const clauses = Array.isArray(wf) ? wf : wf ? [wf] : [];
      const traits = clauses.flatMap((cl) => cl?.traits ?? []);
      expect(traits, `${id} must name the ${trait} trait in one of its clauses`).toContain(trait);
    }
  });
});

describe('Death Speaker reaches the sheet', () => {
  it('does not change Diplomacy unconditionally — it is a situational', () => {
    const withFeat = build('fighter', 1, { featPicks: { '1:class': 'death-speaker' } as BuildState['featPicks'] });
    const without = build('fighter', 1);
    expect(deriveSkill(withFeat, 'diplomacy', db).modifier).toBe(deriveSkill(without, 'diplomacy', db).modifier);
  });
});
