import { describe, it, expect } from 'vitest';
import { content, build, prof } from './_content';
import { buildChoiceOptions, deityFavorsSimpleOrUnarmed } from '../src/rules/build';
import { emptyBuild, type BuildState } from '../src/rules/build';
import { choiceGrantFor, maxTakes, FEAT_GRANTS } from '../src/rules/featGrants';
import { FEAT_PICK_GRANTS, pickableFeats } from '../src/rules/featPickGrants';
import { eligibleFeatsForSlot } from '../src/rules/featSlots';

/*
 * Section 3C — feat-granted proficiencies (archetype dedications), fighter weapon-group mastery,
 * and Warpriest Deadly Simplicity conditioning. Rules verified against .import-src Foundry text.
 */
describe('archetype dedications grant proficiencies (featGrants table)', () => {
  // A wizard is untrained in light armor and martial weapons by default, so the grant is visible.
  it('Sentinel Dedication grants trained light + medium armor', () => {
    const ch = build('wizard', 4, { featPicks: { '2:class:0': 'sentinel-dedication' } });
    expect(ch.proficiencies.defenses.light).toBe('trained');
    expect(ch.proficiencies.defenses.medium).toBe('trained');
    // A character without the dedication stays untrained.
    const plain = build('wizard', 4);
    expect(plain.proficiencies.defenses.light).toBe('untrained');
    expect(plain.proficiencies.defenses.medium).toBe('untrained');
  });

  it('Fighter Dedication grants trained martial-weapon proficiency', () => {
    const ch = build('wizard', 4, { featPicks: { '2:class:0': 'fighter-dedication' } });
    expect(ch.proficiencies.attacks.martial).toBe('trained');
    expect(build('wizard', 4).proficiencies.attacks.martial).toBe('untrained');
  });

  it('Rogue Dedication grants trained light armor', () => {
    const ch = build('wizard', 4, { featPicks: { '2:class:0': 'rogue-dedication' } });
    expect(ch.proficiencies.defenses.light).toBe('trained');
  });

  it('Medic Dedication grants expert Medicine', () => {
    const ch = build('wizard', 4, { featPicks: { '2:class:0': 'medic-dedication' } });
    expect(ch.proficiencies.skills.medicine).toBe('expert');
  });

  it('a grant never LOWERS an already-higher class proficiency', () => {
    // Fighter is already expert in martial weapons; taking Sentinel Dedication (armor only) leaves
    // martial untouched, and the grant of a track the class already exceeds does not regress it.
    const ch = build('fighter', 4, { featPicks: { '2:class:0': 'rogue-dedication' } });
    // Fighter is trained in light armor at L1 (not lowered by rogue-dedication's trained grant).
    expect(ch.proficiencies.defenses.light).toBe('trained');
    expect(ch.proficiencies.attacks.martial).toBe('expert');
  });
});

/*
 * Auto-extracted skill grants (featGrantsAuto.ts) — ~175 dedications/ancestry feats that train a skill,
 * derived from Foundry ActiveEffectLike rule elements and merged into FEAT_GRANTS (hand-authored wins).
 */
