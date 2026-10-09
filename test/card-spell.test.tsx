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
import { isSpellPage, pageRows, pageStatLines, spellCardModel, stripPrintedPreamble } from '../src/sheet/spellCard';
import type { Spell } from '../src/rules/types';

/**
 * Card step 16 — spells phase A (docs/card-design.md section 9 row 16; section 5 rows "Spell stat rows
 * from fields; our Defense wording", "Area suffix", "Cast-at"; section 13: cards first, mechanics
 * untouched).
 *
 * SpellDetail's stat rows come from the spell's own Archives page (src/sheet/spellCard.ts
 * pageStatLines): the header's labelled lines in printed order, in the page's words, under the card
 * vocabulary (Saving Throw → Defense, Target / Target(s) → Targets). A row the fields carry and the page
 * does not (Buzzing Servants' Area) is not shown while a page exists; the field stays for the engine. The
 * field rows are the fallback only with no tree, or a tree that is not a spell / ritual page. The body is
 * still the description string, with the preamble the rows print taken off its front
 * (stripPrintedPreamble). Cast keeps the field's glyph and the Cast-at chip / picker; the area suffix
 * rides on the page's Area row only when that row names the base area.
 *
 * SpellDetail keeps its own shell in phase A (it is not routed through RecordCard) — asserted below
 * (until card step 22 removed the switches, as CARD_ON.spellDetail staying false; now on the popup itself).
 *
 * Rendered through the REAL SpellDetail on the shipped records (no character: SpellDetail takes the
 * spell alone; the one invented record is a synthesized copy of fireball under an id with no page).
 * The tracked public/ast/spells bucket is served through a fetch stub; the first case holds the stub
 * back to see the loading state, every later case runs with the bucket loaded.
 *
 * MUTATION LINES (each measured red on 2026-10-06, then restored byte-exact from a scratch copy, sha1 checked):
 *  - SpellsTab.tsx areaSuffix: `!fromPage ||` → `true ||` (suffix on every page Area) → 1 of 22 red (hologram-cage).
 *  - SpellsTab.tsx areaSuffix (2026-10-07): drop ` ${spell.baseArea.kind}` from the includes() (value only)
 *    → 1 of 23 red (footholds-and-foothills).
 *  - spellCard.ts isSpellPage: prefix `!!tree ||` (every tree is a spell page) → 1 of 22 red (the feat-page case).
 *  - spellCard.ts stripPrintedPreamble: `if (!md)` → `if (md || !md)` (never strips) → 7 of 22 red.
 *  - SpellsTab.tsx rowsLoading: prefix `false &&` (no placeholder) → 1 of 22 red (the loading case).
 *  - spellCard.ts pageStatLines: `canonLabel(s.lead)` → `canonLabel(s.lead) && s.lead` (no aliases) → 5 of 22 red.
 *  - spellCard.ts pageRows (2026-10-07): the empty-value filter → `true || …` (empty rows drawn) → 2 of 25 red
 *    (fungal-exhalation, the pageRows helper); → `l.value.trim()` (Cast not exempt) → 1 of 25 red (the helper).
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
/** Every case after the first: the bucket has loaded. */
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
  return { ...r, popup };
}

const txt = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
/** The prose body: the first .sd-body child that is not the sub-line, chips, rows, rank selector, Heightening box or a note. */
const body = (popup: HTMLElement) =>
  [...popup.querySelectorAll('.sd-body > div')].find(
    (d) => !d.matches('.sd-sub, .sd-traits, .sd-stats, .sd-rank-sel, .sd-heighten, .sd-addnote'),
  ) as HTMLElement | undefined;
const rowsOf = (popup: HTMLElement) =>
  [...popup.querySelectorAll('.sd-stats .sd-stat')].map((s) => [txt(s.querySelector('.sd-stat-k')), txt(s.querySelector('.sd-stat-v'))]);
