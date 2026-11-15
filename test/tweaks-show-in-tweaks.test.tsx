// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { buttonIn, hero, press } from './_tweaks-harness';
import { Builder } from '../src/builder/Builder';
import type { BuildState } from '../src/rules/build';
import type { BuildOverrides } from '../src/rules/types';

/**
 * "SHOW IN TWEAKS" ON THE ATTRIBUTE CARD (plan B, B17; WP8). The Free boosts card (the "0" page, Attributes
 * group — the page the Builder calls setup, `sel === 0`) says when a score is set
 * by a tweak. It used to offer "Clear override(s)", which deleted every attribute set at once, past the Tweaks
 * page; now it offers "Show in Tweaks" (shared.tsx `AttributeEditor onOpenTweaks`), which opens the Tweaks page
 * on that set's row (Builder `openTweaksAt` → TweaksPage `focusKey`). Only while Tweaks is on: with it off the
 * Builder passes no `onOpenTweaks`, so the card still says the score is set (an imported set stays on) but
 * offers no way to a page that is not there.
 *
 * Leftovers run 2026-10-22. MUTATION PROOF (leftovers-tests-report.md): `onOpenTweaks` passed with Tweaks off
 * turns the second test red; the button opening `attribute:<ab>` instead of `attributes:<ab>` turns the first
 * red. Synthetic characters only.
 */

const db = content();
const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  for (const n of [...document.body.children]) n.remove();
});

function openBuilder(b: BuildState) {
  const r = renderDom(createElement(Builder, { content: db, initial: b, onCancel: () => undefined, onCreate: () => undefined }));
  cleanups.push(r.stop);
  return r;
}
const chip = (host: HTMLElement, label: string) => [...host.querySelectorAll('.lstrip button')].find((b) => (b.textContent ?? '').trim() === label);
const warn = (host: HTMLElement) => host.querySelector('.attr-override-warn');
const squash = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

describe('"Show in Tweaks" on the attribute card (B17)', () => {
  it("opens the Tweaks page on the set's row, and Done comes back to the attribute page", async () => {
    const r = openBuilder(hero(db, 'fighter', 5, { v: 2, attributes: { dex: 16 } } as BuildOverrides));
    await press(chip(r.host, '0'));
    expect(squash(warn(r.host)?.textContent)).toMatch(/^Dex is set by a tweak/);
    const show = buttonIn(warn(r.host), 'Show in Tweaks');
    expect(show, 'the card offers "Show in Tweaks"').toBeTruthy();
    expect(buttonIn(warn(r.host), 'Clear override'), 'no delete-everything button').toBeUndefined();
    await press(show);
    expect(r.host.querySelector('.tw-page'), 'the Tweaks page is open').not.toBeNull();
    const row = r.host.querySelector('li.tw-row[data-key="attributes:dex"]');
    expect(row, 'the Dexterity set is listed').not.toBeNull();
    expect(row!.classList.contains('open'), 'its row is the open one').toBe(true);
    expect(r.host.querySelectorAll('li.tw-row.open')).toHaveLength(1);
    await press(r.host.querySelector('.tw-page button.tw-done'));
    expect(r.host.querySelector('.tw-page')).toBeNull();
    expect(r.host.querySelector('.lstrip .lchip.on')?.textContent?.trim(), 'back to the page before').toBe('0');
    expect(buttonIn(warn(r.host), 'Show in Tweaks'), 'the card is drawn again').toBeTruthy();
  });

  it('with Tweaks off the card still says the score is set, with no button', async () => {
    // Off, so only an IMPORTED set stays on (blocks/stored.ts `entryOn`): the card has something to say.
    const r = openBuilder(
      hero(db, 'fighter', 5, { v: 2, attributes: { dex: 16 }, meta: { 'attributes:dex': { source: 'import' } } } as BuildOverrides, {
        options: { overridesEnabled: false },
      } as Partial<BuildState>),
    );
    expect(r.host.querySelector('.builder-head button.b-tweaks'), 'Tweaks off: no Tweaks button').toBeNull();
    await press(chip(r.host, '0'));
    expect(squash(warn(r.host)?.textContent), 'the imported set still pins Dexterity').toMatch(/^Dex is set by a tweak/);
    expect(buttonIn(warn(r.host), 'Show in Tweaks'), 'no way to a page that is not there').toBeUndefined();
  });
});
