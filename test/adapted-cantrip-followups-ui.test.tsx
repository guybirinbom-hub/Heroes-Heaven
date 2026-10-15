// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { Builder } from '../src/builder/Builder';
import { SpellsTab } from '../src/sheet/SpellsTab';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { applyPlayState, initialPlay, preparedCantripKey, setPreparedCantrip, type PlayState } from '../src/rules/play';
import { ownPlacesBeside } from '../src/rules/spellOptions';
import { enabledBookSet } from '../src/rules/sources';
import type { Character, ContentDatabase, SpellcastingEntry } from '../src/rules/types';

/**
 * ADAPTED CANTRIP — the follow-ups to c720191 (2026-10-15), what the player SEES.
 *
 * Print (feat-4474): *"Choose one cantrip from a magical tradition other than your own. If you prepare
 * spells, you can choose this spell when you prepare your cantrips, in addition to your other options. If
 * you have a spell repertoire, replace one of your cantrips known with the chosen spell."*
 *
 * Each leg failed on the code before this file:
 *   1. the cleric's builder card said "your class cantrip budget is one lower" (it is not);
 *   2. a sorcerer's Spells tab marked its adapted cantrip "One too many — … remove one in the builder";
 *   3. re-preparing the opening holding the adapted cantrip, from the Prepare panel, flipped the opening
 *      beside it back from its stand-in to the adapted cantrip;
 *   4. Learn a Spell offered a Flexible Spellcaster cleric the adapted cantrip it already has.
 * test/adapted-cantrip-followups.test.ts holds the engine.
 *
 * Fixtures are synthetic ("TEST …"), never an owner's character.
 */
const db = content();
const gated = content({ trustGate: true });
const CORE = enabledBookSet(undefined);
const noop = () => undefined;
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  for (const n of [...document.body.children]) n.remove();
});
const T = 60_000;
const flat = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

const pc = (d: ContentDatabase, classId: string, level: number, over: Partial<BuildState> = {}): BuildState =>
  ({
    ...emptyBuild(),
    name: 'TEST adapted cantrip',
    level,
    classId,
    subclassId: d.classes[classId]?.subclass?.options[0]?.id ?? null,
    ancestryId: 'human',
    heritageId: 'versatile-human',
    backgroundId: Object.keys(d.backgrounds)[0],
    keyAbility: d.classes[classId]?.keyAbility?.[0] ?? null,
    ...over,
  }) as BuildState;
const withAdapted = (b: BuildState, answer: string): BuildState =>
  ({ ...b, featPicks: { ...b.featPicks, '1:ancestry:0': 'adapted-cantrip' }, featChoices: { ...b.featChoices, '1:ancestry:0': answer } }) as BuildState;
const entryOf = (ch: Character, classId: string): SpellcastingEntry => ch.spellcasting.find((e) => e.id === `${classId}-casting`)!;
const onTradition = (d: ContentDatabase, tradition: string) =>
  Object.values(d.spells)
    .filter((s) => s.rank === 0 && s.rarity === 'common' && CORE.has(s.source?.book ?? '') && s.traditions?.includes(tradition as never))
    .map((s) => s.id)
    .sort();
const nameOf = (id: string) => db.spells[id]!.name;
const PREPARE = 'Manage spells for this session';
const LEARN = 'Learn a Spell (exploration activity)';
const entryBtn = (host: HTMLElement, entryId: string, title: string) =>
  host.querySelector<HTMLButtonElement>(`[data-entry="${entryId}"] button.ms-btn[title="${title}"]`);
/** Every row of an open FilterableSelect, scrolled to the end. */
const rows = (host: HTMLElement) => {
  const list = host.querySelector('.fsel-list');
  for (let i = 0; i < 40 && host.querySelector('.fsel-list .picker-more'); i++)
    act(() => {
      list!.dispatchEvent(new Event('scroll'));
    });
  return [...host.querySelectorAll<HTMLElement>('.fsel-list > .fsel-rowwrap')];
};

