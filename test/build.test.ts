import { describe, it, expect } from 'vitest';
import { content, build, prof, mainCasting, firstSubclass } from './_content';

describe('every class builds', () => {
  const ids = Object.keys(content().classes);
  it('has all 27 classes', () => expect(ids.length).toBe(27));
  for (const id of ids) {
    for (const level of [1, 7, 15, 20]) {
      it(`${id} builds at L${level}`, () => {
        const ch = build(id, level);
        expect(ch.level).toBe(level);
        expect(ch.abilities).toBeTruthy();
        expect(ch.hitPoints.current).toBeGreaterThan(0);
      });
    }
  }
});

describe('proficiency advancement', () => {
  it('fighter armor: trained@8, expert@11, master@17 (regression for the L7 bug)', () => {
    expect(prof(build('fighter', 8), 'medium')).toBe('trained');
    expect(prof(build('fighter', 11), 'medium')).toBe('expert');
    expect(prof(build('fighter', 17), 'medium')).toBe('master');
  });
  it('fighter general weapons reach MASTER at 13 (not legendary — that is per chosen group), classDC master at 19', () => {
    // Weapon Legend's general clause: all simple/martial/unarmed → master@13; advanced → expert@13.
    // Legendary is granted ONLY to the chosen weapon group (see the weapon-group test below).
    expect(prof(build('fighter', 13), 'martial')).toBe('master');
    expect(prof(build('fighter', 13), 'advanced')).toBe('expert');
    expect(prof(build('fighter', 20), 'classDc')).toBe('master');
  });
  it('fighter Weapon Mastery/Legend elevate ONLY the chosen weapon group', () => {
    // A sword-group fighter: swords hit master@5 (group) while off-group stays expert (chassis);
    // at 13 swords reach legendary via the group while general martial is only master.
    const g = { fighterWeaponGroup: 'sword' };
    const l5 = build('fighter', 5, g);
    expect(l5.proficiencies.weaponGroups?.sword).toBe('master');
    expect(prof(l5, 'martial')).toBe('expert'); // off-group / general martial unchanged at 5
    const l13 = build('fighter', 13, g);
    expect(l13.proficiencies.weaponGroups?.sword).toBe('legendary'); // chosen group
    expect(prof(l13, 'martial')).toBe('master'); // general martial (off-group) only master
  });
  it('champion reaches legendary armor at 17', () => {
    expect(prof(build('champion', 17), 'heavy')).toBe('legendary');
  });
  it('monk: legendary unarmored + master class DC at 20', () => {
    expect(prof(build('monk', 20), 'unarmored')).toBe('legendary');
    expect(prof(build('monk', 20), 'classDc')).toBe('master');
  });
  it('barbarian: legendary fortitude + master perception at 20', () => {
    expect(prof(build('barbarian', 20), 'fortitude')).toBe('legendary');
    expect(prof(build('barbarian', 20), 'perception')).toBe('master');
  });
  it('thaumaturge: master weapons + legendary will at 13', () => {
    expect(prof(build('thaumaturge', 13), 'martial')).toBe('master');
    expect(prof(build('thaumaturge', 13), 'will')).toBe('legendary');
  });
});

describe('full casters', () => {
  it('sorcerer reaches legendary spellcasting at 20', () => {
    expect(prof(build('sorcerer', 20), 'spellcasting')).toBe('legendary');
  });
  it("sorcerer's tradition follows the bloodline (Aberrant -> occult)", () => {
    const ch = build('sorcerer', 1, { subclassId: 'bloodline-aberrant' });
    expect(mainCasting(ch)?.tradition).toBe('occult');
  });
  it('oracle: divine, spellcasting + will legendary at 19/20', () => {
    const ch = build('oracle', 20);
    expect(mainCasting(ch)?.tradition).toBe('divine');
    expect(prof(ch, 'spellcasting')).toBe('legendary');
    expect(prof(ch, 'will')).toBe('legendary');
  });
});

describe('limited casters', () => {
  it('magus casts off Intelligence (not its Str/Dex class key)', () => {
    expect(mainCasting(build('magus', 5))?.keyAbility).toBe('int');
    expect(mainCasting(build('magus', 5))?.tradition).toBe('arcane');
  });
  it('magus gains studious bonus slots at the tier rank (L7 -> rank 2)', () => {
    const e = mainCasting(build('magus', 7));
    const r2 = e?.prepared?.[2]?.map((s) => s.spellId) ?? [];
    expect(r2).toContain('sure-strike');
  });
  it('summoner has the link spells as focus spells with a pool of 1', () => {
    const ch = build('summoner', 5);
    const focus = ch.spellcasting.find((s) => s.type === 'focus');
    const ids = Object.values(focus?.repertoire ?? {}).flat();
    expect(ids).toContain('boost-eidolon');
    expect(ids).toContain('evolution-surge');
    expect(ch.focus?.max).toBe(1);
  });
  it("summoner's tradition follows the eidolon (Angel -> divine)", () => {
    const ch = build('summoner', 1, { subclassId: 'angel-eidolon' });
    expect(mainCasting(ch)?.tradition).toBe('divine');
  });
});

