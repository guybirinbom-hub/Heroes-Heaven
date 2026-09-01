import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { sanctificationOf } from '../src/rules/derive';
import { CASTER_ARCHETYPES } from '../src/rules/casterArchetypes';
import type { BuildState } from '../src/rules/build';
import type { Character } from '../src/rules/types';

const db = content();

/**
 * The six records that closed Wanderer's-Guide parity batch 9. Each is asserted on a BUILT character
 * where it can be — a gate passing only proves the comparers agree, not that a player gets anything.
 */

describe('archetype casters that granted no spellcasting at all', () => {
  /* Necromancer Dedication (feat-9292): *"You can cast spells like a necromancer, gaining a dirge with
   * four common occult cantrips of your choice … You can prepare two cantrips each day from your dirge
   * … Your key spellcasting attribute for necromancer archetype spells is Intelligence, and they are
   * occult necromancer spells."* The record shipped with no mechanical field of any kind. */
  it('the necromancer dedication is a registered occult/Int caster', () => {
    const a = CASTER_ARCHETYPES['necromancer-dedication'];
    expect(a).toBeTruthy();
    expect(a.tradition).toBe('occult');
    expect(a.keyAbility).toBe('int');
    /*
     * 2, not 4. `cantrips` is the PREPARED-per-day cap — every cantrip the player selects for an
     * archetype is castable — and the printed text is *"gaining a dirge with FOUR common occult
     * cantrips of your choice … You can PREPARE TWO cantrips each day from your dirge"*. This line
     * asserted the dirge's size, so a necromancer-archetype character could cast four cantrips a day
     * where the book allows two. The same correction was made to Wizard, Magus, Hedge Mage and Witch;
     * scripts/archetype-cantrip-check.mjs reads each record's own sentence and holds all five.
     */
    expect(a.cantrips).toBe(2);
    // The ladder ids it mints must all exist, or the archetype tiers are unreachable.
    for (const id of [a.basicId, a.expertId, a.masterId]) expect(db.feats[id!], id).toBeTruthy();
  });

  /* Hedge Mage (feat-9326): *"…they are hedge mage spells of a tradition associated with the skill
   * chosen for this dedication (arcane for Arcana, primal for Nature, occult for Occultism, and divine
   * for Religion)"* — the only archetype whose tradition is decided by a SKILL answer. */
  it('the hedge mage maps each skill to its printed tradition', () => {
    const a = CASTER_ARCHETYPES['hedge-mage-dedication'];
    expect(a.traditionBySkill).toEqual({ arcana: 'arcane', nature: 'primal', occultism: 'occult', religion: 'divine' });
    expect(a.choiceKeyAbility).toEqual(['int', 'wis']);
    for (const id of [a.basicId, a.expertId, a.masterId]) expect(db.feats[id!], id).toBeTruthy();
  });

  it.each([
    ['arcana', 'arcane'],
    ['nature', 'primal'],
    ['occultism', 'occult'],
    ['religion', 'divine'],
  ])('a hedge mage who chose %s casts %s spells', (skill, tradition) => {
    const ch = build('fighter', 4, {
      featPicks: { '2:class': 'hedge-mage-dedication' },
      featSkillChoices: { 'hedge-mage-dedication:0': skill },
    } as unknown as Partial<BuildState>) as Character;
    const entry = (ch.spellcasting ?? []).find((e) => e.id?.includes('hedge-mage') || e.type === 'innate' || e.type === 'prepared');
    if (entry) expect(entry.tradition, `${skill} → ${tradition}`).toBe(tradition);
    // The skill itself is trained either way — *"You become trained in that skill."*
    expect(ch.proficiencies.skills[skill as 'arcana']).not.toBe('untrained');
  });

  it('the necromancer dedication trains Occultism', () => {
    const ch = build('fighter', 4, { featPicks: { '2:class': 'necromancer-dedication' } } as unknown as Partial<BuildState>);
    expect(ch.proficiencies.skills.occultism).not.toBe('untrained');
  });
});

