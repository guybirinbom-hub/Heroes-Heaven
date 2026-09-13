// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { renderDom } from './_render';
import { AstRenderer } from '../src/sheet/AstRenderer';
import type { AstNode } from '../src/sheet/astStore';

/**
 * bug 2026-09-12 #9: inline-glyph.
 *
 * Owner, on the same "Activate an Item" popup: *"the action glyphs aren't in the same lines as the
 * text, why are they in a line of their own?"* — the page read
 *
 *     such as “
 *     ⟨reaction⟩
 *     command.”
 *
 * three blocks tall. The cause is in the ast, not the font: AoN split the sentence at the glyph, so
 * `actions` arrived as a SIBLING of the two half-paragraphs, and the renderer's block branch gave it
 * `<div class="ast-actline">` — a block between two `<p>`s. (No `actions` node anywhere in the corpus
 * sits inside a paragraph's children: 0 of 19,017. Every one is a sibling block.)
 *
 * Blocks already reunites sentences the parser split at a `<sup>`; the glyph now joins that fold, but
 * ONLY when the sentence carries on after it. Measured on the shipped artefact: of the 19,017 `actions`
 * nodes (9,419 of them inside a title/heading), 2,099 on 853 pages are followed by a continuation
 * fragment at all, and the fold reunites 1,351 of them across 815 pages in the hideMeta path (1,393 on
 * 847 in the modal path). 3,846 glyph lines still render as their own block under hideMeta, down from
 * 5,885 (the modal path, 5,745): a glyph that ends its run is an ability heading's cost and must keep
 * its line. actions/call-gun is one of those and is asserted below.
 *
 * The 1–5 digit mapping (reaction = 5, single action = 1) is settled and is asserted, not changed.
 */
const readBucket = (b: string) =>
  JSON.parse(gunzipSync(readFileSync(`public/ast/${b}.json.gz`)).toString('utf8')) as Record<string, AstNode>;

const actions = readBucket('actions');
const ACTIVATE = actions['activate-an-item'];
const CALL_GUN = actions['call-gun'];
const GUIDE = readBucket('items')['aon-guide'];
const ASURA = readBucket('trait')['asura'];
const SHEPHERD = readBucket('apparition')['shepherd-of-errant-winds'];

const bodyOf = (host: HTMLElement) => {
  const b = host.querySelector('.ast-body');
  if (!b) throw new Error('no .ast-body rendered');
  return b as HTMLElement;
};

