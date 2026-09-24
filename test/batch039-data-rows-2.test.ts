import { describe, it, expect } from 'vitest';
import { build, content, mainCasting } from './_content';
import { recordMarkersFor } from '../src/rules/explain';
import { ownedFeatureIds } from '../src/rules/derive';
import { resourcesForCharacter } from '../src/rules/classResources';
import { modeRelevant } from '../src/rules/modes';
import type { Character } from '../src/rules/types';

/**
 * Batch 039, data-rows chunk 2: the magus WG-comparison findings whose whole fix is authored data
 * (work/.b039-rows-data-rows-2.json + work/.b039-created-desc-data-rows-2.json).
 *
 * Every assertion reads the SHIPPED content through `content()`, so this file is red until the driver
 * applies the rows. That is deliberate: it pins the row, and a regeneration that drops it fails here.
 */
const db = content();

const withFeat = (classId: string, level: number, featId: string, over = {}): Character =>
  ({ ...build(classId, level, over), feats: [{ featId, level, category: 'class' as const }] }) as Character;
const magus = (level: number, subclassId: string) => build('magus', level, { subclassId, keyAbility: 'str' });
const option = (id: string) => db.classes['magus']!.subclass!.options.find((o) => o.id === id)!;
const book = (c: Character) => Object.values(mainCasting(c)?.spellbook ?? {}).flat();
const marksOnCascade = (c: Character) => recordMarkersFor(c, db, 'action', 'arcane-cascade');

describe('student-of-the-staff: the Spellstrike clause (feat-9060)', () => {
  // batch 039: student-of-the-staff#spellstrike-clause
  it('student-of-the-staff: the description prints the Spellstrike parenthetical and "you can apply"', () => {
    const d = db.feats['student-of-the-staff']!.description;
    expect(d).toContain('(If you use the critical specialization on a Spellstrike, the spell still affects the target even if you pushed the target out of reach.)');
    expect(d).toContain('you can apply the critical specialization effect of the club group');
  });

  // batch 039: student-of-the-staff#spellstrike-clause
  it('student-of-the-staff: a magus with the feat sees the rider on the Spellstrike action row', () => {
    const marks = recordMarkersFor(withFeat('magus', 4, 'student-of-the-staff', { subclassId: 'twisting-tree' }), db, 'action', 'spellstrike');
    expect(marks.find((m) => m.sourceId === 'student-of-the-staff')?.note).toMatch(/pushed the target out of reach/);
  });
});

describe('burning-cascade: the 5-foot emanation on Arcane Cascade (feat-9051)', () => {
  // batch 039: burning-cascade
  it('burning-cascade: a magus with the feat sees the emanation damage on the Arcane Cascade action row', () => {
    const note = marksOnCascade(withFeat('magus', 4, 'burning-cascade')).find((m) => m.sourceId === 'burning-cascade')?.note;
    expect(note).toMatch(/each enemy in a 5-foot emanation takes damage equal to the extra damage from Arcane Cascade/);
    expect(note).toMatch(/immune to further uses of Burning Cascade for 1 minute/);
  });

  // batch 039: burning-cascade
  it('burning-cascade: is a passive feat and its description has no scraped header', () => {
    const f = db.feats['burning-cascade']!;
    expect(f.actionCost).toEqual({ type: 'passive' });
    expect(f.description.startsWith('Energy flares out around you')).toBe(true);
    expect(f.description).not.toMatch(/Source Impossible Magic/);
  });
});

describe('hasted-assault: the Impossible Magic printing (feat-9084, spell-2880)', () => {
  // batch 039: hasted-assault#prerequisites
  it('hasted-assault: the feat has no prerequisite and no legacy focus-pool sentence', () => {
    const f = db.feats['hasted-assault']!;
    expect(f.prerequisites ?? []).toEqual([]);
    expect(f.description).not.toMatch(/focus pool/i);
  });

  // batch 039: hasted-assault#spell-body
  it('hasted-assault: the spell lets the extra action Stride or Strike and prints the timing sentence', () => {
    const d = db.spells['hasted-assault']!.description;
    expect(d).toContain('for only Stride and Strike actions');
    expect(d).toMatch(/As normal, you don.t gain an action on the turn you cast this spell/);
  });
});

