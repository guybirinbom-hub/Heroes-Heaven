import { describe, it, expect } from 'vitest';
import { levelChoices, buildCharacter, emptyBuild, runeRepertoireMax } from '../src/rules/build';
import { content, build, firstSubclass } from './_content';

/**
 * GRIM FASCINATION IS A REQUIRED CHOICE, like a subclass.
 *
 * It is the necromancer's level-1 pick of what they study — blood, bone, flesh or spirit — and it
 * grants a grave spell and a thrall enhancement. `levelChoices` counted only `cls.extraChoices`
 * groups and the subclass anchor, and `classes.necromancer.extraChoices` is `[]`: the pick lives in
 * `classFeatures['grim-fascination'].effectChoices`, which nothing in that list ever read. So a
 * necromancer could be created, saved and played one focus point and one grave spell short at every
 * level, with the Create/Save confirmation, the chip markers and the page header tag all saying
 * everything was answered. Compare at L5: the animist is told "Apparitions (2)", the kineticist
 * "Kinetic Gate (elements) (2)", the thaumaturge "Implements (2)".
 *
 * Measured through the real engine, which is what these assertions run.
 */
describe('necromancer — Grim Fascination', () => {
  const necro = (over: Record<string, unknown> = {}) => ({
    ...emptyBuild(),
    name: 't',
    level: 20,
    classId: 'necromancer',
    ancestryId: Object.keys(content().ancestries)[0],
    backgroundId: Object.keys(content().backgrounds)[0],
    keyAbility: 'int' as const,
    subclassId: firstSubclass('necromancer'),
    ...over,
  });

  /** The label the builder shows, level prefix and all — `Level 1 — Grim Fascination — choose`. */
  const LABEL = 'Level 1 — Grim Fascination — choose';

  it('is listed as outstanding while it is unanswered', () => {
    const missing = levelChoices(necro() as never, content());
    expect(missing.map((m) => m.label)).toContain(LABEL);
    expect(missing.find((m) => m.label === LABEL)?.required).toBe(true);
    expect(missing.find((m) => m.label === LABEL)?.page).toBe(1);
  });

  it('stops being listed once it is answered', () => {
    const missing = levelChoices(necro({ effectChoices: { 'grim-fascination:grim-fascination': 'bone' } }) as never, content());
    expect(missing.map((m) => m.label)).not.toContain(LABEL);
  });

  it('and the answer is what pays for the grave spell and the second focus point', () => {
    const none = buildCharacter(necro() as never, content());
    const bone = buildCharacter(necro({ effectChoices: { 'grim-fascination:grim-fascination': 'bone' } }) as never, content());
    const focusOf = (ch: ReturnType<typeof buildCharacter>) =>
      ch.spellcasting.find((e) => e.type === 'focus');
    expect(focusOf(none)?.repertoire?.[1] ?? []).not.toContain('bone-spear');
    expect(focusOf(bone)?.repertoire?.[1] ?? []).toContain('bone-spear');
    expect(bone.focus!.max).toBeGreaterThan(none.focus!.max);
  });

  /** All four answers deliver a grave spell — a picker with one working option is not a choice. */
  it('every fascination grants its own grave spell', () => {
    for (const [value, spell] of [['blood', 'blood-infusion'], ['bone', 'bone-spear'], ['flesh', 'dead-weight'], ['spirit', 'life-tap']]) {
      const ch = buildCharacter(necro({ effectChoices: { 'grim-fascination:grim-fascination': value } }) as never, content());
      const focus = ch.spellcasting.find((e) => e.type === 'focus');
      expect(Object.values(focus?.repertoire ?? {}).flat(), value).toContain(spell);
    }
  });
});

/**
 * …AND THE RUNESMITH'S RUNIC REPERTOIRE, the same hole one surface over: the picker renders in
 * OriginPickers with its own 0/4 counter and nothing counted it, so a runesmith could be created and
 * saved knowing zero runes — the whole class mechanic empty — while the completeness check said
 * everything was answered.
 */
describe('runesmith — Runic Repertoire', () => {
  it('is listed as outstanding until the repertoire is full', () => {
    const empty = levelChoices({ ...emptyBuild(), name: 't', level: 1, classId: 'runesmith' } as never, content());
    const max = runeRepertoireMax(1, content());
    expect(max).toBeGreaterThan(0);
    expect(empty.map((m) => m.label)).toContain(`Runic repertoire (${max})`);
  });

  it('stops being listed once every rune is known', () => {
    const db = content();
    const max = runeRepertoireMax(1, db);
    const runes = Object.values(db.runesmithRune ?? {}).filter((r) => (r.level ?? 1) <= 1).slice(0, max).map((r) => r.id);
    expect(runes.length).toBe(max);
    const done = levelChoices({ ...emptyBuild(), name: 't', level: 1, classId: 'runesmith', runesmithRunes: runes } as never, db);
    expect(done.map((m) => m.label).filter((l) => l.startsWith('Runic repertoire'))).toEqual([]);
  });

  /** A class with no runes owes nothing — the gate is the class, not the presence of the picker. */
  it('says nothing to a fighter', () => {
    const ch = build('fighter', 1);
    expect(ch.classId).toBe('fighter');
    const missing = levelChoices({ ...emptyBuild(), name: 't', level: 1, classId: 'fighter' } as never, content());
    expect(missing.map((m) => m.label).filter((l) => l.startsWith('Runic repertoire'))).toEqual([]);
  });
});
