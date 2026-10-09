// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { content } from './_content';
import { renderDom } from './_render';
import { SpellDetail } from '../src/sheet/SpellsTab';
import { ContentContext } from '../src/sheet/ContentContext';
import { PinContext, type PinDescApi } from '../src/sheet/PinContext';
import { splitHeightening } from '../src/rules/heightening';
import type { Spell } from '../src/rules/types';
import { loadBucketAst, type AstNode } from '../src/sheet/astStore';

/**
 * Card step 0 (docs/card-design.md section 9, row 0; section 5, the first four rows): pin what the
 * spell popup does TODAY, before any card work touches it.
 *
 * Owner, on the card design: *"don't break spell heightening"*. Nothing guarded the popup itself — the
 * pure helpers have heightening.test.ts, but the four things a player actually reads off the popup
 * (the Heightened entries that apply at the cast rank, the damage arrow spliced into the prose, the
 * area suffix on the Area row, and the Cast-at picker or chip) were asserted nowhere. Every later step
 * that moves the spell popup (16, 17) must keep this file green; a deliberate change flips an
 * assertion with a `// batch card premise:` citation.
 *
 * Rendered through the REAL SpellDetail (exported from SpellsTab.tsx for this file, no other change),
 * on the shipped records from public/core.json. The BODY is the string lane (heightening, the arrow).
 * Card step 16: the stat rows come from the spell's own page, so the tracked public/ast/spells bucket is
 * served through a fetch stub and warmed before any render (the state the app is in once the bucket has
 * loaded); without it the first popup drew the rows' loading placeholder (measured: 1 of 17 red, fireball
 * at its own rank, "expected '' to be '500 feet'"). One row value changed wording with the page
 * (fireball's Defense, cited at the assertion); every heightening assertion is unchanged.
 *
 * Card step 17 (spells phase B): the body, the Heightened entries and the Amp group come from the PAGE
 * TREE (src/sheet/heighteningTree.ts), behind the per-spell parity gate (scripts/heighten-tree-parity.mjs,
 * src/data/heighten-string-lane.json). Every case here is on the tree lane (asserted below) and every
 * heightening, arrow, chip and suffix assertion holds unchanged on it; two assertions flip with the page,
 * each cited: ghostly-shift's Amp paragraphs now reach the popup as their own group (and its body is the
 * page's sentence), and summon-animal's page lists a level per rank where the string said "As listed".
 *
 * MUTATION LINES on the tree lane (each measured red on 2026-10-08, then restored byte-exact):
 *  - SpellsTab.tsx `treeArrow`: `injectTreeArrow(…)` → `null` (no tree arrow) → 7 of 18 red.
 *  - SpellsTab.tsx tree Heightening box: `applies(e)` → `false && applies(e)` → 7 of 18 red.
 *  - SpellsTab.tsx the Area row: `false &&` before the suffix condition → 1 of 18 red (thunderburst).
 *  - heighteningTree.ts splitSpellTree: the Amp matcher off (`false && isAmpBlock(n)`) → 2 of 18 red (ghostly-shift).
 *
 * MUTATION LINES (each measured red on 2026-10-02, then restored byte-exact):
 *  - SpellsTab.tsx, `shownBase`: replace the injectDamageArrow call with `base` → 7 of 17 red.
 *  - SpellsTab.tsx, the Heightening DescBody className: drop `' applies'` → 6 of 17 red.
 *  - SpellsTab.tsx, the Area row: never render the `.up-heighten` suffix span → 1 of 17 red (thunderburst).
 */
const db = content();
const spell = (id: string): Spell => {
  const s = db.spells[id];
  if (!s) throw new Error(`no spell ${id} in the shipped data`);
  return s;
};

