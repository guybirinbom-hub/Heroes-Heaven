import { describe, expect, it } from 'vitest';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { contentFor } from '../src/rules/blocks/content';
import { playerFacingContent } from '../src/rules/cursedItems';
import { deriveMaxHp } from '../src/rules/derive';
import { explainStat } from '../src/rules/explain';
import { CATALOG_MODE_MAP } from '../src/rules/modes';
import { applyPlayState, initialPlay, type PlayState } from '../src/rules/play';
import type { BuildOverrides, Character, ContentDatabase, ModeDef } from '../src/rules/types';
import { computePcStats } from '../src/integration/computePcStats';
import { computeSummary } from '../src/sheet/partySummary';
import { content } from './_content';

/**
 * CASE C (docs/overrides-redesign.md spec item 2; work/tweaks-part-b-notes/plan.md WP3, decision B5): a SET
 * maximum HP — Tweaks "Set maximum HP", `number.setMaxHp`, the old Overrides `maxHp` — is a 'set' term of
 * max HP's one term list (derive.ts `maxHpTerms`, blocks/active.ts `maxHpTweakTerms`). It replaces the
 * permanent part (ancestry, class + Con per level, the records' max-HP bonuses), while a mode on max HP, a
 * mode on Constitution and Drained still apply on top. Before part B the set returned early from
 * `deriveMaxHp` and every one of them was lost.
 *
 * Measured on what the player sees: the sheet's max HP, its breakdown, the tracker row and the party card.
 * Synthetic characters only.
 */

const base = content();
const USER_CON: ModeDef = { id: 'test-con-mod', name: 'Test: +1 Constitution modifier', modifiers: [{ value: 1, type: 'status', target: 'ability', detail: 'con' }] };
const USER_MAXHP: ModeDef = { id: 'test-max-hp', name: 'Test: +5 max HP', modifiers: [{ value: 5, type: 'untyped', target: 'max-hp' }] };
/** The modes the app merges in at load (the catalog, then the player's own), as mergeWithSeed does. */
const db: ContentDatabase = { ...base, modes: { ...CATALOG_MODE_MAP, ...(base.modes ?? {}), [USER_CON.id]: USER_CON, [USER_MAXHP.id]: USER_MAXHP } };
const AZATA = 'item-azatas-grace';

const WIZ5: BuildState = {
  ...emptyBuild(),
  name: 'Case C fixture',
  level: 5,
  classId: 'wizard',
  keyAbility: 'int',
  ancestryId: 'human',
  backgroundId: 'acolyte',
  subclassId: (db.classes.wizard.subclass?.options[0]?.id as string) ?? null,
  levelBoosts: ['int', 'con', 'dex', 'wis'],
  attributeBoosts: { 5: ['int', 'con', 'dex', 'wis'] },
} as BuildState;

const withSet = (value: number, more: Partial<BuildOverrides> = {}): BuildState => ({ ...WIZ5, overrides: { maxHp: value, ...more } }) as BuildState;

/** The sheet as the app shows it: the built character, the play state laid over it, the player-facing
 *  content (the character's own edits included), and the max HP every surface reads. */
function sheet(b: BuildState, play: Partial<PlayState> = {}) {
  const built = buildCharacter(b, db);
  return onSheet(built, play);
}
function onSheet(built: Character, play: Partial<PlayState> = {}) {
  const ch = applyPlayState(built, { ...initialPlay(built, db), ...play }, db);
  const view = playerFacingContent(contentFor(db, built), ch.inventory);
  return { built, ch, view, max: deriveMaxHp(ch, view) };
}
const drained2 = { conditions: [{ id: 'drained', value: 2 }] } as Partial<PlayState>;

