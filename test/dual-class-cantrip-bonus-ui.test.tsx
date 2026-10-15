// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { Builder } from '../src/builder/Builder';
import { SpellsTab } from '../src/sheet/SpellsTab';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { applyPlayState, initialPlay } from '../src/rules/play';
import type { Character } from '../src/rules/types';

/**
 * DUAL CLASS: A CANTRIP BONUS FEEDS ITS OWN CLASS — what the player SEES (2026-10-15).
 *
 * test/dual-class-cantrip-bonus.test.ts holds the engine: Cantrip Expansion (Player Core, feat-4580,
 * *"Prepared Caster (Cleric, Wizard, etc.): You can prepare two additional cantrips each day."*) taken by a
 * Wizard/Druid's wizard no longer raises the druid's five to seven. This file holds the screens for the
 * save that had already filled seven: every pick is still drawn, the two past the cap say so, and both
 * the builder row and the sheet's Prepare panel show all seven.
 *
 * The Prepare panel leg was found in the browser on the first try of the fix: with no play state yet,
 * the panel drew `cantripCap` openings (5), so two cantrips the card list showed had no opening to
 * re-prepare. Both the panel and the play overlay size by `cantripOpenings` now.
 *
 * Fixtures are synthetic ("TEST …"), never an owner's character.
 */
const db = content();
const noop = () => undefined;
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  for (const n of [...document.body.children]) n.remove();
});
const T = 60_000;
const flat = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

const SEVEN = ['caustic-blast', 'detect-magic', 'electric-arc', 'frostbite', 'gouging-claw', 'guidance', 'ignition'];
// A prepared class: a cantrip prepared on the sheet past the cap is emptied there, not in the builder.
const OVER = 'One too many — this class has 5 cantrips; leave one empty with the Prepare button, or remove one in the builder';
const b = (cantrips2: string[]): BuildState =>
  ({
    ...emptyBuild(),
    name: 'TEST dual-class cantrips',
    level: 2,
    classId: 'wizard',
    classId2: 'druid',
    variantRules: { dualClass: true },
    subclassId: db.classes.wizard.subclass?.options[0]?.id ?? null,
    subclassId2: db.classes.druid.subclass?.options[0]?.id ?? null,
    ancestryId: 'human',
    heritageId: 'versatile-human',
    backgroundId: Object.keys(db.backgrounds)[0],
    keyAbility: 'int',
    featPicks: { '2:class:0': 'cantrip-expansion' },
    cantrips2,
  }) as BuildState;

/** The druid pool's cantrip cards on the Spells tab (the second pool drawn, after the wizard's): name and note. */
const druidCards = (ch: Character) => {
  const r = renderDom(<SpellsTab character={ch} content={db} onPlay={noop} />);
  try {
    const hdrs = [...r.host.querySelectorAll('.spell-rankhdr')].filter((h) => flat(h.textContent).startsWith('Cantrips'));
    expect(hdrs.length, 'a Cantrips header per pool').toBe(2);
    return [...(hdrs[1].parentElement?.querySelectorAll('.spell-grid .spell-card:not(.empty)') ?? [])].map((c) => ({
      name: flat(c.querySelector('.spell-name')?.textContent),
      note: flat(c.querySelector('.spell-offbook-note')?.textContent) || undefined,
    }));
  } finally {
    r.stop();
  }
};
/** Manage spells on the DRUID pool (the second button) → its cantrip openings' names. */
const druidOpenings = (ch: Character): string[] => {
  const r = renderDom(<SpellsTab character={ch} content={db} onPlay={noop} />);
  try {
    const manage = [...r.host.querySelectorAll<HTMLButtonElement>('button.ms-btn')].filter((x) => x.title === 'Manage spells for this session');
    expect(manage.length, 'one Manage button per pool').toBe(2);
    r.click(manage[1]);
    const box = [...r.host.querySelectorAll('.ms-rank')].find((x) => flat(x.querySelector('.ms-rank-hdr')?.textContent) === 'Cantrips');
    return [...(box?.querySelectorAll('button.ms-slot .ms-slot-name') ?? [])].map((x) => flat(x.textContent));
  } finally {
    r.stop();
  }
};
const names = SEVEN.map((id) => db.spells[id]!.name);

describe('an old Wizard/Druid save with seven druid cantrips', () => {
  it('the fixture: seven distinct primal cantrips', () => {
    for (const id of SEVEN) expect(db.spells[id]?.traditions, id).toContain('primal');
  });
  // mutation-proof
  it('the Spells tab draws all seven, the last two marked over the limit — with and without a play state', { timeout: T }, () => {
    const ch = buildCharacter(b(SEVEN), db);
    for (const sheet of [ch, applyPlayState(ch, initialPlay(ch, db), db)]) {
      const cards = druidCards(sheet);
      expect(cards.map((c) => c.name)).toEqual(expect.arrayContaining(names));
      expect(cards.filter((c) => c.note === OVER).map((c) => c.name)).toEqual(names.slice(5));
    }
    // Control: a druid that kept to its five shows no note.
    expect(druidCards(buildCharacter(b(SEVEN.slice(0, 5)), db)).some((c) => c.note === OVER)).toBe(false);
  });
  // mutation-proof
  it('the Prepare panel has an opening for every one of the seven — with and without a play state', { timeout: T }, () => {
    const ch = buildCharacter(b(SEVEN), db);
    expect(druidOpenings(ch), 'no play state: the panel sizes itself').toEqual(names);
    expect(druidOpenings(applyPlayState(ch, initialPlay(ch, db), db)), 'the overlay').toEqual(names);
    expect(druidOpenings(buildCharacter(b(SEVEN.slice(0, 5)), db)), 'control: five').toEqual(names.slice(0, 5));
  });
  it('the builder row on the druid card reads 7 / 5 and lists all seven', { timeout: T }, () => {
    const r = renderDom(<Builder content={db} initial={b(SEVEN)} onCancel={noop} onCreate={noop} />);
    try {
      r.click([...r.host.querySelectorAll<HTMLButtonElement>('.lstrip button')].find((x) => flat(x.textContent) === '0') ?? null);
      const card = r.host.querySelector('[data-setupcard="Druid spells — Primal prepared"]');
      expect(card, 'the second class card').toBeTruthy();
      const row = [...(card?.querySelectorAll<HTMLElement>('.spell-pick-row') ?? [])].find((x) => /cantrips/i.test(x.querySelector('.spr-head span')?.textContent ?? ''));
      expect(flat(row?.querySelector('.spr-count')?.textContent)).toBe('7 / 5');
      for (const n of names) expect(flat(row?.textContent), n).toContain(n);
    } finally {
      r.stop();
    }
  });
});
