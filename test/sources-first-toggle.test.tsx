// @vitest-environment jsdom
import { createElement, act } from 'react';
import { expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { Builder } from '../src/builder/Builder';
import { sourceCatalog } from '../src/rules/sources';
import { emptyBuild } from '../src/rules/build';

/*
 * Seen in the browser, 2026-09-25: on a character with no Sources choice stored (every new character is
 * "Core only"), the FIRST toggle switched on a second book the player never touched — Monster Core 2 brought
 * Bestiary 3 with it and the counter went 4 → 6. The list was written without the split mark, so the next
 * read ran the split over it (src/rules/sources.ts storedSources). Driven through the real Setup card.
 */
it('the first Sources toggle from "Core only" switches on that one book', () => {
  const db = content();
  const total = sourceCatalog(db).allBooks.length;
  const r = renderDom(createElement(Builder, { content: db, initial: { ...emptyBuild(), name: 'P', level: 1 }, onCancel: () => undefined, onCreate: () => undefined }));
  const chip = [...r.host.querySelectorAll('.lstrip button')].find((b) => (b.textContent ?? '').trim() === 'Setup');
  r.click(chip!);
  const count = () => r.host.querySelector('[data-setupcard="Sources"] .ol-count')?.textContent?.trim();
  const search = (q: string) => {
    const input = r.host.querySelector<HTMLInputElement>('.src-search input')!;
    act(() => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(input, q);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const row = (label: string) =>
    [...r.host.querySelectorAll('.src-book')].find((b) => b.querySelector('.src-book-name')?.textContent?.trim() === label);

  expect(count()).toBe(`4/${total}`);
  search('Monster Core 2');
  r.click(row('Monster Core 2')!);
  expect(count()).toBe(`5/${total}`);
  search('Bestiary 3');
  const b3 = row('Bestiary 3');
  r.stop();
  expect(b3, 'no Bestiary 3 row').toBeTruthy();
  expect(b3!.classList.contains('on')).toBe(false);
});
