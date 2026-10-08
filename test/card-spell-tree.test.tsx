// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { content } from './_content';
import { renderDom } from './_render';
import { SpellDetail } from '../src/sheet/SpellsTab';
import { ContentContext } from '../src/sheet/ContentContext';
import { PinContext, type PinDescApi } from '../src/sheet/PinContext';
import { loadBucketAst, type AstNode } from '../src/sheet/astStore';
import { heighteningApplies, scaleDamage, splitHeightening } from '../src/rules/heightening';
import {
  HEIGHTEN_STRING_LANE,
  arrowAt,
  arrowDisplayDrift,
  printedInsideFooter,
  printedInsideTitle,
  castRanksAbove,
  heightenGate,
  heightenParityAll,
  spellCardModel,
  stringEntryWords,
  stringLaneFooter,
  stringLaneProblems,
  treeEntryWords,
  type HeightenParity,
  type HeightenStringLaneFile,
} from '../src/sheet/spellCard';
import { injectTreeArrow, splitSpellTree, treeEntryApplies } from '../src/sheet/heighteningTree';
import type { Spell } from '../src/rules/types';
import { parseBlocks, cleanRun } from '../src/sheet/RichText';
import STRING_LANE_JSON from '../src/data/heighten-string-lane.json';
import * as lib from '../scripts/lib/card-scope.mjs';
import { EXPORT_DIR, loadReprintIndex, newestPrinting } from '../scripts/lib/reprint.mjs';

const STRING_LANE_FILE = STRING_LANE_JSON as HeightenStringLaneFile;
const REPRINTS = STRING_LANE_FILE.reprints ?? {};
type DisplayDrift = ReturnType<typeof arrowDisplayDrift>;
type DriftEntry = { id: string; displaySuppressed: DisplayDrift['suppressed']; displayFromPrint: DisplayDrift['fromPrint'] };
/** work/card-step17-heighten-reprint-drift.json (scripts/heighten-tree-parity.mjs --write). */
const DRIFT = JSON.parse(readFileSync('work/card-step17-heighten-reprint-drift.json', 'utf8')) as {
  reprintDrift: DriftEntry[];
  engineDrift: DriftEntry[];
  notOwnPage: { id: string; page: string; title: string }[];
};

