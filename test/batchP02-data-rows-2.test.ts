import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { build, content } from './_content';
import { recordMarkersFor } from '../src/rules/explain';
import { deriveStrikes, mapNotesFor, mapStepFor } from '../src/rules/derive';
import { buildCharacter, deriveBuildFromCharacter } from '../src/rules/build';
import type { Character, ContentDatabase } from '../src/rules/types';

/**
 * Print batch P02, data-rows chunk 2: the magus Impossible Magic / Tian Xia findings whose whole fix is
 * authored data (work/.bP02-rows-data-rows-2.json).
 *
 * Every assertion reads the SHIPPED content through `content()`, so this file is red until the driver
 * applies the rows. That is deliberate: it pins the row, and a regeneration that drops it fails here.
 * Each case builds a real character and reads the surface the player sees (the mark on an action or
 * feat entry, the derived Strike, the MAP breakdown), not just the stored field.
 */
const db = content();

const magus = (level: number, subclassId: string): Character => build('magus', level, { subclassId, keyAbility: 'str' });
const withFeat = (subclassId: string, level: number, featId: string): Character =>
  ({ ...magus(level, subclassId), feats: [{ featId, level, category: 'class' as const }] }) as Character;
const noteFrom = (c: Character, on: 'action' | 'feature', id: string, source: string) =>
  recordMarkersFor(c, db, on, id).find((m) => m.sourceId === source)?.note;

