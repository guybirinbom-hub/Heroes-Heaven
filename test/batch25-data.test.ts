import { describe, it, expect } from 'vitest';
import { content } from './_content';

const db = content();

/**
 * Wanderer's-Guide parity batch 25 — the DATA half (heritage records, two created records and two
 * description repairs). Every assertion below pins an authored field against the sentence that
 * required it, quoted in the test name, so a regeneration that drops the row fails here rather than
 * silently returning the record to its pre-batch shape.
 *
 * These read the shipped content through `content()` (public/core.json merged with
 * public/core-descriptions.json, exactly as the app loads it), because the rows are authored in
 * scripts/data/effect-backfill.json and only exist once `npm run data` has applied them.
 *
 * Three findings additionally need an ENGINE half that is not in this file; where that is so the test
 * pins the DATA and says which reader is still missing, so the pair cannot drift apart unnoticed.
 */

/** Untyped view of a record, for fields a lane's interface does not declare yet. */
const raw = (rec: unknown) => rec as unknown as Record<string, unknown>;

const her = (id: string) => db.heritages[id];

describe('batch 25 — size', () => {
  it('hopeful-athamaru-size: "Instead of Medium, your size is Large"', () => {
    // sizeOverride, not sizeSet: medium -> large is a RAISE, and build.ts:7696 is largest-wins.
    expect(her('hopeful-athamaru').sizeOverride).toBe('large');
  });

  it('wisp-fetchling-size: "You\'re Small instead of Medium"', () => {
    // sizeSet is the only operator that may LOWER (build.ts:7693-7695).
    expect(her('wisp-fetchling').sizeSet).toBe('small');
  });

  it('ponygait-centaur: "Instead of Large, your size is Medium"', () => {
    expect(her('ponygait-centaur').sizeSet).toBe('medium');
  });
});

describe('batch 25 — skills, languages and language slots', () => {
  it('wisp-fetchling-acrobatics: trained Acrobatics, or another skill if already trained', () => {
    const ch = (her('wisp-fetchling').effectChoices ?? []).find((e) => e.id === 'trained-skill');
    expect(ch, 'the picker that carries both the grant and the printed redirect').toBeTruthy();
    const opts = ch!.options ?? [];
    expect(opts[0].value, 'the base grant is the default option').toBe('acrobatics');
    expect(opts[0].grant?.skills?.acrobatics).toBe('trained');
    // "you instead become trained in a skill of your choice" — one alternate per other skill.
    expect(opts.length).toBe(16);
    for (const o of opts.slice(1)) expect(Object.values(o.grant?.skills ?? {})[0], o.value).toBe('trained');
  });

  it('fey-dragonet: "add Fey to your list of known languages"', () => {
    expect(her('fey-dragonet').grantsLanguages).toEqual(['fey']);
    expect(db.languages['fey'], 'the target language resolves').toBeTruthy();
  });

  it('house-drake: "You add Diabolic to your list of known languages"', () => {
    expect(her('house-drake').grantsLanguages).toEqual(['diabolic']);
    expect(db.languages['diabolic'], 'the target language resolves').toBeTruthy();
  });

  it('polyglot-android: two languages, three if you take Multilingual', () => {
    expect(her('polyglot-android').languageChoices).toBe(2);
    expect(her('polyglot-android').languageChoicesBonus).toEqual([{ featId: 'multilingual', extra: 1 }]);
    expect(db.feats['multilingual'], 'the named feat resolves').toBeTruthy();
  });
});

describe('batch 25 — creature traits and the mis-pointed page', () => {
  it('aon-ganzi: "You gain the ganzi trait in addition to the traits from your ancestry"', () => {
    // `traits` is the feat-eligibility key; only grantsCreatureTraits reaches creatureTraitsOf.
    expect(her('aon-ganzi').grantsCreatureTraits).toEqual(['ganzi']);
    expect(her('aon-ganzi').traits, 'the eligibility key is kept').toContain('ganzi');
  });

  it('aon-ganzi#aonid: the render carrier points at the heritage page, not the trait page', () => {
    expect(her('aon-ganzi').aonId).toBe('heritage-129');
  });

  it('aon-aphorite: "You gain the aphorite trait, in addition to the traits from your ancestry"', () => {
    expect(her('aon-aphorite').grantsCreatureTraits).toEqual(['aphorite']);
    expect(her('aon-aphorite').traits, 'the eligibility key is kept').toContain('aphorite');
  });
});

