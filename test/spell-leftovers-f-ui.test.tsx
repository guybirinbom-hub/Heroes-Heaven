// @vitest-environment jsdom
import { act } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { Builder } from '../src/builder/Builder';
import { FeatsTab } from '../src/sheet/FeatsTab';
import { SpellsTab } from '../src/sheet/SpellsTab';
import { ForceMobileContext } from '../src/sheet/useIsMobile';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';

/**
 * PACKAGE F, "Spell leftovers" (2026-10-16) — what the player SEES. test/spell-leftovers-f.test.ts holds the
 * engine. Each leg was measured red on the code before the fix (a HEAD worktree run) and green after.
 *
 *  2. The level button flags an Adapted Cantrip answer from no magical tradition: the page's "N choices left"
 *     counts it (it read the same as a legal answer before).
 *  3. A CLASS witch or necromancer sees the spell a lesson or Expanded Necromancy adds to its familiar / dirge
 *     as a LOCKED chip with the record named under it — only the dedication's rows showed one.
 *  5. Two Major Lessons through two Advanced Witchcraft feats get two pickers, the second marked "(second)".
 *  6. A granted feat's own question is asked on the page of the level it was granted at (Basic Witchcraft at
 *     6th → its lesson on the Level 6 page), not on the Level 1 / subclass page.
 *  7. The Feats tab lists a non-data notice (Oatia Skysage's named cantrips) under "Check this", never under
 *     the red "Missing data" heading.
 *  8. On a phone the Spells tab's header detail lives in the (i) popup, and the entry's NOTE went with it; the
 *     note now stays on the page under the header (the popup keeps its copy).
 * 10. Spellshot + Beast Gunner (owner ruling #162): the builder asks the spellshot's two at-will cantrips on its
 *     card and says why; the Spells tab's beast gunner entry says where they went.
 * 11. Pressing another tradition on an archetype's Tradition row asks first when it would clear picks, and
 *     pressing the one already lit does nothing (it cleared everything, silently).
 *
 * Synthetic characters only ("TEST …").
 */
const db = content();
const noop = () => undefined;
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
const T = 60_000;
const flat = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

const pc = (classId: string, level: number, featPicks: Record<string, string>, over: Partial<BuildState> = {}): BuildState =>
  ({
    ...emptyBuild(),
    name: 'TEST Spell Leftovers',
    level,
    classId,
    subclassId: db.classes[classId]?.subclass?.options[0]?.id ?? null,
    ancestryId: 'human',
    heritageId: 'versatile-human',
    backgroundId: Object.keys(db.backgrounds)[0],
    keyAbility: 'int',
    featPicks,
    ...over,
  }) as unknown as BuildState;

const chip = (host: HTMLElement, level: number) =>
  [...host.querySelectorAll<HTMLButtonElement>('button.lchip')].find((x) => flat(x.textContent) === String(level)) ?? null;
const openAt = (build: BuildState, level: number) => {
  const r = renderDom(<Builder content={db} initial={build} onCancel={noop} onCreate={noop} />);
  r.click(chip(r.host, level));
  return r;
};
/** A rank row of a level page: its locked grant chips and the notes under it. */
const row = (host: HTMLElement, label: string) => {
  const el = [...host.querySelectorAll('.spell-pick-row')].find((e) => flat(e.querySelector('.spr-head span')?.textContent) === label);
  return {
    found: !!el,
    grants: [...(el?.querySelectorAll('.spr-chip-book-grant') ?? [])].map((c) => flat(c.textContent)),
    locked: [...(el?.querySelectorAll('.spr-chip-book-grant') ?? [])].every((c) => !!c.querySelector('.ti-lock') && !c.querySelector('button')),
    notes: [...(el?.querySelectorAll('.spr-gift-note') ?? [])].map((c) => flat(c.textContent)),
  };
};
const pageText = (host: HTMLElement) => flat(host.querySelector('.lvl-page')?.textContent);
const pendingTag = (host: HTMLElement) => flat(host.querySelector('.lvl-page .lvl-pending-tag')?.textContent);
const flush = () => act(async () => void (await new Promise((res) => setTimeout(res, 0))));
const dialog = () => document.querySelector('.confirm-modal');
const dialogButton = (label: string) => [...(dialog()?.querySelectorAll('button') ?? [])].find((b) => flat(b.textContent) === label) ?? null;

