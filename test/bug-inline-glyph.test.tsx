// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { renderToStaticMarkup } from 'react-dom/server';
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
 * 5,885 (the modal path, 5,745). That a glyph ending its run "is an ability heading's cost and must keep
 * its line" did not survive the mirror (2026-10-08): the page prints every such glyph inside its header's
 * line, so actions/call-gun's "Call Gun ⟨1⟩ (magical) Effect …" is now asserted as ONE line below.
 *
 * Card step 22 removed the hideMeta path (the pre-card held-record popup body): the detail popups are
 * each record's 'mine' card, so the cases that drew through hideMeta draw through the card walk now
 * (`card`, an empty printed set), and the two hideMeta-only cases left with it.
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

  // batch card premise: action-100 "You call forth the effect of an item by properly activating it" — card step 22: drawn as the mine card (the hideMeta path is gone).
  it('the glyph is an inline span inside the SAME paragraph as the text around it', () => {
    const { host, stop } = renderDom(<AstRenderer node={ACTIVATE} bodyOnly card={{ printed: new Set<string>() }} onOpenRef={() => undefined} />);
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

  // batch card premise: action-100 "You call forth the effect of an item by properly activating it" — card step 22: drawn as the mine card.
  it('the second split sentence on the page folds the same way, and no glyph line is left behind', () => {
    const { host, stop } = renderDom(<AstRenderer node={ACTIVATE} bodyOnly card={{ printed: new Set<string>() }} onOpenRef={() => undefined} />);
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

  // Card step "wording" round 2 (2026-10-08): the page prints an embedded activity's glyph INSIDE its header
  // line — the mirror's markdown for feat-3269 is one line, "**Call Gun** <actions string="Single Action" />
  // ([magical]…) **Effect** You hold aloft…" — so the heading, the glyph and the line after it are ONE line
  // (cardModel.ts lineFrags). The old premise ("a glyph that ends its run keeps its block line") was never
  // checked against print; all 792 such glyphs sit inside a line of their page.
  // batch card premise: feat-3269 "Effect You hold aloft a free hand" — card step 22: drawn as the mine card.
  it('an ability heading\'s glyph sits INSIDE its header line, as the page prints it — actions/call-gun', () => {
    const { host, stop } = renderDom(<AstRenderer node={CALL_GUN} bodyOnly card={{ printed: new Set<string>() }} onOpenRef={() => undefined} />);
    try {
      const body = bodyOf(host);
      // batch card premise: feat-3269 "Effect You hold aloft a free hand"
      expect(body.querySelector('.ast-actline'), 'no glyph line of its own').toBeNull();
      const glyph = body.querySelector('.ast-ag[title="Single Action"]') as HTMLElement;
      expect(glyph.textContent).toBe('1');
      const line = glyph.parentElement!;
      expect(line.tagName).toBe('P');
      expect(line.textContent!.replace(/\s+/g, ' ').trim()).toMatch(/^Call Gun 1 \(magical\) Effect You hold aloft a free hand/);
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

  /*
   * A GLYPH THAT CARRIES NO COST draws nothing at all, so a row split around one read as three lines
   * with an invisible gap between them.
   *
   * ⚠ THE FIXTURE IS FOUND, NOT NAMED. apparition/shepherd-of-errant-winds used to be the costless
   * case, and the 2026-09-23 Archives refresh gave both of its Strike rows a Single Action glyph —
   * correct for a Strike, and it made this guard's premise false overnight while the property it
   * guards was untouched. 1,571 costless mid-sentence glyphs remain in the shipped trees, so the
   * guard asks the corpus for one instead of depending on any single page staying still.
   */
  it('a glyph that carries NO cost still stops breaking the row it sits in', () => {
    const splitsAtCostlessGlyph = (node: AstNode) => {
      const c = node.c ?? [];
      const acts = c.filter((n) => n.t === 'actions');
      if (!acts.length || acts.some((n) => n.string)) return false;
      return c.some((n, i) => n.t === 'actions' && i > 0 && i < c.length - 1 && c[i - 1].t === 'p' && c[i + 1].t === 'p');
    };
    const found = Object.entries(readBucket('itemBonus')).find(([, n]) => splitsAtCostlessGlyph(n));
    expect(found, 'the corpus still splits a sentence at a costless glyph').not.toBeUndefined();

    const { host, stop } = renderDom(<AstRenderer node={found![1]} bodyOnly onOpenRef={() => undefined} />);
    try {
      // Nothing is drawn for a costless glyph, so it must not open a block line of its own.
      expect(host.querySelector('.ast-body')!.querySelectorAll('.ast-actline')).toHaveLength(0);
    } finally { stop(); }
  });

  it('a stat row split at TWO glyphs rejoins as one row (apparition/shepherd-of-errant-winds)', () => {
    const top = SHEPHERD.c ?? [];
    expect(top.slice(6, 11).map((n) => n.t)).toEqual(['p', 'actions', 'p', 'actions', 'p']);

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

/*
 * Card step "wording" round 2 (2026-10-08; the orchestrator's approval 2): a block-level glyph the page
 * prints INSIDE a line flows inline exactly as the page prints it. Measured against the mirror's markdown
 * over all 20,787 shipped pages: the 792 block-level glyphs still drawn on a line of their own all sit
 * inside a line of their page, and so does the text after every one of the 2,216 bold "Activate ⟨g⟩" lines.
 * The lines live in src/sheet/cardModel.ts (lineFrags, glyphLedLine, activateLine), read by AstRenderer
 * and by the row preview alike.
 *
 * MUTATION LINES (each measured red on 2026-10-08, then cardModel.ts restored byte-exact from a scratch
 * copy, sha1 checked):
 *  - lineFrags: the glyph join off (`&& false` on its actions branch) → call-gun, gleaming-blade, patron's
 *    claim and the wand red, and the corpus case (3 pages draw a glyph line of its own again).
 *  - activateLine: `rest` always [] → the wand of hybrid form case red.
 *  - glyphLedLine: always null → the banishing-touch case red, and the corpus case (41 pages).
 */
describe('wording round 2 — a glyph the page prints inside a line stays in that line', () => {
  const CARD = { printed: new Set<string>() };
  const words = (el: Element) => {
    const c = el.cloneNode(true) as Element;
    c.querySelectorAll('.ast-ag').forEach((g) => g.remove());
    return (c.textContent ?? '').replace(/\s+/g, ' ').trim();
  };
  const glyphLine = (body: Element, title: string) => {
    const g = body.querySelector(`.ast-ag[title="${title}"]`);
    // batch card: #card-GLYPH — a glyph stays in its printed line
    expect(g, `a ${title} glyph`).not.toBeNull();
    return g!.parentElement!;
  };

  // batch card: #card-GLYPH — a glyph stays in its printed line
  it('an embedded activity header is ONE line: classFeatures:gleaming-blade\'s "Transcendence ⟨2⟩ (Spirit, Transcendence) …"', () => {
    const tree = readBucket('classFeatures')['gleaming-blade'];
    // batch card premise: ikon-6 "Make two Strikes with the gleaming blade" — card step 22: the card and the modal path (hideMeta is gone).
    for (const props of [{ card: CARD }, {}]) {
      const { host, stop } = renderDom(<AstRenderer node={tree} bodyOnly {...props} onOpenRef={() => undefined} />);
      try {
        const body = bodyOf(host);
        expect(body.querySelector('.ast-actline'), 'no glyph line of its own').toBeNull();
        const line = glyphLine(body, 'Two Actions');
        // batch card: #card-GLYPH — a glyph stays in its printed line
        expect(line.tagName).toBe('P');
        // batch card premise: ikon-6 "Make two Strikes with the gleaming blade"
        expect(words(line)).toMatch(/^Transcendence \(Spirit, Transcendence\) ?Flowing Spirit Strike; Effect Make two Strikes with the gleaming blade/);
      } finally { stop(); }
    }
  });

  it('a header whose next line opens on a use label joins it too, and keeps it: feats:patrons-claim', () => {
    const tree = readBucket('feats')['patrons-claim'];
    // The held-record path (hideMeta, removed in card step 22) used to drop the activity's "Frequency …
    // Effect …" paragraph whole as a META line; on the header's line it is the activity's own text and shows
    // — on the mine card, which every held-record popup is now.
    // batch card premise: feat-5019 "Frequency once per hour" — card step 22: drawn as the mine card.
    const { host, stop } = renderDom(<AstRenderer node={tree} bodyOnly card={CARD} onOpenRef={() => undefined} />);
    try {
      const body = bodyOf(host);
      expect(body.querySelector('.ast-actline')).toBeNull();
      // batch card premise: feat-5019 "Frequency once per hour"
      expect(words(glyphLine(body, 'Two Actions'))).toMatch(/^Patron’s Claim Frequency once per hour; Effect Your familiar’s mouth opens impossibly wide/);
    } finally { stop(); }
  });

  it('the wand of hybrid form\'s Activate sentence is ONE line, every glyph inside it (items:wand-of-hybrid-form)', () => {
    const tree = readBucket('items')['wand-of-hybrid-form'];
    // batch card premise: equipment-2280 "Frequency once per day, plus overcharge" — card step 22: the card and the modal path (hideMeta is gone).
    for (const props of [{ card: CARD }, {}]) {
      const { host, stop } = renderDom(<AstRenderer node={tree} bodyOnly {...props} onOpenRef={() => undefined} />);
      try {
        const body = bodyOf(host);
        const lines = [...body.querySelectorAll('p')].filter((p) => (p.textContent ?? '').includes('This activation takes'));
        expect(lines, 'one line holds the sentence').toHaveLength(1);
        const act = lines[0];
        // batch card: #card-GLYPH — a glyph stays in its printed line
        expect(act.className).toBe('ast-act');
        // batch card premise: equipment-2280 "Frequency once per day, plus overcharge"
        expect(words(act)).toMatch(/^Activate Cast a Spell; This activation takes if the spell normally takes to cast, or if the spell normally takes ; ?Frequency once per day, plus overcharge; Effect You Cast the Spell, selecting two forms/);
        expect([...act.querySelectorAll('.ast-ag')].map((g) => g.getAttribute('title'))).toEqual(['Two Actions', 'Single Action', 'Three Actions', 'Two Actions']);
      } finally { stop(); }
    }
  });

  // batch card: #card-GLYPH — a glyph stays in its printed line
  it('a glyph that opens its line leads it: spells:banishing-touch\'s "⟨1⟩ The target is launched 10 feet into the air …"', () => {
    const tree = readBucket('spells')['banishing-touch'];
    const { host, stop } = renderDom(<AstRenderer node={tree} bodyOnly card={CARD} onOpenRef={() => undefined} />);
    try {
      const body = bodyOf(host);
      expect(body.querySelector('.ast-actline')).toBeNull();
      const line = glyphLine(body, 'Single Action');
      // batch card: #card-GLYPH — a glyph stays in its printed line
      expect(line.tagName).toBe('P');
      expect(line.firstElementChild!.classList.contains('ast-ag'), 'the glyph opens the line').toBe(true);
      // batch card premise: spell-2152 "The target is launched 10 feet into the air"
      expect(words(line)).toMatch(/^The target is launched 10 feet into the air and knocked back 10 feet\.$/);
      expect(words(glyphLine(body, 'Three Actions'))).toMatch(/^Your touch deals 2d6 bludgeoning damage instead\. The target is launched 30 feet/);
    } finally { stop(); }
  });

  /*
   * Wording merge, refuter nit: a glyph ROW whose first paragraph is a label the surface printed lost the
   * whole row (glyph and words) once the row became one line — the three blocks before it lost only the
   * label's paragraph. FeatDetail prints "Activate", so a feat page's header row "Activate ⟨1⟩ (manipulate)"
   * would have vanished. Synthetic trees. MUTATION LINES (each measured red, then restored): the card
   * branch back to `return null` on a printed first leaf → the printed case red. (The hideMeta branch and
   * its META case left with hideMeta in card step 22.)
   */
  // batch card: #card-GLYPH — a glyph sits in the line the page prints it in; the synthetic trees copy a page's "Activate ⟨1⟩ (manipulate)" row.
  it('a glyph row whose first leaf is a printed label drops only that label (synthetic)', () => {
    const p = (...c: AstNode[]): AstNode => ({ t: 'p', c });
    const txt = (v: string): AstNode => ({ t: 'text', v });
    const bold = (v: string): AstNode => ({ t: 'b', c: [txt(v)] });
    const row = (first: AstNode): AstNode => ({ t: 'document', c: [
      { t: 'row', c: [{ t: 'row', c: [first] }, { t: 'actions', string: 'Single Action' }, { t: 'row', c: [p(txt('(manipulate) Zorblat turns the dial'))] }] },
      { t: 'hr' },
      p(txt('The body of the synthetic page.')),
    ] });
    const line = (node: AstNode, props: object) => {
      const { host, stop } = renderDom(<AstRenderer node={node} bodyOnly {...props} onOpenRef={() => undefined} />);
      try {
        const g = bodyOf(host).querySelector('.ast-ag[title="Single Action"]');
        return g ? { tag: g.parentElement!.tagName, words: words(g.parentElement!) } : null;
      } finally { stop(); }
    };
    const act = row(p(bold('Activate')));
    // batch card: #card-PRINTED-SET — a label the stat block printed is not drawn twice
    expect(line(act, { card: CARD })).toEqual({ tag: 'P', words: 'Activate (manipulate) Zorblat turns the dial' });
    expect(line(act, { card: { printed: new Set(['Activate']) } })).toEqual({ tag: 'P', words: '(manipulate) Zorblat turns the dial' });
    const req = row(p(bold('Requirements'), txt(' You hold the synthetic dial')));
    expect(line(req, {})?.words).toBe('Requirements You hold the synthetic dial (manipulate) Zorblat turns the dial');
  });

  // batch card: #card-GLYPH — a glyph stays in its printed line
  it('across every shipped page, no card draws a glyph on a line of its own', () => {
    let pages = 0;
    const alone: string[] = [];
    for (const f of readdirSync('public/ast').filter((x) => x.endsWith('.json.gz'))) {
      const b = f.replace('.json.gz', '');
      for (const [slug, tree] of Object.entries(readBucket(b))) {
        pages++;
        const html = renderToStaticMarkup(<AstRenderer node={tree} bodyOnly card={CARD} onOpenRef={() => undefined} />);
        if (html.includes('class="ast-actline"')) alone.push(`${b}:${slug}`);
      }
    }
    // batch card: #card-GLYPH — a glyph stays in its printed line
    expect(pages, 'the corpus was read').toBeGreaterThan(20000);
    expect(alone.slice(0, 20), `${alone.length} pages still draw a glyph line of its own`).toEqual([]);
  }, 300_000);
});