describe('auto-extracted feat skill grants', () => {
  it('the merged table is large and hand-authored entries WIN on conflict', () => {
    expect(Object.keys(FEAT_GRANTS).length).toBeGreaterThan(150);
    // fighter-dedication is hand-authored (martial weapons); the auto-extractor mis-maps it to `simple`,
    // so the merge order (hand last) is load-bearing.
    expect(FEAT_GRANTS['fighter-dedication'].weapon?.martial).toBe('trained');
    expect(FEAT_GRANTS['fighter-dedication'].weapon?.simple).toBeUndefined();
  });

  it('Lastwall Sentry Dedication trains Athletics (a wizard lacks it)', () => {
    expect(build('wizard', 4).proficiencies.skills.athletics ?? 'untrained').toBe('untrained');
    const ch = build('wizard', 4, { featPicks: { '2:class:0': 'lastwall-sentry-dedication' } });
    expect(ch.proficiencies.skills.athletics).toBe('trained');
  });

  it('a rank>trained grant applies (Wrestler Dedication → expert Athletics)', () => {
    expect(build('wizard', 4, { featPicks: { '2:class:0': 'wrestler-dedication' } }).proficiencies.skills.athletics).toBe('expert');
  });

  it('AoN correction: Lastwall Sentry grants Undead LORE + Athletics trained (not expert, for the untrained)', () => {
    // AoN prose grants a Lore skill Foundry-structured extraction dropped, and Athletics is "trained;
    // expert if already trained" — the UNTRAINED wizard gets the base trained.
    const ch = build('wizard', 4, { featPicks: { '2:class:0': 'lastwall-sentry-dedication' } });
    expect(ch.proficiencies.skills.athletics).toBe('trained');
    expect(ch.proficiencies.skills['lore:undead']).toBe('trained');
  });

  it('conditional upgrade: a character ALREADY trained in the skill gets expert instead', () => {
    // A barbarian is auto-trained in Athletics, so Lastwall Sentry's "expert if already trained" fires.
    expect(build('barbarian', 4).proficiencies.skills.athletics).toBe('trained');
    const ch = build('barbarian', 4, { featPicks: { '2:class:0': 'lastwall-sentry-dedication' } });
    expect(ch.proficiencies.skills.athletics).toBe('expert');
  });

  it("lore choice: a 'trained in a Lore of your choice' feat grants the typed subject", () => {
    const ch = build('wizard', 4, { featPicks: { '1:ancestry:0': 'gnome-obsession' }, featLoreChoices: { 'gnome-obsession:0': 'Warfare Lore' } });
    /*
     * EXPERT, not trained, and the change is the point. Gnome Obsession's entire printed mechanic is
     * *"You gain the Additional Lore feat and the Assurance feat for the chosen Lore"* — so the rank
     * comes from Additional Lore, and with it *"at 3rd, 7th, and 15th levels, you gain an additional
     * skill increase you can apply only to the chosen Lore subcategory"*. A level-4 gnome is past 3rd.
     * This read `trained` before because the GRANTED Additional Lore reached the chosen Lore by no
     * route at all, so its ladder could never fire.
     */
    expect(ch.proficiencies.skills['lore:warfare']).toBe('expert');
    expect(
      build('wizard', 2, { featPicks: { '1:ancestry:0': 'gnome-obsession' }, featLoreChoices: { 'gnome-obsession:0': 'Warfare Lore' } })
        .proficiencies.skills['lore:warfare'],
    ).toBe('trained');
    // no subject typed → no lore granted
    expect(build('wizard', 4, { featPicks: { '1:ancestry:0': 'gnome-obsession' } }).proficiencies.skills['lore:warfare']).toBeUndefined();
  });

  it('never lowers: a trained grant is a no-op on an already-equal-or-higher skill', () => {
    // Juggler Dedication grants trained Performance; a bard already has Performance ≥ trained, so its
    // rank must be UNCHANGED (the grant raises only, never regresses).
    const base = build('bard', 7);
    const withFeat = build('bard', 7, { featPicks: { '2:class:0': 'juggler-dedication' } });
    expect(base.proficiencies.skills.performance ?? 'untrained').not.toBe('untrained');
    expect(withFeat.proficiencies.skills.performance).toBe(base.proficiencies.skills.performance);
  });
});

/*
 * Feats that GRANT another feat (FEAT_FEAT_GRANTS). The granted feat is added as a bonus (no slot),
 * shows in Feats & Features, and its own effects apply. e.g. Lastwall Sentry Dedication grants both
 * the Reactive Shield feat AND trained Athletics.
 */
