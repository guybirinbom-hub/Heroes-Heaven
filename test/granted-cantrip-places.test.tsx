// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { Builder } from '../src/builder/Builder';
import { SpellsTab } from '../src/sheet/SpellsTab';
import { buildCharacter, deriveBuildFromCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { applyPlayState, initialPlay } from '../src/rules/play';
import { enabledBookSet } from '../src/rules/sources';
import type { Character, ContentDatabase, SpellcastingEntry } from '../src/rules/types';

/**
 * AN ORACLE'S OR A PSYCHIC'S FREE CANTRIP PLACE — the sheet and the builder count it the same way.
 *
 * Print gives both classes their granted cantrips ON TOP of the ones they choose: the oracle *"learn[s]
 * … five divine cantrips of your choice"* (class-feature-956) and its mystery adds a "Granted Spells -
 * Cantrip" line (mystery-12); the psychic learns *"three occult cantrips of your choice"* and *"your
 * conscious mind also grants you additional spells in your repertoire, starting with … two cantrips"*
 * (class-feature-1141). The app already encoded that (no `grantsCountInside` on either). The sorcerer is
 * the other shape — *"four cantrips of your choice, as well as an additional … cantrip from your
 * bloodline"* (class-feature-984), kept as five places with the gift taking one.
 *
 * What was wrong was the COUNTING (2026-10-23):
 *   1. the Spells tab counted the granted cantrips as the player's own places, so an oracle with one
 *      place free (and a new psychic with all three free) showed no "Empty cantrip" place at all;
 *   2. the builder counted a pick that is ALSO a granted cantrip as one of the places, while the sheet
 *      and the save round-trip treat it as the grant — and the build sliced the player's last pick off
 *      when such a repeat stood in the list.
 * One rule now: a cantrip the class grants takes none of the player's own places (`ownPlacesBeside` for
 * the builder's row, `emptyCantripPlaces` for the sheet), and the build draws every own pick beside one
 * (buildCharacter's `ownCantripPicks`), reporting any past the places rather than hiding it.
 *
 * Fixtures are synthetic ("TEST …"), never an owner's character.
 */
const db = content();
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

const pc = (classId: string, over: Partial<BuildState> = {}): BuildState =>
  ({
    ...emptyBuild(),
    name: 'TEST granted cantrip',
    level: 1,
    classId,
    subclassId: db.classes[classId]?.subclass?.options[0]?.id ?? null,
    ancestryId: 'human',
    heritageId: 'versatile-human',
    backgroundId: Object.keys(db.backgrounds)[0],
    keyAbility: db.classes[classId]?.keyAbility?.[0] ?? null,
    ...over,
  }) as BuildState;
const entryOf = (ch: Character, classId: string): SpellcastingEntry => ch.spellcasting.find((e) => e.id === `${classId}-casting`)!;
const onTradition = (tradition: string) =>
  Object.values(db.spells)
    .filter((s) => s.rank === 0 && s.rarity === 'common' && CORE.has(s.source?.book ?? '') && s.traditions?.includes(tradition as never))
    .map((s) => s.id)
    .sort();

/** A caster of `classId` / `subclassId` and what its class grants at cantrip rank, with `own` cantrips of
 *  its tradition that are NOT granted, plus any `extra` ids put first (a granted one picked again). */
const caster = (classId: string, subclassId: string | null, own: number, extra: string[] = [], avoid: string[] = []) => {
  const plain = pc(classId, subclassId ? { subclassId } : {});
  const probe = entryOf(buildCharacter(plain, db), classId);
  const grants = probe.grantedCantrips ?? [];
  const picks = [...extra, ...onTradition(probe.tradition).filter((id) => !grants.includes(id) && !avoid.includes(id)).slice(0, own)];
  const b = { ...plain, cantrips: picks } as BuildState;
  return { b, ch: buildCharacter(b, db), grants, cap: probe.cantripCap!, picks };
};

/** The "Empty cantrip" places the Spells tab draws. */
const emptyCards = (ch: Character) => {
  const r = renderDom(<SpellsTab character={applyPlayState(ch, initialPlay(ch, db), db)} content={db} onPlay={noop} />);
  try {
    const hdr = [...r.host.querySelectorAll('.spell-rankhdr')].find((h) => flat(h.textContent).startsWith('Cantrips'));
    return [...(hdr?.parentElement?.querySelectorAll('.spell-grid .spell-card.empty') ?? [])].filter((c) => /Empty cantrip/.test(c.textContent ?? '')).length;
  } finally {
    r.stop();
  }
};
/** The builder's cantrip row on the Level 1 page: its "n / m" and whether "+ add" still offers a place. */
const builderRow = (b: BuildState) => {
  const r = renderDom(<Builder content={db} initial={b} onCancel={noop} onCreate={noop} />);
  try {
    r.click([...r.host.querySelectorAll<HTMLButtonElement>('.lstrip button')].find((x) => flat(x.textContent) === '1') ?? null);
    const row = [...r.host.querySelectorAll<HTMLElement>('.spell-pick-row')].find((x) => /cantrips/i.test(x.querySelector('.spr-head span')?.textContent ?? ''));
    const [n, m] = flat(row?.querySelector('.spr-count')?.textContent).split('/').map((x) => Number(x.trim()));
    return { n, m, free: m - n, canAdd: !row?.querySelector<HTMLButtonElement>('button.spr-add')?.disabled, text: flat(row?.textContent) };
  } finally {
    r.stop();
  }
};

/** An oracle mystery with a granted cantrip (every remastered one has one). */
const MYSTERY = db.classes.oracle.subclass!.options.find((o) => (entryOf(buildCharacter(pc('oracle', { subclassId: o.id }), db), 'oracle').grantedCantrips ?? []).length)!.id;
const PSYCHIC = 'the-distant-grasp';

describe('the oracle', () => {
  // mutation-proof
  it(
    'one place free: the sheet shows exactly one "Empty cantrip" and the builder offers exactly one pick',
    () => {
      const o = caster('oracle', MYSTERY, 4);
      expect(o.grants.length, 'the mystery grants a cantrip').toBeGreaterThan(0);
      expect(o.cap, 'print: five cantrips of your choice').toBe(5);
      expect(emptyCards(o.ch)).toBe(1);
      const row = builderRow(o.b);
      expect(row.free).toBe(1);
      expect(row.canAdd).toBe(true);
    },
    T,
  );

  // mutation-proof
  it(
    'a new oracle with no picks shows all five places on the sheet and in the builder',
    () => {
      const o = caster('oracle', MYSTERY, 0);
      expect(emptyCards(o.ch)).toBe(5);
      expect(builderRow(o.b).free).toBe(5);
    },
    T,
  );

  it(
    'a full oracle shows no empty place, and the builder offers none',
    () => {
      const o = caster('oracle', MYSTERY, 5);
      expect(emptyCards(o.ch)).toBe(0);
      const row = builderRow(o.b);
      expect(row.free).toBe(0);
      expect(row.canAdd).toBe(false);
    },
    T,
  );

  // mutation-proof
  it(
    'the granted cantrip picked again uses no place: one free on both sides, and the note says so',
    () => {
      const o = caster('oracle', MYSTERY, 4, [caster('oracle', MYSTERY, 0).grants[0]]);
      expect(emptyCards(o.ch)).toBe(1);
      const row = builderRow(o.b);
      expect(row.free).toBe(1);
      expect(row.canAdd).toBe(true);
      expect(row.text).toContain(`${db.spells[o.grants[0]].name} is granted by your class already — it uses none of these places.`);
    },
    T,
  );

  // mutation-proof
  it(
    '…and with five own picks beside it, the build draws all five: none is sliced off, the sheet and builder are both full',
    () => {
      const o = caster('oracle', MYSTERY, 5, [caster('oracle', MYSTERY, 0).grants[0]]);
      const own = o.picks.slice(1);
      for (const id of own) expect(entryOf(o.ch, 'oracle').cantrips, id).toContain(id);
      expect(emptyCards(o.ch)).toBe(0);
      expect(builderRow(o.b).free).toBe(0);
    },
    T,
  );
});

describe('the psychic', () => {
  // mutation-proof
  it(
    'one place free: the sheet shows exactly one "Empty cantrip" and the builder offers exactly one pick',
    () => {
      const p = caster('psychic', PSYCHIC, 2);
      expect(p.grants.length, 'the conscious mind grants cantrips').toBeGreaterThan(0);
      expect(p.cap, 'print: three occult cantrips of your choice').toBe(3);
      expect(emptyCards(p.ch)).toBe(1);
      const row = builderRow(p.b);
      expect(row.free).toBe(1);
      expect(row.canAdd).toBe(true);
    },
    T,
  );

  // mutation-proof
  it(
    'a new psychic shows its three places; a full one shows none',
    () => {
      expect(emptyCards(caster('psychic', PSYCHIC, 0).ch)).toBe(3);
      expect(builderRow(caster('psychic', PSYCHIC, 0).b).free).toBe(3);
      expect(emptyCards(caster('psychic', PSYCHIC, 3).ch)).toBe(0);
      expect(builderRow(caster('psychic', PSYCHIC, 3).b).free).toBe(0);
    },
    T,
  );

  // mutation-proof
  it(
    'a conscious-mind cantrip picked again uses no place on either side',
    () => {
      const common = caster('psychic', PSYCHIC, 0).grants.find((id) => onTradition('occult').includes(id));
      expect(common, 'a granted cantrip the occult list also offers').toBeTruthy();
      const p = caster('psychic', PSYCHIC, 2, [common!]);
      expect(emptyCards(p.ch)).toBe(1);
      expect(builderRow(p.b).free).toBe(1);
    },
    T,
  );
});

/** Each cantrip card's name and full text, from the section headed "Cantrips". */
const cantripCards = (ch: Character) => {
  const r = renderDom(<SpellsTab character={applyPlayState(ch, initialPlay(ch, db), db)} content={db} onPlay={noop} />);
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

describe('a subclass switch after a granted cantrip was picked again hides no pick', () => {
  /* The checker's case (2026-10-23): the builder gives a repeated grant its place back, so a row can hold
   * one pick more than the places; switching the subclass to one that grants something else makes that
   * pick an own one again. The build used to slice to the places and drew the last pick nowhere. */
  const grantsOf = (classId: string, sub: string) => entryOf(buildCharacter(pc(classId, { subclassId: sub }), db), classId).grantedCantrips ?? [];
  const swap = (classId: string) => {
    const opts = db.classes[classId].subclass!.options.map((o) => o.id);
    const list = onTradition(entryOf(buildCharacter(pc(classId, { subclassId: opts[0] }), db), classId).tradition);
    for (const from of opts)
      for (const to of opts) {
        const repeat = grantsOf(classId, from).filter((id) => list.includes(id) && !grantsOf(classId, to).includes(id));
        if (from !== to && repeat.length) return { from, to, repeat: repeat[0] };
      }
    throw new Error('no pair of subclasses to switch between');
  };

  // mutation-proof
  for (const [classId, own] of [
    ['oracle', 5],
    ['psychic', 3],
  ] as const)
    it(
      `${classId}: every own pick is still drawn, and the extra one says "too many"`,
      () => {
        const s = swap(classId);
        // Own picks the NEW subclass does not grant either, so each one stays the player's own after it.
        const before = caster(classId, s.from, own, [s.repeat], grantsOf(classId, s.to));
        expect(before.picks).toHaveLength(own + 1);
        expect(builderRow(before.b).free, 'the row was full, never over').toBe(0);
        const after = buildCharacter({ ...before.b, subclassId: s.to } as BuildState, db);
        for (const id of before.picks) expect(entryOf(after, classId).cantrips, id).toContain(id);
        const marked = cantripCards(after).filter((c) => /too many/.test(c.text));
        expect(marked.map((c) => c.name)).toEqual([db.spells[before.picks[before.picks.length - 1]].name]);
        expect(marked[0].text).toContain(`One cantrip too many — this class lets you choose ${own}; remove one in the builder`);
        expect(emptyCards(after)).toBe(0);
      },
      T,
    );
});

/* The third check's point (2026-10-23): the build cannot tell a switch from any other over-cap state (a
 * removed Cantrip Expansion), and a rule that drew only "switched" picks drew some of them and hid the
 * rest — "One cantrip too many" beside a builder saying "7 / 5". Every non-book caster draws every own
 * pick and the note counts all of them (the cleric and bard cases below). */
// mutation-proof
it(
  'an oracle with two own picks over its places draws all of them and says "2 cantrips too many"',
  () => {
    const o = caster('oracle', MYSTERY, 7);
    for (const id of o.picks) expect(entryOf(o.ch, 'oracle').cantrips, id).toContain(id);
    const marked = cantripCards(o.ch).filter((c) => /too many/.test(c.text));
    expect(marked.map((c) => c.name)).toEqual(o.picks.slice(-2).map((id) => db.spells[id].name));
    for (const c of marked) expect(c.text).toContain('2 cantrips too many — this class lets you choose 5; remove 2 in the builder');
  },
  T,
);

describe('controls: the sorcerer and the wizard do not move; every other caster over its places shows every pick', () => {
  /* The one sorcerer that does move, toward the builder: a bloodline whose cantrip gift follows a variant
   * still unanswered draws every variant's gift, and the old sheet counted them all as filled places — a
   * new elemental sorcerer showed no empty place beside the builder's "0 / 4". */
  // mutation-proof
  it(
    'an unanswered variant-gift sorcerer with no picks shows its four places, as the builder does',
    () => {
      const sub = db.classes.sorcerer.subclass!.options.find((o) => (entryOf(buildCharacter(pc('sorcerer', { subclassId: o.id }), db), 'sorcerer').grantedCantrips ?? []).length > 1)!.id;
      const s = caster('sorcerer', sub, 0);
      expect(s.grants.length).toBeGreaterThan(1);
      expect(emptyCards(s.ch)).toBe(4);
      expect(builderRow(s.b).free).toBe(4);
    },
    T,
  );

  it(
    'a sorcerer one short of its own places: one empty place, the builder "3 / 4" as before',
    () => {
      const s = caster('sorcerer', null, 3);
      expect(s.grants.length, 'the bloodline gift').toBe(1);
      expect(emptyCards(s.ch)).toBe(1);
      const row = builderRow(s.b);
      expect([row.n, row.m]).toEqual([3, 4]);
      expect(emptyCards(caster('sorcerer', null, 4).ch)).toBe(0);
      // The gift picked again gives its place back, as it did (lane C2).
      const again = caster('sorcerer', null, 3, s.grants);
      expect(emptyCards(again.ch)).toBe(1);
      expect(builderRow(again.b).free).toBe(1);
      expect(builderRow(again.b).text).not.toContain('granted by your class already');
    },
    T,
  );

  /* FLIPPED (2026-10-23, Guy: "every caster gets the same display" — a stored choice is never dropped
   * unseen). This test once pinned a Flexible Spellcaster cleric at 2nd (5 − 2 + 1 = 4 places) holding
   * five picks to FOUR drawn and no note: the fifth vanished. Every caster now draws every own pick and
   * flags the extra one "too many", through the same `cantripCapWas` / `cantripsOverOf` as the oracle. */
  // mutation-proof
  it(
    'a Flexible Spellcaster cleric at 2nd with one pick past its four places shows all five, the extra one flagged',
    () => {
      const picks = onTradition('divine').slice(0, 5);
      const ch = buildCharacter(pc('cleric', { level: 2, subclassId: 'cloistered-cleric', keyAbility: 'wis', cantrips: picks, featPicks: { '2:class:0': 'flexible-spellcaster-dedication' } } as Partial<BuildState>), db);
      const e = entryOf(ch, 'cleric');
      expect(e.cantripCap).toBe(4);
      expect(e.cantrips.filter((id) => picks.includes(id))).toEqual(picks);
      expect(e.cantripCapWas).toBe(5);
      const cards = cantripCards(ch);
      for (const id of picks) expect(cards.map((c) => c.name)).toContain(db.spells[id].name);
      const marked = cards.filter((c) => /too many/.test(c.text));
      expect(marked.map((c) => c.name)).toEqual([db.spells[picks[4]].name]);
      // A prepared caster over its cap: one opening per pick, each holding its pick — no extra empty one.
      const played = entryOf(applyPlayState(ch, initialPlay(ch, db), db), 'cleric');
      expect(played.cantripSlots).toEqual(picks);
      expect(emptyCards(ch)).toBe(0);
      // The save keeps all five: a character read back with no stored build gets every pick (was four).
      expect(deriveBuildFromCharacter(ch, db).cantrips).toEqual(picks);
    },
    T,
  );

  /* A REMOVED Cantrip Expansion (the same shrunk-cap shape): a cleric that filled seven places, then dropped
   * the feat, holds seven picks against five. Prepared (cleric) and spontaneous (bard) alike draw all seven
   * and flag two — the old slice hid the last two. */
  // mutation-proof
  it(
    'a cleric or bard that removed Cantrip Expansion shows all seven picks, two flagged too many, and no empty place',
    () => {
      for (const [classId, tradition, extra] of [
        ['cleric', 'divine', { subclassId: 'cloistered-cleric', keyAbility: 'wis' }],
        ['bard', 'occult', {}],
      ] as const) {
        const plain = pc(classId, { level: 2, ...extra } as Partial<BuildState>);
        const grants = entryOf(buildCharacter(plain, db), classId).grantedCantrips ?? [];
        const picks = onTradition(tradition).filter((id) => !grants.includes(id)).slice(0, 7);
        const withIt = buildCharacter({ ...plain, cantrips: picks, featPicks: { '2:class:0': 'cantrip-expansion' } } as BuildState, db);
        expect(entryOf(withIt, classId).cantripCap, `${classId}: fixture, the feat gives seven places`).toBe(7);
        const ch = buildCharacter({ ...plain, cantrips: picks } as BuildState, db);
        const e = entryOf(ch, classId);
        expect(e.cantripCap, classId).toBe(5);
        expect(e.cantrips.filter((id) => picks.includes(id)), classId).toEqual(picks);
        expect(e.cantripCapWas, classId).toBe(7);
        const marked = cantripCards(ch).filter((c) => /too many/.test(c.text));
        expect(marked.map((c) => c.name), classId).toEqual(picks.slice(5).map((id) => db.spells[id].name));
        expect(emptyCards(ch), classId).toBe(0);
      }
    },
    T,
  );

  /* A BOOK caster is the exception that hides nothing: a wizard's stored cantrips ARE its spellbook (ten
   * places), the first ones its daily preparation. Dropping Cantrip Expansion leaves the two extra picks in
   * the book — present, preparable, not "too many" (the book holds ten). Pinned so the change above never
   * starts flagging a wizard's book. */
  it(
    'a wizard that removed Cantrip Expansion keeps the two extra picks in its spellbook, with no "too many" note',
    () => {
      const plain = pc('wizard', { level: 2 } as Partial<BuildState>);
      const picks = onTradition('arcane').slice(0, 8);
      const withIt = entryOf(buildCharacter({ ...plain, cantrips: picks, featPicks: { '2:class:0': 'cantrip-expansion' } } as BuildState, db), 'wizard');
      expect(withIt.cantripCap, 'fixture: the feat gives eight places').toBe(8);
      const ch = buildCharacter({ ...plain, cantrips: picks } as BuildState, db);
      const e = entryOf(ch, 'wizard');
      expect(e.cantripCap).toBe(6);
      for (const id of picks) expect(e.bookCantrips).toContain(id);
      expect(e.cantripCapWas).toBeUndefined();
      expect(cantripCards(ch).some((c) => /too many/.test(c.text))).toBe(false);
    },
    T,
  );

  it(
    'a wizard with five of six cantrips prepared shows one empty place',
    () => {
      const w = caster('wizard', null, 5);
      expect(w.cap).toBe(6);
      expect(emptyCards(w.ch)).toBe(1);
      expect(emptyCards(caster('wizard', null, 6).ch)).toBe(0);
    },
    T,
  );
});
