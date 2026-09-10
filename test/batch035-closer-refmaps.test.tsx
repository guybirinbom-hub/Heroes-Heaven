// @vitest-environment jsdom
/*
 * BATCH 035 — CLOSER, the gate-red round.
 *
 * The red round wrote the printed entry onto 24 records that shipped with nothing a player could
 * read. Ten of those rows landed in FOUR REFERENCE BUCKETS — arcaneSchool, fatalMethod,
 * grimFascination, hybridStudy — and `test/integrity-sweeps.test.ts` "every backfilled field is read
 * in a file that knows its collection" went red on all four at once: not one file under src/ so much
 * as NAMED any of them, so the prose was landing where no screen could ever show it.
 *
 * That is a real hole and it was pre-existing — 43 records ship in those buckets, 27 arcane schools
 * among them, and only a backfill row on the pair made the sweep look. grimFascination and
 * hybridStudy have no classFeatures twin at all, so nothing anywhere carried their text.
 *
 * The fix is the picker that already exists for exactly this: RichEditor's REF_MAPS, "Content maps a
 * description link can point at — anything the user might want a popup for". Four entries added; a
 * player can now search a school, a fatal method, a grim fascination or a hybrid study by name and
 * link to its description, which renders through the same DescBody popup as every other ref link.
 *
 * These tests are NEW (no flip, no settle, no comparer teach), and they assert the DELIVERY, not the
 * list: the record has to reach the picker's index with its text, which is the thing the sweep was
 * really asking about.
 */
import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { ContentContext } from '../src/sheet/ContentContext';
import { RefSearchModal, type RefTarget } from '../src/sheet/RichEditor';
import { content } from './_content';
import { renderDom } from './_render';

const db = content();

/** Type into the picker's search box the way React sees a real keystroke. */
function search(host: HTMLElement, text: string) {
  const input = host.querySelector('input') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function rows(host: HTMLElement) {
  return [...host.querySelectorAll('.ref-search-row')].map((r) => ({
    name: r.querySelector('.ref-search-name')?.textContent ?? '',
    kind: r.querySelector('.ref-search-kind')?.textContent ?? '',
    node: r,
  }));
}

describe('batch 035 closer — the four subclass-option reference buckets reach the description-link picker', () => {
  for (const [name, kind, key] of [
    ['Twofold Tine', 'Hybrid study', 'hybridStudy'],
    ['School of Keen Inquiry', 'Arcane school', 'arcaneSchool'],
    ['Reaper', 'Fatal method', 'fatalMethod'],
  ] as const) {
    it(`${name} is searchable in the picker and links to the ${kind} record`, () => {
      const picked: RefTarget[] = [];
      const { host, click, stop } = renderDom(
        <ContentContext.Provider value={db}>
          <RefSearchModal onPick={(t) => picked.push(t)} onClose={() => undefined} />
        </ContentContext.Provider>,
      );
      try {
        search(host, name);
        const hit = rows(host).find((r) => r.name === name && r.kind === kind);
        expect(hit, `${name} is missing from the picker (kinds offered: ${rows(host).map((r) => r.kind).join(', ')})`).toBeTruthy();
        click(hit!.node);
        expect(picked).toHaveLength(1);
        expect(picked[0].key).toBe(key);
        expect(picked[0].name).toBe(name);
      } finally {
        stop();
      }
    });
  }

  it('grim fascinations are offered too, and every record the picker offers carries text to show', () => {
    const { host, stop } = renderDom(
      <ContentContext.Provider value={db}>
        <RefSearchModal onPick={() => undefined} onClose={() => undefined} />
      </ContentContext.Provider>,
    );
    try {
      /* "Flesh", not "Blood": the picker caps at 60 rows and the four buckets sort last, so a
       * fascination named after a common word ("Blood" matches 220 records) falls off the end. That
       * cap is the picker's, not this lane's. */
      search(host, 'Flesh');
      const hit = rows(host).find((r) => r.kind === 'Grim fascination' && r.name === 'Flesh');
      expect(hit).toBeTruthy();
    } finally {
      stop();
    }
    /*
     * The picker's own gate is `e.name && e.description` — a record with no text is not offered, so
     * an entry in REF_MAPS is only worth anything if the bucket's records actually carry prose. Every
     * record of all four buckets does, which is what the red round's rows were for.
     */
    const written: [string, string[]][] = [
      ['arcaneSchool', ['school-of-breathtaking-influence', 'school-of-keen-inquiry', 'school-of-nexian-spaces', 'school-of-quantic-control']],
      ['fatalMethod', ['puppeteer', 'reaper']],
      ['grimFascination', ['blood', 'flesh', 'bone', 'spirit']],
      ['hybridStudy', ['twofold-tine', 'volatile-spark']],
    ];
    for (const [bucket, ids] of written) {
      const map = (db as unknown as Record<string, Record<string, { name?: string; description?: string }>>)[bucket];
      expect(Object.keys(map ?? {}).length, bucket).toBeGreaterThan(0);
      const dropped = ids.filter((id) => !map?.[id]?.name || !map?.[id]?.description);
      expect(dropped, `${bucket} records the red round wrote text for that the picker would still drop`).toEqual([]);
    }
  });
});