describe('sparkling-targe: Shield Block against magic (hybrid-study-12)', () => {
  // batch P02: sparkling-targe#shield-block-magic
  it('sparkling-targe: a Sparkling Targe magus sees the non-physical trigger and Hardness rider on Shield Block (both surfaces)', () => {
    const c = magus(1, 'sparkling-targe');
    for (const on of ['feature', 'action'] as const) {
      const note = noteFrom(c, on, 'shield-block', 'sparkling-targe');
      // batch P02: sparkling-targe#shield-block-magic
      expect(note).toMatch(/can trigger your Shield Block reaction, even if the damage isn't physical/);
      expect(note).toMatch(/increase your shield's Hardness by an amount equal to the resistance you have from Arcane Cascade/);
    }
  });

  // batch P02: sparkling-targe#shield-block-magic
  it('sparkling-targe: a magus of another study gets no Shield Block mark from it', () => {
    expect(noteFrom(magus(1, 'starlit-span'), 'action', 'shield-block', 'sparkling-targe')).toBeUndefined();
  });
});

describe('starlit-span: the ranged Spellstrike (hybrid-study-13)', () => {
  // batch P02: starlit-span#spellstrike
  it('starlit-span: a Starlit Span magus sees the ranged Spellstrike rider and keeps the lesser-cover rider', () => {
    const c = magus(1, 'starlit-span');
    expect(noteFrom(c, 'action', 'spellstrike', 'starlit-span')).toMatch(/ranged weapon or ranged unarmed Strike, as long as the target is within the first range increment.*This overrides the actual range of the spell\./);
    // batch P02: starlit-span#spellstrike
    expect(noteFrom(c, 'action', 'arcane-cascade', 'starlit-span')).toMatch(/ignore any lesser cover your allies would grant/);
  });
});

describe('volatile-spark: the firearm Spellstrike (hybrid-study-16)', () => {
  // batch P02: volatile-spark#spellstrike
  it('volatile-spark: a Volatile Spark magus sees the firearm range and concussive-resistance rider on Spellstrike', () => {
    const note = noteFrom(magus(1, 'volatile-spark'), 'action', 'spellstrike', 'volatile-spark');
    expect(note).toMatch(/ranged firearm Strike, as long as the target is within the first range increment of your firearm/);
    // batch P02: volatile-spark#spellstrike
    expect(note).toMatch(/concussive trait.*weakest resistance.*the spell's damage type, piercing, or bludgeoning/);
  });
});

describe('unfurling-brocade: the qi-infused fabric (hybrid-study-8)', () => {
  const fabric = () => deriveStrikes(magus(1, 'unfurling-brocade'), db).filter((s) => s.name.startsWith('Qi-Infused Fabric'));

  // batch P02: unfurling-brocade#two-handed-die
  it('unfurling-brocade: the fabric is a two-handed d6 bladed scarf with a one-handed d4 option', () => {
    const rows = fabric();
    // The default (two-handed bladed-scarf) grip keeps the shipped name, so older saves drop their stored copy.
    const two = rows.find((s) => s.name === 'Qi-Infused Fabric');
    const one = rows.find((s) => s.name === 'Qi-Infused Fabric (one hand)');
    // batch P02: unfurling-brocade#two-handed-die
    expect(two?.damage).toMatch(/^1d6\b/);
    expect(one?.damage).toMatch(/^1d4\b/);
    for (const s of [two!, one!]) expect(s.traits).toEqual(expect.arrayContaining(['disarm', 'finesse', 'reach', 'sweep', 'trip']));
  });

  // batch P02: unfurling-brocade#two-handed-die
  it('unfurling-brocade: each grip is granted once and survives a build round-trip without duplicating', () => {
    const names = (magus(5, 'unfurling-brocade').naturalAttacks ?? []).map((n) => n.name);
    expect(names.filter((n) => n === 'Qi-Infused Fabric')).toHaveLength(1);
    expect(names.filter((n) => n === 'Qi-Infused Fabric (one hand)')).toHaveLength(1);
  });

  /*
   * A magus saved BEFORE the row stores the old grant ('Qi-Infused Fabric', die '1d4'). deriveBuildFromCharacter
   * keeps a stored attack as a manual one unless sameNaturalAttack matches a live grant by name or by an
   * identical die string, and '1d4' never equals 'd4' - so a renamed default grip stranded the old row and the
   * sheet showed three fabric Strikes, one reading "11d4+1 S" (measured by the P02 verifier). Both states are
   * PATCHED IN MEMORY here (the old single row, then the spec's two rows), so this holds before and after the
   * driver applies the row.
   */
  // batch P02: unfurling-brocade#two-handed-die
  it('unfurling-brocade: a magus saved with the old single fabric row rebuilds to exactly the two printed grips', () => {
    const withStrikes = (gs: unknown[]): ContentDatabase => ({
      ...db,
      classFeatures: { ...db.classFeatures, 'unfurling-brocade': { ...db.classFeatures['unfurling-brocade']!, grantedStrikes: gs } },
    }) as ContentDatabase;
    const traits = ['disarm', 'finesse', 'reach', 'sweep', 'trip'];
    const before = withStrikes([{ name: 'Qi-Infused Fabric', die: '1d4', damageType: 'slashing', traits, group: 'flail' }]);
    const after = withStrikes([
      { name: 'Qi-Infused Fabric', die: 'd6', damageType: 'slashing', traits, group: 'flail' },
      { name: 'Qi-Infused Fabric (one hand)', die: 'd4', damageType: 'slashing', traits, group: 'flail' },
    ]);
    const saved = buildCharacter(deriveBuildFromCharacter(magus(3, 'unfurling-brocade'), before), before);
    const rebuilt = buildCharacter(deriveBuildFromCharacter(saved, after), after);
    const rows = deriveStrikes(rebuilt, after).filter((s) => s.name.startsWith('Qi-Infused Fabric'));
    // batch P02: unfurling-brocade#two-handed-die
    expect(rows.map((s) => s.name).sort()).toEqual(['Qi-Infused Fabric', 'Qi-Infused Fabric (one hand)']);
    expect(rows.find((s) => s.name === 'Qi-Infused Fabric')?.damage).toMatch(/^1d6\b/);
    expect(rows.every((s) => !/^11d/.test(s.damage))).toBe(true);
  });

  // batch P02: unfurling-brocade#cascade-tricks
  it('unfurling-brocade: the Arcane Cascade tricks sit on Disarm, Grapple and Trip', () => {
    const c = magus(1, 'unfurling-brocade');
    expect(noteFrom(c, 'action', 'disarm', 'unfurling-brocade')).toMatch(/critically succeed.*flick your fabric.*fall to the ground in your space/);
    // batch P02: unfurling-brocade#cascade-tricks
    expect(noteFrom(c, 'action', 'grapple', 'unfurling-brocade')).toMatch(/your fabric gains the grapple trait.*pull the creature 5 feet toward you/);
    expect(noteFrom(c, 'action', 'trip', 'unfurling-brocade')).toMatch(/two sizes larger than you instead of one/);
  });
});

describe('arcane-fists: the d6 fist and the arcane trait (feat-9044)', () => {
  // batch P02: arcane-fists#fist-die-and-arcane-trait
  it('arcane-fists: a magus with the feat strikes with a d6 fist that carries the arcane trait', () => {
    const fist = deriveStrikes(withFeat('inexorable-iron', 1, 'arcane-fists'), db).find((s) => s.name === 'Fist');
    // batch P02: arcane-fists#fist-die-and-arcane-trait
    expect(fist?.damage).toMatch(/^1d6\b/);
    expect(fist?.traits).toContain('arcane');
  });

  // batch P02: arcane-fists#fist-die-and-arcane-trait
  it('arcane-fists: without the feat the magus fist stays 1d4 and has no arcane trait', () => {
    const fist = deriveStrikes(magus(1, 'inexorable-iron'), db).find((s) => s.name === 'Fist');
    expect(fist?.damage).toMatch(/^1d4\b/);
    expect(fist?.traits).not.toContain('arcane');
  });
});

describe('recharging-flurry: its own multiple attack penalty (feat-9056)', () => {
  // batch P02: recharging-flurry#map
  it('recharging-flurry: the MAP breakdown lists -4/-8 (agile -3/-6) as an unapplied alternative, and the row stays -5/-10', () => {
    const c = withFeat('twofold-tine', 4, 'recharging-flurry');
    const plain = mapNotesFor(c, db, []).find((n) => n.sourceId === 'recharging-flurry');
    const agile = mapNotesFor(c, db, ['agile']).find((n) => n.sourceId === 'recharging-flurry');
    // batch P02: recharging-flurry#map
    expect(plain).toMatchObject({ steps: [4, 8], applied: false });
    expect(plain?.when).toMatch(/creature you haven't attacked yet this turn/);
    expect(agile).toMatchObject({ steps: [3, 6], applied: false });
    expect(mapStepFor(c, db, [])).toBe(5);
    expect(mapStepFor(c, db, ['agile'])).toBe(4);
  });
});

describe('the Impossible Magic printings of five magus feats (R12: the newest printing wins, whole)', () => {
  const d = (id: string) => db.feats[id]!.description;

  // batch P02: maguss-analysis#recharge-unconditional
  it('maguss-analysis: the Spellstrike recharge is unconditional (feat-9045)', () => {
    expect(d('maguss-analysis')).toContain('Attempt a check to Recall Knowledge about a creature, then recharge your Spellstrike.');
    // batch P02: maguss-analysis#recharge-unconditional
    expect(d('maguss-analysis')).not.toMatch(/If your check is successful/);
  });

  // batch P02: spirit-sheath#description
  it('spirit-sheath: holds up to 1 Bulk worth of weapons and counteracts at half your level (feat-9050)', () => {
    expect(d('spirit-sheath')).toContain('A spirit sheath can hold up to 1 Bulk worth of weapons.');
    expect(d('spirit-sheath')).toContain('the counteract rank is half your level rounded up');
    // batch P02: spirit-sheath#description
    expect(d('spirit-sheath')).not.toMatch(/only one weapon at a time|counteract rank of 1/);
  });

  // batch P02: devastating-spellstrike
  it('devastating-spellstrike: needs only a charged Spellstrike and deals 2/3/4/5 in a 5-foot emanation (feat-9052)', () => {
    expect(d('devastating-spellstrike').startsWith('**Requirements** Your Spellstrike is charged.')).toBe(true);
    expect(d('devastating-spellstrike')).toContain('Enemies in a 5-foot emanation around the target (not including the target) take 2 damage');
    // batch P02: devastating-spellstrike
    expect(d('devastating-spellstrike')).toContain('This damage increases to 3 at 9th level, 4 at 14th level, and 5 at 19th level.');
    expect(d('devastating-spellstrike')).not.toMatch(/splash damage equal to 2 \+/);
  });

  // batch P02: distracting-spellstrike#description
  it('distracting-spellstrike: requires a charged Spellstrike, no illusion trait, and prints the Deception bonus (feat-9053)', () => {
    expect(d('distracting-spellstrike').startsWith('**Requirements** You have a hand free, and your Spellstrike is charged.')).toBe(true);
    expect(d('distracting-spellstrike')).toContain('The Feint gains the arcane and visual traits');
    // batch P02: distracting-spellstrike#description
    expect(d('distracting-spellstrike')).toContain('you gain a status bonus to your Deception check equal to your extra damage from Arcane Cascade');
    expect(d('distracting-spellstrike')).not.toMatch(/illusion|feint traits=/);
  });

  // batch P02: emergency-targe#description
  it('emergency-targe: triggers on any Strike or spell attack from an enemy you are aware of (feat-9054)', () => {
    expect(d('emergency-targe').startsWith("**Trigger** An enemy you're aware of hits you with a Strike or a spell attack")).toBe(true);
    // batch P02: emergency-targe#description
    expect(d('emergency-targe')).not.toMatch(/melee Strike|melee spell attack/);
  });
});

/*
 * The MECHANISM, independent of the driver: the spec's own rows are patched into an in-memory copy of the
 * content (never the shipped files), and the same readers the sheet uses turn them into the surface. The
 * cases above pin the shipped data and are red until the rows land; these hold before and after, so a
 * reader that stops honouring a row fails here even while the shipped data is unchanged.
 */
describe('P02 data-rows-2 rows patched in memory reach a built magus', () => {
  type Row = { category: string; id: string; field: string; value: unknown };
  const spec = JSON.parse(readFileSync('work/.bP02-rows-data-rows-2.json', 'utf8')) as { findings: { backfillRows: Row[] }[] };
  const patched = (() => {
    const out = { ...db } as unknown as Record<string, Record<string, Record<string, unknown>>>;
    for (const r of spec.findings.flatMap((f) => f.backfillRows)) {
      out[r.category] = { ...out[r.category] };
      out[r.category][r.id] = { ...out[r.category][r.id], [r.field]: structuredClone(r.value) };
    }
    return out as unknown as ContentDatabase;
  })();
  const markFrom = (c: Character, on: 'action' | 'feature', id: string, source: string) =>
    recordMarkersFor(c, patched, on, id).find((m) => m.sourceId === source)?.note;

  // batch P02: sparkling-targe#shield-block-magic
  it('sparkling-targe, starlit-span, volatile-spark, unfurling-brocade: each recordMarks row marks the action it changes', () => {
    // batch P02: sparkling-targe#shield-block-magic
    expect(markFrom(magus(1, 'sparkling-targe'), 'feature', 'shield-block', 'sparkling-targe')).toMatch(/even if the damage isn't physical/);
    expect(markFrom(magus(1, 'sparkling-targe'), 'action', 'shield-block', 'sparkling-targe')).toMatch(/Hardness/);
    // batch P02: starlit-span#spellstrike
    expect(markFrom(magus(1, 'starlit-span'), 'action', 'spellstrike', 'starlit-span')).toMatch(/first range increment/);
    expect(markFrom(magus(1, 'starlit-span'), 'action', 'arcane-cascade', 'starlit-span')).toMatch(/lesser cover/);
    // batch P02: volatile-spark#spellstrike
    expect(markFrom(magus(1, 'volatile-spark'), 'action', 'spellstrike', 'volatile-spark')).toMatch(/concussive/);
    // batch P02: unfurling-brocade#cascade-tricks
    for (const a of ['disarm', 'grapple', 'trip']) expect(markFrom(magus(1, 'unfurling-brocade'), 'action', a, 'unfurling-brocade')).toMatch(/Arcane Cascade/);
    expect(markFrom(magus(1, 'twisting-tree'), 'action', 'spellstrike', 'starlit-span')).toBeUndefined();
  });

  // batch P02: arcane-fists#fist-die-and-arcane-trait
  it('arcane-fists and recharging-flurry: the unarmedTraits and mapReduction rows reach the Strike and its MAP breakdown', () => {
    const fist = deriveStrikes(withFeat('inexorable-iron', 1, 'arcane-fists'), patched).find((s) => s.name === 'Fist');
    // batch P02: arcane-fists#fist-die-and-arcane-trait
    expect(fist?.damage).toMatch(/^1d6\b/);
    expect(fist?.traits).toContain('arcane');
    const rf = withFeat('twofold-tine', 4, 'recharging-flurry');
    // batch P02: recharging-flurry#map
    expect(mapNotesFor(rf, patched, ['agile']).find((n) => n.sourceId === 'recharging-flurry')).toMatchObject({ steps: [3, 6], applied: false });
    expect(mapStepFor(rf, patched, [])).toBe(5);
  });

  // batch P02: unfurling-brocade#two-handed-die
  it('unfurling-brocade: the grantedStrikes row derives a 1d6 default grip and a 1d4 one-hand grip, never 11dN', () => {
    const rows = deriveStrikes(buildCharacter(deriveBuildFromCharacter(magus(1, 'unfurling-brocade'), patched), patched), patched)
      .filter((s) => s.name.startsWith('Qi-Infused Fabric'));
    // batch P02: unfurling-brocade#two-handed-die
    expect(rows.map((s) => `${s.name} ${s.damage.split(' ')[0]}`).sort()).toEqual(['Qi-Infused Fabric (one hand) 1d4+1', 'Qi-Infused Fabric 1d6+1']);
  });
});
