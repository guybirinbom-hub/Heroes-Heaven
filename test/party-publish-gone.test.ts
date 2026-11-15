import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SavedChar } from '../src/data/storage';
import type { PartySummary } from '../src/sheet/partySummary';

/*
 * A PUBLISH THE SERVER REFUSES FOR GOOD (2026-10-23). A player's character kept sending itself to a
 * campaign its GM had deleted — or one the GM removed the player from — failing quietly on every online /
 * focus / visible. publishCharacter now says WHY with one read of the campaign row, and only two proven
 * answers stop the sending: 'gone' (the campaign foreign key broke AND the signed-in read found no row) and
 * 'refused' (a row rule refused AND the campaign lists this account as removed). Every other failure —
 * a read that fails or throws, a session that ended, a campaign that is there and does not list the player —
 * stays 'failed', which App retries as before. A guess must never say "gone".
 *
 * A fake Supabase client: `server.upsertError` is what the upsert answers; `server.campaign` is what the
 * campaign read answers (a row, null for "no such row", or an error / a throw).
 */
const server = vi.hoisted(() => ({
  upsertError: null as { code?: string; message?: string; details?: string } | null,
  campaign: null as Record<string, unknown> | null,
  readError: null as { code?: string; message?: string } | null,
  readThrows: false,
  /** The session's user id, as getSession answers it — per call, from this queue first. */
  sessions: [] as (string | null)[],
  reads: 0,
}));

vi.mock('../src/data/supabase', () => {
  function from(table: string) {
    if (table === 'campaigns') {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: () => {
          server.reads++;
          if (server.readThrows) return Promise.reject(new Error('network down'));
          return Promise.resolve({ data: server.readError ? null : server.campaign, error: server.readError });
        },
      };
      return q;
    }
    return {
      upsert: () => Promise.resolve({ error: server.upsertError }),
    };
  }
  return {
    supabase: {
      from,
      auth: {
        getSession: async () => {
          const id = server.sessions.length ? server.sessions.shift()! : 'player-1';
          return { data: { session: id ? { user: { id } } : null } };
        },
      },
    },
    isCloudSyncEnabled: true,
    isCloudConfigured: true,
  };
});

const { publishCharacter } = await import('../src/data/party');
const sheet = { id: 'pc-1' } as unknown as SavedChar;
const summary = {} as PartySummary;
const publish = () => publishCharacter('camp-1', 'pc-1', 'TEST Hero', summary, sheet);

const FK = { code: '23503', message: 'insert or update on table "campaign_characters" violates foreign key constraint "campaign_characters_campaign_id_fkey"' };
const RLS = { code: '42501', message: 'new row violates row-level security policy for table "campaign_characters"' };

afterEach(() => {
  server.upsertError = null;
  server.campaign = null;
  server.readError = null;
  server.readThrows = false;
  server.sessions = [];
  server.reads = 0;
});

describe('why a publish failed', () => {
  it('lands: ok, and no read', async () => {
    expect(await publish()).toBe('ok');
    expect(server.reads).toBe(0);
  });

  it('GONE: the campaign key broke and the read found no campaign', async () => {
    server.upsertError = FK;
    server.campaign = null;
    expect(await publish()).toBe('gone');
    expect(server.reads, 'one read').toBe(1);
  });

  it('a foreign key error that is NOT the campaign key (owner_id → auth.users): unknown, and no read', async () => {
    // MUTATION (run 2026-10-23): drop the CAMPAIGN_FK line from whyPublishRefused and this says 'gone'.
    server.upsertError = {
      code: '23503',
      message: 'insert or update on table "campaign_characters" violates foreign key constraint "campaign_characters_owner_id_fkey"',
    };
    server.campaign = null;
    expect(await publish()).toBe('failed');
    expect(server.reads).toBe(0);
  });

  it('the campaign key named only in `details`: still GONE', async () => {
    server.upsertError = { code: '23503', message: 'foreign key violation', details: 'constraint "campaign_characters_campaign_id_fkey"' };
    server.campaign = null;
    expect(await publish()).toBe('gone');
  });

  it('REMOVED: a row rule refused and the campaign lists this player as removed', async () => {
    server.upsertError = RLS;
    server.campaign = { id: 'camp-1', removed: ['someone-else', 'player-1'] };
    expect(await publish()).toBe('refused');
  });

  it('the read FAILS: unknown, never gone', async () => {
    server.upsertError = FK;
    server.readError = { code: '08006', message: 'connection failure' };
    expect(await publish()).toBe('failed');
  });

  it('the read THROWS (offline, a timeout): unknown', async () => {
    server.upsertError = FK;
    server.readThrows = true;
    expect(await publish()).toBe('failed');
  });

  it('the session ended between the send and the read (a signed-out read finds no rows): unknown', async () => {
    server.upsertError = FK;
    server.campaign = null;
    server.sessions = ['player-1', null]; // the send's session, then none
    expect(await publish()).toBe('failed');
  });

  it('another account signed in while the read was on its way: unknown (a checker’s finding)', async () => {
    server.upsertError = RLS;
    server.campaign = { id: 'camp-1', removed: ['player-1'] };
    server.sessions = ['player-1', 'player-1', 'player-2']; // the send, before the read, after it
    expect(await publish()).toBe('failed');
  });

  it('a row rule refused, but the campaign is there and does not list this player: unknown', async () => {
    server.upsertError = RLS;
    server.campaign = { id: 'camp-1', removed: [] };
    expect(await publish()).toBe('failed');
  });

  it('a row rule refused and NO campaign row came back (an expired login reads nothing): unknown, not gone', async () => {
    server.upsertError = RLS;
    server.campaign = null;
    expect(await publish()).toBe('failed');
  });

  it('the campaign key broke but the campaign IS there: unknown', async () => {
    server.upsertError = FK;
    server.campaign = { id: 'camp-1', removed: [] };
    expect(await publish()).toBe('failed');
  });

  it('any other error (a network blip, a 500): unknown, and no read is made', async () => {
    server.upsertError = { message: 'Failed to fetch' };
    expect(await publish()).toBe('failed');
    server.upsertError = { code: '500', message: 'server error' };
    expect(await publish()).toBe('failed');
    expect(server.reads).toBe(0);
  });
});
