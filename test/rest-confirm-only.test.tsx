// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { content, build } from './_content';
import { renderDom } from './_render';
import { CharacterSheet } from '../src/sheet/CharacterSheet';
import { ForceMobileContext } from '../src/sheet/useIsMobile';
import { applyPlayState, initialPlay, rest } from '../src/rules/play';
import { abilityMod } from '../src/rules/derive';
import type { Character, ContentDatabase, PlayState } from '../src/rules/types';

/**
 * OWNER REPORT: "resources that need to be updated when I rest update when I press the Rest button
 * instead of when I press Prepare for the day, so if I want to press Cancel the resources still got
 * filled."
 *
 * The bed button opens the "Daily preparations" dialog; only its "Prepare for the day" button may
 * spend the night. Opening the dialog and cancelling it must leave the ledger exactly as it was —
 * spent slots stay spent, the focus pool stays used, damage stays taken.
 *
 * These assert the PLAY STATE, not the pixels: the play state is the resource ledger, and a refill
 * that happened is visible there whichever surface printed it.
 */
const c = () => content();

/** Wire the sheet the way App.tsx does: onPlay updates the ledger, onRest applies rest(). */
function harness(base: Character, con: ContentDatabase, start: PlayState, seen: { play: PlayState }) {
  function Harness() {
    const [play, setPlay] = useState(start);
    seen.play = play;
    return (
      <CharacterSheet
        character={applyPlayState(base, play, con)}
        content={con}
        charKey="t"
        onPlay={(fn) => setPlay((p) => fn(p))}
        onRest={() =>
          setPlay((p) =>
            rest(p, {
              level: base.level,
              conMod: abilityMod(base.abilities.con),
              initialResources: base.classResources,
              modeDefs: con.modes,
              restRecovery: base.restRecovery,
            }),
          )
        }
      />
    );
  }
  return <Harness />;
}

const byText = (host: HTMLElement, label: string) =>
  [...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label) ?? null;

describe('probe: does opening the dialog touch the ledger at all', () => {
  it('a character WITH a daily choice — bed press must not commit anything', () => {
    const con = c();
    const base = build('fighter', 8, { featPicks: { '8:class:0': 'harbingers-armament' }, ancestryId: 'human', heritageId: 'skilled-human', backgroundId: 'acolyte', keyAbility: 'str' }) as Character;
    const start: PlayState = { ...initialPlay(base, con), focusUsed: 1, damage: 9, featUses: { x: 1 } };
    const seen = { play: start };
    const { host, click, stop } = renderDom(harness(base, con, start, seen));
    try {
      const bed = [...host.querySelectorAll('button')].find((b) => b.getAttribute('title') === 'Daily preparations');
      click(bed ?? null);
      // Same object reference ⇒ no updatePlay fired.
      expect(seen.play).toBe(start);
      // pick today's answer, then cancel
      const opt = host.querySelector('.daily-opt') as HTMLElement | null;
      if (opt) click(opt);
      click(byText(host, 'Cancel'));
      expect(seen.play).toBe(start);
    } finally {
      stop();
    }
  });

  it('on the MOBILE layout too', () => {
    const con = c();
    const base = build('wizard', 10) as Character;
    const start: PlayState = { ...initialPlay(base, con), focusUsed: 1, damage: 11, expendedSlots: { s: true } };
    const seen = { play: start };
    const { host, click, stop } = renderDom(
      <ForceMobileContext.Provider value={true}>{harness(base, con, start, seen)}</ForceMobileContext.Provider>,
    );
    try {
      const bed = [...host.querySelectorAll('button')].find((b) => b.getAttribute('title') === 'Daily preparations');
      click(bed ?? null);
      expect(seen.play).toBe(start);
      click(byText(host, 'Cancel'));
      expect(seen.play).toBe(start);
    } finally {
      stop();
    }
  });

  it.each(['Main', 'Spells', 'Inventory', 'Feats', 'Details', 'Notes', 'Companions'])(
    'from the %s tab: opening + cancelling commits nothing',
    (tab) => {
      const con = c();
      const base = build('wizard', 10) as Character;
      const start: PlayState = { ...initialPlay(base, con), focusUsed: 1, damage: 11, expendedSlots: { s: true } };
      const seen = { play: start };
      const { host, click, stop } = renderDom(harness(base, con, start, seen));
      try {
        const tabBtn = [...host.querySelectorAll('button.tab')].find((b) => (b.textContent ?? '').trim() === tab);
        if (tabBtn) click(tabBtn);
        expect(seen.play).toBe(start);
        const bed = [...host.querySelectorAll('button')].find((b) => b.getAttribute('title') === 'Daily preparations');
        click(bed ?? null);
        expect(seen.play).toBe(start);
        click(byText(host, 'Cancel'));
        expect(seen.play).toBe(start);
      } finally {
        stop();
      }
    },
  );

  it.each(['wizard', 'cleric', 'commander', 'alchemist', 'barbarian'])(
    'a %s: opening + cancelling commits nothing',
    (cls) => {
      const con = c();
      if (!con.classes[cls]) return;
      const base = build(cls, 10) as Character;
      const start: PlayState = {
        ...initialPlay(base, con),
        focusUsed: 1,
        damage: 11,
        featUses: { x: 1 },
        innateUsed: { a: true },
        expendedSlots: { s: true },
        slotsUsed: { r: 1 },
        conditions: [{ id: 'wounded', value: 1 }],
      };
      const seen = { play: start };
      const { host, click, stop } = renderDom(harness(base, con, start, seen));
      try {
        const bed = [...host.querySelectorAll('button')].find((b) => b.getAttribute('title') === 'Daily preparations');
        click(bed ?? null);
        expect(seen.play).toBe(start);
        click(byText(host, 'Cancel'));
        expect(seen.play).toBe(start);
      } finally {
        stop();
      }
    },
  );
});

