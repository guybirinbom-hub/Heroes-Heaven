import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveSkill, deriveStrikes } from '../src/rules/derive';
import { FEAT_GRANTS } from '../src/rules/featGrants';
import { FEAT_GRANT_BOUND_CHOICE, CHOICE_FEAT_GRANTS } from '../src/rules/featFeatGrants';
import { formulaGrantsOwned } from '../src/rules/formulaBook';
import { FEAT_COMPANION_GRANTS } from '../src/rules/companionGrants';
import { FEAT_SITUATIONAL } from '../src/rules/situationalBonuses';
import { recordMarkersFor } from '../src/rules/explain';
import type { BuildState } from '../src/rules/build';

/*
 * REGISTRY FIXES from the batches 1–12 residual read.
 *
 * These are the findings whose fix was a code change rather than a data row — the field lives on a
 * FeatGrant, not on a core.json record, so the data validator held them back. Each asserts the
 * DELIVERY on a built character wherever the lane reaches a number, because a registry entry that
 * parses and grants nothing is this project's most common way to be wrong.
 */
const db = content();

const at = (level: number, featId: string, slot = '2:class') =>
  build('fighter', level, { featPicks: { [slot]: featId } } as Partial<BuildState>);

describe('rank ladders that stopped short', () => {
  it('Acrobat Dedication reaches master at 7th, not just expert', () => {
    /* *"You become an expert… At 7TH LEVEL, you become a MASTER… and at 15th level, legendary."*
     * The 7th-level rung was absent, leaving the holder at expert for levels 7–14. */
    expect(deriveSkill(at(6, 'acrobat-dedication'), 'acrobatics', db).rank).toBe('expert');
    expect(deriveSkill(at(7, 'acrobat-dedication'), 'acrobatics', db).rank).toBe('master');
    expect(deriveSkill(at(15, 'acrobat-dedication'), 'acrobatics', db).rank).toBe('legendary');
  });
});

describe('weapon familiarity: the demotion clause', () => {
  /*
   * *"Martial <ancestry> weapons are simple weapons and advanced <ancestry> weapons are martial."*
   * Three feats stored one merged clause with a flat `rank: 'trained'`, so their ancestry weapons sat
   * at trained for all 20 levels instead of tracking the character's own proficiency.
   */
  for (const [id, trait] of [
    ['azarketi-weapon-familiarity', 'azarketi'],
    ['conrasu-weapon-familiarity', 'conrasu'],
    ['genie-weapon-familiarity', 'geniekin'],
  ] as const) {
    it(`${id} splits the named weapons from the ${trait} demotion`, () => {
      const wf = FEAT_GRANTS[id]?.weaponFamiliarity;
      const clauses = Array.isArray(wf) ? wf : wf ? [wf] : [];
      expect(clauses.length, 'two printed rules need two clauses').toBe(2);

      const named = clauses.find((c) => (c.weapons ?? []).length);
      expect(named?.rank, 'the named weapons are a flat trained rank').toBe('trained');
      expect(named?.treatAsLowerCategory, 'the named weapons are NOT demoted').toBeFalsy();

      const demoted = clauses.find((c) => c.treatAsLowerCategory);
      expect(demoted?.traits, 'the demotion is what the trait clause carries').toContain(trait);
    });
  }
});

describe('clauses that were dropped entirely', () => {
  it('Ostilli Host upgrades an existing rank instead of no-opping', () => {
    /* *"You become trained in Ostilli Lore; IF YOU WERE ALREADY TRAINED, you become an expert."*
     * Grants only raise, so a flat `trained` made the second half do nothing. */
    const g = FEAT_GRANTS['ostilli-host-dedication'];
    expect(g?.conditionalSkills?.['lore:ostilli']).toEqual({ base: 'trained', upgraded: 'expert' });
    expect(g?.skills?.['lore:ostilli'], 'the flat rank must be gone, or it wins and the upgrade is dead').toBeUndefined();
  });

  it('Wild Mimic gates its expert step on legendary Nature', () => {
    expect(FEAT_GRANTS['wild-mimic-dedication']?.crossConditionalSkills?.['lore:wild-mimic']).toEqual({
      whenSkill: 'nature',
      whenRank: 'legendary',
      rank: 'expert',
    });
  });

  it('Red Mantis Assassin mirrors its sabre proficiency', () => {
    /* *"Whenever your proficiency in ANY weapon increases to expert or beyond, you also gain that new
     * proficiency with sawtooth sabers."* The skills half was modelled; the weapon half was not. */
    const wf = FEAT_GRANTS['red-mantis-assassin-dedication']?.weaponFamiliarity;
    const one = Array.isArray(wf) ? wf[0] : wf;
    expect(one?.weapons).toContain('sawtooth-saber');
    expect(one?.mirrorBestCategory).toBe(true);
  });

  it('Embodied Legionary Subjectivity can replace a redundant grant', () => {
    expect(FEAT_GRANTS['embodied-legionary-subjectivity']?.redundantFallback).toBe(true);
  });
});

