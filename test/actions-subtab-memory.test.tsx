// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { build, content } from './_content';
import { renderDom } from './_render';
import { MainTab } from '../src/sheet/MainTab';

/** Owner (2026-09-02): "right now the strikes tab is the default one, change it to be on the last one
 *  the user was on (the strikes / actions); if the user hadn't pressed them yet let it be on strikes." */
const noop = () => undefined;
const selectedTab = (host: HTMLElement) =>
  [...host.querySelectorAll<HTMLElement>('button.stab')].find((b) => b.getAttribute('aria-selected') === 'true')?.textContent?.trim() ?? '';
const tabNamed = (host: HTMLElement, re: RegExp) => [...host.querySelectorAll<HTMLElement>('button.stab')].find((b) => re.test(b.textContent ?? '')) ?? null;

describe('the Strikes / Actions sub-tab reopens where it was left', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to Strikes, remembers Actions across a remount, and stays on Strikes when never pressed', () => {
    const db = content();
    const ch = build('fighter', 3);
    const r1 = renderDom(<MainTab character={ch} content={db} onPlay={noop} />);
    expect(selectedTab(r1.host)).toMatch(/Strikes/);
    const actions = tabNamed(r1.host, /^Actions/);
    expect(actions, 'an Actions sub-tab').toBeTruthy();
    r1.click(actions);
    expect(selectedTab(r1.host)).toMatch(/^Actions/);
    r1.stop();

    // Reopening the sheet (a fresh mount) lands on Actions.
    const r2 = renderDom(<MainTab character={ch} content={db} onPlay={noop} />);
    expect(selectedTab(r2.host)).toMatch(/^Actions/);
    r2.stop();

    // A device that never pressed a sub-tab starts on Strikes.
    localStorage.clear();
    const r3 = renderDom(<MainTab character={ch} content={db} onPlay={noop} />);
    expect(selectedTab(r3.host)).toMatch(/Strikes/);
    r3.stop();
  });
});
