// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { renderDom } from './_render';
import { AstRenderer } from '../src/sheet/AstRenderer';
import { DescBody } from '../src/sheet/DescBody';
import { ContentContext } from '../src/sheet/ContentContext';
import { loadBucketAst, type AstNode } from '../src/sheet/astStore';
import type { ContentDatabase } from '../src/rules/types';

/**
 * bug 2026-09-12 #8: popup-divider.
 *
 * Owner, on the "Activate an Item" popup: *"i dont like this line above the text, it is useful when
 * there is another text above it but when there isnt there isnt a point for the line and such a big
 * gap between the text and the top of the pop up."*
 *
 * An archive page is shaped <stat header> <hr> <prose>, and a detail popup passes `hideMeta` because
 * it prints that header itself — so the page's separator became the FIRST thing in the popup body: a
 * rule under the title bar with .7em of its own margin above and below and nothing to separate.
 * Measured on the shipped artefact: 18,667 of 24,964 pages open that way in the hideMeta path, and 0
 * in the modal path (where the Source/stat lines do render above it).
 *
 * Both directions are asserted here, and items/necklace-of-fireballs-iii asserts them on ONE page: it
 * ships eight rules, the first with nothing above it and seven under the variant headings that follow.
 *
 * The residual: an EMPTY container still counted as something above. A `column` holding only a Source
 * line without "pg. N" survives isMetaishBlock but renders nothing under hideMeta, and the empty
 * fragment it returned was an entry in the run — so 32 pages still opened on a rule. Blocks now returns
 * null when it rendered nothing; items/conundrum-spectacles is one of the 32 and is asserted below.
 *
 * Reads the TRACKED public/ast/*.json.gz (the gitignored raw .json beside them is local regen output),
 * so it measures what actually ships — the same source ast-provenance-render.test.tsx reads.
 */
const readBucket = (b: string) =>
  JSON.parse(gunzipSync(readFileSync(`public/ast/${b}.json.gz`)).toString('utf8')) as Record<string, AstNode>;

const actions = readBucket('actions');
const ACTIVATE = actions['activate-an-item'];
const items = readBucket('items');
const NECKLACE = items['necklace-of-fireballs-iii'];
const SPECTACLES = items['conundrum-spectacles'];

const bodyOf = (host: HTMLElement) => {
  const b = host.querySelector('.ast-body');
  if (!b) throw new Error('no .ast-body rendered');
  return b as HTMLElement;
};
const rules = (el: Element) => [...el.querySelectorAll('hr.ast-hr')];

describe('bug #8 — a divider only where something precedes the body', () => {
  it('the page tree really does open with a rule (otherwise this guard measures nothing)', () => {
    // The defect is in the RENDERER, not the data: the ast still carries the page's own separator, and
    // it still sits directly after the stat header the popup hides. Pin that, or a data change could
    // make every assertion below pass for the wrong reason.
    expect(ACTIVATE.c?.map((n) => n.t).slice(0, 5)).toEqual(['title', 'traits', 'column', 'hr', 'p']);
    expect(NECKLACE.c?.filter((n) => n.t === 'hr')).toHaveLength(8);
  });

  it('"Activate an Item" — nothing above, so no rule and no gap (the owner\'s screenshot)', () => {
    const { host, stop } = renderDom(<AstRenderer node={ACTIVATE} bodyOnly hideMeta onOpenRef={() => undefined} />);
    try {
      const body = bodyOf(host);
      expect(rules(body), 'the popup opens straight into its text').toHaveLength(0);
      // …and it is the TEXT that is now first, not an empty node standing in for the rule.
      expect(body.firstElementChild?.tagName).toBe('P');
      expect(body.firstElementChild?.textContent).toContain('You call forth the effect of an item');
      // the rest of the page is untouched — this drops a separator, never content.
      expect(body.textContent).toContain('Activation Components');
      expect(body.textContent).toContain('This component is a specific utterance');
    } finally { stop(); }
  });

  it('the same record in the MODAL popup keeps its rule — Source and Requirements print above it', () => {
    const { host, stop } = renderDom(<AstRenderer node={ACTIVATE} onOpenRef={() => undefined} />);
    try {
      const body = bodyOf(host);
      const hr = rules(body);
      expect(hr, 'the separator still separates here').toHaveLength(1);
      const above = hr[0].previousElementSibling;
      expect(above, 'something precedes it').not.toBeNull();
      expect(above!.className).toContain('ast-meta');
      expect(above!.textContent).toContain('Requirements');
      expect(body.firstElementChild!.textContent).toContain('Source');
    } finally { stop(); }
  });

  it('necklace-of-fireballs-iii — the leading rule goes, the seven under the variant headings stay', () => {
    const { host, stop } = renderDom(<AstRenderer node={NECKLACE} bodyOnly hideMeta onOpenRef={() => undefined} />);
    try {
      const body = bodyOf(host);
      const hr = rules(body);
      expect(hr, 'one of the eight had nothing above it').toHaveLength(7);
      // every survivor divides something — and specifically its variant's heading.
      for (const r of hr) {
        expect(r.previousElementSibling, 'a rule with nothing above it survived').not.toBeNull();
        expect(r.previousElementSibling!.className).toContain('ast-h2');
      }
      expect(body.firstElementChild?.tagName).toBe('P');
      expect(body.textContent).toContain('This string of beads');
      expect(body.textContent).toContain('One 10d6, two 8d6, two 6d6 (DC 27)');
    } finally { stop(); }
  });

  it('the same item in the MODAL popup keeps all eight — its stat line prints above the first', () => {
    const { host, stop } = renderDom(<AstRenderer node={NECKLACE} onOpenRef={() => undefined} />);
    try {
      const body = bodyOf(host);
      expect(rules(body)).toHaveLength(8);
      expect(rules(body)[0].previousElementSibling!.textContent).toContain('Usage');
    } finally { stop(); }
  });
});

