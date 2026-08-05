import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { ownedFeatureIds } from '../src/rules/derive';
import { markersFor, RECORD_MARKERS } from '../src/rules/situationalBonuses';

/**
 * An oracle's mystery brings its curse, and the curse tells you what being cursebound costs you.
 *
 * All 11 curse records were reachable by NOTHING: not in any class's `features`, not subclass options
 * themselves, so ownedFeatureIds had no route to them. Anything authored on a curse — a field, a
 * star, a marker — rendered for nobody, which is why the class-feature audit's adversaries kept
 * dismissing real findings about them.
 *
 * The mystery→curse mapping is NOT inferred from ids. Each mystery's own AoN entry names its curse
 * under an "Oracular Curse" heading, and the curse text is actively misleading: Curse of Inevitable
 * Rot says "time" and belongs to BLIGHT.
 */
const db = content();
const MYSTERIES = db.classes.oracle.subclass!.options;
const curseIds = Object.keys(db.classFeatures).filter((id) => id.startsWith('curse-of-'));

describe('oracle curses reach the sheet', () => {
  it('every mystery hands over exactly one curse, and every curse has a mystery', () => {
    const handed = MYSTERIES.flatMap((o) => o.featureIds ?? []);
    expect(handed.length).toBe(MYSTERIES.length);
    expect(new Set(handed).size, 'two mysteries share a curse').toBe(handed.length);
    expect([...handed].sort()).toEqual([...curseIds].sort());
  });

  it('every named curse is a real class feature', () => {
    for (const o of MYSTERIES) {
      for (const id of o.featureIds ?? []) expect(db.classFeatures[id], `${o.id} names ${id}`).toBeDefined();
    }
  });

  it('choosing a mystery owns its curse — and only its own', () => {
    const [first, second] = MYSTERIES;
    const ch = build('oracle', 5, { subclassId: first.id });
    const owned = ownedFeatureIds(ch, db);
    expect(owned.has(first.featureIds![0]), `${first.id} did not bring its curse`).toBe(true);
    expect(owned.has(second.featureIds![0]), `${first.id} brought ${second.id}'s curse`).toBe(false);
  });

  it('the curse marks the cursebound condition, so the player sees what it costs', () => {
    const ch = build('oracle', 5, { subclassId: MYSTERIES[0].id });
    const marks = markersFor([...ownedFeatureIds(ch, db)], 'condition', 'cursebound');
    expect(marks.length, 'nothing marks cursebound for this oracle').toBeGreaterThan(0);
    expect(marks[0].note).toBeTruthy();
  });

  it('every curse carries a cursebound mark with real text', () => {
    for (const id of curseIds) {
      const marks = RECORD_MARKERS[id];
      expect(marks, `${id} marks nothing`).toBeDefined();
      expect(marks.every((m) => m.on === 'condition' && m.id === 'cursebound')).toBe(true);
      expect(marks.every((m) => (m.note ?? '').length > 20), `${id}'s note says too little`).toBe(true);
    }
  });

  it('a non-oracle is marked by no curse at all', () => {
    const ch = build('fighter', 5, {});
    expect(markersFor([...ownedFeatureIds(ch, db)], 'condition', 'cursebound')).toEqual([]);
  });

  it('Blight takes Inevitable Rot, whose own text misleadingly says "time"', () => {
    // The one pairing a name- or text-based guess gets wrong. Pinned because it is the reason the
    // mapping was taken from AoN rather than inferred.
    const blight = MYSTERIES.find((o) => o.id === 'blight');
    expect(blight?.featureIds).toEqual(['curse-of-inevitable-rot']);
    const time = MYSTERIES.find((o) => o.id === 'time');
    expect(time?.featureIds).toEqual(['curse-of-turbulent-moments']);
  });
});
