import { describe, it, expect } from 'vitest';
import { content, build } from './_content';
import { deriveAc, deriveDefenses, deriveStrikes } from '../src/rules/derive';
import { buildCharacter, deriveBuildFromCharacter, emptyBuild } from '../src/rules/build';
import type { Character, InventoryItem, ModeDef } from '../src/rules/types';

const db = content();

/* ---------------------------------------------------------------------------------------------- *
 * armor-innovation — the innovation IS the suit, so the character owns it from 1st level.
 * ---------------------------------------------------------------------------------------------- */

const inventor = (level: number, over: Record<string, unknown> = {}): Character =>
  build('inventor', level, { subclassId: 'armor-innovation', ...over } as never);

describe('armor-innovation hands the chosen suit over as a worn item', () => {
  // batch 033: armor-innovation#suit-item
  it('a 1st-level armor-innovation inventor wears the Power Suit without buying it', () => {
    // "Your innovation is a cutting-edge suit of medium armor… Choose one of the sets of statistics on
    // Innovation Armor Statistics table for your innovation armor" (AoN innovation-1). The pick lived
    // only in build.inventorArmorStats, where it gated modification options and nothing else, so the
    // inventor's own innovation was never in their inventory and gave them no AC at all.
    const ch = inventor(1, { inventorArmorStats: 'power-suit' });
    const suit = ch.inventory.find((i) => i.itemId === 'power-suit');
    expect(suit).toBeTruthy();
    expect(suit!.worn).toBe(true);
    expect((suit as { grantedBy?: string }).grantedBy).toBe('Armor Innovation');
    // …and it reaches the sheet: the Power Suit's +5 AC is on the AC line, not just in the pack.
    const bare = inventor(1);
    expect(deriveAc(ch, db).value).toBe(deriveAc(bare, db).value + 5);
  });

  // batch 033: armor-innovation#suit-item
  it('armor-innovation grants the Subterfuge Suit when that is the pick, and nothing until one is made', () => {
    const sub = inventor(1, { inventorArmorStats: 'subterfuge-suit' });
    expect(sub.inventory.some((i) => i.itemId === 'subterfuge-suit')).toBe(true);
    expect(sub.inventory.some((i) => i.itemId === 'power-suit')).toBe(false);
    // Print asks the player to choose; with no answer there is no suit (the builder's "Armor base"
    // incomplete-item is what asks for one) — and a weapon inventor never gets armour either.
    expect(inventor(1).inventory.some((i) => /suit/.test(i.itemId))).toBe(false);
    const weapon = build('inventor', 1, { subclassId: 'weapon-innovation', inventorArmorStats: 'power-suit' } as never);
    expect(weapon.inventory.some((i) => i.itemId === 'power-suit')).toBe(false);
  });

  /* MEASURED, and pinned so it is not a surprise later: an EDIT round-trip resolves the unanswered
   * question. `Character.inventor.armorStats` defaults to 'power-suit' (build.ts:8362, for the
   * modification list) and deriveBuildFromCharacter recovers it onto build.inventorArmorStats, so the
   * second build of the same character DOES hand over the Power Suit where the first handed over
   * nothing. That is print's own answer — *"Your innovation IS a cutting-edge suit of medium armor"* —
   * so the recovered default is kept rather than special-cased away; only the first, unanswered build
   * withholds it, and the "Armor base" incomplete-build item is what asks for the pick. */
  // batch 033: armor-innovation#suit-item
  it('armor-innovation resolves the unanswered pick on an edit round-trip', () => {
    const fresh = inventor(5);
    expect(fresh.inventory.some((i) => /suit/.test(i.itemId))).toBe(false);
    const rebuilt = buildCharacter(deriveBuildFromCharacter(fresh, db), db);
    expect(rebuilt.inventory.filter((i) => /suit/.test(i.itemId)).map((i) => i.itemId)).toEqual(['power-suit']);
  });
});

/* ---------------------------------------------------------------------------------------------- *
 * ligneous-instinct / decay-instinct — the Rage ladder's single carrier.
 * ---------------------------------------------------------------------------------------------- */

function ragingBarb(level: number, subclassId: string): Character {
  const inventory: InventoryItem[] = [{ instanceId: 'w1', itemId: 'greatclub', quantity: 1, equipped: true }];
  const ch = buildCharacter(
    {
      ...emptyBuild(),
      name: 't',
      level,
      classId: 'barbarian',
      ancestryId: Object.keys(db.ancestries)[0],
      backgroundId: Object.keys(db.backgrounds)[0],
      keyAbility: 'str',
      subclassId,
      inventory,
    },
    db,
  );
  return { ...ch, classResources: { ...ch.classResources, rage: 1 } };
}

/** The rage rider's number on a NON-agile weapon (the Fist would show the halved value). */
function rageValue(level: number, subclassId: string): string {
  const w = deriveStrikes(ragingBarb(level, subclassId), db).find((s) => /greatclub/i.test(s.name));
  return w?.conditionalDamage?.find((r) => r.note.includes('raging'))?.text ?? '';
}

