// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { initialPlay } from '../src/rules/play';
import { computeSummary } from '../src/sheet/partySummary';
import type { SavedChar } from '../src/data/storage';
import type { CampaignMembership } from '../src/data/campaigns';
import type { PartyMember } from '../src/data/party';
import { applyAppearance, getAppearance, resolveAppearanceVars } from '../src/theme/theme-manager';
import { trackerAppearance } from '../src/integration/trackerAppearance';
import { trackerUi } from '../src/integration/trackerUiStore';
import { rememberCampaign, setOnCampaignsPage } from '../src/integration/lastCampaignView';
import { useCombatStore } from '../tracker/src/store/combatStore';
import { usePartyStore } from '../tracker/src/store/partyStore';
import { useLayoutStore, useGmLayoutStore } from '../tracker/src/store/layoutStore';
import { useWindowStore } from '../tracker/src/store/windowStore';

/**
 * EVERY POPUP OPENED IN THE TRACKER WEARS THE TRACKER'S LOOK — the owner, 2026-10-01 (his online list,
 * item 1): "the character sheet needs to use the players theme of that character and the pop ups there
 * should too but if i open a pop up in the initiative tracker it needs to have the same colors as the
 * initiative tracker".
 *
 * "Customize tracker appearance" paints the tracker's root with inline `--app-*` variables. Four kinds of
 * surface are drawn on <body>, OUTSIDE that root, and resolved the app's look from <html> instead:
 *  (1) Search everything's description popup (HH's own card, portalled by CampaignTracker);
 *  (2) the initiative row's right-click menu and (3) every hover preview (the tracker's own portals);
 *  (4) the confirms raised from the tracker (Clear the order, a card's kick, the local table's "No
 *      campaign settings") — detached roots, which also sat at z-index 80 under the floating windows.
 * Each now carries the tracker's variables; the two HH ones (1, 4) also re-declare colour, font, size
 * and line height, because an HH element inherits <body>'s finished values (computed from the GLOBAL
 * variables) — the variables alone would leave app-coloured text on a tracker-coloured panel.
 *
 * And the other half of his answer: the full character sheet a party card opens keeps its own look (the
 * app's), with everything inside it — its text included, which (variables alone, the same inheritance
 * trap) still wore the tracker's font until the browser proof of this pass caught it.
 *
 * jsdom does not resolve inherited custom properties, so "the look a popup wears" is read the way the
 * cascade would find it: the nearest element, walking up from the popup, that carries an inline
 * `--app-surface` — before this pass that was <html> (the app's look) for all four.
 *
 * MUTATIONS (each applied, run, and read off that run; then restored):
 *  - CampaignTracker: `...hhPopupTheme` dropped from the description wrapper → leg 1 red at the Search
 *    popup: "the Search popup wears the tracker's look: expected '<global surface>' to be '<tracker>'".
 *  - trackerAppearance.ts: `color`/`fontFamily` dropped from `hhSurfaceTheme` → leg 1 red at "the Search
 *    popup: HH text colour re-declared", leg 2 at the kick confirm.
 *  - CampaignTracker: `<HostThemeProvider value={trackerVars}>` → `value={null}` → leg 1 red at the row
 *    menu and again at the hover preview.
 *  - CampaignTracker RailFooter: `style: dialogStyle` dropped → leg 1 red at the Clear confirm.
 *  - CampaignTracker: `onOpenSettings(dialogStyle)` → `onOpenSettings()` → leg 1 red at "No campaign
 *    settings".
 *  - CampaignTracker: `dialogStyle={dialogStyle}` dropped from PartyMembers → leg 2 red at the kick.
 *  - CampaignTracker: `style={fullSheetRevert}` dropped from `.ct-sheet-full` → leg 2 red at the sheet.
 *  - CampaignTracker: `fullSheetRevert = trackerVars ? globalVars : undefined` (the variables alone, as it
 *    shipped) → leg 2 red at "the full sheet: HH text colour re-declared" — the sheet wore the tracker's
 *    font (and its text colour wherever the sheet sets none).
 *  - confirm.tsx: `style={style}` dropped from ConfirmDialog's overlay → leg 1 red at the Clear confirm.
 *  - trackerAppearance.ts: `useTrackerVars`'s memo dependencies `[app]` → `[]` → leg 3 red at "the tracker
 *    root follows the new palette" (the look picked before mount stays forever).
 *
 * Every name and value here is synthetic.
 */

