import { describe, expect, it, vi } from 'vitest';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { jsonEqual, mergeRosterEdits, revertRosterStep } from '../src/data/rosterMerge';
import { carryStoredOverrides } from '../src/data/rebuild';
import { gmApplyYields, revertOwnStep, settleMergedBuild, type UnconsumedApply } from '../src/data/rosterFold';
import type { SavedChar } from '../src/data/storage';

/**
 * The two rules App hands the merge when it folds another tab's roster write in (src/data/rosterFold.ts),
 * from a checker's findings on 6393b29 (2026-10-20). The App-level leg for S1 is
 * test/bug-two-tabs-roster.test.tsx (7). Synthetic characters only.
 */
const MARK = Symbol('test.gmApplied');
type Marked = SavedChar & { [MARK]?: string };
const markOf = (c: SavedChar) => (c as Marked)[MARK];
const pc = (name: string, heroPoints: number, potions: number, extra: object = {}) =>
  ({ id: 'pc', character: { name }, play: { heroPoints, inventory: [{ instanceId: 'p', itemId: 'healing-potion-minor', quantity: potions }] }, ...extra }) as unknown as SavedChar;

describe('S1: an unconfirmed GM push is taken OUT of the entry, never handed over whole', () => {
  /*
   * Tab B applies the GM's rename (not consumed yet: its commit has not been through the after-commit
   * effect) and the player spends a hero point on top of it in the same render batch — the tap spreads the
   * entry, so it carries the push's mark. Tab A's write (a fourth potion) is folded in now.
   * On 6393b29 App's rule gave the entry way WHOLE ('whole': A's entry as it was) — the hero point went.
   * MUTATION (run 2026-10-20): `if (rec) return 'whole';` in gmApplyYields — this fails on
   * `the tap made on top of the push stays: expected 1 to be +0`.
   */
  const over = pc('Player Version', 1, 3); // what the push replaced (tab B's entry, judged)
  const entry = { ...pc('GM Version', 1, 3), [MARK]: 'camp|pc|t1' } as Marked; // what the push wrote
  const applied = new Map<string, UnconsumedApply>([['camp|pc|t1', { entry, over }]]);
  const tapped = { ...entry, play: { ...entry.play!, heroPoints: 0 } } as Marked; // the spread keeps the mark
  const theirs = pc('Player Version', 1, 4); // tab A: a fourth potion, built on the roster before the push

  it('keeps the tap, takes the other tab’s change, and undoes the push (so its row is judged again)', () => {
    const [out] = mergeRosterEdits([over], [tapped], [theirs], { yieldTo: gmApplyYields(applied, markOf) });
    expect(out.play?.heroPoints, 'the tap made on top of the push stays').toBe(0);
    expect(out.play?.inventory?.[0].quantity, 'the other tab’s potion is taken').toBe(4);
    expect(out.character.name, 'the push is taken back out — it is judged again, and refused').toBe('Player Version');
    expect(markOf(out), 'the merged entry is not the push: no mark answers for it').toBeUndefined();
  });

  it('a base that already holds the push (the rebase onto a merged write) has it taken out too: the other tab’s value on a field the push set is kept', () => {
    // App's reconcile step rebases React's newer state on the merged write: base = the queued roster,
    // which holds the push; the merged write already took it out and carries tab A's own rename.
    const merged = pc('Renamed In A', 1, 4);
    const [out] = mergeRosterEdits([entry], [tapped], [merged], { yieldTo: gmApplyYields(applied, markOf) });
    expect(out.character.name).toBe('Renamed In A');
    expect(out.play?.heroPoints).toBe(0);
    expect(out.play?.inventory?.[0].quantity).toBe(4);
  });

  it('a value the push set and the tap changed again keeps the tap’s value (the player’s, by rule); the rest of the push still comes out', () => {
    const gave = { ...pc('GM Version', 1, 5), [MARK]: 'camp|pc|t2' } as Marked; // the GM gave two potions
    const rec = new Map<string, UnconsumedApply>([['camp|pc|t2', { entry: gave, over }]]);
    const drank = { ...gave, play: { ...gave.play!, inventory: [{ ...gave.play!.inventory![0], quantity: 4 }] } } as Marked;
    const [out] = mergeRosterEdits([over], [drank], [pc('Player Version', 0, 3)], { yieldTo: gmApplyYields(rec, markOf) });
    expect(out.play?.inventory?.[0].quantity).toBe(4);
    expect(out.play?.heroPoints, 'the other tab’s hero point').toBe(0);
    expect(out.character.name).toBe('Player Version');
  });

  it('unchanged: a CONSUMED push loses the values both changed; one the base already held merges as usual; no mark asks nothing', () => {
    const consumed = gmApplyYields(new Map(), markOf);
    expect(consumed(entry, over)).toBe('conflicts');
    expect(consumed(entry, entry)).toBeNull();
    expect(consumed(over, over)).toBeNull();
  });
});

