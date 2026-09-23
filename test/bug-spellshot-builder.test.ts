import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { buildCharacter, emptyBuild, legacyArchetypeCantrips, setupMissing, type BuildState } from '../src/rules/build';
import { activeCasterArchetype, archetypeCantripAllowed } from '../src/rules/casterArchetypes';

/**
 * SPELLSHOT — the two BUILDER-side residues the engine lane left behind (owner, 2026-09-22).
 *
 * 1. A character saved before the archetype had a spell pool stores its two cantrips in the
 *    dedication's own retired `effectChoices`. `buildCharacter` delivers them to the sheet from there
 *    (LEGACY_ARCHETYPE_CANTRIP_KEYS), but the Builder's cantrip row counted `build.cantrips` — empty
 *    for exactly those saves — so it read "0 / 2" over two cantrips the character was already casting,
 *    and the only way to clear it was picking them again. The row reads the SHEET'S function now
 *    (`legacyArchetypeCantrips`, exported for this), so the two cannot disagree about one save.
 *
 * 2. Way of the Spellshot prints *"You must select Spellshot Dedication as your 2nd-level class
 *    feat."* and nothing enforced or prompted it. The app already has a field for that exact sentence
 *    — `SubclassOption.requiresFeat`, carried by barbarian/bloodrager and inventor/light-mortar-
 *    innovation and reported by `setupMissing` — and the way now carries it too. Never auto-granted:
 *    the printed sentence is an instruction to the player, which is the convention's own reason.
 *
 * MUTATION-PROVED (each fix reverted alone):
 *   · `legacyArchetypeCantrips` returning `[]` → "the row is filled from the save" fails (0 / 2);
 *   · the row in Builder.tsx put back to `{build.cantrips.length} / {cantripCap}` → "the row is wired
 *     to that reader" fails;
 *   · the `requiresFeat` overlay row dropped → all three forced-dedication legs fail.
 */

const db = content();
const BUILDER_SRC = readFileSync('src/builder/Builder.tsx', 'utf8');

/** A gunslinger on the way, with the dedication the way's print forces at 2nd level. */
const spellshot = (level: number, over: Partial<BuildState> = {}): BuildState =>
  ({
    ...emptyBuild(),
    name: 't',
    level,
    classId: 'gunslinger',
    keyAbility: 'dex',
    ancestryId: 'human',
    backgroundId: 'acrobat',
    subclassId: 'way-of-the-spellshot',
    featPicks: { '2:class': 'spellshot-dedication' },
    ...over,
  }) as BuildState;

/** The two answers a build saved before the archetype had a pool still carries. */
const STORED = {
  'spellshot-dedication:spellbook-cantrip-1': 'electric-arc',
  'spellshot-dedication:spellbook-cantrip-2': 'detect-magic',
};

/** The Builder's cantrip row, computed the way Builder.tsx computes it (legacyCantrips → rowCantrips). */
const builderRow = (b: BuildState) => {
  const archCaster = activeCasterArchetype(Object.values(b.featPicks).filter((v): v is string => !!v));
  const legacy =
    archCaster && !b.cantrips.length
      ? legacyArchetypeCantrips(archCaster.dedicationId, b, db).filter((id) => archetypeCantripAllowed(archCaster, id))
      : [];
  return { chips: legacy.length ? legacy : b.cantrips, cap: archCaster?.config.cantrips ?? 0 };
};

/** What the SHEET delivers for the same build — the other half of "one source of truth". */
const sheetCantrips = (b: BuildState) =>
  buildCharacter(b, db).spellcasting.find((e) => e.id === 'spellshot-dedication-casting')?.cantrips;

