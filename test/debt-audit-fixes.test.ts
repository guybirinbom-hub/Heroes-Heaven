import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveStrikes, deriveDefenses, creatureTraitsOf } from '../src/rules/derive';
import type { BuildState } from '../src/rules/build';
import type { Character } from '../src/rules/types';

const db = content();

/**
 * Fixes from the pre-batch-10 debt audit. Three of these are cases where a reader scanned a data shape
 * NOTHING WROTE — code that type-checks, looks correct, never fires, and no test noticed.
 */

describe('Deadly Aspect upgrades the attack it names, and only that one', () => {
  /*
   * *"The unarmed attack you gained FROM DRACONIC ASPECT gains the deadly d8 trait."*
   *
   * `UnarmedRider.fromRecord` was declared and read (`out.source !== r.fromRecord`) while NO
   * construction site ever assigned `source`. So the gate matched nothing and the feat was 100% inert
   * — and it got that way from a fix meant to stop it over-applying, which is worse than the bug it
   * replaced. Natural attacks now carry the id of the record that granted them.
   */
  const strikeNamed = (ch: Character, name: RegExp) => deriveStrikes(ch, db).find((s) => name.test(s.name));

  it('a draconic-aspect claw gains deadly d8 once Deadly Aspect is taken', () => {
    const withAspect = build('fighter', 4, {
      featPicks: { '1:ancestry': 'draconic-aspect' },
      featChoices: { '1:ancestry': 'claw' },
    } as unknown as Partial<BuildState>) as Character;
    const before = strikeNamed(withAspect, /claw/i);
    expect(before, 'the claw itself must exist first').toBeTruthy();
    expect(before!.traits).not.toContain('deadly-d8');

    const withBoth = build('fighter', 4, {
      featPicks: { '1:ancestry': 'draconic-aspect', '2:class': 'deadly-aspect' },
      featChoices: { '1:ancestry': 'claw' },
    } as unknown as Partial<BuildState>) as Character;
    expect(strikeNamed(withBoth, /claw/i)!.traits).toContain('deadly-d8');
  });

  it('every granted natural attack records which record granted it', () => {
    const ch = build('fighter', 4, {
      featPicks: { '1:ancestry': 'draconic-aspect' },
      featChoices: { '1:ancestry': 'jaws' },
    } as unknown as Partial<BuildState>) as Character;
    const jaws = (ch.naturalAttacks ?? []).find((n) => /jaws/i.test(n.name));
    expect(jaws?.source).toBe('draconic-aspect');
  });
});

describe('sanctification reaches the character', () => {
  /*
   * The plain-`choice` grant loop read `content.classFeatures` only, so a FEAT whose option carries a
   * grant applied nothing. Both archetype dedications print the clause — *"…can receive that deity's
   * divine sanctification"* / *"gain the champion's aura and sanctification"* — and neither holy nor
   * unholy ever reached the character, so it reached neither their Strikes nor their IWR.
   */
  it.each([
    ['cleric-dedication', 'holy'],
    ['cleric-dedication', 'unholy'],
    ['champion-dedication', 'holy'],
    ['champion-dedication', 'unholy'],
  ])('%s answered %s grants that creature trait', (featId, answer) => {
    const ch = build('fighter', 4, {
      featPicks: { '2:class': featId },
      featChoices: { '2:class': answer },
    } as unknown as Partial<BuildState>) as Character;
    expect(creatureTraitsOf(ch, db).map((t) => t.trait)).toContain(answer);
  });

  it('and "none" grants neither', () => {
    const ch = build('fighter', 4, {
      featPicks: { '2:class': 'champion-dedication' },
      featChoices: { '2:class': 'none' },
    } as unknown as Partial<BuildState>) as Character;
    const traits = creatureTraitsOf(ch, db).map((t) => t.trait);
    expect(traits).not.toContain('holy');
    expect(traits).not.toContain('unholy');
  });
});

describe('archetype feats are reachable without the Free Archetype variant', () => {
  /*
   * RAW an archetype feat is bought with a CLASS feat slot; Free Archetype is the optional rule that
   * grants a separate slot, not the only way in. 138 feats ship `category: 'archetype'` — Quick,
   * Expert and Master Alchemy, the Impossible Magic dedications, Advanced Red Mantis Magic — and every
   * one carries the `archetype` trait. An exact category match rejected all of them from a class slot,
   * so with the variant off they were selectable by nobody.
   */
  const archetypeCategory = Object.values(db.feats).filter((f) => f.category === 'archetype');

  it('there really are 138 of them, all carrying the trait', () => {
    expect(archetypeCategory.length).toBe(138);
    for (const f of archetypeCategory) expect(f.traits, f.id).toContain('archetype');
  });

  it('a class feat slot now offers them', async () => {
    const { eligibleFeatsForSlot } = await import('../src/rules/featSlots');
    const { emptyBuild } = await import('../src/rules/build');
    const bs = {
      ...emptyBuild(),
      level: 6,
      classId: 'fighter',
      ancestryId: 'human',
      backgroundId: Object.keys(db.backgrounds)[0],
    } as BuildState;
    const offered = eligibleFeatsForSlot(bs, db, { category: 'class', level: 6, idx: 0 } as Parameters<typeof eligibleFeatsForSlot>[2]);
    expect(offered.some((f) => f.category === 'archetype'), 'a class slot offers no archetype-category feat').toBe(true);
  });
});

