// @vitest-environment jsdom
import { createElement, act } from 'react';
import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { Builder } from '../src/builder/Builder';
import { emptyBuild, type BuildState } from '../src/rules/build';

/**
 * "trying to pick skill in lv 0 not working, it lets me pick the first skill but not the second" and
 * "when i get another skill slot it lets me pick every skill except the last" — owner, 2026-09-15.
 *
 * Both are one defect, and it is a DISAGREEMENT, not a missing option: the card that draws the free
 * trained-skill slots (SkillEditor) asks the ENGINE which skills are already granted, while
 * `toggleSkill` re-derived that set from four sources — class-fixed, background trained skill,
 * heritage, subclass grants — out of the nine `buildCharacter` locks. A skill granted by one of the
 * other five sitting in `build.classSkills` therefore counted against the cap in the setter and not
 * in the card, so the card drew a slot the setter refused to fill: a click that did nothing, gave no
 * reason, and left the slot open.
 *
 * A real save exposed it; the synthesized fixture below holds the same shape — a lizardfolk guardian
 * with the Guard background, whose Legal Lore is the background's own `choice` grant AND sits in
 * `classSkills`. 3 slots, 2 spendable by the card, 3 spent by the setter. Adversarially confirmed
 * against the reverted engine lock set, not assumed.
 *
 * The increase picker (the other reading of "every skill except the last") is exercised here too:
 * every row of it is clicked in turn, on the guardian at 7th and on a fresh 3rd-level fighter, and
 * the last one must land like the rest. The one last row that legitimately cannot be picked — a
 * record-LOCKED Lore, Bardic Lore — has to be greyed AND say so, never look like the dead slot above.
 */
const noop = () => undefined;
const flush = () => act(async () => void (await new Promise((res) => setTimeout(res, 0))));

/**
 * The shape the defect lives in: a level-7 lizardfolk guardian with the Guard background, whose
 * `classSkills` holds the Legal Lore that background's own Lore choice already grants plus two real
 * picks. The Int boost at 5th is load-bearing — lizardfolk's Int flaw would otherwise leave the
 * guardian 2 free trainings, not 3, and there would be no slot to argue about.
 */
const GUARDIAN: BuildState = {
  ...emptyBuild(),
  name: 'Guardian fixture',
  level: 7,
  ancestryId: 'lizardfolk',
  heritageId: 'frilled-lizardfolk',
  backgroundId: 'guard',
  classId: 'guardian',
  keyAbility: 'str',
  ancestryBoosts: ['con'],
  backgroundBoosts: ['str', 'con'],
  levelBoosts: ['con', 'str', 'cha', 'wis'],
  attributeBoosts: { 5: ['con', 'str', 'int', 'wis'] },
  classSkills: ['lore:legal', 'crafting', 'society'],
  skillIncreases: { 3: 'athletics', 5: 'intimidation', 7: 'athletics' },
};

const open = (initial: BuildState) =>
  renderDom(createElement(Builder, { content: content(), initial, onCancel: noop, onCreate: noop }));
/** The level strip's page button — "0" is the origins page, "3"/"7" the level pages. */
const page = (r: { host: HTMLElement }, label: string) => {
  const b = [...r.host.querySelectorAll('.lstrip button')].find((x) => (x.textContent ?? '').trim() === label);
  expect(b, `no "${label}" page on the level strip`).toBeTruthy();
  return b!;
};
/** PopupSelect mounts its list on <body>, not inside the host — look app-wide. */
const rows = () => [...document.querySelectorAll('.picker-overlay .picker-item')] as HTMLButtonElement[];
const rowName = (x: Element) => (x.querySelector('.picker-name')?.textContent ?? '').trim();
const emptySkillSlots = (r: { host: HTMLElement }) =>
  r.host.querySelectorAll('[data-ctl-title="Add a trained skill"]').length;
/** The "n/m" count the Trained skills card prints in its own heading. */
const skillCount = (r: { host: HTMLElement }) =>
  (r.host.querySelector('[data-setupcard="Trained skills"] .ol-count')?.textContent ?? '').trim() || null;

async function originsPage(b: BuildState) {
  const r = open(b);
  r.click(page(r, '0'));
  await flush();
  return r;
}
/** Open the first empty trained-skill slot and choose the first option that isn't greyed. */
async function fillOneSkillSlot(r: ReturnType<typeof open>) {
  const slot = r.host.querySelector('[data-ctl-title="Add a trained skill"]');
  expect(slot, 'no empty trained-skill slot on the origins page').toBeTruthy();
  r.click(slot!);
  await flush();
  const live = rows().filter((x) => !x.disabled && rowName(x) !== 'Learn a new lore');
  expect(live.length, 'the trained-skill picker offered nothing').toBeGreaterThan(0);
  const name = rowName(live[0]);
  r.click(live[0]);
  await flush();
  return name;
}

const FRESH_FIGHTER: BuildState = {
  ...emptyBuild(),
  name: 'Fresh',
  level: 3,
  ancestryId: 'human',
  heritageId: 'versatile-human',
  backgroundId: 'acolyte',
  classId: 'fighter',
  keyAbility: 'str',
};
/** A 3rd-level bard holding Bardic Lore — the one Lore a record forbids increasing. */
const BARD_WITH_BARDIC_LORE: BuildState = {
  ...emptyBuild(),
  name: 'Kyra',
  level: 3,
  ancestryId: 'catfolk',
  heritageId: 'clawed-catfolk',
  backgroundId: 'acolyte',
  classId: 'bard',
  subclassId: 'enigma',
  keyAbility: 'cha',
  featPicks: { '2:class:0': 'bardic-lore' },
};

