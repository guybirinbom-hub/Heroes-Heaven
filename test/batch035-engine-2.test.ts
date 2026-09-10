import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { buildCharacter, deriveBuildFromCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { deriveStrikes } from '../src/rules/derive';
import type { Character, ClassFeature, ContentDatabase } from '../src/rules/types';

/**
 * Batch 035, engine chunk 2 — Animal Instinct's whole Bestial Rage lane and the witch lessons'
 * familiar-taught spells.
 *
 * Two of these findings need a DATA row that the data-rows family authors (this chunk owns readers,
 * not rows), so their tests patch the field into a COPY of the content database in memory. The copy is
 * always built by spreading, never by mutating `content()` — that database is a cached singleton the
 * rest of the suite shares.
 */
const db = () => content();

/** A content database with one class-feature record patched. Never mutates the shared singleton. */
function withFeature(id: string, patch: Partial<ClassFeature>): ContentDatabase {
  const base = db();
  return { ...base, classFeatures: { ...base.classFeatures, [id]: { ...base.classFeatures[id], ...patch } as ClassFeature } };
}

function buildWith(over: Partial<BuildState>, on: ContentDatabase = db()): Character {
  const anc = Object.keys(on.ancestries)[0];
  const bg = Object.keys(on.backgrounds)[0];
  return buildCharacter({ ...emptyBuild(), name: 't', level: 1, ancestryId: anc, backgroundId: bg, keyAbility: 'str', ...over } as BuildState, on);
}

/** A barbarian who chose the given animal for Animal Instinct. */
const animalBarb = (level: number, animal: string, on: ContentDatabase = db()) =>
  buildWith({ level, classId: 'barbarian', subclassId: 'animal-instinct', featChoices: { 'feature:animal-instinct': animal } }, on);

/** The same character with the Rage toggle switched on, which is what the play overlay does. */
const raging = (ch: Character): Character => ({ ...ch, classResources: { ...(ch.classResources ?? {}), rage: 1 } });

describe('animal-instinct — Bestial Rage', () => {
  // batch 035: animal-instinct#no-reader
  it('animal-instinct grants the chosen animal’s unarmed attack (Wolf → Jaws)', () => {
    const wolf = animalBarb(1, 'wolf');
    const jaws = (wolf.naturalAttacks ?? []).find((n) => n.name === 'Jaws');
    expect(jaws).toBeTruthy();
    expect(jaws!.source).toBe('animal-instinct');
    expect(jaws!.die).toBe('d10');
    // …and only that animal's: the record's 29 rows cover 22 animals, so an unfiltered push would
    // have handed the wolf barbarian every one of them.
    const bear = animalBarb(1, 'bear');
    expect((bear.naturalAttacks ?? []).map((n) => n.name).sort()).toEqual(['Claw', 'Jaws']);
    expect((wolf.naturalAttacks ?? []).map((n) => n.name)).toEqual(['Jaws']);
  });

  // batch 035: animal-instinct#no-reader
  it('animal-instinct’s granted Strike is subtracted on the Character → BuildState round-trip', () => {
    // `deriveBuildFromCharacter` must subtract exactly what buildCharacter adds. When it cannot see
    // the animal answer it subtracts nothing, and the derived Jaws is stored back as a MANUAL attack —
    // which the seed-dedup then hides, so the count stays 1 and only the lost `source` shows it. That
    // source is load-bearing: the rage gate and the Rage-damage scope both read it.
    const wolf = animalBarb(1, 'wolf');
    const state = deriveBuildFromCharacter(wolf, db());
    expect(state.naturalAttacks ?? []).toHaveLength(0);
    const round = buildCharacter(state, db());
    const jaws = (round.naturalAttacks ?? []).filter((n) => n.name === 'Jaws');
    expect(jaws).toHaveLength(1);
    expect(jaws[0].source).toBe('animal-instinct');
  });

  // batch 035: animal-instinct#rage-gate
  it('animal-instinct’s Jaws exists only while raging', () => {
    // The row is the data-rows family's; patched in memory here so the READER is what is under test.
    const gated = withFeature('animal-instinct', { grantedStrikesState: 'rage' });
    const wolf = animalBarb(1, 'wolf', gated);
    expect((wolf.naturalAttacks ?? []).find((n) => n.name === 'Jaws')?.requiresState).toBe('rage');
    const names = (ch: Character) => deriveStrikes(ch, gated).map((s) => s.name);
    expect(names(wolf)).not.toContain('Jaws'); // rage off → the attack does not exist
    expect(names(raging(wolf))).toContain('Jaws');
    // The baseline Fist is untouched in both states — the gate drops one Strike, not the lane.
    expect(names(wolf)).toContain('Fist');
  });

  // batch 035: animal-instinct#rage-damage-scope
  it('animal-instinct raises Rage damage for its own attack only, not for a plain Fist', () => {
    const ch = raging(animalBarb(7, 'wolf'));
    const strikes = deriveStrikes(ch, db());
    const rider = (name: string) => (strikes.find((s) => s.name === name)?.conditionalDamage ?? []).find((r) => r.note.includes('while raging'));
    // *"increase the additional damage from Rage from 2 to 5 for your chosen animal's unarmed attacks"*
    expect(rider('Jaws')?.text).toBe('5 piercing');
    // The Fist is agile, so Rage's ordinary 2 is halved to 1 — the point is the 2, not the 5.
    expect(rider('Fist')?.text).toBe('1 bludgeoning');
    expect(rider('Fist')?.note).toContain('not your animal’s attack'.replace('’', "'"));
    // 15th: 12 for the animal's attack, still Rage's own 2 (halved) for the Fist.
    const at15 = deriveStrikes(raging(animalBarb(15, 'wolf')), db());
    expect((at15.find((s) => s.name === 'Jaws')?.conditionalDamage ?? []).find((r) => r.note.includes('while raging'))?.text).toBe('12 piercing');
    expect((at15.find((s) => s.name === 'Fist')?.conditionalDamage ?? []).find((r) => r.note.includes('while raging'))?.text).toBe('1 bludgeoning');
  });

  // batch 035: animal-instinct#rage-damage-scope
  it('animal-instinct’s narrowing leaves the other instincts’ Rage damage alone', () => {
    // Blast radius: `unarmedOnly` is set on animal-instinct alone, so a Fury barbarian's Fist still
    // reads its own tier (3 at 1st, halved to 1 by agile) exactly as before.
    const fury = raging(buildWith({ level: 7, classId: 'barbarian', subclassId: 'fury-instinct' }));
    const fist = deriveStrikes(fury, db()).find((s) => s.name === 'Fist');
    expect((fist?.conditionalDamage ?? []).find((r) => r.note.includes('while raging'))?.text).toBe('3 bludgeoning');
  });

  // batch 035: animal-instinct#spec-die-step
  it('animal-instinct steps its animal attack’s die at 7th, and not before', () => {
    // *"Increase the damage die size for the unarmed attacks granted by your chosen animal by one
    // step."* The rider row is the data-rows family's; patched in memory so the minLevel READER is
    // what this pins. `fromRecord` keeps it off the barbarian's own Fist.
    const stepped = withFeature('animal-instinct', { unarmedTraits: [{ fromRecord: 'animal-instinct', stepDie: 1, minLevel: 7 }] });
    /* RAGING, because the animal's attack is now gated on it: the batch's rage-gate row shipped
     * `grantedStrikesState: 'rage'` on the record, and deriveStrikes drops a gated attack outright
     * while the toggle is off — so an unraging barbarian has no Jaws for the die step to reach.
     * (`Fist` is ungated and reads the same in either state, which is why the last assertion below
     * still proves the rider stays off it.) */
    // batch 035: animal-instinct#rage-gate
    const dieOf = (level: number, on: ContentDatabase, name: string) => {
      const s = deriveStrikes(raging(animalBarb(level, 'wolf', on)), on).find((x) => x.name === name);
      return /^\d+d\d+/.exec(s?.damage ?? '')?.[0]; // just the dice, without the ability modifier
    };
    expect(dieOf(6, stepped, 'Jaws')).toBe('1d10');
    expect(dieOf(7, stepped, 'Jaws')).toBe('1d12');
    // Ungated, the same rider would have fired at 1st — which is the defect minLevel exists to stop.
    const ungated = withFeature('animal-instinct', { unarmedTraits: [{ fromRecord: 'animal-instinct', stepDie: 1 }] });
    expect(dieOf(6, ungated, 'Jaws')).toBe('1d12');
    // …and it never touches the Fist, whose die is not the animal's.
    expect(dieOf(7, stepped, 'Fist')).toBe('1d4');
  });
});

describe('lesson-of-vengeance — the familiar’s taught spell', () => {
  // batch 035: lesson-of-vengeance#familiar-spell
  it('lesson-of-vengeance puts Phantom Pain in the witch’s spellbook alongside the hex', () => {
    // *"You gain the Needle of Vengeance hex, and your familiar learns Phantom Pain."* The
    // grantedSpells row is the data-rows family's, patched in memory so the READER is under test.
    const taught = withFeature('lesson-of-vengeance', { grantedSpells: ['phantom-pain'] });
    const over = { classId: 'witch', subclassId: 'baba-yaga', level: 2, keyAbility: 'int' as const, featPicks: { '2:class': 'basic-lesson' }, featChoices: { '2:class': 'aon-lesson-of-vengeance' } };
    const withRow = buildWith(over, taught);
    const book = (ch: Character) => ch.spellcasting.find((s) => s.type === 'prepared')?.spellbook?.[1] ?? [];
    expect(book(withRow)).toContain('phantom-pain');
    // The hex is unaffected — this is the OTHER half of the same sentence, not a replacement.
    expect(withRow.spellcasting.find((s) => s.type === 'focus')?.repertoire?.[1] ?? []).toContain('needle-of-vengeance');
    /* Stunted copy: with the field absent nothing is taught, so this test cannot pass by accident on
     * a build that already had the spell from somewhere else. It read `db()` while the row was still
     * a spec — "what ships today" — and the row has since landed, so the stunt has to be built
     * explicitly or it stops biting. */
    // batch 035: lesson-of-vengeance#familiar-spell
    const stripped = withFeature('lesson-of-vengeance', { grantedSpells: undefined } as Partial<ClassFeature>);
    expect(stripped.classFeatures['lesson-of-vengeance'].grantedSpells).toBeUndefined();
    expect(book(buildWith(over, stripped))).not.toContain('phantom-pain');
  });
});

describe('lesson-of-elements — the familiar’s chosen spell', () => {
  const gsc = { id: 'lesson-of-elements-familiar', prompt: 'Familiar spell', options: ['breathe-fire', 'gust-of-wind', 'hydraulic-push', 'pummeling-rubble'] };
  const chooser = () => withFeature('lesson-of-elements', { grantedSpellChoice: gsc });
  const over = (answer?: string) => ({
    classId: 'witch',
    subclassId: 'baba-yaga',
    level: 2,
    keyAbility: 'int' as const,
    featPicks: { '2:class': 'basic-lesson' },
    featChoices: { '2:class': 'aon-lesson-of-elements' },
    ...(answer ? { featSpellChoices: { '2:class:granted-spell': answer } } : {}),
  });
  const book = (ch: Character) => ch.spellcasting.find((s) => s.type === 'prepared')?.spellbook?.[1] ?? [];

  // batch 035: lesson-of-elements#familiar-spell-choice
  it('lesson-of-elements teaches the familiar the spell the player chose, and only that one', () => {
    // *"Your familiar learns your choice of breathe fire, gust of wind, hydraulic push, or pummeling
    // rubble."* — one of four, never all four, and never a silent default.
    const picked = book(buildWith(over('gust-of-wind'), chooser()));
    expect(picked).toContain('gust-of-wind');
    expect(picked).not.toContain('breathe-fire');
    // Unanswered grants nothing: the choice is the player's, so a default would make it for them.
    expect(book(buildWith(over(), chooser()))).not.toContain('gust-of-wind');
    // An answer that is not one of THIS feature's options is ignored, like the subclass lane's.
    expect(book(buildWith(over('fireball'), chooser()))).not.toContain('fireball');
  });
});
