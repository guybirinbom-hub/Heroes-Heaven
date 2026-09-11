// @vitest-environment jsdom
/*
 * BATCH 037 — MOLTEN WIT, all three printed branches (desk #12).
 *
 * AoN feat-3930: "You either become trained in Deception and gain the Charming Liar skill feat, or you
 * become trained in Diplomacy and gain the Group Impression skill feat. If you're already trained in
 * one of these skills, you must take the other and can choose from either skill feat. If you're
 * trained in both skills, you become trained in a different skill of your choice instead and can
 * choose from either skill feat."
 *
 * Only the first branch was built. The other two hang on a fact the BUILT character cannot state —
 * "already trained" means trained by something OTHER than this feat, and the built character's ranks
 * already contain this feat's own grant — so the engine half of this lane is `Character.skillRankBefore`,
 * buildCharacter's snapshot of the named skills taken inside the feat-grant expansion, where no feat
 * grant has been applied yet.
 *
 * ⚠ NO JSX, deliberately: the lane's deliverable is `test/batch037-molten-wit.test.ts` and a .ts file
 *   cannot carry JSX. `createElement` renders the same tree.
 *
 * ⚠ THE RECORD HALF IS A SPEC ROW the closer applies through the driver
 *   (work/.b037-rows-molten-wit.json), so public/core.json does not carry it while this file is
 *   written. The row's own `value` is therefore read from that file and laid on the content database:
 *   the exact object the closer will write, read from the one place it lives, so this test cannot
 *   drift from the row and the assignment becomes an identity once the apply has run.
 */
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { Builder } from '../src/builder/Builder';
import { buildCharacter, emptyBuild, levelGrants, type BuildState } from '../src/rules/build';
import { qualifiesForOption } from '../src/rules/derive';
import { SKILL_RANK_BEFORE_OWN_GRANTS } from '../src/rules/featFeatGrants';
import { setEngineTrustOff } from '../src/rules/trustLanes';
import type { Character } from '../src/rules/types';

const db = content();
const specRow = (
  JSON.parse(readFileSync('work/.b037-rows-molten-wit.json', 'utf8')) as {
    findings: { backfillRows: { id: string; field: string; value: unknown }[] }[];
  }
).findings[0].backfillRows.find((r) => r.id === 'molten-wit' && r.field === 'choice')!;
(db.feats['molten-wit'] as unknown as { choice: unknown }).choice = specRow.value;

const noop = () => undefined;

function ancestrySlot(): string {
  const g = levelGrants(1, 'fighter', db, null, undefined, null, null, false, []);
  const i = g.featSlots.findIndex((s) => s === 'ancestry');
  expect(i, 'no ancestry slot at level 1 for a fighter').toBeGreaterThanOrEqual(0);
  return `1:ancestry:${i}`;
}
const SLOT = ancestrySlot();

/**
 * Three hosts, one per printed branch, differing ONLY in what trained Deception and Diplomacy before
 * Molten Wit ran.
 *  - `neither`  — acolyte (Religion + Scribing Lore) and no free class skill.
 *  - `deception`— truth-seeker, which trains Deception and grants Lie to Me (deliberately NOT one of
 *                 this feat's two skill feats, so the grant assertions stay about Molten Wit).
 *  - `both`     — truth-seeker plus Diplomacy as one of the fighter's three free class skills.
 */
const host = (branch: 'neither' | 'deception' | 'both', over: Partial<BuildState> = {}): BuildState =>
  ({
    ...emptyBuild(),
    name: 't',
    level: 1,
    classId: 'fighter',
    ancestryId: 'human',
    heritageId: 'skilled-human',
    backgroundId: branch === 'neither' ? 'acolyte' : 'truth-seeker',
    classSkills: branch === 'both' ? ['diplomacy'] : [],
    keyAbility: 'str',
    featPicks: { [SLOT]: 'molten-wit' },
    ...over,
  }) as unknown as BuildState;

const build = (branch: 'neither' | 'deception' | 'both', over: Partial<BuildState> = {}): Character =>
  buildCharacter(host(branch, over), db);
const rank = (c: Character, s: string) => c.proficiencies.skills[s as 'deception'] ?? 'untrained';
const has = (c: Character, id: string) => c.feats.some((f) => f.featId === id);

