// @vitest-environment jsdom
/*
 * Owner, 2026-09-02: "i cant add a deity to home brew its a problem".
 *
 * The schema tests in homebrew.test.ts prove a homebrew deity BUILDS correctly; this proves the
 * player can actually reach the thing — the Homebrew page's per-type sections are generated from
 * HOMEBREW_SCHEMAS, so a schema that exists but isn't registered would pass every unit test and
 * still leave the owner with no way to add a deity.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { HomebrewPage } from '../src/sheet/HomebrewPage';
import { saveHomebrewSource } from '../src/data/storage';
import { renderDom } from './_render';
import type { ContentDatabase } from '../src/rules/types';

describe('the Homebrew page offers Deity as an authorable type', () => {
  beforeEach(() => localStorage.clear());

  it('lists a Deities section with its own Add button', () => {
    saveHomebrewSource({ id: 's1', name: 'My Pantheon' });
    const { host, stop } = renderDom(
      <HomebrewPage content={{} as ContentDatabase} onChanged={() => undefined} onClose={() => undefined} />,
    );
    const heads = [...host.querySelectorAll('.hb-type-head span')].map((h) => (h.textContent ?? '').trim());
    expect(heads).toContain('Deities');
    const deitySection = [...host.querySelectorAll('.hb-type')].find((s) =>
      (s.querySelector('.hb-type-head')?.textContent ?? '').includes('Deities'),
    );
    expect(deitySection?.querySelector('button.chip')?.textContent).toContain('Add');
    stop();
  });
});
