// @vitest-environment jsdom
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { build, content } from './_content';
import { ContentContext } from '../src/sheet/ContentContext';
import { PinContext } from '../src/sheet/PinContext';
import { loadAstIndex, loadBucketAst, type AstNode } from '../src/sheet/astStore';
import { StatDetailModal } from '../src/sheet/StatDetailModal';
import { RecordCard } from '../src/sheet/RecordCard';
import { FeatDetail, featStatRows } from '../src/sheet/FeatDetail';
import { featEntries } from '../src/sheet/FeatsTab';
import { itemStatRows } from '../src/sheet/ItemDetail';
import { spellStatRows } from '../src/sheet/SpellsTab';
import { parseBlocks, cleanRun } from '../src/sheet/RichText';
import { ACTIVITIES } from '../src/rules/actions';
import { FEAT_SITUATIONAL } from '../src/rules/situationalBonuses';
import { SHARED_FEATURE_FOOTER, classFeatureDescription, pageClassName, sharedFeatureFallback } from '../src/rules/featureText';
import { splitHeightening } from '../src/rules/heightening';
import { foldsOf } from '../src/sheet/cardScope';
import { cardOn } from '../src/sheet/cardSurfaces';
import { astSlug, bulletItems, isMetaP, isMetaishBlock, recordTree, runAnchor, sliceOf, textOf, variantSection, widerSectionRule, withoutLead, type PageSlice } from '../src/sheet/astVisibility';
import type { Character, ContentDatabase } from '../src/rules/types';
import { loadContent } from '../scripts/card-truth-check.mjs';
import { computeLedger } from '../scripts/lib/card-scope.mjs';
import {
  COVERAGE_GATE, EVIDENCE, censusResidue, computePageSlices, evidencedVariantSections, foreignLines, nodeEvidence, notOwnPageProblems,
  officialNoPage, ownSentences, pageSliceProblems, qualifierLine, residueWithoutSlices, ruleCWithoutQualifier, sentenceCoverage,
  sharedPageCensus, splitResidue, supersetSections, words,
} from '../scripts/lib/shared-page-census.mjs';
import NOT_OWN_PAGE from '../src/data/not-own-page.json';
import PAGE_SLICES from '../src/data/page-slices.json';

/**
 * Card step 12 (docs/card-design.md section 9 row 12, section 13's raised bar; docs/display-truth-plan.md
 * F5 / F6): CLASS FEATURES — and every record of a shared Archives page — OPEN THEIR OWN SECTION.
 *
 *  F5   src/sheet/astVisibility.ts variantSection finds the record's own level-2 section by four looser
 *       keys (aon- prefix, word order, the family's name words, spelling slack), each only when exactly one
 *       section qualifies. Measured on the shipped data with the census (scripts/lib/shared-page-census.mjs)
 *       against the pre-step cut: S2 falls by 289 (30 implement benefits + 259 items; the refuters' "290"
 *       counted aon-stone-object-low-grade, whose page has ONE section and so no cut), 0 records become
 *       wrong, and the 49 records the census already called right whose cut changed are pinned by name —
 *       each now shows its own grade / variant section instead of the whole family page.
 *  F6b  src/data/page-slices.json (scripts/page-slices.mjs): a record with no page of its own that lives
 *       inside a bigger page reads that paragraph / section / bullet / variant section / run of lines, cut
 *       at display time; a residue record whose own page holds a section carrying its whole name (a wand
 *       rank's "(4th-Rank Spell)") reads that section (R0). Where a cut ends is decided from the record's
 *       own text when the map is generated (round 2, the refuters' overrun cases): a paragraph stops at the
 *       first line that is another entry's, a section at a subsection none of whose words are the record's,
 *       and a whole page is shown only when it IS the record's text. Two-way checked.
 *  F6   src/data/not-own-page.json (scripts/not-own-page.mjs): the residue LESS the sliced records, split by
 *       the 60 % own-sentence gate against the mirror section: those that pass read NO tree — their popups
 *       fall back to their own text; the rest stay on their page (keptOnPage) and in the S2 baseline.
 *       Two-way checked by the ledger (scripts/lib/card-scope.mjs S2-NOT-OWN).
 *  F6c  src/rules/featureText.ts: a lead naming several classes ("**Witch, Wizard**") is an addendum for
 *       exactly those classes; the mine card draws a class feature the viewer's class shares whose page is
 *       another class's (sharedFeatureFallback — the guard's CLASS_MISMATCH rule: Weapon Specialization's
 *       page is the Thaumaturge's, Reflex Expertise's the Guardian's) from our older text, cut to the
 *       viewer's class, with "Not from the Archives — our text for your class".
 *
 * Every rendered case goes through the REAL StatDetailModal "Full text" (the mine card, scoped by the
 * synthesized character) or the real RecordCard (browse), never a re-implementation. Characters are
 * synthesized (build(class, level)); no owner data.
 *
 * MUTATION LINES (each measured red on 2026-10-06, then restored byte-exact from a scratch copy):
 *  - astVisibility.ts widerSectionRule: key (a) skipped → the aon-1st-rank-scroll and synthetic (a) cases red.
 *  - widerSectionRule: key (b) skipped → aether-marbles-greater and synthetic (b) cases red.
 *  - widerSectionRule: key (c) skipped → adept-benefit-amulet and synthetic (c) cases red (census −259).
 *  - widerSectionRule (c): the "a word not in the page title" guard removed → the base-grade case red.
 *  - widerSectionRule (d): the two-word floor removed → the Dragonet case red.
 *  - widerSectionRule: `decide` takes the first of several hits → the ambiguity case red.
 *  - useAst.ts: the isNotOwnPage early returns removed → the drake rifle fallback render red (round 2; the
 *    drake rifle reads its line since round 3, so the case is now a hollow puzzle box).
 *  - useAst.ts: the slice branch removed → the doctrine / field discovery / Accept Echo renders red.
 *  - astVisibility.ts sliceOf 'item': run to the paragraph's end instead of the next bullet → the doctrine
 *    case red ("Final Doctrine (19th)" shows).
 *  - featureText.ts leadClasses: one class name per lead (the old rule) → the wizard / druid cases red.
 *  - RecordCard.tsx: the shared-feature footer back to the plain no-page line → the wizard render red.
 *  - card-scope.mjs computeLedger: the notOwnPageProblems line removed → the two-way ledger case red.
 * Round 2 (the refuters' five defects), each measured red on 2026-10-06 and restored byte-exact
 * (scratch lane12f-mutate.mjs, Buffer.equals + sha1sum -c):
 *  - astVisibility.ts sliceOf 'block' ignores `n` (runs to the siblings' end) → the no-overrun guard and the
 *    paragraph-slice renders (twist-design, consume-flesh …) red.
 *  - sliceOf 'section' ignores `n` (structural end) → the no-overrun guard and anathema-cleric red.
 *  - sliceOf 'run' ignores `n` → the no-overrun guard and the Dragon Breath / Swirl Crimson Shroud render red.
 *  - shared-page-census.mjs variantSectionOf off; the whole page always kept (foreignLines skipped); the
 *    run's whole-sentence rule off; route R0 off; rankWords off; blockExtent's evidence stop off;
 *    sectionExtent's subsection stop off → page-slices.json no longer the computation (two-way) and the
 *    ledger case red, each.
 *  - featureText.ts sharedFeatureFallback's page-class branch off → the 151-row CLASS_MISMATCH coverage
 *    case and the bard Reflex Expertise / wizard Weapon Expertise renders red.
 *  - card-scope.mjs: not-own-page checked against the residue WITH the sliced records → the ledger case red.
 * Round 3 (the refuters' two defects), each measured red and restored byte-exact (scratch lane12x-mutate.mjs):
 *  - astVisibility.ts withoutLead returns the line unchanged (the bold lead kept under its own title) → the
 *    names-its-record-once case (273 slices) and the doubled-title render red.
 *  - shared-page-census.mjs route R0's line branch off → page-slices.json no longer the computation (two-way)
 *    and the ledger case red.
 *  - qualifierLine's sister-line margin off (any sister line with evidence rejects) → two-way + ledger red
 *    (the earth / metal familiars, whose lines share wording, lose their slices).
 *  - astVisibility.ts sliceOf 'line' keeps the dropped lines → the kind-"line" case and the renders red.
 *  - shared-page-census.mjs stemWord back to exact words → the raised-bar case, two-way and ledger red.
 *  - useAst.ts: the isNotOwnPage early returns removed → the hollow puzzle box fallback render red.
 * Round 4 (the fixer: the raised bar's old-text records whose own page IS their text), each measured red on
 * 2026-10-06 and restored byte-exact (scratch lane12-fx-mutate.mjs, Buffer.equals + sha1):
 *  - shared-page-census.mjs RIGHT_SAME_TEXT off (a byte-identical page with no foreign line stays
 *    WRONG_SHARED) → the residue count, mirror split, ledger and Oil / Ganjay Book render cases red (4).
 *  - evidencedVariantSection off (the hollow puzzle boxes) → two-way slices + ledger red.
 *  - the R0 run route off (Arcane Bond (Unified Magical Theory), Knight Vigilant Dedication, Wand of
 *    Refracting Rays (7th-Rank)) → two-way slices + ledger red.
 *  - ownRun's Special-line carry off → two-way slices + ledger red (Knight Vigilant Dedication's n 2 → 1).
 *  - astVisibility.ts sliceOf 'line': the anchor check dropped → the stale-line case red.
 *  - useAst.ts seed(): the slice branch off → the first-frame case red.
 * Round 5 (the refuter's two must-fixes), each measured red on 2026-10-06 and restored byte-exact (scratch
 * copies, cmp + sha1sum):
 *  - shared-page-census.mjs evidencedVariantSections: the one-section-per-qualifier branch off (single
 *    section again) → two-way slices, ledger and the hollow puzzle box render red (3).
 *  - astVisibility.ts sliceOf 'variant' ignores `also` → two-way, ledger, the puzzle box render and the
 *    synthetic `also` case red (4).
 *  - sliceOf 'run' ignores `head` → the Arcane Bond Source line and the wand first-frame header case red (2).
 *  - ownRun's `head: true` off → two-way slices + ledger red (2).
 *  - sharedPageCensus RIGHT_OWN_PAGE off → the residue count, mirror split, two-way, ledger and the Knight
 *    Vigilant Dedication whole-page case red (5).
 */

