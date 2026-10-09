// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { content } from './_content';
import { renderDom } from './_render';
import { SpellDetail } from '../src/sheet/SpellsTab';
import { ContentContext } from '../src/sheet/ContentContext';
import { PinContext, type PinDescApi } from '../src/sheet/PinContext';
import { loadBucketAst, type AstNode } from '../src/sheet/astStore';
import { HEIGHTEN_STRING_LANE, spellCardModel, stringLaneFooter } from '../src/sheet/spellCard';
import type { Spell } from '../src/rules/types';

/**
 * Card step 17 (spells phase B), the two fallback rules the tree body brings with it
 * (docs/card-design.md section 1: a page record's words never come from the old import "not even while the
 * page loads"; section 2 rule 3: "While the tree loads, a placeholder shows"; section 7 / section 10: spells
 * left on the string lane "show our older text, marked as such").
 *
 *  - A spell that will draw its page body shows a quiet placeholder body while the spells bucket is on its
 *    way — never the old imported description, never the old string Heightened entries — and the page body
 *    once it lands.
 *  - A spell the parity gate keeps on the string lane (src/data/heighten-string-lane.json) shows its string
 *    body at once (that IS what it will show) and carries a marked ours footer line saying the text is ours,
 *    not the Archives', and why; a tree-lane spell carries no such line.
 *
 * Rendered through the REAL SpellDetail on the shipped records; the tracked public/ast/spells bucket is
 * served through a fetch stub held back by a gate for the first case (the same pattern as
 * test/card-spell.test.tsx). No fixture is the owner's.
 *
 * MUTATION LINES (each measured red on 2026-10-08, then restored byte-exact from a scratch copy, sha1 checked):
 *  - SpellsTab.tsx `const bodyLoading = rowsLoading && !keptOnString` → `= false` (no body placeholder) →
 *    1 of 3 red (the loading case).
 *  - SpellsTab.tsx the string-lane footer `{keptOnString && (` → `{false && (` → 2 of 3 red.
 *  - SpellsTab.tsx `const keptOnString = !!pageId && HEIGHTEN_STRING_LANE.has(spell.id)` → `= false`
 *    (a listed spell treated as a page spell) → 2 of 3 red (its body becomes a placeholder while loading;
 *    no footer).
 *  Fixer round 3 (orchestrator decisions on must-fix 1 and nit 7):
 *  - spellCard.ts stringLaneFooter returns the old generic wording → 1 of 3 red (the footer must name the
 *    Heightened line the same-printing page omits).
 *  - SpellsTab.tsx `{noPage && (` → `{false && noPage && (` → 1 of 3 red (the no-page spell's footer).
 */
const db = content();
const spell = (id: string): Spell => {
  const s = db.spells[id];
  if (!s) throw new Error(`no spell ${id} in the shipped data`);
  return s;
};

let trees: Record<string, AstNode> = {};
let release: () => void = () => undefined;
const gate = new Promise<void>((r) => (release = r));
beforeAll(() => {
  trees = JSON.parse(gunzipSync(readFileSync('public/ast/spells.json.gz')).toString('utf8'));
  vi.stubGlobal('fetch', async (url: string) => {
    if (!/ast\/spells\.json$/.test(String(url))) return { ok: false };
    await gate;
    return { ok: true, json: async () => trees };
  });
});
const loaded = async () => {
  release();
  await act(async () => {
    await loadBucketAst('spells');
  });
};

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
/* Fixer round 3 (must-fix 1): the footer names what the same-printing page omits, from the lane file. */
const OLDER = (id: string) => stringLaneFooter(id)!;
/** The old imported body's opening words, as the string lane would draw them (preamble off, markdown stripped). */
const oldOpening = (s: Spell) =>
  spellCardModel(s, undefined, [])
    .base.replace(/\*\*|_/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);