describe('S2: an entry the merge made has its character re-derived from its merged build', () => {
  /*
   * Tab B levels the fighter up (build.level 2, character re-derived); tab A changes the ancestry (build
   * ancestry, character re-derived) inside the same save window. Merged value by value the build is both
   * changes, and `character.hitPoints` — changed differently on both sides — kept this tab's: a sheet
   * whose HP no longer follows its own build.
   * MUTATION (run 2026-10-20): `if (!content || !merged.build || Math.random() < 2) return merged;` in
   * settleMergedBuild — this fails on `the character follows the merged build: expected false to be true`.
   */
  const db = content();
  const b0: BuildState = { ...emptyBuild(), name: 'Merge Probe', level: 1, ancestryId: 'human', heritageId: 'versatile-human', backgroundId: 'acolyte', classId: 'fighter', keyAbility: 'str' };
  const mk = (b: BuildState, customization?: object) => {
    const character = buildCharacter(b, db);
    return { id: 'm', build: b, character: customization ? { ...character, customization } : character } as SavedChar;
  };
  const base = mk(b0);
  const local = mk({ ...b0, level: 2 }, { zoom: 1.25 }); // the player's own zoom rides along
  const incoming = mk({ ...b0, ancestryId: 'dwarf', heritageId: 'anvil-dwarf' });
  const derived = (c: SavedChar) => carryStoredOverrides(buildCharacter(c.build!, db), c.character);

  it('fixture: merged without it, the character does not follow the merged build', () => {
    const [plain] = mergeRosterEdits([base], [local], [incoming]);
    expect([plain.build?.level, plain.build?.ancestryId]).toEqual([2, 'dwarf']);
    expect(jsonEqual(plain.character, derived(plain))).toBe(false);
  });

  it('re-derives it, carrying the player’s own character fields, and registers it as a DERIVED refresh against this tab’s entry', () => {
    const note = vi.fn();
    const [out] = mergeRosterEdits([base], [local], [incoming], { settle: settleMergedBuild(db, note) });
    expect(jsonEqual(out.character, derived(out)), 'the character follows the merged build').toBe(true);
    expect(out.character.customization, 'the player’s zoom is carried').toEqual({ zoom: 1.25 });
    expect(note).toHaveBeenCalledWith([out], [local]);
  });

  it('leaves alone an entry that is one side’s own build and character, and an entry with no build; waits for content', () => {
    const note = vi.fn();
    const settle = settleMergedBuild(db, note);
    // Only the play differs on the other side: the build and character are this side's own pair.
    const playOnly = { ...local, play: { heroPoints: 0 } } as unknown as SavedChar;
    expect(settle(playOnly, local, incoming)).toBe(playOnly);
    const noBuild = { id: 'x', character: { name: 'Imported' } } as unknown as SavedChar;
    expect(settle(noBuild, noBuild, noBuild)).toBe(noBuild);
    const [plain] = mergeRosterEdits([base], [local], [incoming]);
    expect(settleMergedBuild(null, note)(plain, local, incoming)).toBe(plain);
    expect(note).not.toHaveBeenCalled();
  });

  /*
   * The same class through UNDO (a checker's finding on S4, 2026-10-20): this tab's last step levelled the
   * fighter to 2; the other tab then made it an anvil dwarf (folded in, re-derived). Ctrl+Z carries the
   * level-up back three ways: the build becomes a level 1 dwarf, and the character kept the level 2
   * dwarf's hit points — a sheet that does not follow its own build, written and pushed.
   * MUTATION (run 2026-10-20): `revertRosterStep(present, from, to)` without the settle in revertOwnStep —
   * this fails on `undone, the character follows the build: expected false to be true`.
   */
  it('undo of this tab’s own step over the other tab’s later build change re-derives the entry it makes', () => {
    const [present] = mergeRosterEdits([base], [local], [incoming], { settle: settleMergedBuild(db, () => {}) });
    expect(jsonEqual(present.character, derived(present)), 'fixture: the folded entry follows its build').toBe(true);
    const [plain] = revertRosterStep([present], [local], [base]);
    expect([plain.build?.level, plain.build?.ancestryId], 'fixture: undo takes back the level, keeps their ancestry').toEqual([1, 'dwarf']);
    expect(jsonEqual(plain.character, derived(plain)), 'fixture: carried back plainly, the character does not follow').toBe(false);
    const [out] = revertOwnStep(db)([present], [local], [base]);
    expect([out.build?.level, out.build?.ancestryId]).toEqual([1, 'dwarf']);
    expect(jsonEqual(out.character, derived(out)), 'undone, the character follows the build').toBe(true);
    // Nothing came in since the step: the snapshot itself, as before.
    const after = [local];
    const snap = [base];
    expect(revertOwnStep(db)(after, after, snap)).toBe(snap);
  });
});