describe('batch 25 — speeds', () => {
  it('mistbreath-azarketi: "land Speed is 25 feet, but your swim Speed is only 15 feet"', () => {
    /*
     * The swim half is a REPLACE — heritage `speeds` overwrite the same-type chassis value at
     * derive.ts:4720, which is how the azarketi chassis 30 becomes 15. The land half must NOT ride
     * the same field: derive.ts:4730 also pushes every heritage record onto the additive grant path,
     * where derive.ts:4817 does `speeds.land = (speeds.land ?? 0) + v` — so `speeds.land: 25` is
     * counted twice and a built Mistbreath walked at 50 (measured). `landSpeedMin` is read once, at
     * derive.ts:4773, and is the operator every land statement in the corpus already uses.
     */
    expect(her('mistbreath-azarketi').speeds).toEqual({ swim: 15 });
    expect(her('mistbreath-azarketi').landSpeedMin).toBe(25);
  });

  it('no heritage states a land Speed through `speeds.land` — it would be double-counted', () => {
    /*
     * The guard behind the row above: `heritageRecords` feeds BOTH the replace path and the additive
     * grant path, so any positive `speeds.land` on a heritage is applied twice. Every land statement
     * in the corpus uses `landSpeedMin` instead (fodder-skeleton 30, flying-animal 20, running-animal
     * 30, cecaelia-merfolk 10); this pins the invariant so a later batch cannot re-introduce the shape.
     */
    const offenders = Object.entries(db.heritages)
      .filter(([, h]) => (h.speeds?.land ?? 0) > 0)
      .map(([id]) => id);
    expect(offenders).toEqual([]);
  });

  it('climbing-animal-land-speed: "a land Speed of 20 feet, a climb Speed of 20 feet"', () => {
    // A FLOOR, not speeds.land: derive.ts:4775 makes a granted land speed additive (5 + 20 = 25).
    expect(her('climbing-animal').landSpeedMin).toBe(20);
    expect(her('climbing-animal').speeds?.climb, 'the climb Speed already shipped').toBe(20);
  });
});