describe('bug #9 — a split-out glyph rejoins its sentence', () => {
  it('the page tree really does split the sentence at the glyph (otherwise this guard measures nothing)', () => {
    const top = ACTIVATE.c ?? [];
    expect(top.slice(5, 8).map((n) => n.t)).toEqual(['p', 'actions', 'p']);
    expect(top[6].string).toBe('Reaction');
    // the two halves of one sentence, as they ship
    const textOf = (n: AstNode): string => (n.t === 'text' ? String(n.v ?? '') : (n.c || []).map(textOf).join(''));
    expect(textOf(top[5])).toMatch(/for example, “Activate$/);
    expect(textOf(top[7])).toBe(' command.”');
  });

  it('the glyph is an inline span inside the SAME paragraph as the text around it', () => {
    const { host, stop } = renderDom(<AstRenderer node={ACTIVATE} bodyOnly hideMeta onOpenRef={() => undefined} />);
    try {
      const body = bodyOf(host);
      const glyph = body.querySelector('.ast-ag[title="Reaction"]') as HTMLElement | null;
      expect(glyph, 'the reaction glyph reaches the screen').not.toBeNull();
      expect(glyph!.tagName).toBe('SPAN');
      expect(glyph!.textContent, 'the settled 1-5 mapping: reaction = 5').toBe('5');

      const p = glyph!.parentElement!;
      expect(p.tagName, 'no block wrapper of its own').toBe('P');
      expect(p.className).not.toContain('ast-actline');
      // …and that paragraph is the whole sentence, both halves of it.
      expect(p.textContent).toContain('for example, “Activate');
      expect(p.textContent).toContain('command.”');
      // nothing between the words but the glyph: no line breaks, no second block.
      expect(p.querySelectorAll('br, div, p')).toHaveLength(0);
      expect(p.textContent).toMatch(/“Activate\s*5\s*command\.”/);
    } finally { stop(); }
  });

  it('the second split sentence on the page folds the same way, and no glyph line is left behind', () => {
    const { host, stop } = renderDom(<AstRenderer node={ACTIVATE} bodyOnly hideMeta onOpenRef={() => undefined} />);
    try {
      const body = bodyOf(host);
      expect(body.querySelectorAll('.ast-actline'), 'both stray glyph lines are gone').toHaveLength(0);
      const single = body.querySelector('.ast-ag[title="Single Action"]') as HTMLElement;
      expect(single.textContent).toBe('1');
      expect(single.parentElement!.tagName).toBe('P');
      expect(single.parentElement!.textContent).toContain('Activation Components Each activation entry lists');
      expect(single.parentElement!.textContent).toContain('command.” The activation components');
    } finally { stop(); }
  });

  it('an ability heading\'s glyph KEEPS its own line — actions/call-gun, unchanged', () => {
    const { host, stop } = renderDom(<AstRenderer node={CALL_GUN} bodyOnly hideMeta onOpenRef={() => undefined} />);
    try {
      const body = bodyOf(host);
      const line = body.querySelector('.ast-actline');
      expect(line, 'a glyph that ends its run is a block line, as before').not.toBeNull();
      expect(line!.querySelector('.ast-ag')!.textContent).toBe('1');
      // the heading above it is still its own paragraph — the fold did not swallow it
      expect(line!.previousElementSibling!.textContent!.trim()).toBe('Call Gun');
      expect(line!.nextElementSibling!.textContent).toContain('(magical) Effect You hold aloft');
    } finally { stop(); }
  });

  it('a stat ROW folds too, and stays a stat row (items/aon-guide)', () => {
    const { host, stop } = renderDom(<AstRenderer node={GUIDE} onOpenRef={() => undefined} />);
    try {
      const body = bodyOf(host);
      const melee = [...body.querySelectorAll('p')].find((p) => (p.textContent ?? '').startsWith('Melee'));
      expect(melee!.querySelector('.ast-ag')!.textContent).toBe('1');
      expect(melee!.textContent).toContain('greataxe +12');
      // "Ranged" is a meta label, so its reunited row keeps the meta styling rather than becoming prose.
      const ranged = [...body.querySelectorAll('.ast-meta')].find((d) => (d.textContent ?? '').startsWith('Ranged'));
      expect(ranged, 'the ranged row is one dimmed stat line').not.toBeUndefined();
      expect(ranged!.querySelector('.ast-ag')!.textContent).toBe('1');
      expect(ranged!.textContent).toContain('composite shortbow +9');
    } finally { stop(); }
  });

  it('a glyph that carries NO cost still stops breaking the row it sits in (apparition/shepherd-of-errant-winds)', () => {
    // 8 of the reunited sentences are split around an `actions` node with no cost string — it draws
    // nothing at all, so the row read as three lines with an invisible gap between them.
    const top = SHEPHERD.c ?? [];
    expect(top.slice(6, 11).map((n) => n.t)).toEqual(['p', 'actions', 'p', 'actions', 'p']);
    expect(top[7].string, 'the glyph really is costless').toBeFalsy();

    const { host, stop } = renderDom(<AstRenderer node={SHEPHERD} bodyOnly onOpenRef={() => undefined} />);
    try {
      const body = bodyOf(host);
      const rows = [...body.children].filter((e) => (e.textContent ?? '').includes('air blast'));
      expect(rows, 'the three pieces are one row').toHaveLength(1);
      expect(rows[0].textContent).toContain('Melee');
      expect(rows[0].textContent).toContain('thunderclap');
      expect(body.querySelectorAll('.ast-actline')).toHaveLength(0);
    } finally { stop(); }
  });

  it('a Source line still does NOT swallow the prose under it (trait/asura) — flavour is never dimmed', () => {
    const { host, stop } = renderDom(<AstRenderer node={ASURA} bodyOnly onOpenRef={() => undefined} />);
    try {
      const body = bodyOf(host);
      const src = body.querySelector('.ast-meta.src')!;
      expect(src.textContent!.trim()).toBe('Source Monster Core 2 pg. 364');
      expect(src.textContent, 'the flavour paragraph stays out of the source line').not.toContain('These fiends are');
      expect(body.textContent).toContain('These fiends are physical manifestations');
    } finally { stop(); }
  });
});