describe('while the spells page loads', () => {
  // batch card: #card-LOADING — a placeholder while the page loads, never old text
  it('a page-body spell shows a placeholder body — no old imported text, no string entries — then the page body', async () => {
    const s = spell('fireball');
    expect(HEIGHTEN_STRING_LANE.has(s.id)).toBe(false);
    const opening = oldOpening(s);
    expect(opening.length).toBeGreaterThan(20); // not vacuous: the old text exists and would show
    const popup = open(<SpellDetail spell={s} maxRank={5} atRank={5} onClose={() => undefined} />);
    const ph = popup.querySelector('.sd-body > .sd-desc[data-body="loading"]');
    // batch card: #card-LOADING — a placeholder while the page loads, never old text
    expect(ph?.classList.contains('ast-loading')).toBe(true);
    expect(ph?.getAttribute('aria-busy')).toBe('true');
    expect(txt(ph)).toBe('');
    expect(txt(popup)).not.toContain(opening);
    expect(popup.querySelector('.sd-heighten'), 'no old string Heightened entries while loading').toBeNull();
    expect(popup.querySelector('[data-ours-kind="stringLane"]')).toBeNull();
    // A listed spell has nothing better coming: its string body shows at once, marked.
    const kept = spell([...HEIGHTEN_STRING_LANE].sort()[0]);
    const keptPopup = open(<SpellDetail spell={kept} onClose={() => undefined} />);
    // batch card: #card-LOADING — a placeholder while the page loads, never old text
    expect(keptPopup.querySelector('[data-body="loading"]')).toBeNull();
    expect(txt(keptPopup)).toContain(oldOpening(kept));
    expect(txt(keptPopup.querySelector('[data-ours-kind="stringLane"]'))).toBe(OLDER(kept.id));
    // No page decided while the bucket is on its way: no no-page footer either.
    expect(popup.querySelector('[data-ours-kind="noPage"]')).toBeNull();
    expect(keptPopup.querySelector('[data-ours-kind="noPage"]')).toBeNull();

    await loaded();
    // batch card: #card-LOADING — a placeholder while the page loads, never old text
    expect(popup.querySelector('[data-body="loading"]')).toBeNull();
    expect(popup.querySelector('.sd-desc[data-body="tree"] .ast-body')).not.toBeNull();
    // batch card premise: spell-1530 "A roaring blast of fire detonates at a spot you designate"
    expect(txt(popup.querySelector('.sd-desc[data-body="tree"]'))).toContain('A roaring blast of fire detonates at a spot you designate');
  });
});

describe('the spells the parity gate keeps on the string lane are marked as our older text', () => {
  // batch card: #card-FOOTER-WORDS — the owner (2026-10-08): the ours line speaks player words, no "import".
  it('each of the listed spells ends with the ours "Not from the Archives" line, after its string body and entries', async () => {
    await loaded();
    expect(HEIGHTEN_STRING_LANE.size).toBeGreaterThan(0);
    for (const id of HEIGHTEN_STRING_LANE) {
      const popup = open(<SpellDetail spell={spell(id)} maxRank={10} atRank={10} onClose={() => undefined} />);
      const line = popup.querySelector('.sd-body > [data-ours-kind="stringLane"]');
      // batch card: #card-S7 — no page: our text, marked
      expect(line, id).not.toBeNull();
      expect(line!.hasAttribute('data-ours'), id).toBe(true);
      expect(txt(line), id).toBe(OLDER(id));
      // batch card: #card-FOOTER-WORDS — the owner (2026-10-08): player words, no "import".
      expect(txt(line), id).toMatch(/^Not from the Archives — our text; the Archives page prints no Heightened line for \S/);
      const kids = [...popup.querySelectorAll('.sd-body > *')];
      expect(kids[kids.length - 1], `${id}: the line is the footer, last`).toBe(line);
      expect(popup.querySelector('[data-body="tree"]'), id).toBeNull();
    }
  });

  // batch card premise: spell-1530 "A roaring blast of fire detonates at a spot you designate" — the owner (2026-10-08): player words, no "import".
  it('a tree-lane spell, a spell with no page and a homebrew spell carry no string-lane line; the no-page spell carries the no-page footer', async () => {
    await loaded();
    for (const s of [spell('fireball'), { ...spell('fireball'), id: 'lane17-synth-no-page' }, { ...spell('fireball'), id: 'hb-lane17-blast' }]) {
      const popup = open(<SpellDetail spell={s} maxRank={5} atRank={5} onClose={() => undefined} />);
      expect(popup.querySelector('[data-ours-kind="stringLane"]'), s.id).toBeNull();
      // Fixer round 3 (orchestrator decision on nit 7): a spell with no page now says so — section 7's
      // "Not from the Archives — our text", marked ours — so "our text" is expected there and only
      // there; the tree-lane spell and the homebrew id still never say it.
      if (s.id === 'lane17-synth-no-page') {
        const foot = popup.querySelector('.sd-body > [data-ours-kind="noPage"][data-ours]');
        // batch card premise: spell-1530 "A roaring blast of fire detonates at a spot you designate" — the owner (2026-10-08).
        expect(txt(foot), s.id).toBe('Not from the Archives — our text');
      } else {
        // batch card premise: spell-1530 "A roaring blast of fire detonates at a spot you designate" — the owner (2026-10-08).
        expect(txt(popup), s.id).not.toContain('our text');
      }
    }
  });
});
