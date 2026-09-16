// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { content } from './_content';
import type { CampaignMembership } from '../src/data/campaigns';
import { useCombatStore } from '../tracker/src/store/combatStore';
import { usePartyStore } from '../tracker/src/store/partyStore';
import { useLayoutStore } from '../tracker/src/store/layoutStore';
import { trackerUi } from '../src/integration/trackerUiStore';
import { rememberCampaign, setOnCampaignsPage } from '../src/integration/lastCampaignView';

/**
 * The campaign tracker's side rail is a GM-draggable 280–480px column (dragged this session only —
 * it does not persist). On a tablet-width window (721–~1100px, above the phone shell's 720px
 * cutoff) that width was eating the middle workspace. CampaignTracker caps the RENDERED width to
 * ~30% of the viewport without touching the underlying railWidth or the drag ceiling — three legs
 * below cover the render cap (900px, 1600px) and the drag path itself (1400px), reusing the
 * mock/render setup from test/bug-tracker-seam.test.tsx (openTracker) as a template, trimmed to
 * just what mounting needs.
 */

// Same mocks as the seam test's `openTracker()` — CampaignTracker's import graph (useCampaignDefaults
// etc.) reaches all of these even though CampaignTracker.tsx itself only imports fetchParty directly.
vi.mock('../src/integration/enabled', () => ({
  TRACKER_IN_CAMPAIGN: true,
  TEST_CAMPAIGNS_WITHOUT_LOGIN: false,
}));

vi.mock('../src/data/useAuth', () => ({
  useAuth: () => ({ status: 'signed-in', session: null, email: 'gm@example.com' }),
  signOut: async () => undefined,
}));

vi.mock('../src/data/party', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/party')>()),
  currentUserId: async () => 'gm-1',
  fetchParty: async () => [],
  fetchMemberSheet: async () => null,
  subscribeMemberSheet: () => () => undefined,
  subscribeParty: () => () => undefined,
  publishCharacter: async () => undefined,
  unpublishCharacter: async () => undefined,
  fetchGmEdits: async () => [],
  deleteGmEdit: async () => 1,
  subscribeGmEdits: () => () => undefined,
  pushGmEdit: async () => ({ ok: true, value: null }),
}));

const CAMPAIGN: CampaignMembership = { id: 'camp-1', code: 'TESTCODE', role: 'gm', name: 'The Salt Road' };

function stubMedia(): void {
  window.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

function stubFetch(): void {
  const files: Record<string, string> = {
    'core.json': 'public/core.json',
    'core-descriptions.json': 'public/core-descriptions.json',
  };
  vi.stubGlobal('fetch', async (url: string) => {
    const path = files[String(url).split('/').pop() ?? ''];
    if (!path) return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(path, 'utf8')) as unknown, text: async () => '' };
  });
}

let live: Root | null = null;
let host: HTMLElement | null = null;

async function flush(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function render(el: React.ReactElement): HTMLElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  live = createRoot(host);
  act(() => live!.render(el));
  return host;
}

async function openTracker(): Promise<HTMLElement> {
  const { CampaignTracker } = await import('../src/integration/CampaignTracker');
  const el = render(
    <CampaignTracker
      m={CAMPAIGN}
      content={content()}
      onOpenSettings={() => undefined}
      onLeave={() => undefined}
      onViewMember={() => undefined}
    />,
  );
  await flush();
  return el;
}

/** Sets the viewport and lets the rAF-debounced resize handler in CampaignTracker fire. */
async function setViewport(width: number): Promise<void> {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  await act(async () => {
    window.dispatchEvent(new Event('resize'));
    // jsdom's requestAnimationFrame runs on a short real timeout, not a microtask.
    await new Promise((r) => setTimeout(r, 32));
  });
}

const rail = (): HTMLElement => {
  const el = host?.querySelector('.ct-order') as HTMLElement | null;
  if (!el) throw new Error('no .ct-order rail — the collapsed drawer must be showing instead');
  return el;
};

/** Drags the .ct-rail-resize handle by dx px, the way a GM would with the mouse. */
async function dragRailBy(dx: number): Promise<void> {
  const handle = host?.querySelector('.ct-rail-resize');
  if (!handle) throw new Error('no .ct-rail-resize handle');
  await act(async () => {
    handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 0 }));
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: dx }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
}

beforeEach(() => {
  localStorage.clear();
  rememberCampaign(null);
  setOnCampaignsPage(false);
  trackerUi.reset();
  useCombatStore.setState({ combatants: [], round: 1, activeIndex: 0, selectedId: null, inCombat: false });
  usePartyStore.setState({ parties: [], activePartyId: null });
  useLayoutStore.setState({ root: null, hoveredCid: null });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  stubMedia();
  stubFetch();
});

afterEach(() => {
  if (live) act(() => live!.unmount());
  live = null;
  host?.remove();
  host = null;
  vi.unstubAllGlobals();
});

describe('campaign tracker rail — tablet width cap', () => {
  it('caps the rail to ~30% of a tablet-width viewport (900px -> floor(900*0.3)=270)', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 900 });
    await openTracker();
    await setViewport(900);
    // Mutation check: replacing CampaignTracker.tsx's `effectiveRailWidth` line (the
    // `Math.min(railWidth, Math.max(railMinWidth, Math.floor(viewportWidth * 0.3)))` assignment,
    // just above the drag-cap comment) with plain `railWidth` fails this leg — 280 is not <= 270 —
    // while the 1600px leg below still passes. Dropped, run, confirmed the failure, reverted.
    expect(parseFloat(rail().style.width)).toBeLessThanOrEqual(270);
  });

  it('leaves the rail at the stored 280px on a desktop-width viewport (1600px, cap=480)', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1600 });
    await openTracker();
    await setViewport(1600);
    expect(parseFloat(rail().style.width)).toBe(280);
  });

  it('drags to the full 480px ceiling at a 1400px "desktop" width, unaffected by the tablet cap', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1400 });
    await openTracker();
    await setViewport(1400);
    await dragRailBy(2000);
    expect(parseFloat(rail().style.width)).toBe(480);
  });

  it('does not let a narrow-viewport drag permanently overwrite a wider dragged width', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1600 });
    await openTracker();
    await setViewport(1600);
    await dragRailBy(2000);
    expect(parseFloat(rail().style.width)).toBe(480); // dragged to the ceiling at 1600px

    await setViewport(900);
    expect(parseFloat(rail().style.width)).toBeLessThanOrEqual(270); // render-only cap

    // A tiny nudge on the handle at 900px must not clamp the stored width down to the 900px cap.
    await dragRailBy(1);
    await setViewport(1600);
    expect(parseFloat(rail().style.width)).toBe(480); // back to the full dragged width
  });
});
