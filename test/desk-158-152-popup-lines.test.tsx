// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { ContentContext } from '../src/sheet/ContentContext';
import { DescBody } from '../src/sheet/DescBody';
import type { ContentDatabase } from '../src/rules/types';
import { renderDom } from './_render';

/**
 * THE TWO LINES THE POPUP SAYS ITSELF — both ruled by the owner on 2026-09-12.
 *
 * #158  "keep both, mark the old one legacy, add a 'remastered as …' link". The DATA half (the
 *       `remasteredAs` field, stamped by the chain) is guarded by scripts/reprint-check.mjs against
 *       the real 181 records; this is the half no script can see — that the line reaches the screen,
 *       and that clicking it opens the reprint's own description rather than going nowhere.
 * #152  "the popup prints 'The book prints no rules text for this item' whenever a description is
 *       empty … all 244 empty-description items at once, by rule". Measured against the shipped
 *       artefact: 243 items carry no description, 89 of those still render an archive page, so 154
 *       popups reach this line.
 *
 * NO astKey/astId is passed. `useAstNode` starts in `loading` for any record whose bucket is known
 * and whose tree is not cached, and jsdom cannot fetch public/ast — so a test that passed them would
 * measure the loading placeholder for ever. No astId IS the "record has no page tree" case, which is
 * exactly what both rulings are about.
 */

/** The smallest content database the popup needs: one record for the link to resolve to. */
const db = {
  spells: {
    'caustic-blast': { id: 'caustic-blast', name: 'Caustic Blast', description: 'You fling acid.' },
  },
  items: {},
} as unknown as ContentDatabase;

const remasteredAs = { bucket: 'spells', id: 'caustic-blast', name: 'Caustic Blast' };

const render = (el: React.ReactElement) => renderDom(<ContentContext.Provider value={db}>{el}</ContentContext.Provider>);

describe('desk 158/160/161/152: the popup lines the app owns', () => {
  // desk 158: spells/acid-splash
  it('158 — a record with remasteredAs prints "Remastered as <name>" and opens the reprint', () => {
    const { host, click, stop } = render(
      <DescBody description="You splash a glob of acid." remasteredAs={remasteredAs} />,
    );
    try {
      const line = host.querySelector('.sd-remastered');
      expect(line, 'the marked line is rendered').toBeTruthy();
      expect(line!.textContent).toBe('Remastered as Caustic Blast');
      // …and it is marked as OURS, not as printed text (the owner's words for #152, same rule here).
      expect(line!.classList.contains('sd-ours')).toBe(true);
      // the printed text is still there — this is a line ADDED to the description, not a replacement
      expect(host.textContent).toContain('You splash a glob of acid.');

      const link = host.querySelector('.sd-remastered .ref-link');
      expect(link, 'the name is the app\'s own .ref-link, so it looks and behaves like every other one').toBeTruthy();
      click(link);
      /* The recursive popup is now open ON THE REPRINT. Its TITLE is what this asserts, not its
       * prose: DescriptionModal resolves an archive page for the node it shows, and jsdom cannot
       * fetch public/ast — so the body sits in its loading placeholder here while the real app
       * renders the page. The title proves the click resolved the right record, which is the thing
       * that can break. */
      const opened = host.querySelector('.ast-modal, .desc-modal, [role="dialog"]') ?? host.lastElementChild;
      expect(opened?.textContent, 'the popup that opened is the reprint\'s').toContain('Caustic Blast');
      expect(host.querySelectorAll('.sd-remastered')).toHaveLength(1);
    } finally { stop(); }
  });

  // desk 158: a record with no link says nothing extra
  it('158 — a record with no remasteredAs renders no such line (legacy content that was never reprinted)', () => {
    const { host, stop } = render(<DescBody description="You splash a glob of acid." />);
    try {
      expect(host.querySelector('.sd-remastered')).toBeNull();
      expect(host.textContent).not.toContain('Remastered as');
    } finally { stop(); }
  });

  // desk 158: the line survives the branch an empty description takes
  it('158 — the link still shows when the record has no text at all', () => {
    const { host, stop } = render(<DescBody description="" remasteredAs={remasteredAs} />);
    try {
      expect(host.querySelector('.sd-remastered')?.textContent).toBe('Remastered as Caustic Blast');
    } finally { stop(); }
  });

  // desk 152: items/agate and the 153 like it
  it('152 — an item with no description and no page tree prints the marked "no rules text" line', () => {
    const { host, stop } = render(
      <DescBody description="" emptyNote="The book prints no rules text for this item." />,
    );
    try {
      const line = host.querySelector('.sd-unprinted');
      expect(line, 'the marker is rendered').toBeTruthy();
      expect(line!.textContent).toBe('The book prints no rules text for this item.');
      expect(line!.classList.contains('sd-ours'), 'marked as ours, not as printed text').toBe(true);
    } finally { stop(); }
  });

  // desk 152: the other direction — text present, no marker
  it('152 — an item WITH rules text prints no marker', () => {
    const { host, stop } = render(
      <DescBody description="A fine agate, worth 8 gp." emptyNote="The book prints no rules text for this item." />,
    );
    try {
      expect(host.querySelector('.sd-unprinted')).toBeNull();
      expect(host.textContent).not.toContain('The book prints no rules text');
      expect(host.textContent).toContain('A fine agate, worth 8 gp.');
    } finally { stop(); }
  });

  // desk 152: the note is OPT-IN, or every empty note and empty spell rider would claim to be a book entry
  it('152 — a caller that passes no emptyNote still renders nothing for an empty description', () => {
    const { host, stop } = render(<DescBody description="" />);
    try {
      expect(host.textContent).toBe('');
    } finally { stop(); }
  });
});
