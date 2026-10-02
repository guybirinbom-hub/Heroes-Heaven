/*
 * G8 settle round 4 (2026-10-01): src/data/campaignHomebrew.ts accountStateHere — the one answer to "is this
 * device signed in, positively signed out, or without a cloud at all?" that the Homebrew import's UNKNOWN
 * check reads (src/sheet/HomebrewPage.tsx campaignHomebrewUnknown). Signed in, the import waits for this
 * session's first cloud pull; signed out or with no cloud, this device's data is the whole truth.
 *
 * The trap it closes: an auth client that cannot answer — an expired token it couldn't refresh offline,
 * which supabase-js reports as "no session" WITH an error — must NOT read as signed out. The app is still
 * signed in, and a device that never synced this session would import on its unsynced, empty membership
 * list (the refuter's probe P1). All names are synthetic.
 */
import { describe, expect, it, vi } from 'vitest';

const sb = vi.hoisted(() => ({ client: null as null | { auth: { getSession: () => Promise<unknown> } } }));
vi.mock('../src/data/supabase', () => ({
  get supabase() {
    return sb.client;
  },
  isCloudConfigured: true,
  isCloudSyncEnabled: true,
}));
vi.mock('../src/data/cloudSync', () => ({ hasSyncedOnce: () => true }));

import { accountStateHere } from '../src/data/campaignHomebrew';

const answers = (getSession: () => Promise<unknown>) => (sb.client = { auth: { getSession } });

describe('accountStateHere', () => {
  it('with no cloud configured it is "no-cloud"', async () => {
    sb.client = null;
    // MUTATION PROOF (tried 2026-10-01, round 4): `if (!client) return 'no-cloud';` → `'signed-out'` —
    //   AssertionError: expected 'signed-out' to be 'no-cloud'
    expect(await accountStateHere()).toBe('no-cloud');
  });

  it('a session is "signed-in"; no session and no error is "signed-out"', async () => {
    answers(async () => ({ data: { session: { user: { id: 'u-syn' } } }, error: null }));
    expect(await accountStateHere()).toBe('signed-in');
    answers(async () => ({ data: { session: null }, error: null }));
    // MUTATION PROOF (tried 2026-10-01, round 4): answer 'signed-in' whenever there is a client —
    //   AssertionError: expected 'signed-in' to be 'signed-out'
    expect(await accountStateHere()).toBe('signed-out');
  });

  it('an auth client that cannot answer is NOT signed out: no session with an error, or a throw', async () => {
    // supabase-js getSession with an expired token it could not refresh (offline): no session, an error.
    answers(async () => ({ data: { session: null }, error: { name: 'AuthRetryableFetchError', message: 'Failed to fetch' } }));
    // MUTATION PROOF (each tried 2026-10-01, round 4) in accountStateHere — drop `!res.error &&`:
    //   AssertionError: expected 'signed-out' to be 'signed-in'
    expect(await accountStateHere()).toBe('signed-in');
    answers(async () => {
      throw new Error('Synthetic auth failure');
    });
    // drop `!!res &&` (a throw read as no session): TypeError: Cannot read properties of null (reading 'error')
    expect(await accountStateHere()).toBe('signed-in');
  });
});