/**
 * Card step 17 — spells phase B (docs/card-design.md section 9 row 17; section 5 rows "Heightening split +
 * .applies rail" and "Damage arrow"; section 13: mechanics untouched; the owner: "don't break spell
 * heightening").
 *
 * The spell popup's body, its Heightened entries and the psychic Amp group come from the spell's own
 * Archives page tree (src/sheet/heighteningTree.ts splitSpellTree), behind a per-spell parity gate
 * (scripts/heighten-tree-parity.mjs → src/data/heighten-string-lane.json): a spell whose applying entries
 * would shrink at any cast rank, or whose inline damage arrow would disappear, stays on the string lane —
 * unless its page is a NEWER printing than the string (owner rule R12: the page wins; those draw the tree and
 * are listed in work/card-step17-heighten-reprint-drift.json for the rebuild lane).
 * This file is the gate's proof over the WHOLE corpus (pure functions, the same the script runs) and the
 * popup's, rendered through the REAL SpellDetail on the shipped records (no character; the tracked
 * public/ast/spells bucket served through a fetch stub and warmed before any render, as in
 * test/card-spell-heighten.test.tsx). No fixture is the owner's: the one invented record is a copy of a
 * shipped spell under an id with no page.
 *
 * MUTATION LINES (each measured red on 2026-10-08, then restored byte-exact from a scratch copy, sha1 checked;
 * "of 12" = before the ledger case was added):
 *  - spellCard.ts spellCardModel: `!stringLane.has(spell.id)` → `true` (the list ignored) → 1 of 12 red
 *    (the listed spells draw the string).
 *  - heighteningTree.ts splitSpellTree: the Heightened matcher `HEIGHTENED.test(l)` → `/^Heightened \(/.test(l)`
 *    (the bare summon label no longer an entry) → 1 of 12 red (the summon matcher case).
 *  - heighteningTree.ts splitSpellTree: `if (isAmpBlock(n))` → `if (false && isAmpBlock(n))` (the Amp column
 *    falls into the last Heightened entry) → 2 of 12 red (the 18 Amp spells; the Amp Heightened rail), and
 *    2 of 18 in test/card-spell-heighten.test.tsx.
 *  - AstRenderer.tsx `up-heighten`: drop `data-ours=""` → 1 of 12 red (the arrow is marked ours).
 *  - SpellsTab.tsx: the boxed arrow line not drawn (`treeArrow && !treeArrow.found` → `false`) → 1 of 12 red
 *    (every heightened damage reaches the popup: electrified-crystal-ward, shadow-illusion).
 *  - SpellsTab.tsx: the footer not drawn (`onTree && cut!.foot.length > 0` → `false`) → 1 of 12 red.
 *  - SpellsTab.tsx: the tree Heightening box's `applies(e)` → `false && applies(e)` → 3 of 12 red.
 *  - scripts/lib/card-scope.mjs judgeRow: `row.drawn ?? (…)` → `(…)` (the ledger reads the whole page) →
 *    1 of 13 red (the card-guard case).
 *  - scripts/lib/card-scope.mjs surfaceRows: the step-17 loop skipped (`true || model.body !== 'tree'`) →
 *    test/card-parity.test.tsx red: 9 DOM/ledger disagreements (the spoiler banners the popup leaves out).
 *  Fixer round 2 ("of 15"):
 *  - heighteningTree.ts splitSpellTree: the sidebar closer `if (inGroup && (n.t === 'title' || …))` →
 *    `if (false && …)` (the sidebar falls into the last entry) → 1 of 15 red (the sidebar case).
 *  - spellCard.ts heightenParity: the words pass `w.words ? pool.findIndex(…) : -1` → `false && w.words ? …`
 *    (trigger keys only) → 3 of 15 red (the list goes stale; weapon-of-judgment and the other two shrink).
 *  - SpellsTab.tsx: the sidebar not drawn (`onTree && cut!.after.length > 0` → `false && …`) → 1 of 15 red.
 *  Fixer round 3 ("of 20"; orchestrator ruling on owner rule R12: a page that is a NEWER printing than the
 *  string wins; only a same-printing omission keeps the string):
 *  - spellCard.ts heightenGate: `const older = p.lost.length > 0 ? …` → `false && p.lost.length > 0 ? …` (a
 *    reprint treated as a loss) → 1 of 20 red (the gate case); with the lane file then regenerated by
 *    `heighten-tree-parity.mjs --write` (quick-sort, sea-of-thought, purify-soul-path back on the string
 *    lane) → 4 of 20 red (STALE direction, gate, reprint evidence, quick-sort "500 objects"). Both files
 *    restored byte-exact from scratch copies, sha1 checked.
 *  - spellCard.ts heightenParity: `lostEntries.add(w.entry)` → `void lostEntries` (no lost entry recorded)
 *    → 1 of 20 red (the gate case).
 *  - spellCard.ts stringLaneProblems: the STALE loop `if (!stay.has(id))` → `if (false && !stay.has(id))`
 *    → 1 of 20 red (the STALE direction case).
 *  - spellCard.ts stringLaneFooter: the old generic wording returned → 1 of 20 red (rite-of-repatriation),
 *    and 1 of 3 in test/card-spell-body-loading.test.tsx.
 *  - SpellsTab.tsx: the ours "Amp" heading put back → 1 of 20 red (the 18 Amp spells).
 *  - SpellsTab.tsx: the boxed arrow line drawn inside `.sd-desc[data-body=tree]` (the ours box after the body
 *    switched off) → 1 of 20 red (every heightened damage reaches the popup).
 *  - SpellsTab.tsx: the no-page footer not drawn (`{noPage && (` → `{false && noPage && (`) → 1 of 20 red,
 *    and 1 of 3 in test/card-spell-body-loading.test.tsx.
 *  - SpellsTab.tsx: the no-page book check dropped (`!!spell.source?.book &&` removed) → 1 of 20 red (the
 *    seed's app-authored restore-senses gains the footer).
 *  Fixer round 4 ("of 25"; the orchestrator's round-3 arrow rule and not-own-page ruling):
 *  - spellCard.ts arrowAt: the backing removed (`if (spell) return { ...out, damage: engineDamage, area:
 *    engineArea };` first) → 3 of 25 red (sea-of-thought, wall-of-ice, the corpus set).
 *  - spellCard.ts arrowAt: the printed-steps branch off (`if (false && h?.type === 'interval' && …`) → 2 of 25
 *    red (wall-of-ice at 7th draws the engine's 4d6; the corpus set).
 *  - spellCard.ts arrowAt: fireball withheld at 4th with no file entry (`if (spell.id === 'fireball' && rank
 *    === 4) return out;`) → 1 of 25 red (the corpus set), and `heighten-tree-parity.mjs --check` exit 1.
 *  - work/card-step17-heighten-reprint-drift.json: draw-the-lightning's displaySuppressed damage [5,6,7] → []
 *    → 1 of 25 red (the corpus set).
 *  - SpellsTab.tsx: the not-own-page footer not drawn (`{false && insideFooter && (`) and the area suffix's
 *    `data-ours=""` dropped, together → 2 of 25 red, one each (aon-litany-against-sloth; thunderburst).
 *  Each restored byte-exact from a scratch copy, sha1 checked.
 */
const db = content();
const spell = (id: string): Spell => {
  const s = db.spells[id];
  if (!s) throw new Error(`no spell ${id} in the shipped data`);
  return s;
};
let trees: Record<string, AstNode> = {};
let parity: HeightenParity[] = [];

beforeAll(async () => {
  trees = JSON.parse(gunzipSync(readFileSync('public/ast/spells.json.gz')).toString('utf8'));
  vi.stubGlobal('fetch', async (url: string) => (/ast\/spells\.json$/.test(String(url)) ? { ok: true, json: async () => trees } : { ok: false }));
  await loadBucketAst('spells');
  parity = heightenParityAll(db.spells, trees, () => []);
});

const pin: PinDescApi = { has: () => false, toggle: () => undefined };
let stops: (() => void)[] = [];
afterEach(() => {
  for (const s of stops) s();
  stops = [];
});
function open(el: ReactElement) {
  const r = renderDom(
    <ContentContext.Provider value={db}>
      <PinContext.Provider value={pin}>{el}</PinContext.Provider>
    </ContentContext.Provider>,
  );
  stops.push(r.stop);
  const popup = r.host.querySelector('.picker.spell-detail') as HTMLElement | null;
  if (!popup) throw new Error('no spell popup rendered');
  return popup;
}
const txt = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const body = (popup: HTMLElement) =>
  [...popup.querySelectorAll('.sd-body > div')].find(
    (d) => !d.matches('.sd-sub, .sd-traits, .sd-stats, .sd-rank-sel, .sd-heighten, .sd-addnote'),
  ) as HTMLElement | undefined;
const entries = (popup: HTMLElement) => [...popup.querySelectorAll('.sd-heighten > .sd-desc')] as HTMLElement[];
const applying = (popup: HTMLElement) => entries(popup).filter((e) => e.classList.contains('applies'));
/** The popup at cast rank `r` (a slot of rank r; a cantrip / focus spell heightens to the same maximum). */
const at = (s: Spell, r: number) => open(<SpellDetail spell={s} maxRank={r} atRank={r} onClose={() => undefined} />);

