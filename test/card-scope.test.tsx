import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { build, content } from './_content';
import type { AstNode } from '../src/sheet/astStore';
import type { CardScope } from '../src/sheet/cardModel';
import {
  FUTURE_TREATMENT, LEVEL_FOLDS, foldNodesOf, foldText, foldsOf, isLevelTitle, pointerOf, scopeOfCharacter, scopeTree,
  sectionVerdict, withPointer, type LevelFoldLedger, type ScopedNode,
  choiceBlocksOf, pickCandidates, withPick, type ChoiceBlock,
  CLASS_PICKS, classPicksOf, classPickScopes, pickFoldsOf, classPickOf,
  sectionEnd, paragraphHash, proseVerdict, ledgerHasProse, pageRefOf, sectionHash, ledgerKeyOf,
} from '../src/sheet/cardScope';
import { recordTree, withoutItemLists } from '../src/sheet/astVisibility';
import PAGE_SLICES_JSON from '../src/data/page-slices.json';
import { generateLevelFolds, serialize, proseGatesOf, PROSE_EXCLUDED, PROSE_EXCLUDED_BUCKETS, loadTrees, loadCore } from '../scripts/level-folds.mjs';
import { levelFoldProblems } from '../scripts/level-folds-check.mjs';
import { scopeGrid, recordPickLabels, pickOwnOf, classPickLabels, judgeRow, ledgerGrid, treeBlocks, bodyLabels, plainHeaderLabels } from '../scripts/lib/card-scope.mjs';
import { spellCardModel } from '../src/sheet/spellCard';

/**
 * Card step 13a (docs/card-design.md section 3, section 9 row 13a; owner ruling Q1 = A, section 13):
 * the LEVEL FOLDS, as pure functions — src/sheet/cardScope.ts scopeTree over the shipped page trees with
 * the shipped ledger scripts/data/level-folds.json, scopeOfCharacter over synthesized builds (never the
 * owner's characters), and the ledger's two-way check. The rendering is test/card-fold.test.tsx.
 *
 * MUTATION LINES (each measured red on 2026-10-03, then restored byte-exact from a scratch copy):
 *  - cardScope.ts sectionVerdict: the implement branch `if (!imp) return byLevel;` → `return byLevel;`
 *    (level-only scoping on implements) → the thaumaturge cases red (bell's adept opens at 11).
 *  - cardScope.ts sectionVerdict: `if (!imp) return byLevel;` → `if (!imp) return 'pick';` (UNKNOWN read
 *    as EMPTY) → the unknown-pick case red.
 *  - cardScope.ts scopeTree: `if (hit) {` → fold every level title, listed or not → the unlisted-fold case
 *    red (foldsOf reports `listed: false`).
 *  - cardScope.ts scopeOfCharacter: the `Number(r.level ?? 0) <= level` filter removed → the build's
 *    paragon-benefit row stamped 17 counts at 11 → the thaumaturge scope case red.
 *  - cardScope.ts impulseApplies: `entry.featLevel + entry.plus` → `entry.plus` → the impulse case red.
 *  - cardScope.ts sectionEnd: end at "the next title of the same or a higher rank" (the old rule) → the
 *    spellshot case red (Additional Feats and the 11 feats fold under Greater Deed).
 *
 * Card step 13c (choose-one blocks; owner ruling Q2 = A). MUTATION LINES, each measured red on 2026-10-07
 * in lane hh-lane-13c, then restored byte-exact from a scratch copy (cmp):
 *  - cardScope.ts scopeChoiceBlock: the picked list item ALSO pushed into the fold → the two Iruxi cases,
 *    "the picked option is never folded" (509 pairs) and the guard's foldsOf case red (listed: false).
 *  - cardScope.ts pickedOptions: `picked.size ? picked : null` → `… : new Set([0])` (an unmatched pick
 *    takes the first option) → "an unmatched pick folds nothing" red.
 *  - cardScope.ts pickedOptions: the `if (block.grouped) return null;` line removed → the
 *    dragon-disciple-dedication case red ("Green (poison)" highlights Green).
 *  - cardScope.ts runFold: `foldIds: reason === 'pick' ? [...new Set(options)] : ids` → `foldIds: ids`
 *    (the line counts sections) → the thaumaturge, kineticist and inventor cases red.
 *  - cardScope.ts choiceBlocksOf: the `continues` test dropped → the stat-block case and the 509-pair case red.
 *  - cardScope.ts unwrapParens: `return t.slice(1, -1).trim();` → `return t;` → the "own record" case red.
 *  - scripts/lib/card-scope.mjs scopeGrid: `const picks = …` → `const picks = [];` → the ledger-grid case red.
 *
 * Card step 13c, fixer round 1 (class picks reach choose-one blocks; the guard's verdicts proved).
 * MUTATION LINES, each measured red on 2026-10-07 in lane hh-lane-13c, restored byte-exact (cmp):
 *  - cardScope.ts scopeTree: the class-pick branch `… ? classPicksOf(scope) : []` → `… ? [] : []` → the
 *    Fencer, kineticist and cleric class-pick cases, the 26-pair corpus case, the guard's class-grid case
 *    and the judgeRow case red (6 here; card-fold's two class-pick render cases red too).
 *  - cardScope.ts scopeOfCharacter: `...subclassRows.map((r) => r.name),` removed → the Fencer and the
 *    Warpriest cases red.
 *  - cardScope.ts pickFoldsOf: `listed: label !== undefined && !sameOption(label, pick)` → `listed: true`
 *    → "the guard's verdict reads the folded nodes" red (a drawer that folds the pick, or a non-option, is
 *    still called listed).
 *  - scripts/lib/card-scope.mjs judgeRow: `pickOwnOf(row)` dropped from the scopeTree call → "judgeRow
 *    draws the pick the card draws" red (both the row pick and the class pick).
 *  - scripts/lib/card-scope.mjs scopeGrid: the classPickScopes line → `[]` → the class-grid case red.
 *  - scripts/lib/card-scope.mjs ledgerGrid (computeLedger's call): `classLabels` not passed on → the
 *    class-grid case red.
 *
 * Card step 13c, fixer round 2 (a kinetic gate's elements answer only elemental-blast, and kinetic-gate's
 * junction list for a SINGLE gate: cardScope.ts ELEMENT_PICK_PAGES). MUTATION LINES, each measured red on
 * 2026-10-07 in lane hh-lane-13c, restored byte-exact (cmp):
 *  - cardScope.ts scopeOfCharacter: the 'single' page reads every owned element (`scope.elements?.owned`)
 *    → the dual-gate case red (here and in card-fold).
 *  - cardScope.ts classPicksOf: off an ELEMENT_PICK_PAGES page, every page's element picks are read → the
 *    single-gate and elemental-eidolon cases red (card-fold's elemental-eidolon render case red too).
 *  - cardScope.ts classPickScopes: an element label off an ELEMENT_PICK_PAGES page keyed CLASS_PICKS
 *    instead of dropped → the elemental-eidolon case and the 20-pair corpus case red.
 *  - scripts/lib/card-scope.mjs scopeGrid: `own` not passed to classPickScopes → the class-grid case red
 *    (kinetic-gate and elemental-blast lose their element scopes).
 *
 * Card step 13b (prose gates). MUTATION LINES, each measured red on 2026-10-08 in lane hh-lane-13b, then
 * restored byte-exact from a scratch copy (cmp):
 *  - cardScope.ts scopeTree: the fold also takes the block AFTER the gate paragraph (`run.nodes.push(n);
 *    if (top[j + 1]) { run.nodes.push(top[j + 1]); j++; }` — the boundary moved one block) → 6 red here:
 *    the 60-record every-level case, the fold-is-the-paragraph case, osteo at 7, the guard's corpus
 *    foldsOf case (FOLDED-UNLISTED sees the extra paragraph), the unlisted case, and Iruxi's foldsOf case.
 *  - cardScope.ts proseVerdict: `scope.level >= entry.level` → `>` (a gate applied one level late) → 7 red:
 *    the 60-record case, osteo at 8, the verdict case, and the four 13c Iruxi cases drawn at level 5.
 *  - cardScope.ts scopeTree: the ledger lookup by paragraph hash replaced by a run-time regex on "At Nth
 *    level" → 5 red: the 60-record cases, osteo at 7, the changed-page case (the edited paragraph folds
 *    and foldsOf calls it unlisted), the unlisted case.
 *  - scripts/level-folds.mjs proseGatesOf: the ungated-sentence rule removed → 3 red: the
 *    breath-of-the-dragon rule case, the census, the generator-equals-ledger case (and
 *    scripts/level-folds-check.mjs names the 14 pages it would add).
 *  - scripts/level-folds-check.mjs: the prose hash comparison removed → 2 red: the changed-record case and
 *    the tampered-hash case.
 *
 * Card step 13b-merge (fixer). MUTATION LINES, each measured red on 2026-10-08 on main + the step's tree,
 * restored byte-exact from a scratch copy (cmp):
 *  - level-folds.mjs PROSE_EXCLUDED: 'feats:mobile-thralls#5' removed → the listed-in-PROSE_EXCLUDED case red.
 *  - level-folds.mjs proseGatesOf: each of the OTHER_SUBJECT, next-block-continues, BACK_REFERENCE and
 *    list-introduction lines deleted (one at a time) → that rule's synthetic case red (1 each).
 *  - cardScope.ts proseGateAt: the hash's LAST page taken whatever the page (the old hash-only index) → 3
 *    red: furious-strike, the shared-hash corpus case, the identical-copies case.
 *  - cardScope.ts proseGateAt: no fold for a hash several unnamed pages list → 3 red: the 60-record
 *    every-level case and the fold-is-the-paragraph case (adept-benefit-weapon), the identical-copies case.
 *  - scripts/lib/card-scope.mjs spellBodyStatLabels: the prose-value test dropped → 2 red: grease, the
 *    synthetic header case. plainHeaderLabels read unmasked (bold runs as header text) → 3 red: grease
 *    (Cast), perfection-of-essence (Duration), the synthetic case. A label's words no longer cut at the next
 *    bold run → the synthetic reaction-line case red.
 *
 * Card follow-ups round (every ledger index keyed by page and hash; own page only; prose fold ids by
 * paragraph). MUTATION LINES, each measured red on 2026-10-08 in lane hh-lane-followups, restored
 * byte-exact from a scratch copy (cmp):
 *  - cardScope.ts scopeTree (round 1, when the lookup still took `own`): `own` → `undefined` (page key dropped) → 3 red: the
 *    classFeatures:shield case, the shared-section corpus case, the 13b shared-gate corpus case.
 *  - cardScope.ts entryAt: `return entry ? { key: own, entry } : undefined;` → `if (entry) return …;`
 *    (an own page without the entry falls through to the title page / identical copies) → 1 red: the
 *    synthetic classes page folds the feat's gate.
 *  - cardScope.ts foldsOf: `own` dropped from ledgerHasProse → 2 red: the borrowed fold is called listed
 *    (synthetic classes page; the twin paragraphs' second one).
 *  - cardScope.ts foldsOf: the `#<index>` dropped from a prose fold's id → 3 red: both twin-paragraph
 *    cases (two folds collapse to one id) and the Iruxi foldsOf id case.
 *
 * Follow-ups round 2 (orchestrator ruling: a record is judged on the page whose tree it DRAWS —
 * cardScope.ts ledgerKeyOf, through src/data/page-slices.json). MUTATION LINES, each measured red on
 * 2026-10-08 in lane hh-lane-followups, restored byte-exact from a scratch copy (cmp):
 *  - ledgerKeyOf: `const drawn = s ? … : own;` → `const drawn = own;` (resolution dropped) → 3 red: the
 *    decay/ligneous-instinct case, the GUARD (every row drawing a ledger page folds its listed sections),
 *    the no-entry fallback case.
 *  - ledgerKeyOf: the return → `return drawn;` (no fallback for a drawn page with no entry) → 1 red: the
 *    no-entry fallback case.
 *  - ledgerKeyOf: the return → `listed.has(drawn) ? drawn : undefined` (an own tree may borrow) → 3 red:
 *    both synthetic classes-page cases and the no-entry fallback case's own-tree half.
 *  - scopeTree: the section lookup's `lk` → `undefined` → 5 red: the shield case, both shared-hash corpus
 *    cases, the GUARD, the no-entry fallback case.
 *  - scopeTree: the impulse lookup's `lk` → `undefined` → 1 red: the synthetic two-page impulse case.
 *  - withPointer: `ptr.pageKey` → `undefined` → 1 red: the pointer section names classFeatures:justice.
 */
const trees: Record<string, Record<string, AstNode>> = {};
const tree = (key: string): AstNode => {
  const [b, id] = key.split(':');
  const t = trees[b]?.[id];
  if (!t) throw new Error(`no tree ${key}`);
  return t;
};
beforeAll(() => {
  for (const b of ['classFeatures', 'implement', 'element', 'innovation', 'feats', 'cause', 'archetype', 'heritages', 'actions', 'bloodline', 'categoryPage', 'classes', 'spells']) {
    trees[b] = JSON.parse(gunzipSync(readFileSync(`public/ast/${b}.json.gz`)).toString('utf8'));
  }
});

