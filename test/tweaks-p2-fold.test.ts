/*
 * Tweaks phase 2 WP3 — the resolver fold (plan work/tweaks-phase2-notes/plan.md "### WP3", decision C24).
 *
 * Three answers used to be resolved in several copies inside build.ts: the background trained-skill choice
 * (`backgroundSkillChoice`), the class / subclass skill choice (`subclassSkill`) and the background's named
 * Lores (`backgroundLore`…`backgroundLore4`). WP3 folds every copy into one reader each —
 * `backgroundSkillPick`, `subclassSkillPick`, `backgroundLorePicks` — so feature 14 (WP10) can later teach
 * ONE reader a carried answer. The fold must change nothing, and this file proves it two ways:
 *   1. each reader equals the old inline copies, kept here VERBATIM as reference functions, over every parity
 *      spec and a synthetic grid of stored answers (listed, off-list, empty, duplicated) on every record that
 *      asks the question;
 *   2. a text ratchet: build.ts names the three stores only in the readers and the listed places, so a new
 *      copy cannot creep back in.
 * (A third proof — `levelChoices` / `setupMissing` / the restricted lanes deep-equal a pre-fold recording — was
 * green at WP3's commit and then removed at the merge, 2026-10-24: later WPs change those lines on purpose for the
 * p2 characters, and it skipped itself after any `npm run data`.)
 * The sheet's numbers are the parity snapshot's job (`--compare` + `--legacy-check`, both 0 at WP3).
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadEngine } from '../scripts/blocks-parity-snapshot.mjs';
import {
  backgroundLorePicks,
  backgroundSkillPick,
  backgroundTrainedSkill,
  emptyBuild,
  restrictedSkillIncreaseLanes,
  subclassSkillPick,
  type BuildState,
} from '../src/rules/build';
import { backgroundTrainings } from '../src/rules/blocks/book';
import { SKILLS, type Background, type ContentDatabase, type SkillId } from '../src/rules/types';

/* ---- the old copies, verbatim from c0560b0 (one function per shape; the call sites are named) ---------- */

/** build.ts backgroundTrainedSkill (choice half), boundBackgroundGrantChoice `bgSkill`, the trainedLoreByChoice
 *  pick in buildCharacter: the stored answer when offered, else the first option. */
function oldBgChoicePick(build: Partial<BuildState>, background: Background | undefined): SkillId | undefined {
  const choice = background?.trainedSkillChoice;
  if (!choice?.length) return undefined;
  return build.backgroundSkillChoice && choice.includes(build.backgroundSkillChoice) ? build.backgroundSkillChoice : choice[0];
}
/** originMissing's "Background trained skill" test. */
const oldBgMissing = (build: Partial<BuildState>, background: Background | undefined): boolean =>
  !!(
    background?.trainedSkillChoice?.length &&
    !(build.backgroundSkillChoice && background.trainedSkillChoice.includes(build.backgroundSkillChoice))
  );
/** restrictedSkillIncreaseLanes' `for (const s of sub?.skillChoice ?? []) if (pick === s) skills.add(s)`. */
function oldLanePick(build: Partial<BuildState>, list: readonly SkillId[] | undefined): SkillId[] {
  const out: SkillId[] = [];
  for (const s of list ?? []) if (build.subclassSkill === s) out.push(s);
  return out;
}
/** originMissing's "Class trained skill" test. */
function oldClassMissing(build: Partial<BuildState>, db: ContentDatabase): boolean {
  const cls = build.classId ? db.classes[build.classId] : undefined;
  if (!cls) return false;
  const sub = cls.subclass?.options.find((o) => o.id === build.subclassId);
  const skillChoice = sub?.skillChoice?.length ? sub.skillChoice : cls.trainedSkills.choice;
  return !!(skillChoice?.length && !(build.subclassSkill && skillChoice.includes(build.subclassSkill)));
}
/** buildCharacter's class-level choice and the subclass option's `skillChoice` pick. */
const oldListPick = (build: Partial<BuildState>, list: readonly SkillId[]): SkillId =>
  build.subclassSkill && list.includes(build.subclassSkill) ? build.subclassSkill : list[0];