const val = (popup: HTMLElement, label: string) => rowsOf(popup).find(([k]) => k === label)?.[1];
const labels = (popup: HTMLElement) => rowsOf(popup).map(([k]) => k);
const chips = (popup: HTMLElement) => [...popup.querySelectorAll('.sd-rank-sel .sd-rank-chip')].map((c) => txt(c));

describe('while the page loads', () => {
  // batch card: #card-LOADING — a placeholder while the page loads, never old text
  it('the rows are a quiet placeholder — never the field rows the page will replace — and then the page rows', async () => {
    const { popup } = open(<SpellDetail spell={spell('buzzing-servants')} onClose={() => undefined} />);
    const ph = popup.querySelector('.sd-stats');
    expect(ph?.classList.contains('ast-loading')).toBe(true);
    expect(ph?.getAttribute('aria-busy')).toBe('true');
    expect(rowsOf(popup)).toEqual([]);
    await loaded();
    // batch card: #card-LOADING — a placeholder while the page loads, never old text
    expect(popup.querySelector('.sd-stats.ast-loading')).toBeNull();
    expect(labels(popup)).toEqual(['Cast', 'Range', 'Targets', 'Duration']);
  });
});

describe('the rows are the page header, in the page words and order', () => {
  beforeAll(loaded);

  // batch card premise: spell-2631 "Area 1 cubic foot" — card step 22: the switch is gone; the popup itself shows it is not RecordCard.
  it('SpellDetail keeps its own shell in phase A: its popup is never a RecordCard', () => {
    const { host, popup } = open(<SpellDetail spell={spell('approximate')} maxRank={4} onClose={() => undefined} />);
    expect(popup.classList.contains('spell-detail')).toBe(true);
    expect(host.querySelector('.card-mine, .ast-modal'), 'no RecordCard shell').toBeNull();
  });

  // batch card: #card-OWNER-4 — Approximate's Area is a stat row
  it('approximate: "Area 1 cubic foot" is a row, the body no longer opens with it, and the cantrip chip still shows', () => {
    // batch card premise: spell-2631 "Area 1 cubic foot"
    const { popup } = open(<SpellDetail spell={spell('approximate')} maxRank={4} onClose={() => undefined} />);
    expect(rowsOf(popup)).toEqual([
      ['Cast', '2'],
      ['Range', '10 feet'],
      ['Area', '1 cubic foot'],
    ]);
    // batch card: #card-OWNER-4 — Approximate's Area is a stat row
    expect(txt(popup.querySelector('.sd-stats'))).toContain('Area1 cubic foot');
    const prose = txt(body(popup));
    // batch card premise: spell-2631 "Your magic quickly flows over an area"
    expect(prose.startsWith('Your magic quickly flows over an area')).toBe(true);
    // batch card: #card-OWNER-4 — Approximate's Area is a stat row
    expect(prose).not.toMatch(/\bArea\b/);
    expect(body(popup)!.querySelector('hr'), 'the preamble rule went with the preamble').toBeNull();
    expect(chips(popup)).toEqual(['4th']);
    expect(popup.querySelector('.sd-stat .pf2-action'), 'the Cast row keeps the field glyph').not.toBeNull();
  });

  // batch card: #card-OWNER-2 — Buzzing Servants: sustained, no Area row
  it('buzzing-servants: "Duration sustained up to 1 minute" and NO Area row (the field carries one; the page does not)', () => {
    // batch card premise: spell-2315 "Duration sustained up to 1 minute"
    const { popup } = open(<SpellDetail spell={spell('buzzing-servants')} onClose={() => undefined} />);
    expect(val(popup, 'Duration')).toBe('sustained up to 1 minute');
    expect(labels(popup)).not.toContain('Area');
    // Mechanics untouched: the stored field the engine reads is still there.
    expect(spell('buzzing-servants').area).toBe('5-foot square');
  });

  // batch card: #card-PAGE-ROWS — the spell rows are the page header
  it("elemental-blast: the Area is whole ('10-foot-radius burst, 30-foot cone, or 60-foot line'), not the scraped 'Area , , or'", () => {
    // batch card premise: spell-2107 "Area 10-foot-radius burst, 30-foot cone, or 60-foot line"
    const { popup } = open(<SpellDetail spell={spell('elemental-blast')} onClose={() => undefined} />);
    expect(val(popup, 'Area')).toBe('10-foot-radius burst, 30-foot cone, or 60-foot line');
    expect(val(popup, 'Defense')).toBe('basic Reflex');
    expect(txt(popup)).not.toContain('Area , , or');
    expect(txt(body(popup)).startsWith('You gather elemental energy')).toBe(true);
  });

  // batch card: #card-PAGE-ROWS — the spell rows are the page header
  it('ignition: "Defense AC" — the page wording replaces "spell attack vs AC"', () => {
    const { popup } = open(<SpellDetail spell={spell('ignition')} onClose={() => undefined} />);
    expect(val(popup, 'Defense')).toBe('AC');
    expect(txt(popup.querySelector('.sd-stats'))).not.toContain('spell attack');
  });

  // batch card: #card-PAGE-ROWS — the spell rows are the page header
  it("a ritual reads its Targets through 'Target(s)' (statuette), with its Cast words and the ritual's own lines", () => {
    expect(pageStatLines(trees.statuette).find((l) => l.label === 'Targets')?.printedAs).toBe('Target(s)');
    const { popup } = open(<SpellDetail spell={spell('statuette')} onClose={() => undefined} />);
    expect(labels(popup)).toEqual(['Cast', 'Secondary Casters', 'Primary Check', 'Secondary Checks', 'Range', 'Targets']);
    expect(val(popup, 'Cast')).toBe('1 hour');
    // batch card premise: ritual-24 "1 freestanding, non-magical object no larger than 3,000 cubic feet (the size of a"
    expect(val(popup, 'Targets')).toBe('1 freestanding, non-magical object no larger than 3,000 cubic feet (the size of a Huge creature)');
  });

  // batch card: #card-PAGE-ROWS — the spell rows are the page header
  it("a legacy spell reads its Defense through 'Saving Throw' (abyssal-plague), and its Cast line keeps the components beside the glyph", () => {
    expect(pageStatLines(trees['abyssal-plague']).find((l) => l.label === 'Defense')?.printedAs).toBe('Saving Throw');
    const { popup } = open(<SpellDetail spell={spell('abyssal-plague')} onClose={() => undefined} />);
    expect(val(popup, 'Defense')).toBe('Fortitude');
    expect(val(popup, 'Cast')).toBe('2 somatic, verbal');
    expect(popup.querySelector('.sd-stat .pf2-action'), 'the glyph stays beside the page words').not.toBeNull();
  });

  // batch card: #card-PAGE-ROWS — the spell rows are the page header
  it('anathematic-reprisal: its Trigger is a row, and the body no longer opens with it', () => {
    const { popup } = open(<SpellDetail spell={spell('anathematic-reprisal')} onClose={() => undefined} />);
    expect(labels(popup)).toEqual(['Cast', 'Trigger', 'Range', 'Targets', 'Defense']);
    // batch card premise: spell-9 "A creature performs an act anathema to your deity."
    expect(val(popup, 'Trigger')).toBe('A creature performs an act anathema to your deity.');
    // batch card: #card-PAGE-ROWS — the spell rows are the page header
    expect(txt(body(popup))).not.toMatch(/\bTrigger\b/);
    // batch card premise: spell-9 "You punish a creature"
    expect(txt(body(popup)).startsWith('You punish a creature')).toBe(true);
  });

  // batch card: #card-PAGE-ROWS — the spell rows are the page header
  it("borrow-time: the scraped 'Borrow Time / Source …' header is gone from the body; its lines are rows", () => {
    const { popup } = open(<SpellDetail spell={spell('borrow-time')} onClose={() => undefined} />);
    const prose = txt(body(popup));
    expect(prose.startsWith('Borrow Time Source')).toBe(false);
    // batch card premise: ritual-247 "This spell suspends time around you"
    expect(prose.startsWith('This spell suspends time around you')).toBe(true);
    // batch card: #card-PAGE-ROWS — the spell rows are the page header
    expect(labels(popup)).toEqual(['Cast', 'Cost', 'Secondary Casters', 'Primary Check', 'Secondary Checks', 'Area', 'Targets', 'Duration']);
    expect(val(popup, 'Duration')).toBe('varies');
  });

  // batch card: #card-FURNITURE — navigation furniture leaves, by name
  it('the where-to-get lines (Traditions, Deities …) are not rows; the sub-line keeps the field traditions', () => {
    const { popup } = open(<SpellDetail spell={spell('fireball')} onClose={() => undefined} />);
    expect(labels(popup)).toEqual(['Cast', 'Range', 'Area', 'Defense']);
    expect(txt(popup.querySelector('.sd-sub'))).toBe('3rd rank · Arcane, Primal');
    expect(txt(popup.querySelector('.sd-stats'))).not.toMatch(/Traditions|Deities|Source/);
  });

  // batch card: #card-PAGE-ROWS — the spell rows are the page header
  it("fungal-exhalation: the page's bare 'Target' (nothing after it) draws no empty Targets row", () => {
    // The page prints the label with no value (1 of 2016 spell pages); the row would say nothing.
    expect(pageStatLines(trees['fungal-exhalation']).find((l) => l.label === 'Targets')?.value.trim()).toBe('');
    const { popup } = open(<SpellDetail spell={spell('fungal-exhalation')} onClose={() => undefined} />);
    expect(labels(popup)).toEqual(['Cast', 'Area', 'Defense']);
    expect(rowsOf(popup).filter(([k, v]) => k !== 'Cast' && !v)).toEqual([]);
  });
});

