// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { ContentContext } from '../src/sheet/ContentContext';
import { Builder } from '../src/builder/Builder';
import { emptyBuild } from '../src/rules/build';
import type { ContentDatabase } from '../src/rules/types';

/**
 * Guy, 2026-11-08: "when creatung new chracater it needs to open on setup not lv 1".
 *
 * Creating a character mounts <Builder> with no `initial` (App.tsx, the only create path); it used to
 * open on page 0 (the ancestry/background/class page). It must open on the Setup page, the same as
 * editing does. Fixtures are synthesized through emptyBuild(); none is the owner's.
 *
 * Mutation proof: Builder.tsx `useState<Sel>('setup')` → `useState<Sel>(initial ? 'setup' : 0)` (the old
 * line) turns the "new character" case red.
 */

const db: ContentDatabase = content();
const noop = () => undefined;
let stop: (() => void) | null = null;
afterEach(() => {
  stop?.();
  stop = null;
});

function openChip(host: HTMLElement): string {
  const on = host.querySelectorAll('.lstrip .lchip.on');
  expect(on.length, 'exactly one selected page chip').toBe(1);
  return (on[0].textContent ?? '').trim();
}
const sectionTitles = (host: HTMLElement) =>
  [...host.querySelectorAll('.bmain .bsec-title')].map((e) => (e.textContent ?? '').trim());

describe('the builder opens on the Setup page', () => {
  it('a NEW character (no initial build) opens on Setup, not page 0', () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const r = renderDom(
      <ContentContext.Provider value={db}>
        <Builder content={db} onCancel={noop} onCreate={noop} />
      </ContentContext.Provider>,
    );
    stop = r.stop;
    expect(openChip(r.host)).toBe('Setup');
    expect(sectionTitles(r.host)).toContain('Setup');
    // The other pages are still there to click: 0 (ancestry/background/class) and 1.
    const chips = [...r.host.querySelectorAll('.lstrip .lchip')].map((e) => (e.textContent ?? '').trim());
    expect(chips.slice(0, 3)).toEqual(['Setup', '0', '1']);
    r.click([...r.host.querySelectorAll('.lstrip .lchip')].find((e) => e.textContent?.trim() === '0') ?? null);
    expect(openChip(r.host)).toBe('0');
  });

  it('editing an existing character still opens on Setup', () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const r = renderDom(
      <ContentContext.Provider value={db}>
        <Builder content={db} initial={emptyBuild()} onCancel={noop} onCreate={noop} />
      </ContentContext.Provider>,
    );
    stop = r.stop;
    expect(openChip(r.host)).toBe('Setup');
  });
});
