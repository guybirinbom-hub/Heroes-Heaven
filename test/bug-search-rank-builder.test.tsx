// @vitest-environment jsdom
// bug 2026-09-13: search-rank (builder pickers)
import { createElement, act } from 'react';
import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { Builder } from '../src/builder/Builder';
import { sourceCatalog } from '../src/rules/sources';
import { emptyBuild, type BuildState } from '../src/rules/build';

/**
 * bug 2026-09-13: search-rank (builder pickers)
 *
 * The search-rank lane wired one ranking rule (src/data/searchRank.ts) into fifteen search boxes and
 * could not touch src/builder/shared.tsx, which another lane owned at the time. That left the THREE
 * boxes a character-builder player meets first still filtering without ordering:
 *
 *   SearchSelect  — ancestry / heritage / background / class / deity / spell / open-choice picker.
 *                   It also caps its list at 100 rows, so an unranked match can be cut off entirely.
 *   PopupSelect   — every in-builder popup with a search box (languages, skills, schools, …).
 *   SourcesCard   — Setup → Sources, over book titles and the player's own homebrew source names.
 *
 * Each case below drives the REAL Builder and asserts an order that only the ranking call produces —
 * remove it and the incoming order (the content file's own, or alphabetical) puts the typed record
 * second. Measured before the fix:
 *
 *   Ancestry "sar"      : Samsaran, Sarangay                                  → Sarangay first (prefix)
 *   Add a language "osiriani": Ancient Osiriani, Osiriani                     → Osiriani first (exact)
 *   Sources "tian"      : Lost Omens Tian Xia Character Guide, Lost Omens Tian Xia World Guide,
 *                         Tian Xia Character Guide                            → Tian Xia CG first (prefix)
 *   Sources homebrew "tomes": Ancient Tomes, Tomes                            → Tomes first (exact)
 *
 * ("elf", the query the report named, is not a case: this content has exactly ONE ancestry matching
 * it — Elf — and every Half-Elf-shaped name is a HERITAGE. A one-row list cannot show an ordering.)
 */

const c = () => content();
const noop = () => undefined;
/** Every book, so the ancestry picker offers the whole list rather than the Core default. */
const ALL_BOOKS = sourceCatalog(content()).allBooks;