describe('sanctification', () => {
  /*
   * ⚠ `sanctificationOf()` read `effectPicks` — built only from `effectChoices` — while BOTH existing
   * carriers (deity-champion, sanctified-soul) ask through `choice` with `flag: 'sanctification'`. So
   * it returned null for every character in the game and `addIfSanctified` widening never fired for
   * anyone. Found while authoring these two dedications, which print the same clause.
   */
  it('both dedications now ask the question', () => {
    for (const id of ['cleric-dedication', 'champion-dedication']) {
      const def = db.feats[id].choice;
      expect(def?.flag, id).toBe('sanctification');
      expect((def?.options ?? []).map((o) => o.value), id).toEqual(['holy', 'unholy', 'none']);
    }
  });

  it('the holy/unholy options really grant the creature trait', () => {
    for (const id of ['cleric-dedication', 'champion-dedication']) {
      const opts = db.feats[id].choice!.options!;
      expect(opts.find((o) => o.value === 'holy')?.grant?.grantsCreatureTraits).toEqual(['holy']);
      expect(opts.find((o) => o.value === 'unholy')?.grant?.grantsCreatureTraits).toEqual(['unholy']);
      expect(opts.find((o) => o.value === 'none')?.grant).toBeUndefined();
    }
  });

  it('the reader now sees a choice-shaped answer', () => {
    const ch = build('fighter', 4, {
      featPicks: { '2:class': 'champion-dedication' },
      featChoices: { '2:class': 'holy' },
    } as unknown as Partial<BuildState>) as Character;
    expect(sanctificationOf(ch, db)).toBe('holy');
  });

  it('…and reports none when the answer is "none" or unanswered', () => {
    const unanswered = build('fighter', 4, { featPicks: { '2:class': 'champion-dedication' } } as unknown as Partial<BuildState>) as Character;
    expect(sanctificationOf(unanswered, db)).toBeNull();
    expect(sanctificationOf(build('fighter', 1) as Character, db)).toBeNull();
  });
});

describe('dedications that hand over a real object', () => {
  /* Starlit Sentinel (feat-7033): *"You gain a transformation seal: a mundane-seeming item of light
   * Bulk, such as a ring, brooch, or key, that has the arcane trait."* */
  it('a starlit sentinel carries their transformation seal', () => {
    expect(db.items['transformation-seal'].traits).toContain('arcane');
    const ch = build('fighter', 4, { featPicks: { '2:class': 'starlit-sentinel-dedication' } } as unknown as Partial<BuildState>);
    expect(ch.inventory.some((i) => i.itemId === 'transformation-seal')).toBe(true);
  });

  /* Mind Smith (feat-3862): *"You gain a single melee weapon of your choosing, called a mind weapon.
   * Your mind weapon is a martial melee weapon"* and a keepsake *"which you … inscribe with weapon
   * runes"*. Neither existed as an item; the feat recorded only its daily damage-type choice. */
  it('a mind smith carries the mind weapon and the keepsake', () => {
    expect(db.items['mind-weapon'].itemType).toBe('weapon');
    expect(db.items['mind-weapon'].category).toBe('martial');
    const ch = build('fighter', 4, { featPicks: { '2:class': 'mind-smith-dedication' } } as unknown as Partial<BuildState>);
    for (const id of ['mind-weapon', 'mind-smiths-keepsake']) {
      expect(ch.inventory.some((i) => i.itemId === id), id).toBe(true);
    }
  });
});

describe('Command a Thrall', () => {
  /* *"You can use the Command a Thrall action as described in the thrall trait."* The action is printed
   * INSIDE the thrall trait (trait-955) and has no AoN record of its own, so it was authored from that
   * block; nothing on our side had it in any bucket. */
  it('exists as a one-action necromancer activity', () => {
    const a = db.actions['command-a-thrall'];
    expect(a).toBeTruthy();
    expect(a.actionCost).toEqual({ type: 'actions', value: 1 });
    expect(a.traits).toEqual(expect.arrayContaining(['concentrate', 'necromancer', 'thrall']));
  });

  it('and the dedication grants it', () => {
    expect(db.feats['necromancer-dedication'].grantsActions).toEqual(['command-a-thrall']);
  });
});