describe('the gate: src/data/heighten-string-lane.json is the parity result, both ways, over the whole corpus', () => {
  it('lists exactly the spells that fail parity on their own printing (no stale id, no unlisted one), and the popup reads the same list', () => {
    expect(stringLaneProblems(STRING_LANE_FILE.ids, parity, Object.keys(REPRINTS))).toEqual([]);
    expect([...HEIGHTEN_STRING_LANE].sort()).toEqual([...STRING_LANE_FILE.ids].sort());
    // Not vacuous: the gate saw the corpus (2,016 tree-body candidates measured 2026-10-08) and keeps a few.
    expect(parity.length).toBeGreaterThan(2000);
    expect(HEIGHTEN_STRING_LANE.size).toBeGreaterThan(0);
    expect(HEIGHTEN_STRING_LANE.size).toBeLessThan(20);
  });

  it('the STALE direction: a listed spell that passes parity is reported, so the list can only shrink', () => {
    // Fixer round 3 (must-fix 2): fireball draws the tree and loses nothing; listing it is stale.
    expect(parity.find((p) => p.id === 'fireball')?.stay).toBe(false);
    expect(stringLaneProblems([...STRING_LANE_FILE.ids, 'fireball'], parity, Object.keys(REPRINTS))).toEqual(['fireball|STRING-LANE-STALE']);
    expect(stringLaneProblems([...STRING_LANE_FILE.ids, 'fireball'], parity)).toContain('fireball|STRING-LANE-STALE');
    // A reprint-drift spell listed on the string lane is stale too (the page wins), and a reprint entry
    // for a spell that no longer fails parity is reported as stale drift.
    expect(stringLaneProblems([...STRING_LANE_FILE.ids, 'quick-sort'], parity, Object.keys(REPRINTS))).toEqual(['quick-sort|STRING-LANE-STALE']);
    expect(stringLaneProblems(STRING_LANE_FILE.ids, parity, [...Object.keys(REPRINTS), 'fireball'])).toEqual(['fireball|REPRINT-DRIFT-STALE']);
  });

  it('the gate splits the failing spells by printing (owner rule R12): a page that is a NEWER printing wins and draws the tree; a same-printing page that omits a line keeps the string', () => {
    // The gate re-run on the file's own evidence (the older printing's Heightened lines, written by
    // scripts/heighten-tree-parity.mjs from scripts/lib/reprint.mjs's index) reproduces the file exactly.
    const gate = heightenGate(parity, (id) => (REPRINTS[id] ? [REPRINTS[id]] : []));
    expect(gate.reprintDrift.map((d) => d.id)).toEqual(['purify-soul-path', 'quick-sort', 'sea-of-thought']);
    expect(gate.reprintDrift.map((d) => [d.from, d.to])).toEqual([['ritual-67', 'ritual-243'], ['spell-978', 'spell-2797'], ['spell-1162', 'spell-2579']]);
    expect(gate.stringLane).toEqual(STRING_LANE_FILE.ids.map((id) => ({ id, missing: STRING_LANE_FILE.missing![id] })));
    expect(gate.stringLane).toEqual([{ id: 'rite-of-repatriation', missing: ['(+1)'] }]);
    // Each reprint's newer document IS the page the popup draws.
    for (const [id, ev] of Object.entries(REPRINTS)) expect(trees[id]?.aon, id).toBe(ev.to);
    // Without the reprint evidence every failing spell would be a loss: the evidence is what moves them.
    expect(heightenGate(parity, () => []).stringLane.map((s) => s.id)).toEqual(['purify-soul-path', 'quick-sort', 'rite-of-repatriation', 'sea-of-thought']);
    // An older printing that does not print the lost line is no evidence: the spell stays a loss.
    const notPrinted = heightenGate(parity, (id) => (id === 'quick-sort' ? [{ ...REPRINTS[id], entries: [REPRINTS[id].entries[0]] }] : []));
    expect(notPrinted.stringLane.map((s) => s.id)).toContain('quick-sort');
  });

  it.skipIf(!existsSync(EXPORT_DIR))("the file's reprint evidence is the Archives' own link (the export's legacy_id / remaster_id, scripts/lib/reprint.mjs)", () => {
    const index = loadReprintIndex(undefined, { text: true });
    for (const [id, ev] of Object.entries(REPRINTS)) {
      expect(newestPrinting(index, ev.from), id).toBe(ev.to);
      const lines = String(index.docs.get(ev.from)?.text ?? '').split('\n').map((l) => l.trim()).filter((l) => /^\W*Heightened\b/.test(l));
      expect(lines, id).toEqual(ev.entries);
    }
    // rite-of-repatriation's page replaces no older printing: its omission is the same printing's.
    for (const id of STRING_LANE_FILE.ids) {
      const doc = trees[id]?.aon;
      expect([...index.next.keys()].filter((old) => newestPrinting(index, old) === doc), id).toEqual([]);
    }
  }, 120_000);

  it('0 tree-body spells whose applied Heightened set shrinks at any cast rank, or whose inline damage arrow disappears, except where the page is a newer printing', () => {
    const bad = parity.filter((p) => !HEIGHTEN_STRING_LANE.has(p.id) && !REPRINTS[p.id] && (p.shrinks.length > 0 || p.arrowLost)).map((p) => p.id);
    expect(bad).toEqual([]);
    // The reprint-drift spells lose only the older printing's lines, never an arrow.
    for (const id of Object.keys(REPRINTS)) expect(parity.find((p) => p.id === id)?.arrowLost, id).toBe(false);
    // The check is not empty: these spells carry entries and arrows on both lanes.
    expect(parity.filter((p) => !HEIGHTEN_STRING_LANE.has(p.id) && p.stringEntries > 0).length).toBeGreaterThan(1100);
    expect(parity.filter((p) => !HEIGHTEN_STRING_LANE.has(p.id) && p.arrowString).length).toBeGreaterThan(380);
  });

  it('the numbers do not move: the tree arrow carries scaleDamage at every rank, the same value the string lane splices', () => {
    for (const p of parity.filter((x) => x.arrowTree)) {
      const s = spell(p.id);
      const cut = splitSpellTree(trees[p.id])!;
      for (const r of castRanksAbove(s.rank)) {
        const up = scaleDamage(s, r);
        if (!up) continue;
        const { body: out, found } = injectTreeArrow(cut.body, s.baseDamage!, up);
        expect(found, p.id).toBe(true);
        expect(JSON.stringify(out), `${p.id} at ${r}`).toContain(`{"t":"up-heighten","v":"(→ ${up})"}`);
      }
    }
  });
});