/** buildCharacter's named-Lore resolver. */
function oldLorePicks(build: Partial<BuildState>, background: Background | undefined): string[] {
  const loreOptions = background?.trainedLoreOptions ?? [];
  if (!loreOptions.length) return [];
  const count = Math.min(background!.trainedLoreOptionsCount ?? 1, loreOptions.length);
  const stored = [build.backgroundLore, build.backgroundLore2, build.backgroundLore3, build.backgroundLore4];
  const picks: string[] = [];
  for (const s of stored) if (s && loreOptions.includes(s) && !picks.includes(s) && picks.length < count) picks.push(s);
  for (const o of loreOptions) if (picks.length < count && !picks.includes(o)) picks.push(o);
  return picks;
}

/* ---- the engine and its specs (the parity snapshot's own, gate off = full data) ------------------------ */

type Spec = { id: string; build: BuildState; dbPatch?: (db: ContentDatabase) => ContentDatabase };
let specs: Spec[] = [];
let dbOff: ContentDatabase;
const dbOf = (s: Spec) => (s.dbPatch ? s.dbPatch(dbOff) : dbOff);

beforeAll(async () => {
  const E = (await loadEngine()) as unknown as { specs: Spec[]; DB: { off: ContentDatabase } };
  specs = E.specs;
  dbOff = E.DB.off;
}, 180_000);

/** Every check of one build against the old copies; returns the first difference, or null. */
function disagreement(b: BuildState, db: ContentDatabase): string | null {
  const bg = b.backgroundId ? db.backgrounds[b.backgroundId] : undefined;
  const bgPick = backgroundSkillPick(b, bg);
  if (bgPick?.value !== oldBgChoicePick(b, bg)) return `backgroundSkillPick.value ${bgPick?.value} vs ${oldBgChoicePick(b, bg)}`;
  if ((bgPick?.answered === false) !== oldBgMissing(b, bg)) return `backgroundSkillPick.answered ${bgPick?.answered}`;
  if (bg && !backgroundTrainings(bg).skill && backgroundTrainedSkill(b, bg) !== oldBgChoicePick(b, bg)) return 'backgroundTrainedSkill';
  const lore = backgroundLorePicks(b, bg);
  if (JSON.stringify(lore) !== JSON.stringify(oldLorePicks(b, bg))) return `backgroundLorePicks ${JSON.stringify(lore)}`;
  const cls = b.classId ? db.classes[b.classId] : undefined;
  if ((subclassSkillPick(b, db)?.answered === false) !== oldClassMissing(b, db)) return 'subclassSkillPick.answered (Setup line)';
  if (cls?.trainedSkills.choice?.length) {
    const v = subclassSkillPick(b, db, cls.trainedSkills.choice)!.value;
    if (v !== oldListPick(b, cls.trainedSkills.choice)) return `class choice ${v}`;
  }
  for (const o of cls?.subclass?.options ?? []) {
    if (!o.skillChoice?.length) continue;
    const p = subclassSkillPick(b, db, o.skillChoice)!;
    if (p.value !== oldListPick(b, o.skillChoice)) return `option ${o.id} pick ${p.value}`;
    const lane = p.answered ? [p.value] : [];
    if (JSON.stringify(lane) !== JSON.stringify(oldLanePick(b, o.skillChoice))) return `option ${o.id} lane ${JSON.stringify(lane)}`;
  }
  return null;
}