describe('magus: the hybrid studies\' printed studious spells', () => {
  // batch 039: magus#studious-spells-laughing-shadow
  it('magus: Laughing Shadow adds Ghostly Weapon at 11th (hybrid-study-11), not Shift Blame', () => {
    const b = book(magus(11, 'laughing-shadow'));
    expect(b).toContain('ghostly-weapon');
    expect(b).not.toContain('shift-blame');
  });

  // batch 039: magus#studious-spells-starlit-span
  it('magus: Starlit Span adds Telekinetic Maneuver at 7th (hybrid-study-13), not Darkvision', () => {
    const b = book(magus(7, 'starlit-span'));
    expect(b).toContain('telekinetic-maneuver');
    expect(b).not.toContain('darkvision');
  });

  // batch 039: magus#studious-spells-twisting-tree
  it('magus: Twisting Tree adds Oaken Resilience at 7th (hybrid-study-14), not Embed Message', () => {
    const b = book(magus(7, 'twisting-tree'));
    expect(b).toContain('oaken-resilience');
    expect(b).not.toContain('embed-message');
  });
});

describe('magus: Volatile Spark grants Reloading Cascade (hybrid-study-16)', () => {
  // batch 039: magus#volatile-spark-reloading-cascade
  it('magus: the Reloading Cascade action exists as a single action with the printed text', () => {
    const a = db.actions['reloading-cascade'];
    expect(a).toBeTruthy();
    expect(a!.actionCost).toEqual({ type: 'actions', value: 1 });
    expect(a!.description).toBe('You use Arcane Cascade and Interact to reload a firearm.');
  });

  // batch 039: magus#volatile-spark-reloading-cascade
  it('magus: a Volatile Spark magus owns a feature that grants Reloading Cascade', () => {
    const c = magus(1, 'volatile-spark');
    const granters = [...ownedFeatureIds(c, db)].filter((id) => db.classFeatures[id]?.grantsActions?.includes('reloading-cascade'));
    expect(granters).toEqual(['volatile-spark']);
  });
});

describe('magus: the Starlit Span and Twisting Tree stance riders (hybrid-study-13, -14)', () => {
  // batch 039: magus#starlit-span-description
  it('magus: Starlit Span prints the lesser-cover rider and drops the legacy range sentence', () => {
    for (const d of [option('starlit-span').description, db.classFeatures['starlit-span']!.description]) {
      expect(d).toContain("While you're in Arcane Cascade stance, your ranged attacks ignore any lesser cover your allies would grant to your target.");
      expect(d).toContain('This overrides the actual range of the spell.');
      expect(d).not.toMatch(/even if its range is shorter/);
    }
  });

  // batch 039: magus#starlit-span-description
  it('magus: a Starlit Span magus sees the lesser-cover rider on the Arcane Cascade action row', () => {
    expect(marksOnCascade(magus(1, 'starlit-span')).find((m) => m.sourceId === 'starlit-span')?.note).toMatch(/ignore any lesser cover/);
  });

  // batch 039: magus#twisting-tree-description
  it('magus: Twisting Tree prints the once-per-round free Interact, not the legacy Strike-time grip change', () => {
    for (const d of [option('twisting-tree').description, db.classFeatures['twisting-tree']!.description]) {
      expect(d).toContain("While you're in Arcane Cascade stance, once per round you can Interact to change your grip on a staff as a free action.");
      expect(d).not.toMatch(/Interact or Release/);
      expect(d).not.toMatch(/end of your turn/);
    }
  });

  // batch 039: magus#twisting-tree-description
  it('magus: a Twisting Tree magus sees the grip rider on the Arcane Cascade action row', () => {
    expect(marksOnCascade(magus(1, 'twisting-tree')).find((m) => m.sourceId === 'twisting-tree')?.note).toMatch(/once per round you can Interact/);
  });
});

/* Gap stage: class-feature-1260 prints ONE stance ("You can enter a special stance to blend magic into
 * your attacks and defend against spells"). The stance chip is its carrier; the reader-less class
 * resource toggle and the unlinked cat-arcane-cascade mode are gone. Green on shipped content (code fix). */
describe('magus: Arcane Cascade has one toggle, the stance (class-feature-1260)', () => {
  // batch 039: magus#arcane-cascade-toggles
  it('magus: a built magus has no Arcane Cascade class resource and no Arcane Cascade mode, only the stance', () => {
    const c = magus(7, 'inexorable-iron');
    const featIds = new Set((c.feats ?? []).map((f) => f.featId));
    // batch 039: magus#arcane-cascade-toggles
    expect(resourcesForCharacter(c.classId, featIds).map((r) => r.id)).not.toContain('arcane-cascade');
    const modes = Object.values(db.modes).filter((m) => modeRelevant(m, c.classId, c.ancestryId, featIds));
    // batch 039: magus#arcane-cascade-toggles
    expect(modes.filter((m) => /arcane cascade/i.test(m.name)).map((m) => m.id)).toEqual([]);
    expect(db.modes['cat-arcane-cascade']).toBeUndefined();
    expect(db.stances!['arcane-cascade']).toBeTruthy();
  });
});