/** The visible shape of a scoped tree: open level titles and each fold as "reason(k):titles". */
function shape(t: AstNode) {
  const open: string[] = [];
  const folds: string[] = [];
  for (const n of t.c ?? []) {
    if (isLevelTitle(n)) open.push(foldText(n).trim());
    if (n.t === 'card-fold') {
      const f = n as ScopedNode;
      folds.push(`${f.foldReason}(${f.foldIds?.length}):${(f.c ?? []).filter(isLevelTitle).map((x) => foldText(x).trim()).join('+')}`);
    }
  }
  return { open, folds };
}
const allText = (t: AstNode) => foldText(t).replace(/\s+/g, '');

describe('the one switch', () => {
  it('FUTURE_TREATMENT is fold (owner ruling Q1 = A)', () => {
    expect(FUTURE_TREATMENT).toBe('fold');
  });
});

describe('champion cause (level-titled sections)', () => {
  const champ = (level: number): CardScope => scopeOfCharacter(build('champion', level, { subclassId: 'justice' }))!;
  it('a Justice champion at 5 sees no Relentless Reaction open and ONE fold of both later sections', () => {
    const t = scopeTree(tree('classFeatures:justice'), champ(5));
    expect(shape(t)).toEqual({ open: [], folds: ['future(2):Relentless Reaction+Exalted Reaction'] });
    // Folded, never deleted: every word of the page is still in the tree.
    expect(allText(t)).toBe(allText(tree('classFeatures:justice')));
  });
  it('at 9 Relentless Reaction is open and Exalted Reaction is folded with its text inside the fold', () => {
    const t = scopeTree(tree('classFeatures:justice'), champ(9));
    expect(shape(t)).toEqual({ open: ['Relentless Reaction'], folds: ['future(1):Exalted Reaction'] });
    const fold = foldNodesOf(t)[0];
    expect(foldText(fold)).toMatch(/Each ally in your champion.s aura/);
  });
  it('at 11 nothing folds and the tree is returned as is', () => {
    expect(scopeTree(tree('classFeatures:justice'), champ(11))).toBe(tree('classFeatures:justice'));
  });
  it('no scope (browse, search, the builder) never folds', () => {
    expect(scopeTree(tree('classFeatures:justice'), undefined)).toBe(tree('classFeatures:justice'));
  });
});

describe('a level section owns only the words under its own title', () => {
  // Refuter 2026-10-03: archetype:spellshot's level-2 "Greater Deed" (15th) is followed by a level-3
  // "Additional Feats" rule and the archetype's 11 feats. A section that ran to the next title of the same
  // rank folded all of that as later-level text for every character below 15.
  it('a spellshot at 5 folds Advanced Deed + Greater Deed only; Additional Feats and the feats stay open', () => {
    const src = tree('archetype:spellshot');
    const top = src.c ?? [];
    const af = top.findIndex((n) => n.t === 'title' && /^Additional Feats$/.test(foldText(n).trim()));
    expect(af).toBeGreaterThan(0);
    const t = scopeTree(src, { level: 5, classId: 'gunslinger' });
    expect(shape(t).folds).toEqual(['future(2):Advanced Deed+Greater Deed']);
    const fold = foldNodesOf(t)[0];
    expect((fold.c ?? []).filter((n) => n.t === 'title').map((n) => foldText(n).trim())).toEqual(['Advanced Deed', 'Greater Deed']);
    // Everything from "Additional Feats" to the end of the page is drawn open, node for node.
    const tail = top.slice(af);
    expect(tail.length).toBeGreaterThanOrEqual(12);
    const out = t.c ?? [];
    expect(out.slice(out.length - tail.length).every((n, i) => n === tail[i])).toBe(true);
    expect(allText(t)).toBe(allText(src));
  });
});

describe('pointer rows', () => {
  it('relentless-reaction at 9 shows the Justice cause\'s Relentless Reaction section; at 5 it is folded', () => {
    const s9 = scopeOfCharacter(build('champion', 9, { subclassId: 'justice' }))!;
    const ptr = pointerOf('classFeatures', 'relentless-reaction', s9);
    expect(ptr).toEqual({ pageKey: 'classFeatures:justice', title: 'Relentless Reaction' });
    const own = tree('classFeatures:relentless-reaction');
    const t9 = withPointer(own, tree(ptr!.pageKey), ptr, s9);
    const last = (t9.c ?? [])[(t9.c ?? []).length - 1] as ScopedNode;
    expect(last.t).toBe('card-pointer');
    expect(last.pointerFrom).toBe('classFeatures:justice');
    expect(foldText(last)).toMatch(/persistent spirit damage/);
    const s5 = scopeOfCharacter(build('champion', 5, { subclassId: 'justice' }))!;
    const t5 = withPointer(own, tree(ptr!.pageKey), pointerOf('classFeatures', 'relentless-reaction', s5), s5);
    const f = (t5.c ?? [])[(t5.c ?? []).length - 1] as ScopedNode;
    expect(f.t).toBe('card-fold');
    expect(f.c?.[0].t).toBe('card-pointer');
  });
  it('an unknown subclass shows nothing extra', () => {
    expect(pointerOf('classFeatures', 'relentless-reaction', { level: 9, classId: 'champion' })).toBeNull();
  });
});

describe('thaumaturge implements: owned, not only reached', () => {
  const one = () => scopeOfCharacter(build('thaumaturge', 11, { extraChoices: { implement: ['amulet'] } }))!;
  it('the scope reads the build: one implement, its adept granted, paragon not yet (the 17 row ignored at 11)', () => {
    expect(one().implements).toEqual({ owned: ['amulet'], adept: ['amulet'], paragon: [] });
  });
  it('a thaumaturge 11 with one implement at adept: only the owned Adept open; other implements fold', () => {
    expect(shape(scopeTree(tree('implement:amulet'), one()))).toEqual({ open: ['Adept Benefit', 'Intensify Benefit'], folds: ['future(1):Paragon Benefit'] });
    for (const other of ['implement:bell', 'implement:chalice', 'classFeatures:bell', 'classFeatures:adept-benefit-bell']) {
      // Card step 13c: "Other options (k)" counts OPTIONS — the three benefits are one implement's.
      // batch card premise: implement-18 "Your bell resonates powerfully, causing the effect to last longer"
      expect(shape(scopeTree(tree(other), one())), other).toEqual({ open: [], folds: ['pick(1):Adept Benefit+Intensify Benefit+Paragon Benefit'] });
    }
  });
  it('an owned implement whose adept the build did not grant folds its Adept (later), not as another option', () => {
    const s: CardScope = { level: 11, classId: 'thaumaturge', implements: { owned: ['amulet', 'bell'], adept: ['amulet'], paragon: [] } };
    expect(shape(scopeTree(tree('implement:bell'), s))).toEqual({ open: ['Intensify Benefit'], folds: ['future(1):Adept Benefit', 'future(1):Paragon Benefit'] });
  });
  it('an UNKNOWN pick is shown (UNKNOWN ≠ EMPTY): with no implement on the character, the level rule alone', () => {
    const s = scopeOfCharacter(build('thaumaturge', 11, { extraChoices: {} }))!;
    expect(s.implements).toBeUndefined();
    expect(shape(scopeTree(tree('implement:bell'), s))).toEqual({ open: ['Adept Benefit', 'Intensify Benefit'], folds: ['future(1):Paragon Benefit'] });
  });
});

describe('kineticist elements and inventor innovations', () => {
  it('a single gate keeps its own impulse junction; a dual gate folds it until 5, then it is unmapped and shown', () => {
    const single = scopeOfCharacter(build('kineticist', 1, { extraChoices: { element: ['air-gate'] } }))!;
    expect(single.elements).toEqual({ owned: ['air'], single: 'air' });
    expect(shape(scopeTree(tree('element:air'), single))).toEqual({ open: ['Elemental Blast', 'Impulse Junction (Single Gate)'], folds: ['future(1):Gate Junction'] });
    const dual = scopeOfCharacter(build('kineticist', 1, { extraChoices: { element: ['air-gate', 'fire-gate'] } }))!;
    expect(dual.elements).toEqual({ owned: ['air', 'fire'] });
    expect(shape(scopeTree(tree('element:air'), dual))).toEqual({ open: ['Elemental Blast'], folds: ['pick(1):Impulse Junction (Single Gate)', 'future(1):Gate Junction'] });
    const dual5 = scopeOfCharacter(build('kineticist', 5, { extraChoices: { element: ['air-gate', 'fire-gate'] } }))!;
    expect(shape(scopeTree(tree('element:air'), dual5)).folds).toEqual([]);
    // An element the gate does not channel is another option — ONE option, whose three sections fold.
    // batch card premise: element-6 "1d8 bludgeoning or cold, 30 feet"
    expect(shape(scopeTree(tree('element:water'), single))).toEqual({ open: [], folds: ['pick(1):Elemental Blast+Impulse Junction (Single Gate)+Gate Junction'] });
  });
  it('an armor inventor at 7: armor Breakthrough open, Revolutionary later; the weapon innovation page is another option', () => {
    const inv = scopeOfCharacter(build('inventor', 7, {}))!;
    expect(inv.innovation).toBe('armor');
    expect(shape(scopeTree(tree('innovation:armor'), inv))).toEqual({ open: ['Breakthrough Modifications'], folds: ['future(1):Revolutionary Modifications'] });
    // batch card premise: innovation-7 "Your innovation is an impossible-looking weapon"
    expect(shape(scopeTree(tree('innovation:weapon'), inv))).toEqual({ open: [], folds: ['pick(1):Breakthrough Modifications+Revolutionary Modifications'] });
  });
});

describe('kineticist impulse "Level" entries: highlighted, nothing hidden', () => {
  const applying = (t: AstNode) => (t.c ?? []).filter((n) => (n as ScopedNode).applies).map((n) => /^Level \([^)]*\)/.exec(foldText(n).trim())?.[0]);
  it('"Level (+2)" counts up from the feat\'s own level; "Level (20th)" applies from 20', () => {
    const boom = tree('feats:aerial-boomerang'); // Feat 1
    expect(applying(scopeTree(boom, { level: 2 }))).toEqual([]);
    expect(applying(scopeTree(boom, { level: 3 }))).toEqual(['Level (+2)']);
    expect((scopeTree(boom, { level: 3 }).c ?? []).length).toBe((boom.c ?? []).length);
    expect(foldNodesOf(scopeTree(boom, { level: 1 }))).toEqual([]);
    const flames = tree('feats:all-shall-end-in-flames'); // Feat 18
    expect(applying(scopeTree(flames, { level: 19 }))).toEqual([]);
    expect(applying(scopeTree(flames, { level: 20 }))).toEqual(['Level (20th)']);
  });
});