/** Every `[data-ctl]` control on the level-1 page, plus the page text. */
function page(b: BuildState) {
  const r = renderDom(createElement(Builder, { content: db, initial: b, onCancel: noop, onCreate: noop }));
  const tab = [...r.host.querySelectorAll<HTMLButtonElement>('.lstrip button')].find((x) => (x.textContent ?? '').trim() === '1');
  r.click(tab ?? null);
  const ctls = [...r.host.querySelectorAll<HTMLElement>('[data-ctl]')].map((el) => ({
    ctl: el.dataset.ctl,
    title: el.dataset.ctlTitle ?? '',
    options: Number(el.dataset.ctlOptions ?? 0),
  }));
  const text = r.host.textContent ?? '';
  r.stop();
  return { ctls, text };
}

describe('batch 037 — Molten Wit builds all three printed branches', () => {
  // batch 037: molten-wit#three-branches
  it('the control asks the one question print leaves open in every branch, and carries both halves of its own sentence', () => {
    const def = db.feats['molten-wit'].choice!;
    // The ANSWER VALUES are the skills, unchanged from the shipped record, so a saved character keeps
    // the answer they gave; the LABEL is the skill feat, which is the half that is open in all three
    // branches ("…and can choose from either skill feat").
    expect(def.options?.map((o) => o.value)).toEqual(['deception', 'diplomacy']);
    expect(def.options?.map((o) => o.label)).toEqual(['Charming Liar', 'Group Impression']);
    expect(def.options?.[0].grant).toEqual({ skills: { deception: 'trained' }, grantsFeats: ['charming-liar'] });
    expect(def.options?.[1].grant).toEqual({ skills: { diplomacy: 'trained' }, grantsFeats: ['group-impression'] });
    // The engine snapshot has to cover exactly the two skills the sentence asks about.
    expect(SKILL_RANK_BEFORE_OWN_GRANTS['molten-wit']).toEqual(['deception', 'diplomacy']);
  });

  // batch 037: molten-wit#three-branches
  it('branch one — trained in neither: the answer trains its own skill and grants its own paired feat', () => {
    const c = build('neither', { featChoices: { [SLOT]: 'diplomacy' } });
    expect(c.skillRankBefore?.['molten-wit']).toEqual({ deception: 'untrained', diplomacy: 'untrained' });
    expect(rank(c, 'diplomacy')).toBe('trained');
    expect(rank(c, 'deception')).toBe('untrained');
    expect(has(c, 'group-impression')).toBe(true);
    expect(has(c, 'charming-liar'), 'the branch pairs one feat with one skill').toBe(false);
    // Nothing is owed a replacement pick, and nothing is trained the player did not ask for.
    expect((c.skillFallbacks ?? []).some((f) => f.featId === 'molten-wit')).toBe(false);
    // The other answer is the mirror image of it.
    const other = build('neither', { featChoices: { [SLOT]: 'deception' } });
    expect(rank(other, 'deception')).toBe('trained');
    expect(rank(other, 'diplomacy')).toBe('untrained');
    expect(has(other, 'charming-liar')).toBe(true);
  });

  /*
   * mutation-proof — this pins the LANE, not the record. Delete the `untrained.length === 1` arm of the
   * Molten Wit block in src/rules/build.ts and this `it` dies on the Diplomacy assertion: the option's
   * own grant trains Deception, which this character already has, so nothing at all would happen and
   * the player would pay an ancestry feat for a skill feat alone. Every other test in this file stays
   * green through that deletion. Adversarially confirmed by deleting the arm and re-running.
   */
  // batch 037: molten-wit#three-branches
  it('branch two — already trained in one: the OTHER skill is granted, and either skill feat may be taken', () => {
    // The background trained Deception, so print forces Diplomacy and leaves the feat open.
    const liar = build('deception', { featChoices: { [SLOT]: 'deception' } });
    expect(liar.skillRankBefore?.['molten-wit']).toEqual({ deception: 'trained', diplomacy: 'untrained' });
    expect(rank(liar, 'diplomacy'), 'you must take the other skill').toBe('trained');
    expect(rank(liar, 'deception')).toBe('trained');
    expect(has(liar, 'charming-liar'), 'either skill feat — this branch does not re-pair them').toBe(true);
    expect(has(liar, 'group-impression')).toBe(false);
    // …and the other feat, on the same forced skill.
    const impression = build('deception', { featChoices: { [SLOT]: 'diplomacy' } });
    expect(rank(impression, 'diplomacy')).toBe('trained');
    expect(has(impression, 'group-impression')).toBe(true);
    // The forced skill lands even with the control untouched: print says "must", not "may".
    const unanswered = build('deception');
    expect(rank(unanswered, 'diplomacy')).toBe('trained');
    expect(has(unanswered, 'charming-liar')).toBe(false);
    // No free-skill pick is owed here — that is the THIRD branch, and offering it would hand this
    // character a skill the book does not give them (the Intuitive Crafting defect, one record over).
    expect((liar.skillFallbacks ?? []).some((f) => f.featId === 'molten-wit')).toBe(false);
  });

  // batch 037: molten-wit#three-branches
  it('branch three — trained in both: a free skill of your choice, plus either skill feat', () => {
    const owed = build('both', { featChoices: { [SLOT]: 'diplomacy' } });
    expect(owed.skillRankBefore?.['molten-wit']).toEqual({ deception: 'trained', diplomacy: 'trained' });
    expect(has(owed, 'group-impression')).toBe(true);
    const fb = (owed.skillFallbacks ?? []).find((f) => f.featId === 'molten-wit');
    expect(fb, 'the replacement pick is owed and must be reported for the builder').toBeTruthy();
    expect(fb!.note).toBe('Already trained in Deception and Diplomacy');
    // Answering it trains the skill the player chose, and nothing else moved.
    const picked = build('both', {
      featChoices: { [SLOT]: 'diplomacy' },
      featSkillChoices: { 'molten-wit:fallback:deception': 'stealth' },
    });
    expect(rank(picked, 'stealth')).toBe('trained');
    expect(has(picked, 'group-impression')).toBe(true);
    // Unanswered, it trains nothing — the pick is the player's, never a default.
    expect(rank(owed, 'stealth')).toBe('untrained');
  });

  /*
   * mutation-proof — the CONTROL, not the reader. Both of these render the real builder page the
   * player uses, so a branch whose question exists only in the engine fails here: delete the option
   * grants from the spec row and the first assertion still passes (the popup is the record's own
   * `choice`), but delete the `untrained.length === 0` arm in build.ts and the replacement picker
   * below never mounts, because the builder renders it off `Character.skillFallbacks`.
   */
  // batch 037: molten-wit#three-branches
  it('the player SEES one control in branches one and two, and two controls in branch three', () => {
    const skillFeat = (b: BuildState) => page(b).ctls.filter((x) => x.ctl === 'popup' && x.title === 'Skill feat');
    const replacement = (b: BuildState) => page(b).ctls.filter((x) => x.ctl === 'popup' && x.title === 'Replacement skill');

    // Branch one: the paired pick, both options live.
    const one = skillFeat(host('neither'));
    expect(one, 'the feat/skill control must render on the level page').toHaveLength(1);
    expect(one[0].options).toBe(2);
    expect(replacement(host('neither')), 'no replacement pick is owed in branch one').toHaveLength(0);

    // Branch two: the same control, still both feats — print re-opens the feat here, it does not close it.
    const two = skillFeat(host('deception', { featChoices: { [SLOT]: 'deception' } }));
    expect(two).toHaveLength(1);
    expect(two[0].options).toBe(2);
    expect(replacement(host('deception', { featChoices: { [SLOT]: 'deception' } }))).toHaveLength(0);

    // Branch three: the feat control AND the free-skill control, both on screen.
    const three = host('both', { featChoices: { [SLOT]: 'diplomacy' } });
    expect(skillFeat(three)).toHaveLength(1);
    expect(replacement(three), 'the free-skill pick must be visible, not only computed').toHaveLength(1);
    expect(page(three).text).toContain('Already trained in Deception and Diplomacy');
  });

  /*
   * THE GATE THE LANE EXISTS FOR, on a record that is not Molten Wit.
   *
   * `qualifiesForOption` used to read the BUILT character, so an option gated "max: untrained" on the
   * skill its own grant trains vanished from the menu the moment it was answered. 112 of the 118 such
   * gates in public/core.json are that shape. `skillRankBefore` is absent for those records, so they
   * keep the old reading — this asserts the fallback is intact, which is what makes the new field
   * additive rather than a silent re-gating of 118 options.
   */
  // batch 037: molten-wit#three-branches
  it('a record the snapshot does not cover still reads the built ranks', () => {
    const c = build('neither', { featChoices: { [SLOT]: 'diplomacy' } });
    expect(Object.keys(c.skillRankBefore ?? {})).toEqual(['molten-wit']);
    /* …and that is what `qualifiesForOption` does with it. The gate reads the SNAPSHOT when it is
     * asked about the record the snapshot covers and the BUILT ranks otherwise, which is what makes
     * the field additive rather than a silent re-gating of the 118 `requiresSkillRank` options — the
     * assertion above only said the snapshot is narrow, never that the reader honours the boundary. */
    const two = build('deception', { featChoices: { [SLOT]: 'deception' } });
    expect(rank(two, 'diplomacy')).toBe('trained'); // built: branch two forced it
    expect(two.skillRankBefore?.['molten-wit']?.diplomacy).toBe('untrained'); // before: it was not
    const gate = { skill: 'diplomacy', max: 'untrained' } as const;
    expect(qualifiesForOption(two, gate, 'molten-wit'), 'the snapshot answers for its own record').toBe(true);
    expect(qualifiesForOption(two, gate), 'no record named — the built rank, exactly as before').toBe(false);
    expect(qualifiesForOption(two, gate, 'another-record'), 'a record the snapshot misses keeps the old reading').toBe(false);
  });

  /*
   * mutation-proof — WHEN the clause is asked, not just what it reads. Drop the `takenAt` argument
   * from the snapshot call in src/rules/build.ts (or the `asOf` arm of `skillRankHere`) and this dies:
   * the built ranks contain the 3rd-level increase, so a 1st-level feat's *"if you're already
   * trained"* reads true for a skill the character trained two levels AFTER taking it. Adversarially
   * confirmed by removing the argument and re-running — this `it` is the only one that fails.
   */
  // batch 037: molten-wit#three-branches
  it('a LATER skill increase does not flip the branch — "already trained" is about the level it was taken', () => {
    // Untrained in both at 1st level, answer Deception: print's FIRST branch, and nothing about a
    // 3rd-level increase can change that. Spending it on Deception used to read as "already trained"
    // and hand the character Diplomacy free.
    const c = build('neither', { level: 3, featChoices: { [SLOT]: 'deception' }, skillIncreases: { 3: 'deception' } } as Partial<BuildState>);
    expect(c.skillRankBefore?.['molten-wit']).toEqual({ deception: 'untrained', diplomacy: 'untrained' });
    expect(rank(c, 'diplomacy'), 'the second branch must not fire').toBe('untrained');
    expect((c.skillFallbacks ?? []).some((f) => f.featId === 'molten-wit')).toBe(false);
    // The record's own half is untouched by any of this: the answer still trains its skill and
    // hands over the feat printed with it.
    expect(rank(c, 'deception')).toBe('trained');
    expect(has(c, 'charming-liar')).toBe(true);
  });

  /*
   * mutation-proof — THE TRUST LANE. The two branches are an id-keyed engine lane, so they are on the
   * books in scripts/data/trust-lanes.json as `"gated": true`, and that entry is a CLAIM about the
   * code: nothing else goes red if the `engineLaneOff('molten-wit')` guard in src/rules/build.ts is
   * deleted (trust-lanes-check only asks that the id is listed, not that it is honoured). Remove the
   * guard and this `it` is the only failure. The gate must reach the branches for the same reason the
   * approval names a record path: the paired half of the same printed sentence is `choice.options[]
   * .grant.skills`, which the ledger strips — a branch it cannot reach would keep training a skill the
   * ledger had just taken off the option beside it.
   */
  // batch 037: molten-wit#three-branches
  it('the two branches go quiet while the engine lane is off, and the record half is untouched', () => {
    setEngineTrustOff(['molten-wit']);
    try {
      // Branch two, gated: no forced other skill. The background's Deception and the option's own
      // grant (a record field, gated separately by the ledger) still stand.
      const two = build('deception', { featChoices: { [SLOT]: 'deception' } });
      expect(rank(two, 'diplomacy'), 'the forced skill is the lane, and the lane is off').toBe('untrained');
      expect(rank(two, 'deception')).toBe('trained');
      expect(has(two, 'charming-liar'), 'the record half is not this lane').toBe(true);
      // Branch three, gated: no replacement pick is owed.
      const three = build('both', { featChoices: { [SLOT]: 'diplomacy' } });
      expect((three.skillFallbacks ?? []).some((f) => f.featId === 'molten-wit')).toBe(false);
    } finally {
      // The setter is module-global: a leaked OFF list would silently darken the rest of the suite.
      setEngineTrustOff([]);
    }
    // …and with it back on, branch two fires again — so the assertions above are the gate, not a bug.
    expect(rank(build('deception', { featChoices: { [SLOT]: 'deception' } }), 'diplomacy')).toBe('trained');
  });
});