describe('printed clauses that reached nothing', () => {
  /* Dwarven Waraxe (weapon-420) prints **Two-Hand 1d12**. Our item carried a BARE `two-hand` trait and
   * `deriveStrike` matches /^two-hand-(d\d+)$/, so the "(1d12 two-handed)" line never rendered. It was
   * the only bare `two-hand` item in the corpus. */
  it('the dwarven waraxe states its two-handed die', () => {
    expect(db.items['dwarven-waraxe'].traits).toContain('two-hand-d12');
    const bare = Object.values(db.items).filter((i) => (i.traits ?? []).includes('two-hand'));
    expect(bare.map((i) => i.id), 'a bare two-hand trait renders no die').toEqual([]);
  });

  /* Ratfolk, Sharp Teeth: *"You have a jaws unarmed attack that deals 1d4 piercing damage, is in the
   * brawling group, and has the agile and finesse traits."* The ancestry granted no strike, which ALSO
   * made `vicious-incisors` inert — its rider matches `jaws`. */
  it('a ratfolk has jaws, which un-blocks Vicious Incisors', () => {
    const ch = build('fighter', 3, { ancestryId: 'ratfolk' } as Partial<BuildState>) as Character;
    const jaws = deriveStrikes(ch, db).find((s) => /jaws/i.test(s.name));
    expect(jaws, 'ratfolk has no jaws').toBeTruthy();
    expect(jaws!.damage).toContain('d4');

    const withFeat = build('fighter', 3, {
      ancestryId: 'ratfolk',
      featPicks: { '1:ancestry': 'vicious-incisors' },
    } as unknown as Partial<BuildState>) as Character;
    const upgraded = deriveStrikes(withFeat, db).find((s) => /jaws/i.test(s.name))!;
    expect(upgraded.traits).toContain('backstabber');
    expect(upgraded.damage, 'stepDie should raise d4 → d6').toContain('d6');
  });

  /* Scaly Hide: *"The item bonus to AC from these scales is CUMULATIVE with armor potency runes on your
   * explorer's clothing, the Mystic Armor spell, or Bands of Force."* Natural armour otherwise competes
   * for the item slot and the higher wins, costing this character 1–2 AC at every level. */
  it("scaly hide's AC adds to a potency rune instead of competing with it", () => {
    expect(db.feats['scaly-hide'].unarmoredAc?.cumulative).toBe(true);
  });

  /* The Loremaster Dedication star pointed at `lore:bardic-lore`; both Lore-key normalisers strip the
   * word "lore" and the grant is `lore:bardic`, so it had never rendered for anyone. */
  it('the Bardic Lore star names the key the grant actually creates', async () => {
    const { FEAT_SITUATIONAL } = await import('../src/rules/situationalBonuses');
    const { FEAT_SKILL_GRANTS } = await import('../src/rules/featGrantsAuto');
    const granted = Object.keys(FEAT_SKILL_GRANTS['bardic-lore']?.skills ?? {});
    const starred = (FEAT_SITUATIONAL['loremaster-dedication'] ?? []).flatMap((s) => s.targets.map((t) => t.detail));
    expect(granted).toContain('lore:bardic');
    expect(starred).toContain('lore:bardic');
  });
});

describe('Dampening Harmonics — the last magiphage dependent', () => {
  /*
   * Hardshell Surki's second Evolution: *"You establish a force field that grants you resistance 10 to
   * damage dealt by spells and magical abilities with the trait of your magiphage ability, except for
   * force damage."* The action and its grant already shipped; the resistance did not.
   *
   * SOURCE-qualified, not a damage type — `IwrEntry.against`, which until now had a reader and zero
   * writers anywhere in the data. A qualified entry is deliberately kept OUT of the headline total
   * (whether the incoming spell carries your tradition's trait is unknowable from the sheet) and shown
   * as its own line, which is the honest treatment.
   */
  const mode = () => db.modes['dampening-harmonics'];

  it('exists, gated on the heritage, with the printed duration', () => {
    expect(mode()).toBeTruthy();
    expect(mode().feats).toContain('hardshell-surki');
    expect(mode().duration).toMatch(/10 minutes/);
  });

  it('carries a SOURCE-qualified resistance 10', () => {
    const r = (mode().resistances ?? [])[0];
    expect(r?.value).toBe(10);
    expect(r?.against, 'must be qualified — it is not a damage type').toBeTruthy();
    expect(r?.against).toMatch(/magiphage/i);
  });

  it('does not inflate the headline resistance total', () => {
    // The whole point of `against`: a conditional value must not read as one the character always has.
    const ch = build('fighter', 5, { ancestryId: 'surki', heritageId: 'hardshell-surki' } as Partial<BuildState>) as Character;
    const withMode: Character = { ...ch, activeModes: [{ id: 'dampening-harmonics' }] as Character['activeModes'] };
    const total = deriveDefenses(withMode, db).resistances.find((x) => x.type === 'all');
    expect(total).toBeUndefined();
  });

  it('and the action it belongs to is granted by the heritage', () => {
    expect(db.heritages['hardshell-surki'].grantsActions).toContain('dampening-harmonics');
    expect(db.actions['dampening-harmonics']).toBeTruthy();
  });
});