describe('batch 25 — the awakened-animal attack lane', () => {
  /** Howl of the Wild pg. 22, the "Animal Attacks" sidebar table. */
  const SIDEBAR: Record<string, { die: string; damageType: string; traits: string[] }> = {
    antler: { die: 'd6', damageType: 'piercing', traits: ['unarmed', 'finesse'] },
    beak: { die: 'd6', damageType: 'piercing', traits: ['unarmed', 'finesse'] },
    claw: { die: 'd4', damageType: 'slashing', traits: ['unarmed', 'agile', 'finesse'] },
    fangs: { die: 'd6', damageType: 'piercing', traits: ['unarmed', 'finesse'] },
    fist: { die: 'd4', damageType: 'bludgeoning', traits: ['unarmed', 'agile', 'finesse', 'nonlethal'] },
    horn: { die: 'd6', damageType: 'piercing', traits: ['unarmed', 'finesse'] },
    jaws: { die: 'd6', damageType: 'piercing', traits: ['unarmed', 'finesse'] },
    tail: { die: 'd6', damageType: 'bludgeoning', traits: ['unarmed', 'finesse', 'trip'] },
    talon: { die: 'd4', damageType: 'piercing', traits: ['unarmed', 'agile', 'finesse'] },
    tongue: { die: 'd6', damageType: 'bludgeoning', traits: ['unarmed', 'finesse'] },
    wing: { die: 'd4', damageType: 'bludgeoning', traits: ['unarmed', 'agile', 'finesse'] },
  };

  /*
   * Each heritage prints "one animal attack of your choice (typically …; see the sidebar)". "Typically"
   * does not restrict, and the sidebar prints all eleven rows and tells you to work with your GM — so
   * the picker offers all eleven and marks the printed ones typical, which is also what WG's feat 27916
   * offers. The picker records the answer; only `grantedStrikes` can create a Strike, because
   * EffectGrant (types.ts:1758-1818) has no strike lane.
   */
  const HERITAGES = ['climbing-animal', 'flying-animal', 'running-animal', 'swimming-animal'];

  for (const id of HERITAGES) {
    it(`${id}: offers all eleven sidebar attacks and backs each with a Strike`, () => {
      const pick = (her(id).effectChoices ?? []).find((e) => e.id === `${id}-attack`);
      expect(pick, `the picker id must be "${id}-attack" — build.ts:2432 derives the answer key from it`).toBeTruthy();
      expect((pick!.options ?? []).map((o) => o.value).sort()).toEqual(Object.keys(SIDEBAR).sort());

      const strikes = her(id).grantedStrikes ?? [];
      expect(strikes.length).toBe(11);
      for (const s of strikes) {
        const want = SIDEBAR[s.choiceValue ?? ''];
        expect(want, `${s.name} must be a sidebar row`).toBeTruthy();
        expect(s.die, s.name).toBe(want.die);
        expect(s.damageType, s.name).toBe(want.damageType);
        expect([...s.traits].sort(), s.name).toEqual([...want.traits].sort());
        expect(s.group, s.name).toBe('brawling');
      }
    });
  }

  it('swimming-animal: the water-dwelling branch alone carries the 20-foot land Speed', () => {
    /*
     * "Water-dwelling: … if you can move on land, you have base Speed of 20 feet." The aquatic branch
     * prints no land Speed, so this must never be a record-level landSpeedMin.
     * ⚠ ENGINE HALF: EffectGrant has no `landSpeedMin` and derive.ts:4735-4737 reads the floor off
     * records only — the option grant is authored here and the reader is added alongside.
     */
    const branch = (her('swimming-animal').effectChoices ?? []).find((e) => e.id === 'aquatic-or-water-dwelling');
    const opts = branch?.options ?? [];
    const water = opts.find((o) => o.value === 'water-dwelling');
    const aquatic = opts.find((o) => o.value === 'aquatic');
    expect(raw(water?.grant).landSpeedMin).toBe(20);
    expect(water?.grant?.speeds?.swim).toBe(20);
    expect(raw(aquatic?.grant).landSpeedMin, 'the aquatic branch keeps the chassis 5').toBeUndefined();
    expect(aquatic?.grant?.grantsCreatureTraits, 'the aquatic branch is unchanged').toEqual(['aquatic']);
    expect(raw(her('swimming-animal')).landSpeedMin, 'never at record level').toBeUndefined();
  });
});