describe('the guard\'s view: every fold is a ledger section', () => {
  it('a mine card row at the scope grid folds only listed sections', () => {
    const folds = foldsOf({ mode: 'mine', card: { printed: [] } }, tree('classFeatures:justice'), ['champion']);
    expect(folds.map((f) => f.id)).toEqual(['Relentless Reaction@1', 'Exalted Reaction@1', 'Relentless Reaction@5', 'Exalted Reaction@5', 'Exalted Reaction@9']);
    expect(folds.every((f) => f.listed)).toBe(true);
    // A browse row never scopes.
    expect(foldsOf({ mode: 'browse' }, tree('classFeatures:justice'), ['champion'])).toEqual([]);
  });
  it('a level-titled section the ledger does not list is never folded (FOLDED-UNLISTED stays 0)', () => {
    const src = tree('classFeatures:justice');
    // The same page with Relentless Reaction's words changed: its hash leaves the ledger.
    const edited: AstNode = { ...src, c: (src.c ?? []).map((n, i) => (i === 9 && n.t === 'p' ? { t: 'p', c: [{ t: 'text', v: 'Changed words.' }] } : n)) };
    // The guard's own view first: foldsOf re-hashes every folded section against the ledger.
    expect(foldsOf({ mode: 'mine', card: { printed: [] } }, edited).filter((f) => !f.listed)).toEqual([]);
    const t = scopeTree(edited, { level: 5 });
    expect(shape(t).folds).toEqual(['future(1):Exalted Reaction']);
  });
  it('the verdict of an ungated section is the level rule', () => {
    const e = LEVEL_FOLDS.pages['cause:justice'][0];
    expect([sectionVerdict(e, { level: 8 }), sectionVerdict(e, { level: 9 })]).toEqual(['future', 'open']);
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* Card step 13c: choose-one blocks (docs/card-design.md section 3; owner ruling Q2 = A, section 13). */
/* ------------------------------------------------------------------------------------------------ */

/** The page a FeatDetail row with this pick draws (FeatCard: withPick(scopeOfCharacter(…), bucket, id,
 *  featPickSuffix(…)); RecordCard: scopeTree(…, `${bucket}:${id}`)). */
function drawnWithPick(key: string, pick: string, level = 5): AstNode {
  const [b, id] = key.split(':');
  return scopeTree(tree(key), withPick({ level }, b, id, pick), LEVEL_FOLDS, FUTURE_TREATMENT, key);
}
/** Every node outside the folds, depth first. */
function openNodes(t: AstNode, out: AstNode[] = []): AstNode[] {
  for (const n of t.c ?? []) {
    if (n.t === 'card-fold') continue;
    out.push(n);
    openNodes(n, out);
  }
  return out;
}
const squashText = (n: AstNode) => foldText(n).replace(/\s+/g, ' ').trim();
/** What the card highlights outside its folds (the `applies` paragraphs). */
const highlighted = (t: AstNode) => openNodes(t).filter((n) => (n as ScopedNode).applies).map(squashText);
/** The open words: the tree's text with every fold left out. */
const openWords = (t: AstNode) => openNodes({ t: 'doc', c: t.c }).filter((n) => n.t === 'text').map((n) => n.v ?? '').join('').replace(/\s+/g, ' ');
/** Every character of the page, order aside — folded, never deleted. */
const charBag = (t: AstNode) => [...allText(t)].sort().join('');
const pickFolds = (t: AstNode) => foldNodesOf(t).filter((f) => f.foldReason === 'pick' && f.options);

describe('choose-one blocks: the picked option open and highlighted, the others under ONE line', () => {
  const IRUXI = 'feats:iruxi-armaments';

  it('Iruxi Armaments (Claw): Claws is highlighted; Fangs and Tail fold under "Other options (2)"', () => {
    const t = drawnWithPick(IRUXI, 'Claw');
    expect(highlighted(t)).toEqual(['Claws Your claw attack deals 1d6 slashing damage instead of 1d4 and gains the versatile P trait.']);
    const folds = pickFolds(t);
    expect(folds.length).toBe(1);
    expect(folds[0].treatment).toBe('fold');
    // The line counts OPTIONS: two other options.
    expect(folds[0].foldIds?.length).toBe(2);
    expect(folds[0].options).toEqual(['Fangs', 'Tail']);
    expect(squashText(folds[0])).toMatch(/^Fangs You gain a fangs unarmed attack.*Tail You gain a tail unarmed attack/);
    expect(openWords(t)).toMatch(/Choose one of the following options: Claws Your claw attack/);
    expect(openWords(t)).not.toMatch(/Fangs You gain|Tail You gain/);
    // The rest of the page stays open, and nothing is deleted.
    expect(openWords(t)).toMatch(/At 5th level, whenever you get a critical hit/);
    expect(charBag(t)).toBe(charBag(tree(IRUXI)));
    // The open list holds the picked item only, marked as the pick.
    const lists = (t.c ?? []).filter((n) => n.t === 'ul') as ScopedNode[];
    expect(lists.map((l) => [l.picked, (l.c ?? []).length])).toEqual([[true, 1]]);
  });

  it('Iruxi Armaments (Fangs): Fangs is highlighted where the list prints it; Claws and Tail fold', () => {
    const t = drawnWithPick(IRUXI, 'Fangs');
    expect(highlighted(t)).toEqual(['Fangs You gain a fangs unarmed attack that deals 1d8 piercing damage and is in the brawling group.']);
    expect(pickFolds(t).map((f) => [f.foldIds?.length, f.options])).toEqual([[2, ['Claws', 'Tail']]]);
    expect(charBag(t)).toBe(charBag(tree(IRUXI)));
  });

  it('dragon-disciple-dedication: a pick the page groups with others ("Red" in "Brass, Gold, Magma*, Red, or Underworld") falls back to the whole text', () => {
    const key = 'feats:dragon-disciple-dedication';
    const blocks = choiceBlocksOf(tree(key).c ?? []);
    expect(blocks.map((b: ChoiceBlock) => [b.kind, b.grouped, b.options.length])).toEqual([['list', true, 9]]);
    // Every one of the record's own picks, including one the page prints alone ("Green"): the block is a
    // grouped table, so no pick is matched on it — the tree itself, every option open, nothing highlighted.
    for (const pick of recordPickLabels(content(), { bucket: 'feats', id: 'dragon-disciple-dedication' })) {
      const t = drawnWithPick(key, pick);
      expect(t, pick).toBe(tree(key));
    }
    expect(recordPickLabels(content(), { bucket: 'feats', id: 'dragon-disciple-dedication' })).toContain('Green (poison)');
  });

  it('an unmatched pick folds nothing: a pick the page does not print leaves the tree itself', () => {
    expect(drawnWithPick(IRUXI, 'Wings')).toBe(tree(IRUXI));
    expect(drawnWithPick(IRUXI, 'Claws, Fangs, Tail, Hoof')).not.toBe(tree(IRUXI)); // each part names one option
    expect(pickFolds(drawnWithPick(IRUXI, 'Claws, Fangs, Tail, Hoof'))).toEqual([]); // …all three: nothing left to fold
  });

  it('a pick reaches only its own record, and never without the record key or a scope', () => {
    const scope = withPick({ level: 5 }, 'feats', 'iruxi-armaments', 'Claw');
    expect(scope).toEqual({ level: 5, picks: { 'feats:iruxi-armaments': 'Claw' } });
    expect(scopeTree(tree(IRUXI), scope)).toBe(tree(IRUXI));
    expect(scopeTree(tree(IRUXI), withPick({ level: 5 }, 'feats', 'draconic-aspect', 'Claw'), LEVEL_FOLDS, FUTURE_TREATMENT, IRUXI)).toBe(tree(IRUXI));
    expect(withPick(undefined, 'feats', 'iruxi-armaments', 'Claw')).toBeUndefined();
    const plain = { level: 5 };
    expect(withPick(plain, 'feats', 'iruxi-armaments', '  ')).toBe(plain);
    expect(pickCandidates('Claw, Fangs')).toEqual(['Claw, Fangs', 'Claw', 'Fangs']);
    // featPickSuffix keeps the outer parentheses when the label holds its own "(…)".
    expect(pickCandidates('(Fey Dragonet (arcane, poison))')[0]).toBe('Fey Dragonet (arcane, poison)');
    expect(pickCandidates('(Claw) (Fangs)')[0]).toBe('(Claw) (Fangs)');
    expect(pickFolds(drawnWithPick('feats:dragonet-breath', '(Fey Dragonet (arcane, poison))')).map((f) => f.options)).toEqual([['Homing Drake', 'House Drake', 'Pearl Dragonet', 'Tidepool Dragonet']]);
  });

  it('options printed as bold-led paragraphs: Dragonblood Paragon, Elemental Spark, Rejuvenating Embrace', () => {
    const para = drawnWithPick('feats:dragonblood-paragon', 'Kobold Breath');
    expect(highlighted(para)).toEqual([expect.stringMatching(/^Kobold Breath Creatures that critically fail their save/)]);
    expect(pickFolds(para).map((f) => [f.foldIds?.length, f.options])).toEqual([[3, ['Dracomancer', 'Strongjaw Kobold', 'Venomtail Kobold']]]);
    expect(openWords(para)).toMatch(/You increase the power of one of the following kobold heritages or feats you have\./);
    const spark = drawnWithPick('feats:elemental-spark', 'Fire (versatile fire)');
    expect(highlighted(spark)).toEqual(['Fire versatile fire']);
    expect(pickFolds(spark).map((f) => f.options)).toEqual([['Water', 'Wood', 'Earth', 'Metal']]);
    expect(openWords(spark)).toMatch(/Special If you're a kineticist/);
    expect(charBag(spark)).toBe(charBag(tree('feats:elemental-spark')));
    // A straight apostrophe in the pick names the page's curly one.
    expect(highlighted(drawnWithPick('feats:rejuvenating-embrace', "Father Moon's Vigilance"))).toEqual([expect.stringMatching(/^Father Moon’s Vigilance While sleeping/)]);
  });

  it('a stat block of bold-led lines is not a choose-one block; nor is a block inside a ledger section scoped', () => {
    // The Animist apparition's "Avatar … Melee ⟨1⟩ …" line runs past its paragraph: never options.
    const vault = tree('classFeatures:crafter-in-the-vault');
    const avatarAt = (vault.c ?? []).findIndex((n) => /^Avatar\b/.test(squashText(n)));
    expect(avatarAt).toBeGreaterThan(0);
    expect(choiceBlocksOf(vault.c ?? []).some((b: ChoiceBlock) => b.start <= avatarAt && avatarAt < b.end)).toBe(false);
    // initiate-benefit-wand's list sits in Adept Benefit (7th), which asks for "a second" damage type.
    const wand = drawnWithPick('classFeatures:initiate-benefit-wand', 'Cold', 20);
    expect(pickFolds(wand)).toEqual([]);
    expect(highlighted(wand)).toEqual([]);
  });
});

describe('the picked option is never folded (every choose-one block of the shipped trees, every option picked)', () => {
  it('picked open + highlighted, every other option folded, k = options − picked, nothing deleted', () => {
    let pairs = 0;
    let unchanged = 0; // a block inside a ledger section (initiate-benefit-wand's Adept list): left as printed
    for (const b of ['feats', 'classFeatures', 'heritages']) {
      for (const [id, src] of Object.entries(trees[b])) {
        const top = src.c ?? [];
        for (const block of choiceBlocksOf(top)) {
          if (block.grouped) continue;
          const nodeOf = (i: number) => (block.kind === 'list' ? (top[block.start].c ?? []).filter((n) => n.t === 'li')[block.options[i].at] : top[block.options[i].at]);
          for (let i = 0; i < block.options.length; i++) {
            const key = `${b}:${id}`;
            const t = drawnWithPick(key, block.options[i].label, 20);
            const label = `${key} pick "${block.options[i].label}"`;
            if (t === src) { unchanged++; continue; }
            pairs++;
            const folded = new Set<AstNode>();
            const collect = (n: AstNode) => { folded.add(n); (n.c ?? []).forEach(collect); };
            for (const f of foldNodesOf(t)) collect(f);
            // The picked option: not folded, drawn open with its highlight, word for word.
            expect(folded.has(nodeOf(i)), label).toBe(false);
            expect(highlighted(t).some((h) => h.length > 0 && squashText(nodeOf(i)).startsWith(h)), label).toBe(true);
            // Every other option of the block is inside the ONE fold, which counts them.
            const others = block.options.map((_, k) => k).filter((k) => k !== i);
            for (const k of others) expect(folded.has(nodeOf(k)), `${label}: option ${block.options[k].label} folded`).toBe(true);
            const mine = pickFolds(t).filter((f) => (f.foldIds ?? []).every((x) => x.startsWith(`${key}#${block.start}.`)));
            expect(mine.map((f) => f.foldIds?.length), label).toEqual([others.length]);
            expect(charBag(t), label).toBe(charBag(src));
          }
        }
      }
    }
    // Measured 2026-10-07 on the shipped trees (lane hh-lane-13c at 71f92af).
    expect([pairs, unchanged]).toEqual([509, 9]);
  });
});

describe('the guard\'s view of choose-one folds', () => {
  const featRow = { surface: 'featDetail', mode: 'mine', card: { printed: [] }, read: { bucket: 'feats', slug: 'iruxi-armaments' }, own: { bucket: 'feats', id: 'iruxi-armaments' } };
  it('foldsOf re-checks every choose-one fold of a FeatDetail row at the pick grid: all listed', () => {
    const folds = foldsOf(featRow, tree('feats:iruxi-armaments'));
    // Card step 13b: the page's 5th-level prose gate also folds at the level grid (below 5: level 1).
    // batch card premise: feat-5633 "At 5th level, whenever you get a critical hit"
    expect(folds.map((f) => f.id).filter((id) => !id.startsWith('¶')).sort()).toEqual(['Claws@pick:Fangs', 'Claws@pick:Tail', 'Fangs@pick:Claws', 'Fangs@pick:Tail', 'Tail@pick:Claws', 'Tail@pick:Fangs']);
    // Follow-ups FIX 3: a prose fold's id carries the paragraph's index in the tree (#6).
    // batch card premise: feat-5633 "At 5th level, whenever you get a critical hit"
    expect(folds.filter((f) => f.id.startsWith('¶')).map((f) => f.id)).toEqual(['¶At 5th level, whenever you get a critica#6@1']);
    expect(folds.every((f) => f.listed)).toBe(true);
    // A surface that never hands its card a pick has no pick grid (the level grid's prose fold only).
    // batch card premise: feat-5633 "At 5th level, whenever you get a critical hit"
    expect(foldsOf({ ...featRow, surface: 'statDetail' }, tree('feats:iruxi-armaments')).filter((f) => /@pick:/.test(f.id))).toEqual([]);
  });
  it('the ledger judges a FeatDetail row once per pick its record can carry (its own choice labels)', () => {
    const labels = recordPickLabels(content(), featRow.own);
    expect(labels).toEqual(['Claw', 'Fangs', 'Tail']);
    expect(pickOwnOf(featRow)).toBe('feats:iruxi-armaments');
    const grid = scopeGrid(featRow, tree('feats:iruxi-armaments'), [], labels);
    // Card step 13b: the page now folds a prose gate at some level, so the level grid joins the picks.
    // batch card premise: feat-5633 "At 5th level, whenever you get a critical hit"
    const levels = [1, 5, 9, 13, 17, 20].map((level) => ({ level }));
    expect(grid).toEqual([...levels, ...labels.map((p) => ({ level: 20, picks: { 'feats:iruxi-armaments': p } }))]);
    // batch card premise: feat-5633 "At 5th level, whenever you get a critical hit"
    expect(scopeGrid({ ...featRow, surface: 'statDetail' }, tree('feats:iruxi-armaments'), [], labels)).toEqual(levels);
  });

  it('the guard\'s verdict reads the folded nodes, not the drawer\'s word: a fold of the pick or of a non-option is unlisted', () => {
    const key = 'feats:iruxi-armaments';
    const t = tree(key);
    // The honest drawing (scopeTree): every folded node is an unpicked printed option.
    expect(pickFoldsOf(t, key).every((f) => f.listed)).toBe(true);
    // A broken drawer that folds EVERY option (the pick too): the picked option's fold is unlisted.
    const list = (t.c ?? []).find((n) => n.t === 'ul')!;
    const foldAll = (src: AstNode): AstNode => ({ ...src, c: [...(src.c ?? []).filter((n) => n !== list), { t: 'card-fold', foldReason: 'pick', treatment: 'fold', foldIds: ['x'], options: ['x'], c: [list] } as ScopedNode] });
    const broken = pickFoldsOf(t, key, LEVEL_FOLDS, { draw: (src) => foldAll(src) });
    expect(broken.filter((f) => !f.listed).map((f) => f.id).sort()).toEqual(['Claws@pick:Claws', 'Fangs@pick:Fangs', 'Tail@pick:Tail']);
    expect(broken.filter((f) => f.listed).length).toBe(6);
    // A broken drawer that folds the page's lead paragraph (not an option at all): unlisted.
    const lead = (t.c ?? []).find((n) => n.t === 'p' && /Choose one of the following options/.test(foldText(n)))!;
    expect(lead).toBeTruthy();
    const foldLead = (src: AstNode): AstNode => ({ ...src, c: [{ t: 'card-fold', foldReason: 'pick', treatment: 'fold', foldIds: ['x'], options: ['x'], c: [lead] } as ScopedNode] });
    const stray = pickFoldsOf(t, key, LEVEL_FOLDS, { draw: (src) => foldLead(src) });
    expect(stray.length).toBeGreaterThan(0);
    expect(stray.every((f) => !f.listed)).toBe(true);
  });

  it('judgeRow draws the pick the card draws (the read\'s key): under \'hide\' the other options are left out as S-pick', () => {
    const jTrees = { feats: trees.feats, classFeatures: trees.classFeatures };
    const md = { parseBlocks: () => [], cleanRun: (s: string) => s };
    const sPick = (r: { hidden?: { text: string; rule: string }[] }) => (r.hidden ?? []).filter((h) => h.rule === 'S-pick').map((h) => h.text.split(' ')[0].replace(/:$/, ''));
    // A row pick (FeatDetail).
    const scope = withPick({ level: 20 }, 'feats', 'iruxi-armaments', 'Claw')!;
    const row = { ...featRow, bucket: 'feats', id: 'iruxi-armaments', printed: [], hideMeta: true, itemLists: false, md: '' };
    expect(sPick(judgeRow({ ...row, scope, treatment: 'hide' }, jTrees, md))).toEqual(['Fangs', 'Tail']);
    // A class pick (any card on a classFeatures page).
    const cfRow = { surface: 'statDetail', bucket: 'classFeatures', id: 'exemplary-finisher', mode: 'mine', card: { printed: [] }, read: { bucket: 'classFeatures', slug: 'exemplary-finisher' }, own: { bucket: 'classFeatures', id: 'exemplary-finisher' }, printed: [], hideMeta: false, itemLists: false, md: '' };
    const cScope: CardScope = { level: 20, picks: { [CLASS_PICKS]: 'Fencer' } };
    expect(sPick(judgeRow({ ...cfRow, scope: cScope, treatment: 'hide' }, jTrees, md))).toEqual(['Battledancer', 'Braggart', 'Gymnast', 'Rascal', 'Wit']);
  });
});

describe('class picks reach a classFeatures page\'s choose-one blocks (the subclass, the gate\'s elements, the divine font)', () => {
  const draw = (key: string, scope: CardScope | undefined) => scopeTree(tree(key), scope, LEVEL_FOLDS, FUTURE_TREATMENT, key);

  it('a Fencer swashbuckler: exemplary-finisher highlights Fencer; the five other styles fold under "Other options (5)"', () => {
    const scope = scopeOfCharacter(build('swashbuckler', 9, { subclassId: 'fencer' }))!;
    expect(classPicksOf(scope)).toEqual(['Fencer']);
    const key = 'classFeatures:exemplary-finisher';
    const t = draw(key, scope);
    expect(highlighted(t)).toEqual([expect.stringMatching(/^Fencer:? /)]);
    expect(pickFolds(t).map((f) => [f.foldIds?.length, f.options])).toEqual([[5, ['Battledancer', 'Braggart', 'Gymnast', 'Rascal', 'Wit']]]);
    expect(charBag(t)).toBe(charBag(tree(key)));
    // A Wit sees Wit.
    expect(highlighted(draw(key, scopeOfCharacter(build('swashbuckler', 9, { subclassId: 'wit' }))))).toEqual([expect.stringMatching(/^Wit:? /)]);
  });

  it('a single-gate air kineticist: kinetic-gate highlights Air\'s impulse junction; the five others fold under ONE line', () => {
    // batch card premise: class-feature-596 "In addition, you gain an impulse junction"
    const scope = scopeOfCharacter(build('kineticist', 5, { extraChoices: { element: ['air-gate'] } }))!;
    expect(scope.elements).toEqual({ owned: ['air'], single: 'air' });
    const key = 'classFeatures:kinetic-gate';
    expect(classPicksOf(scope)).toEqual([]); // no subclass, no font: the elements are per page
    expect(classPicksOf(scope, key)).toEqual(['Air']);
    const t = draw(key, scope);
    expect(highlighted(t).map((h) => h.split(' ')[0])).toEqual(['Air']);
    expect(pickFolds(t).map((f) => [f.foldIds?.length, f.options])).toEqual([[5, ['Earth', 'Fire', 'Metal', 'Water', 'Wood']]]);
    expect(charBag(t)).toBe(charBag(tree(key)));
  });

  it('an air + fire DUAL-gate kineticist: kinetic-gate\'s junction list stays as printed (no junction owned); elemental-blast highlights both blasts', () => {
    // batch card premise: class-feature-596 "In addition, you gain an impulse junction" (printed under Single Gate only; Dual Gate grants none)
    const scope = scopeOfCharacter(build('kineticist', 1, { extraChoices: { element: ['air-gate', 'fire-gate'] } }))!;
    expect(scope.elements).toEqual({ owned: ['air', 'fire'] });
    expect(classPicksOf(scope, 'classFeatures:kinetic-gate')).toEqual([]);
    expect(draw('classFeatures:kinetic-gate', scope)).toBe(tree('classFeatures:kinetic-gate'));
    // The same answer step 13a gives on the element page: the Single Gate junction is not this character's.
    expect(shape(scopeTree(tree('element:air'), scope)).folds).toContain('pick(1):Impulse Junction (Single Gate)');
    // batch card premise: action-2125 "Choose one of your kinetic elements"
    const key = 'classFeatures:elemental-blast';
    expect(classPicksOf(scope, key)).toEqual(['Air', 'Fire']);
    const t = draw(key, scope);
    expect(highlighted(t).map((h) => h.split(' ')[0])).toEqual(['Air', 'Fire']);
    expect(pickFolds(t).map((f) => [f.foldIds?.length, f.options])).toEqual([[4, ['Earth', 'Metal', 'Water', 'Wood']]]);
    expect(charBag(t)).toBe(charBag(tree(key)));
  });

  it('a kinetic gate never answers another page\'s Air … Wood: elemental-eidolon (the eidolon\'s Elemental Core) stays as printed', () => {
    // batch card premise: eidolon-12 "Your eidolon is formed from elemental air"
    const key = 'classFeatures:elemental-eidolon';
    for (const element of [['air-gate'], ['air-gate', 'fire-gate']]) {
      const scope = scopeOfCharacter(build('kineticist', 5, { extraChoices: { element } }))!;
      expect(classPicksOf(scope, key)).toEqual([]);
      const t = draw(key, scope);
      expect(pickFolds(t)).toEqual([]); // (its level folds, step 13a, are another matter)
      expect(highlighted(t)).toEqual([]);
      expect(charBag(t)).toBe(charBag(tree(key)));
    }
    // The guard's grid agrees: no element scope on that page, so it is never judged folded.
    expect(classPickScopes(tree(key), classPickLabels(content()), key)).toEqual([]);
    // Its own row pick (FeatDetail) still scopes it.
    const row = withPick({ level: 20 }, 'classFeatures', 'elemental-eidolon', 'Fire');
    expect(highlighted(draw(key, row)).map((h) => h.split(' ')[0])).toEqual(['Fire:']);
  });

  it('a Warpriest of a healing deity: divine-font highlights Healing Font and folds Harmful Font', () => {
    const ch = build('cleric', 5, { subclassId: 'warpriest', deityId: 'sarenrae', divineFont: 'heal' });
    const scope = scopeOfCharacter(ch)!;
    expect(classPicksOf(scope)).toEqual(['Warpriest', 'Healing Font']);
    const t = draw('classFeatures:divine-font', scope);
    expect(highlighted(t)).toEqual([expect.stringMatching(/^Healing Font:? /)]);
    expect(pickFolds(t).map((f) => f.options)).toEqual([['Harmful Font']]);
  });

  it('class picks reach only classFeatures pages, never with a row pick, never a block they name no option of', () => {
    const kin = scopeOfCharacter(build('kineticist', 5, { extraChoices: { element: ['air-gate'] } }))!;
    // A feat page with the same Air … Wood block: a feat's pick is its row's, never the class's.
    expect(draw('feats:elemental-familiar', kin)).toBe(tree('feats:elemental-familiar'));
    // No record key: nothing.
    expect(scopeTree(tree('classFeatures:kinetic-gate'), kin)).toBe(tree('classFeatures:kinetic-gate'));
    // The row's own pick wins over the class picks.
    const row = withPick(kin, 'classFeatures', 'kinetic-gate', 'Water');
    expect(highlighted(draw('classFeatures:kinetic-gate', row)).map((h) => h.split(' ')[0])).toEqual(['Water']);
    // A Fencer opening divine-font (no option named): the page whole.
    const fencer = scopeOfCharacter(build('swashbuckler', 9, { subclassId: 'fencer' }))!;
    expect(draw('classFeatures:divine-font', fencer)).toBe(tree('classFeatures:divine-font'));
    // Nothing stored → no class picks (UNKNOWN ≠ EMPTY): a kineticist with no gate on record.
    const bare = scopeOfCharacter(build('kineticist', 5, { extraChoices: {} }))!;
    expect(bare.picks).toBeUndefined();
    expect(draw('classFeatures:kinetic-gate', bare)).toBe(tree('classFeatures:kinetic-gate'));
  });

  it('every class pick any character can carry, on every classFeatures page: the picked option open, the others folded, nothing deleted', () => {
    const labels = classPickLabels(content());
    const hits: string[] = [];
    for (const [id, src] of Object.entries(trees.classFeatures)) {
      const key = `classFeatures:${id}`;
      for (const scope of classPickScopes(src, labels, key)) {
        const t = scopeTree(src, scope, LEVEL_FOLDS, FUTURE_TREATMENT, key);
        if (t === src) continue;
        const pick = classPickOf(scope);
        hits.push(`${id}:${pick}`);
        expect(highlighted(t).length, `${key} ${pick}`).toBe(1);
        expect(highlighted(t)[0].toLowerCase().startsWith(pick.toLowerCase()), `${key} ${pick}`).toBe(true);
        expect(pickFolds(t).flatMap((f) => f.options ?? []).some((o) => o.toLowerCase() === pick.toLowerCase()), `${key} ${pick} folded`).toBe(false);
        expect(charBag(t), key).toBe(charBag(src));
      }
    }
    // Measured 2026-10-07 on the shipped trees (lane hh-lane-13c at 71f92af): 4 pages, 20 page/pick pairs —
    // the six elements only on the two pages a kinetic gate answers (ELEMENT_PICK_PAGES), never on
    // elemental-eidolon.
    expect([...new Set(hits.map((h) => h.split(':')[0]))].sort()).toEqual(['divine-font', 'elemental-blast', 'exemplary-finisher', 'kinetic-gate']);
    expect(hits.length).toBe(20);
  });

  it('the guard judges a classFeatures row on ANY card once per class pick that names an option; foldsOf re-checks them all', () => {
    const cfRow = { surface: 'statDetail', mode: 'mine', card: { printed: [] }, read: { bucket: 'classFeatures', slug: 'exemplary-finisher' }, own: { bucket: 'classFeatures', id: 'exemplary-finisher' } };
    const t = tree('classFeatures:exemplary-finisher');
    const grid = scopeGrid(cfRow, t, [], [], classPickLabels(content()));
    expect(grid).toEqual(['Battledancer', 'Braggart', 'Fencer', 'Gymnast', 'Rascal', 'Wit'].map((p) => ({ level: 20, picks: { [CLASS_PICKS]: p } })));
    const folds = foldsOf(cfRow, t);
    expect(folds.length).toBe(30); // six picks × five other styles
    expect(folds.every((f) => f.listed && /@class:/.test(f.id))).toBe(true);
    // A feat page has no class-pick grid.
    expect(scopeGrid({ ...cfRow, read: { bucket: 'feats', slug: 'elemental-familiar' } }, tree('feats:elemental-familiar'), [], [], classPickLabels(content()))).toEqual([]);
    // The six elements are judged only where a kinetic gate answers (stored as scopeOfCharacter stores
    // them, under the page's own key), never on elemental-eidolon.
    const elementGrid = (slug: string) => scopeGrid({ ...cfRow, read: { bucket: 'classFeatures', slug } }, tree(`classFeatures:${slug}`), [], [], classPickLabels(content())).filter((s: CardScope) => s.picks);
    const six = ['Air', 'Earth', 'Fire', 'Metal', 'Water', 'Wood'];
    expect(elementGrid('kinetic-gate')).toEqual(six.map((p) => ({ level: 20, picks: { 'classFeatures:*kinetic-gate': p } })));
    expect(elementGrid('elemental-blast')).toEqual(six.map((p) => ({ level: 20, picks: { 'classFeatures:*elemental-blast': p } })));
    expect(elementGrid('elemental-eidolon')).toEqual([]);
    // computeLedger's own call (ledgerGrid): the class grid on a classFeatures row, the row picks on a FeatDetail row.
    expect(ledgerGrid(content(), cfRow, t, [])).toEqual(grid);
    const featRow = { surface: 'featDetail', mode: 'mine', card: { printed: [] }, read: { bucket: 'feats', slug: 'iruxi-armaments' }, own: { bucket: 'feats', id: 'iruxi-armaments' } };
    // Card step 13b: iruxi-armaments' 5th-level prose gate puts the level grid in front of its picks.
    // batch card premise: feat-5633 "At 5th level, whenever you get a critical hit"
    expect(ledgerGrid(content(), featRow, tree('feats:iruxi-armaments'), [])).toEqual([...[1, 5, 9, 13, 17, 20].map((level) => ({ level })), ...['Claw', 'Fangs', 'Tail'].map((p) => ({ level: 20, picks: { 'feats:iruxi-armaments': p } }))]);
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* Card step 13b: PROSE GATES (docs/card-design.md section 3; section 9 row 13b).                      */
/* ------------------------------------------------------------------------------------------------ */

/**
 * The seeded 60-record hand check on the TREES (mulberry32 20261008, Fisher-Yates over the 164 pages whose
 * top-level prose opens with a level gate the parser names — every bucket; the scratch sheet
 * card-step13b-handcheck.json holds each record's clauses, paragraph hashes and the reading). Each entry:
 * the paragraphs that must fold WHOLE, each with the level it opens at — read off the page, written
 * before the ledger. [] = nothing of the page's prose may fold at any level: a 1st-level gate (every
 * character meets it), a class page (excluded bucket: the right fold is the class card's SECTION), a
 * paragraph only partly gated (breath-of-the-dragon: the breath's shape and save are the level-1 rules),
 * or a gate whose right fold the parser cannot read (marked "left whole, listed": shown whole, never
 * hidden, and LISTED in scripts/level-folds.mjs PROSE_EXCLUDED with the sheet's reason — RIGHT_FOLD_NOT_ENCODED).
 */
const HAND_CHECK: Record<string, [number, number][]> = {
  'actions:breath-weapon': [[5, 3]],
  'actions:swarming-assault': [[5, 3]],
  'archetype:munitions-master': [[7, 5]],
  'bloodline:draconic': [],
  'bloodline:wyrmblessed': [],
  'categoryPage:practices': [],
  'classFeatures:ability-boosts': [], // left whole, listed: the right fold is #3+#4 at 5 ("… at these levels")
  'classFeatures:adept-benefit-weapon': [[5, 5]],
  'classFeatures:bloodline-draconic': [],
  'classFeatures:bloodline-genie': [],
  'classFeatures:bloodline-wyrmblessed': [],
  'classFeatures:cleric-spellcasting': [],
  'classFeatures:druid-spellcasting': [],
  'classFeatures:esoteric-lore': [[4, 3]],
  'classFeatures:initiate-benefit-shield': [[5, 5]],
  'classFeatures:patron': [],
  'classFeatures:shield': [[5, 5]],
  'classFeatures:skillful-lessons': [], // left whole, listed: the right fold is #3 at 3 ("This feat must be …")
  'classFeatures:weapon': [[5, 5]],
  'classes:animist': [],
  'classes:commander': [],
  'classes:guardian': [],
  'classes:gunslinger': [],
  'classes:inventor': [],
  'classes:investigator': [],
  'classes:magus': [],
  'classes:monk': [],
  'classes:oracle': [],
  'classes:psychic': [],
  'classes:ranger': [],
  'classes:sorcerer': [],
  'classes:witch': [],
  'classes:wizard': [],
  'feats:advanced-red-mantis-magic': [], // left whole, listed: the right fold is #5+#6 at 8 / 10 ("You gain a … slot")
  'feats:analyze-weakness': [[5, 11]],
  'feats:bolster-soul-cage': [[5, 20]],
  'feats:breath-of-the-dragon': [],
  'feats:centaur-weapon-familiarity': [[5, 5]],
  'feats:covet-hoard': [[5, 11]],
  'feats:crimson-shroud': [[5, 10]],
  'feats:dragon-transformation': [[5, 18]],
  'feats:fleeing-shriek': [[5, 11]],
  'feats:halfling-weapon-familiarity': [[5, 5]],
  'feats:heaven-earth-encompassing-sleeves': [[6, 9]],
  'feats:iruxi-armaments': [[6, 5]],
  'feats:marshall-fiendish-forces': [[5, 20]],
  'feats:merfolk-weapon-familiarity': [[5, 5]],
  'feats:mobile-thralls': [], // left whole, listed: the right fold is #5 at 8 ("A flying thrall …")
  'feats:oni-weapon-familiarity': [[6, 5]],
  'feats:orc-weapon-familiarity': [[5, 5]],
  'feats:pirate-combat-training': [[5, 5]],
  'feats:ritualist-dedication': [[6, 8]],
  'feats:slayers-blessing': [[5, 14]],
  'feats:speak-with-days-long-dead': [[5, 12]],
  'feats:spell-gem': [[5, 18]],
  'feats:starlight-armor': [[6, 17]],
  'feats:surki-weapon-familiarity': [[5, 5]],
  'feats:tengu-weapon-familiarity': [[6, 5]],
  'feats:thunder-clap': [[5, 8]],
  'feats:wayang-weapon-familiarity': [[5, 5]],
};
/**
 * The sheet's `rightFoldNotEncoded` rows (card-step13b-handcheck.json): record → its gate paragraphs (the
 * parser's candidates) whose RIGHT fold the hand check found but the generator cannot encode. Each must be
 * LISTED in scripts/level-folds.mjs PROSE_EXCLUDED with the sheet's reason, never left whole by accident.
 */
const RIGHT_FOLD_NOT_ENCODED: Record<string, number[]> = {
  'classFeatures:ability-boosts': [3], // right fold #3+#4; #4 opens with no gate, so #3 is the candidate
  'classFeatures:skillful-lessons': [3],
  'feats:advanced-red-mantis-magic': [5, 6],
  'feats:mobile-thralls': [5],
};
/** The row's named case, not in the seeded 60: both gates fold whole, "If you do" inside #5. */
const OSTEO = 'feats:osteo-armaments';

/** The top-level indices of `src` a drawing folds that are NOT inside a level-titled section — the prose
 *  folds (a level section's title and words are step 13a's). Read by node identity: scopeTree moves the
 *  page's own nodes. */
function proseFolded(src: AstNode, drawn: AstNode): number[] {
  const top = src.c ?? [];
  const inSection = new Set<number>();
  for (let j = 0; j < top.length; j++) if (isLevelTitle(top[j])) for (let k = j + 1; k < sectionEnd(top, j); k++) inSection.add(k);
  const at = new Map(top.map((n, i) => [n, i] as const));
  const out: number[] = [];
  for (const f of foldNodesOf(drawn)) for (const k of f.c ?? []) {
    const i = at.get(k);
    if (i !== undefined && !inSection.has(i) && !isLevelTitle(k)) out.push(i);
  }
  return out.sort((a, b) => a - b);
}

describe('card step 13b: prose gates fold whole — the seeded 60-record hand check, 0 wrong folds', () => {
  it('the sample is the 60 records of the sheet', () => {
    expect(Object.keys(HAND_CHECK).length).toBe(60);
  });
  it('every hand-checked record, at every level 1–20: exactly the judged paragraphs fold, each below its own level and open from it', () => {
    const wrong: string[] = [];
    for (const [key, expected] of Object.entries(HAND_CHECK)) {
      const src = tree(key);
      for (let level = 1; level <= 20; level++) {
        const want = expected.filter(([, lv]) => level < lv).map(([i]) => i);
        const got = proseFolded(src, scopeTree(src, { level }));
        if (JSON.stringify(got) !== JSON.stringify(want)) wrong.push(`${key}@${level}: folded ${JSON.stringify(got)}, judged ${JSON.stringify(want)}`);
      }
    }
    expect(wrong).toEqual([]);
  });
  it('a fold is the gate paragraph itself, untouched; the paragraphs around it stay open; nothing is deleted', () => {
    for (const [key, expected] of Object.entries(HAND_CHECK)) {
      if (!expected.length) continue;
      const src = tree(key);
      const top = src.c ?? [];
      const below = Math.min(...expected.map(([, lv]) => lv)) - 1;
      const drawn = scopeTree(src, { level: below });
      const folds = foldNodesOf(drawn).filter((f) => (f.c ?? []).some((k) => expected.some(([i]) => k === top[i])));
      expect(folds.length, key).toBe(1);
      expect(folds[0].foldReason, key).toBe('future');
      const folded = proseFolded(src, drawn);
      for (const [i] of expected) {
        expect(folds[0].c?.includes(top[i]), `${key}#${i} inside the fold`).toBe(true);
        // A neighbouring paragraph of prose stays open; a later level SECTION that folds at the same
        // level may share the run (one "At higher levels (k)" line — initiate-benefit-shield's Adept).
        for (const j of [i - 1, i + 1]) if (top[j] && !expected.some(([e]) => e === j)) expect(folded.includes(j), `${key}#${i}'s neighbour #${j} stays open`).toBe(false);
      }
      expect(allText(drawn), key).toBe(allText(src));
    }
  });
});

describe('card step 13b: osteo-armaments folds each gated paragraph WHOLE (no orphan "If you do")', () => {
  // batch card premise: feat-9110 "If you do, the action gains the thrall trait"
  it('at 7 ONE "At higher levels (2)" fold holds paragraphs 5 and 6; "If you do" is inside it, never open', () => {
    const src = tree(OSTEO);
    const top = src.c ?? [];
    const t = scopeTree(src, { level: 7 });
    const f = foldNodesOf(t);
    expect(f.length).toBe(1);
    expect(f[0].foldIds).toEqual([`${OSTEO}#5`, `${OSTEO}#6`]);
    expect(f[0].c).toEqual([top[5], top[6]]);
    expect(foldText(f[0])).toMatch(/^At 8th level, you can destroy an adjacent thrall[\s\S]*If you do, the action gains the thrall trait[\s\S]*At 10th level, the weapon improves/);
    expect(openWords(t)).not.toMatch(/If you do|At 8th level|At 10th level/);
    expect(openWords(t)).toMatch(/You create a \+1 striking weapon/);
    expect(allText(t)).toBe(allText(src));
  });
  it('at 8 the 8th-level paragraph is open whole ("If you do" with it) and only the 10th-level one folds; at 10 the tree is returned as is', () => {
    const src = tree(OSTEO);
    const t8 = scopeTree(src, { level: 8 });
    expect(proseFolded(src, t8)).toEqual([6]);
    expect(openWords(t8)).toMatch(/At 8th level, you can destroy an adjacent thrall as part of using this action\. If you do, the action gains the thrall trait/);
    expect(scopeTree(src, { level: 10 })).toBe(src);
  });
  it('the verdict is the level rule at the gate\'s own level (a gate applied one level off is red)', () => {
    const [g8, g10] = LEVEL_FOLDS.prose![OSTEO];
    expect([g8.level, g10.level]).toEqual([8, 10]);
    expect([proseVerdict(g8, { level: 7 }), proseVerdict(g8, { level: 8 }), proseVerdict(g10, { level: 9 }), proseVerdict(g10, { level: 10 })]).toEqual(['future', 'open', 'future', 'open']);
  });
  it('the one switch reaches prose folds too: \'hide\' and \'grey\' carry the treatment', () => {
    const src = tree(OSTEO);
    expect(foldNodesOf(scopeTree(src, { level: 7 }, LEVEL_FOLDS, 'hide')).map((f) => f.treatment)).toEqual(['hide']);
    expect(foldNodesOf(scopeTree(src, { level: 7 }, LEVEL_FOLDS, 'grey')).map((f) => f.treatment)).toEqual(['grey']);
  });
});

describe('card step 13b: a changed page folds nothing it does not list, and the check names the record', () => {
  const edited = (): AstNode => {
    const src = tree(OSTEO);
    return { ...src, c: (src.c ?? []).map((n, i) => (i === 5 ? { t: 'p', c: [{ t: 'text', v: 'At 8th level, you can destroy an adjacent thrall as part of using this action.' }] } : n)) };
  };
  it('a gate paragraph whose words changed (its hash leaves the ledger) is NOT folded; the unchanged gate still is', () => {
    const t = edited();
    expect(proseFolded(t, scopeTree(t, { level: 7 }))).toEqual([6]);
    // The guard's own view: every fold it sees is listed.
    expect(foldsOf({ mode: 'mine', card: { printed: [] } }, t).filter((f) => !f.listed)).toEqual([]);
  });
  it('scripts/level-folds-check.mjs reports the changed record by name', () => {
    const trees0 = loadTrees();
    const t = edited();
    const tampered = { ...trees0, feats: { ...trees0.feats, 'osteo-armaments': t } };
    const problems = levelFoldProblems(readFileSync('scripts/data/level-folds.json', 'utf8'), undefined, { trees: tampered, core: loadCore() });
    expect(problems.some((p) => /^prose feats:osteo-armaments#5: hash [0-9a-f]{8} does not match the tree/.test(p))).toBe(true);
    expect(problems.some((p) => /^prose feats:osteo-armaments: differs from the generator/.test(p))).toBe(true);
  }, 120_000);
  it('a tampered prose hash on a scratch copy of the ledger is red, named by record and paragraph', () => {
    const ledger = JSON.parse(readFileSync('scripts/data/level-folds.json', 'utf8')) as LevelFoldLedger;
    ledger.prose![OSTEO][0].hash = '00000000';
    const problems = levelFoldProblems(JSON.stringify(ledger));
    expect(problems.some((p) => /^prose feats:osteo-armaments#5: hash 00000000 does not match the tree/.test(p))).toBe(true);
  }, 120_000);
});

describe('card step 13b: the guard\'s view of prose folds', () => {
  it('foldsOf re-hashes every folded prose paragraph against the ledger: on every ledger page, all listed', () => {
    const unlisted: string[] = [];
    let seen = 0;
    for (const key of Object.keys(LEVEL_FOLDS.prose ?? {})) {
      const [b] = key.split(':');
      if (!trees[b]) continue;
      for (const f of foldsOf({ mode: 'mine', card: { printed: [] } }, tree(key))) {
        if (f.id.startsWith('¶')) seen++;
        if (!f.listed) unlisted.push(`${key}|${f.id}`);
      }
    }
    expect(unlisted).toEqual([]);
    expect(seen).toBeGreaterThan(100);
  });
  it('a paragraph the ledger does not list is never folded, and foldsOf would call it unlisted', () => {
    const src = tree(OSTEO);
    const top = src.c ?? [];
    // A scratch ledger that lists paragraph 4 (the feat's level-1 rules) as an 8th-level gate draws a
    // fold of it; checked against the SHIPPED ledger that fold is unlisted.
    const scratch: LevelFoldLedger = { ...LEVEL_FOLDS, prose: { ...LEVEL_FOLDS.prose, [OSTEO]: [{ i: 4, level: 8, hash: paragraphHash(top, 4) }] } };
    const drawn = scopeTree(src, { level: 7 }, scratch);
    expect(proseFolded(src, drawn)).toEqual([4]);
    expect(ledgerHasProse(paragraphHash(top, 4))).toBe(false);
    expect(ledgerHasProse(paragraphHash(top, 5))).toBe(true);
    // And the shipped ledger never folds it.
    expect(proseFolded(src, scopeTree(src, { level: 1 }))).toEqual([5, 6]);
  });
});

describe('card step 13b: the generator\'s rules and exclusions (scripts/level-folds.mjs proseGatesOf)', () => {
  const gates = (key: string) => proseGatesOf(tree(key), key);
  it('a paragraph that goes on past its gate with an ungated sentence is left whole, with the sentence named', () => {
    expect(gates('feats:breath-of-the-dragon').gates).toEqual([]);
    const ex = gates('feats:breath-of-the-dragon').excluded as { i: number; level: number; reason: string }[];
    expect(ex.map((e) => [e.i, e.level])).toEqual([[5, 3]]);
    expect(ex[0].reason).toMatch(/^an ungated sentence follows the gate: "The shape of the breath, the damage type/);
  });
  it('later sentences that are themselves gates of the same or a higher level keep the paragraph whole-foldable (spell-gem, osteo-armaments)', () => {
    expect(gates('feats:spell-gem').gates.map((g: { i: number; level: number }) => [g.i, g.level])).toEqual([[5, 18]]);
    expect(gates(OSTEO).gates.map((g: { i: number; level: number }) => [g.i, g.level])).toEqual([[5, 8], [6, 10]]);
  });
  it('a 1st-level gate is no candidate at all (every character meets it); a class page is an excluded bucket', () => {
    expect(gates('classFeatures:cleric-spellcasting')).toEqual({ gates: [], excluded: [] });
    expect(PROSE_EXCLUDED_BUCKETS.classes).toMatch(/Attribute Boosts/);
    const fighter = gates('classes:fighter');
    expect(fighter.gates).toEqual([]);
    expect(fighter.excluded.length).toBeGreaterThan(0);
    expect(fighter.excluded.every((e: { reason: string }) => e.reason === 'bucket classes')).toBe(true);
  });
  it('every gate the hand check found a right fold for but the parser cannot encode is LISTED in PROSE_EXCLUDED (the sheet\'s reason), and nothing else is', () => {
    for (const [key, is] of Object.entries(RIGHT_FOLD_NOT_ENCODED)) {
      expect(HAND_CHECK[key], `${key} is in the seeded 60 and folds nothing`).toEqual([]);
      const g = gates(key);
      expect(g.gates, key).toEqual([]);
      for (const i of is) {
        const why = PROSE_EXCLUDED[`${key}#${i}` as keyof typeof PROSE_EXCLUDED] as string | undefined;
        expect((why ?? '').length, `${key}#${i} listed in PROSE_EXCLUDED, with a reason`).toBeGreaterThan(40);
        expect((g.excluded as { i: number; reason: string }[]).find((e) => e.i === i)?.reason, `${key}#${i}: the generator names the listing`).toBe(`reviewed: ${why}`);
      }
    }
    expect(Object.keys(PROSE_EXCLUDED).sort()).toEqual(Object.entries(RIGHT_FOLD_NOT_ENCODED).flatMap(([k, is]) => is.map((i) => `${k}#${i}`)).sort());
  });

  // Synthetic trees (never a real page): each exclusion rule that no shipped page reaches today — every
  // real candidate it would catch is caught earlier by the ungated-sentence rule — is exercised here, so
  // deleting the rule turns its case red. The control is the same shape with the rule's trigger removed.
  const para = (v: string): AstNode => ({ t: 'p', c: [{ t: 'text', v }] });
  const synth = (...c: AstNode[]): AstNode => ({ t: 'doc', c: [{ t: 'title', c: [{ t: 'text', v: 'Synthetic Feat' }], level: '1', right: 'Feat 4' }, para('You can do the base thing.'), ...c] });
  const verdict = (t: AstNode) => {
    const r = proseGatesOf(t, 'feats:synthetic-feat');
    return { gates: (r.gates as { i: number }[]).map((g) => g.i), reasons: (r.excluded as { reason: string }[]).map((e) => e.reason.replace(/: ".*$/, '')) };
  };
  it('control: a lone "At 8th level, you …" paragraph is a gate', () => {
    expect(verdict(synth(para('At 8th level, you gain a +1 circumstance bonus to the check.')))).toEqual({ gates: [2], reasons: [] });
  });
  it('rule OTHER_SUBJECT: a gated clause about another thing\'s level (a relic, an army, a target) is left whole', () => {
    expect(verdict(synth(para('At 5th level and every 5 levels thereafter, the relic gains another gift.')))).toEqual({ gates: [], reasons: ['the gated clause is about another thing\'s level'] });
  });
  it('rule next-block-continues: a gate paragraph the next block goes on from (a glyph, a lower-case run) is left whole', () => {
    expect(verdict(synth(para('At 8th level, you can use this ability as'), { t: 'actions', string: 'Reaction' }))).toEqual({ gates: [], reasons: ['the next block continues the printed line'] });
    expect(verdict(synth(para('At 8th level, you gain a fly Speed'), para('equal to your land Speed.')))).toEqual({ gates: [], reasons: ['the next block continues the printed line'] });
  });
  it('rule BACK_REFERENCE: a gate whose next paragraph refers back to it ("at these levels", "If you do") is left whole', () => {
    expect(verdict(synth(para('At 5th level and every 5 levels thereafter, you gain a boost.'), para('Your companion also gains a boost at these levels.')))).toEqual({ gates: [], reasons: ['the next paragraph refers back to the gate'] });
    expect(verdict(synth(para('At 8th level, you can destroy an adjacent thrall.'), para('If you do, you gain temporary Hit Points.')))).toEqual({ gates: [], reasons: ['the next paragraph refers back to the gate'] });
  });
  it('rule list-introduction: a gate that ends in a colon before a list or table is left whole (the list is its body)', () => {
    const list: AstNode = { t: 'ul', c: [{ t: 'li', c: [para('A fly Speed of 20 feet.')] }, { t: 'li', c: [para('A swim Speed of 20 feet.')] }] };
    expect(verdict(synth(para('At 8th level, choose one of the following:'), list))).toEqual({ gates: [], reasons: ['the gate introduces the list or table after it'] });
    // Control: the same list after a gate that ends in a full stop is the next block, not the gate's body.
    expect(verdict(synth(para('At 8th level, you gain one more option.'), list))).toEqual({ gates: [2], reasons: [] });
  });
  it('the census (measured 2026-10-08 on the lane\'s shipped trees): 104 prose gates on 102 pages; 171 candidates left whole', () => {
    const { ledger, report } = generateLevelFolds();
    expect(Object.keys(ledger.prose).length).toBe(102);
    expect(Object.values(ledger.prose).flat().length).toBe(104);
    expect(report.proseExcluded.length).toBe(171);
    expect(report.proseExcluded.filter((e: { reason: string }) => e.reason === 'bucket classes').length).toBe(156);
  }, 120_000);
});

describe('card step 13b: a prose fold names its OWN page (the ledger\'s prose keyed by page and hash)', () => {
  const ids = (t: AstNode) => foldNodesOf(t).map((f) => f.sectionIds);
  it('actions:furious-strike and its classFeatures copy print one gate paragraph (one hash): each fold names its own page', () => {
    const a = tree('actions:furious-strike');
    const c = tree('classFeatures:furious-strike');
    expect(paragraphHash(a.c ?? [], 5)).toBe(paragraphHash(c.c ?? [], 5));
    expect(LEVEL_FOLDS.prose?.['actions:furious-strike']?.map((g) => [g.i, g.level])).toEqual([[5, 10]]);
    expect(ids(scopeTree(a, { level: 9 }))).toEqual([['actions:furious-strike#5']]);
    // The card that opened the classFeatures record names that record's page …
    expect(ids(scopeTree(c, { level: 9 }, LEVEL_FOLDS, FUTURE_TREATMENT, 'classFeatures:furious-strike'))).toEqual([['classFeatures:furious-strike#5']]);
    // … and with no record named, the page the copy's title links to (the Archives page it is).
    expect(pageRefOf(c.c ?? [])).toBe('actions:furious-strike');
    expect(ids(scopeTree(c, { level: 9 }))).toEqual([['actions:furious-strike#5']]);
    expect(scopeTree(a, { level: 10 })).toBe(a);
  });
  it('on every loaded ledger page whose gate hash another page shares, the fold names the record the card opened', () => {
    const byHash = new Map<string, string[]>();
    for (const [key, list] of Object.entries(LEVEL_FOLDS.prose ?? {})) for (const g of list) byHash.set(g.hash, [...(byHash.get(g.hash) ?? []), key]);
    const wrong: string[] = [];
    let shared = 0;
    for (const [key, list] of Object.entries(LEVEL_FOLDS.prose ?? {})) {
      if (!trees[key.split(':')[0]]) continue;
      for (const g of list) {
        if ((byHash.get(g.hash) ?? []).length < 2) continue;
        shared++;
        // (Only the prose fold's id is judged here: a level SECTION's id comes from the section index.)
        const others = (byHash.get(g.hash) ?? []).filter((k) => k !== key).map((k) => `${k}#${g.i}`);
        const got = ids(scopeTree(tree(key), { level: g.level - 1 }, LEVEL_FOLDS, FUTURE_TREATMENT, key)).flat();
        if (!got.includes(`${key}#${g.i}`) || got.some((id) => others.includes(id) || id.includes('|'))) wrong.push(`${key}#${g.i}: ${JSON.stringify(got)}`);
      }
    }
    expect(wrong).toEqual([]);
    expect(shared).toBeGreaterThanOrEqual(10);
  });
  it('identical copies whose title names no page (adept/initiate/paragon-benefit-weapon, implement-9): folded, named as the set — never one page by guess', () => {
    const t = tree('classFeatures:adept-benefit-weapon');
    expect(pageRefOf(t.c ?? [])).toBeUndefined();
    const set = Object.keys(LEVEL_FOLDS.prose ?? {}).filter((k) => LEVEL_FOLDS.prose![k].some((g) => g.hash === paragraphHash(t.c ?? [], 5)));
    expect(set.length).toBeGreaterThan(1);
    // The prose fold only (the page's later level SECTIONS fold in a run of their own, from the section index).
    const proseIds = (d: AstNode) => foldNodesOf(d).filter((f) => f.c?.includes((t.c ?? [])[5])).map((f) => f.sectionIds);
    expect(proseIds(scopeTree(t, { level: 4 }))).toEqual([[`${set.join('|')}#5`]]);
    expect(proseIds(scopeTree(t, { level: 4 }, LEVEL_FOLDS, FUTURE_TREATMENT, 'classFeatures:adept-benefit-weapon'))).toEqual([['classFeatures:adept-benefit-weapon#5']]);
    // A shared hash whose pages disagree on the level is no gate at all without a named page.
    const split: LevelFoldLedger = { ...LEVEL_FOLDS, prose: Object.fromEntries(Object.entries(LEVEL_FOLDS.prose ?? {}).map(([k, l]) => [k, k === set[0] ? l.map((g) => ({ ...g, level: g.level + 1 })) : l])) };
    expect(proseIds(scopeTree(t, { level: 4 }, split))).toEqual([]);
  });
  it('ledgerHasProse asked for a page answers for that page only', () => {
    const h = paragraphHash(tree('actions:furious-strike').c ?? [], 5);
    expect([ledgerHasProse(h), ledgerHasProse(h, LEVEL_FOLDS, 'actions:furious-strike'), ledgerHasProse(h, LEVEL_FOLDS, 'classFeatures:furious-strike'), ledgerHasProse(h, LEVEL_FOLDS, 'feats:osteo-armaments')]).toEqual([true, true, true, false]);
  });
});

describe('follow-ups: a level SECTION fold names its own page too (the 13a index keyed by page and hash)', () => {
  const ids = (t: AstNode) => foldNodesOf(t).flatMap((f) => f.sectionIds ?? []);
  const at = (key: string) => [5, 6, 8, 10].map((i) => `${key}#${i}`);
  it('classFeatures:shield prints implement:shield\'s sections word for word: opened as itself, every fold id names classFeatures:shield', () => {
    const src = tree('classFeatures:shield');
    const h = LEVEL_FOLDS.pages['classFeatures:shield'][0].hash;
    expect(Object.keys(LEVEL_FOLDS.pages).filter((k) => LEVEL_FOLDS.pages[k].some((e) => e.hash === h)).sort()).toEqual([
      'classFeatures:adept-benefit-shield', 'classFeatures:initiate-benefit-shield', 'classFeatures:paragon-benefit-shield', 'classFeatures:shield', 'implement:shield',
    ]);
    // The prose gate (#5) and the three level sections (#6, #8, #10), all of the record the card opened.
    expect(ids(scopeTree(src, { level: 4 }, LEVEL_FOLDS, FUTURE_TREATMENT, 'classFeatures:shield'))).toEqual(at('classFeatures:shield'));
    expect(ids(scopeTree(tree('implement:shield'), { level: 4 }, LEVEL_FOLDS, FUTURE_TREATMENT, 'implement:shield'))).toEqual(at('implement:shield'));
    expect(ids(scopeTree(tree('classFeatures:adept-benefit-shield'), { level: 4 }, LEVEL_FOLDS, FUTURE_TREATMENT, 'classFeatures:adept-benefit-shield'))).toEqual(at('classFeatures:adept-benefit-shield'));
    // With no record named: the page the copy's title links to, for sections and prose alike (never a mix).
    expect(pageRefOf(src.c ?? [])).toBe('implement:shield');
    expect(ids(scopeTree(src, { level: 4 }))).toEqual(at('implement:shield'));
  });
  it('on every loaded ledger page whose section hash another page shares, every section fold names the record the card opened', () => {
    const byHash = new Map<string, string[]>();
    for (const [key, list] of Object.entries(LEVEL_FOLDS.pages)) for (const e of list) byHash.set(e.hash, [...(byHash.get(e.hash) ?? []), key]);
    const wrong: string[] = [];
    let shared = 0;
    for (const [key, list] of Object.entries(LEVEL_FOLDS.pages)) {
      if (!trees[key.split(':')[0]] || !list.some((e) => (byHash.get(e.hash) ?? []).length > 1)) continue;
      shared++;
      // Level 0: every listed section of the page folds (an ownership gate folds it as 'pick' — still its id).
      const got = ids(scopeTree(tree(key), { level: 0 }, LEVEL_FOLDS, FUTURE_TREATMENT, key));
      const want = list.map((e) => `${key}#${e.i}`);
      if (!want.every((id) => got.includes(id)) || got.some((id) => !id.startsWith(`${key}#`))) wrong.push(`${key}: ${JSON.stringify(got)}`);
    }
    expect(wrong).toEqual([]);
    expect(shared).toBeGreaterThanOrEqual(20);
  });
});

describe('follow-ups: a page the generator left whole never borrows another page\'s identical gate', () => {
  const para = (v: string): AstNode => ({ t: 'p', c: [{ t: 'text', v }] });
  /** A synthetic classes page whose title and one paragraph equal osteo-armaments' title and its listed
   *  8th-level gate (#5): the same hash. The generator never lists a classes page (an excluded bucket). */
  const synthetic = (): AstNode => {
    const ftop = tree(OSTEO).c ?? [];
    const title = ftop.find((n) => n.t === 'title' && Number(n.level ?? 1) <= 1)!;
    return { t: 'doc', c: [{ t: 'title', level: '1', right: title.right, c: [{ t: 'text', v: foldText(title) }] }, para('You can do the base thing.'), ftop[5]] };
  };
  const KEY = 'classes:synthetic-class';
  it('opened as its own key it folds NOTHING — whether the ledger lists that page not at all or with another paragraph', () => {
    const t = synthetic();
    const h = paragraphHash(tree(OSTEO).c ?? [], 5);
    expect(paragraphHash(t.c ?? [], 2)).toBe(h);
    expect(Object.keys(LEVEL_FOLDS.prose ?? {}).filter((k) => LEVEL_FOLDS.prose![k].some((g) => g.hash === h))).toEqual([OSTEO]);
    expect(scopeTree(t, { level: 7 }, LEVEL_FOLDS, FUTURE_TREATMENT, KEY)).toBe(t);
    const listedOther: LevelFoldLedger = { ...LEVEL_FOLDS, prose: { ...LEVEL_FOLDS.prose, [KEY]: [{ i: 1, level: 8, hash: paragraphHash(t.c ?? [], 1) }] } };
    expect(foldNodesOf(scopeTree(t, { level: 7 }, listedOther, FUTURE_TREATMENT, KEY)).map((f) => f.sectionIds)).toEqual([[`${KEY}#1`]]);
    // Control: the feat itself, opened as itself, folds its gate.
    expect(foldNodesOf(scopeTree(tree(OSTEO), { level: 7 }, LEVEL_FOLDS, FUTURE_TREATMENT, OSTEO)).map((f) => f.sectionIds)).toEqual([[`${OSTEO}#5`, `${OSTEO}#6`]]);
  });
  it('a drawing with no record named still takes the identical copy — and the guard, judging on the row\'s own page, calls that fold unlisted', () => {
    const t = synthetic();
    expect(foldNodesOf(scopeTree(t, { level: 7 })).map((f) => f.sectionIds)).toEqual([[`${OSTEO}#5`]]);
    const row = (bucket: string, slug: string) => ({ mode: 'mine', card: { printed: [] }, read: { bucket, slug } });
    const own = foldsOf(row('classes', 'synthetic-class'), t);
    expect(own.length).toBe(2); // folded at grid levels 1 and 5
    expect(own.every((f) => !f.listed)).toBe(true);
    // Control: judged as the feat's own page, the same fold is listed.
    expect(foldsOf(row('feats', 'osteo-armaments'), t).every((f) => f.listed)).toBe(true);
  });
});

describe('follow-ups: two same-level gate paragraphs that open alike are two folds, each judged', () => {
  const para = (v: string): AstNode => ({ t: 'p', c: [{ t: 'text', v }] });
  const KEY = 'feats:synthetic-twin';
  const twin = (): AstNode => ({ t: 'doc', c: [
    { t: 'title', c: [{ t: 'text', v: 'Synthetic Twin' }], level: '1', right: 'Feat 4' },
    para('You can do the base thing.'),
    para('At 8th level, you gain a +1 circumstance bonus to Athletics checks.'),
    para('At 8th level, you gain a +1 circumstance bonus to Acrobatics checks.'),
  ] });
  const row = { mode: 'mine', card: { printed: [] }, read: { bucket: 'feats', slug: 'synthetic-twin' } };
  it('both listed on the page: four folds judged (two paragraphs × grid levels 1 and 5), all listed', () => {
    const t = twin();
    const top = t.c ?? [];
    expect(foldText(top[2]).slice(0, 40)).toBe(foldText(top[3]).slice(0, 40));
    const ledger: LevelFoldLedger = { ...LEVEL_FOLDS, prose: { ...LEVEL_FOLDS.prose, [KEY]: [{ i: 2, level: 8, hash: paragraphHash(top, 2) }, { i: 3, level: 8, hash: paragraphHash(top, 3) }] } };
    const f = foldsOf(row, t, [], ledger);
    expect(f.length).toBe(4);
    expect(f.every((x) => x.listed)).toBe(true);
  });
  it('one listed on the page, one only on another page: the second is judged too, and unlisted', () => {
    const t = twin();
    const top = t.c ?? [];
    const ledger: LevelFoldLedger = { ...LEVEL_FOLDS, prose: { ...LEVEL_FOLDS.prose, [KEY]: [{ i: 2, level: 8, hash: paragraphHash(top, 2) }], 'feats:synthetic-other': [{ i: 3, level: 8, hash: paragraphHash(top, 3) }] } };
    const f = foldsOf(row, t, [], ledger);
    expect(f.map((x) => x.listed)).toEqual([true, false, true, false]);
  });
});

describe('follow-ups round 2: a record is judged on the page whose tree it DRAWS (page slices)', () => {
  /** Every bucket a ledger page or a slice onto one lives in, read once, apart from the shared `trees`. */
  const drawnTrees: Record<string, Record<string, AstNode>> = {};
  const SLICES = (PAGE_SLICES_JSON as unknown as { slices: Record<string, { bucket: string; page: string; kind: string }> }).slices;
  const treeOf = (b: string, s: string): AstNode | undefined => drawnTrees[b]?.[s];
  /** The tree a row draws, as RecordCard draws it (recordTree, then withoutItemLists), and its page key. */
  const drawn = (key: string): { tree?: AstNode; page: string; whole: boolean } => {
    const at = key.indexOf(':');
    const s = SLICES[key];
    const t = recordTree(key.slice(0, at), key.slice(at + 1), treeOf);
    return { tree: t ? withoutItemLists(t) : undefined, page: s ? `${s.bucket}:${s.page}` : key, whole: s?.kind === 'page' };
  };
  const ids = (t: AstNode) => foldNodesOf(t).flatMap((f) => f.sectionIds ?? []);
  beforeAll(() => {
    const buckets = new Set(Object.keys(LEVEL_FOLDS.pages).map((k) => k.split(':')[0]));
    for (const s of Object.values(SLICES)) if (LEVEL_FOLDS.pages[`${s.bucket}:${s.page}`]) buckets.add(s.bucket);
    for (const b of buckets) drawnTrees[b] = JSON.parse(gunzipSync(readFileSync(`public/ast/${b}.json.gz`)).toString('utf8'));
  });
  it('classFeatures:decay-instinct and ligneous-instinct, opened as themselves, fold exactly as the instinct page they draw', () => {
    expect(ledgerKeyOf('classFeatures:decay-instinct')).toBe('instinct:decay');
    expect(ledgerKeyOf('classFeatures:ligneous-instinct')).toBe('instinct:ligneous');
    for (const [key, want] of [['classFeatures:decay-instinct', ['Specialization Ability', 'Raging Resistance']], ['classFeatures:ligneous-instinct', ['Raging Resistance']]] as const) {
      const d = drawn(key);
      const page = drawnTrees.instinct[d.page.split(':')[1]];
      for (const level of [0, 4, 6, 8]) {
        const mine = scopeTree(d.tree!, { level }, LEVEL_FOLDS, FUTURE_TREATMENT, key);
        const asPage = scopeTree(withoutItemLists(page), { level }, LEVEL_FOLDS, FUTURE_TREATMENT, d.page);
        // Specialization Ability is a 7th-level section, Raging Resistance a 9th-level one.
        const folded = want.filter((title) => level < (title === 'Specialization Ability' ? 7 : 9));
        expect(foldNodesOf(mine).flatMap((f) => (f.c ?? []).filter(isLevelTitle).map((x) => foldText(x).trim())), `${key}@${level}`).toEqual(folded);
        expect(JSON.stringify(mine), `${key}@${level} draws as ${d.page}`).toBe(JSON.stringify(asPage));
      }
    }
  });
  it('GUARD: for every row that draws a ledger page, drawing it with the record named at level 0 folds every section the ledger lists for that page', () => {
    const rows = [...Object.keys(LEVEL_FOLDS.pages), ...Object.keys(SLICES).filter((k) => LEVEL_FOLDS.pages[`${SLICES[k].bucket}:${SLICES[k].page}`])];
    const wrong: string[] = [];
    let judged = 0, sliced = 0;
    for (const key of rows) {
      const d = drawn(key);
      if (!d.tree) { wrong.push(`${key}: draws no tree`); continue; }
      const top = d.tree.c ?? [];
      const inTree = new Set<string>();
      for (let j = 0; j < top.length; j++) if (isLevelTitle(top[j])) inTree.add(sectionHash(top, j));
      // A slice of kind 'page' draws the whole page, so it holds every listed section. Any other row holds
      // the listed sections its drawn tree prints: a cut (a section / item slice, or the variantSection cut
      // that leaves an implement benefit row only its own benefit section) folds the ones it keeps.
      const want = LEVEL_FOLDS.pages[d.page].filter((e) => d.whole || inTree.has(e.hash));
      if (!want.length) continue;
      judged++;
      if (key !== d.page) sliced++;
      const got = ids(scopeTree(d.tree, { level: 0 }, LEVEL_FOLDS, FUTURE_TREATMENT, key));
      const missing = want.filter((e) => !got.includes(`${d.page}#${e.i}`)).map((e) => `${e.title}#${e.i}`);
      if (missing.length) wrong.push(`${key} (draws ${d.page}): ${missing.join(', ')} not folded; got ${JSON.stringify(got)}`);
    }
    expect(wrong).toEqual([]);
    // Measured 2026-10-08: 160 of the 190 ledger pages draw at least one listed section (the 30 implement
    // benefit rows draw their own benefit section only); decay- and ligneous-instinct are the sliced rows.
    expect(judged).toBeGreaterThanOrEqual(162);
    expect(sliced).toBeGreaterThanOrEqual(2);
  });
  it('a drawn page with no ledger entry at all falls back to the identical copy; a record drawing its own tree never does', () => {
    const KEY = 'classFeatures:decay-instinct';
    const d = drawn(KEY);
    const { ['instinct:decay']: listed, ...rest } = LEVEL_FOLDS.pages;
    const moved: LevelFoldLedger = { ...LEVEL_FOLDS, pages: { ...rest, 'instinct:decay-copy': listed } };
    expect(ledgerKeyOf(KEY, moved)).toBeUndefined();
    expect(ids(scopeTree(d.tree!, { level: 0 }, moved, FUTURE_TREATMENT, KEY))).toEqual(['instinct:decay-copy#7', 'instinct:decay-copy#9']);
    // The page itself, opened as itself, is its own tree: it borrows nothing from the copy.
    expect(ledgerKeyOf('instinct:decay', moved)).toBe('instinct:decay');
    expect(ids(scopeTree(withoutItemLists(drawnTrees.instinct.decay), { level: 0 }, moved, FUTURE_TREATMENT, 'instinct:decay'))).toEqual([]);
  });
  it('a pointer section names the subclass page the pointer reads (ptr.pageKey), never the identical copies of it', () => {
    const s5 = scopeOfCharacter(build('champion', 5, { subclassId: 'justice' }))!;
    const ptr = pointerOf('classFeatures', 'relentless-reaction', s5)!;
    expect(ptr.pageKey).toBe('classFeatures:justice');
    const h = LEVEL_FOLDS.pages['classFeatures:justice'].find((e) => e.title === 'Relentless Reaction')!.hash;
    expect(Object.keys(LEVEL_FOLDS.pages).filter((k) => LEVEL_FOLDS.pages[k].some((e) => e.hash === h)).sort()).toEqual(['cause:justice', 'classFeatures:justice']);
    const t5 = withPointer(tree('classFeatures:relentless-reaction'), tree(ptr.pageKey), ptr, s5);
    const f = (t5.c ?? [])[(t5.c ?? []).length - 1] as ScopedNode;
    expect(f.t).toBe('card-fold');
    expect(f.sectionIds).toEqual(['classFeatures:justice#8']);
  });
  it('an impulse "Level" line two pages list under one hash is read on the page the card opened', () => {
    const top: AstNode[] = [
      { t: 'title', c: [{ t: 'text', v: 'Synthetic Impulse' }], level: '1', right: 'Feat 4' },
      { t: 'p', c: [{ t: 'text', v: 'Level (+2) The damage increases by 1d6.' }] },
    ];
    const t: AstNode = { t: 'doc', c: top };
    const h = paragraphHash(top, 1);
    const ledger: LevelFoldLedger = { ...LEVEL_FOLDS, impulses: { ...LEVEL_FOLDS.impulses, 'feats:synthetic-impulse': [{ i: 1, hash: h, featLevel: 4, plus: 2 }], 'feats:synthetic-impulse-other': [{ i: 1, hash: h, featLevel: 4, plus: 10 }] } };
    const applies = (own: string | undefined, level: number) => !!((scopeTree(t, { level }, ledger, FUTURE_TREATMENT, own).c ?? [])[1] as ScopedNode).applies;
    expect(applies('feats:synthetic-impulse', 6)).toBe(true);
    expect(applies('feats:synthetic-impulse', 5)).toBe(false);
    expect(applies('feats:synthetic-impulse-other', 6)).toBe(false);
    expect(applies('feats:synthetic-impulse-other', 14)).toBe(true);
    // No record named: the two pages disagree, so neither entry is taken.
    expect(applies(undefined, 14)).toBe(false);
  });
});

describe('card step 13b-merge (ledger hygiene): a label inside the page\'s own BODY is not a second stat row (spell popup)', () => {
  const md = { parseBlocks: () => [], cleanRun: (s: string) => s };
  /** A spell popup row as surfaceRows builds it for a tree body (card step 17): the tree the popup DRAWS
   *  (spellCardModel's `drawn`) and the page rows it prints. */
  const spellRow = (id: string, printed: string[]) => {
    const model = spellCardModel(content().spells[id], tree(`spells:${id}`), []);
    expect(model.body, `${id} draws its page`).toBe('tree');
    expect(model.rows.map(([l]) => l), `${id}'s stat rows`).toEqual(printed);
    return { surface: 'spellDetail', bucket: 'spells', id, own: { bucket: 'spells', id }, read: { bucket: 'spells', slug: id }, drawn: model.drawn, card: { printed }, printed: model.rows, mode: 'mine', hideMeta: false, itemLists: true, md: '' };
  };
  const run = (...rs: [string, boolean?][]) => ({ runs: rs.map(([s, b]) => (b ? { b: s } : { t: s })), text: rs.map(([s]) => s).join('') });
  // batch card premise: spell-1547 "You conjure grease, choosing an area or target"
  it('grease: its choose-one options ("Area All solid ground …", "Target If you Cast the Spell …") are body prose — no DUPLICATED, no S3 for Area, Targets or Cast', () => {
    const r = judgeRow(spellRow('grease', ['Cast', 'Range', 'Area', 'Targets', 'Duration']), trees, md);
    expect(r.labels).toEqual({});
    expect(r.placement).toEqual([]);
    // The option lines are drawn, whole.
    const row = spellRow('grease', ['Cast', 'Range', 'Area', 'Targets', 'Duration']);
    const shown = treeBlocks(row.drawn, { card: { printed: new Set(row.card.printed) } }).filter((b: { shown: boolean }) => b.shown).map((b: { text: string }) => b.text);
    expect(shown.some((t: string) => /^Area All solid ground in the area is covered with grease\./.test(t))).toBe(true);
    expect(shown.some((t: string) => /^Target If you Cast the Spell on an unattended object/.test(t))).toBe(true);
  });
  // batch card premise: ritual-133 "Maximum Duration 5 days"
  it('perfection-of-essence: the poison\'s bold "Maximum Duration" is not a Duration header; its "Saving Throw" (Defense) stays, as the baseline lists', () => {
    const printed = ['Cast', 'Cost', 'Secondary Casters', 'Primary Check', 'Secondary Checks', 'Duration'];
    const r = judgeRow(spellRow('perfection-of-essence', printed), trees, md);
    expect(r.labels).toEqual({});
    expect(r.placement).toEqual(['Defense']);
  });
  it('a stat header drawn in the prose still counts (S3): a phrase value, an unbolded header, a reaction line cut at its bold "Effect"', () => {
    expect([...bodyLabels([run(['Area', true], [' 20-foot burst'])], 'spellDetail')]).toEqual(['Area']);
    expect([...bodyLabels([run(['Area', true], [' All ground is greasy. Each creature falls prone.'])], 'spellDetail')]).toEqual([]);
    expect([...bodyLabels([run(['Trigger', true], [' The target takes damage; '], ['Effect', true], [' You lose Hit Points. Then the spell ends.'])], 'spellDetail')]).toEqual(['Trigger']);
    expect([...plainHeaderLabels([run(['Cast 1 hour Area 30-foot burst centered on you Duration varies'])])].sort()).toEqual(['Area', 'Cast', 'Duration']);
    expect([...plainHeaderLabels([run(['Target', true], [' If you Cast the Spell on an object, it is slick.'])])]).toEqual([]);
    // Every other surface reads label lines as before (the rule is the spell popup's).
    expect([...bodyLabels([run(['Area', true], [' All ground is greasy. Each creature falls prone.'])], 'featDetail')]).toEqual(['Area']);
  });
});

describe('scripts/data/level-folds.json — two-way check', () => {
  const text = readFileSync('scripts/data/level-folds.json', 'utf8');
  it('equals the generator\'s output and every hash matches its tree (green)', () => {
    expect(serialize(generateLevelFolds().ledger)).toBe(text);
    expect(levelFoldProblems(text)).toEqual([]);
  }, 120_000);
  it('a tampered hash on a scratch copy is red, named by page and section', () => {
    const ledger = JSON.parse(text) as LevelFoldLedger;
    ledger.pages['cause:justice'][0].hash = '00000000';
    const problems = levelFoldProblems(JSON.stringify(ledger));
    expect(problems.some((p) => /^pages cause:justice#8 "Relentless Reaction": hash 00000000 does not match the tree/.test(p))).toBe(true);
    expect(problems.some((p) => /is not the generator's output/.test(p))).toBe(true);
  }, 120_000);
  it('the census it lists (measured 2026-10-03 on the shipped trees)', () => {
    const l = JSON.parse(text) as LevelFoldLedger;
    expect(Object.keys(l.pages).length).toBe(190);
    expect(Object.values(l.pages).flat().length).toBe(972);
    expect(Object.values(l.impulses).flat().length).toBe(92);
    expect(Object.keys(l.pointers).sort()).toEqual([
      'classFeatures:advanced-deed', 'classFeatures:advanced-vials', 'classFeatures:exalted-reaction', 'classFeatures:field-discovery',
      'classFeatures:greater-deed', 'classFeatures:greater-field-discovery', 'classFeatures:masterful-hunter', 'classFeatures:raging-resistance',
      'classFeatures:relentless-reaction',
    ]);
  });
});
