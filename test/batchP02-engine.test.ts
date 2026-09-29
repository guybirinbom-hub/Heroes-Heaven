// @vitest-environment jsdom
// jsdom for the builder leg of friend-of-a-friend: a free-text Lore is only a mechanic if the player
// can SEE the box and type the subject. The engine assertions are pure and unaffected by the environment.
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { build, content } from './_content';
import { renderDom } from './_render';
import { Builder } from '../src/builder/Builder';
import { backgroundChosenLoreKeys, buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { affixHostType } from '../src/rules/attachments';
import type { Character, ContentDatabase, ProficiencyKey } from '../src/rules/types';

const db = content();

/**
 * Batch P02 (print-read lane), engine family.
 *
 * ⚠ The database is PATCHED or STRIPPED in memory rather than read: the friend-of-a-friend overlay row
 * lives in work/.bP02-rows-engine.json and has not been applied yet (the driver applies it), so the
 * shipped record carries no `trainedLoreChoice`. Every leg asserts on a patched copy AND a stripped
 * copy — never a patched-vs-shipped delta, which would flip the moment the row lands.
 */
const patched = <T extends object>(rec: T, patch: Record<string, unknown>): T => {
  const out = { ...rec } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete out[k];
    else out[k] = v;
  }
  return out as T;
};
const withBackground = (id: string, patch: Record<string, unknown>): ContentDatabase =>
  ({ ...db, backgrounds: { ...db.backgrounds, [id]: patched(db.backgrounds[id], patch) } }) as ContentDatabase;

/** The exact field the overlay row in work/.bP02-rows-engine.json sets. */
const ROW = { trainedLoreChoice: true };
const ruled = withBackground('friend-of-a-friend', ROW);
const stripped = withBackground('friend-of-a-friend', { trainedLoreChoice: undefined });

const mkBuild = (over: Partial<BuildState>): BuildState =>
  ({
    ...emptyBuild(),
    name: 't',
    level: 1,
    classId: 'fighter',
    keyAbility: 'str',
    ancestryId: 'human',
    heritageId: 'skilled-human',
    backgroundId: 'friend-of-a-friend',
    ...over,
  }) as BuildState;
const rank = (ch: Character, key: string) => ch.proficiencies.skills[key as ProficiencyKey];
const COOKING = 'lore:cooking' as ProficiencyKey;

describe('batch P02 engine — friend-of-a-friend trains a food-or-drink Lore (background-650)', () => {
  // batch P02: friend-of-a-friend#lore
  // AoN background-650: "You're trained in the Athletics skill, and a Lore skill associated with any
  // sort of food or drink". The subject is the player's, so the row is the free-text lane
  // (`trainedLoreChoice`, read by backgroundChosenLoreKeys + the build.ts trainedLoreChoice arm).
  it('friend-of-a-friend trains the typed Lore beside Athletics once the record asks', () => {
    const ch = buildCharacter(mkBuild({ backgroundLore: 'Cooking' }), ruled);
    expect(rank(ch, COOKING), 'the typed food-or-drink Lore is trained').toBe('trained');
    expect(rank(ch, 'athletics'), 'Athletics stays the fixed half').toBe('trained');
    expect(backgroundChosenLoreKeys(mkBuild({ backgroundLore: 'Cooking' }), ruled)).toEqual([COOKING]);
  });

  // batch P02: friend-of-a-friend#lore
  it('friend-of-a-friend without the field trains no Lore at all (the shipped defect)', () => {
    const ch = buildCharacter(mkBuild({ backgroundLore: 'Cooking' }), stripped);
    expect(rank(ch, COOKING), 'no carrier, no Lore — what the read measured').not.toBe('trained');
    expect(backgroundChosenLoreKeys(mkBuild({ backgroundLore: 'Cooking' }), stripped)).toEqual([]);
  });

  // batch P02: friend-of-a-friend#lore
  // Print names no default subject ("any sort of food or drink"), so the row carries no
  // trainedLoreChoiceDefault and an unanswered box trains nothing rather than an invented subject.
  it('friend-of-a-friend with the box unanswered trains no invented Lore', () => {
    expect(backgroundChosenLoreKeys(mkBuild({ backgroundLore: '' }), ruled)).toEqual([]);
  });

  // batch P02: friend-of-a-friend#lore
  it('friend-of-a-friend shows the player a Lore box in the builder only when the record asks', () => {
    const boxes = (content_: ContentDatabase) => {
      const r = renderDom(
        createElement(Builder, { content: content_, initial: mkBuild({}), onCancel: () => undefined, onCreate: () => undefined }),
      );
      // Page 0 is Origins — where the background and its Lore box live (OriginPickers in shared.tsx).
      r.click([...r.host.querySelectorAll<HTMLButtonElement>('.lstrip button')].find((b) => (b.textContent ?? '').trim() === '0') ?? null);
      const n = [...r.host.querySelectorAll<HTMLInputElement>('input.lvl-lore-input')].filter(
        (el) => el.placeholder === 'Lore subject (e.g. Warfare)…',
      ).length;
      r.stop();
      return n;
    };
    expect(boxes(ruled), 'one free-text Lore box').toBe(1);
    expect(boxes(stripped), 'and none without the field').toBe(0);
  });
});