describe('1 · the builder card', () => {
  // mutation-proof
  it(
    'a cleric with Adapted Cantrip reads the prepared case, and no "budget is one lower"',
    () => {
      const b = withAdapted(pc(db, 'cleric', 1, { keyAbility: 'wis', cantrips: ['divine-lance', 'stabilize', 'light', 'shield', 'vitality-lash'] }), 'electric-arc');
      const notes = (d: ContentDatabase) => {
        const r = renderDom(<Builder content={d} initial={b} onCancel={noop} onCreate={noop} />);
        try {
          r.click([...r.host.querySelectorAll<HTMLButtonElement>('.lstrip button')].find((x) => flat(x.textContent) === '1') ?? null);
          return [...r.host.querySelectorAll('.choice-inert span')].map((x) => flat(x.textContent)).filter((t) => t.startsWith("Cast as a spell of your class's tradition"));
        } finally {
          r.stop();
        }
      };
      for (const d of [db, gated]) {
        const shown = notes(d);
        expect(shown, d === db ? 'ungated' : 'trust-gated').toHaveLength(1);
        expect(shown[0]).toContain('If you prepare spells, you keep every cantrip opening: this cantrip is one more option when you prepare your cantrips.');
        expect(shown[0]).not.toMatch(/budget is one lower/);
      }
      // The planted bad case: the old note on the record reaches the same card.
      const choice = db.feats['adapted-cantrip'].choice!;
      const saved = choice.note;
      choice.note = 'It REPLACES one of your cantrips known, so your class cantrip budget is one lower.';
      try {
        expect(notes(db)).toEqual([]);
        const r = renderDom(<Builder content={db} initial={b} onCancel={noop} onCreate={noop} />);
        try {
          r.click([...r.host.querySelectorAll<HTMLButtonElement>('.lstrip button')].find((x) => flat(x.textContent) === '1') ?? null);
          expect(flat(r.host.textContent), 'the card reads the record').toContain('budget is one lower');
        } finally {
          r.stop();
        }
      } finally {
        choice.note = saved;
      }
    },
    T,
  );
});

describe("2 · a sorcerer's Spells tab", () => {
  const sorcerer = (d: ContentDatabase, extra = 0) => {
    const plain = pc(d, 'sorcerer', 1, { keyAbility: 'cha' });
    const probe = entryOf(buildCharacter(plain, d), 'sorcerer');
    const gift = probe.grantedCantrips ?? [];
    const cap = entryOf(buildCharacter(withAdapted(plain, 'electric-arc'), d), 'sorcerer').cantripCap!;
    const picks = onTradition(d, probe.tradition).filter((id) => !gift.includes(id) && id !== 'electric-arc').slice(0, ownPlacesBeside(probe, 0, cap, []) + extra);
    return { picks, ch: buildCharacter(withAdapted({ ...plain, cantrips: picks } as BuildState, 'electric-arc'), d) };
  };
  /** Each cantrip card's name and the note under it, from the section headed "Cantrips". */
  const cantripCards = (ch: Character, d: ContentDatabase) => {
    const r = renderDom(<SpellsTab character={applyPlayState(ch, initialPlay(ch, d), d)} content={d} onPlay={noop} />);
    try {
      const hdr = [...r.host.querySelectorAll('.spell-rankhdr')].find((h) => flat(h.textContent).startsWith('Cantrips'));
      return [...(hdr?.parentElement?.querySelectorAll<HTMLElement>('.spell-grid .spell-card:not(.empty)') ?? [])].map((c) => ({
        name: flat(c.querySelector('.spell-name')?.textContent),
        text: flat(c.textContent),
      }));
    } finally {
      r.stop();
    }
  };

  it(
    'the builder-full sorcerer: electric arc drawn "from Adapted Cantrip", no card says "One too many" (ungated and in the app)',
    () => {
      for (const d of [db, gated]) {
        const cards = cantripCards(sorcerer(d).ch, d);
        const label = d === db ? 'ungated' : 'trust-gated';
        expect(cards.find((c) => c.name === nameOf('electric-arc'))?.text, label).toContain('from Adapted Cantrip');
        expect(cards.filter((c) => /One too many/.test(c.text)).map((c) => c.name), label).toEqual([]);
      }
    },
    T,
  );

  // mutation-proof
  it(
    'control: one OWN pick too many is still marked — on the player’s last pick, never on the adapted cantrip',
    () => {
      for (const d of [db, gated]) {
        const s = sorcerer(d, 1);
        const marked = cantripCards(s.ch, d).filter((c) => /One too many/.test(c.text)).map((c) => c.name);
        expect(marked, d === db ? 'ungated' : 'trust-gated').toEqual([nameOf(s.picks[s.picks.length - 1])]);
        // The planted bad case: the same character with the attribution gone marks the adapted cantrip too.
        const bad = structuredClone(s.ch);
        delete entryOf(bad, 'sorcerer').spellSources;
        expect(cantripCards(bad, d).filter((c) => /One too many/.test(c.text)).map((c) => c.name)).toContain(nameOf('electric-arc'));
      }
    },
    T,
  );
});