describe('Cancel discards the morning’s picks', () => {
  it("a daily choice picked and then cancelled is gone on the next open (and can't be confirmed)", () => {
    const con = c();
    const base = build('fighter', 8, {
      featPicks: { '8:class:0': 'harbingers-armament' },
      ancestryId: 'human',
      heritageId: 'skilled-human',
      backgroundId: 'acolyte',
      keyAbility: 'str',
    }) as Character;
    const start: PlayState = initialPlay(base, con);
    const seen = { play: start };
    const { host, click, stop } = renderDom(harness(base, con, start, seen));
    const openRest = () =>
      click([...host.querySelectorAll('button')].find((b) => b.getAttribute('title') === 'Daily preparations') ?? null);
    try {
      openRest();
      const opt = host.querySelector('.daily-opt') as HTMLElement | null;
      expect(opt, 'fixture no longer offers a daily choice chip').toBeTruthy();
      click(opt);
      expect(host.querySelectorAll('.daily-opt.on').length).toBe(1);
      // "Prepare for the day" is now enabled — the question is answered…
      expect((byText(host, 'Prepare for the day') as HTMLButtonElement).disabled).toBe(false);

      click(byText(host, 'Cancel'));
      openRest();
      // …but the answer was cancelled, so it must not come back pre-selected, and the confirm must be
      // blocked again exactly as it was before the cancelled pick.
      expect(host.querySelectorAll('.daily-opt.on').length).toBe(0);
      expect((byText(host, 'Prepare for the day') as HTMLButtonElement).disabled).toBe(true);
      expect(seen.play.dailyChoices).toBeUndefined();
    } finally {
      stop();
    }
  });
});

describe('daily preparations only happen on "Prepare for the day"', () => {
  it('opening the dialog and cancelling refills nothing; confirming refills everything', () => {
    const con = c();
    const base = build('alchemist', 5) as Character;
    const resId = Object.keys(base.classResources ?? {})[0];
    expect(resId).toBeTruthy();
    // A spent day: the class resource emptied, the focus pool used, damage taken.
    const spent: PlayState = {
      ...initialPlay(base, con),
      resources: { ...(base.classResources ?? {}), [resId]: 0 },
      focusUsed: 1,
      damage: 7,
    };
    const seen = { play: spent };
    const { host, click, stop } = renderDom(harness(base, con, spent, seen));
    try {
      // 1. press the bed button — this only OPENS the dialog
      const bed = [...host.querySelectorAll('button')].find((b) => b.getAttribute('title') === 'Daily preparations');
      click(bed ?? null);
      expect(byText(host, 'Prepare for the day')).toBeTruthy();
      expect(seen.play.resources?.[resId]).toBe(0);
      expect(seen.play.focusUsed).toBe(1);
      expect(seen.play.damage).toBe(7);

      // 2. Cancel — still nothing
      click(byText(host, 'Cancel'));
      expect(byText(host, 'Prepare for the day')).toBeNull();
      expect(seen.play.resources?.[resId]).toBe(0);
      expect(seen.play.focusUsed).toBe(1);
      expect(seen.play.damage).toBe(7);

      // 3. reopen and confirm — NOW the night happens
      const bed2 = [...host.querySelectorAll('button')].find((b) => b.getAttribute('title') === 'Daily preparations');
      click(bed2 ?? null);
      click(byText(host, 'Prepare for the day'));
      expect(seen.play.resources?.[resId]).toBe(base.classResources?.[resId]);
      expect(seen.play.focusUsed).toBe(0);
      expect(seen.play.damage).toBeLessThan(7);
    } finally {
      stop();
    }
  });
});