/** Type into a React-controlled input the way a player does (native setter + input event). */
function type(input: HTMLInputElement | null, text: string) {
  if (!input) throw new Error('search input not found');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const flush = () => act(async () => void (await new Promise((res) => setTimeout(res, 0))));

function open(initial: BuildState) {
  return renderDom(createElement(Builder, { content: c(), initial, onCancel: noop, onCreate: noop }));
}

/** Click a level-strip chip by its label ("Setup", "0", "1", …) — the player's own route. */
function goPage(r: ReturnType<typeof open>, label: string) {
  const chip = [...r.host.querySelectorAll('.lstrip button')].find((b) => (b.textContent ?? '').trim() === label);
  expect(chip, `no "${label}" page chip`).toBeTruthy();
  r.click(chip!);
}

/** Open the picker of the control the harness marks with `title`, type `q`, return the row names. */
async function pickerRows(r: ReturnType<typeof open>, title: string, q: string) {
  const ctl = document.querySelector(`[data-ctl-title="${title}"]`);
  expect(ctl, `no "${title}" control on the page`).toBeTruthy();
  // A filled SearchSelect reads first: its pencil "Replace" button re-opens the list. Everything else
  // IS the button. Same two shapes the change-ancestry test drives.
  r.click(ctl!.querySelector('.ss-replace') ?? ctl!);
  await flush();
  type(document.querySelector<HTMLInputElement>('.picker-overlay .name-input'), q);
  return [...document.querySelectorAll('.picker-overlay .picker-name')].map((n) => (n.textContent ?? '').trim());
}

/** The book names of the Sources category whose heading contains `heading`. */
const srcBooks = (r: ReturnType<typeof open>, heading: string) =>
  [...r.host.querySelectorAll('.src-cat')]
    .filter((cat) => (cat.querySelector('.src-cat-name')?.textContent ?? '').includes(heading))
    .flatMap((cat) => [...cat.querySelectorAll('.src-book-name')].map((n) => (n.textContent ?? '').trim()));

describe('bug 2026-09-13: search-rank (builder pickers)', () => {
  // bug 2026-09-13: search-rank (builder pickers)
  it('SearchSelect: the ancestry whose name was typed leads the list', async () => {
    const r = open({ ...emptyBuild(), name: 'P', level: 1, enabledSources: ALL_BOOKS });
    goPage(r, '0');
    const names = await pickerRows(r, 'Ancestry', 'sar');
    r.stop();

    // Both live in the same book and the content file lists Samsaran first, so the picker showed the
    // player's "sar" — Sarangay — second. Prefix beats contains, and nothing is dropped.
    expect(names).toEqual(['Sarangay', 'Samsaran']);
  });

  // bug 2026-09-13: search-rank (builder pickers)
  it('PopupSelect: the language whose label was typed leads the popup', async () => {
    // A wizard's Intelligence buys bonus languages, which is what puts the (searchable, 120-option)
    // "Add a language" popup on the level-0 page at all.
    const r = open({ ...emptyBuild(), name: 'P', level: 1, ancestryId: 'human', classId: 'wizard', keyAbility: 'int' });
    goPage(r, '0');
    const names = await pickerRows(r, 'Add a language', 'osiriani');
    r.stop();

    // The list is alphabetical, so the language actually called Osiriani sat behind Ancient Osiriani.
    expect(names).toEqual(['Osiriani', 'Ancient Osiriani']);
  });

  /*
   * adversarially confirmed 2026-09-13: these three boxes were RANKED and still FILTERED with a plain
   * substring `includes`, so the owner's own spelling — "water skin", with the space — matched nothing
   * here either. Measured over this content: "mi go" is carried by exactly one of the 120 languages,
   * Mi-Go, and the substring filter offered zero.
   */
  // bug 2026-09-13: search-rank (builder pickers)
  it('PopupSelect: a two-word query finds the language whose name only carries both words', async () => {
    const r = open({ ...emptyBuild(), name: 'P', level: 1, ancestryId: 'human', classId: 'wizard', keyAbility: 'int' });
    goPage(r, '0');
    const names = await pickerRows(r, 'Add a language', 'mi go');
    r.stop();

    expect(names).toEqual(['Mi-Go']);
  });

  // bug 2026-09-13: search-rank (builder pickers)
  it('Sources: the book whose title was typed leads its category', async () => {
    const r = open({ ...emptyBuild(), name: 'P', level: 1 });
    goPage(r, 'Setup');
    type(r.host.querySelector<HTMLInputElement>('.src-search input'), 'tian');
    const books = srcBooks(r, 'Lost Omens');
    r.stop();

    // Alphabetically the two "Lost Omens Tian Xia …" titles came first and the book actually titled
    // Tian Xia Character Guide was last of the three. It is the one the player typed.
    expect(books[0]).toBe('Tian Xia Character Guide');
    expect(books).toHaveLength(3);
    expect(books).toContain('Lost Omens Tian Xia World Guide');
  });

  // bug 2026-09-13: search-rank (builder pickers)
  it("Sources: the player's own homebrew source ranks the same way", async () => {
    // The homebrew list is read straight from storage and sorted by name, so two sources are enough
    // to show the ordering — with the exact match sorted LAST by the alphabet.
    localStorage.setItem(
      'wanderers-codex:homebrew-sources:v1',
      JSON.stringify({ a: { id: 'a', name: 'Ancient Tomes' }, t: { id: 't', name: 'Tomes' } }),
    );
    const r = open({ ...emptyBuild(), name: 'P', level: 1 });
    goPage(r, 'Setup');
    type(r.host.querySelector<HTMLInputElement>('.src-search input'), 'tomes');
    const books = srcBooks(r, 'Homebrew');
    r.stop();
    localStorage.removeItem('wanderers-codex:homebrew-sources:v1');

    expect(books).toEqual(['Tomes', 'Ancient Tomes']);
  });
});