describe('feats that grant another feat', () => {
  it('adds the granted feat (Lastwall Sentry Dedication → Reactive Shield), tagged grantedBy', () => {
    const ch = build('wizard', 4, { featPicks: { '2:class:0': 'lastwall-sentry-dedication' } });
    const granted = ch.feats.find((f) => f.featId === 'reactive-shield');
    expect(granted).toBeTruthy();
    expect(granted?.grantedBy).toBe('lastwall-sentry-dedication');
    // a wizard without the dedication does NOT have Reactive Shield
    expect(build('wizard', 4).feats.some((f) => f.featId === 'reactive-shield')).toBe(false);
  });

  it('the granting feat still applies its OWN grants too (Athletics trained)', () => {
    const ch = build('wizard', 4, { featPicks: { '2:class:0': 'lastwall-sentry-dedication' } });
    expect(ch.proficiencies.skills.athletics).toBe('trained');
  });

  it('grants multiple feats when the source lists several (Vestigial Wings → Steady Balance + Cat Fall)', () => {
    // build a character with the ancestry feat via overrides (bypasses ancestry gating in the test)
    const ch = build('wizard', 4, { overrides: { addedFeats: [{ featId: 'vestigial-wings', level: 1, category: 'ancestry' }] } } as never);
    const ids = new Set(ch.feats.map((f) => f.featId));
    expect(ids.has('steady-balance')).toBe(true);
    expect(ids.has('cat-fall')).toBe(true);
  });

  it('does not duplicate a granted feat the character already has', () => {
    const ch = build('wizard', 4, {
      featPicks: { '2:class:0': 'lastwall-sentry-dedication', '1:general:0': 'reactive-shield' },
    });
    expect(ch.feats.filter((f) => f.featId === 'reactive-shield')).toHaveLength(1);
  });
});

/*
 * Pick-a-feat grants (FEAT_PICK_GRANTS): a feat lets the player CHOOSE a bonus feat from a filtered
 * pool (General Training → a 1st-level general feat, Basic Maneuver → a low-level fighter feat, …).
 */
describe('pick-a-feat grants', () => {
  const c = content();

  it('pickableFeats(Basic Maneuver) offers only low-level fighter feats', () => {
    const b = { ...emptyBuild(), classId: 'wizard', level: 6 };
    const opts = pickableFeats(FEAT_PICK_GRANTS['basic-maneuver'], b, c);
    expect(opts.length).toBeGreaterThan(3);
    expect(opts.every((f) => f.traits.includes('fighter') && f.category === 'class' && f.level <= 2)).toBe(true);
  });

  it('grants the picked feat, tagged grantedBy', () => {
    const b = { ...emptyBuild(), classId: 'wizard', level: 4 };
    const pick = pickableFeats(FEAT_PICK_GRANTS['general-training'], b, c)[0].id;
    const ch = build('wizard', 4, { featPicks: { '3:general:0': 'general-training' }, pickFeatChoices: { 'general-training': pick } });
    const granted = ch.feats.find((f) => f.featId === pick);
    expect(granted).toBeTruthy();
    expect(granted?.grantedBy).toBe('general-training');
  });

  it('ignores an illegal pick outside the pool', () => {
    // a fighter class feat is not a legal General Training pick (that pool is general feats)
    const fighterFeat = Object.values(c.feats).find((f) => f.traits.includes('fighter') && f.category === 'class')!;
    const ch = build('wizard', 4, { featPicks: { '3:general:0': 'general-training' }, pickFeatChoices: { 'general-training': fighterFeat.id } });
    expect(ch.feats.some((f) => f.featId === fighterFeat.id)).toBe(false);
  });

  it("Natural Ambition picks a feat of the character's OWN class", () => {
    const b = { ...emptyBuild(), classId: 'fighter', level: 3 };
    const opts = pickableFeats(FEAT_PICK_GRANTS['natural-ambition'], b, c);
    expect(opts.length).toBeGreaterThan(0);
    expect(opts.every((f) => f.traits.includes('fighter') && f.level <= 1)).toBe(true);
    // a wizard's Natural Ambition would instead offer wizard feats
    expect(pickableFeats(FEAT_PICK_GRANTS['natural-ambition'], { ...b, classId: 'wizard' }, c).every((f) => f.traits.includes('wizard'))).toBe(true);
  });
});

/*
 * Pick-a-cantrip grants (FEAT_CANTRIP_GRANTS): a feat grants a CHOSEN innate spell (Dragon Spit → a
 * cantrip, cast at-will; Hag Magic → a spell, 1/day). The pick feeds the character's innate entry.
 */