describe('tweaks p2 WP3: one reader per answer, equal to every former copy', () => {
  it('over every parity spec', () => {
    expect(specs.length, 'the parity specs loaded').toBeGreaterThan(2000);
    const bad = specs.map((s) => [s.id, disagreement(s.build, dbOf(s))] as const).filter(([, d]) => d);
    expect(bad).toEqual([]);
  });

  it('over a grid of stored answers on every record that asks', () => {
    const db = dbOff;
    const offList = (opts: readonly string[]) => (SKILLS as readonly SkillId[]).find((s) => !opts.includes(s))!;
    const base = { ...emptyBuild(), level: 5 } as BuildState;
    let cases = 0;
    const bad: string[] = [];
    const check = (label: string, b: BuildState) => {
      cases++;
      const d = disagreement(b, db);
      if (d) bad.push(`${label}: ${d}`);
    };
    for (const bg of Object.values(db.backgrounds)) {
      const choice = bg.trainedSkillChoice ?? [];
      const lores = bg.trainedLoreOptions ?? [];
      if (!choice.length && !lores.length) continue;
      const answers: (SkillId | null | undefined)[] = [...choice, choice.length ? offList(choice) : 'stealth', null, undefined];
      for (const a of answers) check(`${bg.id} skill=${a}`, { ...base, backgroundId: bg.id, backgroundSkillChoice: a });
      if (lores.length) {
        const grids: (string | undefined)[][] = [
          [],
          [lores[lores.length - 1]],
          ['Sailing', lores[0]],
          [lores[0], lores[0], lores[1]],
          ['', lores[1], 'Nope', lores[0]],
          [...lores].reverse(),
        ];
        for (const g of grids)
          check(`${bg.id} lores=${JSON.stringify(g)}`, {
            ...base,
            backgroundId: bg.id,
            backgroundLore: g[0],
            backgroundLore2: g[1],
            backgroundLore3: g[2],
            backgroundLore4: g[3],
          });
      }
    }
    for (const cls of Object.values(db.classes)) {
      const lists = [cls.trainedSkills.choice ?? [], ...(cls.subclass?.options ?? []).map((o) => o.skillChoice ?? [])];
      const asked = [...new Set(lists.flat())];
      if (!asked.length) continue;
      const subs = [null, ...(cls.subclass?.options ?? []).map((o) => o.id)];
      for (const subclassId of subs)
        for (const a of [...asked, offList(asked), null, undefined])
          check(`${cls.id}/${subclassId} skill=${a}`, { ...base, classId: cls.id, subclassId, subclassSkill: a });
    }
    expect(cases, 'the grid reached the records that ask').toBeGreaterThan(300);
    expect(bad).toEqual([]);
  });

  /* No book style asks a skill choice, so the parity specs never reach the lane's subclass-skill line. A synthetic
   * swashbuckler style that asks one does: the lane takes the answer only when it is one of the offered skills —
   * never the unanswered default (the old `pick === s` loop over the RAW store). */
  it('restrictedSkillIncreaseLanes reads the answer only when answered (a style that asks a skill)', () => {
    const cls = dbOff.classes.swashbuckler!;
    const style = { ...cls.subclass!.options[0], id: 'p2-fold-style', skillChoice: ['deception', 'intimidation'] as SkillId[] };
    const db = {
      ...dbOff,
      classes: { ...dbOff.classes, swashbuckler: { ...cls, subclass: { ...cls.subclass!, options: [...cls.subclass!.options, style] } } },
    } as ContentDatabase;
    /** The old laneOf, verbatim (one class). */
    const oldLane = (b: Partial<BuildState>) => {
      const r = cls.restrictedSkillIncreaseLevels!;
      const skills = new Set<string>(r.skills ?? []);
      const sub = db.classes.swashbuckler!.subclass?.options.find((o) => o.id === b.subclassId);
      for (const s of sub?.grants?.skills ?? []) skills.add(s);
      for (const s of sub?.grants?.removesSkills ?? []) skills.delete(s);
      for (const s of sub?.skillChoice ?? []) if (b.subclassSkill === s) skills.add(s);
      return [...skills];
    };
    const seen: string[][] = [];
    for (const subclassSkill of ['deception', 'intimidation', 'stealth', null, undefined] as (SkillId | null | undefined)[]) {
      const b = { ...emptyBuild(), classId: 'swashbuckler', subclassId: style.id, subclassSkill, level: 7 } as BuildState;
      const lane = restrictedSkillIncreaseLanes(b, db).find((l) => l.classId === 'swashbuckler')!;
      expect([...lane.skills], `answer ${subclassSkill}`).toEqual(oldLane(b));
      seen.push([...lane.skills]);
    }
    expect(seen[0], 'an answered style skill joins the lane').toContain('deception');
    expect(seen[3], 'the unanswered default does not').not.toContain('deception');
  });
});

