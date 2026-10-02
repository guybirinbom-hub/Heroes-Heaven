// @vitest-environment jsdom
/*
 * G8 settle round 2 (2026-10-01): "is this device's campaign homebrew KNOWN for this account?" has ONE
 * answer, storage.ts campaignHbCacheKnown, next to the cache's own reader and writer — and the Homebrew
 * page's import asks it instead of reading the cache's format itself (it used to parse the stored key
 * and compare its stamp in the page).
 *
 * The first half pins the real function against what saveCampaignHbCache writes. The second half wraps
 * it in a spy whose answer a leg can turn around, so only a page that really ASKS it follows the answer:
 * a copy of the check inside the page would read the stored cache and answer the other way.
 * All names are synthetic.
 */
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { HomebrewPage } from '../src/sheet/HomebrewPage';
import {
  CAMPAIGN_HB_CACHE_KEY,
  campaignHbCacheKnown,
  campaignMemberIds,
  loadHomebrewContent,
  saveCampaignHbCache,
  saveCampaigns,
  saveSyncOwner,
} from '../src/data/storage';
import { renderDom } from './_render';
import type { ContentDatabase } from '../src/rules/types';
import type { CampaignMembership } from '../src/data/campaigns';

vi.mock('../src/data/storage', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/data/storage')>();
  return { ...real, campaignHbCacheKnown: vi.fn(real.campaignHbCacheKnown) };
});
const pull = vi.hoisted(() => ({ fn: vi.fn(async (): Promise<boolean> => false) }));
// Signed in, this session's first cloud pull landed: only the campaign homebrew can be unknown here.
vi.mock('../src/data/campaignHomebrew', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/campaignHomebrew')>()),
  sharedSourceCampaigns: vi.fn(async () => null),
  refreshCampaignHomebrew: pull.fn,
  accountStateHere: vi.fn(async () => 'signed-in'),
}));
vi.mock('../src/data/cloudSync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/cloudSync')>()),
  hasSyncedOnce: () => true,
}));

const UID = 'player-uid-syn';
let realKnown: (uid: string | null) => boolean;
const spy = vi.mocked(campaignHbCacheKnown);

beforeAll(async () => {
  realKnown = (await vi.importActual<typeof import('../src/data/storage')>('../src/data/storage')).campaignHbCacheKnown;
});

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  spy.mockReset();
  spy.mockImplementation((uid) => realKnown(uid));
  pull.fn.mockReset();
  pull.fn.mockResolvedValue(false);
});

describe('storage.ts campaignHbCacheKnown', () => {
  const store = (v: unknown) => localStorage.setItem(CAMPAIGN_HB_CACHE_KEY, typeof v === 'string' ? v : JSON.stringify(v));
  const CAMP = (id: string, extra: Partial<CampaignMembership> = {}): CampaignMembership => ({ id, code: 'SYN000', role: 'player', name: `Synthetic ${id}`, ...extra });

  it('is known exactly when saveCampaignHbCache wrote a copy for that account — an empty one included', () => {
    expect(realKnown(UID)).toBe(false); // never pulled here
    saveCampaignHbCache(UID, {});
    // MUTATION PROOF (each tried 2026-10-01): rename the stamp field saveCampaignHbCache writes (`uid` →
    // `owner`) — AssertionError: expected false to be true; drop the stamp comparison from
    // campaignHbCacheKnown — AssertionError: expected true to be false (another account's line)
    expect(realKnown(UID)).toBe(true);
    expect(realKnown('another-uid-syn')).toBe(false);
    saveCampaignHbCache(UID, { 'camp-syn': { name: 'Synthetic Marches', sources: {}, content: {}, updatedAt: '' } });
    expect(realKnown(UID)).toBe(true);
  });

  it('is known only for the player campaigns the copy holds a full read of (settle round 3)', () => {
    // The refuter's case: a campaign joined after the last pull read as known, and the import wrote that
    // campaign GM's ids as the player's own.
    saveSyncOwner(UID);
    saveCampaigns([CAMP('camp-syn-1')]);
    saveCampaignHbCache(UID, {}); // vouches for no campaign
    // MUTATION PROOF (each tried 2026-10-01, round 3) —
    //   campaignHbCacheKnown: `.every((id) => read.includes(id))` → `true`: AssertionError: no read list: expected true to be false
    //   saveCampaignHbCache: drop `pulledFor` from what it writes: AssertionError: read camp-syn-1: expected false to be true
    expect(realKnown(UID), 'no read list').toBe(false);
    saveCampaignHbCache(UID, {}, ['camp-syn-1']);
    expect(realKnown(UID), 'read camp-syn-1').toBe(true);
    saveCampaigns([CAMP('camp-syn-1'), CAMP('camp-syn-2')]); // joined since
    expect(realKnown(UID), 'joined since').toBe(false);
    saveCampaignHbCache(UID, {}, ['camp-syn-1', 'camp-syn-2']);
    expect(realKnown(UID), 'read both').toBe(true);
    saveCampaigns([CAMP('camp-syn-2')]); // left one since: the copy still read every campaign played in
    expect(realKnown(UID), 'left one').toBe(true);
    // GM campaigns, the signed-out Local table and a membership with no id are not read by a pull.
    saveCampaigns([CAMP('camp-syn-2'), CAMP('camp-syn-gm', { role: 'gm' }), CAMP('local', { local: true }), CAMP('')]);
    expect(realKnown(UID), 'only player campaigns a pull reads').toBe(true);
  });

  it('campaignMemberIds is the one membership filter: real ids of that role, once each, sorted', () => {
    // Stored as-is (saveCampaigns itself can't take the null a hand-edited list may hold).
    localStorage.setItem(
      'pf2e-codex.campaigns',
      JSON.stringify([CAMP('camp-syn-b'), CAMP('camp-syn-a'), CAMP('camp-syn-b'), CAMP('camp-syn-gm', { role: 'gm' }), CAMP('local', { local: true }), CAMP(''), null]),
    );
    // MUTATION PROOF (each tried 2026-10-01, round 3) in storage.ts campaignMemberIds — drop `!m.local &&`:
    //   AssertionError: expected [ 'camp-syn-a', 'camp-syn-b', 'local' ] to deeply equal [ 'camp-syn-a', 'camp-syn-b' ];
    //   drop `&& !!m.id`: AssertionError: expected [ '', 'camp-syn-a', 'camp-syn-b' ] to deeply equal [ 'camp-syn-a', 'camp-syn-b' ]
    expect(campaignMemberIds('player')).toEqual(['camp-syn-a', 'camp-syn-b']);
    expect(campaignMemberIds('gm')).toEqual(['camp-syn-gm']);
  });

  it('a missing, unreadable or null copy is unknown, and reading one never throws', () => {
    for (const v of ['{not json', 'null', '"synthetic"', '42', '[]']) {
      store(v);
      expect(realKnown(UID), v).toBe(false);
    }
  });

  it('no account is never known, even beside a copy stamped for no account', () => {
    store({ uid: null, campaigns: {}, pulledFor: [] });
    // MUTATION PROOF (tried 2026-10-01): drop `uid === null ||` —
    //   AssertionError: expected true to be false
    expect(realKnown(null)).toBe(false);
  });

  it('a copy stamped for the account but holding no campaigns object, or no read list, is unknown', () => {
    for (const v of [
      { uid: UID, pulledFor: [] },
      { uid: UID, campaigns: null, pulledFor: [] },
      { uid: UID, campaigns: 'synthetic', pulledFor: [] },
      { uid: UID, campaigns: [], pulledFor: [] },
      { uid: UID, campaigns: {} },
      { uid: UID, campaigns: {}, pulledFor: 'synthetic' },
    ]) {
      store(v);
      // MUTATION PROOF (each tried 2026-10-01; round 3 for the last three) — drop the whole campaigns check:
      // the first fails; drop `!c ||`: the second; drop `typeof c !== 'object' ||`: the third; drop
      // `|| Array.isArray(c)`: the fourth; drop `if (!Array.isArray(read)) return false;`: the fifth and the
      // sixth (no membership here, so nothing is left to check them against) —
      //   AssertionError: {"uid":"player-uid-syn","pulledFor":[]}: expected true to be false   (and the same for the others)
      expect(realKnown(UID), JSON.stringify(v)).toBe(false);
    }
  });
});