describe('pick-a-cantrip grants', () => {
  it("Dragon Spit's chosen cantrip becomes an at-will innate spell", () => {
    const ch = build('fighter', 4, { featPicks: { '1:ancestry:0': 'dragon-spit' }, pickCantripChoices: { 'dragon-spit': 'electric-arc' } });
    const innate = ch.spellcasting.find((s) => s.type === 'innate');
    expect(innate).toBeTruthy();
    expect(innate?.cantrips).toContain('electric-arc');
    // no pick → no innate electric-arc
    expect(build('fighter', 4, { featPicks: { '1:ancestry:0': 'dragon-spit' } }).spellcasting.find((s) => s.type === 'innate')?.cantrips ?? []).not.toContain('electric-arc');
  });

  it('ignores a chosen spell that is not in the grant list', () => {
    const ch = build('fighter', 4, { featPicks: { '1:ancestry:0': 'dragon-spit' }, pickCantripChoices: { 'dragon-spit': 'fireball' } });
    const innate = ch.spellcasting.find((s) => s.type === 'innate');
    expect((innate?.cantrips ?? []).includes('fireball')).toBe(false);
    for (const rank of Object.values(innate?.repertoire ?? {})) expect(rank).not.toContain('fireball');
  });

  it("Hag Magic's chosen higher-rank spell is a 1/day innate spell (in the repertoire, not cantrips)", () => {
    const ch = build('fighter', 14, { featPicks: { '1:ancestry:0': 'hag-magic' }, pickCantripChoices: { 'hag-magic': 'charm' } });
    const innate = ch.spellcasting.find((s) => s.type === 'innate');
    const allRep = Object.values(innate?.repertoire ?? {}).flat();
    expect(allRep).toContain('charm');
    expect(innate?.cantrips ?? []).not.toContain('charm');
  });
});

/*
 * Canny Acumen grants a proficiency chosen in the feat's own dropdown, so it needs both the
 * choiceGrants lookup and the level-17 rankUpgrade.
 *
 * ⚠ EVERY case here drives the value the PICKER emits, read off the record itself. This block was
 * green for a long time while the feat was a no-op on every real character, because it fed
 * buildCharacter the raw Foundry paths ('system.saves.fortitude.rank') the grant table was keyed by
 * — input the builder cannot produce. A test that passes only on impossible input is worse than
 * none: it is a guard reporting that the door is locked while standing in the wrong corridor.
 *
 * A wizard is only trained in Fortitude, which makes the grant visible.
 */
