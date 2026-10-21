// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { seedContent } from '../src/rules/seed';
import { emptyBuild, type BuildState } from '../src/rules/build';
import type { CampaignMembership } from '../src/data/campaigns';
import type { SavedChar } from '../src/data/storage';
import { saveCampaigns } from '../src/data/storage';
import { campaignsOfCharacter, keepBuildCampaigns, keepRosterCampaigns, leaveCampaignFor, leaveCampaignQuestion } from '../src/data/campaignLeave';
import { useUndoableState, type Undoable } from '../src/useUndoableState';
import { renderDom } from './_render';

/**
 * CAMPAIGNS BELONG TO A CHARACTER — the owner, 2026-10-21:
 *   "i want campigns to be character specific so i dont see all of the campins all my characters are
 *    in on every character. also insted of being able to get in and out as you like if you leav it asks
 *    you and if you say yes it removes the campign (you can join with the code, the point is so that the
 *    player dont exit the campign by mistake …)"
 *
 * Before: a character's Setup → Campaigns card listed EVERY campaign the account was in as on/off
 * chips (one click took the character out, no question), and Leave dropped the campaign from ALL of
 * the player's characters. What this pins:
 *  - the card lists only the campaigns THIS character is in, with no toggle;
 *  - Leave asks first; Cancel changes nothing; yes takes out this character only;
 *  - a player's membership goes only when none of their characters is left in it; a GM's never;
 *  - the Party page asks the same question, for a GM's character too;
 *  - App hands the leaving character's id to both doors.
 */

const srv = vi.hoisted(() => ({
  /** What the server answers for a code: a campaign, or an error (offline). */
  campaign: null as null | { id: string; code: string; ownerId: string; name: string; description: string; defaults: object },
  /** The server answered "no such campaign" (instead of not answering). */
  notFound: false,
  /** The signed-in account's id. */
  userId: 'TEST-user-player',
  status: 'signed-in' as 'signed-in' | 'signed-out',
  refreshCampaignHomebrew: vi.fn(),
}));
vi.mock('../src/data/useAuth', () => ({
  useAuth: () =>
    srv.status === 'signed-in'
      ? { status: 'signed-in', session: { user: { id: srv.userId } }, email: 'player@example.com' }
      : { status: 'signed-out', session: null, email: null },
  signOut: async () => undefined,
}));
vi.mock('../src/data/campaigns', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/campaigns')>()),
  fetchCampaignByCode: async () =>
    srv.campaign
      ? { ok: true, value: srv.campaign }
      : srv.notFound
        ? { ok: false, error: 'TEST no such campaign', notFound: true }
        : { ok: false, error: 'TEST offline' },
}));
vi.mock('../src/data/campaignHomebrew', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/campaignHomebrew')>()),
  refreshCampaignHomebrew: srv.refreshCampaignHomebrew,
}));
// The Party page's member list talks to the server; only its Leave row is under test here.
vi.mock('../src/sheet/PartyMembers', () => ({
  PartyMembers: () => null,
  useMemberViewer: () => ({ sheetEl: null, open: () => undefined }),
}));

const db = seedContent;
const A: CampaignMembership = { id: 'camp-a', code: 'AAA234', role: 'player', name: 'TEST Salt Road' };
const B: CampaignMembership = { id: 'camp-b', code: 'BBB234', role: 'player', name: 'TEST Floating City' };
const G: CampaignMembership = { id: 'camp-g', code: 'GGG234', role: 'gm', name: 'TEST My Own Table' };

const char = (id: string, campaignIds: string[], extra: Partial<SavedChar> = {}): SavedChar =>
  ({
    id,
    character: { name: `TEST ${id}`, campaignIds },
    build: { ...emptyBuild(), name: `TEST ${id}`, campaignIds },
    ...extra,
  }) as unknown as SavedChar;