describe('2 · the level page counts an Adapted Cantrip answer from no magical tradition as a choice left', () => {
  const wizard = (answer: string) => pc('wizard', 1, { '1:ancestry:0': 'adapted-cantrip' }, { featChoices: { '1:ancestry:0': answer } });
  it(
    'allegro (no tradition) leaves one more choice on Level 1 than a legal divine cantrip does',
    () => {
      const count = (b: BuildState) => {
        const r = openAt(b, 1);
        const n = Number(/(\d+)/.exec(pendingTag(r.host))?.[1] ?? 0);
        r.stop();
        return n;
      };
      expect(count(wizard('allegro'))).toBe(count(wizard('vitality-lash')) + 1);
    },
    T,
  );
});

describe('3 · a CLASS witch / necromancer sees the spell a record adds to its book', () => {
  it(
    'witch, Basic Lesson (Life) at 2nd: the familiar’s 1st-rank row shows Spirit Link LOCKED, named "by Lesson of Life"',
    () => {
      const b = pc('witch', 2, { '2:class:0': 'basic-lesson' }, { featChoices: { '2:class:0': 'aon-lesson-of-life' }, cantrips: ['daze', 'shield'], spells: { 1: ['fear', 'command'] } });
      const r = openAt(b, 2);
      const first = row(r.host, '1st rank');
      expect(first.found).toBe(true);
      expect(first.grants).toEqual(['Spirit Link']);
      expect(first.locked).toBe(true);
      expect(first.notes.some((n) => /^Spirit Link is added to your familiar by Lesson of Life/.test(n))).toBe(true);
      r.stop();
    },
    T,
  );
  it(
    'necromancer, Expanded Necromancy at 10th: the dirge’s 5th-rank row shows Grisly Growths LOCKED',
    () => {
      const b = pc('necromancer', 10, { '10:class:0': 'expanded-necromancy' }, { cantrips: ['daze', 'shield'] });
      const sheet = buildCharacter(b, db);
      expect(Object.values(sheet.spellcasting.find((e) => e.id === 'necromancer-casting')?.grantedRepertoire ?? {}).flat()).toContain('grisly-growths');
      const r = openAt(b, 10);
      const fifth = row(r.host, '5th rank');
      expect(fifth.grants).toEqual(['Grisly Growths']);
      expect(fifth.notes.some((n) => /Grisly Growths is added to your dirge by Expanded Necromancy/.test(n))).toBe(true);
      r.stop();
    },
    T,
  );
});

const WITCH_DED = {
  '2:class:0': 'witch-dedication',
  '4:class:1': 'basic-witch-spellcasting',
  '6:class:2': 'basic-witchcraft',
  '8:class:3': 'advanced-witchcraft',
  '10:class:4': 'advanced-witchcraft',
  '12:class:5': 'expert-witch-spellcasting',
  '18:class:6': 'master-witch-spellcasting',
};

describe('6 · a granted feat asks its own question on the page of the level it was granted at', () => {
  it(
    'Basic Witchcraft at 6th → Basic Lesson: "Basic Lesson: …" is on the Level 6 page, not on Level 1',
    () => {
      const b = pc('fighter', 6, { '2:class:0': 'witch-dedication', '4:class:1': 'basic-witch-spellcasting', '6:class:2': 'basic-witchcraft' }, { keyAbility: 'str', pickFeatChoices: { '6:class:2': 'basic-lesson' } });
      const r = renderDom(<Builder content={db} initial={b} onCancel={noop} onCreate={noop} />);
      r.click(chip(r.host, 1));
      expect(pageText(r.host)).not.toMatch(/Basic Lesson:/);
      r.click(chip(r.host, 6));
      expect(pageText(r.host)).toMatch(/Basic Lesson:/);
      r.stop();
    },
    T,
  );
});