describe('3 · the Prepare panel stores a stand-in when the player edits', () => {
  // mutation-proof
  it(
    'an old-save cleric re-prepares the opening that held electric arc; the opening beside it keeps its pick',
    () => {
      const own = onTradition(db, 'divine').slice(0, 4);
      const swap = onTradition(db, 'divine').find((id) => !own.includes(id))!;
      const ch = buildCharacter(withAdapted(pc(db, 'cleric', 1, { keyAbility: 'wis', cantrips: own }), 'electric-arc'), db);
      const start = setPreparedCantrip(initialPlay(ch, db), 'cleric-casting', 3, 'electric-arc');
      /** Prepare → opening `n` → Prepare `id`; the play state the click stored. */
      const prepare = (play: PlayState, n: number, id: string) => {
        let stored = play;
        let writes = 0;
        const r = renderDom(
          <SpellsTab
            character={applyPlayState(ch, play, db)}
            content={db}
            onPlay={(fn) => {
              writes++;
              stored = fn(stored);
            }}
          />,
        );
        try {
          r.click(entryBtn(r.host, 'cleric-casting', PREPARE));
          expect(writes, 'loading the tab and opening the panel stores nothing').toBe(0);
          const box = [...r.host.querySelectorAll('.ms-rank')].find((x) => flat(x.querySelector('.ms-rank-hdr')?.textContent) === 'Cantrips');
          expect(box, 'the Cantrips group').toBeTruthy();
          expect([...box!.querySelectorAll('button.ms-slot .ms-slot-name')].map((x) => flat(x.textContent)), 'what the panel shows first').toEqual(
            entryOf(applyPlayState(ch, play, db), 'cleric').cantripSlots!.map((x) => (x ? nameOf(x) : 'Empty cantrip')),
          );
          r.click(box!.querySelectorAll('button.ms-slot')[n] ?? null);
          const row = rows(r.host).find((w) => flat(w.querySelector('.picker-name')?.textContent) === nameOf(id));
          expect(row, `${nameOf(id)} is on offer`).toBeTruthy();
          r.click(row!.querySelector('button.pick-add'));
        } finally {
          r.stop();
        }
        return stored;
      };
      const before = entryOf(applyPlayState(ch, start, db), 'cleric').cantripSlots;
      expect(before, 'fixture: the 5th opening shows what electric arc pushed out').toEqual([...own.slice(0, 3), 'electric-arc', own[3]]);
      const after = prepare(start, 3, swap);
      expect(after.preparedSpells?.[preparedCantripKey('cleric-casting', 4)], 'stored with the click').toBe(own[3]);
      expect(entryOf(applyPlayState(ch, after, db), 'cleric').cantripSlots).toEqual([...own.slice(0, 3), swap, own[3]]);
      // The planted bad case: the same click through the old writer (only the edited opening stored).
      const old = setPreparedCantrip(start, 'cleric-casting', 3, swap);
      expect(entryOf(applyPlayState(ch, old, db), 'cleric').cantripSlots?.[4], 'it flipped back').toBe('electric-arc');
    },
    T,
  );
});