describe('batch 25 — granted items, actions and unarmed riders', () => {
  it('rite-of-reinforcement: the exoskeleton is actually worn', () => {
    expect(her('rite-of-reinforcement').grantsItems).toEqual([
      { itemId: 'rite-of-reinforcement-exoskeleton', quantity: 1, worn: true },
    ]);
    expect(db.items['rite-of-reinforcement-exoskeleton'], 'the target item resolves').toBeTruthy();
  });

  it('coral-athamaru: the coral plates exist and are granted', () => {
    const it_ = db.items['coral-athamaru-armor'];
    expect(it_, 'created record').toBeTruthy();
    // "medium armor in the plate armor group … +4 item bonus to AC, a Dex cap of +1, a check penalty
    // of -2, a Speed penalty of -5 feet, a Strength value of +3 … aquadynamic and comfort traits"
    expect([it_.category, it_.group, it_.acBonus, it_.dexCap, it_.checkPenalty, it_.speedPenalty, it_.strength]).toEqual([
      'medium',
      'plate',
      4,
      1,
      -2,
      -5,
      3,
    ]);
    expect([...it_.traits].sort()).toEqual(['aquadynamic', 'comfort']);
    expect(her('coral-athamaru').grantsItems).toEqual([{ itemId: 'coral-athamaru-armor', quantity: 1, worn: true }]);
  });

  it('beastkin: "You gain the Change Shape ability"', () => {
    const act = db.actions['change-shape-beastkin'];
    expect(act, 'created record — core.json had only the anadi/kitsune/tanuki/yaoguai variants').toBeTruthy();
    expect(act.name).toBe('Change Shape');
    // AoN action-700: Concentrate, Polymorph, Primal, Transmutation, Single Action.
    for (const t of ['beastkin', 'concentrate', 'polymorph', 'primal', 'transmutation']) expect(act.traits, t).toContain(t);
    expect(act.actionCost).toEqual({ type: 'actions', value: 1 });
    expect(her('beastkin').grantsActions).toEqual(['change-shape-beastkin']);
  });

  it('venomous-anadi: "You gain the Anadi Venom ability"', () => {
    expect(her('venomous-anadi').grantsActions).toEqual(['anadi-venom']);
    expect(db.actions['anadi-venom'], 'the orphaned action now has an owner').toBeTruthy();
  });

  it('snaring-anadi: "Your fangs attack gains the grapple and trip traits"', () => {
    // applyUnarmedRiders (derive.ts:4453-4489) reads heritage records; `match` is a substring of the
    // strike name, and the anadi chassis Strike is called "Fangs".
    expect(her('snaring-anadi').unarmedTraits).toEqual([{ match: ['fang'], add: ['grapple', 'trip'] }]);
    expect(db.ancestries['anadi'].grantedStrikes?.[0].name).toBe('Fangs');
  });

  it('created-fleshwarp: "you don\'t need to eat and can\'t starve"', () => {
    const imm = her('created-fleshwarp').immunities ?? [];
    expect(imm.length).toBe(1);
    expect(imm[0]).toMatch(/starv/i);
  });
});

describe('batch 25 — duplicate and dead pickers removed', () => {
  it('forge-blessed-dwarf-double-picker: one patron question, and it is the live one', () => {
    expect(her('forge-blessed-dwarf').choice, 'the inert duplicate is gone').toBeUndefined();
    const live = (her('forge-blessed-dwarf').effectChoices ?? []).find((e) => e.id === 'patron');
    expect(live?.options?.length).toBe(9);
    for (const o of live!.options!) expect(o.grant?.innateSpells?.length, o.value).toBe(1);
  });

  it('adaptive-anadi: the dead copy is gone and the live picker is narrowed to print', () => {
    // "Choose a common, Medium humanoid ancestry." The live question is the granted feat's own.
    expect(her('adaptive-anadi').choice, 'the answer under heritage:adaptive-anadi was read by nobody').toBeUndefined();
    const lim = her('adaptive-anadi').choiceOptionLimits ?? [];
    expect(lim.length).toBe(1);
    expect(lim[0].target).toBe('adopted-ancestry');
    expect(lim[0].flag).toBe(db.feats['adopted-ancestry'].choice?.flag);
    expect(lim[0].allow.map((a) => a.value).sort()).toEqual(['dwarf', 'elf', 'human', 'orc']);
    // The four are computed, not curated — this is the whole common/Medium/humanoid set.
    const computed = Object.entries(db.ancestries)
      .filter(([, a]) => a.rarity === 'common' && a.size === 'medium' && (a.traits ?? []).includes('humanoid'))
      .map(([k]) => k)
      .sort();
    expect(lim[0].allow.map((a) => a.value).sort()).toEqual(computed);
  });

  it('adaptive-anadi: the narrowing needs an ENGINE half — `open` pickers ignore choiceOptionLimits', () => {
    /*
     * ⚠ Pinned deliberately as the CURRENT state, not the wanted one. feats/adopted-ancestry asks its
     * question with `kind: 'open'`, and both render paths bypass ruling Q9's narrowing: the granted-feat
     * path (Builder.tsx:717-728) resolves the `open` arm through `openChoiceOptions` and calls
     * `narrowChoiceOptions` only in the else arm, and the picked-feat path (Builder.tsx:515-538) feeds
     * its SearchSelect straight from `openChoiceOptions`. So `effectiveChoiceLimits` is never consulted
     * for this feat and the printed "common, Medium humanoid" restriction still does not reach the
     * player. When the open path learns to intersect limits, this assertion is what says so.
     */
    expect(db.feats['adopted-ancestry'].choice?.kind).toBe('open');
  });
});