/*
 * enhanced-familiar#ability-budget — the READER is `familiarAbilityBudget` in src/rules/companions.ts,
 * outside this family's files (CROSS-FILE GAP in work/.bP02-report-engine.txt). What this family can
 * pin is the reader's INPUT: every route by which a character comes to own Enhanced Familiar lands the
 * feat on the BUILT character's `feats`, so the companions.ts reader can key on
 * `character.feats.some((f) => f.featId === 'enhanced-familiar')` the way attachments.ts keys on
 * talismanic-sage. Measured here rather than assumed: CHOICE_FEAT_GRANTS routes are exactly the kind
 * that once silently granted nothing.
 */
describe('batch P02 engine — enhanced-familiar reaches the built character (feat-4717)', () => {
  const owns = (ch: Character, id: string) => ch.feats.some((f) => f.featId === id);

  // batch P02: enhanced-familiar#ability-budget
  // AoN feat-4717: "You can select four familiar or master abilities each day, instead of two."
  it('enhanced-familiar taken at a wizard 2nd-level class feat slot is on the built character', () => {
    const ch = build('wizard', 2, { keyAbility: 'int', featPicks: { '2:class': 'enhanced-familiar' } } as Partial<BuildState>);
    expect(owns(ch, 'enhanced-familiar')).toBe(true);
    const without = build('wizard', 2, { keyAbility: 'int', featPicks: {} } as Partial<BuildState>);
    expect(owns(without, 'enhanced-familiar'), 'and absent when not taken').toBe(false);
  });

  // batch P02: enhanced-familiar#ability-budget
  it('enhanced-familiar granted by Familiar Master Dedication (the "already had a familiar" answer) is on the built character', () => {
    const has = (answer?: string) =>
      owns(
        build('fighter', 2, {
          featPicks: { '2:class': 'familiar-master-dedication' },
          ...(answer ? { featChoices: { '2:class': answer } } : {}),
        } as unknown as Partial<BuildState>),
        'enhanced-familiar',
      );
    expect(has('yes')).toBe(true);
    expect(has('no'), 'the new-familiar branch gains a familiar, not the feat').toBe(false);
  });
});

/*
 * strikers-scroll#affix — the READER is `isAttachable` / `attachKind` / `planAffix` in
 * src/rules/attachments.ts, outside this family's files (CROSS-FILE GAP). Pinned here: the two
 * premises the gap's spec relies on, so the attachments.ts change needs no new host route.
 */
describe('batch P02 engine — strikers-scroll premises (feat-9059)', () => {
  // batch P02: strikers-scroll#affix
  // Print: "You can attach a scroll to your weapon or handwraps of mighty blows". Handwraps already
  // count as a WEAPON host for affixing, so the scroll permission needs only the weapon host type.
  it('strikers-scroll: handwraps of mighty blows are already a weapon host for affixing', () => {
    expect(affixHostType(db.items['handwraps-of-mighty-blows'])).toBe('weapon');
  });

  // batch P02: strikers-scroll#affix
  it('strikers-scroll taken at a magus 4th-level class feat slot is on the built character', () => {
    const ch = build('magus', 4, { featPicks: { '4:class': 'strikers-scroll' } } as Partial<BuildState>);
    expect(ch.feats.some((f) => f.featId === 'strikers-scroll')).toBe(true);
  });
});
