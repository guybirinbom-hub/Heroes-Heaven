import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { FEAT_GRANTS } from '../src/rules/featGrants';
import { statHasSituational, characterSituationalIds } from '../src/rules/explain';

const db = content();

/**
 * Records closed in Wanderer's-Guide parity batch 10. Each is asserted on a BUILT character wherever
 * it can be — a gate passing only proves the comparers agree, not that a player gets anything.
 */

describe('focus spells that borrow the character\'s own tradition', () => {
  /* Two archetypes print the clause, and it is not a property of either record: Hallowed Necromancer
   * says *"Focus spells from the hallowed necromancer archetype have the same tradition as your spell
   * slots"* and Magic Warrior *"Your focus spells from the magic warrior archetype are the same
   * tradition as your other spells."* The tradition is only knowable once the character's own casting
   * entry exists, so it cannot be authored on the feat at all. */
  it('both records carry the flag', () => {
    expect(db.feats['hallowed-necromancer-dedication']?.focusFromSpellSlots).toBe(true);
    expect(db.feats['magic-warrior-dedication']?.focusFromSpellSlots).toBe(true);
  });

  const focusOf = (ch: ReturnType<typeof build>) =>
    ch.spellcasting.find((e) => e.type === 'focus' && Object.values(e.repertoire ?? {}).flat().includes('hallowed-ground'));

  /* The case the clause exists for: a NON-caster whose spells come from another archetype. A fighter's
   * own focus default is occult/Cha, so borrowing is the only thing that can make this arcane/Int —
   * which is exactly what the printed sentence says should happen. */
  it('a fighter casting from a wizard archetype gets arcane hallowed ground, not the fighter default', () => {
    const ch = build('fighter', 10, {
      featPicks: {
        '2:class': 'wizard-dedication',
        '4:class': 'basic-wizard-spellcasting',
        '6:class': 'hallowed-necromancer-dedication',
      },
    } as never);
    const slots = ch.spellcasting.find((e) => e.type === 'prepared' || e.type === 'spontaneous');
    const focus = focusOf(ch);
    expect(slots?.tradition, 'premise: the borrowed slots must be arcane').toBe('arcane');
    expect(focus, 'the archetype must actually grant its focus spell').toBeTruthy();
    expect(focus!.tradition).toBe('arcane');
    expect(focus!.keyAbility).toBe(slots!.keyAbility);
  });

  it('leaves a real caster\'s own focus entry alone', () => {
    // A druid's entry holds their class focus spells too, so retargeting it would relabel THEIR spells
    // to satisfy the archetype's clause — the wrong way round. It keeps primal.
    const ch = build('druid', 8, { featPicks: { '2:class': 'hallowed-necromancer-dedication' } } as never);
    const focus = focusOf(ch);
    expect(focus).toBeTruthy();
    expect(Object.values(focus!.repertoire ?? {}).flat().length, 'premise: shares with class focus spells').toBeGreaterThan(1);
    expect(focus!.tradition).toBe('primal');
  });
});

describe('shields that print Shield Block', () => {
  /* The two shields carried `grantsFeats: ['shield-block']` and handed it to nobody: the item
   * feat-grant loop was gated on `invested`, and a shield is never invested. */
  it('both name the feat', () => {
    for (const id of ['metal-carapace-shield', 'hardwood-armor-shield']) {
      expect(db.items[id]?.grantsFeats, id).toContain('shield-block');
    }
  });

  it('a character carrying one actually gains it', () => {
    const ch = build('fighter', 3, {
      inventory: [{ instanceId: 's1', itemId: 'metal-carapace-shield', quantity: 1, equipped: true }],
    } as never);
    expect(ch.feats.map((f) => f.featId)).toContain('shield-block');
  });
});

describe('Fey Cantrips — two of its three grants are heritage-gated', () => {
  /* *"You gain dancing lights and ghost sound as primal innate cantrips. If you have the grig
   * heritage, you also gain detect magic, and if you have the draxie heritage, you gain
   * prestidigitation."* Only the unconditional pair could be expressed before. */
  const cantripsOf = (heritageId: string) => {
    const ch = build('fighter', 3, {
      ancestryId: 'sprite',
      heritageId,
      featPicks: { '1:ancestry': 'fey-cantrips' },
    } as never);
    return ch.spellcasting.flatMap((e) => [...(e.cantrips ?? []), ...Object.values(e.repertoire ?? {}).flat()]);
  };

  it('a grig gets detect magic and a draxie does not', () => {
    expect(cantripsOf('grig')).toContain('detect-magic');
    expect(cantripsOf('draxie')).not.toContain('detect-magic');
  });

  it('a draxie gets prestidigitation and a grig does not', () => {
    expect(cantripsOf('draxie')).toContain('prestidigitation');
    expect(cantripsOf('grig')).not.toContain('prestidigitation');
  });
});