describe('ligneous-instinct and decay-instinct escalate Rage damage on one carrier', () => {
  // batch 033: ligneous-instinct#wooden-rage-mode
  // batch 033: decay-instinct#rotting-rage-damage-scaling
  it('wooden rage (ligneous-instinct) and rotting rage (decay-instinct) step 6 → 10 → 18 with level', () => {
    // "increase the additional damage from Rage from 2 to 6 … from 6 to 10 … from 10 to 18" — the
    // Specialization Ability steps at Weapon Specialization (7) and Greater Weapon Specialization (15)
    // (AoN instinct-15 Decay / instinct-16 Ligneous). RAGE_DAMAGE in derive.ts is the carrier that
    // reaches all three, and since findings decay-instinct#rotting-rage-damage-scaling and
    // ligneous-instinct#wooden-rage-mode it is the ONLY one: cat-rotting-rage / cat-wooden-rage in
    // src/rules/modes.ts used to carry a second, frozen +6 conditional line beside it, and that
    // duplicate was deleted in this batch. This pins the surviving ladder.
    for (const inst of ['ligneous-instinct', 'decay-instinct']) {
      expect(rageValue(1, inst)).toMatch(/\b6\b/);
      expect(rageValue(7, inst)).toMatch(/\b10\b/);
      expect(rageValue(15, inst)).toMatch(/\b18\b/);
    }
  });
});

/* ---------------------------------------------------------------------------------------------- *
 * fey-eidolon — the granted Magical Understudy feat (the row is DATA STILL NEEDED, patched here).
 * ---------------------------------------------------------------------------------------------- */

describe('fey-eidolon grants Magical Understudy through the existing subclass-option lane', () => {
  // batch 033: fey-eidolon#magical-understudy
  it("fey-eidolon's grantedFeats reach the feat list and open the eidolon's two cantrip slots", async () => {
    // "Your eidolon gains the Magical Understudy summoner feat, despite not meeting the prerequisite
    // level" (AoN eidolon-8). The downstream lanes are already built and idle — eidolonCantripSlots
    // counts feats[].eidolonCantrips — so the whole gap is the grant itself.
    const { eidolonCantripSlots } = await import('../src/rules/companions');
    /* Baseline: with NOTHING granted the eidolon has no cantrips. Asserted against a copy with
     * `grantedFeats` STRIPPED, never against the shipped data — the row this test was written
     * beside has since been applied, and a patched-vs-shipped delta flips the moment that happens
     * (it did: this line read `toBe(0)` against `db` and the suite returned 2). */
    const optionWith = (grantedFeats?: string[]) => ({
      ...db,
      classes: {
        ...db.classes,
        summoner: {
          ...db.classes.summoner,
          subclass: {
            ...db.classes.summoner.subclass!,
            options: db.classes.summoner.subclass!.options.map((o) =>
              o.id === 'fey-eidolon' ? { ...o, grantedFeats } : o,
            ),
          },
        },
      },
    } as typeof db);
    const summonerOn = (c: typeof db) =>
      buildCharacter(
        {
          ...emptyBuild(),
          name: 't',
          level: 1,
          classId: 'summoner',
          ancestryId: Object.keys(db.ancestries)[0],
          backgroundId: Object.keys(db.backgrounds)[0],
          keyAbility: 'cha',
          subclassId: 'fey-eidolon',
        },
        c,
      );
    const stripped = optionWith(undefined);
    // batch 033: fey-eidolon#magical-understudy
    expect(summonerOn(stripped).feats.some((f) => f.featId === 'magical-understudy')).toBe(false);
    // batch 033: fey-eidolon#magical-understudy
    expect(eidolonCantripSlots(summonerOn(stripped), stripped)).toBe(0);
    /* And WITH the grant, the READER chain (grantOptions → grantedFeats → eidolonCantripSlots) —
     * the half the engine owes — opens the two slots. */
    const patched = optionWith(['magical-understudy']);
    const ch = summonerOn(patched);
    // batch 033: fey-eidolon#magical-understudy
    expect(ch.feats.some((f) => f.featId === 'magical-understudy')).toBe(true);
    // batch 033: fey-eidolon#magical-understudy
    expect(eidolonCantripSlots(ch, patched)).toBe(2);
  });
});

/* ---------------------------------------------------------------------------------------------- *
 * harmonic-oscillator — the Overdrive rider on the modification's resistance.
 * ---------------------------------------------------------------------------------------------- */

describe('harmonic-oscillator resistance rises while overdriven', () => {
  // batch 033: harmonic-oscillator#overdrive-bonus
  it('harmonic-oscillator stands at 3 + half level and a mode can lift it to 5 + half level', () => {
    // "You gain resistance equal to 3 + half your level to force and sonic damage. When under the
    // effects of Overdrive, the resistance increases by 2." (AoN innovation-5) — the standing half is
    // modelled, the Overdrive branch is not.
    const ch = inventor(10, { inventorArmorStats: 'power-suit', inventorModifications: { initial: 'harmonic-oscillator' } });
    const standing = deriveDefenses(ch, db).resistances;
    expect(standing.find((r) => r.type === 'force')?.value).toBe(8); // 3 + 10/2
    expect(standing.find((r) => r.type === 'sonic')?.value).toBe(8);
    /* The mode does not exist yet — it is the row named in DATA STILL NEEDED — so it is patched in
     * here rather than read from the database, which is what proves the READER is the missing half's
     * only dependency: ModeDef.resistances already reaches deriveDefenses, and the no-stacking merge
     * takes the higher of the two rather than adding them. */
    const overdriven: ModeDef = {
      id: 'cat-harmonic-oscillator-overdrive',
      name: 'Harmonic Oscillator (Overdriven)',
      modifiers: [],
      feats: ['harmonic-oscillator'],
      resistances: [
        { type: 'force', value: '5+floor(@actor.level/2)' },
        { type: 'sonic', value: '5+floor(@actor.level/2)' },
      ],
    } as ModeDef;
    const live = deriveDefenses({ ...ch, activeModes: [overdriven] } as Character, db).resistances;
    expect(live.find((r) => r.type === 'force')?.value).toBe(10); // 5 + 10/2, not 8 + 10
    expect(live.find((r) => r.type === 'sonic')?.value).toBe(10);
  });
});
