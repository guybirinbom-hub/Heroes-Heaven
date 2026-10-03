import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { build } from './_content';
import type { AstNode } from '../src/sheet/astStore';
import type { CardScope } from '../src/sheet/cardModel';
import {
  FUTURE_TREATMENT, LEVEL_FOLDS, foldNodesOf, foldText, foldsOf, isLevelTitle, pointerOf, scopeOfCharacter, scopeTree,
  sectionVerdict, withPointer, type LevelFoldLedger, type ScopedNode,
} from '../src/sheet/cardScope';
import { generateLevelFolds, serialize } from '../scripts/level-folds.mjs';
import { levelFoldProblems } from '../scripts/level-folds-check.mjs';

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
 */
const trees: Record<string, Record<string, AstNode>> = {};
const tree = (key: string): AstNode => {
  const [b, id] = key.split(':');
  const t = trees[b]?.[id];
  if (!t) throw new Error(`no tree ${key}`);
  return t;
};
beforeAll(() => {
  for (const b of ['classFeatures', 'implement', 'element', 'innovation', 'feats', 'cause', 'archetype']) {
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
      expect(shape(scopeTree(tree(other), one())), other).toEqual({ open: [], folds: ['pick(3):Adept Benefit+Intensify Benefit+Paragon Benefit'] });
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
    // An element the gate does not channel is another option.
    expect(shape(scopeTree(tree('element:water'), single))).toEqual({ open: [], folds: ['pick(3):Elemental Blast+Impulse Junction (Single Gate)+Gate Junction'] });
  });
  it('an armor inventor at 7: armor Breakthrough open, Revolutionary later; the weapon innovation page is another option', () => {
    const inv = scopeOfCharacter(build('inventor', 7, {}))!;
    expect(inv.innovation).toBe('armor');
    expect(shape(scopeTree(tree('innovation:armor'), inv))).toEqual({ open: ['Breakthrough Modifications'], folds: ['future(1):Revolutionary Modifications'] });
    expect(shape(scopeTree(tree('innovation:weapon'), inv))).toEqual({ open: [], folds: ['pick(2):Breakthrough Modifications+Revolutionary Modifications'] });
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