describe('tweaks p2 WP3: build.ts names the three stores only in their readers (ratchet)', () => {
  /* Each allowed line, with why it may name the store. A new line naming one fails: route it through the reader. */
  const ALLOWED: [RegExp, string][] = [
    [/^\s*(subclassSkill|backgroundSkillChoice|backgroundLore[234]?)\?: /, 'the BuildState field'],
    [/^\s*(subclassSkill|backgroundSkillChoice): null,$/, 'emptyBuild'],
    [/build: Pick<BuildState, 'backgroundSkillChoice'>,$/, 'backgroundSkillPick'],
    [/resolvePick\(build\.backgroundSkillChoice, choice\)/, 'backgroundSkillPick'],
    [/build: Partial<Pick<BuildState, 'classId' \| 'subclassId' \| 'subclassSkill'>>,$/, 'subclassSkillPick'],
    [/resolvePick\(build\.subclassSkill, opts\)/, 'subclassSkillPick'],
    [/build: Partial<Pick<BuildState, 'backgroundLore' \| 'backgroundLore2' \| 'backgroundLore3' \| 'backgroundLore4'>>,$/, 'backgroundLorePicks'],
    [/const stored = \[build\.backgroundLore, build\.backgroundLore2, build\.backgroundLore3, build\.backgroundLore4\];$/, 'backgroundLorePicks'],
    // The free-text Lore boxes (`backgroundChosenLoreKeys`): any text is an answer (plan 4b rows 13/14), not a list.
    [/build\.backgroundLore[23]?\?\.trim\(\) \|\| (bg\.trainedLoreChoiceDefault \|\| )?''/, 'backgroundChosenLoreKeys (free text)'],
    /* boundBackgroundGrantChoice `bgLore` (Driver's Assurance): it keeps a typed or off-list subject where the
     * named-Lore resolver drops it, so folding it would change that corner. NOT folded at WP3 (behaviour-neutral);
     * wp3-report.md, open finding for WP10. */
    [/build: Pick<BuildState, 'backgroundSkillChoice' \| 'backgroundLore' \| 'deityId'>,$/, 'boundBackgroundGrantChoice'],
    [/const subject = build\.backgroundLore\?\.trim\(\) \|\| background\?\.trainedLoreOptions\?\.\[0\];$/, 'bgLore, not folded'],
    /* backgroundGrantedFeats takes the RAW answer and tests it against `grantedFeatByChoice`'s keys (equal to the
     * choice list in all 23 book records, but its own rule). NOT folded at WP3; wp3-report.md, open finding. */
    [/backgroundGrantedFeats\(.*, build\.backgroundSkillChoice\)/,'backgroundGrantedFeats, raw by design'],
    // The reverse build (deriveBuildFromCharacter) WRITES the stores from a Character, and reads back its own write.
    [/^\s*b\.subclassSkill =$/, 'reverse build write'],
    [/^\s*b\.backgroundSkillChoice = pick \?\? null;$/, 'reverse build write'],
    [/backgroundGrantedFeats\(background, b\.backgroundSkillChoice\)/, 'reverse build, its own write'],
  ];
  it('every naming line is a reader or a listed place', () => {
    const lines = readFileSync('src/rules/build.ts', 'utf8').split(/\r?\n/);
    const naming = lines
      .map((text, i) => ({ text, line: i + 1 }))
      .filter(({ text }) => /\b(subclassSkill|backgroundSkillChoice|backgroundLore[234]?)\b/.test(text))
      .filter(({ text }) => !/^\s*(\*|\/\/|\/\*)/.test(text));
    const stray = naming.filter(({ text }) => !ALLOWED.some(([re]) => re.test(text)));
    expect(stray.map(({ line, text }) => `${line}: ${text.trim()}`)).toEqual([]);
    expect(naming.length, 'the ratchet still sees the stores').toBeGreaterThan(15);
  });
});