describe('number.setMaxHp: a set max HP is a term, so modes and Drained still apply (case C)', () => {
  const plain = sheet(WIZ5);
  const azataBonus = sheet(WIZ5, { activeModes: [AZATA] }).max - plain.max;

  it("number.setMaxHp: a set max HP keeps a mode's max HP bonus (case C)", () => {
    expect(azataBonus, "Azata's Grace's own max-HP bonus (the premise)").toBeGreaterThan(0);
    expect(sheet(withSet(77)).max).toBe(77);
    // Mutation note: the old early return in deriveMaxHp (`maxOverride` wins whole) gives 77 here.
    expect(sheet(withSet(77), { activeModes: [AZATA] }).max).toBe(77 + azataBonus);
    // A player-made max-HP mode the same way.
    expect(sheet(withSet(77), { activeModes: [USER_MAXHP.id] }).max).toBe(82);
  });

  it('number.setMaxHp: a set max HP still loses Drained', () => {
    // Drained 2 at 5th level: 2 × 5 = 10.
    expect(plain.max - sheet(WIZ5, drained2).max).toBe(10);
    expect(sheet(withSet(77), drained2).max).toBe(67);
    expect(sheet(withSet(77), { activeModes: [AZATA], ...drained2 }).max).toBe(77 + azataBonus - 10);
  });

  it('number.setMaxHp: a Con mode moves a set max HP too (part of case C)', () => {
    // +1 Con modifier is +1 HP per level: +5 at 5th, on the computed max HP and on a set one alike.
    expect(sheet(WIZ5, { activeModes: [USER_CON.id] }).max - plain.max).toBe(5);
    expect(sheet(withSet(77), { activeModes: [USER_CON.id] }).max).toBe(82);
  });

  it('number.setMaxHp: a paused or switched-off set gives the computed max HP and emits no maxOverride', () => {
    const live = sheet(withSet(77));
    expect(live.built.hitPoints.maxOverride).toBe(77);
    const paused = sheet(withSet(77, { meta: { 'maxHp:max-hp': { of: '77', on: false } } }));
    expect(paused.max).toBe(plain.max);
    expect(paused.built.hitPoints.maxOverride).toBeUndefined();
    const off = sheet({ ...withSet(77, { v: 2 }), options: { ...(WIZ5.options ?? {}), overridesEnabled: false } } as BuildState);
    expect(off.max).toBe(plain.max);
    expect(off.built.hitPoints.maxOverride).toBeUndefined();
    // …and with a mode on, the computed max HP plus the mode — the set is simply not there.
    expect(sheet(withSet(77, { meta: { 'maxHp:max-hp': { of: '77', on: false } } }), { activeModes: [AZATA] }).max).toBe(plain.max + azataBonus);
  });

  it('number.setMaxHp: the max HP breakdown under a set shows the book lines and sums to the total', () => {
    for (const play of [{}, { activeModes: [AZATA] }, drained2, { activeModes: [USER_CON.id, AZATA], ...drained2 }] as Partial<PlayState>[]) {
      const s = sheet(withSet(77), play);
      const b = explainStat(s.ch, s.view, { kind: 'hp' });
      const labels = b.parts.map((p) => p.label);
      expect(b.totalText).toBe(String(s.max));
      expect(b.parts.reduce((n, p) => n + (p.value ?? 0), 0), JSON.stringify(b.parts)).toBe(s.max);
      // The book lines are still listed (they were one "Manual maximum" line before part B)…
      expect(labels).toContain('Ancestry HP');
      expect(labels.some((l) => /class \+ .* Con\) × 5 levels/.test(l))).toBe(true);
      // …and the set is ONE line, never two (a stored set and the maxOverride it emits are the same tweak).
      expect(labels.filter((l) => /^Tweak: set to 77/.test(l)), JSON.stringify(labels)).toHaveLength(1);
    }
  });

  it('number.setMaxHp: a hand-made character with hitPoints.maxOverride and no overrides keeps its set', () => {
    const made = buildCharacter(WIZ5, db);
    expect(made.overrides).toBeUndefined();
    const ch = { ...made, hitPoints: { ...made.hitPoints, maxOverride: 99 } } as Character;
    expect(deriveMaxHp(ch, db)).toBe(99);
    // The same term as a stored set: a mode still counts on top.
    expect(onSheet(ch, { activeModes: [USER_MAXHP.id] }).max).toBe(104);
    const b = explainStat(ch, db, { kind: 'hp' });
    expect(b.totalText).toBe('99');
    expect(b.parts.reduce((n, p) => n + (p.value ?? 0), 0)).toBe(99);
    // Never both: a stored set wins over a stale maxOverride on the same character (one set line, the stored one).
    const both = { ...buildCharacter(withSet(77), db) };
    const stale = { ...both, hitPoints: { ...both.hitPoints, maxOverride: 99 } } as Character;
    expect(deriveMaxHp(stale, db)).toBe(77);
    expect(explainStat(stale, db, { kind: 'hp' }).parts.filter((p) => /^Tweak: set to/.test(p.label))).toHaveLength(1);
  });

  it('number.setMaxHp: tracker row, party card and sheet agree under a set max HP', () => {
    for (const play of [{}, { activeModes: [AZATA] }, drained2, { activeModes: [USER_CON.id] }, { activeModes: [AZATA], ...drained2 }] as Partial<PlayState>[]) {
      const s = sheet(withSet(77), play);
      expect(computePcStats(s.ch, s.view).maxHP, JSON.stringify(play)).toBe(s.max);
      expect(computeSummary(s.ch, s.view).hpMax, JSON.stringify(play)).toBe(s.max);
    }
  });
});