describe('Canny Acumen grants the CHOSEN proficiency (choiceGrants + rankUpgrade)', () => {
  const c = content();
  /** The four answers the builder can actually store, straight from the record's own option list. */
  const emitted = (c.feats['canny-acumen'].choice?.options ?? []).map((o) => o.value);
  const cannyOn = (classId: string, level: number, choice?: string) =>
    build(classId, level, {
      featPicks: { '1:general:0': 'canny-acumen' },
      ...(choice ? { featChoices: { '1:general:0': choice } } : {}),
    });
  const canny = (level: number, choice?: string) => cannyOn('wizard', level, choice);
  const track = (ch: ReturnType<typeof build>, value: string) =>
    value === 'perception' ? ch.proficiencies.perception : ch.proficiencies.saves[value as 'fortitude'];

  it('offers exactly the four tracks the feat names', () => {
    expect(emitted).toEqual(['fortitude', 'reflex', 'will', 'perception']);
  });

  it('EVERY answer the picker can emit moves a proficiency — none is inert', () => {
    // The whole defect, stated as one assertion: the pick was recorded and read by nothing.
    // No single class sits below expert in all four tracks, so each answer is checked against
    // several host/level pairs and has to raise at least one. Before the fix it raised none.
    const hosts: [string, number][] = [['wizard', 3], ['wizard', 17], ['fighter', 3], ['fighter', 17]];
    for (const value of emitted) {
      const moved = hosts.filter(([cls, lvl]) => track(cannyOn(cls, lvl, value), value) !== track(build(cls, lvl), value));
      expect(moved.length, `answering "${value}" changes no character's sheet`).toBeGreaterThan(0);
    }
  });

  it('choosing Fortitude makes a L3 wizard an EXPERT in Fortitude', () => {
    expect(build('wizard', 3).proficiencies.saves.fortitude).toBe('trained');
    expect(canny(3, 'fortitude').proficiencies.saves.fortitude).toBe('expert');
  });

  it('choosing Perception raises Perception', () => {
    expect(canny(3, 'perception').proficiencies.perception).toBe('expert');
  });

  it('only the CHOSEN track is raised — the other saves are untouched', () => {
    const ch = canny(3, 'fortitude');
    expect(ch.proficiencies.saves.reflex).toBe(build('wizard', 3).proficiencies.saves.reflex);
    expect(ch.proficiencies.saves.will).toBe(build('wizard', 3).proficiencies.saves.will);
  });

  it('at 17th level the SAME pick becomes MASTER — no second question is asked', () => {
    // The upgrade rides on the answer already given; there is one choice, not one per step.
    expect(canny(17, 'fortitude').proficiencies.saves.fortitude).toBe('master');
    expect(canny(17, 'perception').proficiencies.perception).toBe('master');
    // …and it lands on the chosen track only.
    expect(canny(17, 'fortitude').proficiencies.saves.reflex).toBe(build('wizard', 17).proficiencies.saves.reflex);
    // Below 17 it stays expert.
    expect(canny(16, 'fortitude').proficiencies.saves.fortitude).toBe('expert');
  });

  it('a track the character is ALREADY expert in stays on the menu, and still upgrades at 17', () => {
    /*
     * Owner's ruling: "usually it shouldn't allow a player to choose something he is already an
     * expert in, but because at 17th level he becomes a master, in this case allow it." Ruling Q9
     * filters a choice to what the player may legally pick; an already-expert track is legal AND
     * worth taking, because the level-17 step is the real prize. An option is filtered only when the
     * grant would be genuinely WASTED — a later level-scaling upgrade means it is not.
     */
    const wizardWill = build('wizard', 3).proficiencies.saves.will;
    expect(wizardWill, 'the fixture must already be expert for this to test anything').toBe('expert');
    // The picker offers it: no branch narrows the list by what the character already has.
    const offered = buildChoiceOptions(
      'canny-acumen',
      c.feats['canny-acumen'].choice!,
      { ...emptyBuild(), featPicks: { '1:general:0': 'canny-acumen' } } as BuildState,
      c,
      build('wizard', 3),
    ).map((o) => o.value);
    expect(offered).toContain('will');
    expect(offered).toEqual(emitted);
    // And taking it is not wasted: expert now, master at 17.
    expect(canny(3, 'will').proficiencies.saves.will).toBe('expert');
    expect(canny(17, 'will').proficiencies.saves.will).toBe('master');
  });

  it('never LOWERS a rank the class already grants, and an unmade choice is inert', () => {
    expect(canny(3, 'will').proficiencies.saves.will).toBe('expert');
    expect(canny(3).proficiencies.saves.fortitude).toBe('trained');
  });

  it('an answer stored under the OLD Foundry path still grants — saved characters keep their pick', () => {
    /*
     * The keys were realigned to what the picker emits; the lookup accepts both spellings rather
     * than migrating, because those answers live in localStorage, in Supabase and in exported
     * .codex files, and a migration that missed one store would silently drop that character's
     * proficiency with nothing on screen to say so.
     */
    expect(canny(3, 'system.saves.fortitude.rank').proficiencies.saves.fortitude).toBe('expert');
    expect(canny(3, 'system.perception.rank').proficiencies.perception).toBe('expert');
    expect(canny(17, 'system.saves.fortitude.rank').proficiencies.saves.fortitude).toBe('master');
  });

  it('an answer that names no track grants nothing rather than guessing', () => {
    expect(canny(3, 'system.saves.nonsense.rank').proficiencies.saves.fortitude).toBe('trained');
    expect(choiceGrantFor(FEAT_GRANTS['canny-acumen'], undefined)).toBeUndefined();
    expect(choiceGrantFor(FEAT_GRANTS['medic-dedication'], 'fortitude'), 'no choiceGrants at all').toBeUndefined();
  });
});