describe('heightening on page rows', () => {
  beforeAll(loaded);

  // batch card: #card-ARROW — an arrow only where a printed entry grants it
  it('fireball from a 5th-rank slot still shows (→ 10d6) in the prose; its page Area carries no suffix (fireball does not grow)', () => {
    const { popup } = open(<SpellDetail spell={spell('fireball')} maxRank={9} atRank={5} onClose={() => undefined} />);
    expect([...popup.querySelectorAll('.up-heighten')].map((e) => txt(e))).toEqual(['(→ 10d6)']);
    expect(val(popup, 'Area')).toBe('20-foot burst');
    expect(chips(popup)).toEqual(['5th']);
  });

  // batch card: #card-ARROW — an arrow only where a printed entry grants it
  it('thunderburst at a 7th-rank maximum: the page Area row carries the suffix (→ 30-foot burst)', () => {
    const { popup } = open(<SpellDetail spell={spell('thunderburst')} maxRank={7} onClose={() => undefined} />);
    expect(val(popup, 'Area')).toBe('20-foot burst (→ 30-foot burst)');
    expect(popup.querySelector('.sd-stats[data-lane="page"]')).not.toBeNull();
  });

  // batch card: #card-ARROW — an arrow only where a printed entry grants it
  it("hologram-cage at a 7th-rank maximum: the page Area ('1 cube 20 feet on each side') lacks '20-foot', so no suffix claims a shape it does not print", () => {
    // batch card premise: spell-2561 "Area 1 cube 20 feet on each side"
    const { popup } = open(<SpellDetail spell={spell('hologram-cage')} maxRank={7} onClose={() => undefined} />);
    expect(val(popup, 'Area')).toBe('1 cube 20 feet on each side');
    expect(popup.querySelector('.sd-stats .up-heighten')).toBeNull();
    expect(chips(popup)).toEqual(['7th']);
  });

  // batch card: #card-ARROW — an arrow only where a printed entry grants it
  it("footholds-and-foothills at 7th: the page Area ('30-foot radius …') names 30 feet but no burst, so no '(→ N-foot burst)' suffix", () => {
    // section 5 "Area suffix": skipped for footholds-and-foothills, hologram-cage, mushroom-patch.
    // ritual-219 "Area 30-foot radius that doesn’t contain any structures"
    const { popup } = open(<SpellDetail spell={spell('footholds-and-foothills')} maxRank={7} atRank={7} onClose={() => undefined} />);
    expect(popup.querySelector('.sd-stats[data-lane="page"]')).not.toBeNull();
    // batch card premise: ritual-219 "30-foot radius"
    expect(val(popup, 'Area')).toMatch(/^30-foot radius /);
    // batch card: #card-ARROW — an arrow only where a printed entry grants it
    expect(popup.querySelector('.sd-stats .up-heighten')).toBeNull();
  });
});

