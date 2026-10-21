/*
 * The two campaign server calls the per-character campaign rules lean on (2026-10-21):
 * - deleteCampaign must not read a delete the server's row rules silently dropped (anyone but the campaign's
 *   owner) as done: CampaignsPage then marks the campaign deleted for good on every device of the account.
 *   Nor one sent with no signed-in user: then nothing is found either way.
 * - fetchOwnedCampaignIds must answer "unknown" on any doubt: App's launch cleanup removes nothing then.
 * All names are synthetic.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Answer = { data: unknown; error: unknown };
const sb = vi.hoisted(() => ({
  user: 'u-syn' as string | null,
  /** What getUser reports with no user (offline, a missing session), or null. */
  authError: null as null | { name: string; message: string },
  answers: [] as Answer[],
  calls: [] as string[],
}));
vi.mock('../src/data/supabase', () => {
  // A query chain that records each step and, when awaited, resolves to the next planted answer.
  const chain = (): unknown =>
    new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'then') return (res: (v: Answer) => void) => res(sb.answers.shift() ?? { data: null, error: null });
          return (...args: unknown[]) => {
            sb.calls.push(`${String(prop)}(${args.map((a) => JSON.stringify(a)).join(',')})`);
            return chain();
          };
        },
      },
    );
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: sb.user ? { id: sb.user } : null }, error: sb.user ? null : sb.authError }) },
      from: (t: string) => {
        sb.calls.push(`from(${JSON.stringify(t)})`);
        return chain();
      },
    },
    isCloudConfigured: true,
    isCloudSyncEnabled: true,
  };
});

import { deleteCampaign, fetchOwnedCampaignIds } from '../src/data/campaigns';

/** The answers to the next awaited queries, in order. */
const plant = (...answers: Answer[]) => {
  sb.answers = answers;
  sb.calls = [];
};

beforeEach(() => {
  sb.user = 'u-syn';
  sb.authError = null;
});

describe('deleteCampaign', () => {
  it('not signed in for real (a login that ran out): no delete is sent, and it is an error', async () => {
    // A checker's finding, 2026-10-21: with no user the delete and the lookup both find nothing, and a
    // running campaign read as "already gone". MUTATION: drop the getUser() login check and this fails.
    sb.user = null;
    plant({ data: [], error: null }, { data: null, error: null });
    expect(await deleteCampaign('camp-syn')).toEqual({ ok: false, error: 'Sign in to use campaigns.' });
    expect(sb.calls).toEqual([]);
  });

  it('the login check’s own error is shown — offline is not "sign in" — and still nothing is sent', async () => {
    // A checker's finding, 2026-10-21. MUTATION: answer 'Sign in to use campaigns.' for every missing user
    // and this fails — a signed-in GM, offline, was told to sign in.
    sb.user = null;
    sb.authError = { name: 'AuthRetryableFetchError', message: 'Failed to fetch' };
    plant({ data: [], error: null }, { data: null, error: null });
    expect(await deleteCampaign('camp-syn')).toEqual({ ok: false, error: 'Failed to fetch' });
    sb.authError = { name: 'AuthSessionMissingError', message: 'Auth session missing!' };
    expect(await deleteCampaign('camp-syn')).toEqual({ ok: false, error: 'Your session expired — sign in again.' });
    expect(sb.calls).toEqual([]);
  });

  it('a delete the server dropped while the campaign is still there is an error, not a success', async () => {
    plant({ data: [], error: null }, { data: { id: 'camp-syn' }, error: null });
    // MUTATION: drop the `if (still.data)` refusal and this reads ok — the player's copy got a delete mark.
    expect(await deleteCampaign('camp-syn')).toEqual({ ok: false, error: 'You can only delete a campaign you run.' });
    expect(sb.calls).toEqual([
      'from("campaigns")', 'delete()', 'eq("id","camp-syn")', 'select("id")',
      'from("campaigns")', 'select("id")', 'eq("id","camp-syn")', 'maybeSingle()',
    ]);
    plant({ data: null, error: null }, { data: { id: 'camp-syn' }, error: null });
    expect((await deleteCampaign('camp-syn')).ok).toBe(false);
    plant({ data: [], error: null }, { data: null, error: { message: 'offline' } });
    expect((await deleteCampaign('camp-syn')).ok, 'the lookup failed: not known to be gone').toBe(false);
  });

  it('a campaign already gone (deleted on another device, or a lost answer) counts as deleted', async () => {
    plant({ data: [], error: null }, { data: null, error: null });
    // MUTATION: refuse every 0-row delete and this fails — the GM's retry said "only a campaign you run"
    // and the dead campaign stayed in his list for good.
    expect(await deleteCampaign('camp-syn')).toEqual({ ok: true, value: null });
  });

  it('a delete that removed the row succeeds with no lookup; a server error fails', async () => {
    plant({ data: [{ id: 'camp-syn' }], error: null });
    expect(await deleteCampaign('camp-syn')).toEqual({ ok: true, value: null });
    expect(sb.calls).toEqual(['from("campaigns")', 'delete()', 'eq("id","camp-syn")', 'select("id")']);
    plant({ data: null, error: { message: 'boom' } });
    expect((await deleteCampaign('camp-syn')).ok).toBe(false);
  });
});

describe('fetchOwnedCampaignIds', () => {
  it('lists the ids the signed-in account owns', async () => {
    sb.user = 'u-syn';
    plant({ data: [{ id: 'a' }, { id: 'b' }], error: null });
    expect(await fetchOwnedCampaignIds()).toEqual({ ok: true, value: ['a', 'b'] });
    expect(sb.calls).toContain('eq("owner_id","u-syn")');
  });

  it('signed out, a server error or a missing list is "unknown", never an empty list', async () => {
    sb.user = null;
    plant({ data: [], error: null });
    expect((await fetchOwnedCampaignIds()).ok).toBe(false);
    sb.user = 'u-syn';
    plant({ data: null, error: { message: 'offline' } });
    expect((await fetchOwnedCampaignIds()).ok).toBe(false);
    plant({ data: null, error: null });
    expect((await fetchOwnedCampaignIds()).ok).toBe(false);
  });
});
