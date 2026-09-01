import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveMaxHp, deriveStrikes } from '../src/rules/derive';
import { CATALOG_MODE_MAP } from '../src/rules/modes';

const db = content();

/**
 * Records closed in Wanderer's-Guide parity batch 12.
 *
 * Everything here is asserted on a BUILT character wherever a character can express it. A gate passing
 * proves the four comparers agree about the DATA; it says nothing about whether a player receives it,
 * and this project's most persistent defect has been correct data behind a reader that never looks.
 */

describe('Modular Dynamo reconfigures the dynamo attack', () => {
  /*
   * THE defect of this batch. The record already asked the question — nine configurations, correctly
   * split by whether the dynamo is automatic or manual, each labelled with its damage and traits — and
   * then did nothing with the answer. The player read "1d6 slashing damage; trip", chose it, and their
   * Strikes page went on showing the configuration picked at the Dedication.
   */
  /* `featChoices` is keyed by the SLOT the feat was taken in, not by the feat id. */
  const withConfig = (config: string) =>
    build('fighter', 6, {
      featPicks: { '2:class': 'sterling-dynamo-dedication', '4:class': 'modular-dynamo' },
      featChoices: { '2:class': 'feature:dynamo:manual-power', '4:class': config },
    } as never);

  const dynamos = (config: string) =>
    deriveStrikes(withConfig(config), db).filter((s) => s.name.startsWith('Dynamo'));

  it('grants the chosen configuration as a real Strike', () => {
    const sickle = dynamos('modular:manual-rotating-sickle').find((s) => s.name.includes('rotating sickle'));
    expect(sickle, 'the rotating sickle must exist as a strike, not just as a label').toBeTruthy();
    /* A derived strike states its damage as one string — the die AND the type, both of which the
     * configuration changes. "1d8 S" is the manual rotating sickle exactly as printed. */
    expect(sickle?.damage).toBe('1d8 S');
    expect(sickle?.traits).toContain('trip');
    /* "Your dynamo attack gains the modular trait" — the trait is part of what the feat grants. */
    expect(sickle?.traits).toContain('modular');
  });

  it('grants only the configuration that was chosen', () => {
    const strikes = dynamos('modular:manual-entangling-barbs');
    expect(strikes.some((s) => s.traits?.includes('grapple'))).toBe(true);
    expect(strikes.some((s) => s.traits?.includes('trip'))).toBe(false);
  });

  it('keeps the Dedication configuration beside it — the modular trait swaps between the two', () => {
    /* Not a duplicate: *"you switch between the initial configuration of dynamo you chose with the
     * Sterling Dynamo Dedication and the new configuration"*. Both must be on the sheet to swap —
     * and because `collectGrantedStrikes` dedupes by NAME, they must not share one. */
    const strikes = dynamos('modular:manual-rotating-sickle');
    expect(strikes.length).toBeGreaterThanOrEqual(2);
    expect(strikes.some((s) => s.name === 'Dynamo' && !s.traits?.includes('modular'))).toBe(true);
    expect(strikes.some((s) => s.name === 'Dynamo (rotating sickle)')).toBe(true);
  });

  it('the manual configurations are one die size larger, as printed', () => {
    const auto = db.feats['modular-dynamo'].grantedStrikes ?? [];
    const die = (v: string) => auto.find((s) => s.choiceValue === v)?.die;
    expect(die('modular:auto-power-driver')).toBe('d6');
    expect(die('modular:manual-power-driver')).toBe('d8');
    expect(die('modular:auto-percussive-striker')).toBe('d4');
    expect(die('modular:manual-percussive-striker')).toBe('d6');
    /* "…which has the damage increase already factored in" — the baton does NOT step up again. */
    expect(die('modular:manual-extendable-baton')).toBe('d4');
  });

  it('every option the record offers has a strike behind it', () => {
    /* The guard that matters more than any single die: an option with no strike is the original bug
     * in miniature, and a later edit adding a tenth configuration would reintroduce it silently. */
    const opts = (db.feats['modular-dynamo'].choice?.options ?? []).map((o) => o.value);
    const gated = new Set((db.feats['modular-dynamo'].grantedStrikes ?? []).map((s) => s.choiceValue));
    expect(opts.length).toBeGreaterThan(0);
    expect(opts.filter((v) => !gated.has(v))).toEqual([]);
  });
});

describe('a construct companion comes with the action that commands it', () => {
  /*
   * `actions['command-a-construct']` shipped, and `grantsActions` is how a record puts an action on
   * the sheet — 140 records use it. Two of the four records that hand you a construct companion
   * granted it and two did not, so those owners had a companion and no printed action to command it.
   */
  const GRANTERS: [string, 'feats' | 'classFeatures'][] = [
    ['rise-my-creature', 'feats'],
    ['construct-innovation', 'classFeatures'],
    ['prototype-companion', 'feats'],
    ['clockwork-reanimator-dedication', 'feats'],
  ];

  it.each(GRANTERS)('%s grants Command a Construct', (id, bucket) => {
    expect(db[bucket][id]?.grantsActions ?? []).toContain('command-a-construct');
  });

  it('the action it names actually exists', () => {
    /* A `grantsActions` id with no action behind it reaches the sheet as nothing at all. */
    expect(db.actions['command-a-construct']).toBeTruthy();
  });
});

