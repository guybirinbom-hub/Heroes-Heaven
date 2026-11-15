// @vitest-environment jsdom
import { act, createElement } from 'react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { applyTrustGate, clearTrustGate } from '../src/data/trustGate';
import { content } from './_content';
import { renderDom } from './_render';
import { mk, slot, SKILL_ORDER_CASES, unstamped } from './fixtures/skill-order-cases';

/**
 * THE BUILDER NOTICE AND THE STAMP (skill-order plan work/skill-rank-level-by-level/plan.md 3.3, D13, WP9; guards
 * G7 and G10; ruling 3 of 2026-10-21: "Show a Builder notice that names what changed on that character; say nothing
 * when nothing changed").
 *
 * A build saved before the level-by-level order (no `BuildState.skillOrder`) opened in the PLAYER's Builder shows,
 * once, one plain sentence per thing the new order changed (src/rules/skillOrderNotice.ts) on the Setup page and on
 * the level page where it happened; the draft is stamped `skillOrder: 2` at open and Save stores it, so the notice
 * never shows again. Cancel stores nothing (it shows again next open). Stamped and new builds, and builds the order
 * left alone, render no notice element at all. The GM's edit sheet (`skillOrderNotice={false}`) neither shows nor
 * stamps. Stored answers that no longer count are kept (plan 3.2). The silent-everywhere-else sweep over the parity
 * snapshot is test/skill-rank-notice-sweep.test.ts (the instrument runs in node only).
 * Synthetic characters only.
 */

vi.mock('../src/sheet/download', () => ({
  downloadText: vi.fn(async () => 'saved'),
  fileSlug: (s: string) => s.replace(/\W+/g, '-').toLowerCase(),
}));

const { Builder } = await import('../src/builder/Builder');
const { GmEditSheet } = await import('../src/sheet/GmEditSheet');
const { buildCharacter, emptyBuild } = await import('../src/rules/build');
const { openForSkillOrder, skillOrderStamped, stampSkillOrderSave } = await import('../src/rules/blocks/save');
const { SKILL_ORDER_NOTICE_HEADING, SKILL_ORDER_NOTICE_SHOWN, skillOrderChanges } = await import('../src/rules/skillOrderNotice');
const { rebuildRoster } = await import('../src/data/rebuild');
const { initialPlay } = await import('../src/rules/play');
const { downloadText } = await import('../src/sheet/download');
import type { BuildState } from '../src/rules/build';
import type { SavedChar } from '../src/data/storage';
import type { ContentDatabase } from '../src/rules/types';

const db = content();
afterAll(() => clearTrustGate());
const caseBuild = (id: string): BuildState => {
  const c = SKILL_ORDER_CASES.find((x) => x.id === id);
  if (!c) throw new Error(`no case ${id}`);
  // As the roster holds an old save: read back through JSON, without the stamp.
  return JSON.parse(JSON.stringify(unstamped(c.build))) as BuildState;
};
const texts = (b: BuildState, host: ContentDatabase = db) => skillOrderChanges(b, host).map((l) => l.text);

/* G7: the words a player must never read in it (plan 3.3 wording rules). Whole words only, with their own endings
 * (skill-order WP9F: G7, the WP9 checker's finding 2): a substring match failed "Water Sprint" on "print". */
const FORBIDDEN = /\b(?:overrid(?:e|es|ed|den|ing)|engines?|legacy|print(?:s|ed|ing)?|ledgers?|history|histories|wanderers?)\b/i;
/** Every way a line can break the wording rules: a forbidden word, a raw record id (lower-case hyphenated), a bare
 *  level number ("at 3" instead of "at 3rd"), a rank word in lower case beside an arrow. */
function wordingProblems(line: string): string[] {
  const out: string[] = [];
  if (FORBIDDEN.test(line)) out.push(`forbidden word: ${line}`);
  if (/\b[a-z]+(?:-[a-z]+)+\b/.test(line)) out.push(`raw id: ${line}`);
  if (/\b(?:at|level)\s+\d+\b(?!st|nd|rd|th)/.test(line) || /\(\d+\)/.test(line)) out.push(`bare level: ${line}`);
  if (/\b(?:untrained|trained|expert|master|legendary)\s+→|→\s+(?:untrained|trained|expert|master|legendary)\b/.test(line)) out.push(`lower-case rank at an arrow: ${line}`);
  return out;
}

