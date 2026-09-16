// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { initialPlay } from '../src/rules/play';
import { computeSummary } from '../src/sheet/partySummary';
import type { SavedChar } from '../src/data/storage';
import type { CampaignMembership } from '../src/data/campaigns';
import type { PartyMember } from '../src/data/party';
import { useCombatStore } from '../tracker/src/store/combatStore';
import { usePartyStore } from '../tracker/src/store/partyStore';
import { useLayoutStore } from '../tracker/src/store/layoutStore';
import { trackerUi } from '../src/integration/trackerUiStore';
import { rememberCampaign, setOnCampaignsPage } from '../src/integration/lastCampaignView';

/**
 * LEAVING A CAMPAIGN, AND THE PHONE'S SIDE OF IT.
 *
 * Three defects a five-lens pass confirmed, all in a RELEASE build:
 *  (a) Escape or the Back arrow unmounted the tracker — and every open GM sheet's unpushed working
 *      copy with it — with no prompt, while the campaign-settings route gated the identical
 *      navigation. Leaving is now the tracker's own decision, behind the same gate;
 *  (b) Settings offered the GM-only 'Initiative tracker' section on a phone (and pulled the tracker
 *      chunk down to render it), against the ruling that there is no GM side on the phone;
 *  (c) pasting your OWN share code into the phone's Join row replaced your 'gm' membership with a
 *      'player' one, dropping `useDefaults` with it.
 */

const srv = vi.hoisted(() => ({
  party: [] as PartyMember[],
  sheets: new Map<string, unknown>(),
}));

// A RELEASE build: the dev flag that used to gate the party bridge is off.
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
  fetchParty: async () => srv.party,
  fetchMemberSheet: async (_campaignId: string, charId: string) => srv.sheets.get(charId) ?? null,
  subscribeMemberSheet: () => () => undefined,
  subscribeParty: () => () => undefined,
  pushGmEdit: async () => ({ ok: true, value: null }),
}));

const CAMPAIGN: CampaignMembership = {
  id: 'camp-1',
  code: 'TESTCODE',
  role: 'gm',
  name: 'The Salt Road',
  useDefaults: true,
};

// The GM's own share code resolves to their own campaign — exactly what makes the join a downgrade.
vi.mock('../src/data/campaigns', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/campaigns')>()),
  fetchCampaignByCode: async () => ({
    ok: true,
    value: { id: 'camp-1', code: 'TESTCODE', ownerId: 'gm-1', name: 'The Salt Road', description: '', defaults: {} },
  }),
}));

/*
 * A stand-in for a GM sheet with an unpushed working copy: it always asks, through HH's own
 * confirmDialog, and answers with what the GM chose. The real GmEditSheet's dirty tracking is its
 * own business and tested elsewhere — what's under test here is whether anything asks it at all
 * before the view is torn down.
 */
vi.mock('../src/sheet/GmEditSheet', async () => {
  const React = await import('react');
  const { confirmDialog } = await import('../src/sheet/confirm');
  return {
    GmEditSheet: React.forwardRef((_props: Record<string, unknown>, ref) => {
      React.useImperativeHandle(ref, () => ({
        confirmLeave: async () =>
          await confirmDialog({
            title: 'Update before leaving?',
            message: 'This character has changes you haven’t sent to the player yet.',
            confirmLabel: 'Update',
          }),
      }));
      return React.createElement('div', { className: 'stub-gm-sheet' }, 'working copy');
    }),
  };
});

const buildOf = (name: string): BuildState => ({
  ...emptyBuild(),
  name,
  level: 5,
  ancestryId: 'human',
  heritageId: 'versatile-human',
  backgroundId: 'acolyte',
  classId: 'fighter',
  keyAbility: 'str',
});

function publishPc(): PartyMember {
  const db = content();
  const build = buildOf('Ayla Brightwood');
  const character = buildCharacter(build, db);
  const sc: SavedChar = { id: 'char-a', character, build, play: initialPlay(character, db) };
  srv.sheets.set(sc.id, sc);
  return { ownerId: 'owner-a', charId: sc.id, name: character.name, summary: computeSummary(character, db) };
}

