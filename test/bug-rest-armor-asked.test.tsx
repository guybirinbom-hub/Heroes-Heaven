// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { useState } from 'react';
import { content, build } from './_content';
import { renderDom } from './_render';
import { CharacterSheet } from '../src/sheet/CharacterSheet';
import { applyPlayState, fatiguingArmor, initialPlay, ownedRestIds, rest, RESTS_IN_ARMOR } from '../src/rules/play';
import { abilityMod } from '../src/rules/derive';
import type { Character, ContentDatabase, InventoryItem, PlayState } from '../src/rules/types';

/*
 * bug 2026-10-14 (the owner's list): "when daily prep a character gets the fatigued condition — the
 * weird part is that it doesn't happen to every character". Cause: rest() applied "sleeping in armor
 * leaves you fatigued" to EVERY character wearing a suit of armour without the comfort trait, every
 * morning, without asking. Characters in clothes, robes, explorer's clothing or no armour never got it —
 * that was the "some characters and not others". It also ignored every record that lets you rest in
 * armour, so even a Guardian (the heavy-armour class, whose rules exempt it) woke fatigued.
 *
 * Owner's ruling (2026-10-14): the Daily preparations window ASKS "I slept in my armor", UNTICKED by
 * default, and only when the worn armour would fatigue.
 */

const db = content();
const OPTS = { level: 5, conMod: 2, items: db.items };
const row = (itemId: string): InventoryItem => ({ instanceId: `i-${itemId}`, itemId, quantity: 1, worn: true });
const play = (over: Partial<PlayState> = {}): PlayState =>
  ({ damage: 0, tempHp: 0, heroPoints: 0, xp: 0, focusUsed: 0, expendedSlots: {}, slotsUsed: {}, conditions: [], pinned: [], inventory: [], ...over }) as PlayState;
const fatigued = (p: PlayState) => (p.conditions ?? []).some((c) => c.id === 'fatigued');

describe('rest(): armour fatigue only on the player’s yes', () => {
  it('no tick, no fatigue — even in full plate', () => {
    expect(fatigued(rest(play({ inventory: [row('full-plate')] }), OPTS))).toBe(false);
    expect(fatigued(rest(play({ inventory: [row('full-plate')] }), { ...OPTS, sleptInArmor: false }))).toBe(false);
  });

  it('ticked: full plate leaves the character Fatigued', () => {
    expect(fatigued(rest(play({ inventory: [row('full-plate')] }), { ...OPTS, sleptInArmor: true }))).toBe(true);
  });

  it('ticked, but in clothes: nothing to fatigue', () => {
    expect(fatigued(rest(play({ inventory: [row('explorers-clothing')] }), { ...OPTS, sleptInArmor: true }))).toBe(false);
  });
});