const srv = vi.hoisted(() => ({
  signedIn: false,
  party: [] as PartyMember[],
  sheets: new Map<string, unknown>(),
}));

vi.mock('../src/integration/enabled', () => ({ TRACKER_IN_CAMPAIGN: true, TEST_CAMPAIGNS_WITHOUT_LOGIN: false }));
vi.mock('../src/data/useAuth', () => {
  // Stable objects: a fresh one per call would re-run every effect keyed on the auth state.
  const OUT = { status: 'disabled', session: null, email: null };
  const IN = { status: 'signed-in', session: null, email: 'gm@example.test' };
  return { useAuth: () => (srv.signedIn ? IN : OUT), signOut: async () => undefined };
});
vi.mock('../src/data/party', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/party')>()),
  currentUserId: async () => (srv.signedIn ? 'gm-1' : null),
  fetchParty: async () => srv.party,
  fetchMemberSheet: async (_campaignId: string, charId: string) => srv.sheets.get(charId) ?? null,
  fetchMemberRow: async (_campaignId: string, charId: string) => ({
    sheet: (srv.sheets.get(charId) as SavedChar | undefined) ?? null,
    summary: undefined,
    read: true,
  }),
  fetchPendingGmEdits: async () => [],
  subscribeMemberSheet: () => () => undefined,
  subscribeParty: () => () => undefined,
  publishCharacter: async () => undefined,
  unpublishCharacter: async () => undefined,
  fetchGmEdits: async () => [],
  deleteGmEdit: async () => 1,
  subscribeGmEdits: () => () => undefined,
  pushGmEdit: async () => ({ ok: true, value: null }),
  kickFromParty: async () => ({ ok: true, value: null }),
}));
vi.mock('../src/data/campaigns', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/campaigns')>()),
  fetchCampaignByCode: async () => ({
    ok: true,
    value: { id: 'camp-tide', code: 'TIDE01', ownerId: 'gm-1', name: 'The Brine Ledger', description: '', defaults: {} },
  }),
}));

/* Loaded here, under the mocks, not inside a leg: the tracker's transform would count against its budget. */
const { CampaignsPage } = await import('../src/sheet/CampaignsPage');
await import('../src/integration/CampaignTracker');
await import('../src/integration/TrackerTools');

const CAMPAIGN: CampaignMembership = { id: 'camp-tide', code: 'TIDE01', role: 'gm', name: 'The Brine Ledger' };

/* The files the app fetches, each read and parsed once. */
const parsed = new Map<string, unknown>();
const once = (file: string, read: () => string) => parsed.get(file) ?? parsed.set(file, JSON.parse(read())).get(file);

let live: Root | null = null;
let host: HTMLElement | null = null;