function stubMedia(phone: boolean): void {
  window.matchMedia = ((q: string) => ({
    matches: phone && /max-width:\s*(720|768)px/.test(q),
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

const click = (el: Element) => act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));

/** Type into a controlled input the way React sees it. */
function type(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(el, value);
  act(() => void el.dispatchEvent(new Event('input', { bubbles: true })));
}

const dialog = () => document.querySelector('.confirm-modal');
const dialogButton = (cls: string): HTMLElement => {
  const el = dialog()?.querySelector(cls);
  if (!el) throw new Error(`no ${cls} in the dialog — on screen: ${dialog()?.textContent ?? '(no dialog at all)'}`);
  return el as HTMLElement;
};

beforeEach(() => {
  localStorage.clear();
  srv.party = [];
  srv.sheets.clear();
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
  stubMedia(false);
  stubFetch();
});

afterEach(() => {
  if (live) act(() => live!.unmount());
  live = null;
  host?.remove();
  host = null;
  vi.unstubAllGlobals();
});

async function openCampaign(): Promise<HTMLElement> {
  // Warm the two lazy chunks the campaign view pulls in, so opening it is a re-render rather than a
  // cold module transform that outlives the flush below.
  await import('../src/integration/CampaignTracker');
  await import('../src/integration/TrackerTools');
  const { CampaignsPage } = await import('../src/sheet/CampaignsPage');
  const el = render(
    <CampaignsPage
      content={content()}
      onClose={() => undefined}
      onOpenRoster={() => undefined}
      onOpenHomebrew={() => undefined}
      characters={[]}
      modes={{}}
      onSaveMode={() => undefined}
      onDeleteMode={() => undefined}
    />,
  );
  await flush();
  click(el.querySelector('.cmp-card-btn')!);
  await flush();
  return el;
}

describe('leaving a campaign', () => {
  it('asks before the Back arrow throws away an unpushed sheet edit, and stays put on cancel', async () => {
    // tracker 2026-09-15: leave gate · owner 2026-09-16: the working copy moved
    // Without the fix (CampaignsPage's goBack still the base of the dismiss stack):
    //   Error: no .btn-ghost in the dialog — on screen: (no dialog at all)
    /*
     * The unpushed working copy used to live in a PC's PANE, one per pane. It doesn't any more: a
     * PC's pane holds their card, and the card opens the one editable sheet as a layer over the whole
     * view. So this walks the route a GM actually takes to a working copy now — row → card → sheet —
     * and then presses Back on it. The guarantee is unchanged: nothing throws that copy away silently.
     */
    srv.party = [publishPc()];
    localStorage.setItem('pf2e-codex.campaigns', JSON.stringify([CAMPAIGN]));
    const el = await openCampaign();
    expect(el.querySelector('.campaign-tracker')).not.toBeNull();

    act(() =>
      useCombatStore.getState().addCombatant(null, { name: 'Ayla Brightwood', isPC: true, maxHP: 60 }),
    );
    await flush(2);
    const cid = useCombatStore.getState().combatants[0].id;
    act(() => {
      useLayoutStore.getState().open(cid);
      trackerUi.showMain('combatant');
    });
    await flush(2);
    // The pane is the player's CARD; clicking it is what opens the editable sheet.
    const paneCard = el.querySelector('.ct-pane-card .party-card');
    expect(paneCard).not.toBeNull();
    click(paneCard!);
    await flush(2);
    expect(el.querySelector('.ct-sheet-full .stub-gm-sheet')).not.toBeNull();

    // Back arrow → the same question the campaign-settings route has always asked.
    click(el.querySelector('.hb-back')!);
    await flush(2);
    click(dialogButton('.btn-ghost')); // Cancel
    await flush(2);
    expect(el.querySelector('.stub-gm-sheet')).not.toBeNull(); // the working copy is still there
    expect(el.querySelector('.campaign-tracker')).not.toBeNull(); // and still in the campaign

    // …saying yes closes the SHEET and lands back on the card — the gate isn't a dead end, and Back
    // peels one layer at a time rather than dropping the GM out of the campaign.
    click(el.querySelector('.hb-back')!);
    await flush(2);
    click(dialogButton('.btn-primary')); // Update
    await flush(3);
    expect(el.querySelector('.stub-gm-sheet')).toBeNull();
    expect(el.querySelector('.ct-pane-card .party-card')).not.toBeNull();
    expect(el.querySelector('.campaign-tracker')).not.toBeNull();

    // Nothing left to lose — the next Back really does leave.
    click(el.querySelector('.hb-back')!);
    await flush(3);
    expect(el.querySelector('.campaign-tracker')).toBeNull();
  }, 120_000);

  it('keeps the GM initiative-tracker section out of Settings on a phone', async () => {
    // tracker 2026-09-15: ruling 5 — no GM side on the phone.
    // Without the fix (rendering the unfiltered SECTIONS):
    //   AssertionError: expected ' Heroes Heaven SettingsAppearanceRule…' not to contain
    //   'Initiative tracker'
    stubMedia(true);
    const { SettingsPage } = await import('../src/sheet/SettingsPage');
    const el = render(<SettingsPage onClose={() => undefined} />);
    await flush();

    expect(el.textContent).toContain('Appearance'); // the page rendered…
    expect(el.textContent).not.toContain('Initiative tracker'); // …without the GM section
  }, 120_000);

  it('still offers the tracker section on the desktop', async () => {
    // tracker 2026-09-15: the other half — the filter is the phone's, not everyone's.
    stubMedia(false);
    const { SettingsPage } = await import('../src/sheet/SettingsPage');
    const el = render(<SettingsPage onClose={() => undefined} />);
    await flush();

    expect(el.querySelector('.settings-nav')?.textContent).toContain('Initiative tracker');
  }, 120_000);

  it('never downgrades a GM membership when their own code is pasted into Join', async () => {
    // tracker 2026-09-15: join guard
    // Without the fix (JoinRow's upsert replacing the row):
    //   AssertionError: expected 'player' to be 'gm'
    stubMedia(true);
    localStorage.setItem('pf2e-codex.campaigns', JSON.stringify([CAMPAIGN]));
    const { CampaignsPage } = await import('../src/sheet/CampaignsPage');
    const el = render(
      <CampaignsPage
        content={content()}
        onClose={() => undefined}
        onOpenRoster={() => undefined}
        onOpenHomebrew={() => undefined}
        characters={[]}
        modes={{}}
        onSaveMode={() => undefined}
        onDeleteMode={() => undefined}
      />,
    );
    await flush();

    const input = el.querySelector('input[aria-label="Campaign share code"]') as HTMLInputElement;
    type(input, 'TESTCODE');
    click([...el.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Join')!);
    await flush(2);

    const stored = JSON.parse(localStorage.getItem('pf2e-codex.campaigns') ?? '[]') as CampaignMembership[];
    expect(stored).toHaveLength(1);
    expect(stored[0].role).toBe('gm');
    expect(stored[0].useDefaults).toBe(true);
    expect(el.textContent).toContain('Already joined');
  }, 120_000);
});