describe("the free trained-skill slots take the picks the card offers", () => {
  // bug 2026-09-15: builder skills
  it('fills the last open slot on a guardian whose Lore is also a grant', async () => {
    const r = await originsPage(GUARDIAN);
    const before = emptySkillSlots(r);
    expect(before, 'the guardian should open with one unspent trained-skill slot').toBe(1);
    const picked = await fillOneSkillSlot(r);
    // THE failure line: with toggleSkill's own four-source lock set, Legal Lore counted as a spent
    // pick, `3 < 3` was false, the updater returned the build unchanged and this stayed at 1.
    expect(emptySkillSlots(r), `picking ${picked} left the slot open — toggleSkill refused it`).toBe(before - 1);
    expect(skillCount(r), 'the card should read all three picks spent').toBe('3/3');
    r.stop();
  });

  // bug 2026-09-15: builder skills
  it('takes a second pick after the first — the owner\'s exact report', async () => {
    const r = await originsPage(GUARDIAN);
    // Clear one of the two spent picks so TWO slots are open, which is the shape he described.
    const clear = [...r.host.querySelectorAll<HTMLButtonElement>('.lvl-clear-btn')].find((b) =>
      (b.getAttribute('aria-label') ?? '').startsWith('Remove Crafting'),
    );
    expect(clear, 'no clear button on the Crafting slot').toBeTruthy();
    r.click(clear!);
    await flush();
    expect(emptySkillSlots(r)).toBe(2);
    const first = await fillOneSkillSlot(r);
    expect(emptySkillSlots(r), `the FIRST pick (${first}) was refused`).toBe(1);
    const second = await fillOneSkillSlot(r);
    // The line the owner reported: the first landed, the second did not.
    expect(emptySkillSlots(r), `the SECOND pick (${second}) was refused`).toBe(0);
    r.stop();
  });

  // bug 2026-09-15: builder skills
  it('never offers a slot on a character whose every pick is granted elsewhere', async () => {
    // A guardian whose classSkills hold NOTHING but the background's own Legal Lore: the card must
    // draw three open slots (the grant is not a pick), and all three must fill.
    const r = await originsPage({ ...GUARDIAN, classSkills: ['lore:legal'] });
    expect(emptySkillSlots(r)).toBe(3);
    for (let i = 3; i > 0; i--) {
      const name = await fillOneSkillSlot(r);
      expect(emptySkillSlots(r), `pick ${4 - i} (${name}) was refused`).toBe(i - 1);
    }
    r.stop();
  });
});

describe('the skill-increase picker', () => {
  /** Open level `lvl`'s "Skill increase" picker and return its row labels. */
  async function increaseRows(b: BuildState, lvl: string) {
    const r = open(b);
    r.click(page(r, lvl));
    await flush();
    const ctl = document.querySelector('[data-ctl-title="Skill increase"]');
    expect(ctl, `no skill-increase control on level ${lvl}`).toBeTruthy();
    r.click(ctl!.querySelector('.ss-replace') ?? ctl!);
    await flush();
    return { r, list: rows() };
  }

  // bug 2026-09-15: builder skills
  it.each([
    ['a 7th-level guardian', 'guardian', '7'],
    ['a fresh 3rd-level fighter', 'fresh', '3'],
  ])('lets %s pick EVERY option, the last one included', async (_label, who, lvl) => {
    const build = who === 'guardian' ? GUARDIAN : FRESH_FIGHTER;
    const probe = await increaseRows(build, lvl);
    const names = probe.list.map(rowName).filter((n) => n !== 'Learn a new lore');
    probe.r.stop();
    expect(names.length, 'the increase picker offered nothing').toBeGreaterThan(10);
    for (let i = 0; i < names.length; i++) {
      // One fresh Builder per option: a pick has to land from the SAME starting state each time, or
      // the last row would only ever be tried against a list the earlier picks had already moved.
      const { r, list } = await increaseRows(build, lvl);
      r.click(list[i]);
      await flush();
      const ctl = document.querySelector('[data-ctl-title="Skill increase"]');
      const landed = (ctl?.querySelector('.popsel-val')?.textContent ?? '').trim();
      // THE failure line for "it lets me pick every skill except the last": an option that is offered
      // live and does nothing when clicked. Reads the control's own value, not the build, so a pick
      // that lands in state but never reaches the screen fails here too.
      expect(landed, `option ${i + 1} of ${names.length} — "${names[i]}" — did not take`).toBe(names[i]);
      r.stop();
    }
  }, 120000);

  // bug 2026-09-15: builder skills
  it('greys the one last row that cannot be picked AND says why', async () => {
    const { r, list } = await increaseRows(BARD_WITH_BARDIC_LORE, '3');
    const options = list.filter((x) => rowName(x) !== 'Learn a new lore');
    const last = options[options.length - 1];
    expect(rowName(last)).toMatch(/^Bardic Lore/);
    expect(last.disabled, 'Bardic Lore can be raised by no other means — it must be greyed').toBe(true);
    // A greyed last row with no reason is indistinguishable from the dead slot this file exists for.
    expect((last.querySelector('.picker-why')?.textContent ?? '').trim()).toMatch(/can't be increased/i);
    // …and nothing ELSE in the list is greyed, so "every skill except the last" is the whole of it.
    expect(options.filter((x) => x.disabled).map(rowName)).toEqual([rowName(last)]);
    r.stop();
  });
});
