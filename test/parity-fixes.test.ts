import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveStrikes, deriveMaxHp, deriveSave } from '../src/rules/derive';
import type { BuildState } from '../src/rules/build';
import { CLASS_RESOURCES } from '../src/rules/classResources';
import { PROFICIENCY_RANKS as RANKS } from '../src/rules/types';

/*
 * DIVERGENCES FROM WANDERER'S GUIDE, FIXED.
 *
 * The owner's rule is the EXACT same implementation as theirs, and an audit of all 219 settles found 18
 * records where we quietly did something else. These assert the fixes on a BUILT character, because a
 * field that parses and reaches nothing is this project's most common way to be wrong.
 */
const db = content();

describe("both branches of the kineticist's Gate's Threshold grant a feat", () => {
  /*
   * *"Fork the Path: … Add a new element of your choice… GAIN AN IMPULSE FEAT of your level or lower
   * with the trait of that element."* The grant loop skipped a forked threshold outright — comment and
   * all — so a kineticist who forked got the element and no feat: four short by 17th level.
   */
  const at5 = (extra: Partial<BuildState>) => build('kineticist', 6, extra as Partial<BuildState>);

  it('Expand the Portal still grants its impulse', () => {
    const ch = at5({ gateExpands: { '5': 'flying-flame' } } as Partial<BuildState>);
    expect(ch.feats.map((f) => f.featId)).toContain('flying-flame');
  });

  it('Fork the Path grants one too', () => {
    const forkEl = Object.keys(db.feats).length ? 'water-gate' : '';
    const impulse = Object.values(db.feats).find(
      (f) => f.traits?.includes('impulse') && f.traits.includes('water') && !f.traits.includes('composite') && f.level <= 5,
    );
    expect(impulse, 'the corpus must offer a water impulse at or below 5th for this case to mean anything').toBeTruthy();

    const ch = at5({ gateForks: { '5': forkEl }, gateForkImpulses: { '5': impulse!.id } } as Partial<BuildState>);
    expect(ch.feats.map((f) => f.featId), 'the fork branch grants its impulse').toContain(impulse!.id);
  });

  it('a fork with no impulse chosen grants nothing — and does not fall back to the other branch', () => {
    /* The two branches read their OWN map, so a stale Expand answer cannot leak into a forked
     * threshold and hand over a feat the fork's narrower filter would never have offered. */
    const ch = at5({ gateForks: { '5': 'water-gate' }, gateExpands: { '5': 'flying-flame' } } as Partial<BuildState>);
    expect(ch.feats.map((f) => f.featId)).not.toContain('flying-flame');
  });
});

describe('grants that pointed at the wrong record', () => {
  it('Elemental Wrath casts the current spell, not the superseded one', () => {
    /* Our `acid-splash` is stamped edition 'superseded' — the legacy single-target spell attack. The
     * current printing is Caustic Blast, a 5-foot burst. A player was casting the wrong spell. */
    expect((db.spells['acid-splash'] as { edition?: string }).edition).toBe('superseded');
    expect(db.feats['elemental-wrath'].innateSpells?.[0]?.spellId).toBe('caustic-blast');

    /* BOTH carriers, or the player gets two different cantrips. The record holds a flat grant and a
     * four-option choice, and they must name the same spell. */
    const ids = new Set<string>([
      ...(db.feats['elemental-wrath'].innateSpells ?? []).map((g) => g.spellId),
      ...(db.feats['elemental-wrath'].effectChoices ?? []).flatMap((e) =>
        (e.options ?? []).flatMap((o) => (o.grant?.innateSpells ?? []).map((g) => g.spellId)),
      ),
    ]);
    expect([...ids], 'one spell across both carriers').toEqual(['caustic-blast']);
  });
});

describe('clauses that were only partly delivered', () => {
  it("Spirit Warrior's fist is 1d6 with parry, not just non-nonlethal", () => {
    /* *"The damage die for your fist changes to 1d6 instead of 1d4, and your fist gains the parry
     * trait."* Ours stripped `nonlethal` and did nothing else. */
    const riders = db.feats['spirit-warrior-dedication'].unarmedTraits;
    const list = Array.isArray(riders) ? riders : riders ? [riders] : [];
    const fist = list.find((r) => r.match?.includes('fist'));
    expect(fist?.setDie, 'the printed die').toBe('d6');
    expect(fist?.add, 'the printed trait').toContain('parry');
    /* …and the lethal-attack clause stays UNMATCHED: it says "your fist or any other unarmed attacks". */
    expect(list.find((r) => !r.match)?.remove).toContain('nonlethal');
  });

  it('Zombie Dedication states the survival clause its five siblings carry', () => {
    expect(db.feats['zombie-dedication'].note ?? '').toMatch(/knocked out|dying/i);
  });
});

