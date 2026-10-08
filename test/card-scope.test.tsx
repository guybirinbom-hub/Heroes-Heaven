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
} from '../src/sheet/cardScope';
import { generateLevelFolds, serialize } from '../scripts/level-folds.mjs';
import { levelFoldProblems } from '../scripts/level-folds-check.mjs';
import { scopeGrid, recordPickLabels, pickOwnOf, classPickLabels, judgeRow, ledgerGrid } from '../scripts/lib/card-scope.mjs';

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
 */
const trees: Record<string, Record<string, AstNode>> = {};
const tree = (key: string): AstNode => {
  const [b, id] = key.split(':');
  const t = trees[b]?.[id];
  if (!t) throw new Error(`no tree ${key}`);
  return t;
};
beforeAll(() => {
  for (const b of ['classFeatures', 'implement', 'element', 'innovation', 'feats', 'cause', 'archetype', 'heritages']) {
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
    expect(folds.map((f) => f.id).sort()).toEqual(['Claws@pick:Fangs', 'Claws@pick:Tail', 'Fangs@pick:Claws', 'Fangs@pick:Tail', 'Tail@pick:Claws', 'Tail@pick:Fangs']);
    expect(folds.every((f) => f.listed)).toBe(true);
    // A surface that never hands its card a pick has no pick grid.
    expect(foldsOf({ ...featRow, surface: 'statDetail' }, tree('feats:iruxi-armaments'))).toEqual([]);
  });
  it('the ledger judges a FeatDetail row once per pick its record can carry (its own choice labels)', () => {
    const labels = recordPickLabels(content(), featRow.own);
    expect(labels).toEqual(['Claw', 'Fangs', 'Tail']);
    expect(pickOwnOf(featRow)).toBe('feats:iruxi-armaments');
    const grid = scopeGrid(featRow, tree('feats:iruxi-armaments'), [], labels);
    expect(grid).toEqual(labels.map((p) => ({ level: 20, picks: { 'feats:iruxi-armaments': p } })));
    expect(scopeGrid({ ...featRow, surface: 'statDetail' }, tree('feats:iruxi-armaments'), [], labels)).toEqual([]);
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
    expect(ledgerGrid(content(), featRow, tree('feats:iruxi-armaments'), [])).toEqual(['Claw', 'Fangs', 'Tail'].map((p) => ({ level: 20, picks: { 'feats:iruxi-armaments': p } })));
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