describe('over-grants', () => {
  it('Lizardfolk Lore no longer hands out Nature AND the Nature-or-Occultism choice', () => {
    /* Printed: *"trained in Survival AND EITHER Nature OR Occultism."* The entry granted `nature`
     * outright as well as offering the choice, so the holder got Nature free and a second skill. */
    const g = FEAT_GRANTS['lizardfolk-lore'];
    expect(g?.skills).toEqual({ survival: 'trained' });
    expect(g?.skillChoices?.[0]?.options).toEqual(['nature', 'occultism']);
    expect(g?.skills?.['lore:iruxi'], 'the lore comes via an Additional Lore FEAT, not a direct rank').toBeUndefined();
  });

  it('Alkenstar Agent offers Legal Lore, which was unreachable, and upgrades it', () => {
    const g = FEAT_GRANTS['alkenstar-agent-dedication'];
    expect(g?.skillChoices?.[0]?.options).toEqual(['lore:underworld', 'lore:legal']);
    expect(g?.skillChoices?.[0]?.conditionalRank).toEqual({ base: 'trained', upgraded: 'expert' });
    expect(g?.skills?.['lore:underworld'], 'hard-coding Underworld is what made Legal unreachable').toBeUndefined();
    expect(g?.skills?.deception, 'Deception is still flat expert').toBe('expert');
  });
});

describe('the second registry group — hand-authored and lore fallbacks', () => {
  it('Nephilim Lore offers the two printed skills, not every skill', () => {
    /*
     * ⚠ THE SEVERE ONE. It shipped `options: 'any'`, and featSkillChoiceValue (build.ts:1324) resolves
     * an UNANSWERED slot to opts[0] — SKILLS[0], acrobatics. So every nephilim who never opened the
     * picker was trained in Acrobatics, a skill the feat does not offer, and in neither of the two it
     * does. `unrestricted-skill-slot-check.mjs` now guards the shape corpus-wide.
     */
    const g = FEAT_GRANTS['nephilim-lore'];
    expect(g?.skillChoices?.[0]?.options).toEqual(['diplomacy', 'intimidation']);
    expect(g?.skills?.religion, 'Religion is still flat').toBe('trained');
  });

  it('Marshal and Bright Lion upgrade an already-trained choice', () => {
    for (const id of ['marshal-dedication', 'bright-lion-dedication']) {
      expect(FEAT_GRANTS[id]?.skillChoices?.[0]?.conditionalRank, `${id} drops "or expert if already trained"`).toEqual({
        base: 'trained',
        upgraded: 'expert',
      });
    }
  });

  it('Commander and Draconic Acolyte can fall back to another LORE', () => {
    /* A flat `skills` grant could never fire this: the record-wide fallback reader is guarded
     * `!key.startsWith('lore:')`, so the clause needs a slot with `loreFallback`. */
    for (const id of ['commander-dedication', 'draconic-acolyte-dedication']) {
      const slot = FEAT_GRANTS[id]?.skillChoices?.[0];
      expect(slot?.redundantFallback, `${id} must be replaceable`).toBe(true);
      expect(slot?.loreFallback, `${id}'s replacement is another Lore`).toBe(true);
      expect(FEAT_GRANTS[id]?.skills, 'the unreachable flat grant must be gone').toBeUndefined();
    }
  });
});