describe('the field lane: no tree, or a tree that is not a spell page', () => {
  beforeAll(loaded);

  // batch card: #card-S7 — no page: our text, marked
  it('a synthesized spell with no page (a copy of fireball under an unknown id) shows the old field rows', () => {
    const stub: Spell = { ...spell('fireball'), id: 'lane16-synth-no-page', name: 'Synth Blast' };
    expect(trees[stub.id]).toBeUndefined();
    const { popup } = open(<SpellDetail spell={stub} maxRank={9} atRank={5} onClose={() => undefined} />);
    expect(popup.querySelector('.sd-stats[data-lane="field"]')).not.toBeNull();
    // batch card: #card-S7 — no page: our text, marked
    expect(rowsOf(popup)).toEqual([
      ['Cast', '2'],
      ['Range', '500 feet'],
      ['Area', '20-foot burst'],
      ['Defense', 'basic Reflex save'],
    ]);
    // batch card: #card-S7 — no page: our text, marked
    expect([...popup.querySelectorAll('.up-heighten')].map((e) => txt(e))).toEqual(['(→ 10d6)']);
  });

  // batch card: #card-ARROW — an arrow only where a printed entry grants it
  it('a field-lane spell still gets the area suffix unconditionally, exactly as before (hologram-cage under an unknown id)', () => {
    const stub: Spell = { ...spell('hologram-cage'), id: 'lane16-synth-cage' };
    const { popup } = open(<SpellDetail spell={stub} maxRank={7} onClose={() => undefined} />);
    expect(val(popup, 'Area')).toBe('20-foot cube (→ 25-foot cube)');
  });

  // batch card: #card-S7 — no page: our text, marked
  it("a spell whose tree is a feat page (aon-litany-against-sloth, badge 'Feat 10') keeps the field rows", () => {
    expect(isSpellPage(trees['aon-litany-against-sloth'])).toBe(false);
    const { popup } = open(<SpellDetail spell={spell('aon-litany-against-sloth')} onClose={() => undefined} />);
    expect(popup.querySelector('.sd-stats[data-lane="field"]')).not.toBeNull();
    expect(val(popup, 'Defense')).toBe('Will save');
  });

  // batch card: #card-S7 — no page: our text, marked
  it('a homebrew id never asks for a page: no placeholder, the field rows at once', () => {
    const hb: Spell = { ...spell('fireball'), id: 'hb-lane16-blast', name: 'Homebrew Blast' };
    const { popup } = open(<SpellDetail spell={hb} onClose={() => undefined} />);
    expect(popup.querySelector('.sd-stats.ast-loading')).toBeNull();
    expect(val(popup, 'Defense')).toBe('basic Reflex save');
  });
});