describe('5 · two Major Lessons through two Advanced Witchcraft feats get two questions', () => {
  it(
    'Level 8 asks "Major Lesson: …", Level 10 asks "Major Lesson (taken at level 10): …"',
    () => {
      const b = pc('fighter', 20, WITCH_DED, { keyAbility: 'str', pickFeatChoices: { '8:class:3': 'major-lesson', '10:class:4': 'major-lesson' }, cantrips: ['daze', 'shield'] });
      const r = renderDom(<Builder content={db} initial={b} onCancel={noop} onCreate={noop} />);
      r.click(chip(r.host, 8));
      expect(pageText(r.host)).toMatch(/Major Lesson: /);
      expect(pageText(r.host)).not.toMatch(/Major Lesson \(taken at level/);
      r.click(chip(r.host, 10));
      expect(pageText(r.host)).toMatch(/Major Lesson \(taken at level 10\): /);
      r.stop();
    },
    T,
  );
  it(
    'the level-10 question greys the lesson the level-8 taking already holds, and says why ("a different lesson each time")',
    () => {
      const b = pc('fighter', 20, WITCH_DED, {
        keyAbility: 'str',
        pickFeatChoices: { '8:class:3': 'major-lesson', '10:class:4': 'major-lesson' },
        grantedFeatChoices: { 'major-lesson': 'aon-lesson-of-bargains' },
        cantrips: ['daze', 'shield'],
      });
      const r = renderDom(<Builder content={db} initial={b} onCancel={noop} onCreate={noop} />);
      r.click(chip(r.host, 10));
      const card = [...r.host.querySelectorAll('.lvl-page *')].find((e) => flat(e.textContent).startsWith('Major Lesson (taken at level 10)') && e.querySelector('button'));
      r.click(card!.querySelector('button'));
      const why = [...document.querySelectorAll('.picker-overlay .picker-why')].map((e) => flat(e.textContent));
      expect(why).toContain('Already chosen by another Major Lesson — each time, choose a different one.');
      r.stop();
    },
    T,
  );
  it(
    'an answer left behind by a taking since removed greys nothing: the one taking left may pick that lesson again',
    () => {
      const b = pc('fighter', 20, { ...WITCH_DED, '8:class:3': 'expert-witch-spellcasting' }, {
        keyAbility: 'str',
        pickFeatChoices: { '10:class:4': 'major-lesson' },
        grantedFeatChoices: { 'major-lesson': 'aon-lesson-of-bargains', 'major-lesson#10:class:4': 'aon-lesson-of-death' },
        cantrips: ['daze', 'shield'],
      });
      const r = renderDom(<Builder content={db} initial={b} onCancel={noop} onCreate={noop} />);
      r.click(chip(r.host, 10));
      const card = [...r.host.querySelectorAll('.lvl-page *')].find((e) => flat(e.textContent).startsWith('Major Lesson (taken at level 10)') && e.querySelector('button'));
      expect(card, 'the level-10 taking keeps its own answer card').toBeTruthy();
      r.click(card!.querySelector('button'));
      const why = [...document.querySelectorAll('.picker-overlay .picker-why')].map((e) => flat(e.textContent));
      expect(why.filter((w) => /Already chosen by another Major Lesson/.test(w))).toEqual([]);
      r.stop();
    },
    T,
  );
});

describe('7 · the Feats tab keeps "Missing data" for missing data', () => {
  it(
    'Oatia Skysage with a cantrip it does not name: "Check this", and no "Missing data" heading',
    () => {
      const ch = buildCharacter(pc('fighter', 2, { '2:class:0': 'oatia-skysage-dedication' }, { keyAbility: 'str', cantrips: ['daze', 'guidance'] }), db);
      const r = renderDom(<FeatsTab character={ch} content={db} onPlay={noop} />);
      const text = flat(r.host.textContent);
      expect(text).not.toMatch(/Missing data/);
      const box = r.host.querySelector('[data-check-notices]');
      expect(flat(box?.textContent)).toMatch(/^Check this — one thing on this character needs a look:\s?Oatia Skysage Dedication: Daze is not one of the cantrips/);
      r.stop();
    },
    T,
  );
  it(
    'Bright Fetchling’s missing spell still shows under "Missing data"',
    () => {
      const ch = buildCharacter(pc('fighter', 1, {}, { keyAbility: 'str', ancestryId: 'fetchling', heritageId: 'bright-fetchling' }), db);
      const r = renderDom(<FeatsTab character={ch} content={db} onPlay={noop} />);
      expect(flat(r.host.querySelector('.ff-warnings')?.textContent)).toMatch(/^Missing data/);
      expect(r.host.querySelector('[data-check-notices]')).toBeNull();
      r.stop();
    },
    T,
  );
});

describe('10 · Spellshot + Beast Gunner says where the spellshot cantrips went', () => {
  const pair = (over: Partial<BuildState> = {}) =>
    pc('gunslinger', 6, { '2:class:0': 'spellshot-dedication', '4:class:1': 'beast-gunner-dedication' }, { keyAbility: 'dex', cantrips: ['ray-of-frost'], ...over });
  it(
    'the builder’s Level 2 page: the Spellshot card asks two cantrips at will and says why',
    () => {
      const r = openAt(pair(), 2);
      const box = r.host.querySelector('[data-held-dedication-cantrips]');
      expect(flat(box?.textContent)).toBe(
        'Beast Gunner Dedication holds your archetype spells, so your 2 Spellshot Dedication cantrips are cast at will as innate arcane cantrips. On the Spells tab they are listed under Innate spells.',
      );
      // …and two pickers under it (its SubCard), both still empty.
      const card = box?.parentElement;
      expect(flat(card?.textContent).match(/Choose a cantrip…/g)).toHaveLength(2);
      r.stop();
    },
    T,
  );
  // package I, desk #162 (2026-10-17): the Spellshot card's own NOTE (the record's `note`, one text for every character) told
  // the pairing the cantrips are prepared in the archetype's picker and that the wizard feats give the slots — the
  // opposite of the box right above it. It now carries the Beast Gunner clause too, in the same words.
  it(
    'the builder’s Level 2 page: the Spellshot card’s record note no longer contradicts the box, it says the Beast Gunner case too',
    () => {
      const r = openAt(pair(), 2);
      const note = [...r.host.querySelectorAll('.lvl-note')].map((n) => flat(n.textContent)).find((t) => /four arcane cantrips/.test(t));
      expect(note, 'fixture: the Spellshot card shows its record note').toBeTruthy();
      expect(note).toContain('If you also take Beast Gunner Dedication, it holds your archetype spells instead');
      expect(note).toContain('cast at will as innate arcane cantrips');
      expect(note).toContain("spell slots come from the beast gunner's own spellcasting feats");
      r.stop();
    },
    T,
  );
  it(
    'the Spells tab: the beast gunner entry names the two cantrips and where they are',
    () => {
      const ch = buildCharacter(pair({ effectChoices: { 'spellshot-dedication:spellbook-cantrip-1': 'daze', 'spellshot-dedication:spellbook-cantrip-2': 'shield' } }), db);
      const r = renderDom(<SpellsTab character={ch} content={db} onPlay={noop} />);
      expect(flat(r.host.textContent)).toContain(
        'Beast Gunner Dedication holds your archetype spells, so your Spellshot Dedication cantrips (Daze, Shield) are cast at will as innate arcane cantrips — they are listed under Innate spells.',
      );
      r.stop();
    },
    T,
  );
});

describe('8 · on a phone the entry’s note stays on the page, not only behind the (i)', () => {
  it(
    'Spellshot + Beast Gunner on a phone: the note shows under the header; on a desktop it is the header’s own line',
    () => {
      const ch = buildCharacter(pc('gunslinger', 6, { '2:class:0': 'spellshot-dedication', '4:class:1': 'beast-gunner-dedication' }, { keyAbility: 'dex', cantrips: ['ray-of-frost'] }), db);
      const phone = renderDom(
        <ForceMobileContext.Provider value={true}>
          <SpellsTab character={ch} content={db} onPlay={noop} />
        </ForceMobileContext.Provider>,
      );
      expect(phone.host.querySelector('.sc-name-btn'), 'fixture: the phone header (the (i) button)').toBeTruthy();
      expect(flat(phone.host.querySelector('[data-entry-note="beast-gunner-dedication-casting"]')?.textContent)).toMatch(
        /^Beast Gunner Dedication holds your archetype spells, so your 2 Spellshot Dedication cantrips are cast at will/,
      );
      phone.stop();
      const desk = renderDom(
        <ForceMobileContext.Provider value={false}>
          <SpellsTab character={ch} content={db} onPlay={noop} />
        </ForceMobileContext.Provider>,
      );
      expect(desk.host.querySelector('[data-entry-note]'), 'a desktop shows it once, in the header').toBeNull();
      expect(flat(desk.host.querySelector('.sc-detail')?.textContent)).toMatch(/Spellshot Dedication cantrips are cast at will/);
      desk.stop();
    },
    T,
  );
});

describe('11 · changing an archetype’s tradition asks before it clears picks', () => {
  it(
    'Beast Gunner on a fighter: pressing Primal asks "Change tradition?" and names the cantrip; Cancel keeps it',
    async () => {
      const b = pc('fighter', 2, { '2:class:0': 'beast-gunner-dedication' }, { keyAbility: 'str', cantrips: ['ray-of-frost'] });
      const r = openAt(b, 2);
      const btn = (label: string) => [...r.host.querySelectorAll<HTMLButtonElement>('button.inv-toggle')].find((x) => flat(x.textContent) === label) ?? null;
      const hostText = () => flat(r.host.textContent);
      expect(btn('Arcane')?.className).toMatch(/\bon\b/);
      // The tradition already lit: nothing happens, nothing is cleared.
      r.click(btn('Arcane'));
      await flush();
      expect(dialog()).toBeNull();
      expect(hostText()).toMatch(/Ray of Frost/);
      r.click(btn('Primal'));
      await flush();
      expect(flat(dialog()?.textContent)).toMatch(/Change tradition\?.*Cantrips \(1\) — Ray of Frost/);
      r.click(dialogButton('Cancel'));
      await flush();
      await flush();
      expect(hostText()).toMatch(/Ray of Frost/);
      expect(btn('Arcane')?.className).toMatch(/\bon\b/);
      r.stop();
    },
    T,
  );
  it(
    'a CLERIC with Beast Gunner Dedication: the Level 0 "Archetype spellcasting" card asks the same before clearing its pool',
    async () => {
      const b = pc('cleric', 2, { '2:class:0': 'beast-gunner-dedication' }, {
        keyAbility: 'wis',
        archetypeSpells: { cantrips: ['ray-of-frost'], spells: {}, tradition: 'arcane' },
      } as unknown as Partial<BuildState>);
      const r = openAt(b, 0);
      const card = [...r.host.querySelectorAll('*')].find((e) => flat(e.textContent).startsWith('Archetype spellcasting') && e.querySelector('button.inv-toggle'));
      const btn = (label: string) => [...(card?.querySelectorAll<HTMLButtonElement>('button.inv-toggle') ?? [])].find((x) => flat(x.textContent) === label) ?? null;
      expect(btn('Arcane')?.className, 'fixture: the card and its lit tradition').toMatch(/\bon\b/);
      r.click(btn('Arcane'));
      await flush();
      expect(dialog()).toBeNull();
      r.click(btn('Primal'));
      await flush();
      expect(flat(dialog()?.textContent)).toMatch(/Change tradition\?.*Cantrips \(1\) — Ray of Frost/);
      r.click(dialogButton('Cancel'));
      await flush();
      await flush();
      expect(btn('Arcane')?.className).toMatch(/\bon\b/);
      expect(flat(card?.textContent)).toMatch(/Ray of Frost/);
      r.stop();
    },
    T,
  );
});