const idsOf = (c: SavedChar) => [c.character.campaignIds, c.build?.campaignIds];

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
const dialog = () => document.querySelector('.confirm-modal');
const dialogButton = (cls: string): HTMLElement => {
  const el = dialog()?.querySelector(cls);
  if (!el) throw new Error(`no ${cls} in the dialog — on screen: ${dialog()?.textContent ?? '(no dialog at all)'}`);
  return el as HTMLElement;
};

beforeEach(() => {
  localStorage.clear();
  srv.campaign = null;
  srv.notFound = false;
  srv.userId = 'TEST-user-player';
  srv.status = 'signed-in';
  srv.refreshCampaignHomebrew.mockClear();
});
afterEach(async () => {
  if (live) act(() => live!.unmount());
  live = null;
  host?.remove();
  host = null;
  document.querySelectorAll('.confirm-overlay').forEach((d) => d.parentElement?.remove());
  await flush(1);
});

describe('which campaigns a character shows', () => {
  it('only the ones this character is in, in its own order — never every campaign of the account', () => {
    expect(campaignsOfCharacter(['camp-b', 'camp-a'], [A, B, G]).map((m) => m.name)).toEqual([B.name, A.name]);
    expect(campaignsOfCharacter([], [A, B, G])).toEqual([]);
    expect(campaignsOfCharacter(undefined, [A, B, G])).toEqual([]);
  });
  it('a campaign whose membership is not on this device yet still shows (unknown is not "not in it")', () => {
    expect(campaignsOfCharacter(['camp-x'], [A])).toEqual([{ id: 'camp-x', code: '', role: 'player', name: 'Campaign' }]);
  });
});

describe('what Leave changes', () => {
  it('takes out ONLY the leaving character — character and build both', () => {
    const roster = [char('c1', ['camp-a', 'camp-b']), char('c2', ['camp-a']), char('c3', [])];
    const out = leaveCampaignFor(roster, [A, B], 'c1', 'camp-a');
    expect(idsOf(out.roster[0])).toEqual([['camp-b'], ['camp-b']]);
    expect(out.roster[1], 'another character in the same campaign stays in it').toBe(roster[1]);
    expect(out.roster[2]).toBe(roster[2]);
  });
  it('a player keeps the campaign while another character is in it, and loses it with the last one', () => {
    const roster = [char('c1', ['camp-a']), char('c2', ['camp-a'])];
    const first = leaveCampaignFor(roster, [A, B], 'c1', 'camp-a');
    expect(first.memberships.map((m) => m.id)).toEqual(['camp-a', 'camp-b']);
    const second = leaveCampaignFor(first.roster, first.memberships, 'c2', 'camp-a');
    expect(second.memberships.map((m) => m.id)).toEqual(['camp-b']);
    expect(second.roster.every((c) => !(c.character.campaignIds ?? []).includes('camp-a'))).toBe(true);
  });
  it('a GM never loses the campaign they run', () => {
    const out = leaveCampaignFor([char('c1', ['camp-g'])], [G], 'c1', 'camp-g');
    expect(out.memberships).toEqual([G]);
    expect(idsOf(out.roster[0])).toEqual([[], []]);
  });
  it('a character the Builder has not created yet: only the others are counted, the roster is untouched', () => {
    const roster = [char('c1', ['camp-b'])];
    const none = leaveCampaignFor(roster, [A, B], undefined, 'camp-a');
    expect(none.roster).toBe(roster);
    expect(none.memberships.map((m) => m.id)).toEqual(['camp-b']);
    expect(leaveCampaignFor(roster, [A, B], undefined, 'camp-b').memberships.map((m) => m.id)).toEqual(['camp-a', 'camp-b']);
  });
  it('an archived character, or one linked only through its build, still holds the campaign', () => {
    const archived = char('c2', ['camp-a'], { archived: true });
    expect(leaveCampaignFor([char('c1', ['camp-a']), archived], [A], 'c1', 'camp-a').memberships).toEqual([A]);
    const buildOnly = { ...char('c2', []), build: { ...emptyBuild(), campaignIds: ['camp-a'] } } as SavedChar;
    expect(leaveCampaignFor([char('c1', ['camp-a']), buildOnly], [A], 'c1', 'camp-a').memberships).toEqual([A]);
  });
  it('changes nothing it was not asked to (same arrays back)', () => {
    const roster = [char('c1', ['camp-b'])];
    const memberships = [A, B];
    const out = leaveCampaignFor(roster, memberships, 'c1', 'camp-g');
    expect(out.roster).toBe(roster);
    expect(out.memberships).toBe(memberships);
  });
});