describe('4 · Learn a Spell', () => {
  // mutation-proof
  it(
    'a Flexible Spellcaster cleric is not offered the adapted cantrip it already has',
    () => {
      // A flexible cleric prepares four cantrips (measured: cap 4 with or without the feat), all filled,
      // so the adapted cantrip is an option and not in `cantrips`.
      const DIV4 = ['divine-lance', 'stabilize', 'light', 'shield'];
      const b = withAdapted(
        pc(db, 'cleric', 2, { subclassId: 'cloistered-cleric', keyAbility: 'wis', cantrips: DIV4, featPicks: { '2:class:0': 'flexible-spellcaster-dedication' } }),
        'electric-arc',
      );
      const ch = buildCharacter(b, db);
      const e = entryOf(ch, 'cleric');
      expect(e.repertoire, 'fixture: the flexible collection').toBeTruthy();
      expect(e.cantrips, 'fixture: the four openings are the player’s, electric arc is an option').toEqual(DIV4);
      expect(e.spellSources?.['electric-arc'], 'fixture: the cleric has electric arc from the feat').toBe('Adapted Cantrip');
      const learnable = (c: Character, play: PlayState = initialPlay(c, db)) => {
        const r = renderDom(<SpellsTab character={applyPlayState(c, play, db)} content={db} onPlay={noop} />);
        try {
          r.click(entryBtn(r.host, 'cleric-casting', LEARN));
          r.click(r.host.querySelector('.manage-spells button.ms-add'));
          return rows(r.host).map((w) => flat(w.querySelector('.picker-name')?.textContent));
        } finally {
          r.stop();
        }
      };
      const names = learnable(ch);
      expect(names.length, 'fixture: the list is open').toBeGreaterThan(0);
      expect(names).not.toContain(nameOf('electric-arc'));
      for (const id of DIV4) expect(names, `${id} is known already`).not.toContain(nameOf(id));
      // The planted bad case: the same character with the feat's attribution gone is offered it again.
      const bad = structuredClone(ch);
      delete entryOf(bad, 'cleric').spellSources;
      expect(learnable(bad)).toContain(nameOf('electric-arc'));
    },
    T,
  );

  // mutation-proof
  it(
    '…nor a cantrip it knows but did not prepare today (checker finding: `cantrips` is today’s openings)',
    () => {
      const DIV4 = ['divine-lance', 'stabilize', 'light', 'shield'];
      const ch = buildCharacter(
        pc(db, 'cleric', 2, { subclassId: 'cloistered-cleric', keyAbility: 'wis', cantrips: DIV4, featPicks: { '2:class:0': 'flexible-spellcaster-dedication' } }),
        db,
      );
      // This morning light's opening holds guidance instead.
      const sheet = applyPlayState(ch, setPreparedCantrip(initialPlay(ch, db), 'cleric-casting', 2, 'guidance'), db);
      expect(entryOf(sheet, 'cleric').cantrips, 'fixture: light is not prepared today').not.toContain('light');
      const learnable = (s: Character) => {
        const r = renderDom(<SpellsTab character={s} content={db} onPlay={noop} />);
        try {
          r.click(entryBtn(r.host, 'cleric-casting', LEARN));
          r.click(r.host.querySelector('.manage-spells button.ms-add'));
          return rows(r.host).map((w) => flat(w.querySelector('.picker-name')?.textContent));
        } finally {
          r.stop();
        }
      };
      expect(learnable(sheet)).not.toContain(nameOf('light'));
      // The planted bad case: the overlay without the build's list offers light back.
      const bad = structuredClone(sheet);
      delete entryOf(bad, 'cleric').cantripPool;
      expect(learnable(bad)).toContain(nameOf('light'));
    },
    T,
  );
});

describe('5 · the builder keeps a stored answer in its own picker', () => {
  // mutation-proof
  it(
    'an old save that chose allegro still shows Allegro in the Adapted cantrip picker, marked as no longer allowed',
    () => {
      const b = withAdapted(pc(db, 'sorcerer', 1, { keyAbility: 'cha' }), 'allegro');
      const r = renderDom(<Builder content={db} initial={b} onCancel={noop} onCreate={noop} />);
      try {
        r.click([...r.host.querySelectorAll<HTMLButtonElement>('.lstrip button')].find((x) => flat(x.textContent) === '1') ?? null);
        const card = [...r.host.querySelectorAll<HTMLElement>('[data-ctl-title="Adapted cantrip"]')];
        expect(card, 'the Adapted cantrip picker').toHaveLength(1);
        expect(card[0].getAttribute('data-ctl-state'), 'it reads as answered, not blank').toBe('picked');
        expect(flat(card[0].textContent)).toContain('Allegro');
      } finally {
        r.stop();
      }
      // The planted bad case: the same character answered with a spell id nothing offers reads blank —
      // the state a kept answer avoids.
      const blank = withAdapted(pc(db, 'sorcerer', 1, { keyAbility: 'cha' }), 'no-such-cantrip');
      const r2 = renderDom(<Builder content={db} initial={blank} onCancel={noop} onCreate={noop} />);
      try {
        r2.click([...r2.host.querySelectorAll<HTMLButtonElement>('.lstrip button')].find((x) => flat(x.textContent) === '1') ?? null);
        expect(r2.host.querySelector('[data-ctl-title="Adapted cantrip"]')?.getAttribute('data-ctl-state')).toBe('empty');
      } finally {
        r2.stop();
      }
    },
    T,
  );
});