describe('the mechanics the comparers could not see are really there', () => {
  /*
   * Three records reported whole mechanics missing while shipping them, because the instruments read
   * core.json only: two registries live in TypeScript and never land there. The comparer fixes are in
   * scripts/wg-diff.mjs; these assert the mechanics themselves, so a future deletion fails here rather
   * than being re-discovered as a parity "gap" batches later.
   */
  it('Invoke Offense manifests its spirit attack while the trance is up', () => {
    const mode = CATALOG_MODE_MAP['cat-invoke-offense'];
    expect(mode?.feats, 'gated on the feat, not on the dedication').toContain('invoke-offense');
    const strike = (mode?.grantedStrikes ?? [])[0];
    expect(strike?.die).toBe('d8');
    expect(strike?.damageType).toBe('spirit');
    expect(strike?.group).toBe('brawling');
    expect(strike?.traits).toEqual(expect.arrayContaining(['agile', 'finesse', 'magical']));
    /* "At 5th level … a striking rune. At 12th … greater. At 20th … major." */
    expect((strike?.strikingByLevel ?? []).map((s) => s.level)).toEqual([5, 12, 20]);
  });

  it('Raging Athlete gives climb and swim Speeds equal to your land Speed while raging', () => {
    const clause = (db.feats['raging-athlete'].whileActive ?? [])[0];
    expect(clause?.state).toBe('rage');
    expect(clause?.speeds?.climb).toBe('@actor.speed.land');
    expect(clause?.speeds?.swim).toBe('@actor.speed.land');
  });

  it('the archetype spellcasting ladders reach a built character', () => {
    /* Four `basic-*-spellcasting` feats reported `spellSlot` missing. The ladder is real; it is keyed
     * by the DEDICATION in casterArchetypes.ts and its tier ids are minted by `mk()`, so those ids
     * appear nowhere as text. Asserted on characters, which is the only proof that matters. */
    const slots = (ded: string, basic: string, extra?: Record<string, unknown>) => {
      const ch = build('fighter', 8, {
        featPicks: { '2:class': ded, '4:class': basic },
        ...extra,
      } as never);
      const e = ch.spellcasting?.find((x) => x.id === `${ded}-casting`);
      return e ? { trad: e.tradition, ranks: Object.keys(e.prepared ?? e.slots ?? {}) } : null;
    };
    expect(slots('animist-dedication', 'basic-animist-spellcasting')).toEqual({
      trad: 'divine',
      ranks: ['1', '2', '3'],
    });
    expect(slots('rivethun-involutionist-dedication', 'basic-rivethun-spellcasting')?.ranks).toEqual(['1', '2', '3']);
    /* Hedge Mage's tradition follows the SKILL the dedication asked for, not a free pick. */
    expect(
      slots('hedge-mage-dedication', 'basic-hedge-mage-spellcasting', {
        featSkillChoices: { 'hedge-mage-dedication:0': 'nature' },
      }),
    ).toEqual({ trad: 'primal', ranks: ['1', '2', '3'] });
  });
});

describe('Monk Resiliency scales with the archetype, as printed', () => {
  /*
   * Recorded as a settle rather than adopted: their row hangs a FLAT 3 Hit Points off Basic Kata,
   * gated on having picked Monk Resiliency. The printed text is *"You gain 3 additional Hit Points FOR
   * EACH monk archetype class feat you have… you continue to gain additional Hit Points in this way."*
   */
  it('carries the per-feat form, not a flat bonus', () => {
    const hp = db.feats['monk-resiliency'].maxHpBonus;
    expect(hp?.perArchetypeFeat).toBe(3);
    expect(hp?.flat, 'a flat 3 would be their number, not the book’s').toBeUndefined();
    expect(hp?.archetype).toBe('monk');
  });

  /*
   * The owner's ruling, restated 2026-08-27: "3 extra maximum HP per barbarian archetype class feat
   * held, RECOMPUTED as more are taken — and make sure that also recomputes when they are REMOVED;
   * things given when a feat is added must disappear when it is removed in the builder."
   *
   * buildCharacter is a pure function of the build state, so removal IS a rebuild without the feat —
   * but that property is exactly what this asserts on BUILT characters, so a caching or
   * accumulate-in-place regression can never ship silently.
   */
  it('the Hit Points recompute on ADD and disappear on REMOVE', () => {
    const hp = (ch: ReturnType<typeof build>) => deriveMaxHp(ch, db);
    const picks = (extra: Record<string, string>) =>
      build('fighter', 8, { featPicks: { '2:class:0': 'barbarian-dedication', '4:class:0': 'barbarian-resiliency', ...extra } });
    const base = picks({});
    const withFeat = picks({ '8:class:0': 'basic-fury' });
    // ADD: one more barbarian archetype class feat → exactly +3 maximum HP.
    expect(hp(withFeat) - hp(base)).toBe(3);
    // REMOVE: rebuilding without the feat gives back exactly the pre-add total — nothing sticks.
    expect(hp(picks({}))).toBe(hp(base));
    // REMOVE the resiliency itself: the whole per-feat bonus disappears with it.
    const noResiliency = build('fighter', 8, { featPicks: { '2:class:0': 'barbarian-dedication', '8:class:0': 'basic-fury' } });
    const withResiliency = build('fighter', 8, { featPicks: { '2:class:0': 'barbarian-dedication', '4:class:0': 'barbarian-resiliency', '8:class:0': 'basic-fury' } });
    // 3 per barbarian archetype class feat held: dedication + resiliency + basic-fury = 9.
    expect(hp(withResiliency) - hp(noResiliency)).toBe(9);
  });
});