describe('granted feats that were left asking a question the text already answered', () => {
  it('four granters now bind the answer their sentence names', () => {
    /*
     * *"You gain the Specialty Crafting skill feat FOR WOODWORKING."* The granted feat was handed over
     * unbound, so its specialty was nothing at all until a player guessed one — and the +1 circumstance
     * star hung off that empty answer. Every bound value is checked against the granted feat's own
     * option list, so a typo cannot masquerade as a valid pick.
     */
    const bound = FEAT_GRANT_BOUND_CHOICE;
    expect(bound['woodworker']?.['specialty-crafting']).toEqual({ kind: 'fixed', skill: 'woodworking' });
    expect(bound['web-weaver']?.['specialty-crafting']).toEqual({ kind: 'fixed', skill: 'weaving' });
    expect(bound['shiny-button-eyes']?.['canny-acumen']).toEqual({ kind: 'fixed', skill: 'perception' });
    expect(bound['elemental-trade']?.['specialty-crafting'], 'names BOTH specialties').toEqual({
      kind: 'fixed',
      skill: ['stonemasonry', 'blacksmithing'],
    });
  });

  it('every bound value is a real option on the feat being granted', () => {
    const db2 = content();
    for (const [granter, grants] of Object.entries(FEAT_GRANT_BOUND_CHOICE)) {
      for (const [grantedId, spec] of Object.entries(grants)) {
        if (spec.kind !== 'fixed') continue;
        const opts = (db2.feats[grantedId]?.choice?.options ?? []).map((o) => o.value);
        if (!opts.length) continue;
        for (const v of Array.isArray(spec.skill) ? spec.skill : [spec.skill]) {
          expect(opts, `${granter} binds ${grantedId} to "${v}", which it does not offer`).toContain(v);
        }
      }
    }
  });

  it('Molten Wit grants the skill feat that goes with the branch', () => {
    /* *"You EITHER become trained in Deception and gain CHARMING LIAR, or Diplomacy and GROUP
     * IMPRESSION."* Only the skill training was modelled; the feat half was dropped either way. */
    expect(CHOICE_FEAT_GRANTS['molten-wit']).toEqual({ deception: ['charming-liar'], diplomacy: ['group-impression'] });
  });

  it('Skilled Herbalist replaces the Alchemical Crafting list instead of stacking with it', () => {
    /* It GRANTS alchemical-crafting, so both specs fired and the herbalist wrote four extra free
     * formulas on top of the three the text names. */
    const owned = formulaGrantsOwned(['skilled-herbalist', 'alchemical-crafting'], []);
    expect(owned).toContain('skilled-herbalist');
    expect(owned, 'the superseded list must not also write').not.toContain('alchemical-crafting');
    /* Control: on its own, Alchemical Crafting still writes. */
    expect(formulaGrantsOwned(['alchemical-crafting'], [])).toEqual(['alchemical-crafting']);
  });
});

describe('the weapon-familiarity demotion, third pass', () => {
  it('Ghoran and Vanara split; Jotunborn deliberately does not', () => {
    /*
     * The printed sentences differ and the shapes must follow them:
     *   ghoran/vanara — *"trained with <list>. IN ADDITION… martial <trait> weapons are simple"*, so
     *                   the demotion reaches ONLY the trait weapons: two clauses.
     *   jotunborn     — *"familiarity with <trait> weapons PLUS the bola… you treat ANY OF THESE that
     *                   are martial as simple"*, so it covers the named weapons too: one clause.
     */
    for (const id of ['ghoran-weapon-familiarity', 'vanara-weapon-familiarity']) {
      const wf = FEAT_GRANTS[id]?.weaponFamiliarity;
      expect(Array.isArray(wf), `${id} needs two clauses`).toBe(true);
      const clauses = wf as Exclude<typeof wf, undefined> & unknown[];
      expect(clauses.find((c) => (c.weapons ?? []).length)?.treatAsLowerCategory, 'named weapons are not demoted').toBeFalsy();
      expect(clauses.find((c) => c.treatAsLowerCategory)?.traits?.length, 'the trait clause carries the demotion').toBeTruthy();
    }

    const jot = FEAT_GRANTS['jotunborn-weapon-familiarity']?.weaponFamiliarity;
    const one = Array.isArray(jot) ? jot[0] : jot;
    expect(one?.treatAsLowerCategory, '"any of these" covers the named weapons too').toBe(true);
    expect(one?.weapons, 'so they stay in the same clause').toContain('greataxe');
    expect(one?.mirrorCategory, 'one rank for every weapon cannot demote an advanced weapon to martial').toBeUndefined();
  });
});

describe('familiars', () => {
  it('the kineticist elemental familiar uses Constitution', () => {
    /* *"The familiar uses your Constitution modifier to determine its Perception, Acrobatics, and
     * Stealth modifiers."* Without statAbility those three came out on the default ability. */
    expect(FEAT_COMPANION_GRANTS['elemental-familiar-kineticist']?.statAbility).toBe('con');
  });

  it('Basic Witchcraft raises the daily ability budget to three', () => {
    /* *"You can select THREE familiar abilities each day, instead of two."* Only its other sentence
     * (a 1st-/2nd-level witch feat) was delivered; the budget stayed at the dedication's 2. */
    const g = FEAT_COMPANION_GRANTS['basic-witchcraft'];
    expect(g?.abilityBudget).toBe(3);
    expect(g?.supersedes, 'it replaces the dedication budget rather than sitting beside it').toContain('witch-dedication');
  });
});