describe('batch 25 — branch identity recorded once', () => {
  it('budding-speaker-centaur: "Select divine or primal … This choice can\'t be changed"', () => {
    const ch = her('budding-speaker-centaur').choice;
    expect(ch?.flag).toBe('speakerTradition');
    expect((ch?.options ?? []).map((o) => o.value)).toEqual(['divine', 'primal']);
    // narrowSpellFilter (build.ts:1685-1694) cuts the cantrip list to the declared tradition, so the
    // level-1 cantrip can no longer contradict the identity.
    const cantrip = (her('budding-speaker-centaur').effectChoices ?? []).find((e) => e.id === 'speaker-cantrip');
    expect(cantrip?.spellFilter?.traditionFromChoiceFlag).toBe('speakerTradition');
    expect(cantrip?.spellFilter?.cantripsOnly).toBe(true);
  });

  it('cataphract-fleshwarp: the armor grant is a branch, not an unconditional feat', () => {
    /*
     * "You gain the Armor Proficiency feat. If your class makes you trained in all types of armor, you
     * instead become trained in Athletics (or a skill of your choice if you're already trained in
     * Athletics) and gain the Armor Assist skill feat."
     * ⚠ ENGINE HALF: EffectGrant has no `grantsFeats` and applyAlwaysOn (build.ts:5324-5341) has no
     * feat arm; the `skills` half of each option fires today. This test pins the data so the pair
     * cannot drift.
     */
    expect(raw(her('cataphract-fleshwarp')).grantsFeats, 'the unconditional grant is gone').toBeUndefined();
    const br = (her('cataphract-fleshwarp').effectChoices ?? []).find((e) => e.id === 'armor-branch');
    const opts = br?.options ?? [];
    expect(raw(opts[0].grant).grantsFeats).toEqual(['armor-proficiency']);
    expect(opts[1].value).toBe('athletics');
    expect(opts[1].grant?.skills?.athletics).toBe('trained');
    // Every all-armor branch carries Armor Assist, including the "already trained in Athletics" ones.
    for (const o of opts.slice(1)) expect(raw(o.grant).grantsFeats, o.value).toEqual(['armor-assist']);
    for (const id of ['armor-proficiency', 'armor-assist']) expect(db.feats[id], id).toBeTruthy();
  });
});

describe('batch 25 — text the player reads', () => {
  it('bright-fetchling: the missing second cantrip is recorded, not hidden', () => {
    const w = her('bright-fetchling').dataWarning ?? '';
    expect(w).toMatch(/dancing lights/i);
    expect(db.spells['dancing-lights'], 'the reason for the warning: the spell does not ship').toBeFalsy();
    expect(her('bright-fetchling').innateSpells).toEqual([{ spellId: 'light', tradition: 'occult' }]);
  });

  it('liminal-fetchling#description: both replacement DCs are back', () => {
    const d = her('liminal-fetchling').description;
    expect(d).toContain('DC 3 instead of DC 5');
    expect(d).toContain('DC 9 instead of DC 11');
  });

  it('elemental-heart-dwarf: the granted activity states its dice, type and save again', () => {
    const d = db.actions['energy-emanation'].description;
    expect(d).toContain('1d6 damage of your chosen type');
    expect(d).toContain('basic Reflex save');
    expect(d, 'the orphan fragment is gone').not.toContain('( save');
    expect(d, 'the Frequency block is kept').toContain('**Frequency** once per day');
  });
});
