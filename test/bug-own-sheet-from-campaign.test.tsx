// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useEffect, useRef, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { content, build } from './_content';
import type { SavedChar } from '../src/data/storage';

/**
 * THE OWNER, 2026-09-18 — "when i treied to enter my character threw the campgin 3 days ago it gave
 * me the edit virsion with the edit warning insted of bringing me to the normall character sheet."
 *
 * A GM plays too, and a player's party page lists their own character alongside their teammates'.
 * Every campaign surface opened a member the same way: the published copy of the row, through the GM
 * editor (campaign detail, tracker pane) or read-only (party page). On your OWN card both are wrong:
 *
 *   • the GM editor put the owner in front of his own character wearing "GM editing X — changes
 *     reach the player only when you Update", where the player is him. Worse than confusing: that
 *     sheet edits a SNAPSHOT, and the device that owns the character overwrites it on its next
 *     publish, so the work is quietly lost (the never-overwrite rule, from the other side);
 *   • read-only showed him his own sheet through a keyhole — no play, no HP, no rest.
 *
 * The fix is one question, asked in one place: `ownRosterId` — is this member me, and is the
 * character on THIS device? — and `useMemberViewer` routes on the answer, so all three surfaces
 * (campaign detail, party page, tracker pane) change together.
 *
 * Every character here is synthetic. No save of the owner's is read.
 */

const server = vi.hoisted(() => ({
  /** `campaign_characters` rows, keyed by char id. */
  sheets: new Map<string, unknown>(),
  /** What `fetchParty` answers. */
  party: [] as Record<string, unknown>[],
  /**
   * What `currentUserId()` answers, and how long it takes to answer.
   *
   * Both are the point of legs (e) and (f): the account is the one thing every surface routes on,
   * and it arrives LATE (it is read asynchronously, while the cards are already on screen) or not at
   * all (signed out, or an auth read that failed). A mock that always resolves ME immediately can
   * only ever prove the happy path.
   */
  uid: null as string | null,
  authDelayMs: 0,
}));

const ME = 'me-1';
const TEAMMATE = 'player-2';
const CAMPAIGN = 'camp-1';

vi.mock('../src/data/useAuth', () => ({
  useAuth: () => ({ status: 'signed-in', session: null, email: 'me@example.com' }),
  signOut: async () => undefined,
}));

vi.mock('../src/data/party', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/party')>()),
  currentUserId: async () => {
    if (server.authDelayMs) await new Promise((r) => setTimeout(r, server.authDelayMs));
    return server.uid;
  },
  fetchParty: async () => server.party,
  fetchMemberRow: async (_c: string, charId: string) => ({
    sheet: (server.sheets.get(charId) as SavedChar | undefined) ?? null,
    summary: undefined,
    read: true,
  }),
  fetchMemberSheet: async (_c: string, charId: string) => server.sheets.get(charId) ?? null,
  subscribeMemberSheet: () => () => undefined,
  subscribeParty: () => () => undefined,
  fetchPendingGmEdits: async () => [],
  publishCharacter: async () => undefined,
  unpublishCharacter: async () => undefined,
}));

const { useMemberViewer, ownRosterId, knownToBeOther } = await import('../src/sheet/PartyMembers');
const { PartyPage } = await import('../src/sheet/PartyPage');
type PartyMember = import('../src/data/party').PartyMember;
type CampaignMembership = import('../src/data/campaigns').CampaignMembership;

const db = content();

const MY_CHAR = 'pc-mine';
const THEIR_CHAR = 'pc-theirs';

function saved(id: string, name: string): SavedChar {
  return { id, character: { ...build('fighter', 3), name } } as SavedChar;
}

/** A published row as the party list sees it. `summary` is only what the card draws. */
function member(charId: string, ownerId: string, name: string): PartyMember {
  return { charId, ownerId, name, summary: { name } } as PartyMember;
}

const MINE = member(MY_CHAR, ME, 'Ilsabet Corrow');
const THEIRS = member(THEIR_CHAR, TEAMMATE, 'Ondry Fellhand');
/** This device's roster — id + name, exactly what App hands the pages. */
const ROSTER = [{ id: MY_CHAR, name: 'Ilsabet Corrow' }];

/** The campaign detail's viewer: GM-edit mode, with the roster and the own-sheet route wired in. */
function DetailViewer({
  open: target,
  roster,
  onOpenOwn,
}: {
  open: PartyMember;
  roster?: { id: string; name: string }[];
  onOpenOwn?: (id: string) => void;
}): ReactElement {
  const { sheetEl, open } = useMemberViewer(db, { gmEdit: true, roster, onOpenOwn });
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void open(CAMPAIGN, target.charId, target.ownerId);
  });
  return <div>{sheetEl}</div>;
}