describe('the Homebrew import asks campaignHbCacheKnown, never reads the cache itself', () => {
  const PLAYER = { id: 'camp-syn-1', code: 'SYN234', role: 'player' as const, name: 'Synthetic Marches' };
  const SRC = { id: 'hbsrc-syn-ask', name: 'Synthetic Asking' };
  const FEAT = { id: 'syn-ask-feat', name: 'Synthetic Question', homebrewSourceId: SRC.id };
  const file = JSON.stringify({ app: 'heroes-heaven', kind: 'homebrew', version: 1, sources: { [SRC.id]: SRC }, content: { feats: { [FEAT.id]: FEAT } } });
  const dialog = () => document.body.querySelector('.confirm-modal');
  const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

  async function importFile() {
    const r = renderDom(<HomebrewPage content={{} as ContentDatabase} onChanged={() => undefined} onClose={() => undefined} />);
    const input = r.host.querySelector('input[type=file]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File([file], 'picked.json', { type: 'application/json' })] });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();
    const text = dialog()?.textContent ?? '';
    act(() => {
      (dialog()!.querySelector('.confirm-actions button') as HTMLButtonElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await settle();
    r.stop();
    return text;
  }

  it("follows its answer UNKNOWN even when the stored copy is this account's", async () => {
    saveSyncOwner(UID);
    saveCampaigns([PLAYER]);
    saveCampaignHbCache(UID, {}, [PLAYER.id]); // stored for this account, PLAYER read: a page reading it would say known
    spy.mockImplementation(() => false);
    // MUTATION PROOF (tried 2026-10-01): put the old in-page stamp check back in campaignHomebrewUnknown
    // (parse the cache key, compare its uid with loadSyncOwner()) — this leg, the next one and the source
    // check all fail; this one with
    //   AssertionError: expected 'Homebrew importedAdded 1 feat and 1 s…' to contain 'Can\'t import yet'
    expect(await importFile()).toContain("Can't import yet");
    expect(spy).toHaveBeenCalledWith(UID);
    expect(pull.fn).toHaveBeenCalledTimes(1);
    expect(loadHomebrewContent().feats[FEAT.id]).toBeUndefined();
  });

  it('follows its answer KNOWN even when nothing is stored', async () => {
    saveSyncOwner(UID);
    saveCampaigns([PLAYER]);
    spy.mockImplementation(() => true);
    expect(await importFile()).toContain('Homebrew imported');
    expect(spy).toHaveBeenCalledWith(UID);
    expect(pull.fn).not.toHaveBeenCalled();
    expect(loadHomebrewContent().feats[FEAT.id]).toMatchObject(FEAT);
  });

  it("the page's source never names the cache's storage key or its fields", () => {
    const src = readFileSync('src/sheet/HomebrewPage.tsx', 'utf8');
    expect(src).not.toMatch(/CAMPAIGN_HB_CACHE_KEY|campaign-homebrew:v1|pulledFor/);
    expect(src).toMatch(/campaignHbCacheKnown\(loadSyncOwner\(\)\)/);
  });
});