const LANE = process.cwd();
const noop = () => undefined;
const db: ContentDatabase = content();
const raw = loadContent(LANE) as Record<string, Record<string, { name?: string; description?: string; aonId?: string }>>;
const trees: Record<string, Record<string, AstNode>> = {};
let astIndex: Record<string, string> = {};
const treeOf = (b: string, s: string) => trees[b]?.[s];

beforeAll(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const f of readdirSync(join(LANE, 'public/ast')).filter((x) => x.endsWith('.json.gz')))
    trees[f.replace(/\.json\.gz$/, '')] = JSON.parse(gunzipSync(readFileSync(join(LANE, 'public/ast', f))).toString('utf8'));
  astIndex = JSON.parse(readFileSync(join(LANE, 'public/ast-index.json'), 'utf8'));
  vi.stubGlobal('fetch', async (url: string) => {
    if (/ast-index\.json$/.test(String(url))) return { ok: true, json: async () => astIndex };
    const m = /ast\/(\w+)\.json$/.exec(String(url));
    return m && trees[m[1]] ? { ok: true, json: async () => trees[m[1]] } : { ok: false };
  });
  await loadAstIndex();
  for (const b of ['classFeatures', 'items', 'actions', 'feats', 'element', 'classes', 'spells', 'familiarAbilities']) await loadBucketAst(b);
  if (!window.matchMedia)
    window.matchMedia = ((q: string) => ({ matches: false, media: q, onchange: null, addListener: noop, removeListener: noop, addEventListener: noop, removeEventListener: noop, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
}, 120_000);

/* ---------------------------------------------------------------------------------------------- */
/* F5 on synthesized pages (each key, each guard).                                                 */
/* ---------------------------------------------------------------------------------------------- */

const t = (v: string, level?: number | string, right?: string): AstNode => ({ t: 'title', level: level as number, ...(right ? { right } : {}), c: [{ t: 'text', v }] });
const p = (v: string): AstNode => ({ t: 'p', c: [{ t: 'text', v }] });
const page = (title: string, sections: string[]): AstNode => ({
  t: 'doc', c: [t(title, 1), p('Shared family text.'), ...sections.flatMap((s) => [t(s, 2), p(`Text of ${s}.`)])],
});
const cutTitle = (n: AstNode, slug: string) => {
  const c = variantSection(n, slug);
  return c === n ? null : textOf(c.c![0]).trim();
};

describe('F5: the record finds its own level-2 section', () => {
  it('the exact slug still decides first (unchanged)', () => {
    expect(cutTitle(page('Magic Wand', ['Magic Wand (1st-rank Spell)', 'Magic Wand (2nd-rank Spell)']), 'magic-wand-2nd-rank-spell')).toBe('Magic Wand (2nd-rank Spell)');
  });
  it('(a) a leading "aon-" is stripped', () => {
    expect(cutTitle(page('Magic Scroll', ['1st-rank Scroll', '2nd-rank Scroll']), 'aon-1st-rank-scroll')).toBe('1st-rank Scroll');
    expect(widerSectionRule(page('Magic Scroll', ['1st-rank Scroll', '2nd-rank Scroll']), 'aon-1st-rank-scroll').rule).toBe('a');
  });
  it('(b) the same words in any order, of/the dropped', () => {
    expect(cutTitle(page('Aether Marbles', ['Lesser Aether Marbles', 'Greater Aether Marbles']), 'aether-marbles-greater')).toBe('Greater Aether Marbles');
    expect(cutTitle(page('Flag of the Stronghold', ['Flag of the Stronghold', 'Major Flag of the Stronghold']), 'flag-stronghold-major')).toBe('Major Flag of the Stronghold');
  });
  it('(c) the name\'s words, on the family page: the page title is the qualifier or the name without it', () => {
    expect(cutTitle(page('Amulet', ['Initiate Benefit', 'Adept Benefit', 'Paragon Benefit']), 'adept-benefit-amulet')).toBe('Adept Benefit');
    expect(cutTitle(page('Energy Breath Potion', ['Energy Breath Potion (Lesser)', 'Energy Breath Potion (Greater)']), 'energy-breath-potion-acid-greater')).toBe('Energy Breath Potion (Greater)');
    // Not a family page (the title is neither the qualifier nor the head): no cut.
    expect(cutTitle(page('Trinkets', ['Initiate Benefit', 'Adept Benefit']), 'adept-benefit-amulet')).toBeNull();
  });
  it('(c) never takes the unnamed base grade or a one-word mode section', () => {
    expect(cutTitle(page('Olfactory Obfuscator', ['Olfactory Obfuscator', 'Greater Olfactory Obfuscator']), 'olfactory-obfuscator-lesser')).toBeNull();
    expect(cutTitle(page('Axe Musket', ['Melee', 'Ranged']), 'axe-musket-melee')).toBeNull();
  });
  it('(d) two letters of spelling slack, same words count and digits, two words or more', () => {
    expect(cutTitle(page('Peshspine Grenade', ['Peshspine Grenade (Lesser)', 'Peshspine Grenade (Greater)']), 'peshpine-grenade-greater')).toBe('Peshspine Grenade (Greater)');
    expect(cutTitle(page('Dragonet', ['Dragon', 'Wyrm']), 'dragonet')).toBeNull();
    expect(cutTitle(page('Magic Wand', ['Wand (1st)', 'Wand (2nd)']), 'wand-3rd')).toBeNull();
  });
  it('two sections qualify → no cut (a wrong cut is worse than the whole page)', () => {
    expect(cutTitle(page('Puzzle Box', ['Puzzle Box (Challenging)', 'Puzzle Box (Hollow)']), 'puzzle-box-challenging-hollow')).toBeNull();
    expect(cutTitle(page('Treats', ['Greater Treat', 'Treat, Greater', 'Lesser Treat']), 'greater-the-treat')).toBeNull();
    expect(cutTitle(page('Treats', ['Greater Treat', 'Lesser Treat']), 'greater-the-treat')).toBe('Greater Treat');
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* F5 on the shipped data: the census before / after.                                             */
/* ---------------------------------------------------------------------------------------------- */

/** The cut as it stood at 9612a13 (verbatim: the exact-slug key only). */
const flatRaw = (n: AstNode): string => (n.t === 'text' ? n.v ?? '' : (n.c ?? []).map(flatRaw).join(''));
function preStep12Cut(node: AstNode, slug: string): AstNode {
  const isSection = (n: AstNode) => n.t === 'title' && Number(n.level ?? 1) === 2;
  const top = node.c ?? [];
  let sections = 0, first = -1, mine = -1;
  for (let i = 0; i < top.length; i++) {
    if (!isSection(top[i])) continue;
    sections++;
    if (first < 0) first = i;
    if (mine < 0 && astSlug(flatRaw(top[i])) === slug) mine = i;
  }
  if (mine < 0 || sections < 2) return node;
  let end = top.length;
  for (let i = mine + 1; i < top.length; i++) if (isSection(top[i])) { end = i; break; }
  const shared = top.slice(0, first).filter((n) => !(n.t === 'title' && Number(n.level ?? 1) <= 1));
  return { ...node, c: [{ ...top[mine], level: 1 }, ...shared, ...top.slice(mine + 1, end)] };
}

/** The 49 records the census called RIGHT before step 12 whose cut F5 changed — every one now opens its
 *  own grade / variant section of the family page (reviewed by name, 2026-10-06). */
const RIGHT_RECUT = [
  'items:alacritous-horsehoes', 'items:aon-alacritous-horsehoes', 'items:aon-snare-kit', 'items:aon-submersible-helm',
  'items:bolkas-blessing-greater', 'items:bravery-baldric-greater-healthful', 'items:burglars-rosebud-greater', 'items:chromatic-robe-greater',
  'items:cleft-head-marking-lesser', 'items:dawnfire-beacon-major', 'items:endless-quiver-greater', 'items:ethereal-crescent-greater',
  'items:feral-linguist-greater', 'items:fireproof-gloves-greater', 'items:flag-of-the-stronghold-major', 'items:games-loaded-dice',
  'items:gasping-lament-greater', 'items:godrending-ammunition-greater', 'items:hexwise-banner-major', 'items:inspiring-spotlight-portable',
  'items:killers-belt-greater', 'items:kolss-oath-greater', 'items:mat-of-resilience', 'items:medics-armband-greater',
  'items:moritype-greater', 'items:portable-seal-lesser', 'items:portable-seal-major', 'items:portable-seal-moderate',
  'items:portable-weapon-mount-shielded-tripod', 'items:sailors-collar-greater', 'items:sihedron-ring-greater', 'items:skitter-knot-greater',
  'items:skitter-knot-lesser', 'items:skitter-knot-major', 'items:soldiers-syrup-greater', 'items:soldiers-syrup-lesser',
  'items:soldiers-syrup-major', 'items:soldiers-syrup-minor', 'items:soldiers-syrup-moderate', 'items:spore-shephards-staff',
  'items:spore-shephards-staff-major', 'items:submersible-helmet-greater', 'items:talonstrike-blade-greater', 'items:testudo-shield-greater',
  'items:toothy-knife-greater', 'items:vanishing-shocker-greater', 'items:vanishing-shocker-lesser', 'items:vanishing-shocker-major',
  'items:vanishing-shocker-moderate',
].sort();

describe('F5 on the shipped data (the census, before and after)', () => {
  it('S2 falls by 289 — 30 implement benefits and 259 items — and no record becomes wrong', () => {
    let before = 0, after = 0, newlyWrong = 0;
    const fixed: Record<string, number> = {};
    const rightRecut: string[] = [];
    const outsideCensus: string[] = [];
    for (const b of Object.keys(trees).sort()) {
      const recs = raw[b];
      if (!recs || typeof recs !== 'object') continue;
      const A = sharedPageCensus(trees[b], recs, { cut: preStep12Cut, all: true });
      const B = sharedPageCensus(trees[b], recs, { all: true });
      for (const slug of Object.keys(A)) {
        const aw = !A[slug].verdict.startsWith('RIGHT');
        const zw = !B[slug].verdict.startsWith('RIGHT');
        if (aw) before++;
        if (zw) after++;
        if (aw && !zw) fixed[b] = (fixed[b] ?? 0) + 1;
        if (!aw && zw) newlyWrong++;
      }
      for (const [slug, node] of Object.entries(trees[b])) {
        const changed = JSON.stringify(preStep12Cut(node, slug)) !== JSON.stringify(variantSection(node, slug));
        if (!changed) continue;
        if (!(slug in A)) outsideCensus.push(`${b}:${slug}`);
        else if (A[slug].verdict.startsWith('RIGHT')) rightRecut.push(`${b}:${slug}`);
      }
    }
    expect(before - after).toBe(289);
    expect(fixed).toEqual({ classFeatures: 30, items: 259 });
    expect(newlyWrong).toBe(0);
    expect(outsideCensus).toEqual([]);
    expect(rightRecut.sort()).toEqual(RIGHT_RECUT);
  }, 240_000);

  it('every re-cut right record lands on a section named after it', () => {
    const bag = (s: string) => astSlug(s).split('-').filter((w) => w && w !== 'of' && w !== 'the');
    for (const k of RIGHT_RECUT) {
      const [b, s] = k.split(':');
      const shown = textOf(variantSection(trees[b][s], s).c![0]).trim();
      const name = raw[b][s].name!;
      // Every word of the section's title is a word of the record's name, give or take AoN's spelling.
      const nameWords = new Set(bag(name));
      const missing = bag(shown).filter((w) => !nameWords.has(w));
      expect(missing.length, `${k}: "${name}" → "${shown}"`).toBeLessThanOrEqual(1);
    }
  });

  it('rule (c) only ever cuts on the record\'s family page (checked on the record NAME, every bucket)', () => {
    const off: string[] = [];
    for (const b of Object.keys(trees)) if (raw[b] && typeof raw[b] === 'object') off.push(...ruleCWithoutQualifier(trees[b], raw[b]).map((s: string) => `${b}:${s}`));
    expect(off).toEqual([]);
  }, 120_000);
});

/* ---------------------------------------------------------------------------------------------- */
/* F6 / F6b: the two generated lists, two ways.                                                    */
/* ---------------------------------------------------------------------------------------------- */

describe('F6 / F6b: not-own-page.json and page-slices.json are the census, both ways', () => {
  let residue: Record<string, string> = {};
  beforeAll(() => { residue = censusResidue(raw, trees); }, 120_000);

  it('not-own-page.json = the S2 residue after F5 less the sliced records, split by the 60 % gate (every listed record passed it)', () => {
    // batch card premise: equipment-2739 "You can use oil to fuel lanterns" — round 4 (the fixer): 243 (was
    // 247). A page byte-identical to a differently named record's, with no section and no line that is another
    // record's, is right for both (RIGHT_SAME_TEXT): Oil (1 pint), the two Ganjay Book bulk variants and
    // Soulsight (Sorcerer), whose page carries the Sorcerer trait (batch 031: one printed feat).
    // batch card premise: feat-1092 "You cannot select another dedication feat until you have gained two" —
    // round 5: 242 — Knight Vigilant Dedication's page is its own (RIGHT_OWN_PAGE: every line is its words or
    // its own printed Special line), so it reads the whole page again.
    expect(Object.keys(residue).length).toBe(242);
    const left = residueWithoutSlices(residue, PAGE_SLICES.slices);
    // Round 3: 166 (was 147) — the 17 records whose family page prints their variant as a LINE (six instinct
    // crowns, five drake rifles, four elemental familiars) or as a section spelt "Splinter" (two splintering
    // spears) now read it.
    // batch card premise: equipment-1340 "A hollow puzzle box is designed to have an empty compartment" —
    // round 4: 172 — the three hollow puzzle boxes read their "Puzzle Box (Hollow)" section, and three records
    // read the run of their own page that is their text (Arcane Bond (Unified Magical Theory), Knight Vigilant
    // Dedication, Wand of Refracting Rays (7th-Rank)).
    // batch card premise: feat-1092 "You cannot select another dedication feat until you have gained two" —
    // round 5: 171 — Knight Vigilant Dedication left the residue (its own page, drawn whole), so its run went.
    expect(Object.keys(residue).length - Object.keys(left).length).toBe(171);
    expect(notOwnPageProblems(NOT_OWN_PAGE, left)).toEqual([]);
    const ids: string[] = NOT_OWN_PAGE.ids;
    // batch card premise: class-feature-15 "See specific research fields for more information" — round 4: 11
    // (was 21), the eleven perpetual alchemy variants whose shared feature page lacks their field's line.
    expect(ids.length).toBe(11);
    expect(ids.length + Object.keys(NOT_OWN_PAGE.keptOnPage).length).toBe(71);
    for (const k of ids) expect((NOT_OWN_PAGE.coverage as Record<string, number>)[k], k).toBeGreaterThanOrEqual(COVERAGE_GATE);
    // No sliced record is listed (a slice wins, so it would never read the list).
    for (const k of [...ids, ...Object.keys(NOT_OWN_PAGE.keptOnPage)]) expect(k in PAGE_SLICES.slices, k).toBe(false);
    // The pure check catches both directions.
    // batch card premise: class-feature-15 "See specific research fields for more information" — the listed
    // example is a perpetual-infusions variant since the hollow puzzle boxes read their section (round 4).
    expect(notOwnPageProblems({ ...NOT_OWN_PAGE, ids: ids.filter((k) => k !== 'classFeatures:perpetual-infusions-bomber') }, left)).toEqual(['classFeatures:perpetual-infusions-bomber|NOT-OWN-UNLISTED']);
    expect(notOwnPageProblems({ ...NOT_OWN_PAGE, ids: [...ids, 'classFeatures:deity-cleric'] }, left)).toEqual(['classFeatures:deity-cleric|NOT-OWN-STALE']);
  }, 120_000);

  it('the raised bar: no listed record has a section carrying its whole name on its own page (it reads that section instead)', () => {
    // The refuters measured 88 of round 1's 156 listed ids with exactly one such section (a wand rank's
    // "(2nd-Rank Spell)", "Wheelchair (Land-Delver's Chair)"): each fell back to old text although the
    // Archives print it. Every record listed now has none — the old text is shown only where the page
    // holds no section of the record's at all.
    const offenders = (NOT_OWN_PAGE.ids as string[]).filter((k) => {
      const [b, s] = k.split(':');
      return supersetSections(trees[b][s], raw[b][s].name!).length === 1;
    });
    expect(offenders).toEqual([]);
    // Round 3 (the refuters' 16): nor a LINE led by its bracketed qualifier — "Animal: …" on the Instinct
    // Crown page, "Acid …" in the Drake Rifle list, "Air …" on Elemental Familiar. Counted loosely (any line
    // whose words start with the qualifier), so a record the slice route turns down still shows up here.
    const lineOffenders = (NOT_OWN_PAGE.ids as string[]).filter((k) => {
      const [b, s] = k.split(':');
      return (qualifierLine(trees[b][s], raw[b][s])?.all ?? 0) > 0;
    });
    expect(lineOffenders).toEqual([]);
    // The spelling slack that finds "Splinter Spear (Greater)" for "Splintering Spear (Greater)".
    expect(supersetSections(trees.items['splintering-spear-greater'], 'Splintering Spear (Greater)').length).toBe(1);
  });

  it.runIf(existsSync('C:/wonderers guide/aon-2e-archive/data/by-category'))('the split is the mirror gate, recomputed on ALL listed records (mirror present)', () => {
    const MIRROR = 'C:/wonderers guide/aon-2e-archive/data/by-category';
    const mirrorOf = (rec: { aonId?: string }) => {
      const id = rec?.aonId ? String(rec.aonId) : '';
      if (!id) return undefined;
      const cat = id.replace(/-\d+(?:-\d+)*$/, '');
      for (const f of [id, id.replace(/-\d+$/, '')]) {
        const path = join(MIRROR, cat, `${f}.json`);
        if (existsSync(path)) return String(JSON.parse(readFileSync(path, 'utf8')).markdown ?? '');
      }
      return undefined;
    };
    const { ids, keptOnPage } = splitResidue(residueWithoutSlices(residue, PAGE_SLICES.slices), raw, mirrorOf);
    expect(ids).toEqual(NOT_OWN_PAGE.ids);
    expect(keptOnPage).toEqual(NOT_OWN_PAGE.keptOnPage);
  }, 120_000);

  it('page-slices.json = the slice computation, both ways; every slice holds the record (gate)', () => {
    const computed = computePageSlices(raw, trees, residue);
    expect(pageSliceProblems(PAGE_SLICES, computed)).toEqual([]);
    const slices = PAGE_SLICES.slices as Record<string, { coverage: number | null; grams?: number | null; route: string; kind: string }>;
    for (const [k, v] of Object.entries(slices)) {
      const named = v.kind !== 'run' && (v.route === 'R0' || v.route === 'R1' || v.route === 'R2');
      const passes = (v.coverage !== null && v.coverage >= COVERAGE_GATE) || (named && (v.grams === null || (v.grams ?? 0) >= 0.5));
      expect(passes, k).toBe(true);
    }
    // Both directions of the pure check.
    const { ['classFeatures:air-gate']: _gone, ...rest } = PAGE_SLICES.slices as Record<string, unknown>;
    void _gone;
    expect(pageSliceProblems({ slices: rest }, computed)).toEqual(['classFeatures:air-gate|SLICE-UNLISTED']);
    expect(pageSliceProblems({ slices: { ...PAGE_SLICES.slices, 'feats:power-attack': { bucket: 'feats', page: 'power-attack', path: [0], anchor: 'Power Attack', kind: 'page' } } }, computed))
      .toEqual(['feats:power-attack|SLICE-STALE']);
  }, 120_000);

  it('how many of the official no-page records get a slice (measured, pinned)', () => {
    const noPage: string[] = officialNoPage(raw, trees);
    const sliced = noPage.filter((k) => k in (PAGE_SLICES.slices as Record<string, unknown>));
    expect(noPage.length).toBe(778);
    expect(sliced.length).toBe(327);
  });

  it('no slice shows another record\'s text: a whole page only where it IS the record\'s, a paragraph or run never runs into the next entry, a section stops before a subsection that is not the record\'s', () => {
    // Round 2 (the refuters' cases): thirty round-1 slices were another record's whole page (the Energy
    // Robe page with all four energies; Air Gate with the Air element's "Impulse Feats" and "Elemental
    // Blast"), and block / section slices ran on into the next activation, the granting feat's "Special"
    // line, a spell table, or Cleric Spellcasting. Checked on every slice through the screen's resolution.
    const STRONG = /^(?:frequency|trigger|requirements?|effect|cost|duration|range|area|targets?|defense|saving throw|critical success|success|failure|critical failure|heightened|maximum duration|onset|stage \d+|cast)\b/i;
    const pad = (d: string | undefined) => ' ' + words(String(d ?? '').replace(/⟨[^⟩]*⟩/g, ' ')) + ' ';
    const bad: string[] = [];
    for (const [k, v] of Object.entries(PAGE_SLICES.slices as Record<string, { kind: string; bucket: string; page: string; path: number[] }>)) {
      const [b, s] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
      const rec = raw[b][s];
      const tree = recordTree(b, s, treeOf);
      if (!tree) { bad.push(`${k}: no tree`); continue; }
      if (v.kind === 'page') { if (foreignLines(trees[v.bucket][v.page], rec.description).length) bad.push(`${k}: whole page with another record's lines`); continue; }
      const d = pad(rec.description);
      const body = (tree.c ?? []).slice(1);
      if (v.kind === 'block' || v.kind === 'run') {
        // The anchor line (its bold lead now the title) is the record's by its name; a line that was only its
        // title is not drawn at all (round 3), so skip the first body node only when it is that line.
        const anchorLine = v.kind === 'block' ? withoutLead(v.path.reduce((n: AstNode, i: number) => n.c![i], trees[v.bucket][v.page])) : undefined;
        for (const n of v.kind === 'block' ? body.slice(anchorLine ? 1 : 0) : body) {
          if (['actions', 'br', 'traits', 'hr', 'title', 'heading'].includes(n.t)) continue;
          for (const x of n.t === 'ul' || n.t === 'ol' ? n.c ?? [] : [n]) {
            const lead = x.c?.find((y) => !(y.t === 'text' && !textOf(y).trim()));
            if (lead?.t === 'b' && STRONG.test(textOf(lead).trim())) continue;
            // batch card premise: feat-1092 "Special You cannot select another dedication feat" — round 4: on
            // the record's OWN page (a run of route R0) its printed Special line is its own, whatever its words.
            if (v.kind === 'run' && (v as { route?: string }).route === 'R0' && v.page === s && lead?.t === 'b' && /^special$/i.test(textOf(lead).trim())) continue;
            // batch card premise: equipment-2288 "Usage held in 1 hand" — round 5: an own-page run (`head`)
            // carries its page's header in front; its stat column and Source line are the page's, not a line.
            if ((v as { head?: boolean }).head && (isMetaP(x) || isMetaishBlock(x))) continue;
            const e = nodeEvidence([x], d);
            // A run's paragraph holding one whole sentence of the record's is the record's paragraph.
            const holdsSentence = v.kind === 'run' && (sentenceCoverage(ownSentences(rec.description), textOf(x)) ?? 0) > 0;
            if (e !== null && e < EVIDENCE && !holdsSentence) bad.push(`${k}: "${textOf(x).slice(0, 60)}"`);
          }
        }
      }
      if (v.kind === 'section') {
        for (let i = 0; i < body.length; i++) {
          if (body[i].t !== 'title' && body[i].t !== 'heading') continue;
          let j = i + 1;
          while (j < body.length && body[j].t !== 'title' && body[j].t !== 'heading') j++;
          const e = nodeEvidence(body.slice(i, j), d);
          if (e !== null && e < EVIDENCE) bad.push(`${k}: subsection "${textOf(body[i]).slice(0, 40)}"`);
        }
      }
    }
    expect(bad).toEqual([]);
  }, 120_000);

  it('a paragraph or bullet slice names its record once: the title is its bold lead, and the line under it starts after the lead', () => {
    // Round 3 (the refuters' render): all 201 block and 72 item slices drew "Second Doctrine (3rd)Second
    // Doctrine (3rd) Your proficiency rank…", "Death Drone Death Drone". toMatch passes on a doubled name, so
    // this counts: the cut holds the anchor's words exactly as often as the page region it was cut from
    // (the title adds one, the lead it replaces takes one away).
    const count = (hay: string, needle: string) => hay.split(needle).length - 1;
    const bad: string[] = [];
    let checked = 0;
    for (const [k, v] of Object.entries(PAGE_SLICES.slices as Record<string, { kind: string; bucket: string; page: string; path: number[]; anchor: string; n?: number; seg?: number }>)) {
      if (v.kind !== 'block' && v.kind !== 'item') continue;
      const [b, s] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
      const tree = recordTree(b, s, treeOf);
      if (!tree) { bad.push(`${k}: no tree`); continue; }
      const pageTree = trees[v.bucket][v.page];
      const node = v.path.reduce((n: AstNode, i: number) => n.c![i], pageTree);
      let region: string;
      if (v.kind === 'item') {
        const items = bulletItems(node);
        const at = items.findIndex((x) => x.seg === v.seg);
        region = (node.c ?? []).slice(v.seg, items[at + 1]?.seg ?? (node.c ?? []).length).map(textOf).join('');
      } else if (v.path.length === 2) region = textOf(node);
      else region = (pageTree.c ?? []).slice(v.path[0], v.path[0] + (v.n ?? 1)).map(textOf).join('');
      checked++;
      if (count(textOf(tree), v.anchor) !== count(region, v.anchor)) bad.push(`${k}: "${v.anchor}" ×${count(textOf(tree), v.anchor)} (page ×${count(region, v.anchor)})`);
      // …and the first line under the title never opens with the title's words.
      const first = (tree.c ?? []).slice(1).find((n) => !['traits', 'hr', 'br', 'actions'].includes(n.t));
      if (first && words(textOf(first)).startsWith(words(v.anchor) + ' ')) bad.push(`${k}: body opens with its title`);
    }
    expect(checked).toBe(273);
    expect(bad).toEqual([]);
  });

  it('a variant printed as a LINE of its family page reads the page with the other variants\' lines left out (kind "line")', () => {
    const lines = Object.entries(PAGE_SLICES.slices as Record<string, { kind: string; bucket: string; page: string; path: number[]; drop?: number[][]; title?: string }>).filter(([, v]) => v.kind === 'line');
    expect(lines.map(([k]) => k).sort()).toEqual([
      'familiarAbilities:elemental-familiar-air', 'familiarAbilities:elemental-familiar-earth', 'familiarAbilities:elemental-familiar-fire',
      'familiarAbilities:elemental-familiar-metal', 'familiarAbilities:elemental-familiar-water', 'familiarAbilities:elemental-familiar-wood',
      'items:drake-rifle-acid', 'items:drake-rifle-cold', 'items:drake-rifle-electricity', 'items:drake-rifle-fire', 'items:drake-rifle-poison',
      'items:instinct-crown-animal', 'items:instinct-crown-dragon', 'items:instinct-crown-fury', 'items:instinct-crown-giant',
      'items:instinct-crown-spirit', 'items:instinct-crown-superstition',
    ]);
    for (const [k, v] of lines) {
      const [b, s] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
      const shown = textOf(recordTree(b, s, treeOf)!);
      const at = (p: number[]) => textOf(p.reduce((n: AstNode, i: number) => n.c![i], trees[v.bucket][v.page])).trim();
      expect(shown, k).toContain(at(v.path));
      for (const d of v.drop ?? []) expect(shown, `${k} drops ${at(d).slice(0, 30)}`).not.toContain(at(d));
      expect(textOf(recordTree(b, s, treeOf)!.c![0]).trim(), k).toBe(raw[b][s].name);
    }
  });

  it('the ledger goes red when the lists disagree with the census: delete a listed id, add a right one, drop a slice, add a stale one', () => {
    // batch card premise: class-feature-15 "See specific research fields for more information" — the listed
    // id deleted is a perpetual-infusions variant since the hollow puzzle boxes read their section (round 4).
    const notOwnPageFile = { ...NOT_OWN_PAGE, ids: [...NOT_OWN_PAGE.ids.filter((k: string) => k !== 'classFeatures:perpetual-infusions-bomber'), 'classFeatures:deity-cleric'] };
    const { ['actions:accept-echo']: _drop, ...keep } = PAGE_SLICES.slices as Record<string, unknown>;
    void _drop;
    const pageSlicesFile = { slices: { ...keep, 'feats:power-attack': { bucket: 'feats', page: 'power-attack', path: [0], anchor: 'Power Attack', kind: 'page' } } };
    const deps = {
      content: raw, trees, astIndex,
      statRows: { featStatRows, itemStatRows, spellStatRows },
      activities: ACTIVITIES,
      situationalIds: Object.keys(FEAT_SITUATIONAL).filter((id) => !id.startsWith('trait:')),
      classFeatureDescription, splitHeightening, parseBlocks, cleanRun, foldsOf,
      notOwnPageFile, pageSlicesFile,
    };
    const { found } = computeLedger(deps);
    const listProblems = found['S2-NOT-OWN'].filter((e: string) => /\|(NOT-OWN|SLICE)-/.test(e)).sort();
    // Exactly the four mutations, so the real files agree with the census everywhere else. Each entry is a
    // NEW offender against any baseline, which is what turns `card-truth-check` red.
    expect(listProblems).toEqual([
      'actions:accept-echo|SLICE-UNLISTED',
      'classFeatures:deity-cleric|NOT-OWN-STALE',
      // batch card premise: class-feature-15 "See specific research fields for more information" — round 4.
      'classFeatures:perpetual-infusions-bomber|NOT-OWN-UNLISTED',
      'feats:power-attack|SLICE-STALE',
    ]);
  }, 300_000);
});

/* ---------------------------------------------------------------------------------------------- */
/* F6c: shared class features.                                                                     */
/* ---------------------------------------------------------------------------------------------- */

describe('F6c: a lead naming several classes is an addendum for exactly those classes', () => {
  it('wizard and druid Weapon Expertise have no "martial weapons"; each keeps its own paragraph', () => {
    const rawWe = db.classFeatures['weapon-expertise'].description;
    expect(rawWe).toMatch(/\*\*Witch, Wizard\*\*/);
    const wiz = classFeatureDescription(rawWe, 'wizard', db);
    expect(wiz).toMatch(/Witch, Wizard/);
    expect(wiz).not.toMatch(/martial weapons/);
    const dru = classFeatureDescription(rawWe, 'druid', db);
    expect(dru).toMatch(/Druid, Kineticist/);
    expect(dru).not.toMatch(/martial/);
    expect(classFeatureDescription(rawWe, 'magus', db)).toMatch(/martial weapons/);
  });

  it('every class row the guard calls CLASS_MISMATCH gets the fallback — all 25 shared features, not only those with two class addenda', () => {
    // Round 2: round 1 reached only the features whose text carries addenda for two or more classes (9 of
    // the 25); Weapon Specialization (page "Class Thaumaturge"), Reflex Expertise ("Class Guardian"),
    // Perception Expertise and 13 more still drew another class's page. The rule is now the guard's own
    // (scripts/lib/card-scope.mjs surfaceRows: the class lists the feature, the page names another class).
    const names = Object.values(db.classes).map((c) => c.name);
    const rows: string[] = [];
    const missed: string[] = [];
    for (const cls of Object.values(db.classes)) {
      for (const f of cls.features ?? []) {
        const tree = trees.classFeatures?.[f.featureId];
        if (!tree || !db.classFeatures[f.featureId]) continue;
        const pc = pageClassName(textOf(tree), names);
        if (!pc || pc === cls.name) {
          // The page IS this class's (or names none): the card draws it.
          expect(sharedFeatureFallback(f.featureId, cls.id, textOf(tree), db), `${f.featureId}@${cls.id}`).toBeNull();
          continue;
        }
        rows.push(`${f.featureId}@${cls.id}`);
        if (sharedFeatureFallback(f.featureId, cls.id, textOf(tree), db) === null) missed.push(`${f.featureId}@${cls.id}`);
      }
    }
    expect(missed).toEqual([]);
    expect(rows.length).toBe(151);
    expect(new Set(rows.map((r) => r.split('@')[0])).size).toBe(25);
    // A bard's Reflex Expertise is the generic paragraph, without the Guardian's addendum.
    const bard = sharedFeatureFallback('reflex-expertise', 'bard', textOf(trees.classFeatures['reflex-expertise']), db)!;
    expect(bard).not.toMatch(/Guardian/);
    expect(bard.length).toBeGreaterThan(20);
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* Rendered: the real StatDetailModal full text (mine card) and the real RecordCard (browse).      */
/* ---------------------------------------------------------------------------------------------- */

const mounted: (() => void)[] = [];
afterEach(() => { while (mounted.length) mounted.pop()!(); });
async function settle() {
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
async function mount(el: ReactElement): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<ContentContext.Provider value={db}><PinContext.Provider value={null}>{el}</PinContext.Provider></ContentContext.Provider>);
  });
  await settle();
  mounted.push(() => { act(() => root.unmount()); host.remove(); });
  return host;
}
const squash = (s: string | null | undefined) => String(s ?? '').replace(/\s+/g, ' ').trim();
/** The real StatDetailModal with one situational line from `bucket:id`, its Full text (the mine card) opened. */
async function mineCard(bucket: string, id: string, ch: Character): Promise<{ text: string; host: HTMLElement }> {
  const breakdown = { title: 'Stat', totalText: '+0', parts: [], timeline: [], situational: [{ text: 'a situational line', sourceId: id, sourceCollection: bucket as never }] };
  const host = await mount(<StatDetailModal breakdown={breakdown} character={ch} content={db} onClose={noop} />);
  const more = host.querySelector('.sd-sit-more');
  expect(more, `${bucket}:${id} Full text`).toBeTruthy();
  await act(async () => { (more as HTMLElement).click(); });
  await settle();
  const card = host.querySelector('.card-mine');
  expect(card, `${bucket}:${id} mine card`).toBeTruthy();
  return { text: squash(card!.textContent), host };
}
async function browseCard(bucket: string, id: string): Promise<string> {
  const host = await mount(<RecordCard record={{ bucket, id }} mode="browse" chrome="popup" onExit={noop} />);
  return squash(host.textContent);
}

describe('rendered: records open their own section, own slice or own text', () => {
  let cleric: Character, alchemist: Character, ranger: Character, wizard: Character, kineticist: Character;
  let residueNow: Record<string, string> = {};
  beforeAll(() => {
    residueNow = censusResidue(raw, trees);
    cleric = build('cleric', 3);
    alchemist = build('alchemist', 5);
    ranger = build('ranger', 17);
    wizard = build('wizard', 11);
    kineticist = build('kineticist', 1);
  }, 120_000);

  it('second-doctrine-cloistered-cleric shows "Fortitude" and not "Final Doctrine (19th)" (mine and browse)', async () => {
    for (const text of [(await mineCard('classFeatures', 'second-doctrine-cloistered-cleric', cleric)).text, await browseCard('classFeatures', 'second-doctrine-cloistered-cleric')]) {
      expect(text).toMatch(/Fortitude/);
      expect(text).not.toMatch(/Final Doctrine \(19th\)/);
      expect(text).not.toMatch(/First Doctrine \(1st\)/);
    }
  });

  // The Feats-tab popup (FeatDetail) too: it was the known case featDetail|classFeatures:second-doctrine-
  // cloistered-cleric (WRONG_FAMILY_OVERSHOW, "the record's tree is the whole Cloistered Cleric page") in
  // test/card-parity-known.json, removed in the step-12 merge now that it is right (the list only shrinks).
  // batch card premise: doctrine-4 "Second Doctrine (3rd)** Your proficiency rank for Fortitude saves increases to expert"
  it('second-doctrine-cloistered-cleric on the Feats-tab popup (FeatDetail): its slice — "Your proficiency rank for Fortitude", no other doctrine', async () => {
    const ch = build('cleric', 20, { subclassId: 'cloistered-cleric' } as never);
    const entry = featEntries(ch, db).find((e) => e.featureId === 'second-doctrine-cloistered-cleric');
    expect(entry, 'a cloistered cleric 20 lists the Second Doctrine row').toBeTruthy();
    const host = await mount(<FeatDetail entry={entry!} onClose={noop} />);
    // Card step 11: with CARD_ON.featDetail the row opens its mine card (page lane .ast-modal.card-mine);
    // switched off, the legacy popup's body as before.
    // batch card premise: doctrine-4 "Second Doctrine (3rd)** Your proficiency rank for Fortitude saves increases to expert"
    const body = host.querySelector(cardOn('featDetail') ? '.ast-modal.card-mine' : '.picker.spell-detail .sd-body > .sd-desc');
    expect(body?.querySelector('.ast-body'), 'the popup draws the slice of the doctrine page').toBeTruthy();
    const text = squash(body?.textContent);
    expect(text).toMatch(/Your proficiency rank for Fortitude saves increases to expert/);
    for (const other of ['First Doctrine', 'Third Doctrine', 'Fourth Doctrine', 'Fifth Doctrine', 'Final Doctrine']) expect(text, `no "${other}"`).not.toContain(other);
  });

  it('field-discovery-toxicologist shows "poison resistance" (its research field\'s section)', async () => {
    const { text } = await mineCard('classFeatures', 'field-discovery-toxicologist', alchemist);
    expect(text).toMatch(/poison resistance/);
    expect(await browseCard('classFeatures', 'field-discovery-toxicologist')).toMatch(/poison resistance/);
  });

  it('masterful-hunter-flurry shows its multiple-attack-penalty clause', async () => {
    const { text } = await mineCard('classFeatures', 'masterful-hunter-flurry', ranger);
    expect(text).toMatch(/multiple attack penalty for attacks against your hunted prey is –2 \(–1 with an agile weapon\)/);
  });

  it('anathema-cleric has no "druids" and stops before the class page\'s Cleric Spellcasting', async () => {
    const { text } = await mineCard('classFeatures', 'anathema-cleric', cleric);
    expect(text).toMatch(/anathema/i);
    expect(text).not.toMatch(/druids/i);
    // Round 2: the section ran on through the level-3 "Cleric Spellcasting" subsection.
    expect(text).not.toMatch(/Cleric Spellcasting/);
    expect(text).not.toMatch(/bestows on you the power to cast divine spells/);
  });

  it('adept-benefit-amulet lacks "Paragon Benefit" (F5 rule c)', async () => {
    expect(await browseCard('classFeatures', 'adept-benefit-amulet')).not.toMatch(/Paragon Benefit/);
    const { text } = await mineCard('classFeatures', 'adept-benefit-amulet', build('thaumaturge', 7));
    expect(text).toMatch(/Adept Benefit/);
    expect(text).not.toMatch(/Paragon Benefit/);
  });

  it('aon-1st-rank-scroll lacks "2nd-rank Scroll"; 1st-rank-scroll is unchanged', async () => {
    const aon = await browseCard('items', 'aon-1st-rank-scroll');
    expect(aon).toMatch(/1st-rank Scroll/);
    expect(aon).not.toMatch(/2nd-rank Scroll/);
    expect(recordTree('items', '1st-rank-scroll', treeOf)).toEqual(preStep12Cut(trees.items['1st-rank-scroll'], '1st-rank-scroll'));
  });

  it('aether-marbles-greater lacks "Lesser Aether Marbles"', async () => {
    const text = await browseCard('items', 'aether-marbles-greater');
    expect(text).toMatch(/Greater Aether Marbles/);
    expect(text).not.toMatch(/Lesser Aether Marbles/);
  });

  it('air-gate shows the Air element\'s junctions and nothing else of the page, nothing of the kineticist class page', async () => {
    const { text } = await mineCard('classFeatures', 'air-gate', kineticist);
    expect(text).toMatch(/Push the target up to 10 feet/);
    expect(text).toMatch(/Stride up to half your Speed or Step/);
    expect(text).not.toMatch(/Initial Proficiencies/);
    expect(text).not.toMatch(/Dual Gate/);
    // batch card premise: element-1 "Push the target up to 10 feet" — the owner (2026-10-08): the no-page footer's words changed.
    expect(text).not.toMatch(/Not from the Archives/);
    // Round 2: the whole Air element page was shown.
    for (const t of [await browseCard('classFeatures', 'air-gate'), text]) {
      expect(t).not.toMatch(/Impulse Feats/);
      expect(t).not.toMatch(/Click here/);
      expect(t).not.toMatch(/1d6 electricity or slashing/);
    }
  });

  it('a family variant with no page shows its own section of the family page (Energy Robe of Acid, Smoky Hag Eye)', async () => {
    const robe = await browseCard('items', 'energy-robe-of-acid');
    expect(robe).toMatch(/You gain resistance 5 to acid/);
    expect(robe).toMatch(/brightly colored linen robe/);
    for (const other of [/resistance 5 to fire/, /resistance 5 to cold/, /resistance 5 to electricity/, /Energy Robe \(Cold\)/]) expect(robe).not.toMatch(other);
    const eye = await browseCard('items', 'smoky-hag-eye');
    expect(eye).toMatch(/smoky hag eye is named after the black vapor/);
    expect(eye).not.toMatch(/Frightful/);
    expect(eye).not.toMatch(/Oracular/);
    expect(eye).not.toMatch(/stony hag eye/);
  });

  it('a record inside a bigger page shows only its own lines (Dragon Breath, Swirl Crimson Shroud)', async () => {
    const breath = await browseCard('actions', 'dragon-breath-dragon-form');
    expect(breath).toMatch(/You exhale deadly magical energy/);
    expect(breath).not.toMatch(/Heightened \(8th\)/);
    expect(breath).not.toMatch(/Calling upon powerful magic/);
    const swirl = await browseCard('actions', 'swirl-crimson-shroud');
    expect(swirl).toMatch(/swirling it around you/);
    expect(swirl).not.toMatch(/At 10th level/);
    expect(swirl).not.toMatch(/leads to/);
  });

  it('a paragraph slice stops at its own entry: no next activation, no granting feat\'s Special line, no table, no epilogue', async () => {
    const cases: Array<[string, RegExp, RegExp]> = [
      ['twist-design', /transform your tattoo/, /Adopt Persona/],
      ['reloading-cascade', /reload a firearm/, /Conflux Spell/],
      ['intercession-spell', /Interceding directly/, /Assuming Godhood/],
      ['consume-flesh', /devour a chunk of the corpse/, /dedication feat/],
      ['size-up', /non-mindless creature/, /Eagle Knight archetype/],
      ['spin-tale', /./, /folklorist archetype/],
    ];
    for (const [id, has, lacks] of cases) {
      const text = await browseCard('actions', id);
      expect(text, id).toMatch(has);
      expect(text, id).not.toMatch(lacks);
    }
  });

  it('a wand rank reads its own section of the wand page (R0), not the whole page and not old text', async () => {
    const text = await browseCard('items', 'wand-of-mercy-4th-rank');
    expect(text).toMatch(/Wand of Mercy \(4th-Rank Spell\)/);
    expect(text).not.toMatch(/Wand of Mercy \(6th-Rank Spell\)/);
    // batch card premise: equipment-2283 "Wand of Mercy (4th-Rank Spell)" — the owner (2026-10-08): the no-page footer's words changed.
    expect(text).not.toMatch(/Not from the Archives/);
    const echoes = await browseCard('items', 'wand-of-thundering-echoes-3rd-rank-spell');
    expect(echoes).toMatch(/Wand of Thundering Echoes \(3rd-Level\)/);
    expect(echoes).not.toMatch(/Wand of Thundering Echoes \(4th-Level\)/);
  });

  it('a bard\'s Reflex Expertise (page "Class Guardian") is the bard\'s own older text, marked so', async () => {
    const { text, host } = await mineCard('classFeatures', 'reflex-expertise', build('bard', 9));
    expect(text).not.toMatch(/Guardian/);
    expect(text).not.toMatch(/heaviest of armors/);
    expect(squash(host.querySelector('.card-nopage')?.textContent)).toBe(SHARED_FEATURE_FOOTER);
  });

  it('an action printed inside its feat (Accept Echo) shows that paragraph, not the feat', async () => {
    const text = await browseCard('actions', 'accept-echo');
    expect(text).toMatch(/Frequency once per day/);
    expect(text).not.toMatch(/With the utmost gratitude/);
  });

  it('a paragraph / bullet card names its record once (the refuters\' doubled titles, rendered)', async () => {
    const once = (text: string, name: string) => text.split(name).length - 1;
    const doctrineMine = (await mineCard('classFeatures', 'second-doctrine-cloistered-cleric', cleric)).text;
    const cases: Array<[string, string, string]> = [
      ['classFeatures', 'second-doctrine-cloistered-cleric', 'Second Doctrine (3rd)'],
      ['actions', 'death-drone', 'Death Drone'],
      ['actions', 'accept-echo', 'Accept Echo'],
      ['classFeatures', 'antimagic-plating', 'Antimagic Plating'],
      ['classFeatures', 'lesser-creed', 'Lesser Creed (5th)'],
    ];
    for (const [b, id, name] of cases) {
      const text = await browseCard(b, id);
      expect(once(text, name), `${id}: ${text.slice(0, 80)}`).toBe(1);
      expect(text, id).not.toMatch(new RegExp(`${name.replace(/[()]/g, '\\$&')}\\s*:?\\s*${name.replace(/[()]/g, '\\$&')}`));
    }
    expect(once(doctrineMine, 'Second Doctrine (3rd)')).toBe(1);
    expect(doctrineMine).toMatch(/Second Doctrine \(3rd\)\s*Your proficiency rank for Fortitude/);
  });

  it('a variant printed as a line of its family page shows the family text and its own line only (Instinct Crown, Drake Rifle, Elemental Familiar); a "Splinter" section is found for "Splintering"', async () => {
    const crown = await browseCard('items', 'instinct-crown-animal');
    expect(crown).toMatch(/Instinct Crown \(Animal\)/);
    expect(crown).toMatch(/magical headpiece/);
    expect(crown).toMatch(/Your bestial instincts take over/);
    for (const other of [/The might of dragons/, /Your boundless fury/, /you become Large/, /partial form of a spirit/, /fights off the effects of magic/]) expect(crown).not.toMatch(other);
    // batch card premise: equipment-2338 "Your bestial instincts take over" — the owner (2026-10-08): the no-page footer's words changed.
    expect(crown).not.toMatch(/Not from the Archives/);
    const mineCrown = await mount(<RecordCard record={{ bucket: 'items', id: 'instinct-crown-fury' }} mode="mine" chrome="popup" onExit={noop} />);
    expect(squash(mineCrown.textContent)).toMatch(/Your boundless fury/);
    expect(squash(mineCrown.textContent)).not.toMatch(/Your bestial instincts/);
    expect(mineCrown.querySelector('.card-nopage'), 'no old-text footer').toBeNull();
    const rifle = await browseCard('items', 'drake-rifle-acid');
    expect(rifle).toMatch(/On a hit, the drake rifle provides/);
    expect(rifle).toMatch(/Clinging acid makes it painful/);
    for (const other of [/Frozen spittle/, /bursts of electricity/, /massive explosion/, /Noxious vapors/]) expect(rifle).not.toMatch(other);
    const fam = await browseCard('familiarAbilities', 'elemental-familiar-air');
    expect(fam).toMatch(/stays completely still for 1 round/);
    expect(fam).not.toMatch(/sheds bright light/);
    expect(fam).not.toMatch(/fast healing/);
    const spear = await browseCard('items', 'splintering-spear-greater');
    expect(spear).toMatch(/Splinter Spear \(Greater\)/);
    expect(spear).toMatch(/16d6/);
    expect(spear).not.toMatch(/18d6/);
    expect(spear).not.toMatch(/Splinter Spear \(Major\)/);
    // batch card premise: equipment-2646 "Splinter Spear (Greater)" — the owner (2026-10-08): the no-page footer's words changed.
    expect(spear).not.toMatch(/Not from the Archives/);
  });

  // batch card premise: class-feature-15 "See specific research fields for more information" — round 4: the
  // listed example was a hollow puzzle box, whose family page DOES print its "Puzzle Box (Hollow)" section
  // (it reads that section now, below); Perpetual Infusions (Bomber)'s shared feature page holds no line of
  // its bomber field ("Choose two 1st-level bombs" is only in our text).
  it('a listed not-own record (Perpetual Infusions (Bomber): the shared feature page has no line of its research field) falls back to its own text with the no-page line', async () => {
    const id = 'perpetual-infusions-bomber';
    expect(NOT_OWN_PAGE.ids).toContain(`classFeatures:${id}`);
    expect(textOf(trees.classFeatures[id])).not.toMatch(/bombs/);
    const host = await mount(<RecordCard record={{ bucket: 'classFeatures', id }} mode="mine" chrome="popup" onExit={noop} />);
    expect(host.querySelector('.ast-modal'), 'no page drawn').toBeNull();
    // batch card premise: class-feature-15 "See specific research fields for more information" — the owner (2026-10-08): player words, no "import".
    expect(squash(host.querySelector('.card-nopage')?.textContent)).toBe('Not from the Archives — our text');
    expect(squash(host.textContent)).toMatch(/Choose two 1st-level bombs/);
  });

  it('round 4: a page byte-identical to a differently named record\'s, with no line of another record\'s, is the record\'s page — Oil (1 pint), the Ganjay Book bulk variants', async () => {
    // The refuter's MUST-FIX 1 (a): these went to old text with the no-page footer although equipment-2739 /
    // equipment-859 print their text word for word.
    for (const id of ['oil-1-pint', 'ganjay-book-1-bulk-book', 'ganjay-book-light-bulk-book']) {
      const k = `items:${id}`;
      expect(k in residueNow, k).toBe(false);
      expect(NOT_OWN_PAGE.ids, k).not.toContain(k);
      const host = await mount(<RecordCard record={{ bucket: 'items', id }} mode="mine" chrome="popup" onExit={noop} />);
      expect(host.querySelector('.ast-modal'), `${k} draws its page`).toBeTruthy();
      expect(host.querySelector('.card-nopage'), `${k} no old-text footer`).toBeNull();
    }
    expect(squash((await mount(<RecordCard record={{ bucket: 'items', id: 'oil-1-pint' }} mode="mine" chrome="popup" onExit={noop} />)).textContent)).toMatch(/DC 10 flat check/);
    expect(await browseCard('items', 'ganjay-book-1-bulk-book')).toMatch(/You fold or unfold the Ganjay book/);
    // Not on a page with level-2 sections: Wand of Refracting Rays (7th-Rank) shares its page byte for byte
    // with the 4th / 6th-rank records too, and must never draw the other ranks' sections.
    expect(await browseCard('items', 'wand-of-refracting-rays-7th-rank')).not.toMatch(/6th-Rank Spell/);
  });

  // batch card premise: equipment-1340 "The DC to solve this puzzle box is 15." — round 5 (the refuter's
  // MUST-FIX 1): a hollow puzzle box is its grade AND hollow, so it reads BOTH sections of the family page, in
  // page order — its own grade's DC is present, the other grades' absent, and the three cards differ.
  it('round 5: a hollow puzzle box reads its grade section then the "Puzzle Box (Hollow)" section — its own DC, not the other grades\'', async () => {
    const DC: Record<string, string> = { simple: '15', complex: '20', challenging: '25' };
    const texts: string[] = [];
    for (const grade of Object.keys(DC)) {
      const id = `puzzle-box-${grade}-hollow`;
      const text = await browseCard('items', id);
      texts.push(text);
      expect(text, id).toMatch(/A hollow puzzle box is designed to have an empty compartment/);
      expect(text, id).toMatch(/A puzzle box features moving parts/);
      expect(text, id).toContain(`The DC to solve this puzzle box is ${DC[grade]}.`);
      for (const g of Object.keys(DC).filter((x) => x !== grade)) expect(text, `${id} lacks the ${g} grade`).not.toContain(`The DC to solve this puzzle box is ${DC[g]}.`);
      // Page order: the grade section, then the hollow section.
      expect(text.indexOf(`is ${DC[grade]}.`), id).toBeLessThan(text.indexOf('A hollow puzzle box is designed'));
      // batch card premise: equipment-1340 "A hollow puzzle box is designed to have an empty compartment" — the owner (2026-10-08): footer words changed.
      expect(text, id).not.toMatch(/Not from the Archives/);
    }
    expect(new Set(texts).size).toBe(3);
    // The rule on the page: one section per qualifier ("Simple", "Hollow"), both kept in page order.
    const box = trees.items['puzzle-box-simple-hollow'];
    expect(evidencedVariantSections(box, raw.items['puzzle-box-simple-hollow']).map((i: number) => textOf(box.c![i]).trim())).toEqual(['Puzzle Box (Simple)', 'Puzzle Box (Hollow)']);
  });

  it('round 5: sliceOf draws a variant\'s further sections (`also`) after the first, and gives no tree when one moved', () => {
    const fam: AstNode = { t: 'doc', c: [t('Box', 1), p('Shared box text.'), t('Box (Plain)', 2), p('Plain DC 15.'), t('Box (Fancy)', 2), p('Fancy DC 20.'), t('Box (Hollow)', 2), p('A hollow compartment.')] };
    const s: PageSlice = { bucket: 'items', page: 'box', path: [2], anchor: 'Box (Plain)', kind: 'variant', n: 1, also: [{ path: [6], anchor: 'Box (Hollow)', n: 1 }] };
    const cut = sliceOf(fam, s)!;
    expect(textOf(cut)).toBe('Box (Plain)Shared box text.Plain DC 15.Box (Hollow)A hollow compartment.');
    expect(sliceOf(fam, { ...s, also: [{ path: [4], anchor: 'Box (Hollow)', n: 1 }] }), 'the further section moved').toBeUndefined();
    expect(sliceOf(fam, { ...s, also: [{ path: [2], anchor: 'Box (Plain)', n: 1 }] }), 'not after the first').toBeUndefined();
  });

  it('round 4: a record whose own page holds its description as a run with no anchor reads that run — Arcane Bond (Unified Magical Theory)', async () => {
    const umt = await browseCard('classFeatures', 'arcane-bond-school-of-unified-magical-theory');
    expect(umt).toMatch(/Arcane Bond \(Unified Magical Theory\)/);
    expect(umt).toMatch(/you can use it once per day for each rank of spell you can cast/);
    expect(umt).not.toMatch(/No Curriculum/);
    expect(umt).not.toMatch(/Hand of the Apprentice/);
    // batch card premise: arcane-school-21 "you can use it once per day for each rank of spell you can cast" — the owner (2026-10-08): footer words changed.
    expect(umt).not.toMatch(/Not from the Archives/);
    // batch card premise: arcane-school-21 "Source Player Core pg. 200" — round 5: an own-page run carries
    // its page's header, so the Source line is drawn in front of the run.
    expect(umt).toMatch(/Source Player Core pg\. 200/);
  });

  // batch card premise: feat-1092 "Prerequisites Trained in Religion" — round 5 (the refuter's MUST-FIX 2):
  // Knight Vigilant Dedication's page is its OWN page (feat-1092: every line is its words or its own printed
  // Special line); round 4's run slice dropped its Prerequisites, Access and traits. It draws the whole page,
  // as before step 12 — its "leads to…" section included (a browse popup shows the page).
  it('round 5: Knight Vigilant Dedication draws its whole own page — Prerequisites, Access, Special — with no slice and no not-own entry', async () => {
    const k = 'feats:knight-vigilant-dedication';
    const residueHere = censusResidue(raw, trees);
    expect(k in residueHere, 'not in the residue').toBe(false);
    expect(sharedPageCensus(trees.feats, raw.feats, { all: true })['knight-vigilant-dedication'].verdict).toBe('RIGHT_OWN_PAGE');
    expect(k in (PAGE_SLICES.slices as Record<string, unknown>), 'no slice').toBe(false);
    expect([...NOT_OWN_PAGE.ids, ...Object.keys(NOT_OWN_PAGE.keptOnPage)], 'no not-own entry').not.toContain(k);
    expect(recordTree('feats', 'knight-vigilant-dedication', treeOf)).toBe(trees.feats['knight-vigilant-dedication']);
    const kv = await browseCard('feats', 'knight-vigilant-dedication');
    expect(kv).toMatch(/You are dedicated to the cause of the Shining Sentinels/);
    expect(raw.feats['knight-vigilant-dedication'].description).not.toMatch(/Special/);
    expect(kv).toMatch(/You cannot select another dedication feat until you have gained two other feats/);
    expect(kv).toMatch(/Prerequisites\s*Trained in Religion/);
    expect(kv).toMatch(/Access\s*A character who is a member of the Knights of Lastwall/);
    // batch card premise: feat-1092 "You are dedicated to the cause of the Shining Sentinels" — the owner (2026-10-08): footer words changed.
    expect(kv).not.toMatch(/Not from the Archives/);
  });

  it('round 5: an own-page run carries its page\'s header — Wand of Refracting Rays (7th-Rank) shows its traits, Usage, Bulk and Source in its FIRST frame, never the other ranks', () => {
    const s = PAGE_SLICES.slices['items:wand-of-refracting-rays-7th-rank'] as PageSlice;
    expect(s.kind).toBe('run');
    expect(s.head).toBe(true);
    const tree = recordTree('items', 'wand-of-refracting-rays-7th-rank', treeOf)!;
    // The first frame: the record's name, then the page's traits node and its stat column, before the run.
    expect(textOf(tree.c![0]).trim()).toBe('Wand of Refracting Rays (7th-Rank)');
    expect(tree.c![1].t).toBe('traits');
    expect(textOf(tree.c![2])).toMatch(/Source Treasure Vault \(Remastered\) pg\. 142.*Usage held in 1 hand.*Bulk L/);
    const html = renderToStaticMarkup(
      <ContentContext.Provider value={db}><PinContext.Provider value={null}>
        <RecordCard record={{ bucket: 'items', id: 'wand-of-refracting-rays-7th-rank' }} mode="browse" chrome="popup" onExit={noop} />
      </PinContext.Provider></ContentContext.Provider>,
    );
    const text = squash(html.replace(/<[^>]+>/g, ' '));
    expect(html).toMatch(/class="ast-modal"/);
    for (const trait of ['Uncommon', 'Magical', 'Wand']) expect(text, trait).toContain(trait);
    expect(text).toMatch(/Usage held in 1 hand/);
    expect(text).toMatch(/Bulk L/);
    expect(text).toMatch(/Treasure Vault \(Remastered\)/);
    expect(text).toMatch(/This wand is short and wide/);
    expect(text).not.toMatch(/6th-Rank Spell/);
    expect(text).not.toMatch(/4th-Rank Spell/);
  });

  it('a wizard 11\'s Weapon Expertise is the wizard paragraph of our older text, marked so — no "martial weapons"', async () => {
    const { text, host } = await mineCard('classFeatures', 'weapon-expertise', wizard);
    expect(text).toMatch(/Through sheer experience/);
    expect(text).not.toMatch(/martial weapons/);
    expect(text).not.toMatch(/Thaumaturge/);
    expect(squash(host.querySelector('.card-nopage')?.textContent)).toBe(SHARED_FEATURE_FOOTER);
    expect(host.querySelector('.card-nopage')?.closest('[data-ours]')).toBeTruthy();
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* Round 4: the screen's own guards — a stale slice gives no tree; the first frame is the slice.    */
/* ---------------------------------------------------------------------------------------------- */

describe('round 4: sliceOf refuses a stale line slice, and the first frame of a sliced record is its slice', () => {
  const li = (v: string): AstNode => ({ t: 'li', c: [{ t: 'text', v }] });
  const family = (acid: string): AstNode => ({
    t: 'doc',
    c: [t('Drake Gun', 1), p('A family text that every variant shares.'), { t: 'ul', c: [li(acid), li('Cold Frozen spittle clings to the target.')] }],
  });
  const spec = (page: AstNode): PageSlice => ({
    bucket: 'items', page: 'drake-gun', path: [2, 0], anchor: runAnchor(page.c![2].c![0]), kind: 'line', title: 'Drake Gun (Acid)', drop: [[2, 1]],
  });

  it('kind "line": the slice cut from the page it was generated on keeps its line and drops the others; a page whose line changed gives NO tree', () => {
    const before = family('Acid Clinging acid makes it painful to move.');
    const s = spec(before);
    const cut = sliceOf(before, s);
    expect(cut, 'the page the map was generated on').toBeTruthy();
    expect(textOf(cut!)).toMatch(/Clinging acid makes it painful/);
    expect(textOf(cut!)).not.toMatch(/Frozen spittle/);
    expect(textOf(cut!.c![0]).trim()).toBe('Drake Gun (Acid)');
    // The page changed under the map (a regenerated tree whose line at the path now reads otherwise): the
    // anchor no longer matches, so the card draws no tree rather than a wrong cut.
    const after = family('Electricity Arcs of lightning leap from the target.');
    expect(runAnchor(after.c![2].c![0])).not.toBe(s.anchor);
    expect(sliceOf(after, s)).toBeUndefined();
  });

  it('useAstNode seeds a sliced record\'s FIRST frame from its slice, never its whole family page (static render: no effects run)', () => {
    // second-doctrine-cloistered-cleric's own tree is the whole Cloistered Cleric doctrine page; its slice is
    // one bullet of it. The seed must already be the bullet, or the first frame flashes the whole page.
    expect(textOf(trees.classFeatures['second-doctrine-cloistered-cleric'])).toMatch(/Final Doctrine \(19th\)/);
    const html = renderToStaticMarkup(
      <ContentContext.Provider value={db}><PinContext.Provider value={null}>
        <RecordCard record={{ bucket: 'classFeatures', id: 'second-doctrine-cloistered-cleric' }} mode="browse" chrome="popup" onExit={noop} />
      </PinContext.Provider></ContentContext.Provider>,
    );
    const text = squash(html.replace(/<[^>]+>/g, ' '));
    expect(html).toMatch(/class="ast-modal"/);
    expect(text).toMatch(/Your proficiency rank for Fortitude/);
    expect(text).not.toMatch(/Final Doctrine \(19th\)/);
    expect(text).not.toMatch(/First Doctrine \(1st\)/);
  });
});