describe('the Builder shows the cantrips an old spellshot already has', () => {
  it('a save in the old shape opens with the row filled, not 0 / 2', () => {
    const row = builderRow(spellshot(4, { effectChoices: STORED }));
    expect(row.cap, 'the dedication prepares two cantrips').toBe(2);
    expect(row.chips).toEqual(['electric-arc', 'detect-magic']);
  });

  it('…and the sheet is unchanged — the row and the sheet read one function', () => {
    const b = spellshot(4, { effectChoices: STORED });
    expect(sheetCantrips(b)).toEqual(['electric-arc', 'detect-magic']);
    expect(builderRow(b).chips).toEqual(sheetCantrips(b));
  });

  it('a pick made in the archetype\'s own picker still wins', () => {
    // The fallback is read only while the pool is EMPTY, so re-answering migrates it — and the row
    // must not show the retired answers over a pick the player has since made.
    const b = spellshot(4, { effectChoices: STORED, cantrips: ['light'] });
    expect(builderRow(b).chips).toEqual(['light']);
    expect(sheetCantrips(b)).toEqual(['light']);
  });

  it('a spellshot with nothing stored is still an empty row', () => {
    // The negative control: no invented prefill. A new character picks their own two.
    expect(builderRow(spellshot(4)).chips).toEqual([]);
    expect(sheetCantrips(spellshot(4))).toEqual([]);
  });

  it('the row is wired to that reader, not to build.cantrips', () => {
    // The row itself cannot be measured from a .ts test, so it is measured at the source: a row that
    // goes back to counting `build.cantrips` fails here, which is the mutation that matters.
    expect(BUILDER_SRC).toContain('legacyArchetypeCantrips(archCaster.dedicationId, build, content)');
    expect(BUILDER_SRC).toContain('{rowCantrips.length} / {cantripCap}');
    expect(BUILDER_SRC).not.toContain('{build.cantrips.length} / {cantripCap}');
    // …and editing a row that is showing the fallback materialises it first, so the X on a chip
    // removes that cantrip instead of adding it to an empty list.
    expect(BUILDER_SRC).toContain('if (legacyCantrips.length) actions.patch({ cantrips: legacyCantrips });');
  });
});

