import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { applyContentToggles, levelGrants, buildCharacter, emptyBuild, commanderTacticOptions } from '../src/rules/build';

/** Verifies the AoN content additions landed and the Mythic/Kingmaker campaign toggles gate content. */
describe('campaign content toggles + new content', () => {
  const c = content();
  const empty = new Set<string>();
  const traited = (e: { traits?: string[] }) => e.traits ?? [];
  const km = (e: { source?: { book?: string } }) => /kingmaker/i.test(e.source?.book ?? '');

  it('shipped the newly-added AoN content', () => {
    // Versatile heritages (Nephilim, Dhampir, …) ship as heritages — NOT as broken 0-HP "ancestries".
    expect(c.heritages['nephilim']).toBeTruthy();
    expect(c.ancestries['aon-nephilim']).toBeUndefined();
    expect(c.feats['aon-wombat-style']?.description).toBeTruthy();
    expect(c.spells['aon-detect-alignment']).toBeTruthy();
    expect(Object.keys(c.languages).length).toBeGreaterThan(110);
    expect(Object.values(c.items).some((i) => i.id.startsWith('aon-'))).toBe(true);
    expect(Object.values(c.actions).some(km)).toBe(true);
    expect(Object.values(c.conditions).some(km)).toBe(true);
  });

  it('applied the content fixes', () => {
    expect(Object.values(c.items).find((i) => i.name === 'Adamantine Chunk')?.level).toBe(8);
    expect(Object.values(c.feats).find((f) => f.name === 'Uplifting Winds')?.level).toBe(16);
    expect(Object.values(c.languages).find((l) => l.name === 'Aklo')?.rarity).toBe('uncommon');
  });

  it('Mythic OFF hides every mythic-trait entry; ON restores them', () => {
    const mythic = Object.values(c.feats).filter((f) => traited(f).includes('mythic')).length;
    expect(mythic).toBeGreaterThan(100);
    const off = applyContentToggles(c, { mythicEnabled: false, kingmakerEnabled: true }, empty);
    expect(Object.values(off.feats).filter((f) => traited(f).includes('mythic')).length).toBe(0);
    const on = applyContentToggles(c, { mythicEnabled: true, kingmakerEnabled: true }, empty);
    expect(Object.values(on.feats).filter((f) => traited(f).includes('mythic')).length).toBe(mythic);
  });

  it('Kingmaker OFF hides its actions + conditions', () => {
    expect(Object.values(c.actions).filter(km).length).toBeGreaterThan(50);
    const off = applyContentToggles(c, { mythicEnabled: true, kingmakerEnabled: false }, empty);
    expect(Object.values(off.actions).filter(km).length).toBe(0);
    expect(Object.values(off.conditions).filter(km).length).toBe(0);
  });

  it('Mythic enabled grants a mythic feat slot at every even level (2-20)', () => {
    const slots = (lvl: number, on: boolean) =>
      levelGrants(lvl, 'fighter', c, null, undefined, null, null, on).featSlots.filter((s) => s === 'mythic').length;
    expect([2, 4, 10, 20].map((l) => slots(l, true))).toEqual([1, 1, 1, 1]);
    expect([1, 3, 5].map((l) => slots(l, true))).toEqual([0, 0, 0]); // odd levels: none
    expect([2, 4].map((l) => slots(l, false))).toEqual([0, 0]); // toggle off: none
  });

  it('a chosen Mythic Calling is granted as a feature', () => {
    const callingId = Object.values(c.classFeatures).find((f) => (f.traits ?? []).includes('calling'))!.id;
    const ch = buildCharacter({ ...emptyBuild(), name: 'M', classId: 'fighter', mythicEnabled: true, mythicCalling: callingId }, c);
    expect((ch.grantedFeatures ?? []).some((g) => g.featureId === callingId)).toBe(true);
    expect(ch.mythicCalling).toBe(callingId);
  });

  it('Investigator carries the Esoterica methodology', () => {
    const opts = c.classes.investigator.subclass!.options;
    expect(opts.some((o) => /esoterica/i.test(o.name))).toBe(true);
    expect(opts.find((o) => /esoterica/i.test(o.name))?.description).toBeTruthy();
  });

  it('Basic/Greater/Major Lesson feats offer a tiered lesson sub-choice with descriptions', () => {
    for (const [id, count] of [['basic-lesson', 6], ['greater-lesson', 9], ['major-lesson', 4]] as const) {
      const choice = c.feats[id]?.choice;
      expect(choice?.kind).toBe('array');
      expect(choice?.options?.length).toBe(count);
      expect(choice?.options?.every((o) => o.label && o.description)).toBe(true);
    }
  });

  it('Commander tactics are selectable from content.actions (folio scales by level)', () => {
    // tactics live in content.actions (the [tactic] trait), surfaced by commanderTacticOptions
    expect(commanderTacticOptions(1, c).length).toBeGreaterThan(0);
    expect(commanderTacticOptions(20, c).length).toBeGreaterThan(commanderTacticOptions(1, c).length);
  });

  it('keepIds preserves already-chosen content even when its toggle is off', () => {
    const f = Object.values(c.feats).find((f) => traited(f).includes('mythic'))!;
    const off = applyContentToggles(c, { mythicEnabled: false, kingmakerEnabled: true }, new Set([f.id]));
    expect(off.feats[f.id]).toBeTruthy();
  });
});