describe('archetypes that granted the wrong subsystem', () => {
  it('Firework Technician grants pyrotechnic vials and Quick Alchemy, not an Advanced Alchemy budget', () => {
    /*
     * *"You gain the [Quick Alchemy benefits], creating up to 4 PYROTECHNIC VERSATILE VIALS during your
     * daily preparations."* Ours granted `advancedAlchemy: { items: 4 }` — a prepared-item allowance the
     * feat never mentions — with no Quick Alchemy and no vial counter, so Launch Fireworks, the action
     * the whole archetype exists for, had nothing to spend.
     */
    const rec = db.feats['firework-technician-dedication'] as { advancedAlchemy?: unknown; grantsActions?: string[] };
    expect(rec.advancedAlchemy, 'the wrong subsystem must be gone').toBeUndefined();
    expect(rec.grantsActions).toContain('quick-alchemy');
    expect(rec.grantsActions, 'and its own action stays').toContain('launch-fireworks');

    const vials = CLASS_RESOURCES.alchemist.filter((r) => r.id === 'versatile-vials');
    const mine = vials.find((r) => r.feat === 'firework-technician-dedication');
    expect(mine?.maxBase, 'the printed four').toBe(4);
    expect(mine?.note).toMatch(/pyrotechnic/i);
  });
});

describe('the animist Medium reaches its own focus clause', () => {
  it('Dual Invocation gives two primary apparitions from 9th', () => {
    /* *"Dual Invocation (9th): … you can select TWO of your attuned apparitions to be your primary
     * apparitions… the number of Focus Points … is equal to the number of focus spells you have or the
     * number of PRIMARY apparitions you are attuned to, whichever is higher (maximum 3)."* Nothing read
     * the practice, so a Medium came out identical to every other animist. */
    const APPS = (db.classes.animist.extraChoices ?? []).find((g) => g.id === 'apparition')?.options ?? [];
    const ids = APPS.map((o) => (o as { value?: string; id?: string }).value ?? (o as { id: string }).id);
    const medium = (level: number) =>
      build('animist', level, { subclassId: 'medium', extraChoices: { apparition: ids.slice(0, 4) } } as Partial<BuildState>);
    expect(medium(9).focus?.max, 'at 9th the clause applies').toBeGreaterThanOrEqual(2);
    expect(medium(20).focus?.max, 'and never exceeds the printed cap').toBeLessThanOrEqual(3);
  });
});

describe('heightening that was dropped', () => {
  it("Colugo's Traversal heightens to 3rd rank at 9th level", () => {
    /* *"You can cast your choice of Gentle Landing or Jump as a primal innate spell once per day. AT
     * 9TH LEVEL, these spells are heightened to 3rd rank."* The pick lived in FEAT_CANTRIP_GRANTS,
     * whose own header says feat heightening is not modelled — it pushes a bare {spellId, tradition} —
     * so the spell was cast at rank 1 from 5th to 20th. */
    const opts = (db.feats['colugos-traversal'].effectChoices ?? []).flatMap((e) => e.options ?? []);
    expect(opts.length, 'both printed spells are offered').toBe(2);
    for (const o of opts) {
      const g = o.grant?.innateSpells?.[0];
      expect(g?.rank, 'the base rank').toBe(1);
      expect(g?.usesPerDay, 'once per day').toBe(1);
      expect(g?.heightenAt, 'the 9th-level heightening').toEqual([{ level: 9, rank: 3 }]);
    }
  });
});

describe('conditional upgrades applied to everyone', () => {
  it("Puncturing Horn's d8 is xyloshi-only", () => {
    /* *"You gain a horn unarmed attack that deals 1D6 piercing damage… Special: If you have the XYLOSHI
     * heritage, your horn instead deals 1D8."* The rider sat on the FEAT, so every kashrishi who took
     * it got the xyloshi upgrade regardless of heritage. */
    /*
     * ⚠ Read the DERIVED strike, not `naturalAttacks`. The latter is the raw granted list, collected
     * before `applyUnarmedRiders` runs — so a rider that works perfectly reads as absent there, which
     * is exactly what my first version of this case reported.
     */
    const horn = (c: ReturnType<typeof build>) => deriveStrikes(c, db).find((s) => /horn/i.test(s.name))?.damage ?? '';

    const other = build('fighter', 3, { ancestryId: 'kashrishi', heritageId: 'chattering-kashrishi', featPicks: { '1:ancestry': 'puncturing-horn' } } as Partial<BuildState>);
    const xyloshi = build('fighter', 3, { ancestryId: 'kashrishi', heritageId: 'xyloshi', featPicks: { '1:ancestry': 'puncturing-horn' } } as Partial<BuildState>);

    expect(horn(xyloshi), 'a xyloshi horn is d8').toMatch(/1d8/);
    if (horn(other)) expect(horn(other), 'any other heritage keeps the printed d6').toMatch(/1d6/);
    /* The rider must live on the heritage, not the feat — that is what makes it conditional. */
    expect(db.feats['puncturing-horn'].unarmedTraits).toBeUndefined();
    expect(db.heritages['xyloshi'].unarmedTraits?.[0]?.setDie).toBe('d8');
  });
});

