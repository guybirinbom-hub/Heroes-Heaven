import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SavedChar } from '../src/data/storage';
import type { PartySummary } from '../src/sheet/partySummary';

/*
 * F1 (2026-10-09) — ONE PUBLISH LANE PER (campaign, character).
 *
 * A GM edit is judged against what the player's published row really holds. Two upserts in flight
 * for one character could land in either order, and the OLDER landing last put an older sheet on the
 * row the next GM edit is judged against; a failure swallowed into "done" made a publish that never
 * landed look in sync. So publishes for one key go out one at a time, in call order, a waiting one is
 * replaced by a newer one ('superseded'), a failure says 'failed', and an unpublish takes the same lane.
 *
 * MUTATION (run 2026-10-09): run the upserts without the lane — `return run().then((ok) => (ok ? 'ok' :
 * 'failed'), () => 'failed');` as the first line of `enqueue` in src/data/party.ts — and three legs fail —
 *   AssertionError: one upsert on the wire at a time: expected [ [Function], [Function], [Function] ] to have a length of 1 but got 3
 *   AssertionError: expected 'first' to be 'second'
 *   AssertionError: the delete waits for the upsert on the wire: expected [ 'delete' ] to deeply equal []
 */
const server = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  /** Upserts held on the wire, released in any order by the leg. */
  held: [] as (() => void)[],
  hold: false,
  failNext: false,
  log: [] as string[],
  /** `gm_character_edits`, campaign|char → its `updated_at` (A3: the conditioned delete). The `eq` filters
   *  compare by STRING, so a stamp spelled differently from how the column holds it never matches — the
   *  premise A3's fallback exists for — while the column's own spelling (the read-back's) does. */
  gmEdits: new Map<string, string>(),
  /** Runs once, right after the read-back answers: a newer GM push landing in that round trip. */
  afterReadBack: null as (() => void) | null,
}));

vi.mock('../src/data/supabase', () => {
  /** `gm_character_edits`: select / delete with eq filters, as deleteGmEdit chains them. */
  function edits() {
    const where: Record<string, unknown> = {};
    let del = false;
    const match = () =>
      [...server.gmEdits.entries()]
        .map(([k, updated_at]) => ({ campaign_id: k.split('|')[0], char_id: k.split('|')[1], updated_at }))
        .filter((r) => Object.entries(where).every(([c, v]) => (r as Record<string, unknown>)[c] === v));
    const q = {
      delete: () => {
        del = true;
        return q;
      },
      select: () => q,
      eq: (c: string, v: unknown) => {
        where[c] = v;
        return q;
      },
      maybeSingle: () => {
        const row = match()[0] ?? null;
        const hook = server.afterReadBack;
        server.afterReadBack = null;
        hook?.(); // the GM's newer upsert lands while the read-back is on its way home
        return Promise.resolve({ data: row, error: null });
      },
      then: (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) => {
        const rows = match();
        if (del) for (const r of rows) server.gmEdits.delete(`${r.campaign_id}|${r.char_id}`);
        return Promise.resolve({ data: rows, error: null }).then(ok, fail);
      },
    };
    return q;
  }
  function from(table: string) {
    if (table === 'gm_character_edits') return edits();
    const q = {
      upsert: (row: Record<string, unknown>) => {
        const land = () => {
          server.row = row;
          server.log.push(`upsert:${(row.sheet as { tag: string }).tag}`);
        };
        if (server.failNext) {
          server.failNext = false;
          return Promise.resolve({ error: { message: 'network' } });
        }
        if (server.hold)
          return new Promise((done) => {
            server.held.push(() => {
              land();
              done({ error: null });
            });
          });
        land();
        return Promise.resolve({ error: null });
      },
      delete: () => q,
      eq: () => {
        return {
          eq: () => {
            server.row = null;
            server.log.push('delete');
            return Promise.resolve({ error: null });
          },
        };
      },
    };
    return q;
  }
  return {
    supabase: {
      from,
      auth: { getSession: async () => ({ data: { session: { user: { id: 'player-1' } } } }) },
    },
    isCloudSyncEnabled: true,
    isCloudConfigured: true,
  };
});

const { deleteGmEdit, publishCharacter, unpublishCharacter } = await import('../src/data/party');
const sheet = (tag: string) => ({ id: 'pc-1', tag }) as unknown as SavedChar;
const summary = {} as PartySummary;
const tick = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  server.row = null;
  server.held = [];
  server.hold = false;
  server.failNext = false;
  server.log = [];
  server.gmEdits.clear();
  server.afterReadBack = null;
});