describe('the pure helpers (the guard models the popup with the same functions)', () => {
  // batch card: #card-GUARD — the guard computes with the card's functions
  it('pageStatLines: fireball reads Range, Area, Defense — no Source, Traditions or Deities', () => {
    // batch card premise: spell-1530 "500 feet"
    expect(pageStatLines(trees.fireball).map((l) => [l.label, l.value])).toEqual([
      ['Range', '500 feet'],
      ['Area', '20-foot burst'],
      ['Defense', 'basic Reflex'],
    ]);
  });

  // batch card: #card-GUARD — the guard computes with the card's functions
  it('stripPrintedPreamble keeps a label line the rows did not print, and returns the string itself when nothing goes', () => {
    const md = '**Area** 1 cubic foot\n\n---\n\nYour magic flows.';
    expect(stripPrintedPreamble(md, new Set(['Cast', 'Range']))).toBe(md);
    expect(stripPrintedPreamble(md, new Set(['Area']))).toBe('Your magic flows.');
    const two = '**Trigger** A foe moves.\n\n**Area** 5-foot burst\n\n---\n\nYou react.';
    expect(stripPrintedPreamble(two, new Set(['Trigger']))).toBe('**Area** 5-foot burst\n\n---\n\nYou react.');
    // Never inside a sentence: a bold word in prose is not a preamble.
    const prose = 'You **Stride** twice.';
    // batch card: #card-GUARD — the guard computes with the card's functions
    expect(stripPrintedPreamble(prose, new Set(['Area', 'Trigger']))).toBe(prose);
  });

  // batch card: #card-FURNITURE — navigation furniture leaves, by name
  it("stripPrintedPreamble on a scraped header: name, Source and where-to-get lines go; an unprinted label line stays", () => {
    const md = 'Synth Ward \nSource Synth Book pg. 12\nTraditions Arcane\nCast somatic, verbal\n\n Range 30 feet\nTarget 1 creature \n\nYou ward the target.';
    expect(stripPrintedPreamble(md, new Set(['Cast', 'Range', 'Targets']), 'Synth Ward')).toBe('You ward the target.');
    expect(stripPrintedPreamble(md, new Set(['Cast', 'Range']), 'Synth Ward')).toBe('Target 1 creature \n\nYou ward the target.');
  });

  // batch card: #card-GUARD — the guard computes with the card's functions
  it('spellCardModel: page lane for a spell page, field lane otherwise; printed = the rows', () => {
    const fb = spellCardModel(spell('fireball'), trees.fireball, []);
    expect([fb.lane, [...fb.printed]]).toEqual(['page', ['Cast', 'Range', 'Area', 'Defense']]);
    const bz = spellCardModel(spell('buzzing-servants'), trees['buzzing-servants'], []);
    expect(bz.rows.map(([k]) => k)).not.toContain('Area');
    const nt = spellCardModel({ ...spell('fireball'), id: 'x' }, undefined, [['Cast', undefined], ['Range', '500 feet'], ['Area', undefined]]);
    // batch card: #card-GUARD — the guard computes with the card's functions
    expect([nt.lane, nt.rows]).toEqual(['field', [['Cast', ''], ['Range', '500 feet']]]);
    // batch card premise: spell-2631 "Your magic quickly"
    expect(spellCardModel(spell('approximate'), trees.approximate, []).base.startsWith('Your magic quickly')).toBe(true);
  });

  // batch card: #card-GUARD — the guard computes with the card's functions
  it('pageRows skips a label printed with no value, but keeps an empty Cast (its glyph is its value)', () => {
    const lines = [
      { label: 'Cast', printedAs: 'Cast', value: '' },
      { label: 'Area', printedAs: 'Area', value: '15-foot cone' },
      { label: 'Targets', printedAs: 'Target', value: ' ' },
    ] as Parameters<typeof pageRows>[0];
    // batch card: #card-GUARD — the guard computes with the card's functions
    expect(pageRows(lines, { cast: undefined } as never)).toEqual([['Cast', ''], ['Area', '15-foot cone']]);
    const fx = spellCardModel(spell('fungal-exhalation'), trees['fungal-exhalation'], []);
    expect([...fx.printed]).toEqual(['Cast', 'Area', 'Defense']);
  });
});