describe('an item clause that triggers on CARRYING, not on equipping', () => {
  /* *"A character takes a –1 item penalty to all saving throws against curse effects while carrying an
   * evercursed crystal."* Carrying — not held, not worn, not invested. Both places that collect an
   * item's situational clauses required an equip flag, a condition we added that the source does not
   * have, so nothing in the app could ever surface it: a loose crystal is not equippable. */
  const ref = { kind: 'save', detail: 'will' } as never;
  const carrying = (items: string[]) =>
    build('fighter', 3, {
      inventory: items.map((itemId, i) => ({ instanceId: `i${i}`, itemId, quantity: 1 })),
    } as never);

  it('the clause is authored against all three saves', () => {
    const s = db.items['evercursed-crystal']?.situational?.[0];
    expect(s?.targets?.[0]).toEqual({ kind: 'save', detail: 'all' });
    expect(s?.when).toMatch(/carry/i);
  });

  it('stars the save when merely carried, and not otherwise', () => {
    expect(statHasSituational(carrying(['evercursed-crystal']), ref, db)).toBe(true);
    expect(statHasSituational(carrying([]), ref, db)).toBe(false);
  });

  it('an ARMOUR TRAIT still needs the armour worn — the gate only moved off the item itself', () => {
    /* The narrowing is deliberate. An item's own clauses follow the item, but an armour trait on
     * armour sitting in your pack is doing nothing, so `trait:` ids stay gated on wearing it. */
    const armour = (worn: boolean) =>
      build('fighter', 3, {
        inventory: [{ instanceId: 'a', itemId: 'hellknight-plate', quantity: 1, ...(worn ? { worn: true } : {}) }],
      } as never);
    const traitIds = (c: ReturnType<typeof build>) =>
      characterSituationalIds(c, db).filter((i) => i.startsWith('trait:'));
    expect(traitIds(armour(true)).length, 'premise: worn hellknight plate contributes its bulwark trait').toBeGreaterThan(0);
    expect(traitIds(armour(false)), 'unworn armour contributes none').toEqual([]);
  });
});

describe('archetype versions of class subsystems', () => {
  /* Each of these had the DATA authored and the reader looking somewhere else, so the record was
   * correct and the character got nothing — the failure mode this batch kept producing. */

  it('a dedicated runesmith gets the dedication\'s smaller repertoire, not the class ladder', () => {
    // *"You gain a runic repertoire with two 1st-level runes of your choice … your magic can sustain up
    // to one etched rune at a time"*, rising to 2 at 9th and 3 at 17th. The class ladder is 4 and 2.
    const via = (level: number) =>
      (build('fighter', level, { featPicks: { '2:class': 'runesmith-dedication' } } as never) as {
        runicRepertoire?: { repertoireMax: number; etchedMax: number };
      }).runicRepertoire;
    expect(via(4), 'the dedication must grant a repertoire at all').toBeTruthy();
    expect(via(4)).toMatchObject({ repertoireMax: 2, etchedMax: 1 });
    expect(via(10)!.etchedMax).toBe(2);
    expect(via(18)!.etchedMax).toBe(3);
    const real = (build('runesmith', 4, {}) as { runicRepertoire?: { repertoireMax: number } }).runicRepertoire;
    expect(real!.repertoireMax, 'the real runesmith keeps the class ladder').toBe(4);
  });

  it('the thaumaturge dedication trains one of its four printed skills, not any skill', () => {
    /* *"You become trained in your choice of Arcana, Nature, Occultism, or Religion."* It shipped as an
     * open slot, and an unanswered open slot resolves to SKILLS[0] — so every thaumaturge was trained
     * in Acrobatics, a skill the feat never mentions. The same bug the bloodrager had. */
    const opts = (FEAT_GRANTS['thaumaturge-dedication']?.skillChoices ?? [])[0]?.options;
    expect(opts).toEqual(['arcana', 'nature', 'occultism', 'religion']);
    const plain = build('fighter', 4, {});
    const thaum = build('fighter', 4, { featPicks: { '2:class': 'thaumaturge-dedication' } } as never);
    const trained = (c: ReturnType<typeof build>) =>
      Object.entries(c.proficiencies.skills).filter(([, r]) => r && r !== 'untrained').map(([k]) => k);
    const gained = trained(thaum).filter((s) => !trained(plain).includes(s));
    expect(gained).not.toContain('acrobatics');
    for (const g of gained) expect(['arcana', 'nature', 'occultism', 'religion']).toContain(g);
  });

  it("the necromancer's occult access to Harm is on the character, and Harm is not occult by itself", () => {
    /* Harm is a divine spell; the dirge grants occult access to it. The sheet read that widening off
     * the class feature while the builder — where a prepared caster's book is filled — read only
     * feats, so the two surfaces disagreed about a spell the class is built around. */
    expect(build('necromancer', 1, {}).spellListAdditions).toEqual({ 'necromancer-casting': ['harm'] });
    expect(db.spells['harm'].traditions, 'premise: Harm is not occult on its own').not.toContain('occult');
  });
});

describe('Wayang Weapon Familiarity names seven weapons, not six', () => {
  /* *"You gain access to and familiarity with the blowgun, fighting fan, kris, longspear, machete,
   * sai, and trident."* The kris — the one weapon of the seven that is actually Wayang — was missing,
   * and the familiarity half (treat martial as simple) was not modelled at all. */
  const SEVEN = ['blowgun', 'fighting-fan', 'kris', 'longspear', 'machete', 'sai', 'trident'];

  it('lists all seven for crit spec and for familiarity', () => {
    // The two halves live in different places, deliberately: crit spec is a field on the RECORD, while
    // `weaponFamiliarity` for a feat is read off FEAT_GRANTS (the code registries) — build.ts never
    // consults the record's own copy, so authoring one there would be a field nothing reads.
    expect(db.feats['wayang-weapon-familiarity'].critSpecWeapons?.bases?.slice().sort()).toEqual([...SEVEN].sort());
    const fam = FEAT_GRANTS['wayang-weapon-familiarity']?.weaponFamiliarity as
      | { weapons?: string[]; treatAsLowerCategory?: boolean }
      | undefined;
    expect(fam?.weapons?.slice().sort()).toEqual([...SEVEN].sort());
    expect(fam?.treatAsLowerCategory).toBe(true);
  });

  it('every weapon it names is a real item', () => {
    for (const w of SEVEN) expect(db.items[w], w).toBeTruthy();
  });
});