async function flush(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
async function until(what: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 40 && !what(); i++) await flush(1);
  expect(what(), label).toBe(true);
}
const click = (el: Element | null) => act(() => { el!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
function type(input: HTMLInputElement, text: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const btnTitled = (title: string) => {
  const b = [...document.querySelectorAll<HTMLButtonElement>('button')].find((x) => x.title === title);
  if (!b) throw new Error(`no button titled "${title}"`);
  return b;
};

/** The look a surface wears, as the cascade finds it: the nearest element up from it carrying `prop` inline. */
function lookOf(el: Element, prop = '--app-surface'): string {
  for (let n: Element | null = el; n; n = n.parentElement) {
    const v = (n as HTMLElement).style?.getPropertyValue(prop);
    if (v) return v.trim();
  }
  return '(none)';
}

/** The tracker's own body popups: `body > .tracker-root:not(.campaign-tracker)`, the shape the seam's Escape reads. */
const trackerPopups = () => [...document.querySelectorAll<HTMLElement>('body > .tracker-root:not(.campaign-tracker)')];

/** The confirm on screen: its overlay, title, and the overlay's own inline look. */
function dialog(): { overlay: HTMLElement; title: string } | null {
  const modal = document.querySelector<HTMLElement>('.confirm-modal');
  if (!modal) return null;
  return { overlay: modal.closest<HTMLElement>('.confirm-overlay')!, title: modal.querySelector('.info-title')?.textContent ?? '' };
}
async function answer(label: string): Promise<void> {
  const b = [...document.querySelectorAll<HTMLButtonElement>('.confirm-modal button')].find((x) => (x.textContent ?? '').trim() === label);
  if (!b) throw new Error(`the confirm has no "${label}"`);
  click(b);
  await flush(2);
}

/** The tracker's palette and the app's, resolved the way each is applied. */
const TRACKER = { themeId: 'daylight', fontId: 'book' } as const;
const varsOf = (themeId: string, styleId: string, fontId: string, accent: string | null) =>
  resolveAppearanceVars(themeId, styleId, fontId, accent, null).vars;
let tracker: Record<string, string> = {};
let app: Record<string, string> = {};

/** An HH wrapper wears the look of the variables it carries only when it re-declares the four text
 *  properties too (they inherit as finished values from whatever it sits in). */
function expectHhTextRedeclared(el: HTMLElement, what: string): void {
  expect(el.style.color, `${what}: HH text colour re-declared from the wrapper's own variables`).toBe('var(--app-text)');
  expect(el.style.fontFamily, `${what}: HH font re-declared from the wrapper's own variables`).toBe('var(--app-font)');
  expect(el.style.fontSize, `${what}: font size`).toBe('14px');
  expect(el.style.lineHeight, `${what}: line height`).toBe('1.5');
}

beforeEach(() => {
  localStorage.clear();
  srv.signedIn = false;
  srv.party = [];
  srv.sheets.clear();
  rememberCampaign(null);
  setOnCampaignsPage(false);
  trackerUi.reset();
  useCombatStore.setState({ combatants: [], round: 1, activeIndex: 0, selectedId: null, inCombat: false });
  usePartyStore.setState({ parties: [], activePartyId: null });
  useLayoutStore.setState({ root: null, hoveredCid: null });
  useGmLayoutStore.setState({ root: null, hoveredLeaf: null, hoveredCid: null });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  }
  window.matchMedia = ((q: string) => ({
    matches: false, media: q, onchange: null, addListener: () => undefined, removeListener: () => undefined,
    addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  vi.stubGlobal('fetch', async (url: string) => {
    const u = String(url);
    const m = /\/ast\/(\w+)\.json$/.exec(u);
    if (m) return { ok: true, status: 200, json: async () => once(`ast:${m[1]}`, () => gunzipSync(readFileSync(`public/ast/${m[1]}.json.gz`)).toString('utf8')) };
    if (u.endsWith('/ast-index.json')) return { ok: true, status: 200, json: async () => once('ast-index', () => readFileSync('public/ast-index.json', 'utf8')) };
    const core = u.split('/').pop();
    if (core === 'core.json' || core === 'core-descriptions.json')
      return { ok: true, status: 200, json: async () => once(core, () => readFileSync(`public/${core}`, 'utf8')), text: async () => '' };
    return { ok: false, status: 404, json: async () => ({}), text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) };
  });

  // The app's look on <html>, as the app applies it at boot (the default appearance)…
  applyAppearance();
  const g = getAppearance();
  app = varsOf(g.themeId, g.styleId, g.fontId, g.accent);
  // …and a tracker-only look the GM picked in Customize tracker — written where that panel writes it.
  trackerAppearance.reset();
  trackerAppearance.setTheme(TRACKER.themeId);
  trackerAppearance.setFont(TRACKER.fontId);
  tracker = varsOf(TRACKER.themeId, g.styleId, TRACKER.fontId, null);
});

afterEach(() => {
  if (live) act(() => live!.unmount());
  live = null;
  host?.remove();
  host = null;
  for (const n of [...document.body.children]) n.remove();
  trackerAppearance.reset();
  vi.unstubAllGlobals();
});

function renderPage(): HTMLElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  live = createRoot(host);
  act(() => live!.render(
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
  ));
  return host;
}

describe('the tracker’s popups wear the tracker’s look', () => {
  it('fixture: the tracker look really differs from the app look, and is stored where Customize stores it', () => {
    const stored = JSON.parse(localStorage.getItem('pf2e-codex.tracker-appearance') ?? 'null') as { themeId?: string; fontId?: string } | null;
    expect(stored?.themeId).toBe(TRACKER.themeId);
    expect(stored?.fontId).toBe(TRACKER.fontId);
    for (const v of ['--app-surface', '--app-text', '--app-font']) expect(tracker[v], v).not.toBe(app[v]);
    expect(document.documentElement.style.getPropertyValue('--app-surface').trim()).toBe(app['--app-surface']);
  });

  it('on the local table: Search everything, the row menu, a hover preview, Clear and "No campaign settings"', async () => {
    const el = renderPage();
    await flush();
    await until(() => !!el.querySelector('.campaign-tracker'), 'the signed-out page opens the local table');
    const root = el.querySelector<HTMLElement>('.tracker-root.campaign-tracker')!;
    expect(lookOf(root), 'the tracker itself (unchanged)').toBe(tracker['--app-surface']);

    // (1) Search everything → an HH record → HH's description popup, on <body>.
    act(() => trackerUi.setSearch(true));
    await flush();
    type(document.querySelector<HTMLInputElement>('input[placeholder^="Search everything"]')!, 'Breachhill');
    const row = () => [...document.querySelectorAll('[data-row]')].find((r) => r.textContent?.includes('Breachhill, Outpost of Secrets'));
    await until(() => !!row(), 'the article is a Search row');
    click(row()!);
    await until(() => !!document.querySelector('.ast-modal') && (document.body.textContent ?? '').includes('demographics of Breachill'), 'the page opens');
    const popup = document.querySelector<HTMLElement>('.ast-modal')!;
    const wrapper = popup.closest('.picker-overlay')!.parentElement!;
    expect(wrapper.parentElement, 'the popup is drawn on <body>').toBe(document.body);
    expect(lookOf(popup), "the Search popup wears the tracker's look").toBe(tracker['--app-surface']);
    expect(lookOf(popup, '--app-text')).toBe(tracker['--app-text']);
    expect(lookOf(popup, '--app-font')).toBe(tracker['--app-font']);
    expectHhTextRedeclared(wrapper, 'the Search popup');
    // HH's markup stays outside the tracker's scoped stylesheet — and outside the seam's popup detector.
    expect(wrapper.classList.contains('tracker-root')).toBe(false);
    expect(wrapper.closest('.tracker-root')).toBeNull();
    // Every description popup keeps its star (here it pins to the GM screen).
    expect(popup.querySelector<HTMLButtonElement>('.info-star')?.title).toBe('Favorite — add to GM screen');
    click(popup.querySelector('.picker-close'));
    await flush(2);
    expect(document.querySelector('.ast-modal')).toBeNull();

    // (2) A creature in the order, and its row's right-click menu.
    act(() => useCombatStore.getState().addCombatant(null, { name: 'Tidewrack Gull', initiative: 14 }));
    await flush(1);
    const initRow = el.querySelector('.init-row')!;
    act(() => void initRow.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 30, clientY: 30 })));
    await flush(1);
    const menus = trackerPopups();
    expect(menus, 'the row menu, on <body>').toHaveLength(1);
    expect(menus[0].textContent).toContain('Mark defeated');
    expect(lookOf(menus[0]), "the row menu wears the tracker's look").toBe(tracker['--app-surface']);
    expect(lookOf(menus[0], '--app-font')).toBe(tracker['--app-font']);
    await act(async () => {
      menus[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });
    await flush(1);
    expect(trackerPopups()).toHaveLength(0);
    expect(el.querySelector('.campaign-tracker'), 'one Escape closed the menu and left the table up').not.toBeNull();

    // (3) A hover preview: a condition badge on the creature's stat block pane.
    const gull = useCombatStore.getState().combatants[0];
    act(() => useCombatStore.getState().addCondition(gull.id, { name: 'Humming Hex', isPermanent: true, description: 'A synthetic hex that hums at the edge of hearing.' }));
    click(el.querySelector('.init-row'));
    await until(() => !!el.querySelector('.condition-badge'), 'the pane shows the badge');
    const trigger = el.querySelector('.condition-badge')!.parentElement!;
    act(() => void trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: null })));
    await flush(1);
    const preview = trackerPopups().find((p) => (p.textContent ?? '').includes('hums at the edge of hearing'));
    expect(preview, 'the hover preview, on <body>').toBeTruthy();
    expect(lookOf(preview!), "the hover preview wears the tracker's look").toBe(tracker['--app-surface']);
    expect(lookOf(preview!, '--app-text')).toBe(tracker['--app-text']);
    act(() => void trigger.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })));
    await flush(1);

    // (4a) Clear the order → HH's confirm, over the tracker, in its look, above its windows.
    click(el.querySelector('.ct-rail-clear'));
    await until(() => dialog()?.title === 'Clear the initiative order?', 'the Clear confirm');
    let d = dialog()!;
    expect(lookOf(d.overlay), "the Clear confirm wears the tracker's look").toBe(tracker['--app-surface']);
    expectHhTextRedeclared(d.overlay, 'the Clear confirm');
    expect(Number(d.overlay.style.zIndex), 'above every floating window').toBeGreaterThan(useWindowStore.getState().topZ);
    await answer('Cancel');
    expect(useCombatStore.getState().combatants).toHaveLength(1);

    // (4b) The tools' Campaign button on the local table → "No campaign settings", the same way.
    click(btnTitled('Campaign settings — default rules, share code, and delete'));
    await until(() => dialog()?.title === 'No campaign settings', 'the local table says it has no settings');
    d = dialog()!;
    expect(lookOf(d.overlay), "'No campaign settings' wears the tracker's look").toBe(tracker['--app-surface']);
    expectHhTextRedeclared(d.overlay, "'No campaign settings'");
    expect(Number(d.overlay.style.zIndex)).toBeGreaterThan(useWindowStore.getState().topZ);
    await answer('OK');
    expect(dialog()).toBeNull();
  }, 120_000);

  it('in a signed-in campaign: a card’s kick wears the tracker’s look, the full sheet keeps the app’s', async () => {
    srv.signedIn = true;
    const build: BuildState = { ...emptyBuild(), name: 'Tamsin Reedwhistle', level: 4, ancestryId: 'human', heritageId: 'versatile-human', backgroundId: 'acolyte', classId: 'fighter', keyAbility: 'str' };
    const character = buildCharacter(build, content());
    const sheet: SavedChar = { id: 'char-tamsin', character, build, play: initialPlay(character, content()) };
    srv.sheets.set(sheet.id, sheet);
    srv.party = [{ ownerId: 'owner-tamsin', charId: sheet.id, name: character.name, summary: computeSummary(character, content()) }];
    localStorage.setItem('pf2e-codex.campaigns', JSON.stringify([CAMPAIGN]));

    const el = renderPage();
    await flush();
    click(el.querySelector('.cmp-card-btn'));
    await until(() => !!el.querySelector('.campaign-tracker .party-grid .party-card .party-kick'), 'the campaign opens on its party, with the GM’s kick');
    expect(lookOf(el.querySelector('.party-grid .party-card')!), 'the card is inside the themed tracker').toBe(tracker['--app-surface']);

    // The kick asks first — in the tracker's look, above its windows.
    click(el.querySelector('.party-kick'));
    await until(() => (dialog()?.title ?? '').startsWith('Remove Tamsin Reedwhistle'), 'the kick confirm');
    const d = dialog()!;
    expect(lookOf(d.overlay), "the kick confirm wears the tracker's look").toBe(tracker['--app-surface']);
    expectHhTextRedeclared(d.overlay, 'the kick confirm');
    expect(Number(d.overlay.style.zIndex)).toBeGreaterThan(useWindowStore.getState().topZ);
    await answer('Cancel');

    // The full sheet a card opens is the character's own look — the app's — and so is all of it.
    click(el.querySelector('.party-grid .party-card'));
    await until(() => !!el.querySelector('.ct-sheet-full .ws-app'), 'the card opens the GM sheet');
    const full = el.querySelector<HTMLElement>('.ct-sheet-full')!;
    expect(full.style.getPropertyValue('--app-surface').trim(), 'the full sheet carries the app look').toBe(app['--app-surface']);
    expect(lookOf(full.querySelector('.ws-app')!), 'everything in it wears the app look').toBe(app['--app-surface']);
    expect(lookOf(full.querySelector('.ws-app')!, '--app-font')).toBe(app['--app-font']);
    // …its text too: the sheet sits inside `.tracker-root`, which re-declares colour and font from the
    // TRACKER's variables, so without these the sheet kept the tracker's font (browser proof, 2026-10-10:
    // the sheet's text in the tracker's Book serif on the app's Midnight panels).
    expectHhTextRedeclared(full, 'the full sheet');
  }, 120_000);

  it('an open row menu follows the tracker look as the GM changes it, and drops it on a reset', async () => {
    // The refuter's guard (2026-10-10): `useTrackerVars` is memoised on the appearance state, so the
    // variables reach the root and every body popup only while that memo recomputes. The legs above set the
    // look BEFORE the tracker mounts, so a memo that never recomputed would pass them all.
    // Without the fix (`useTrackerVars`'s dependency list `[app]` → `[]`):
    //   AssertionError: the tracker root follows the new palette: expected '#ffffff' to be '#241a18'
    //   (daylight's surface kept after the switch to ember)
    const ember = varsOf('ember', getAppearance().styleId, TRACKER.fontId, null);
    expect(ember['--app-surface'], 'fixture: the second palette differs from the first').not.toBe(tracker['--app-surface']);
    expect(ember['--app-surface'], 'fixture: …and from the app').not.toBe(app['--app-surface']);

    const el = renderPage();
    await flush();
    await until(() => !!el.querySelector('.campaign-tracker'), 'the signed-out page opens the local table');
    const root = el.querySelector<HTMLElement>('.tracker-root.campaign-tracker')!;
    act(() => useCombatStore.getState().addCombatant(null, { name: 'Tidewrack Gull', initiative: 14 }));
    await flush(1);
    act(() => void el.querySelector('.init-row')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 30, clientY: 30 })));
    await flush(1);
    expect(trackerPopups(), 'the row menu, on <body>').toHaveLength(1);
    expect(lookOf(trackerPopups()[0]), 'the row menu starts in the tracker look').toBe(tracker['--app-surface']);

    // The GM picks another palette in Customize tracker (written where that panel writes it), menu still open.
    act(() => trackerAppearance.setTheme('ember'));
    await flush(1);
    expect(JSON.parse(localStorage.getItem('pf2e-codex.tracker-appearance') ?? 'null')?.themeId).toBe('ember');
    expect(trackerPopups(), 'the menu stayed open').toHaveLength(1);
    expect(root.style.getPropertyValue('--app-surface').trim(), 'the tracker root follows the new palette').toBe(ember['--app-surface']);
    expect(lookOf(trackerPopups()[0]), 'the row menu follows the new palette').toBe(ember['--app-surface']);
    expect(lookOf(trackerPopups()[0], '--app-text')).toBe(ember['--app-text']);

    // Back to no tracker look: both drop their variables, so the app's look on <html> shows through.
    act(() => trackerAppearance.reset());
    await flush(1);
    expect(localStorage.getItem('pf2e-codex.tracker-appearance')).toBeNull();
    expect(trackerPopups(), 'the menu stayed open').toHaveLength(1);
    expect(root.style.getPropertyValue('--app-surface'), 'the tracker root carries no tracker look').toBe('');
    expect(trackerPopups()[0].style.getPropertyValue('--app-surface'), 'the row menu carries no tracker look').toBe('');
    expect(lookOf(trackerPopups()[0]), 'the row menu wears the app look').toBe(app['--app-surface']);
  }, 120_000);

  it('HH Settings no longer says the tracker’s look follows the app', () => {
    // The tracker has had its own Customize since 2026-09; the Settings copy said otherwise.
    const src = readFileSync('src/integration/TrackerSettingsSection.tsx', 'utf8');
    expect(src).not.toMatch(/look follows this\s+app&rsquo;s Appearance, and/);
    expect(src).toMatch(/The tracker has its own look/);
  });
});