describe('undo and redo never change which campaigns a character is in', () => {
  // Owner, 2026-10-21 ("yes" to fixing: Leave in the builder, then Ctrl+Z and Save brought the campaign
  // back as "Campaign"). The App-level legs are in test/campaign-leave-app.test.tsx.
  it('a build an undo makes keeps the present’s campaigns, and is the same object when they match', () => {
    const before = { ...emptyBuild(), name: 'TEST Old', campaignIds: ['camp-a'] };
    const present = { ...emptyBuild(), name: 'TEST New', campaignIds: [] };
    expect(keepBuildCampaigns(before, present)).toEqual({ ...before, campaignIds: [] });
    const same = { ...before, campaignIds: [] as string[] };
    expect(keepBuildCampaigns(same, present)).toBe(same);
  });
  it('a roster an undo makes: each character keeps the campaigns it has now, character and build', () => {
    const was = [char('c1', ['camp-a']), char('c2', ['camp-b'])];
    const now = [char('c1', []), was[1]];
    const out = keepRosterCampaigns(was, now);
    expect(idsOf(out[0])).toEqual([[], []]);
    expect(out[1], 'a character whose campaigns match is left alone').toBe(was[1]);
    expect(keepRosterCampaigns(now, now), 'nothing to change: the same array').toBe(now);
  });
  it('a character the undo brings back (a delete undone) keeps its own campaigns — less one the account left since', () => {
    const back = [char('c1', ['camp-a', 'camp-b'])];
    expect(keepRosterCampaigns(back, []), 'memberships not known yet: kept as it was').toBe(back);
    expect(keepRosterCampaigns(back, [], [A, B]), 'still in both: kept as it was').toBe(back);
    // MUTATION: return the restored character unchanged when `memberships` is given and this fails —
    // delete A, Leave on B (the last holder now: the membership goes), Ctrl+Z: A came back in a campaign
    // the account is no longer in, as "Campaign", publishing to it (checker's finding, 2026-10-21).
    expect(idsOf(keepRosterCampaigns(back, [], [B])[0])).toEqual([['camp-b'], ['camp-b']]);
  });
  it('useUndoableState hands every undo and redo through `keep` — an earlier step’s snapshot no longer brings a campaign back', () => {
    // MUTATION: drop the `keepRef.current(...)` call in useUndoableState's carry and this fails.
    let api!: Undoable<BuildState>;
    function H() {
      api = useUndoableState<BuildState>(() => ({ ...emptyBuild(), name: 'TEST A', campaignIds: ['camp-a'] }), { keep: keepBuildCampaigns });
      return null;
    }
    const h = renderDom(<H />);
    act(() => api.set((b) => ({ ...b, name: 'TEST B' }))); // a step taken while in the campaign
    act(() => api.set((b) => ({ ...b, campaignIds: [] }), { record: false })); // the leave: not a step
    act(() => api.undo());
    expect(api.state.name, 'the undo undid the rename').toBe('TEST A');
    expect(api.state.campaignIds, 'and left the campaign left').toEqual([]);
    act(() => api.redo());
    expect([api.state.name, api.state.campaignIds]).toEqual(['TEST B', []]);
    h.stop();
  });
});