/* ---- the real popup path: DescBody, which is what ItemDetail / the action-detail popup render ---- */

/** The db the popup needs: the record's own entry, so its self-link resolves. */
const db = {
  items: {
    'necklace-of-fireballs-iii': { id: 'necklace-of-fireballs-iii', name: 'Necklace of Fireballs III' },
    'conundrum-spectacles': { id: 'conundrum-spectacles', name: 'Conundrum Spectacles' },
  },
  actions: {},
} as unknown as ContentDatabase;

describe('bug #8 — through DescBody, the component the popups actually mount', () => {
  beforeAll(async () => {
    /* jsdom cannot fetch public/ast, so serve the TRACKED .gz off disk: astStore asks for
     * `<bucket>.json.gz` first and falls back to `<bucket>.json`, so 404 the first and answer the
     * second. Only the records under test are served — the bytes still come from the shipped file. */
    const served: Record<string, Record<string, AstNode>> = {
      actions: { 'activate-an-item': ACTIVATE },
      items: { 'necklace-of-fireballs-iii': NECKLACE, 'conundrum-spectacles': SPECTACLES },
    };
    globalThis.fetch = (async (input: unknown) => {
      const m = /ast\/([A-Za-z0-9_-]+)\.json$/.exec(String(input));
      return m && served[m[1]]
        ? new Response(JSON.stringify(served[m[1]]), { status: 200, headers: { 'content-type': 'application/json' } })
        : new Response('', { status: 404 });
    }) as typeof fetch;
    // Prime the store so useAstNode's synchronous seed finds the tree and the popup renders in one pass.
    await loadBucketAst('actions');
    await loadBucketAst('items');
  });

  const render = (el: React.ReactElement) => renderDom(<ContentContext.Provider value={db}>{el}</ContentContext.Provider>);

  it('the action-detail popup body opens on its first sentence, not on a rule', () => {
    const { host, stop } = render(<DescBody description="" astKey="actions" astId="activate-an-item" className="action-detail-desc" />);
    try {
      const body = bodyOf(host);
      expect(body.className, 'the popup is rendering the page tree, not the fallback').toContain('ast-embed');
      expect(rules(body)).toHaveLength(0);
      expect(body.firstElementChild?.textContent).toContain('You call forth the effect of an item');
    } finally { stop(); }
  });

  it('items/conundrum-spectacles — an EMPTY container above the rule is not "something above"', () => {
    /* The residual of this fix. The page's header `column` survives isMetaishBlock (a Source line with
     * no "pg. N" and one Usage row is only one stat field), but every child of it is a meta line that
     * hideMeta drops — so the column renders nothing, and the empty fragment it used to return counted
     * as an entry in the run, keeping the separator that follows it. One of 32 pages that still opened
     * on a rule; pin the shape, or a data change makes this pass for the wrong reason. */
    expect(SPECTACLES.c?.map((n) => n.t).slice(0, 5)).toEqual(['title', 'traits', 'column', 'hr', 'p']);

    const { host, stop } = render(<DescBody description="" astKey="items" astId="conundrum-spectacles" />);
    try {
      const body = bodyOf(host);
      expect(body.className, 'the popup is rendering the page tree, not the fallback').toContain('ast-embed');
      expect(body.firstElementChild?.tagName, 'no rule, and no empty node standing in for one').toBe('P');
      expect(body.firstElementChild?.textContent).toContain('These wire spectacles');
      // whatever else the page holds, nothing opens on a divider — and the prose is untouched.
      for (const r of rules(body)) expect(r.previousElementSibling, 'a rule with nothing above it survived').not.toBeNull();
      expect(body.textContent).toContain('Decipher Writing');
    } finally { stop(); }
  });

  it('desk #158\'s "Remastered as" line is unaffected — it prints BELOW the page, never above it', () => {
    const { host, stop } = render(
      <DescBody description="" astKey="items" astId="necklace-of-fireballs-iii"
        remasteredAs={{ bucket: 'items', id: 'frozen-lava', name: 'Frozen Lava' }} />,
    );
    try {
      const line = host.querySelector('.sd-remastered');
      expect(line?.textContent).toBe('Remastered as Frozen Lava');
      // It follows the page body, so it is never the "something above" that would justify the rule.
      expect(bodyOf(host).compareDocumentPosition(line!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      /* No hr count here: bug #6 (variant-list, src/sheet/useAst.ts) trims a family page down to the
       * one variant that was asked for, so how MANY rules this popup holds is that lane's business.
       * What is this lane's business is that none of them opens the popup. */
      const body = bodyOf(host);
      expect(body.firstElementChild?.tagName).not.toBe('HR');
      for (const r of rules(body)) expect(r.previousElementSibling).not.toBeNull();
    } finally { stop(); }
  });

  it('desk #152\'s "no rules text" note is unaffected — that branch never had a page tree to divide', () => {
    const { host, stop } = render(<DescBody description="" emptyNote="The book prints no rules text for this item." />);
    try {
      expect(host.querySelector('.sd-unprinted')?.textContent).toBe('The book prints no rules text for this item.');
      expect(rules(host)).toHaveLength(0);
    } finally { stop(); }
  });
});