describe('the popup on the tree lane', () => {
  it('the listed spells draw the string body as in phase A; every other spell page draws the tree', () => {
    for (const id of HEIGHTEN_STRING_LANE) {
      const popup = at(spell(id), 10);
      expect(body(popup)?.getAttribute('data-body'), id).toBeNull();
      expect(body(popup)?.querySelector('.ast-body'), `${id} draws no tree`).toBeNull();
      // Its string entries keep the rail exactly as before.
      const want = splitHeightening(spell(id).description || '').heightening.filter((h) => 10 > spell(id).rank && heighteningApplies(h, spell(id).rank, 10)).length;
      expect(applying(popup), id).toHaveLength(want);
    }
    expect(spellCardModel(spell('fireball'), trees.fireball, []).body).toBe('tree');
  });

  it('a spell whose page is a newer printing draws the page (quick-sort at 3rd: "500 objects", no older-import footer)', () => {
    // Fixer round 3 (must-fix 1; owner rule R12 "the newest printing wins, whole"): Impossible Magic's
    // quick-sort (spell-2797) replaces Secrets of Magic's (spell-978), whose "(3rd) 400 objects" and "(5th)
    // 800 objects" our string still carries. The page wins.
    expect(HEIGHTEN_STRING_LANE.has('quick-sort')).toBe(false);
    expect(spellCardModel(spell('quick-sort'), trees['quick-sort'], []).body).toBe('tree');
    const popup = at(spell('quick-sort'), 3);
    expect(body(popup)?.getAttribute('data-body')).toBe('tree');
    // batch card premise: spell-2797 "The spell can sort up to 500 objects in a minute, or 75 objects in a round"
    expect(applying(popup).map((e) => txt(e))).toEqual(['Heightened (3rd) The spell can sort up to 500 objects in a minute, or 75 objects in a round.']);
    expect(entries(popup)).toHaveLength(1);
    expect(txt(popup)).not.toMatch(/400 objects|800 objects/);
    expect(popup.querySelector('[data-ours-kind="stringLane"]')).toBeNull();
    // batch card premise: spell-2797 "sort up to 500 objects in a minute" — the page draws whole, so no ours footer (its words are "our text" since 2026-10-08).
    expect(txt(popup)).not.toContain('our text');
    // The other two reprints draw their page too (the page prints no Heightened line at all).
    for (const id of ['sea-of-thought', 'purify-soul-path']) {
      const p = at(spell(id), 6);
      expect(body(p)?.getAttribute('data-body'), id).toBe('tree');
      expect(p.querySelector('.sd-heighten'), id).toBeNull();
      expect(p.querySelector('[data-ours-kind="stringLane"]'), id).toBeNull();
    }
  });

  it('a same-printing page that omits a Heightened line keeps the string, and its footer names the missing line (rite-of-repatriation)', () => {
    expect(HEIGHTEN_STRING_LANE.has('rite-of-repatriation')).toBe(true);
    // batch card premise: ritual-105 "1 object of up to 4th level" — the owner (2026-10-08): the ours footer speaks player words, no "import".
    expect(stringLaneFooter('rite-of-repatriation')).toBe('Not from the Archives — our text; the Archives page prints no Heightened line for (+1)');
    expect(stringLaneFooter('fireball')).toBeNull();
    const popup = at(spell('rite-of-repatriation'), 4);
    expect(body(popup)?.getAttribute('data-body')).toBeNull();
    expect(applying(popup)).toHaveLength(1);
    expect(txt(applying(popup)[0])).toMatch(/^Heightened \(\+1\) Increase the maximum target level by 2, the cast time by 1 hour/);
    const foot = popup.querySelector('.sd-body > [data-ours-kind="stringLane"][data-ours]');
    // batch card premise: ritual-105 "1 object of up to 4th level" — the owner (2026-10-08).
    expect(txt(foot)).toBe('Not from the Archives — our text; the Archives page prints no Heightened line for (+1)');
    // The page really prints no Heightened line: the tree cut holds no entry.
    expect(splitSpellTree(trees['rite-of-repatriation'])!.heightening).toEqual([]);
  });

  it('the 124 spells whose string entries carry no bold label gain the rail on the page: every applying entry railed, led by its bold label', () => {
    const unbolded = Object.keys(db.spells)
      .sort()
      .filter((id) => splitHeightening(db.spells[id].description || '').heightening.some((h) => !/^\*\*Heightened/.test(h)));
    // Measured 2026-10-08: 124 spells (dragon-claws, touch-of-corruption, mindscape-shift …).
    expect(unbolded).toHaveLength(124);
    let railed = 0;
    for (const id of unbolded) {
      const s = spell(id);
      const model = spellCardModel(s, trees[id], []);
      expect(model.body, `${id} is on the tree lane`).toBe('tree');
      const popup = at(s, 10);
      const want = splitHeightening(s.description || '').heightening.filter((h) => 10 > s.rank && heighteningApplies(h, s.rank, 10)).length;
      const have = model.tree!.heightening.filter((e) => 10 > s.rank && treeEntryApplies(e, s.rank, 10)).length;
      expect(applying(popup), id).toHaveLength(have);
      expect(have, id).toBeGreaterThanOrEqual(want);
      for (const e of applying(popup)) expect(txt(e.querySelector('strong')), id).toMatch(/^Heightened\b/);
      railed += applying(popup).length;
    }
    expect(railed).toBeGreaterThan(124);
  });

  it('every heightened damage reaches the popup: inline in the page prose (marked ours), boxed for the two the page gives no anchor', () => {
    const boxed: string[] = [];
    for (const p of parity.filter((x) => x.arrow)) {
      const s = spell(p.id);
      // Round 3 (the orchestrator's arrow rule): the value the popup draws is arrowAt's — the engine's
      // wherever the page prints its interval, the page's own count on the listed drift spells (asserted in
      // the arrow-rule block below).
      // batch card premise: spell-1750 "the cold damage dealt to creatures crossing a destroyed section increases by 1d6"
      const m = spellCardModel(s, trees[p.id], []);
      const r = Math.max(...castRanksAbove(s.rank).filter((rr) => arrowAt(s, m, rr).damage));
      const up = arrowAt(s, m, r).damage!;
      const popup = at(s, r);
      const arrows = [...popup.querySelectorAll('.up-heighten')].map((e) => txt(e));
      expect(arrows, `${p.id} at ${r}`).toContain(`(→ ${up})`);
      if (HEIGHTEN_STRING_LANE.has(p.id)) continue;
      const inline = body(popup)!.querySelector('.ast-body .up-heighten');
      if (inline) {
        expect(inline.getAttribute('data-ours'), p.id).toBe('');
        expect(txt(inline)).toBe(`(→ ${up})`);
      } else {
        // Fixer round 3 (nit 6): the boxed line is a line of the ours box AFTER the page, never a child of
        // the page body.
        const line = popup.querySelector('.sd-body > .card-ours[data-ours] > .sd-arrow-line[data-ours]');
        expect(line, `${p.id} boxes its arrow in the ours box`).not.toBeNull();
        expect(txt(line)).toBe(`Heightened damage ${s.baseDamage} (→ ${up})`);
        expect(popup.querySelector('.sd-desc[data-body="tree"] .sd-arrow-line'), `${p.id}: not inside the page body`).toBeNull();
        expect(popup.querySelector('.sd-desc[data-body="tree"]')?.contains(line), p.id).toBe(false);
        const kids = [...popup.querySelectorAll('.sd-body > div')];
        expect(kids.indexOf(line!.parentElement!), `${p.id}: after the page body`).toBeGreaterThan(kids.indexOf(body(popup)!));
        boxed.push(p.id);
      }
    }
    expect(boxed).toEqual(['electrified-crystal-ward', 'shadow-illusion']);
  });

  it('the 18 Amp spells: the Amp paragraphs are their own group (.sd-amp), never inside the Heightening box', () => {
    const amp = parity.filter((p) => p.ampEntries > 0).map((p) => p.id);
    expect(amp).toHaveLength(18);
    for (const id of amp) {
      const popup = at(spell(id), 10);
      const group = popup.querySelector('.sd-body > .sd-amp');
      expect(group, id).not.toBeNull();
      // Fixer round 3 (nit 5): no heading of ours — the page's own bold "Amp" heads the group, once, first.
      expect(group?.querySelector('.sd-heighten-h, [data-ours]'), id).toBeNull();
      const bold = [...group!.querySelectorAll('strong')].map((b) => txt(b));
      expect(bold[0], id).toBe('Amp');
      expect(bold.filter((b) => b === 'Amp'), id).toHaveLength(1);
      expect(txt(group), id).toMatch(/^Amp\b/);
      expect(txt(popup.querySelector('.sd-heighten')), id).not.toMatch(/\bAmp\b/);
      expect(txt(body(popup)), id).not.toMatch(/\bAmp\b/);
    }
    // batch card premise: spell-2547 "Your thoughts expand in scope and power"
    const rend = at(spell('telekinetic-rend'), 1);
    expect(txt(rend.querySelector('.sd-amp'))).toContain('Your thoughts expand in scope and power.');
  });

  it('an "Amp Heightened (+N)" entry carries the rail at the ranks it applies to, and not below them', () => {
    // telekinetic-rend (Cantrip 1, rank 0): "Amp Heightened (+2)" applies from cast rank 2, by the same rule
    // as an ordinary "(+2)" entry of the same spell.
    const ampRail = (popup: HTMLElement) => [...popup.querySelectorAll('.sd-amp > .sd-desc.applies')].map((e) => txt(e).slice(0, 19));
    expect(ampRail(at(spell('telekinetic-rend'), 1))).toEqual([]);
    expect(ampRail(at(spell('telekinetic-rend'), 5))).toEqual(['Amp Heightened (+2)']);
    expect(applying(at(spell('telekinetic-rend'), 5)).map((e) => txt(e))).toEqual(['Heightened (+2) The damage increases by 1d6.']);
  });

  it('a list printed under an entry stays with that entry (evolution-surge: each "Heightened" entry holds its own options)', () => {
    const popup = at(spell('evolution-surge'), 5);
    const es = entries(popup);
    expect(es.map((e) => txt(e.querySelector('strong')))).toEqual(['Heightened (3rd)', 'Heightened (5th)']);
    for (const e of es) expect(e.querySelector('ul li'), txt(e).slice(0, 20)).not.toBeNull();
    expect(applying(popup)).toHaveLength(2);
  });

  it('a sidebar printed after the Heightened entries is drawn after the box, never inside the railed entry (dragon-form, detect-alignment …)', () => {
    // Fixer round 2: the 4 tree-lane pages that print a sidebar (a title / heading, its prose, its table)
    // after their last entry, measured 2026-10-08.
    const withAfter = Object.keys(db.spells)
      .sort()
      .filter((id) => (spellCardModel(spell(id), trees[id], []).tree?.after.length ?? 0) > 0);
    expect(withAfter).toEqual(['aon-detect-alignment', 'detect-alignment', 'dragon-form', 'spiritual-attunement']);
    // Every block attached under an entry is a list or (transmigrate's 5th-rank ritual) its prose / degrees.
    for (const id of Object.keys(db.spells)) {
      const m = spellCardModel(spell(id), trees[id], []);
      for (const e of m.tree?.heightening ?? []) for (const n of e.nodes.slice(1)) expect(['ul', 'ol', 'p', 'br'], `${id} ${e.label}`).toContain(n.t);
    }
    // batch card premise: spell-1502 "The dragons from Lost Omens: Draconic Codex use the following specifications"
    const popup = at(spell('dragon-form'), 8);
    const rail = applying(popup);
    expect(rail.map((e) => txt(e.querySelector('strong')))).toEqual(['Heightened (8th)']);
    expect(txt(rail[0])).not.toMatch(/Monster Core Dragons|Draconic Codex/);
    const after = popup.querySelector('.sd-body > .sd-after[data-body="tree-after"]');
    expect(after).not.toBeNull();
    expect(after?.classList.contains('applies')).toBe(false);
    expect(txt(after)).toContain('The dragons from Lost Omens: Draconic Codex use the following specifications');
    // Print order: the Heightening box, then the sidebar.
    const kids = [...popup.querySelectorAll('.sd-body > div')];
    expect(kids.indexOf(after!)).toBe(kids.indexOf(popup.querySelector('.sd-body > .sd-heighten')!) + 1);
  });

  it('the gate holds an entry the page prints under another label with the same words (weapon-of-judgment, celestial-brand, cloud-current draw the tree)', () => {
    for (const id of ['weapon-of-judgment', 'celestial-brand', 'cloud-current']) {
      expect(HEIGHTEN_STRING_LANE.has(id), id).toBe(false);
      const p = parity.find((x) => x.id === id)!;
      expect([p.shrinks, p.stay], id).toEqual([[], false]);
      expect(spellCardModel(spell(id), trees[id], []).body, id).toBe('tree');
    }
    // batch card premise: spell-2044 "The damage increases by 1d10"
    // weapon-of-judgment (9th rank): the page's "(+1)" applies at 10 exactly where the string's "(10th)" did.
    expect(applying(at(spell('weapon-of-judgment'), 10)).map((e) => txt(e))).toEqual(['Heightened (+1) The damage increases by 1d10.']);
    // The words pass compares the sentence, never the label: a different sentence under another label does not hold.
    expect(stringEntryWords('**Heightened (10th)** The damage increases by [1d10](/x).')).toBe('the damage increases by 1d10');
    const entry = { nodes: [{ t: 'p', c: [{ t: 'b', c: [{ t: 'text', v: 'Heightened (+1)' }] }, { t: 'text', v: ' The damage increases by 1d10.' }] }] as AstNode[] };
    expect(treeEntryWords(entry)).toBe('the damage increases by 1d10');
    expect(stringEntryWords('**Heightened (5th)** The spell can sort up to 800 objects.')).not.toBe(treeEntryWords(entry));
  });

  it("the footer is the page header's own lines the rows do not print: the Source line, dimmed, last; no where-to-get line anywhere", () => {
    // batch card premise: spell-1530 "Source Player Core pg. 331"
    const popup = at(spell('fireball'), 3);
    const kids = [...popup.querySelectorAll('.sd-body > div')];
    const foot = popup.querySelector('.sd-body > .sd-foot');
    expect(kids[kids.length - 1]).toBe(foot);
    expect(txt(foot)).toBe('Source Player Core pg. 331');
    expect(foot?.querySelector('p.card-dim')).not.toBeNull();
    expect(txt(popup)).not.toMatch(/Traditions|Deities|Angradd/);
    // The rows the stat block prints are not drawn a second time.
    expect(txt(body(popup))).not.toMatch(/\b(Range|Area|Defense)\b/);
  });

  it('the card guard judges the tree the popup draws (spellCardModel.drawn): the where-to-get lines are left out by name, nothing unnamed', () => {
    // scripts/lib/card-scope.mjs judgeRow on a tree-body spell row as surfaceRows builds it (card step 17):
    // the drawn tree, not the whole page — so the Traditions / Deities lines the popup never draws are
    // omissions named S-furniture, the printed rows S-printed, and the Source line is drawn.
    const m = spellCardModel(spell('fireball'), trees.fireball, []);
    const row = {
      surface: 'spellDetail', bucket: 'spells', id: 'fireball', own: { bucket: 'spells', id: 'fireball' },
      read: { bucket: 'spells', slug: 'fireball' }, drawn: m.drawn, card: { printed: m.rows.map(([l]) => l) },
      hideMeta: false, itemLists: true, md: spell('fireball').description, printed: m.rows, mode: 'mine',
    };
    const r = lib.judgeRow(row, { spells: trees }, { parseBlocks, cleanRun });
    expect([r.lane, r.identity, r.labels, r.unnamed]).toEqual(['tree', false, {}, []]);
    const omitted = (r.omitted as { text: string; rule: string }[]).map((o) => [o.text.replace(/\s+/g, ' ').trim().split(' ')[0], o.rule]);
    expect(omitted).toEqual([['Traditions', 'S-furniture'], ['Deities', 'S-furniture'], ['Range', 'S-printed'], ['Area', 'S-printed'], ['Defense', 'S-printed']]);
  });

  it('a spell with no page (a copy of fireball under an unknown id) and a homebrew id keep the string body', () => {
    const synth: Spell = { ...spell('fireball'), id: 'lane17-synth-no-page' };
    const popup = at(synth, 5);
    expect(body(popup)?.getAttribute('data-body')).toBeNull();
    expect([...popup.querySelectorAll('.up-heighten')].map((e) => txt(e))).toEqual(['(→ 10d6)']);
    // Fixer round 3 (nit 7; section 7 "No own page"): the no-page footer, marked ours, last.
    const foot = popup.querySelector('.sd-body > [data-ours-kind="noPage"][data-ours]');
    // batch card premise: spell-1530 "A roaring blast of fire detonates at a spot you designate" — the owner (2026-10-08): player words, no "import".
    expect(txt(foot)).toBe('Not from the Archives — our text');
    expect([...popup.querySelectorAll('.sd-body > *')].pop()).toBe(foot);
    const hb = at({ ...spell('fireball'), id: 'hb-lane17-blast' }, 5);
    expect(body(hb)?.getAttribute('data-body')).toBeNull();
    expect(hb.querySelector('[data-ours-kind="noPage"]'), 'a homebrew id is not an official record with no page').toBeNull();
    // The 7 official spells (each names its book) whose page the spells bucket does not hold carry it too;
    // the seed's 3 app-authored demo spells (no book) and a page spell do not (section 7).
    const noTree = Object.keys(db.spells).filter((id) => !trees[id]).sort();
    const official = noTree.filter((id) => spell(id).source?.book);
    expect(official).toEqual(['anima-invocation-modified', 'aspirational-state', 'commune-with-nature', 'create-mycoguardian', 'destroy-mindscape', 'rite-of-cleansing-flame', 'unfettered-mark']);
    expect(noTree.filter((id) => !official.includes(id))).toEqual(['restore-senses', 'searing-light', 'wall-of-light']);
    // batch card premise: ritual-7 "natural resources within a 3-mile radius" — commune-with-nature, one of the 7; the owner (2026-10-08).
    for (const id of official) expect(txt(at(spell(id), 10).querySelector('[data-ours-kind="noPage"]')), id).toBe('Not from the Archives — our text');
    for (const id of noTree.filter((x) => !official.includes(x))) expect(at(spell(id), 10).querySelector('[data-ours-kind="noPage"]'), id).toBeNull();
    expect(at(spell('fireball'), 5).querySelector('[data-ours-kind="noPage"]')).toBeNull();
  });

  it('a record printed inside a bigger page of another category keeps our text, footed as ours with that page\'s title (aon-litany-against-sloth)', () => {
    // The orchestrator's round-3 ruling: the 8 aon-* records whose tree is a feat / rules / hazard page keep
    // the string until the spells surface draws slices, with an ours footer naming the page they are printed in.
    // batch card premise: feat-239 "Litany Against Sloth"
    expect(printedInsideTitle(spell('aon-litany-against-sloth'), trees['aon-litany-against-sloth'])).toBe('Litany Against Sloth');
    const popup = at(spell('aon-litany-against-sloth'), 5);
    expect(body(popup)?.getAttribute('data-body')).toBeNull();
    const foot = popup.querySelector('.sd-body > [data-ours-kind="notOwnPage"][data-ours]');
    // batch card premise: feat-239 "you can cast the litany against sloth devotion spell" — the owner (2026-10-08): player words, no "import".
    expect(txt(foot)).toBe('Printed inside Litany Against Sloth — our text');
    expect([...popup.querySelectorAll('.sd-body > *')].pop()).toBe(foot);
    expect(popup.querySelector('[data-ours-kind="noPage"]'), 'it has a page: not the no-page footer').toBeNull();
    // The 8, exactly the drift file's notOwnPage list; a spell page and a no-page spell carry no such footer.
    const inside = Object.keys(db.spells).sort().filter((id) => printedInsideFooter(spell(id), trees[id]));
    expect(inside).toEqual(DRIFT.notOwnPage.map((e) => e.id));
    expect(DRIFT.notOwnPage.map((e) => e.page)).toEqual(['hazard-278', 'feat-239', 'feat-227', 'feat-1689', 'feat-254', 'feat-1681', 'rules-2735', 'feat-7259']);
    for (const e of DRIFT.notOwnPage) expect(e.title, e.id).toBe(printedInsideTitle(spell(e.id), trees[e.id]));
    expect(at(spell('fireball'), 5).querySelector('[data-ours-kind="notOwnPage"]')).toBeNull();
    expect(at(spell('commune-with-nature'), 6).querySelector('[data-ours-kind="notOwnPage"]')).toBeNull();
  });

  it('the summon matcher: a bare "Heightened" label (no parenthesis) is an entry with no trigger — listed, never railed', () => {
    // Measured 2026-10-08: 0 shipped spell pages print it (every summon page lists its levels); the matcher
    // stands so the older printing's "Heightened As listed in the trait" can never fall into the prose.
    const page: AstNode = {
      t: 'doc',
      c: [
        { t: 'p', c: [{ t: 'b', c: [{ t: 'text', v: 'Range' }] }, { t: 'text', v: ' 30 feet' }] },
        { t: 'hr' },
        { t: 'p', c: [{ t: 'text', v: 'You summon a creature.' }] },
        { t: 'hr' },
        { t: 'p', c: [{ t: 'b', c: [{ t: 'text', v: 'Heightened' }] }, { t: 'text', v: ' As listed in the trait.' }] },
      ],
    };
    const cut = splitSpellTree(page)!;
    expect(cut.heightening.map((e) => [e.label, e.trigger])).toEqual([['Heightened', null]]);
    expect(cut.body.map((n) => n.t)).toEqual(['hr', 'p']);
    expect(treeEntryApplies(cut.heightening[0], 1, 10)).toBe(false);
  });
});