/* ─────────────────────────────── the lines ─────────────────────────────── */

describe('what the notice says (plan 3.3 lines 1-7)', () => {
  it('K1s, an old save: the Stealth rank line names its steps, and the replacement line names the kept Arcana pick', () => {
    expect(texts(caseBuild('K1s'))).toEqual([
      'Stealth: Trained → Expert (Kholo Lore at 1st, skill increase at 3rd).',
      'Kholo Lore (1st) no longer gives a replacement skill: Stealth was not trained yet when you took it. Your earlier pick, Arcana, is kept but no longer counts.',
    ]);
    // …and the stored answer is never touched by reading the notice.
    const b = caseBuild('K1s');
    const before = JSON.stringify(b);
    skillOrderChanges(b, db);
    expect(JSON.stringify(b)).toBe(before);
  });

  it("line 1 still names a stored answer's skill that ALSO moves for another reason (WP9F; WP9 checker finding 1)", () => {
    // K1s's twin: the same kept Arcana pick, and Wizard Dedication at 2nd also trains Arcana, so the 5th-level Arcana
    // increase now makes it expert (today's order spent that increase before the dedication: Arcana stayed trained).
    // Line 2 explains only the replacement's own step; the Trained → Expert move is not that step, so line 1 shows.
    // (Synthetic; the engine does not gate the dedication's attribute prerequisite.)
    const twin = unstamped(
      mk({
        classId: 'fighter', ancestryId: 'kholo', heritageId: 'dog-kholo', level: 5,
        featPicks: { [slot(1, 'fighter', 'ancestry')]: 'kholo-lore', [slot(2, 'fighter', 'class')]: 'wizard-dedication' },
        skillIncreases: { 3: 'stealth', 5: 'arcana' },
        featSkillChoices: { 'kholo-lore:fallback:stealth': 'arcana' },
      }),
    );
    expect(texts(twin)).toEqual([
      'Arcana: Trained → Expert (Wizard Dedication at 2nd, skill increase at 5th).',
      'Stealth: Trained → Expert (Kholo Lore at 1st, skill increase at 3rd).',
      'Kholo Lore (1st) no longer gives a replacement skill: Stealth was not trained yet when you took it. Your earlier pick, Arcana, is kept but no longer counts.',
      'Wizard Dedication (2nd) no longer gives a replacement skill: Arcana was not trained yet when you took it.',
    ]);
    // K1s itself: Arcana Trained → Untrained is exactly the old replacement's own step, so no Arcana line 1.
    expect(texts(caseBuild('K1s')).filter((t) => t.startsWith('Arcana:'))).toEqual([]);
    // The mirror (line 3): a kept pick that counts again moves its skill by exactly the replacement's step only.
    const a6 = { ...caseBuild('A6e'), featSkillChoices: { 'the-brave:fallback:athletics': 'crafting' } } as BuildState;
    expect(texts(a6).filter((t) => t.startsWith('Crafting:'))).toEqual([]);
  });

  it('K1 without a stored pick: no "earlier pick" sentence', () => {
    expect(texts(caseBuild('K1'))[1]).toBe('Kholo Lore (1st) no longer gives a replacement skill: Stealth was not trained yet when you took it.');
  });

  it('line 3 names a class OPTION by its name, never its id (A6e: Root Epithet The Brave at 3rd; carried WP5 F3)', () => {
    const lines = texts(caseBuild('A6e'));
    expect(lines).toEqual(['The Brave (3rd) now lets you pick a replacement skill: Athletics was already trained. Pick it on the 3rd-level page.']);
    expect(lines.join(' ')).not.toContain('the-brave');
    // A5e: the dedication's replacement goes, the epithet's comes.
    expect(texts(caseBuild('A5e'))).toEqual([
      'Barbarian Dedication (2nd) no longer gives a replacement skill: Athletics was not trained yet when you took it.',
      'The Brave (3rd) now lets you pick a replacement skill: Athletics was already trained. Pick it on the 3rd-level page.',
    ]);
  });

  it('line 3 with an answer already stored: it counts again', () => {
    const b = { ...caseBuild('A6e'), featSkillChoices: { 'the-brave:fallback:athletics': 'crafting' } } as BuildState;
    expect(texts(b)).toEqual(['The Brave (3rd) now lets you pick a replacement skill: Athletics was already trained. Your earlier pick, Crafting, counts again.']);
  });

  it('line 4: a rank-gated feat lost (S1) and one arriving at another level (RI1)', () => {
    expect(texts(caseBuild('S1'))).toEqual([
      "Crafting: Trained → Expert (Stonemason's Eye at 1st, skill increase at 3rd).",
      "Stonemason's Eye no longer gives Specialty Crafting: Crafting was untrained when you took it at 1st.",
    ]);
    expect(texts(caseBuild('RI1'))).toEqual(['Raging Intimidation now gives Scare to Death at 15th, not at 1st.']);
  });

  it('line 5: Dual Class increases that now count (DC1); an increase that no longer raises its skill (Medic Dedication first)', () => {
    expect(texts(caseBuild('DC1'))).toEqual([
      'Acrobatics: Trained → Expert (your Fighter class at 1st, skill increase at 2nd).',
      'Deception: Untrained → Trained (skill increase at 4th).',
      'Your 2nd-level skill increase (Acrobatics) now counts.',
      'Your 4th-level skill increase (Deception) now counts.',
    ]);
    // fighter 4, Medic Dedication at 2nd (expert in Medicine; prerequisite trained in Medicine), Medicine increase at 3rd.
    const medic = unstamped(mk({ classId: 'fighter', ancestryId: 'human', heritageId: 'versatile-human', level: 4, featPicks: { [slot(2, 'fighter', 'class')]: 'medic-dedication' }, skillIncreases: { 3: 'medicine' } }));
    expect(buildCharacter(medic, db).proficiencies.skills.medicine, 'fixture: Medicine ends expert both ways').toBe('expert');
    expect(texts(medic)).toEqual([
      'Your 3rd-level skill increase on Medicine no longer raises it: it is already Expert by then, the most a 3rd-level increase gives.',
      'Medic Dedication (2nd) needs Trained in Medicine, which you reach at 3rd.',
    ]);
  });

  it('line 6: a feat whose skill prerequisite is met only at a later level (P5: Powerful Leap at 3rd, expert Athletics at 5th)', () => {
    const p5 = unstamped(mk({ classId: 'fighter', ancestryId: 'human', heritageId: 'versatile-human', level: 5, classSkills: ['athletics'], featPicks: { [slot(3, 'fighter', 'general')]: 'powerful-leap' }, skillIncreases: { 5: 'athletics' } }));
    expect(texts(p5)).toEqual(['Powerful Leap (3rd) needs Expert in Athletics, which you reach at 5th.']);
    // P5b: the increase at 3rd, the feat at 4th — met, nothing to say.
    const p5b = unstamped(mk({ classId: 'fighter', ancestryId: 'human', heritageId: 'versatile-human', level: 5, classSkills: ['athletics'], featPicks: { [slot(4, 'fighter', 'class')]: 'powerful-leap' }, skillIncreases: { 3: 'athletics' } }));
    expect(texts(p5b)).toEqual([]);
  });

  it('line 7: new empty Dual Class increase slots (DC1n names 2nd and 4th)', () => {
    const lines = skillOrderChanges(caseBuild('DC1n'), db);
    expect(lines.map((l) => l.text)).toEqual(['You now get a skill increase at 2nd and 4th level from your second class. Pick them on those level pages.']);
    expect(lines[0].levels).toEqual([2, 4]);
  });

  it('silent where the order changed nothing (K2, B1, BJ2, OV1, OV4, SN1, DC2, a new character)', () => {
    for (const id of ['K2', 'B1', 'BJ2', 'OV1', 'OV4', 'SN1', 'DC2']) expect(texts(caseBuild(id)), id).toEqual([]);
    expect(texts(emptyBuild())).toEqual([]);
  });

  it('G7: every line of every skill-order case, at both trust gates, keeps the wording rules', () => {
    // The gated db is loaded OUTSIDE the gate window (content() leaves the gate-on code lanes set, globally), and
    // the lanes are cleared after: a later Builder test must never inherit them (it once lost K1s's Arcana line).
    const gated = content({ trustGate: true });
    clearTrustGate();
    const problems: string[] = [];
    let lines = 0;
    for (const host of [db, gated]) {
      if (host === gated) applyTrustGate(db);
      try {
        for (const c of SKILL_ORDER_CASES) {
          for (const l of skillOrderChanges(unstamped(c.build), host)) {
            lines++;
            problems.push(...wordingProblems(l.text).map((p) => `${c.id}: ${p}`));
          }
        }
      } finally {
        clearTrustGate();
      }
    }
    expect(lines, 'the cases really produce lines').toBeGreaterThan(60);
    expect(problems).toEqual([]);
    expect(wordingProblems(SKILL_ORDER_NOTICE_HEADING)).toEqual([]);
    // The checker bites: each planted line breaks one rule.
    expect(wordingProblems('Stealth: trained → Expert (Kholo Lore at 1st).').length).toBe(1);
    expect(wordingProblems('kholo-lore (1st) no longer gives a replacement skill.').length).toBe(1);
    expect(wordingProblems('Your increase at 3 now counts.').length).toBe(1);
    expect(wordingProblems('The engine now orders skill ranks.').length).toBe(1);
    // Whole words: a feat named Water Sprint passes; the bare word "print" (and an inflection) still fails.
    expect(wordingProblems('Water Sprint (5th) needs Expert in Athletics, which you reach at 7th.')).toEqual([]);
    expect(wordingProblems('Skill ranks now follow the print order.').length).toBe(1);
    expect(wordingProblems('Your Overrides were kept.').length).toBe(1);
  });
});