describe('records that let you rest normally in armour', () => {
  const cases: [string, string, boolean][] = [
    // [record, armour, fatigued?]
    ['armored-rest', 'full-plate', false],
    ['steel-skin', 'full-plate', false],
    ['armor-regiment-training', 'full-plate', false],
    ['guardians-armor', 'full-plate', false],
    ['guardians-armor', 'scale-mail', false],
    ['guardians-armor', 'leather-armor', true], // "medium and heavy" only
    ['beast-of-burden', 'scale-mail', false],
    ['beast-of-burden', 'full-plate', true], // "medium armor" only
    ['second-skin', 'leather-armor', false],
    ['second-skin', 'full-plate', true], // "light or medium" only
    // The automaton's chassis is medium armour it can never take off, and "you still don't become
    // fatigued from sleeping" — found by the independent check, missed by the first scan pattern.
    ['reinforced-chassis', 'reinforced-chassis-armor', false],
  ];
  for (const [rec, armour, want] of cases) {
    it(`${rec} in ${armour} → ${want ? 'Fatigued' : 'rested'}`, () => {
      const after = rest(play({ inventory: [row(armour)] }), { ...OPTS, sleptInArmor: true, ownedIds: [rec] });
      expect(fatigued(after)).toBe(want);
    });
  }

  it('a built Guardian owns Guardian’s Armor, so full plate does not fatigue', () => {
    const g = build('guardian', 1);
    expect(ownedRestIds(g, db)).toContain('guardians-armor');
    expect(fatiguingArmor([row('full-plate')], db.items, ownedRestIds(g, db))).toBeUndefined();
    expect(fatiguingArmor([row('full-plate')], db.items, ownedRestIds(build('fighter', 1), db))?.name).toBe('Full Plate');
  });

  it('every record in the data that says you rest normally in armour is in RESTS_IN_ARMOR', () => {
    // Scans the shipped text, so a NEW feat or feature with this sentence fails here until it is
    // listed (with the categories its sentence names). Class records repeat their features' text and
    // are left out; items are covered by the comfort trait instead.
    const desc = JSON.parse(readFileSync('public/core-descriptions.json', 'utf8')) as Record<string, Record<string, { d?: string }>>;
    const SENTENCE =
      /rest normally[^.]*\barmor|\barmor[^.]*rest normally|sleep[^.]{0,40}\barmor[^.]*without[^.]*fatigued|(?:don't|do not) become fatigued if you sleep[^.]*\barmor|fatigued from sleeping/i;
    const found: string[] = [];
    for (const bucket of ['feats', 'classFeatures', 'heritages', 'ancestries', 'backgrounds']) {
      for (const [id, v] of Object.entries(desc[bucket] ?? {})) if (SENTENCE.test((v?.d ?? '').replace(/<[^>]+>/g, ''))) found.push(id);
    }
    // The scan must see the records it guards (2026-10-14: these 9, cross-checked by an independent
    // scan of every feat, feature, heritage, ancestry, background and armour text in both word orders).
    expect(found.sort()).toEqual(Object.keys(RESTS_IN_ARMOR).sort());
  });
});

/** Wire the sheet the way App.tsx does. */
function harness(base: Character, con: ContentDatabase, start: PlayState, seen: { play: PlayState }) {
  function Harness() {
    const [p, setPlay] = useState(start);
    seen.play = p;
    const character = applyPlayState(base, p, con);
    return (
      <CharacterSheet
        character={character}
        content={con}
        charKey="t"
        onPlay={(fn) => setPlay((x) => fn(x))}
        onRest={(o) =>
          setPlay((x) =>
            rest(x, {
              level: base.level,
              conMod: abilityMod(base.abilities.con),
              initialResources: base.classResources,
              items: con.items,
              sleptInArmor: o?.sleptInArmor,
              ownedIds: ownedRestIds(character, con),
            }),
          )
        }
      />
    );
  }
  return <Harness />;
}

describe('the Daily preparations window asks, unticked', () => {
  const open = (host: HTMLElement, click: (el: Element | null) => void) =>
    click([...host.querySelectorAll('button')].find((b) => b.getAttribute('title') === 'Daily preparations') ?? null);
  const prepare = (host: HTMLElement, click: (el: Element | null) => void) =>
    click([...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Prepare for the day') ?? null);

  const wearing = (classId: string, itemId: string) => {
    const base = build(classId, 1, { inventory: [{ itemId, quantity: 1, worn: true }] } as never) as Character;
    // The play state the app really hands rest(): App.updatePlay always seeds it from initialPlay,
    // which copies the character's inventory.
    const start: PlayState = initialPlay(base, db);
    return { base, start };
  };

  it('fighter in full plate: the box shows, empty; Prepare leaves no Fatigued', () => {
    const { base, start } = wearing('fighter', 'full-plate');
    expect(applyPlayState(base, start, db).inventory.some((i) => i.itemId === 'full-plate' && i.worn)).toBe(true);
    const seen = { play: start };
    const { host, click, stop } = renderDom(harness(base, db, start, seen));
    try {
      open(host, click);
      const box = host.querySelector<HTMLInputElement>('.rest-armor input[type="checkbox"]');
      expect(box).not.toBeNull();
      expect(box!.checked).toBe(false);
      expect(host.querySelector('.rest-armor')?.textContent).toContain('Full Plate');
      prepare(host, click);
      expect(fatigued(seen.play)).toBe(false);
    } finally {
      stop();
    }
  });

  it('ticking the box makes the morning Fatigued', () => {
    const { base, start } = wearing('fighter', 'full-plate');
    const seen = { play: start };
    const { host, click, stop } = renderDom(harness(base, db, start, seen));
    try {
      open(host, click);
      click(host.querySelector('.rest-armor input[type="checkbox"]'));
      expect(host.querySelector('.confirm-body')?.textContent).toContain('but you wake up Fatigued');
      prepare(host, click);
      expect(fatigued(seen.play)).toBe(true);
    } finally {
      stop();
    }
  });

  it('no box for comfort armour, and none for a Guardian in full plate', () => {
    for (const [cls, item] of [['fighter', 'explorers-clothing'], ['guardian', 'full-plate']] as const) {
      const { base, start } = wearing(cls, item);
      const { host, click, stop } = renderDom(harness(base, db, start, { play: start }));
      try {
        open(host, click);
        expect(host.querySelector('.confirm-body')).not.toBeNull();
        expect(host.querySelector('.rest-armor'), `${cls} in ${item}`).toBeNull();
      } finally {
        stop();
      }
    }
  });
});
