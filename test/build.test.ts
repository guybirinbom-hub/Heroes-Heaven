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
  it('fighter weapons reach legendary at 13, classDC master at 19', () => {
    expect(prof(build('fighter', 13), 'martial')).toBe('legendary');
    expect(prof(build('fighter', 20), 'classDc')).toBe('master');
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