let live: Root | null = null;
function render(el: ReactElement): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  live = createRoot(host);
  act(() => live!.render(el));
  return host;
}
/** Let the component's own fetches land. `ms` outlasts a deliberately slow auth answer. */
async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}
/** The party card whose name reads `name`. */
function card(host: HTMLElement, name: string): HTMLElement {
  const hit = [...host.querySelectorAll('.party-card')].find((c) =>
    (c.querySelector('.party-card-name')?.textContent ?? '').includes(name),
  );
  if (!hit) throw new Error(`no party card for ${name} — cards: ${[...host.querySelectorAll('.party-card-name')].map((n) => n.textContent).join(' | ')}`);
  return hit as HTMLElement;
}

const PLAYER_MEMBERSHIP: CampaignMembership = { id: CAMPAIGN, code: 'ABC123', role: 'player', name: 'The Fall of Kest' };

beforeEach(() => {
  server.uid = ME;
  server.authDelayMs = 0;
  server.sheets.set(MY_CHAR, saved(MY_CHAR, 'Ilsabet Corrow'));
  server.sheets.set(THEIR_CHAR, saved(THEIR_CHAR, 'Ondry Fellhand'));
  server.party = [MINE, THEIRS] as unknown as Record<string, unknown>[];
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;
  if (!window.matchMedia)
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
});

afterEach(() => {
  if (live) act(() => live!.unmount());
  live = null;
  document.body.innerHTML = '';
  server.sheets.clear();
  server.party = [];
  localStorage.clear();
});