describe('the publish lane', () => {
  it('a newer publish waits for the one on the wire, a waiting one is superseded, and the server ends on the LAST', async () => {
    server.hold = true;
    const first = publishCharacter('camp', 'pc-1', 'A', summary, sheet('first'));
    await tick();
    const second = publishCharacter('camp', 'pc-1', 'A', summary, sheet('second'));
    const third = publishCharacter('camp', 'pc-1', 'A', summary, sheet('third'));
    await tick();
    expect(server.held, 'one upsert on the wire at a time').toHaveLength(1);
    server.hold = false;
    server.held.shift()!(); // the first lands
    expect(await first).toBe('ok');
    expect(await second, 'replaced before it was sent').toBe('superseded');
    expect(await third).toBe('ok');
    expect((server.row?.sheet as { tag: string }).tag, 'the server ends on the LAST publish').toBe('third');
    expect(server.log).toEqual(['upsert:first', 'upsert:third']);
  });

  it('two publishes, the first held: the server ends on the second', async () => {
    server.hold = true;
    const a = publishCharacter('camp', 'pc-1', 'A', summary, sheet('first'));
    await tick();
    server.hold = false;
    const b = publishCharacter('camp', 'pc-1', 'A', summary, sheet('second'));
    await tick();
    server.held.shift()!();
    expect([await a, await b]).toEqual(['ok', 'ok']);
    expect((server.row?.sheet as { tag: string }).tag).toBe('second');
  });

  it('an upsert error says so', async () => {
    server.failNext = true;
    expect(await publishCharacter('camp', 'pc-1', 'A', summary, sheet('x'))).toBe('failed');
  });

  it('an unpublish queued behind an upsert in flight lands LAST — the row is gone', async () => {
    server.hold = true;
    const up = publishCharacter('camp', 'pc-1', 'A', summary, sheet('late'));
    await tick();
    const down = unpublishCharacter('camp', 'pc-1');
    await tick();
    expect(server.log, 'the delete waits for the upsert on the wire').toEqual([]);
    server.held.shift()!();
    expect([await up, await down]).toEqual(['ok', 'ok']);
    expect(server.log).toEqual(['upsert:late', 'delete']);
    expect(server.row, 'detached: nothing published').toBeNull();
  });

  it('lanes are per (campaign, character): another character is not held up', async () => {
    server.hold = true;
    void publishCharacter('camp', 'pc-1', 'A', summary, sheet('one'));
    void publishCharacter('camp', 'pc-2', 'B', summary, sheet('two'));
    await tick();
    expect(server.held).toHaveLength(2);
  });
});

/*
 * F1 notes A3 — THE CONDITIONED DELETE, AND ITS FALLBACK.
 *
 * The player's app deletes a handled `gm_character_edits` row `where updated_at = <as fetched>`, so a
 * NEWER push of the GM's that replaced it meanwhile survives to be judged. If the filter removes nothing
 * — the stamp spelled one way in the filter and another in the column — the row is read back once:
 * the same push → deleted on the stamp AS THE READ-BACK SPELLED IT; a newer push → left alone.
 *
 * MUTATION (run 2026-10-09): drop the fallback — `return n;` right after the conditioned delete in
 * deleteGmEdit — and this fails —
 *   AssertionError: the filter's spelling is no reason to leave the row: expected +0 to be 1
 */
describe('deleteGmEdit — conditioned on the judged row’s own stamp', () => {
  const STAMP = '2026-10-09T09:01:00.000Z';

  it('deletes the judged row on its stamp', async () => {
    server.gmEdits.set('camp|pc-1', STAMP);
    expect(await deleteGmEdit('camp', 'pc-1', STAMP)).toBe(1);
    expect(server.gmEdits.has('camp|pc-1')).toBe(false);
  });

  // F1 (2026-10-09): the mock's former `stampNeverMatches` flag (no `updated_at` filter ever matched,
  // the column's own spelling included) is gone — the fallback's delete is now conditioned on the
  // read-back's spelling, which a real column matches. String equality is the premise A3 guards.
  it('when the stamp filter is spelled differently, the same push is still deleted (read back, same instant)', async () => {
    server.gmEdits.set('camp|pc-1', '2026-10-09T09:01:00+00:00'); // PostgREST's spelling of the same push
    expect(await deleteGmEdit('camp', 'pc-1', STAMP), "the filter's spelling is no reason to leave the row").toBe(1);
    expect(server.gmEdits.has('camp|pc-1')).toBe(false);
  });

  /*
   * F1 (2026-10-09): the A3 fallback deleted a NEWER GM push that landed between its read-back and its
   * then-unconditioned second delete (refuter probe zz-f1-probe-timing-2). That push was never judged:
   * no apply, no receipt, and his overlay stood down at the player's next publish — his gesture gone
   * with nothing on either screen. The second delete is now conditioned on the read-back's own spelling.
   * MUTATION (run 2026-10-09): drop `.eq('updated_at', stored)` from the second delete in deleteGmEdit —
   *   AssertionError: his newer push survives to be judged: expected undefined to be '2026-10-09T09:02:00+00:00'
   */
  it('the A3 fallback never deletes a newer push that lands after its read-back', async () => {
    server.gmEdits.set('camp|pc-1', '2026-10-09T09:01:00+00:00');
    server.afterReadBack = () => server.gmEdits.set('camp|pc-1', '2026-10-09T09:02:00+00:00'); // his next gesture
    await deleteGmEdit('camp', 'pc-1', STAMP);
    expect(server.gmEdits.get('camp|pc-1'), 'his newer push survives to be judged').toBe('2026-10-09T09:02:00+00:00');
  });

  it('a NEWER push that replaced the row survives to be judged', async () => {
    server.gmEdits.set('camp|pc-1', '2026-10-09T09:05:00.000Z');
    expect(await deleteGmEdit('camp', 'pc-1', STAMP), 'nothing of the newer push is deleted').toBe(0);
    expect(server.gmEdits.get('camp|pc-1')).toBe('2026-10-09T09:05:00.000Z');
  });
});