/*
 * Repeatable feats. Foundry's system.maxTakable is imported into core.json; the app must (a) know a
 * feat is repeatable, (b) let the picker offer it until the cap is reached, and (c) keep every take
 * in the built character. Before this, a 2nd take was silently dropped by a dedupe-by-id.
 */
describe('repeatable feats (maxTakable)', () => {
  const c = content();

  it('imports maxTakable from Foundry: Armor Prof 3, Skill Mastery 5, Weapon Prof + Multilingual unlimited', () => {
    expect(c.feats['armor-proficiency']?.maxTakable).toBe(3);
    expect(c.feats['skill-mastery']?.maxTakable).toBe(5);
    expect(c.feats['weapon-proficiency']?.maxTakable).toBe(null); // null = unlimited
    expect(c.feats['multilingual']?.maxTakable).toBe(null);
  });

  it('a once-only feat carries no maxTakable and reads as 1 take', () => {
    expect(c.feats['canny-acumen']?.maxTakable).toBeUndefined();
    expect(c.feats['toughness']?.maxTakable).toBeUndefined();
    expect(maxTakes(c.feats['canny-acumen'])).toBe(1);
    expect(maxTakes(c.feats['armor-proficiency'])).toBe(3);
    expect(maxTakes(c.feats['weapon-proficiency'])).toBe(Infinity);
    expect(maxTakes(undefined)).toBe(1);
  });

  it('the 4 feats Foundry wrongly omits are recovered from prose as repeatable', () => {
    // Foundry has no maxTakable for these; AoN prose plainly says repeatable. See featMaxTakes().
    for (const id of ['animists-power', 'order-magic', 'secret-speech', 'listeners-boon']) {
      expect(maxTakes(c.feats[id])).toBe(Infinity);
    }
  });

  it('the picker offers a repeatable feat until its cap, and a normal feat only once', () => {
    // General slots at L3/7/11/15/19. eligibleFeatsForSlot for a later slot must still offer
    // armor-proficiency while it sits in only the L3 slot, but hide a once-only feat already taken.
    //
    // The host is a WIZARD, not the fighter this used to use. `eligibleFeatsForSlot` is untouched by
    // it, but a fighter is already trained in light, medium AND heavy armor, so every take of this
    // feat grants that fighter nothing — the exhausted-grant case `exhaustedGrantReason`
    // (featGrants.ts) now filters out of the real picker. Asserting "the picker offers it" on that
    // host documented the defect as the intended behaviour.
    const b0: BuildState = { ...emptyBuild(), ancestryId: 'human', classId: 'wizard', level: 20 };
    const has = (b: BuildState, key: string, id: string) =>
      eligibleFeatsForSlot(b, c, { level: Number(key.split(':')[0]), category: 'general', idx: 0 }).some((f) => f.id === id);

    // Repeatable: taken once (L3), still offered at L7.
    expect(has({ ...b0, featPicks: { '3:general:0': 'armor-proficiency' } }, '7:general:0', 'armor-proficiency')).toBe(true);
    // Taken 3× (the cap): NOT offered in a 4th slot.
    expect(
      has(
        { ...b0, featPicks: { '3:general:0': 'armor-proficiency', '7:general:0': 'armor-proficiency', '11:general:0': 'armor-proficiency' } },
        '15:general:0',
        'armor-proficiency',
      ),
    ).toBe(false);
    // Once-only (Toughness): taken at L3, hidden at L7.
    expect(has({ ...b0, featPicks: { '3:general:0': 'toughness' } }, '7:general:0', 'toughness')).toBe(false);
  });

  it('a repeatable feat placed in 3 slots yields 3 entries in the built character', () => {
    const ch = build('wizard', 13, {
      featPicks: { '3:general:0': 'armor-proficiency', '7:general:0': 'armor-proficiency', '11:general:0': 'armor-proficiency' },
    });
    expect(ch.feats.filter((f) => f.featId === 'armor-proficiency')).toHaveLength(3);
  });
});