describe("the arrow rule (the orchestrator's round-3 ruling): an arrow or area suffix only where a printed Heightened entry of the page the player reads backs it", () => {
  const areaSuffix = (popup: HTMLElement) =>
    [...popup.querySelectorAll('.sd-stat')].find((s) => txt(s.querySelector('.sd-stat-k')) === 'Area')?.querySelector('.sd-stat-v .up-heighten') ?? null;

  it('sea-of-thought at 6th: its newer printing prints no Heightened line, so no arrow and no area suffix (the engine still says +5 feet a rank)', () => {
    // batch card premise: spell-2579 "Area 15-foot burst"
    const s = spell('sea-of-thought');
    expect(s.heightening).toEqual({ type: 'interval', interval: 1, areaIncr: 5 });
    const popup = at(s, 6);
    expect(popup.querySelector('.up-heighten')).toBeNull();
    expect(areaSuffix(popup)).toBeNull();
    expect(txt([...popup.querySelectorAll('.sd-stat')].find((x) => txt(x.querySelector('.sd-stat-k')) === 'Area')?.querySelector('.sd-stat-v'))).toBe('15-foot burst');
    expect(arrowAt(s, spellCardModel(s, trees['sea-of-thought'], []), 6)).toEqual({ damage: null, area: null, engineDamage: null, engineArea: 30 });
  });

  it("wall-of-ice: no damage arrow at 6th; at 7th the arrow its printed (+2) entry grants (2d6 + 1d6 = 3d6), never the engine's every-rank 4d6", () => {
    // batch card premise: spell-1750 "the cold damage dealt to creatures crossing a destroyed section increases by 1d6"
    const s = spell('wall-of-ice');
    expect([s.rank, s.baseDamage, s.heightening]).toEqual([5, '2d6', { type: 'interval', interval: 1, damageIncr: '1d6' }]);
    const six = at(s, 6);
    expect(six.querySelector('.up-heighten')).toBeNull();
    expect(applying(six)).toHaveLength(0);
    const seven = at(s, 7);
    expect([...seven.querySelectorAll('.up-heighten')].map((e) => txt(e))).toEqual(['(→ 3d6)']);
    expect(txt(body(seven))).toContain('deals 2d6 (→ 3d6) cold damage to any creature passing through it');
    expect(applying(seven).map((e) => txt(e.querySelector('strong')))).toEqual(['Heightened (+2)']);
    // The engine's own value is untouched (listed in the drift file, not drawn).
    expect(scaleDamage(s, 7)).toBe('4d6');
  });

  it("fireball at 5th still shows its arrow (the page's (+1) is the engine's interval), marked ours; the area suffix span is marked ours (thunderburst)", () => {
    // batch card premise: spell-1530 "The damage increases by 2d6"
    const fb = at(spell('fireball'), 5);
    const arrow = body(fb)!.querySelector('.up-heighten');
    expect(txt(arrow)).toBe('(→ 10d6)');
    expect(arrow?.getAttribute('data-ours')).toBe('');
    // fireball's engine heightens no area (no areaIncr) and its page prints none: no suffix to draw.
    expect(areaSuffix(fb)).toBeNull();
    // The suffix, where one is drawn, is ours (nit 2): thunderburst's "(+2) … the area increases by 5 feet".
    // batch card premise: spell-2088 "the area increases by 5 feet"
    const tb = at(spell('thunderburst'), 7);
    expect(txt(areaSuffix(tb))).toBe('(→ 30-foot burst)');
    expect(areaSuffix(tb)?.getAttribute('data-ours')).toBe('');
  });

  it('the spells whose arrows are withheld or re-counted are EXACTLY the drift file\'s, rank by rank, and every one is a drift entry (a new one enters only through the file)', () => {
    const computed: Record<string, DisplayDrift> = {};
    for (const id of Object.keys(db.spells).sort()) {
      const d = arrowDisplayDrift(spell(id), spellCardModel(spell(id), trees[id], []));
      if (d.suppressed.damage.length || d.suppressed.area.length || Object.keys(d.fromPrint).length) computed[id] = d;
    }
    const listed = [...DRIFT.reprintDrift, ...DRIFT.engineDrift];
    const fromFile = Object.fromEntries(
      listed
        .filter((e) => e.displaySuppressed.damage.length || e.displaySuppressed.area.length || Object.keys(e.displayFromPrint).length)
        .map((e) => [e.id, { suppressed: e.displaySuppressed, fromPrint: e.displayFromPrint }]),
    );
    expect(computed).toEqual(fromFile);
    // Withheld somewhere: the 6 engine-drift spells of round 2, draw-the-lightning (its page prints only
    // "(8th)"), and sea-of-thought (reprint drift). Measured 2026-10-08.
    const withheld = Object.keys(computed).filter((id) => computed[id].suppressed.damage.length || computed[id].suppressed.area.length);
    expect(withheld).toEqual(['breath-of-life', 'draw-the-lightning', 'inner-upheaval', 'positive-attunement', 'sea-of-thought', 'wall-of-ice']);
    expect(Object.keys(computed)).toEqual(['breath-of-life', 'celestial-brand', 'draw-the-lightning', 'gluttonous-growth', 'inner-upheaval', 'positive-attunement', 'sea-of-thought', 'wall-of-ice']);
    // Every other spell draws the engine's own value at every rank an entry backs, and no arrow disappears.
    const ids = new Set(listed.map((e) => e.id));
    for (const id of Object.keys(computed)) expect(ids.has(id), `${id} is a drift entry`).toBe(true);
    // The withheld ranks are exactly the ranks the page grants nothing (wall-of-ice: 6th; sea-of-thought: all).
    expect(computed['wall-of-ice'].suppressed).toEqual({ damage: [6], area: [] });
    expect(computed['sea-of-thought'].suppressed).toEqual({ damage: [], area: [4, 5, 6, 7, 8, 9, 10] });
    expect(computed['wall-of-ice'].fromPrint['7']).toEqual({ damage: ['3d6', '4d6'] });
  });
});