describe('the "Archetype spellcasting" SetupCard (src/builder/shared.tsx) reads the same fallback', () => {
  // Unreachable for spellshot TODAY — gunslinger has no class spellcasting, so this card never renders
  // for it — but a caster CLASS holding a dedication in LEGACY_ARCHETYPE_CANTRIP_KEYS hits the SetupCard
  // that reads build.archetypeSpells.cantrips (the class already has its own pool), which is the same
  // 0/2-over-2 divergence Builder.tsx's cantrip row had, the moment another dedication joins that table.
  const wizardWithDedication = (over: Partial<BuildState> = {}): BuildState =>
    ({
      ...emptyBuild(),
      name: 't',
      level: 4,
      classId: 'wizard',
      keyAbility: 'int',
      ancestryId: 'human',
      backgroundId: 'acrobat',
      subclassId: 'school-of-ars-grammatica',
      featPicks: { '2:class': 'spellshot-dedication' },
      ...over,
    }) as BuildState;

  /** The card's own computation, from src/builder/shared.tsx (arch → legacyCantrips → rowCantrips). */
  const cardRow = (b: BuildState) => {
    const arch = activeCasterArchetype(Object.values(b.featPicks).filter((v): v is string => !!v));
    if (!arch) return null;
    const as = b.archetypeSpells ?? { cantrips: [], spells: {} };
    const legacy = !as.cantrips.length
      ? legacyArchetypeCantrips(arch.dedicationId, b, db).filter((id) => archetypeCantripAllowed(arch, id))
      : [];
    return { chips: legacy.length ? legacy : as.cantrips, cap: arch.config.cantrips };
  };

  it('a caster class holding the dedication shows the stored cantrips, not 0 / 2', () => {
    const row = cardRow(wizardWithDedication({ effectChoices: STORED }));
    expect(row?.cap, 'the dedication prepares two cantrips').toBe(2);
    expect(row?.chips).toEqual(['electric-arc', 'detect-magic']);
  });

  it('a pick made in the pool\'s own picker still wins, and nothing stored is still empty', () => {
    const picked = cardRow(wizardWithDedication({ effectChoices: STORED, archetypeSpells: { cantrips: ['light'], spells: {} } }));
    expect(picked?.chips).toEqual(['light']);
    expect(cardRow(wizardWithDedication())?.chips).toEqual([]);
  });

  it('the card is wired to that reader, not to build.archetypeSpells.cantrips alone', () => {
    // Measured at the source, like the Builder.tsx row above: the card cannot be rendered from a .ts
    // test, so a card put back to reading `as.cantrips` raw fails here, which is the mutation that matters.
    const SHARED_SRC = readFileSync('src/builder/shared.tsx', 'utf8');
    expect(SHARED_SRC).toContain('legacyArchetypeCantrips(arch.dedicationId, build, content)');
    expect(SHARED_SRC).toContain('Cantrips (${rowCantrips.length}/${cantripCap})');
    expect(SHARED_SRC).not.toContain('Cantrips (${as.cantrips.length}/${cantripCap})');
    // …and editing while the fallback is showing materialises it first, so the X on a chip removes
    // that cantrip instead of adding it to an empty pool.
    expect(SHARED_SRC).toContain(
      'if (legacyCantrips.length) actions.patch({ archetypeSpells: { ...as, cantrips: legacyCantrips } });',
    );
    // Both handlers go through that materialising writer: the chip's ✕ and the picker. The raw toggle
    // is called exactly once in the whole file — inside the writer — so a handler put back to calling
    // it directly (which re-adds a removed chip while the fallback shows) fails here.
    expect(SHARED_SRC).toContain('onClick={() => writeArchetypeCantrip(id)}');
    expect(SHARED_SRC).toContain('onChange={(v) => v && writeArchetypeCantrip(v)}');
    expect(SHARED_SRC.match(/actions\.toggleArchetypeCantrip\(/g)?.length).toBe(1);
  });
});

describe('"You must select Spellshot Dedication as your 2nd-level class feat"', () => {
  const way = db.classes.gunslinger.subclass!.options.find((o) => o.id === 'way-of-the-spellshot');

  it('the way carries the same field the other forced dedications do', () => {
    expect(way?.requiresFeat).toEqual({ featId: 'spellshot-dedication', level: 2 });
    // The convention, asserted rather than claimed: same shape, same reader, both printings.
    expect(db.classes.barbarian.subclass!.options.find((o) => o.id === 'bloodrager')?.requiresFeat).toEqual({
      featId: 'bloodrager-dedication',
      level: 2,
    });
  });

  it('it is outstanding setup from level 2 until the dedication is taken', () => {
    const named = (b: BuildState, d = db) => setupMissing(b, d).some((s) => s.includes('Spellshot Dedication'));
    expect(named(spellshot(1, { featPicks: {} })), 'level 1 is not there yet').toBe(false);
    expect(named(spellshot(2, { featPicks: {} })), 'level 2 with the slot empty').toBe(true);
    expect(named(spellshot(2)), 'level 2 with the dedication taken').toBe(false);
    // The negative control, in place of mutating the shipped data: strip the field back off the way
    // and the prompt goes silent, so the warning is this row's doing and nothing else's.
    const stripped = {
      ...db,
      classes: {
        ...db.classes,
        gunslinger: {
          ...db.classes.gunslinger,
          subclass: {
            ...db.classes.gunslinger.subclass!,
            options: db.classes.gunslinger.subclass!.options.map((o) =>
              o.id === 'way-of-the-spellshot' ? { ...o, requiresFeat: undefined } : o,
            ),
          },
        },
      },
    } as typeof db;
    expect(named(spellshot(2, { featPicks: {} }), stripped)).toBe(false);
  });

  it('…and it says so while the slot holds something else', () => {
    // Beast Gunner is the pairing the archetype's own Special clause legalises, so this is a real
    // build a player can reach — and it still owes the dedication the way requires.
    const elsewhere = spellshot(2, { featPicks: { '2:class': 'beast-gunner-dedication' } });
    expect(setupMissing(elsewhere, db).some((s) => s.includes('Spellshot Dedication'))).toBe(true);
    // A gunslinger on any other way owes nothing.
    expect(
      setupMissing(spellshot(2, { subclassId: 'way-of-the-drifter', featPicks: {} }), db).some((s) =>
        s.includes('Spellshot Dedication'),
      ),
    ).toBe(false);
  });
});