/*
 * Armor Proficiency (Player Core p.252): trained in light; if already trained in light, medium; then
 * heavy — repeatable up to 3×, and each granted type is expert at 13th level. Modeled as a derived
 * cascade (FEAT_GRANTS.armorCascade) rather than a player choice, because Foundry's predicates make
 * exactly one option legal at a time. Verified against AoN feat-5120 + Foundry armor-proficiency.json.
 */
describe('Armor Proficiency cascade', () => {
  // General feats arrive at L3/7/11, so N takes need character level >= [3,7,11][N-1]. Build at 12
  // (all three slots live, but below the level-13 expert clause) so each take shows as trained.
  const wiz = (level: number, takes: number) => {
    const featPicks: Record<string, string> = {};
    (['3', '7', '11'] as const).slice(0, takes).forEach((lv) => (featPicks[`${lv}:general:0`] = 'armor-proficiency'));
    return build('wizard', level, { featPicks: featPicks as never });
  };

  it('a wizard (untrained in armor) trains light → medium → heavy across three takes', () => {
    expect(['light', 'medium', 'heavy'].map((k) => prof(wiz(12, 0), k))).toEqual(['untrained', 'untrained', 'untrained']);
    expect(['light', 'medium', 'heavy'].map((k) => prof(wiz(12, 1), k))).toEqual(['trained', 'untrained', 'untrained']);
    expect(['light', 'medium', 'heavy'].map((k) => prof(wiz(12, 2), k))).toEqual(['trained', 'trained', 'untrained']);
    expect(['light', 'medium', 'heavy'].map((k) => prof(wiz(12, 3), k))).toEqual(['trained', 'trained', 'trained']);
  });

  it('at 13th level each granted armor type is EXPERT, not trained (Remaster clause)', () => {
    expect(['light', 'medium', 'heavy'].map((k) => prof(wiz(13, 3), k))).toEqual(['expert', 'expert', 'expert']);
    // …and one level below, still trained.
    expect(prof(wiz(12, 1), 'light')).toBe('trained');
  });

  it('is a harmless no-op for a fighter already trained/expert in every armor', () => {
    const base = build('fighter', 13);
    const withFeat = build('fighter', 13, { featPicks: { '3:general:0': 'armor-proficiency' } as never });
    for (const k of ['light', 'medium', 'heavy']) expect(prof(withFeat, k)).toBe(prof(base, k));
  });

  it('has no dropdown — the cascade is derived, so core.json carries no fake choice', () => {
    expect(content().feats['armor-proficiency']?.choice).toBeUndefined();
  });
});

describe('Weapon Proficiency grants martial, expert at 11th', () => {
  it('untrained wizard becomes trained in martial, then expert at level 11', () => {
    expect(prof(build('wizard', 7), 'martial')).toBe('untrained');
    expect(prof(build('wizard', 7, { featPicks: { '3:general:0': 'weapon-proficiency' } as never }), 'martial')).toBe('trained');
    expect(prof(build('wizard', 11, { featPicks: { '3:general:0': 'weapon-proficiency' } as never }), 'martial')).toBe('expert');
  });
});

describe('Warpriest Deadly Simplicity is conditioned on the favored weapon', () => {
  it('deityFavorsSimpleOrUnarmed: simple item, unarmed fist → true; martial → false', () => {
    const c = content();
    expect(deityFavorsSimpleOrUnarmed('abadar', c)).toBe(true); // crossbow (simple)
    expect(deityFavorsSimpleOrUnarmed('irori', c)).toBe(true); // fist (unarmed)
    expect(deityFavorsSimpleOrUnarmed('iomedae', c)).toBe(false); // longsword (martial)
  });

  it('Iomedae (longsword) warpriest does NOT gain Deadly Simplicity', () => {
    const ch = build('cleric', 3, { subclassId: 'warpriest', deityId: 'iomedae', divineFont: 'heal' });
    expect(ch.feats.some((f) => f.featId === 'deadly-simplicity')).toBe(false);
  });

  it('Abadar (crossbow, simple) warpriest DOES gain Deadly Simplicity', () => {
    const ch = build('cleric', 3, { subclassId: 'warpriest', deityId: 'abadar', divineFont: 'heal' });
    expect(ch.feats.some((f) => f.featId === 'deadly-simplicity')).toBe(true);
  });
});