describe('conditional relief modelled as a permanent bonus', () => {
  /*
   * *"WHEN YOU HAVE THE DRAINED CONDITION, calculate the penalty to your Fortitude saves and your Hit
   * Point reduction as though the condition value were 1 lower."* Ours shipped an unconditional
   * `maxHpBonus` of 1/level, so a character who had never been drained carried extra Hit Points, and
   * the Fortitude half did not exist at all.
   *
   * ⚠ Svetocher is a FEAT (a dhampir lineage feat), not a heritage. My first version of this case set
   * it as `heritageId`, so the character never had it and the test measured the ancestry instead.
   */
  const withFeat = (drained?: number) => {
    const ch = build('fighter', 8, { featPicks: { '1:ancestry': 'svetocher' } } as Partial<BuildState>);
    return drained == null ? ch : ({ ...ch, conditions: [{ id: 'drained', value: drained }] } as typeof ch);
  };
  const without = (drained?: number) => {
    const ch = build('fighter', 8);
    return drained == null ? ch : ({ ...ch, conditions: [{ id: 'drained', value: drained }] } as typeof ch);
  };

  it('the feat is actually on the character (the control my first version lacked)', () => {
    expect(withFeat().feats.map((f) => f.featId)).toContain('svetocher');
  });

  it('gives no Hit Points while undrained', () => {
    expect(deriveMaxHp(withFeat(), db), 'the relief is conditional, not a bonus').toBe(deriveMaxHp(without(), db));
  });

  it('softens the drained HP loss by one step', () => {
    /* Drained 2 costs 2 × level normally; with the feat it costs 1 × level — a level-8 difference of 8. */
    expect(deriveMaxHp(withFeat(2), db) - deriveMaxHp(without(2), db)).toBe(8);
    /* …and drained 1 costs nothing at all, because "one lower" than 1 is 0. */
    expect(deriveMaxHp(withFeat(1), db)).toBe(deriveMaxHp(without(), db));
  });

  it('softens the Fortitude penalty too', () => {
    expect(deriveSave(withFeat(2), 'fortitude', db).modifier).toBeGreaterThan(deriveSave(without(2), 'fortitude', db).modifier);
  });

  it('the record carries the reduction, not an HP bonus', () => {
    expect(db.feats['svetocher'].maxHpBonus).toBeUndefined();
    expect((db.feats['svetocher'] as { drainedReduction?: number }).drainedReduction).toBe(1);
  });
});

describe('progressions that stopped at trained', () => {
  it("Invulnerable Rager's heavy armour tracks the barbarian medium track", () => {
    /* *"You are trained in heavy armor. Whenever you gain a barbarian class feature that grants you
     * EXPERT OR GREATER proficiency in medium armor, you also gain that proficiency in heavy armor."*
     * Ours granted trained and stopped, so a rager in heavy armour fell two ranks behind their own
     * medium armour from 13th on. */
    const rager = (level: number) => build('barbarian', level, { featPicks: { '9:class': 'invulnerable-rager' } } as Partial<BuildState>);
    expect(rager(12).proficiencies.defenses.heavy, 'before Medium Armor Expertise').toBe('trained');
    expect(rager(13).proficiencies.defenses.heavy, 'expert with the medium track').toBe('expert');
    expect(rager(19).proficiencies.defenses.heavy, 'and master with Armor Mastery').toBe('master');
    /* The control: heavy must never outrun the medium rank it mirrors. */
    for (const l of [12, 13, 19, 20]) {
      const c = rager(l);
      expect(RANKS.indexOf(c.proficiencies.defenses.heavy), `heavy must not exceed medium at ${l}`).toBeLessThanOrEqual(
        RANKS.indexOf(c.proficiencies.defenses.medium),
      );
    }
  });
});