/* ─────────────────────────────── the stamp (G10) ─────────────────────────────── */

describe('the skill-order stamp (D13, G10)', () => {
  it('openForSkillOrder / stampSkillOrderSave: stamp 2 on an old save, keep every answer, return a stamped build itself, keep a newer number', () => {
    const old = caseBuild('K1s');
    expect(skillOrderStamped(old)).toBe(false);
    const opened = openForSkillOrder(old, db);
    expect(opened.skillOrder).toBe(2);
    expect(opened.featSkillChoices).toEqual({ 'kholo-lore:fallback:stealth': 'arcana' });
    const { skillOrder: _s, ...rest } = opened;
    expect(JSON.stringify(rest), 'nothing else changes').toBe(JSON.stringify(old));
    expect(stampSkillOrderSave(opened, db)).toBe(opened);
    const newer = { ...old, skillOrder: 3 } as unknown as BuildState;
    expect(openForSkillOrder(newer, db)).toBe(newer);
    expect(skillOrderStamped({ skillOrder: '2' } as unknown as BuildState), 'UNKNOWN ≠ EMPTY: a string is no stamp').toBe(false);
    expect(emptyBuild().skillOrder, 'a new character starts stamped').toBe(2);
  });

  it('rebuildRoster never writes the stamp: every stored build comes back byte-equal, and the Character never carries it', () => {
    const builds = [caseBuild('K1s'), openForSkillOrder(caseBuild('K1s'), db), caseBuild('DC1n')];
    const roster: SavedChar[] = builds.map((b, i) => {
      const character = buildCharacter(b, db);
      return { id: `r${i}`, character, build: b, play: initialPlay(character, db) } as SavedChar;
    });
    const before = roster.map((r) => JSON.stringify(r.build));
    const out = rebuildRoster(roster, db);
    expect(out.map((r) => JSON.stringify(r.build))).toEqual(before);
    for (const r of out) expect('skillOrder' in (r.character as object), 'not on the Character').toBe(false);
  });

  it('only emptyBuild and the stamp in blocks/save.ts write `skillOrder` (source scan of src/)', () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(n)) files.push(p);
      }
    };
    walk('src');
    const writers: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      const re = /skillOrder\s*(?::|=(?!=))\s*2\b|skillOrder\s*=(?!=)/g;
      for (let m: RegExpExecArray | null; (m = re.exec(src)); ) {
        const line = src.slice(0, m.index).split('\n').length;
        const text = src.split('\n')[line - 1].trim();
        // The type declaration (`skillOrder?: 2;`) declares, it does not write.
        if (/skillOrder\?:\s*2;/.test(text)) continue;
        writers.push(`${f.replace(/\\/g, '/')}: ${text}`);
      }
    }
    expect([...new Set(writers.map((w) => w.split(':')[0]))].sort(), writers.join('\n')).toEqual(['src/rules/blocks/save.ts', 'src/rules/build.ts']);
    expect(writers.filter((w) => w.startsWith('src/rules/build.ts')), 'build.ts: emptyBuild only').toEqual(['src/rules/build.ts: skillOrder: 2,']);
  });
});