describe('your own character, opened from a campaign', () => {
  /*
   * MUTATION: delete the own-character branch at the top of `open()` in
   * src/sheet/PartyMembers.tsx — the four lines
   *
   *     const mine = ownRosterId({ ownerId, charId }, uid, options?.roster);
   *     if (mine && options?.onOpenOwn) { options.onOpenOwn(mine); return true; }
   *
   * — restoring the straight `fetchMemberRow` it used to do. This leg then fails on both counts:
   * `onOpenOwn` is never called, and the GM-edit strip the owner reported is back on screen.
   */
  it('(a) the GM campaign detail opens the OWN sheet, with no GM-edit strip', async () => {
    const opened: string[] = [];
    const host = render(<DetailViewer open={MINE} roster={ROSTER} onOpenOwn={(id) => opened.push(id)} />);
    await settle();

    expect(opened).toEqual([MY_CHAR]); // the ROSTER id, which is the id App switches the sheet by
    expect(host.querySelector('.gm-edit-tab')).toBe(null);
    expect(host.querySelector('.ro-frame-tab')).toBe(null);
    // Nothing of the published copy is on screen: the host page navigated away instead.
    expect(host.querySelector('.party-viewer')).toBe(null);
  });

  it('(b) a player tapping their own card on the Party page gets the same route', async () => {
    const opened: string[] = [];
    const host = render(
      <PartyPage
        content={db}
        campaigns={[PLAYER_MEMBERSHIP]}
        characters={ROSTER}
        onOpenOwn={(id) => opened.push(id)}
        onClose={() => undefined}
      />,
    );
    await settle();

    act(() => {
      card(host, 'Ilsabet Corrow').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await settle();

    expect(opened).toEqual([MY_CHAR]);
    expect(host.querySelector('.ro-frame-tab')).toBe(null);
    // The card that IS yours says so, which is the only hint the page gives about which one to tap.
    expect(card(host, 'Ilsabet Corrow').querySelector('.party-you')).not.toBe(null);
  });

  it('(c) a TEAMMATE is unchanged — GM edit on the campaign detail, read-only on the party page', async () => {
    const opened: string[] = [];
    const gm = render(<DetailViewer open={THEIRS} roster={ROSTER} onOpenOwn={(id) => opened.push(id)} />);
    await settle();
    expect(opened).toEqual([]);
    expect(gm.querySelector('.gm-edit-tab')).not.toBe(null);
    act(() => live!.unmount());
    live = null;
    document.body.innerHTML = '';

    const host = render(
      <PartyPage
        content={db}
        campaigns={[PLAYER_MEMBERSHIP]}
        characters={ROSTER}
        onOpenOwn={(id) => opened.push(id)}
        onClose={() => undefined}
      />,
    );
    await settle();
    act(() => {
      card(host, 'Ondry Fellhand').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await settle();

    expect(opened).toEqual([]);
    const strip = host.querySelector('.ro-frame-tab');
    expect(strip).not.toBe(null);
    expect(strip!.textContent).toContain('read-only');
    expect(host.querySelector('.gm-edit-tab')).toBe(null);
  });

  it('(d) your character published from ANOTHER device still opens here — labelled, never GM-edit', async () => {
    const opened: string[] = [];
    // Same account, same campaign, but this device's roster has never held the character.
    const host = render(<DetailViewer open={MINE} roster={[]} onOpenOwn={(id) => opened.push(id)} />);
    await settle();

    expect(opened).toEqual([]); // there is nothing on this device to open
    expect(host.querySelector('.gm-edit-tab')).toBe(null); // …and it is NOT someone else's to edit
    const strip = host.querySelector('.ro-frame-tab');
    expect(strip).not.toBe(null);
    expect(strip!.textContent).toContain('your character, published from another device');
  });

  /*
   * THE AUTH RACE — the half of this that a mock resolving ME on the spot can never reach.
   *
   * The account is read asynchronously and the cards are on screen before it answers: `fetchParty`
   * and the auth read are two separate requests started at the same mount, and the party one is
   * routinely first. Every surface must WAIT for the answer rather than measure a rendered null,
   * because "not mine yet" and "not mine" are the same value and only one of them is true.
   *
   * MUTATION: read the account from the rendered hook instead — in `open()`
   * (src/sheet/PartyMembers.tsx) replace `const uid = await currentUserId();` with the `myId` a
   * `useMyId()` at the top of the hook answers. This leg then fails: the tap lands inside the
   * window, `myId` is still null, and the own card opens the published copy instead of the sheet.
   */
  it('(e) a card tapped BEFORE the auth answer lands still routes to your own sheet', async () => {
    server.authDelayMs = 25;
    const opened: string[] = [];
    const host = render(
      <PartyPage
        content={db}
        campaigns={[PLAYER_MEMBERSHIP]}
        characters={ROSTER}
        onOpenOwn={(id) => opened.push(id)}
        onClose={() => undefined}
      />,
    );
    await settle(); // the party is drawn; auth has NOT answered yet
    expect(host.querySelector('.party-card')).not.toBe(null);
    expect(host.querySelector('.party-you')).toBe(null); // …and the page still can't say which is yours

    act(() => {
      card(host, 'Ilsabet Corrow').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await settle(60);

    expect(opened).toEqual([MY_CHAR]);
    expect(host.querySelector('.gm-edit-tab')).toBe(null);
    expect(host.querySelector('.ro-frame-tab')).toBe(null);
  });

  /*
   * AUTH ANSWERS NOTHING — signed out, or a read that failed.
   *
   * The old shape degraded here: `ownerId !== null` is true, so a failed answer opened the GM EDITOR
   * on a row that may well be yours. Not knowing has to REFUSE, and the refusal is the read-only
   * sheet — a sheet read by mistake costs a tap, a sheet edited by mistake is work the owning device
   * overwrites on its next publish without a word.
   *
   * MUTATION: put `viewing.ownerId !== viewing.myId` back in place of `knownToBeOther(...)` in
   * useMemberViewer's render branch — both halves of this leg then draw `.gm-edit-tab`.
   */
  it('(f) with NO answer from auth, no card opens the GM editor — not even a teammate’s', async () => {
    server.uid = null;
    const opened: string[] = [];
    const mine = render(<DetailViewer open={MINE} roster={ROSTER} onOpenOwn={(id) => opened.push(id)} />);
    await settle();
    expect(opened).toEqual([]); // nothing to route to: we don't know it's ours
    expect(mine.querySelector('.gm-edit-tab')).toBe(null);
    expect(mine.querySelector('.ro-frame-tab')).not.toBe(null);
    // …and it must not CLAIM to be yours either — that label is an answer we don't have.
    expect(mine.querySelector('.ro-frame-tab')!.textContent).not.toContain('published from another device');
    act(() => live!.unmount());
    live = null;
    document.body.innerHTML = '';

    const theirs = render(<DetailViewer open={THEIRS} roster={ROSTER} onOpenOwn={(id) => opened.push(id)} />);
    await settle();
    expect(theirs.querySelector('.gm-edit-tab')).toBe(null);
    expect(theirs.querySelector('.ro-frame-tab')).not.toBe(null);
  });
});

describe('knownToBeOther — the test that decides whether a GM-edit sheet may open', () => {
  it('is true only for an account we HAVE read and that differs', () => {
    expect(knownToBeOther(TEAMMATE, ME)).toBe(true);
    expect(knownToBeOther(ME, ME)).toBe(false);
  });

  it('is FALSE while the account is unknown — the whole point', () => {
    // `TEAMMATE !== null` is true, and that arithmetic is what opened the editor on the owner's own
    // character in the first seconds of the campaign page.
    expect(knownToBeOther(TEAMMATE, null)).toBe(false);
    expect(knownToBeOther(ME, null)).toBe(false);
  });
});

describe('ownRosterId — the one question every surface asks', () => {
  it('matches on the roster id, which is what a publish carries', () => {
    expect(ownRosterId(MINE, ME, ROSTER)).toBe(MY_CHAR);
  });

  it("is null for someone else's character, whatever it is called", () => {
    expect(ownRosterId(THEIRS, ME, ROSTER)).toBe(null);
    expect(ownRosterId({ ...THEIRS, name: 'Ilsabet Corrow' }, ME, ROSTER)).toBe(null);
  });

  it('is null while signed out, and null with nothing on the device', () => {
    expect(ownRosterId(MINE, null, ROSTER)).toBe(null);
    expect(ownRosterId(MINE, ME, [])).toBe(null);
  });

  /*
   * MUTATION: put the name fallback back in `ownRosterId` (src/sheet/PartyMembers.tsx) — matching a
   * roster entry whose name equals `member.name` when no id matches. This leg then fails: `reimported`
   * shares the published name but not the id, and it would open.
   */
  it('never falls back to name — a different local character sharing the published name stays closed', () => {
    const reimported = [{ id: 'fresh-id', name: 'Ilsabet Corrow' }];
    expect(ownRosterId(MINE, ME, reimported)).toBe(null);
  });
});

/**
 * THE WIRING, read off the source.
 *
 * The behaviour above is proved on `useMemberViewer`, which is where the decision lives. These are
 * the three call sites that have to hand it what it needs — a page that forgets one is a surface
 * silently back to the old behaviour, and no render test of the hook would notice.
 */
describe('every campaign surface is wired to the same route', () => {
  const read = (f: string) => readFileSync(f, 'utf8');

  it('the campaign detail passes the roster and the own-sheet route', () => {
    const src = read('src/sheet/CampaignsPage.tsx');
    expect(src).toContain('roster: characters');
    expect(src).toContain('onOpenOwn');
    // Id-only: `open()` takes no name, so a name can never become a match.
    expect(src.match(/open\(view\.m\.id, mem\.charId, mem\.ownerId\)/g)?.length).toBe(2);
  });

  it('the party page passes them too', () => {
    const src = read('src/sheet/PartyPage.tsx');
    expect(src).toContain('{ roster: characters, onOpenOwn }');
    expect(src).toContain('open(selectedId, m.charId, m.ownerId)');
  });

  it('the tracker sends your own card back to the page instead of its GM editor', () => {
    const src = read('src/integration/CampaignTracker.tsx');
    // The ONE route into the tracker's GM sheet (the dashboard card and the PC pane card both go
    // through it), asking the shared question of an AWAITED account — not of the rendered `useMyId()`
    // that is still null while these cards paint.
    expect(src).toContain('knownToBeOther(mem.ownerId, await currentUserId())');
    expect(src).toContain('if (other && roster.byId.has(mem.charId)) setFullSheetId(mem.charId);');
    // The shape that caused the bug, in any spacing or operand order: an ownership test against the
    // rendered hook, `mem.ownerId !== myId` or its mirror `myId !== mem.ownerId`.
    expect(src).not.toMatch(/mem\.ownerId\s*!==\s*myId|myId\s*!==\s*mem\.ownerId/);
  });

  /*
   * The account read itself. `getUser()` is a network call on EVERY invocation in auth-js 2.110
   * (`_getUser` re-requests `GET /auth/v1/user` unconditionally), so asking it on the way into every
   * member card put an auth round-trip in front of each tap — and a failed one answers `user: null`,
   * which is the "signed out" that used to open the GM editor on your own character. `getSession()`
   * is a local storage read and answers the same question.
   */
  it('the account is read locally, never over the network', () => {
    const src = read('src/data/party.ts');
    expect(src).toContain('await supabase.auth.getSession()');
    expect(src).not.toContain('supabase.auth.getUser()');
  });

  it('App gives both pages the own-sheet route', () => {
    const src = read('src/App.tsx');
    expect(src.match(/onOpenOwn=\{\(id\) => \{ setActiveId\(id\); setMode\('sheet'\); \}\}/g)?.length).toBe(2);
  });
});