describe('what Leave asks', () => {
  it('names the character, says only it leaves, and how — and where — to come back', () => {
    const q = leaveCampaignQuestion(A, 'TEST Kyra');
    expect(q.title).toBe(`Leave “${A.name}”?`);
    expect(String(q.message)).toContain('TEST Kyra leaves this campaign');
    expect(String(q.message)).toContain('enter the code from your GM in this character’s Setup → Campaigns');
    expect(q.danger).toBe(true);
    expect(String(leaveCampaignQuestion(A, '  ').message)).toContain('This character leaves');
  });
  it('a GM is told the campaign itself stays', () => {
    expect(String(leaveCampaignQuestion(G, 'TEST Kyra').message)).toContain('The campaign itself stays');
  });
});

describe('the Setup → Campaigns card', () => {
  /** `onLeave: null` mounts it as a GM's rebuild of a player's character does: no leave handler. */
  async function mountCard(campaignIds: string[], onLeave: ReturnType<typeof vi.fn> | null = vi.fn()) {
    saveCampaigns([A, B, G]);
    const { CampaignAttachCard, useBuilderActions } = await import('../src/builder/shared');
    const seen: { build: BuildState | null } = { build: null };
    function Harness() {
      const [build, setBuild] = useState<BuildState>(() => ({ ...emptyBuild(), name: 'TEST Kyra', campaignIds }));
      seen.build = build;
      const actions = useBuilderActions(setBuild, db);
      return <CampaignAttachCard build={build} actions={actions} content={db} onLeaveCampaign={onLeave ?? undefined} />;
    }
    const el = render(<Harness />);
    await flush(1);
    return { el, onLeave: onLeave ?? vi.fn(), seen };
  }
  function joinWith(el: HTMLElement, code: string) {
    const input = el.querySelector('input[aria-label="Campaign code"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, code);
    act(() => void input.dispatchEvent(new Event('input', { bubbles: true })));
    click([...el.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Join')!);
  }
  const leaveButton = (el: HTMLElement, name: string) => {
    const b = el.querySelector(`button[aria-label="Leave “${name}”"]`);
    if (!b) throw new Error(`no Leave button for ${name} — card says: ${el.textContent}`);
    return b;
  };

  it('lists only this character’s campaign, with no on/off chip', async () => {
    // MUTATION: map `memberships` instead of `inCampaigns` in CampaignAttachCard and this fails — the
    // other two campaigns of the account come back on this character.
    const { el } = await mountCard(['camp-b']);
    expect(el.textContent).toContain(B.name);
    expect(el.textContent).not.toContain(A.name);
    expect(el.textContent).not.toContain(G.name);
    expect(el.querySelector('.cmp-in-list .inv-toggle'), 'no toggle: leaving goes through the question').toBeNull();
    expect(el.querySelector('input[aria-label="Campaign code"]'), 'joining with the code is still there').not.toBeNull();
  }, 120_000); // first import of the Builder under full-suite load

  it('a character in no campaign shows none, just the join row', async () => {
    const { el } = await mountCard([]);
    for (const m of [A, B, G]) expect(el.textContent).not.toContain(m.name);
    expect(el.querySelector('input[aria-label="Campaign code"]')).not.toBeNull();
  });

  it('Leave asks first: Cancel changes nothing, yes takes the campaign off this character', async () => {
    const { el, onLeave } = await mountCard(['camp-b', 'camp-g']);
    click(leaveButton(el, B.name));
    await flush(1);
    expect(dialog()?.textContent).toContain(`Leave “${B.name}”?`);
    expect(dialog()?.textContent).toContain('TEST Kyra leaves this campaign');
    click(dialogButton('.btn-ghost'));
    await flush();
    expect(onLeave).not.toHaveBeenCalled();
    expect(el.textContent).toContain(B.name);

    click(leaveButton(el, B.name));
    await flush(1);
    click(dialogButton('.btn-danger'));
    await flush();
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(onLeave).toHaveBeenCalledWith('camp-b');
    expect(el.textContent).not.toContain(B.name);
    expect(el.textContent, 'the other campaign stays').toContain(G.name);
  });

  it('a GM’s character can leave too (the campaign stays)', async () => {
    const { el, onLeave } = await mountCard(['camp-g']);
    click(leaveButton(el, G.name));
    await flush(1);
    expect(dialog()?.textContent).toContain('The campaign itself stays');
    click(dialogButton('.btn-danger'));
    await flush();
    expect(onLeave).toHaveBeenCalledWith('camp-g');
  });

  it('a GM rebuilding a player’s character (no leave handler) gets no Leave button and no join row', async () => {
    // MUTATION: render the Leave button without `canLeave` and this fails — the GM could take a player
    // out of a campaign, one run by another GM included (it shows there as just "Campaign").
    const { el } = await mountCard(['camp-b', 'camp-x'], null);
    expect(el.textContent).toContain(B.name);
    expect(el.textContent, 'the unknown campaign still shows, under the placeholder name').toContain('Campaign');
    expect(el.querySelector('.cmp-leave-btn')).toBeNull();
    // MUTATION: drop `!!onLeaveCampaign &&` before the join row and this fails — a code typed there put
    // the GM's own account, and the player's character, in that campaign (final check, 2026-10-21).
    expect(el.querySelector('input[aria-label="Campaign code"]'), 'nothing to join from a GM’s rebuild').toBeNull();
  });

  it('a GM rebuilding a player’s character that is in no campaign shows no card at all', async () => {
    const { el } = await mountCard([], null);
    expect(el.textContent).toBe('');
  });

  it('a code for a campaign this character is already in says so — no default-rules question again', async () => {
    srv.campaign = { id: 'camp-b', code: 'BBB234', ownerId: 'gm-1', name: B.name, description: '', defaults: { mythicEnabled: true } };
    const { el, seen } = await mountCard(['camp-b']);
    joinWith(el, 'BBB234');
    await flush();
    expect(dialog(), 'no "Use … default rules?" question (it would reset its rules and books)').toBeNull();
    expect(el.textContent).toContain(`This character is already in “${B.name}”.`);
    expect(seen.build?.campaignIds).toEqual(['camp-b']);
  });

  it('a campaign the account is already in joins offline (a GM’s own character), and keeps the GM role', async () => {
    srv.campaign = null; // the server cannot be reached
    const { el, seen } = await mountCard([]);
    joinWith(el, 'GGG234');
    await flush();
    expect(seen.build?.campaignIds).toEqual(['camp-g']);
    expect(el.textContent).toContain(G.name);
    expect(JSON.parse(localStorage.getItem('pf2e-codex.campaigns') ?? '[]')).toEqual([A, B, G]);
  });

  it('a campaign the server says is gone does not join from the copy on this device', async () => {
    // MUTATION: drop `|| res.notFound` from join()'s first check and this fails — a deleted campaign was
    // put back on the character from the stale copy in this device's list (final check, 2026-10-21).
    srv.notFound = true;
    const { el, seen } = await mountCard([]);
    joinWith(el, 'GGG234');
    await flush();
    expect(el.textContent).toContain('TEST no such campaign');
    expect(seen.build?.campaignIds).toEqual([]);
  });

  it('a GM’s own code on a device whose list has not synced yet joins as GM, not as player', async () => {
    // MUTATION: store `role: 'player'` again in join() and this fails — the GM lost their own campaign's
    // GM tools and its Leave question said a player's text (final check, 2026-10-21).
    srv.userId = 'TEST-user-gm';
    srv.campaign = { id: 'camp-new', code: 'NEW234', ownerId: 'TEST-user-gm', name: 'TEST Fresh Table', description: '', defaults: {} };
    const { el, seen } = await mountCard([]);
    saveCampaigns([A]); // this device knows only another campaign
    joinWith(el, 'NEW234');
    await flush();
    expect(seen.build?.campaignIds).toEqual(['camp-new']);
    const stored = JSON.parse(localStorage.getItem('pf2e-codex.campaigns') ?? '[]') as CampaignMembership[];
    expect(stored.find((m) => m.id === 'camp-new')?.role).toBe('gm');

    srv.campaign = { id: 'camp-p', code: 'PPP234', ownerId: 'TEST-user-other-gm', name: 'TEST Their Table', description: '', defaults: {} };
    joinWith(el, 'PPP234');
    await flush();
    const after = JSON.parse(localStorage.getItem('pf2e-codex.campaigns') ?? '[]') as CampaignMembership[];
    expect(after.find((m) => m.id === 'camp-p')?.role, 'someone else’s campaign: player').toBe('player');
  });

  it('a GM’s own campaign stored as player gets its GM role back from the code — in it already, or joining', async () => {
    // MUTATION: drop the `list = have.map(...)` repair in join() and this fails — the old join stored a GM
    // as 'player', the local copy wins the cloud merge, and nothing ever put it back (final check, 2026-10-21).
    srv.userId = 'TEST-user-gm';
    srv.campaign = { id: 'camp-g', code: 'GGG234', ownerId: 'TEST-user-gm', name: G.name, description: '', defaults: {} };
    const role = () => (JSON.parse(localStorage.getItem('pf2e-codex.campaigns') ?? '[]') as CampaignMembership[]).find((m) => m.id === 'camp-g')?.role;

    const inIt = await mountCard(['camp-g']);
    saveCampaigns([A, B, { ...G, role: 'player' }]);
    joinWith(inIt.el, 'GGG234');
    await flush();
    expect(inIt.el.textContent).toContain(`This character is already in “${G.name}”.`);
    expect(role(), 'already in it: the role is repaired anyway').toBe('gm');
    act(() => live!.unmount());
    live = null;
    inIt.el.remove();

    const joining = await mountCard([]);
    saveCampaigns([A, B, { ...G, role: 'player' }]);
    joinWith(joining.el, 'GGG234');
    await flush();
    expect(joining.seen.build?.campaignIds).toEqual(['camp-g']);
    expect(role(), 'joining: the role is repaired').toBe('gm');
  });

  it('signed out: no join row (a good code would read as "no campaign"), a note to sign in instead', async () => {
    // MUTATION: gate the join row on `onLeaveCampaign` instead of `canLeave` and this fails (final check,
    // 2026-10-21: campaigns are readable signed in only, so the lookup came back "No campaign with that code").
    srv.status = 'signed-out';
    const { el } = await mountCard(['camp-b']);
    expect(el.textContent).toContain(B.name);
    expect(el.querySelector('input[aria-label="Campaign code"]')).toBeNull();
    expect(el.textContent).toContain('Sign in to leave or join a campaign.');
    act(() => live!.unmount());
    live = null;
    el.remove();
    const none = await mountCard([]);
    expect(none.el.textContent, 'signed out and in no campaign: no card').toBe('');
  });

  it('an unknown code while offline shows the server’s error and joins nothing', async () => {
    const { el, seen } = await mountCard([]);
    joinWith(el, 'ZZZ999');
    await flush();
    expect(el.textContent).toContain('TEST offline');
    expect(seen.build?.campaignIds).toEqual([]);
  });

  it('a GM pasting their own code online keeps their GM membership (never downgraded to player)', async () => {
    srv.campaign = { id: 'camp-g', code: 'GGG234', ownerId: 'me', name: G.name, description: '', defaults: {} };
    const { el, seen } = await mountCard([]);
    joinWith(el, 'GGG234');
    await flush();
    expect(seen.build?.campaignIds).toEqual(['camp-g']);
    const stored = JSON.parse(localStorage.getItem('pf2e-codex.campaigns') ?? '[]') as CampaignMembership[];
    expect(stored.find((m) => m.id === 'camp-g')?.role).toBe('gm');
    expect(srv.refreshCampaignHomebrew, 'nothing new joined, nothing to pull').not.toHaveBeenCalled();
  });
});

describe('the phone Campaigns page', () => {
  it('lists a player’s campaign only while one of their characters is in it, and has no character-less join', async () => {
    window.matchMedia = ((q: string) => ({
      matches: /max-width:\s*(720|768)px/.test(q),
      media: q,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
    saveCampaigns([A, B, G]);
    const { CampaignsPage } = await import('../src/sheet/CampaignsPage');
    const el = render(
      <CampaignsPage
        content={db}
        onClose={() => undefined}
        onOpenRoster={() => undefined}
        onOpenHomebrew={() => undefined}
        characters={[{ id: 'c1', name: 'TEST Kyra', campaignIds: ['camp-b'] }]}
        modes={{}}
        onSaveMode={() => undefined}
        onDeleteMode={() => undefined}
      />,
    );
    await flush();
    expect(el.textContent, 'a character is in it').toContain(B.name);
    expect(el.textContent, 'the campaign you run').toContain(G.name);
    expect(el.textContent, 'no character is in it: hidden (never deleted)').not.toContain(A.name);
    expect(JSON.parse(localStorage.getItem('pf2e-codex.campaigns') ?? '[]')).toEqual([A, B, G]);
    expect(el.querySelector('input[aria-label="Campaign share code"]'), 'joining is per character now').toBeNull();
    expect(el.textContent).toContain('enter your GM’s code in a character’s Setup → Campaigns');
  }, 120_000);
});

describe('the Party page', () => {
  it('asks the same question before leaving, for a GM’s character too', async () => {
    const { PartyPage } = await import('../src/sheet/PartyPage');
    const onLeave = vi.fn();
    const el = render(<PartyPage content={db} campaigns={[G]} characterName="TEST Kyra" onClose={() => undefined} onLeave={onLeave} />);
    const btn = [...el.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Leave campaign'));
    expect(btn, 'a GM’s character has a Leave button now that the card has no toggle').toBeDefined();
    click(btn!);
    await flush(1);
    expect(dialog()?.textContent).toContain('TEST Kyra leaves your campaign’s party');
    click(dialogButton('.btn-ghost'));
    await flush();
    expect(onLeave).not.toHaveBeenCalled();
    click(btn!);
    await flush(1);
    click(dialogButton('.btn-danger'));
    await flush();
    expect(onLeave).toHaveBeenCalledWith('camp-g');
  });
});

describe('App wiring', () => {
  it('both doors hand App the id of the character that is leaving', () => {
    // Without the id App cannot tell which character leaves, and the old "every character" leave is back.
    const app = readFileSync(resolve(__dirname, '..', 'src/App.tsx'), 'utf8');
    expect(app).toContain('onLeaveCampaign={(campaignId) => leaveCampaign(campaignId, editing?.id)}');
    expect(app).toContain('onLeaveCampaign={(campaignId) => leaveCampaign(campaignId, active.id)}');
    expect(app).toContain('const leaveCampaign = (campaignId: string, charId: string | undefined) => {');
    expect(app).toContain('const next = leaveCampaignFor(rosterRef.current, before, charId, campaignId);');
  });
  it('the roster’s undo keeps campaigns, and hands over the memberships once they are known', () => {
    // test/campaign-leave-app.test.tsx runs the undo legs in the real App; this pins the memberships it
    // hands over, which the delete-undone case needs (no App test deletes a character).
    const app = readFileSync(resolve(__dirname, '..', 'src/App.tsx'), 'utf8');
    expect(app).toContain("keep: (next, present) => keepRosterCampaigns(next, present, auth.status !== 'signed-in' || hasSyncedOnce() ? loadCampaigns() : null),");
  });
});