describe('situational clauses that were wrong or half-present', () => {
  it("Dragon's Presence names the printed condition, not a different one", () => {
    /*
     * ⚠ This one was WRONG, not missing. It shipped *"a foe of your size or larger"* where the book
     * says *"a foe OF YOUR LEVEL OR LOWER"* — a different test, and often the opposite one, so the
     * sheet told the player to apply +1 in exactly the fights where it does not apply.
     */
    const when = FEAT_SITUATIONAL['dragons-presence']?.[0]?.when ?? '';
    expect(when).toContain('level or lower');
    expect(when, 'the size test is not in this feat').not.toContain('size');
  });

  it('Draconic Sycophant and Coral Symbiotes carry both their clauses', () => {
    expect(FEAT_SITUATIONAL['draconic-sycophant']?.length, 'the −5 Make an Impression half was missing').toBe(2);
    expect(FEAT_SITUATIONAL['coral-symbiotes']?.length, 'the persistent-poison flat check was missing').toBe(2);
  });

  it('every situational `when` still fits ruling H', () => {
    const long = Object.entries(FEAT_SITUATIONAL).flatMap(([id, list]) =>
      (list ?? []).filter((b) => b.when.length > 120).map((b) => `${id} (${b.when.length})`),
    );
    expect(long).toEqual([]);
  });
});

describe('an item can annotate an action', () => {
  it("the Shootist Bandolier's reload clause reaches the sheet when worn", () => {
    /*
     * `recordMarksFor` walked feats, features, backgrounds, ancestries and heritages but NOT items, so
     * an item's `recordMarks` was write-only — it imported, stored, and reached nothing.
     */
    const db2 = content();
    expect(db2.items['shootist-bandolier']?.recordMarks?.[0]?.id).toBe('interact');

    const worn = {
      ...build('fighter', 3),
      inventory: [{ instanceId: 'b', itemId: 'shootist-bandolier', quantity: 1, worn: true }],
    };
    expect(recordMarkersFor(worn, db2, 'action', 'interact').length, 'worn: the mark reaches the Interact action').toBeGreaterThan(0);

    const stowed = { ...build('fighter', 3), inventory: [{ instanceId: 'b', itemId: 'shootist-bandolier', quantity: 1 }] };
    expect(recordMarkersFor(stowed, db2, 'action', 'interact').length, 'in the backpack it annotates nothing').toBe(0);
  });
});

describe('a stance Strike exists only inside the stance', () => {
  it('Crane Wing does not appear before the stance is entered, and not twice inside it', () => {
    /*
     * *"The only Strikes you can make are crane wing attacks."* `collectGrantedNaturals` pushed every
     * feat's grantedStrikes with no stance filter while the stance system separately rendered the same
     * Strike, so BOTH halves were wrong: a monk who had never entered the stance had Crane Wing on
     * their sheet, and a monk who had it entered had it listed twice.
     */
    const db2 = content();
    const monk = build('monk', 5, { featPicks: { '1:class': 'crane-stance' } });

    const out = deriveStrikes(monk, db2).map((s) => s.name.toLowerCase());
    expect(out, 'not entered: no crane wing').not.toContain('crane wing');
    expect(out, 'the ordinary Fist survives').toContain('fist');

    const entered = deriveStrikes({ ...monk, activeStance: 'crane-stance' }, db2).map((s) => s.name.toLowerCase());
    expect(entered.filter((n) => n === 'crane wing').length, 'entered: exactly one').toBe(1);
  });

  it('no stance feat loses its Strike to the filter', () => {
    /* The filter skips a stance feat only when its stance DEFINITION carries the Strike. This asserts
     * that premise across the corpus rather than trusting the sample that motivated it. */
    const db2 = content();
    const orphans: string[] = [];
    for (const [id, rec] of Object.entries(db2.feats)) {
      if (!(rec.traits ?? []).includes('stance') || !rec.grantedStrikes?.length) continue;
      const def = (db2 as { stances?: Record<string, { strikes?: { name?: string }[] }> }).stances?.[id];
      if (!def?.strikes?.length) continue;
      const inDef = new Set((def.strikes ?? []).map((s) => String(s?.name ?? s).toLowerCase()));
      for (const g of rec.grantedStrikes) if (!inDef.has(g.name.toLowerCase())) orphans.push(`${id}: ${g.name}`);
    }
    expect(orphans, 'a skipped Strike that the stance does not provide would vanish').toEqual([]);
  });
});