/* ─────────────────────────────── the Builder, mounted ─────────────────────────────── */

const cleanups: (() => void)[] = [];
afterEach(async () => {
  for (let i = 0; i < 4 && document.querySelector('.confirm-modal'); i++) {
    const keep = [...document.querySelectorAll('.confirm-modal .confirm-actions button')][0];
    await act(async () => {
      keep?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await settle();
  }
  while (cleanups.length) {
    try {
      cleanups.pop()!();
    } catch {
      /* already unmounted */
    }
  }
  await settle();
  for (const n of [...document.body.children]) n.remove();
});
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
}
const confirmBox = () => document.querySelector('.confirm-modal');
const buttonIn = (root: ParentNode | null, label: string) =>
  [...(root?.querySelectorAll('button') ?? [])].find((b) => (b.textContent ?? '').trim() === label) as HTMLButtonElement | undefined;
async function press(b: Element | null | undefined) {
  if (!b) throw new Error('no such button');
  await act(async () => {
    b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await settle();
}
function openBuilder(initial?: BuildState, more: { skillOrderNotice?: boolean } = {}) {
  const created: BuildState[] = [];
  let cancelled = 0;
  const r = renderDom(createElement(Builder, { content: db, initial, onCancel: () => void (cancelled += 1), onCreate: (b: BuildState) => void created.push(b), ...more }));
  cleanups.push(r.stop);
  return { r, created, cancelled: () => cancelled };
}
async function save(r: { host: HTMLElement }) {
  await press(r.host.querySelector('button.b-create'));
  for (let i = 0; i < 4 && confirmBox(); i++) await press(buttonIn(confirmBox(), 'Save anyway'));
}
const notice = (root: ParentNode = document) => root.querySelector('[data-skill-order-notice]');
const noticeLines = (root: ParentNode = document) => [...root.querySelectorAll('[data-skill-order-notice] li')].map((l) => (l.textContent ?? '').trim());
async function page(r: { host: HTMLElement }, label: string) {
  await press([...r.host.querySelectorAll('.lstrip button')].find((x) => (x.textContent ?? '').trim() === label));
}
const pageNotes = (root: ParentNode = document) => [...root.querySelectorAll('[data-skill-order-note]')].map((l) => (l.textContent ?? '').trim());

describe('the notice in the Builder (player host)', () => {
  it('an old K1s save: Setup shows the heading and both lines; the level pages show theirs; Save stamps and keeps the Arcana answer; reopening shows nothing', async () => {
    const initial = caseBuild('K1s');
    const stored = JSON.stringify(initial);
    const a = openBuilder(initial);
    const n = notice(a.r.host);
    expect(n, 'the notice is on the Setup page').not.toBeNull();
    expect((n!.querySelector('.skill-order-head')?.textContent ?? '').trim()).toBe(SKILL_ORDER_NOTICE_HEADING);
    expect(noticeLines(a.r.host)).toEqual(texts(initial));
    expect(noticeLines(a.r.host).join(' ')).toContain('Your earlier pick, Arcana, is kept');
    // Each line also on its level page: the rank line on 3rd, the replacement line on 1st.
    await page(a.r, '3');
    expect(pageNotes(a.r.host)).toEqual(['Stealth: Trained → Expert (Kholo Lore at 1st, skill increase at 3rd).']);
    await page(a.r, '1');
    expect(pageNotes(a.r.host)).toEqual([texts(initial)[1]]);
    await page(a.r, '2');
    expect(pageNotes(a.r.host)).toEqual([]);
    expect(JSON.stringify(initial), 'opening never touches the stored build').toBe(stored);

    await save(a.r);
    expect(a.created.length).toBe(1);
    const saved = a.created[0];
    expect(saved.skillOrder, 'Save stores the stamp').toBe(2);
    expect(saved.featSkillChoices?.['kholo-lore:fallback:stealth'], 'the orphaned answer is kept (plan 3.2)').toBe('arcana');

    // A second open of the saved build: no notice element at all.
    cleanups.pop()!();
    const b = openBuilder(JSON.parse(JSON.stringify(saved)) as BuildState);
    expect(notice(b.r.host)).toBeNull();
    expect(document.querySelector('[data-skill-order-note]')).toBeNull();
  }, 180_000);

  it('Cancel asks nothing and stores nothing: the notice shows again on the next open', async () => {
    const initial = caseBuild('K1s');
    const a = openBuilder(initial);
    expect(notice(a.r.host)).not.toBeNull();
    await press(a.r.host.querySelector('.builder-head .b-cancel'));
    expect(confirmBox(), 'Cancel asks nothing (the open stamp is not the player\'s change)').toBeNull();
    expect(a.cancelled()).toBe(1);
    expect(a.created).toEqual([]);
    cleanups.pop()!();
    const b = openBuilder(initial);
    expect(notice(b.r.host)).not.toBeNull();
  }, 120_000);

  it('no notice element for a stamped build, an old save the order left alone, or a new character', async () => {
    for (const initial of [openForSkillOrder(caseBuild('K1s'), db), caseBuild('K2'), undefined]) {
      const a = openBuilder(initial);
      if (!initial) await page(a.r, 'Setup');
      expect(document.querySelector('.bsec-title')?.textContent, 'the page rendered').toBeTruthy();
      expect(notice(a.r.host)).toBeNull();
      expect(document.querySelector('[data-skill-order-note]')).toBeNull();
      cleanups.pop()!();
    }
  }, 180_000);

  it('more than six lines: six show, "…and N more" opens the rest', async () => {
    // Dual Class fighter + rogue 8, an increase stored at every level 2-8: four now count (2nd, 4th, 6th, 8th)
    // and their four skills move, eight lines.
    const initial = unstamped(
      mk({ classId: 'fighter', classId2: 'rogue', variantRules: { dualClass: true }, ancestryId: 'human', heritageId: 'versatile-human', level: 8, skillIncreases: { 2: 'arcana', 3: 'crafting', 4: 'diplomacy', 5: 'medicine', 6: 'nature', 7: 'occultism', 8: 'society' } }),
    );
    const all = texts(initial);
    expect(all.length, 'fixture: more than six lines').toBeGreaterThan(SKILL_ORDER_NOTICE_SHOWN);
    const a = openBuilder(initial);
    expect(noticeLines(a.r.host)).toEqual(all.slice(0, SKILL_ORDER_NOTICE_SHOWN));
    const more = a.r.host.querySelector('.skill-order-more');
    expect((more?.textContent ?? '').trim()).toBe(`…and ${all.length - SKILL_ORDER_NOTICE_SHOWN} more`);
    await press(more);
    expect(noticeLines(a.r.host)).toEqual(all);
    expect(a.r.host.querySelector('.skill-order-more')).toBeNull();
  }, 120_000);
});

describe("the GM's edit (skillOrderNotice={false}, D13, G10)", () => {
  it('a Builder told not to: no notice, and its Save leaves `skillOrder` absent', async () => {
    const initial = caseBuild('K1s');
    const a = openBuilder(initial, { skillOrderNotice: false });
    expect(notice(a.r.host)).toBeNull();
    await page(a.r, '3');
    expect(document.querySelector('[data-skill-order-note]')).toBeNull();
    await save(a.r);
    expect(a.created.length).toBe(1);
    expect('skillOrder' in a.created[0], 'no stamp from the GM').toBe(false);
    expect(a.created[0].featSkillChoices?.['kholo-lore:fallback:stealth']).toBe('arcana');
  }, 120_000);

  it("GmEditSheet's Builder shows no notice and its Save stores no stamp", async () => {
    const build = caseBuild('K1s');
    const character = buildCharacter(build, db);
    const sheet: SavedChar = { id: 'pc-skill-order', character, build, play: initialPlay(character, db) } as SavedChar;
    const exported: string[] = [];
    vi.mocked(downloadText).mockImplementation(async (a: { text: string }) => {
      exported.push(a.text);
      return 'saved';
    });
    const r = renderDom(createElement(GmEditSheet, { initial: sheet, live: sheet, content: db, campaignId: 'camp-test', playerOwnerId: 'player-test', onExit: () => undefined }));
    cleanups.push(r.stop);
    const byLabel = (l: string) => document.querySelector(`button[aria-label="${l}"]`);
    await press(byLabel('Edit in builder'));
    expect(document.querySelector('.builder-head'), "the GM's Builder is open").not.toBeNull();
    expect(notice(), 'no notice for the GM').toBeNull();
    await save({ host: document.body });
    expect(document.querySelector('.builder-head'), "back on the GM's sheet").toBeNull();
    await press(byLabel('Export character file'));
    const afterSave = JSON.parse(exported[exported.length - 1]).build as BuildState;
    expect('skillOrder' in afterSave, 'the player still sees it on their own next open').toBe(false);
    expect(afterSave.featSkillChoices?.['kholo-lore:fallback:stealth']).toBe('arcana');
  }, 180_000);
});
