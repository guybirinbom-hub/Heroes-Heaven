// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useSettingsStore } from '../tracker/src/store/settingsStore';
import { PC_DETAIL_ALL, PC_DETAIL_SECTIONS } from '../tracker/src/utils/pcDetail';

/**
 * HH SETTINGS → INITIATIVE TRACKER → PLAYER CHARACTERS, as the GM meets it (owner's list 2026-10-01,
 * item 3). Two things item 3 put there, and nothing pinned either on screen (the G3 refuter,
 * 2026-10-13):
 *  - "Step players' conditions each turn" — his answer: "the tracker should do that for players but have
 *    a setting for it not to do that". The switch is there, ON by default, and turning it off is SAVED
 *    (tracker/src/store/pcConditionTicks.test.ts pins that the saved "off" survives a restart);
 *  - the "Defenses" switch described as what it hides on a campaign card — AC only, since "hp doesn't go
 *    with defense" — while the standalone tracker, where it really hides Max HP too, keeps its own words.
 * The real components, mounted bare (no campaign). Nothing here is a character.
 */

let live: Root | null = null;
let host: HTMLElement | null = null;
function render(el: ReactElement): HTMLElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  live = createRoot(host);
  act(() => live!.render(el));
  return host;
}
const click = (el: Element) => act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const STEP = "Step players' conditions each turn";
const stepSwitch = () => host!.querySelector(`[role="switch"][aria-label="${STEP}"]`);
const DEFENSES_HERE = 'AC — the HP bar always shows';
const DEFENSES_STANDALONE = PC_DETAIL_SECTIONS.find((s) => s.key === 'defenses')!.desc;

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.setState({ pcConditionTicks: true, pcDetail: PC_DETAIL_ALL });
  // The tracker's game-data loaders: nothing to load here (each degrades to an empty map).
  vi.stubGlobal('fetch', async () => ({ ok: false, status: 404, json: async () => ({}), text: async () => '' }));
});
afterEach(() => {
  if (live) act(() => live!.unmount());
  live = null;
  host?.remove();
  host = null;
  localStorage.clear();
  useSettingsStore.setState({ pcConditionTicks: true });
  vi.unstubAllGlobals();
});

describe('Player characters, in Heroes Heaven’s Settings → Initiative tracker', () => {
  it('has the “Step players’ conditions each turn” switch — ON by default — and turning it off is saved', async () => {
    /*
     * MUTATIONS (tried 2026-10-13, each alone):
     *  - delete the ToggleRow from PlayersSection (tracker/src/components/SettingsModal.tsx) → fails at
     *    "the switch is there";
     *  - make its onChange a no-op → fails at "off in the tracker's own setting" (expected true to be false).
     */
    const { TrackerSettingsSection } = await import('../src/integration/TrackerSettingsSection');
    const el = render(<TrackerSettingsSection />);
    const tab = [...el.querySelectorAll('button[role="tab"]')].find((b) => b.textContent?.includes('Player characters'));
    expect(tab, 'fixture: the Player characters tab').toBeTruthy();
    click(tab!);
    expect(stepSwitch(), 'the switch is there').not.toBeNull();
    expect(stepSwitch()!.getAttribute('aria-checked'), 'ON by default').toBe('true');

    click(stepSwitch()!);
    expect(useSettingsStore.getState().pcConditionTicks, "off in the tracker's own setting").toBe(false);
    expect(stepSwitch()!.getAttribute('aria-checked')).toBe('false');
    expect(JSON.parse(localStorage.getItem('pf2e-settings') ?? '{}').pcConditionTicks, 'saved').toBe(false);

    click(stepSwitch()!);
    expect(useSettingsStore.getState().pcConditionTicks).toBe(true);
  }, 120_000); // the first import of the Settings groups is slow beside other files in one run

  it('describes “Defenses” as what it hides on a campaign card — AC, the HP bar stays', async () => {
    /*
     * MUTATIONS (tried 2026-10-13, each alone):
     *  - drop `campaignDriven` from `<PlayersSection campaignDriven />` (src/integration/TrackerSettingsSection.tsx)
     *    → fails at "the campaign card's wording";
     *  - make PlayersSection pass `descs={undefined}` always (SettingsModal.tsx) → fails the same way.
     */
    const { TrackerSettingsSection } = await import('../src/integration/TrackerSettingsSection');
    const el = render(<TrackerSettingsSection />);
    click([...el.querySelectorAll('button[role="tab"]')].find((b) => b.textContent?.includes('Player characters'))!);
    const text = el.textContent ?? '';
    expect(text, "the campaign card's wording").toContain(DEFENSES_HERE);
    expect(text).not.toContain(DEFENSES_STANDALONE);
  }, 120_000);

  it('the standalone tracker’s own Settings keep its wording (there Defenses hides Max HP too)', async () => {
    const { PlayersSection } = await import('../tracker/src/components/SettingsModal');
    const el = render(<PlayersSection />);
    const text = el.textContent ?? '';
    expect(text).toContain(DEFENSES_STANDALONE);
    expect(text).not.toContain(DEFENSES_HERE);
    // The step switch is the tracker's own, standalone too.
    expect(stepSwitch()).not.toBeNull();
  }, 120_000);
});