beforeAll(async () => {
  const trees: Record<string, AstNode> = JSON.parse(gunzipSync(readFileSync('public/ast/spells.json.gz')).toString('utf8'));
  vi.stubGlobal('fetch', async (url: string) => (/ast\/spells\.json$/.test(String(url)) ? { ok: true, json: async () => trees } : { ok: false }));
  await loadBucketAst('spells');
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
  return { ...r, popup };
}

const txt = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
/** The prose body: the first DescBody after the stat rows / rank selector, i.e. NOT inside the Heightening box or a note. */
const body = (popup: HTMLElement) =>
  [...popup.querySelectorAll('.sd-body > div')].find(
    (d) => !d.matches('.sd-sub, .sd-traits, .sd-stats, .sd-rank-sel, .sd-heighten, .sd-addnote'),
  ) as HTMLElement | undefined;
const entries = (popup: HTMLElement) => [...popup.querySelectorAll('.sd-heighten > .sd-desc')] as HTMLElement[];
const applying = (popup: HTMLElement) => entries(popup).filter((e) => e.classList.contains('applies'));
/** Every arrow the popup spliced in, in document order (prose arrow + Area suffix). */
const arrows = (popup: HTMLElement) => [...popup.querySelectorAll('.up-heighten')].map((e) => txt(e));
const stat = (popup: HTMLElement, label: string) =>
  [...popup.querySelectorAll('.sd-stat')].find((s) => txt(s.querySelector('.sd-stat-k')) === label) as HTMLElement | undefined;
/** The value cell of a stat row (the label sits in its own span with no space before the value). */
const val = (popup: HTMLElement, label: string) => txt(stat(popup, label)?.querySelector('.sd-stat-v'));
const chips = (popup: HTMLElement) => [...popup.querySelectorAll('.sd-rank-sel .sd-rank-chip')] as HTMLElement[];

describe('the shipped records these cases stand on (otherwise the popup assertions measure nothing)', () => {
  // batch card: #card-HEIGHTEN — heightening works as before
  it('fireball, electric-arc, thunderburst, ghostly-shift and summon-animal are shaped as the cases assume', () => {
    const fb = spell('fireball');
    expect([fb.rank, fb.baseDamage, fb.heightening]).toEqual([3, '6d6', { type: 'interval', interval: 1, damageIncr: '2d6' }]);
    const ea = spell('electric-arc');
    expect([ea.rank, ea.baseDamage, ea.traits.includes('cantrip')]).toEqual([0, '2d4', true]);
    const tb = spell('thunderburst');
    // batch card: #card-HEIGHTEN — heightening works as before
    expect([tb.rank, tb.traits.includes('focus'), tb.baseDamage, tb.baseArea]).toEqual([3, true, '2d6', { value: 20, kind: 'burst' }]);
    expect(tb.heightening).toEqual({ type: 'interval', interval: 2, damageIncr: '2d6', areaIncr: 5 });
    // Ghostly Shift's Amp column is printed on its Archives page (public/ast/spells.json) but not in
    // the description string, so the string lane splits exactly one ordinary Heightened entry.
    // batch card premise: spell-2563 "Heightened (+2) The resistance increases by 1."
    expect(splitHeightening(spell('ghostly-shift').description).heightening).toEqual(['**Heightened (+2)** The resistance increases by 1.']);
    // A summon prints "**Heightened** As listed in the trait." with no parentheses: splitHeightening
    // finds no entry, so the line stays in the prose body.
    // batch card: #card-HEIGHTEN — heightening works as before
    expect(splitHeightening(spell('summon-animal').description).heightening).toEqual([]);
    expect(spell('summon-animal').description).toContain('**Heightened** As listed in the trait.');
  });
});

describe('card step 17: every case in this file draws the page body (the tree lane)', () => {
  // batch card: #card-HEIGHTEN — heightening works as before
  it('fireball, electric-arc, thunderburst, ghostly-shift and summon-animal render [data-body="tree"], none is on the string-lane list', () => {
    for (const id of ['fireball', 'electric-arc', 'thunderburst', 'ghostly-shift', 'summon-animal']) {
      const { popup } = open(<SpellDetail spell={spell(id)} maxRank={9} onClose={() => undefined} />);
      expect(body(popup)?.getAttribute('data-body'), id).toBe('tree');
      expect(body(popup)?.querySelector('.ast-body'), `${id} draws the page tree`).not.toBeNull();
    }
  });
});

describe('fireball at a 3rd, 5th and 9th slot (atRank: a prepared slot heightens what it holds)', () => {
  // batch card: #card-HEIGHTEN — heightening works as before
  it('at its own rank: no chip, no arrow, the one Heightened entry listed but not applying', () => {
    const { popup } = open(<SpellDetail spell={spell('fireball')} maxRank={9} atRank={3} onClose={() => undefined} />);
    expect(txt(popup.querySelector('.picker-head'))).toContain('Fireball');
    expect(popup.querySelector('.picker-head .info-star'), 'PinStar is in the header').not.toBeNull();
    expect(txt(popup.querySelector('.sd-sub'))).toBe('3rd rank · Arcane, Primal');
    // batch card premise: spell-1530 "500 feet"
    expect(val(popup, 'Range')).toBe('500 feet');
    // batch card: #card-HEIGHTEN — heightening works as before
    expect(val(popup, 'Area')).toBe('20-foot burst');
    // batch card premise: spell-1530 "Defense basic Reflex"
    expect(val(popup, 'Defense')).toBe('basic Reflex');
    expect(stat(popup, 'Cast')?.querySelector('.sd-stat-v')).not.toBeNull();
    expect(popup.querySelector('.sd-rank-sel'), 'no rank selector at the base rank').toBeNull();
    expect(arrows(popup)).toEqual([]);
    expect(txt(body(popup))).toBe('A roaring blast of fire detonates at a spot you designate, dealing 6d6 fire damage.');
    expect(txt(popup.querySelector('.sd-heighten-h'))).toBe('Heightening');
    // batch card premise: spell-1530 "Heightened (+1) The damage increases by 2d6."
    expect(entries(popup).map((e) => txt(e))).toEqual(['Heightened (+1) The damage increases by 2d6.']);
    // batch card: #card-HEIGHTEN — heightening works as before
    expect(applying(popup)).toHaveLength(0);
  });

  // batch card: #card-HEIGHTEN — heightening works as before
  it.each([
    [5, '5th', '10d6'],
    [9, '9th', '18d6'],
  ])('from a rank-%i slot: a fixed "%s" chip, the arrow (→ %s) after the base dice, the entry applies', (rank, label, dmg) => {
    const { popup } = open(<SpellDetail spell={spell('fireball')} maxRank={9} atRank={rank} onClose={() => undefined} />);
    const sel = popup.querySelector('.sd-rank-sel')!;
    // batch card: #card-HEIGHTEN — heightening works as before
    expect(txt(sel.querySelector('.sd-rank-lbl'))).toBe('Cast at');
    expect(chips(popup).map((c) => [txt(c), c.className])).toEqual([[label, 'sd-rank-chip on sd-rank-static']]);
    expect(sel.querySelector('button'), 'a fixed chip is not a picker').toBeNull();
    expect(arrows(popup)).toEqual([`(→ ${dmg})`]);
    // batch card premise: spell-1530 "A roaring blast of fire detonates at a spot you designate, dealing 6d6"
    expect(txt(body(popup))).toBe(`A roaring blast of fire detonates at a spot you designate, dealing 6d6 (→ ${dmg}) fire damage.`);
    // The arrow is spliced into the PROSE, never onto a stat row; fireball's area does not grow.
    // batch card: #card-HEIGHTEN — heightening works as before
    expect(body(popup)!.querySelector('.up-heighten')).not.toBeNull();
    expect(val(popup, 'Area')).toBe('20-foot burst');
    // batch card premise: spell-1530 "Heightened (+1) The damage increases by 2d6."
    expect(applying(popup).map((e) => txt(e))).toEqual(['Heightened (+1) The damage increases by 2d6.']);
  });

  // batch card: #card-HEIGHTEN — heightening works as before
  it('a slot below the spell rank is clamped to the spell rank, and one above the entry top to the top', () => {
    const low = open(<SpellDetail spell={spell('fireball')} maxRank={9} atRank={1} onClose={() => undefined} />).popup;
    expect(low.querySelector('.sd-rank-sel')).toBeNull();
    expect(arrows(low)).toEqual([]);
    const high = open(<SpellDetail spell={spell('fireball')} maxRank={6} atRank={9} onClose={() => undefined} />).popup;
    expect(chips(high).map((c) => txt(c))).toEqual(['6th']);
    // batch card: #card-HEIGHTEN — heightening works as before
    expect(arrows(high)).toEqual(['(→ 12d6)']);
  });
});

describe('electric-arc, a cantrip, auto-heightened to an 8th-rank maximum', () => {
  // batch card: #card-HEIGHTEN — heightening works as before
  it('shows the fixed "8th" chip, exactly one applying entry, and (→ 9d4) inside the sentence', () => {
    const { popup } = open(<SpellDetail spell={spell('electric-arc')} maxRank={8} onClose={() => undefined} />);
    expect(txt(popup.querySelector('.sd-sub'))).toBe('Cantrip · Arcane, Primal');
    expect(chips(popup).map((c) => [txt(c), c.className])).toEqual([['8th', 'sd-rank-chip on sd-rank-static']]);
    expect(entries(popup)).toHaveLength(1);
    // batch card premise: spell-1509 "Heightened (+1) The damage increases by 1d4."
    expect(applying(popup).map((e) => txt(e))).toEqual(['Heightened (+1) The damage increases by 1d4.']);
    // batch card: #card-HEIGHTEN — heightening works as before
    expect(arrows(popup)).toEqual(['(→ 9d4)']);
    // batch card premise: spell-1509 "An arc of lightning leaps from one target to another"
    expect(txt(body(popup))).toBe(
      'An arc of lightning leaps from one target to another. Each target takes 2d4 (→ 9d4) electricity damage with a basic Reflex save.',
    );
    // batch card premise: spell-1509 "1 or 2 creatures"
    expect(val(popup, 'Targets')).toBe('1 or 2 creatures');
  });

  // batch card: #card-HEIGHTEN — heightening works as before
  it('a cantrip ignores the slot it was opened from: it always heightens to the maximum', () => {
    const { popup } = open(<SpellDetail spell={spell('electric-arc')} maxRank={8} atRank={2} onClose={() => undefined} />);
    expect(chips(popup).map((c) => txt(c))).toEqual(['8th']);
    expect(arrows(popup)).toEqual(['(→ 9d4)']);
  });

  // batch card: #card-HEIGHTEN — heightening works as before
  it('with no maximum it is viewed at its printed rank: no chip, no arrow, nothing applies', () => {
    const { popup } = open(<SpellDetail spell={spell('electric-arc')} onClose={() => undefined} />);
    expect(popup.querySelector('.sd-rank-sel')).toBeNull();
    expect(arrows(popup)).toEqual([]);
    expect(applying(popup)).toHaveLength(0);
  });
});

describe('thunderburst, a focus spell, heightens to the maximum like a cantrip', () => {
  // batch card: #card-HEIGHTEN — heightening works as before
  it('at a 7th-rank maximum: chip "7th", the prose arrow (→ 6d6), the Area suffix (→ 30-foot burst), the entry applies', () => {
    const { popup } = open(<SpellDetail spell={spell('thunderburst')} maxRank={7} atRank={3} onClose={() => undefined} />);
    expect(chips(popup).map((c) => txt(c))).toEqual(['7th']);
    // Document order: the Area row's suffix comes before the prose arrow.
    expect(arrows(popup)).toEqual(['(→ 30-foot burst)', '(→ 6d6)']);
    expect(val(popup, 'Area')).toBe('20-foot burst (→ 30-foot burst)');
    // batch card: #card-HEIGHTEN — heightening works as before
    expect(stat(popup, 'Area')!.querySelector('.sd-stat-v .up-heighten')).not.toBeNull();
    // Only the FIRST standalone "2d6" carries the arrow; the sonic 2d6 right after it is left alone.
    // batch card premise: spell-2088 "bludgeoning damage and 2d6 sonic damage."
    expect(txt(body(popup))).toContain('dealing 2d6 (→ 6d6) bludgeoning damage and 2d6 sonic damage.');
    // batch card: #card-HEIGHTEN — heightening works as before
    expect(body(popup)!.querySelectorAll('.up-heighten')).toHaveLength(1);
    // batch card premise: spell-2088 "Heightened (+2) Each type of damage increases by 2d6, and the area increases by"
    expect(applying(popup).map((e) => txt(e))).toEqual([
      'Heightened (+2) Each type of damage increases by 2d6, and the area increases by 5 feet.',
    ]);
  });

  // batch card: #card-HEIGHTEN — heightening works as before
  it('at a 4th-rank maximum, one rank short of the first (+2) step: the chip shows, but nothing scales and the entry does not apply', () => {
    const { popup } = open(<SpellDetail spell={spell('thunderburst')} maxRank={4} onClose={() => undefined} />);
    expect(chips(popup).map((c) => txt(c))).toEqual(['4th']);
    expect(arrows(popup)).toEqual([]);
    expect(val(popup, 'Area')).toBe('20-foot burst');
    expect(applying(popup)).toHaveLength(0);
  });
});

describe('a signature spell gets the Cast-at picker', () => {
  // batch card: #card-HEIGHTEN — heightening works as before
  it('fireball as a signature spell with a 9th-rank maximum: buttons 3rd to 9th, starting on 3rd', () => {
    const { popup, click } = open(<SpellDetail spell={spell('fireball')} maxRank={9} signature onClose={() => undefined} />);
    const buttons = [...popup.querySelectorAll('.sd-rank-sel button.sd-rank-chip')] as HTMLElement[];
    expect(buttons.map((b) => txt(b))).toEqual(['3rd', '4th', '5th', '6th', '7th', '8th', '9th']);
    expect(buttons.filter((b) => b.classList.contains('on')).map((b) => txt(b))).toEqual(['3rd']);
    expect(popup.querySelector('.sd-rank-static')).toBeNull();
    // batch card: #card-HEIGHTEN — heightening works as before
    expect(arrows(popup)).toEqual([]);
    expect(applying(popup)).toHaveLength(0);

    click(buttons[3]); // 6th
    const after = [...popup.querySelectorAll('.sd-rank-sel button.sd-rank-chip')] as HTMLElement[];
    expect(after.filter((b) => b.classList.contains('on')).map((b) => txt(b))).toEqual(['6th']);
    // batch card: #card-HEIGHTEN — heightening works as before
    expect(arrows(popup)).toEqual(['(→ 12d6)']);
    expect(applying(popup)).toHaveLength(1);

    click(after[0]); // back to 3rd
    expect(arrows(popup)).toEqual([]);
    expect(applying(popup)).toHaveLength(0);
  });

  // batch card: #card-HEIGHTEN — heightening works as before
  it('a signature spell already at the maximum has no picker', () => {
    const { popup } = open(<SpellDetail spell={spell('fireball')} maxRank={3} signature onClose={() => undefined} />);
    expect(popup.querySelector('.sd-rank-sel')).toBeNull();
  });

  // batch card: #card-HEIGHTEN — heightening works as before
  it('the same spell without the signature flag is viewed at its rank, with no picker', () => {
    const { popup } = open(<SpellDetail spell={spell('fireball')} maxRank={9} onClose={() => undefined} />);
    expect(popup.querySelector('.sd-rank-sel')).toBeNull();
    expect(arrows(popup)).toEqual([]);
  });
});

describe('ghostly-shift: the ordinary Heightened group holds no Amp entry', () => {
  // batch card: #card-HEIGHTEN — heightening works as before
  it('at a 5th-rank maximum, exactly one Heightened (+2) entry, applying, and nothing Amp inside the group', () => {
    const { popup } = open(<SpellDetail spell={spell('ghostly-shift')} maxRank={5} onClose={() => undefined} />);
    expect(chips(popup).map((c) => txt(c))).toEqual(['5th']);
    // batch card premise: spell-2563 "Heightened (+2) The resistance increases by 1."
    expect(entries(popup).map((e) => txt(e))).toEqual(['Heightened (+2) The resistance increases by 1.']);
    // batch card: #card-HEIGHTEN — heightening works as before
    expect(applying(popup)).toHaveLength(1);
    expect(txt(popup.querySelector('.sd-heighten'))).not.toMatch(/\bAmp\b/);
  });

  // batch card: #card-HEIGHTEN — heightening works as before
  it('since step 17 the Amp paragraphs reach the popup from the page, as their own group outside the Heightening box', () => {
    // Measured 2026-10-02: 0 of the shipped spell description strings contain the word "Amp"; the Amp
    // and "Amp Heightened (+2)" paragraphs exist only in the page tree. Card step 17 draws the body from
    // the page, and the Amp column is its own group (.sd-amp), never an ordinary Heightened entry.
    // batch card premise: spell-2563 "Your insubstantiality is complete"
    const { popup } = open(<SpellDetail spell={spell('ghostly-shift')} maxRank={5} onClose={() => undefined} />);
    const amp = popup.querySelector('.sd-body > .sd-amp') as HTMLElement | null;
    expect(amp, 'the Amp group').not.toBeNull();
    expect(txt(amp)).toContain('Your insubstantiality is complete enough that you can pass through other creatures');
    expect(txt(amp)).toContain('Amp Heightened (+2) Increase the damage dealt by phasing through a creature by 1d6.');
    expect(amp!.closest('.sd-heighten'), 'never inside the ordinary Heightening box').toBeNull();
    // batch card: #card-HEIGHTEN — heightening works as before
    expect(txt(popup.querySelector('.sd-heighten'))).not.toMatch(/\bAmp\b/);
    // The page's own body (the description string's "Your body becomes insubstantial …" is our older text).
    // batch card premise: spell-2563 "You gain resistance 2 to all damage"
    expect(txt(body(popup))).toBe('You gain resistance 2 to all damage (except force).');
  });
});

describe('a summon printed "Heightened As listed in the trait"', () => {
  // batch card: #card-HEIGHTEN — heightening works as before
  it('summon-animal from a 5th-rank slot: since step 17 the page lists its levels, so the Heightening box holds them and (2nd)–(5th) apply', () => {
    // The description string carries the older "**Heightened** As listed in the trait." (asserted on the
    // record above); the page — the newest printing — lists a creature level per rank, and step 17 draws
    // the page. The summon-list entries stay entries (heightenTrigger on each bold label).
    // batch card premise: spell-1694 "Heightened (5th) Level 5"
    const { popup } = open(<SpellDetail spell={spell('summon-animal')} maxRank={9} atRank={5} onClose={() => undefined} />);
    expect(chips(popup).map((c) => txt(c))).toEqual(['5th']);
    expect(entries(popup).map((e) => txt(e))).toEqual([
      'Heightened (2nd) Level 1.',
      'Heightened (3rd) Level 2.',
      'Heightened (4th) Level 3.',
      'Heightened (5th) Level 5.',
      'Heightened (6th) Level 7.',
      'Heightened (7th) Level 9.',
      'Heightened (8th) Level 11.',
      'Heightened (9th) Level 13.',
      'Heightened (10th) Level 15.',
    ]);
    // batch card premise: spell-1694 "Heightened (2nd) Level 1."
    expect(applying(popup).map((e) => txt(e))).toEqual(['Heightened (2nd) Level 1.', 'Heightened (3rd) Level 2.', 'Heightened (4th) Level 3.', 'Heightened (5th) Level 5.']);
    // batch card: #card-HEIGHTEN — heightening works as before
    expect(arrows(popup)).toEqual([]);
    const prose = txt(body(popup));
    // batch card premise: spell-1694 "You summon a creature that has the animal trait and whose level is -1"
    expect(prose).toBe('You summon a creature that has the animal trait and whose level is –1 to fight for you.');
    // batch card: #card-HEIGHTEN — heightening works as before
    expect(prose).not.toContain('As listed in the trait');
  });
});

describe('closing', () => {
  // batch card: #card-R1 — one card per record
  it('the overlay and the close button call onClose; a click inside the popup does not', () => {
    let closed = 0;
    const { host, popup, click } = open(<SpellDetail spell={spell('fireball')} onClose={() => (closed += 1)} />);
    click(popup.querySelector('.sd-body'));
    expect(closed).toBe(0);
    click(popup.querySelector('.picker-close'));
    // batch card: #card-R1 — one card per record
    expect(closed).toBe(1);
    click(host.querySelector('.picker-overlay'));
    expect(closed).toBe(2);
  });
});
