import { describe, expect, it, vi } from 'vitest';

/**
 * fetchParty's ANSWER, at the data layer.
 *
 * "Couldn't read the party" and "the party is empty" used to arrive as the same value — `[]` — and
 * the tracker's party bridge mirrors that list: one refused or dropped request and every mirrored PC
 * was pruned, taking the GM's per-player notes, turn history and stat overrides with it. The three
 * answers have to stay distinguishable at the source; everything above depends on it.
 */

const db = vi.hoisted(() => ({ result: { data: null as unknown, error: null as unknown } }));

vi.mock('../src/data/supabase', () => {
  const q = {
    select: () => q,
    eq: () => q,
    order: () => Promise.resolve(db.result),
  };
  const channel = {
    on() {
      return channel;
    },
    subscribe(cb?: (status: string) => void) {
      cb?.('SUBSCRIBED');
      return channel;
    },
  };
  return { supabase: { from: () => q, channel: () => channel, removeChannel: () => undefined }, isCloudSyncEnabled: true };
});

import { fetchParty, subscribeParty } from '../src/data/party';

describe('fetchParty', () => {
  it('answers null when the read fails, and a list when it succeeds', async () => {
    // tracker 2026-09-15: party bridge
    // Without the fix (`if (error || !data) return []`):
    //   AssertionError: expected [] to be null
    db.result = { data: null, error: { message: 'TypeError: Failed to fetch' } };
    expect(await fetchParty('camp-1')).toBeNull();

    db.result = { data: [{ owner_id: 'owner-a', char_id: 'char-a', name: 'Ayla Brightwood', summary: {} }], error: null };
    expect(await fetchParty('camp-1')).toHaveLength(1);

    // A read that SUCCEEDS with nobody in it is a real answer, and must stay one — a campaign whose
    // last player left has to be able to prune.
    db.result = { data: [], error: null };
    expect(await fetchParty('camp-1')).toEqual([]);
  });
});

describe('subscribeParty', () => {
  it('pulls the party on every successful (re)join', () => {
    // tracker 2026-09-15: party bridge — a read that failed got no retry at all: the seam fetches
    // once per mount and this channel only fired on someone else's write, so an offline GM stayed on
    // a stale party (and the "couldn't load" notice) until they left the campaign and came back.
    // Without the fix (a bare `.subscribe()`):
    //   AssertionError: expected +0 to be 1
    let pulls = 0;
    const unsub = subscribeParty('camp-1', () => {
      pulls++;
    });
    expect(pulls).toBe(1);
    unsub();
  });
});