describe('psychic subconscious mind sets the key ability', () => {
  it('precise-discipline -> Int, emotional-acceptance -> Cha', () => {
    const cm = firstSubclass('psychic');
    const int = build('psychic', 6, { subclassId: cm, extraChoices: { 'subconscious-mind': ['precise-discipline'] } });
    const cha = build('psychic', 6, { subclassId: cm, extraChoices: { 'subconscious-mind': ['emotional-acceptance'] } });
    expect(int.keyAbility).toBe('int');
    expect(mainCasting(int)?.keyAbility).toBe('int');
    expect(cha.keyAbility).toBe('cha');
    expect(mainCasting(cha)?.keyAbility).toBe('cha');
  });
});

describe('animist two-pool casting', () => {
  const apps = () =>
    (content().classes.animist.extraChoices?.find((g) => g.id === 'apparition')?.options ?? [])
      .slice(0, 4)
      .map((o) => o.id);
  it('produces a prepared "animist" pool AND a spontaneous "apparition" pool', () => {
    const ch = build('animist', 10, { extraChoices: { apparition: apps() } });
    const pools = ch.spellcasting.filter((s) => s.type === 'prepared' || s.type === 'spontaneous');
    expect(pools.map((p) => p.type).sort()).toEqual(['prepared', 'spontaneous']);
    const apparition = ch.spellcasting.find((s) => s.id === 'animist-apparition-casting');
    expect(apparition?.tradition).toBe('divine');
    expect(Object.values(apparition?.repertoire ?? {}).flat().length).toBeGreaterThan(0);
  });
});

describe('focus pools', () => {
  it('animist scales 1 -> 2 (L7) -> 3 (L15); summoner & bard stay 1', () => {
    const apps = (content().classes.animist.extraChoices?.find((g) => g.id === 'apparition')?.options ?? [])
      .slice(0, 4)
      .map((o) => o.id);
    expect(build('animist', 1, { extraChoices: { apparition: apps } }).focus?.max).toBe(1);
    expect(build('animist', 7, { extraChoices: { apparition: apps } }).focus?.max).toBe(2);
    expect(build('animist', 15, { extraChoices: { apparition: apps } }).focus?.max).toBe(3);
    expect(build('summoner', 5).focus?.max).toBe(1);
    expect(build('bard', 5).focus?.max).toBe(1);
  });
});

describe('non-caster subsystems', () => {
  it('exemplar records its chosen ikons as classChoices, no spellcasting', () => {
    const ikons = (content().classes.exemplar.extraChoices?.find((g) => g.id === 'ikon')?.options ?? [])
      .slice(0, 3)
      .map((o) => o.id);
    const ch = build('exemplar', 7, { extraChoices: { ikon: ikons } });
    expect(ch.spellcasting.length).toBe(0);
    const ikonChoices = (ch.classChoices ?? []).filter((c) => c.group === 'Ikons');
    expect(ikonChoices.length).toBe(3);
  });
  it('kineticist builds with elements and no spellcasting; blast is a feature', () => {
    const els = (content().classes.kineticist.extraChoices?.find((g) => g.id === 'element')?.options ?? [])
      .slice(0, 2)
      .map((o) => o.id);
    const ch = build('kineticist', 5, { extraChoices: { element: els } });
    expect(ch.spellcasting.length).toBe(0);
    expect(content().classes.kineticist.features.some((f) => f.featureId === 'elemental-blast')).toBe(true);
  });
});

describe('caster-math accuracy (audit Section 3A)', () => {
  const prepared = (ch: ReturnType<typeof build>) => ch.spellcasting.find((e) => e.type === 'prepared')!;
  const counts = (e: ReturnType<typeof prepared>) =>
    Object.fromEntries(Object.entries(e.prepared ?? {}).map(([r, a]) => [Number(r), a.length]));

  it('witch is a LEARNED prepared caster (a spellbook, no curriculum inflation)', () => {
    const w = prepared(build('witch', 5, { keyAbility: 'int' }));
    // The familiar is "the source and repository of the spells" — a spellbook, like the wizard's.
    expect(w.spellbook).toBeTruthy();
    // Plain full-caster slot table with NO extra curriculum slot (which was the cleric/druid path bug).
    expect(counts(w)).toEqual({ 1: 3, 2: 3, 3: 2 });
  });

  it('wizard arcane school grants a +1 curriculum slot per castable rank', () => {
    const s = prepared(build('wizard', 5, { subclassId: 'school-of-battle-magic', keyAbility: 'int' }));
    expect(counts(s)).toEqual({ 1: 4, 2: 4, 3: 3 });
  });

  it('UMT has no curriculum: no extra slot and no 6th cantrip', () => {
    // School of Unified Magical Theory grants NO curriculum spells and NO extra school cantrip.
    const umt = build('wizard', 5, { subclassId: 'school-of-unified-magical-theory', keyAbility: 'int' });
    const e = prepared(umt);
    expect(counts(e)).toEqual({ 1: 3, 2: 3, 3: 2 }); // base full-caster table, no +1
  });
});
