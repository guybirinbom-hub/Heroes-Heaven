// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { Builder } from '../src/builder/Builder';
import { buildChoiceOptions, buildCharacter, checkPrerequisites, CUSTOM_BACKGROUND_ID, featChoicePrompt, featSubtreeIds, skillRanksAtLevel, type BuildState } from '../src/rules/build';
import { explainStat, type TimelineEntry } from '../src/rules/explain';
import { skillRanksAt } from '../src/rules/ranks';
import type { FeatChoiceDef, ProficiencyKey } from '../src/rules/types';
import { mk, slot, SKILL_ORDER_CASES, SKILL_ORDER_READER_CASES, unresolvedIds, type SkillOrderReaderCase, type SkillOrderReaderObs } from './fixtures/skill-order-cases';

/* skill-order WP7 (plan WP7 Done when: "the Builder makes one fewer buildCharacter per level page (spy in the
 * render test)"): every importer of build.ts gets buildCharacter through a counting wrapper. It returns the very
 * character the real one built, so every other test here reads exactly what it read before. */
const buildCalls = vi.hoisted(() => ({ n: 0 }));
vi.mock('../src/rules/build', async (orig) => {
  const m = await orig<typeof import('../src/rules/build')>();
  return {
    ...m,
    buildCharacter: (...a: Parameters<typeof m.buildCharacter>) => {
      buildCalls.n++;
      return m.buildCharacter(...a);
    },
  };
});

/**
 * THE BUILDER'S OWN SKILL READERS READ THE RANK AT THEIR LEVEL (plan WP0 step 5; guard G6; findings 7 and 8).
 *
 * Each reader that keeps its own model today reads the FINISHED character's ranks, so a level page counts what
 * happens later. Cases P1-P10 (test/fixtures/skill-order-cases.ts, `SKILL_ORDER_READER_CASES`) prove a source
 * from a LATER point is not counted (`lower: true`); they are `it.fails` until WP7 moves the readers onto the
 * engine's per-level history. Each has a twin proving a source from an EARLIER point IS counted (green today
 * and after), because a reader that read only 1st-level ranks would pass every `lower` case alone. Each
 * flipping case also has a plain premise test: its ids resolve and today's exact label or reason holds (D17).
 *   increase    — the level page's "Skill increase" picker row (Builder `baseSkills`)
 *   prereq      — the picked feat's "Prerequisites no longer met" badge (Builder ~3536)
 *   fallbackHeading — the replacement card's heading ("Already <rank> in <Skill>")
 *   explain     — the "how was this calculated" timeline (explain.ts `skillTimeline`)
 *   trainedSlot — a feat's "Trained skill" slot option, greyed when the grant would change nothing
 *   featPicker  — the slot's feat picker: a candidate needing a skill the occupant trains
 * Synthetic characters only.
 */

const db = content();
const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  for (const n of [...document.body.children]) n.remove();
});
const flush = () => act(async () => void (await new Promise((res) => setTimeout(res, 0))));

function openOn(c: SkillOrderReaderCase) {
  const r = renderDom(createElement(Builder, { content: db, initial: c.build, onCancel: () => undefined, onCreate: () => undefined }));
  cleanups.push(r.stop);
  r.click([...r.host.querySelectorAll('.lstrip button')].find((x) => (x.textContent ?? '').trim() === String(c.page)) ?? null);
  return r;
}
const pickerRows = () => [...document.querySelectorAll('.picker-overlay .picker-item')] as HTMLButtonElement[];
const nameOf = (row: Element) => (row.querySelector('.picker-name')?.textContent ?? '').trim();
const rowFor = (rows: Element[], skill: string) => rows.find((x) => nameOf(x) === skill || nameOf(x).startsWith(`${skill} (`));
const timelineRows = (t: TimelineEntry[]) => t.map((e) => `${e.level} ${e.text}${e.detail ? ` [${e.detail}]` : ''} = ${e.rank}`);
/** The slot card of a picked feat on the open page. */
const slotOf = (host: HTMLElement, featName: string) =>
  [...host.querySelectorAll('.lvl-slot-wrap')].find((w) => (w.querySelector('.lvl-card-val')?.textContent ?? '').trim() === featName) ?? null;

/** What the case's reader shows, for the fields `want` names. */
async function read(c: SkillOrderReaderCase, want: SkillOrderReaderObs): Promise<SkillOrderReaderObs> {
  const out: SkillOrderReaderObs = {};
  if (c.reader === 'explain') {
    const t = explainStat(buildCharacter(c.build, db), db, { kind: 'skill', skill: c.skill as ProficiencyKey }).timeline;
    const rows = timelineRows(t);
    if (want.lines) out.lines = want.lines.filter((l) => rows.includes(l));
    if (want.lastRank) out.lastRank = t[t.length - 1]?.rank;
    return out;
  }
  const r = openOn(c);
  const featName = c.feat ? db.feats[c.feat]?.name ?? c.feat : '';
  if (c.reader === 'increase') {
    const ctl = r.host.querySelector('[data-ctl-title="Skill increase"]');
    if (!ctl) throw new Error(`${c.id}: no "Skill increase" control on page ${c.page}`);
    r.click(ctl.querySelector('.ss-replace') ?? ctl);
    await flush();
    const row = rowFor(pickerRows(), c.skill!);
    if (!row) throw new Error(`${c.id}: no ${c.skill} row in the increase picker`);
    if (want.label !== undefined) out.label = nameOf(row);
    if (want.disabled !== undefined) out.disabled = (row as HTMLButtonElement).disabled;
  } else if (c.reader === 'prereq') {
    const wrap = slotOf(r.host, featName);
    if (!wrap) throw new Error(`${c.id}: no slot holding ${featName} on page ${c.page}`);
    out.met = !wrap.querySelector('.lvl-invalid');
  } else if (c.reader === 'fallbackHeading') {
    const card = r.host.querySelector('[data-subcard$=" — replacement skill"]');
    if (!card) throw new Error(`${c.id}: no replacement card on page ${c.page}`);
    out.heading = card.getAttribute('data-subcard')!.replace(/ — replacement skill$/, '');
  } else if (c.reader === 'trainedSlot') {
    const own = slotOf(r.host, featName);
    const inWrap = own ? [...own.querySelectorAll('[data-ctl-title="Trained skill"]')] : [];
    const ctls = inWrap.length ? inWrap : [...r.host.querySelectorAll('[data-ctl-title="Trained skill"]')];
    const ctl = ctls[c.nth ?? 0];
    if (!ctl) throw new Error(`${c.id}: no "Trained skill" control #${c.nth ?? 0} for ${featName} (found ${ctls.length})`);
    r.click(ctl);
    await flush();
    const row = rowFor(pickerRows(), c.skill!);
    if (!row) throw new Error(`${c.id}: no ${c.skill} option in ${featName}'s "Trained skill" slot`);
    out.disabled = (row as HTMLButtonElement).disabled;
  } else if (c.reader === 'featPicker') {
    const occupant = c.build.featPicks[c.slotKey!];
    const wrap = slotOf(r.host, db.feats[occupant]?.name ?? occupant);
    if (!wrap) throw new Error(`${c.id}: no slot holding ${occupant} on page ${c.page}`);
    r.click(wrap.querySelector('.lvl-replace-btn'));
    await flush();
    // The feat picker's rows are PickerRow (src/sheet/FilterableSelect.tsx): `.pick-row`, dimmed when unmet.
    const row = [...document.querySelectorAll('.picker-overlay .pick-row')].find((x) => nameOf(x).startsWith(featName));
    // Absent (the default "hide ineligible" view drops an unmet row), dimmed, "Requires (unmet)" or a disabled
    // Choose = not offered as met.
    out.offeredAsMet =
      !!row &&
      !row.classList.contains('dim') &&
      !/Requires \(unmet\)/.test(row.textContent ?? '') &&
      !(row.querySelector('.pick-add') as HTMLButtonElement | null)?.disabled;
  }
  return out;
}

/*
 * WP5 (plan D14): a class option's training above 1st level that owes a replacement is asked on the level page its
 * pick opened. A6e: exemplar 3, class pick Athletics at 1, Root Epithet The Brave at 3 (Athletics) → the level-3 page
 * draws the epithet's replacement card; answering it stores `the-brave:fallback:athletics`, the key build.ts reads.
 */
describe("WP5: a class option's replacement skill is asked on its level page", () => {
  const caseOf = (id: string) => SKILL_ORDER_CASES.find((c) => c.id === id)!;
  const open = (id: string, page: number, onCreate: (b: BuildState) => void = () => undefined) => {
    const r = renderDom(createElement(Builder, { content: db, initial: caseOf(id).build, onCancel: () => undefined, onCreate }));
    cleanups.push(r.stop);
    r.click([...r.host.querySelectorAll('.lstrip button')].find((x) => (x.textContent ?? '').trim() === String(page)) ?? null);
    return r;
  };
  const epithetCard = (host: HTMLElement) => host.querySelector('[data-subcard="The Brave: Already trained in Athletics — replacement skill"]');
  const anyEpithetCard = (host: HTMLElement) => !!host.querySelector('[data-subcard^="The Brave:"]');

  it("A6e: the level-3 page draws The Brave's replacement card, and Save stores the answer", async () => {
    const saved: BuildState[] = [];
    const r = open('A6e', 3, (b) => saved.push(b));
    const card = epithetCard(r.host);
    expect(card, 'the epithet replacement card on page 3').toBeTruthy();
    r.click(card!.querySelector('[data-ctl-title="Replacement skill"]'));
    await flush();
    // Arcana is trained by the 1st-level class pick: a dead end, greyed.
    expect((rowFor(pickerRows(), 'Arcana') as HTMLButtonElement | undefined)?.disabled, 'Arcana greyed').toBe(true);
    const crafting = rowFor(pickerRows(), 'Crafting') as HTMLButtonElement | undefined;
    expect(!!crafting && !crafting.disabled, 'Crafting offered').toBe(true);
    r.click(crafting!);
    await flush();
    const byText = (t: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => (b.textContent ?? '').trim() === t) ?? null;
    r.click(r.host.querySelector('button.b-create'));
    await flush();
    for (let i = 0; i < 4 && byText('Save anyway'); i++) {
      r.click(byText('Save anyway'));
      await flush();
    }
    expect(saved.length, 'onCreate fired').toBe(1);
    expect(saved[0].featSkillChoices?.['the-brave:fallback:athletics']).toBe('crafting');
    expect(buildCharacter(saved[0], db).proficiencies.skills.crafting, 'the answer trains Crafting').toBe('trained');
  });
  it('no card where nothing is owed (A5c: the epithet trains Athletics first) or on another page (A6e, page 1)', () => {
    expect(anyEpithetCard(open('A5c', 3).host)).toBe(false);
    expect(anyEpithetCard(open('A6e', 1).host)).toBe(false);
  });
});

describe("the Builder's skill readers read the rank at their own level (G6)", () => {
  for (const c of SKILL_ORDER_READER_CASES) {
    (c.flips ? it.fails : it)(`${c.id} (${c.reader}): ${c.title}${c.flips ? ` [fails until ${c.flips}]` : ''}`, async () => {
      expect(await read(c, c.expect), `${c.id} (${c.print})`).toEqual(c.expect);
    });
    if (c.flips)
      it(`${c.id}: premise — ids resolve and today's reading holds`, async () => {
        expect(unresolvedIds(c, db)).toEqual([]);
        expect(await read(c, c.today!)).toEqual(c.today);
      });
  }
});

/* ---------------------------------------------------------------------------------------------------- */
/* skill-order WP7: the readers read the history — the Done-when checks and the two carried findings     */
/* ---------------------------------------------------------------------------------------------------- */
describe('WP7: the readers read the per-level history', () => {
  const FA = { freeArchetype: true } as BuildState['variantRules'];
  const pageButton = (host: HTMLElement, page: number) =>
    [...host.querySelectorAll('.lstrip button')].find((x) => (x.textContent ?? '').trim() === String(page)) ?? null;

  it('a level page costs no buildCharacter of its own (the old `baseSkills` memo built one per page)', async () => {
    const c = SKILL_ORDER_READER_CASES.find((x) => x.id === 'P1')!;
    const r = renderDom(createElement(Builder, { content: db, initial: c.build, onCancel: () => undefined, onCreate: () => undefined }));
    cleanups.push(r.stop);
    await flush();
    for (const page of [3, 5, 2]) {
      buildCalls.n = 0;
      r.click(pageButton(r.host, page));
      await flush();
      // The page drew its increase reader (so the ranks were read) …
      if (page !== 2) expect(r.host.querySelector('[data-ctl-title="Skill increase"]'), `page ${page} increase control`).toBeTruthy();
      // … from the one character the Builder already holds (`featPrereqChar`'s history), building none.
      expect(buildCalls.n, `buildCharacter calls on switching to page ${page}`).toBe(0);
    }
  });

  it('an imported character whose rank was patched after the build falls back to the replay timeline (historyAgrees)', () => {
    const k1 = SKILL_ORDER_READER_CASES.find((x) => x.id === 'P7')!;
    const built = buildCharacter(k1.build, db);
    const ok = explainStat(built, db, { kind: 'skill', skill: 'stealth' }).timeline;
    expect(timelineRows(ok)).toContain('1 Trained [Kholo Lore] = trained');
    // A stored copy (an import), its Stealth patched to master by hand after the build: the history (expert) no longer
    // agrees with the sheet, so the timeline is today's replay, which ends on the sheet rank.
    const patched = JSON.parse(JSON.stringify(built)) as typeof built;
    patched.proficiencies.skills.stealth = 'master';
    const t = explainStat(patched, db, { kind: 'skill', skill: 'stealth' }).timeline;
    expect(t[t.length - 1]?.rank, 'the last line is the sheet rank').toBe('master');
    expect(timelineRows(t), 'no history line once the history disagrees').not.toContain('1 Trained [Kholo Lore] = trained');
    // The unpatched stored copy still agrees, and still reads the history.
    const copy = JSON.parse(JSON.stringify(built)) as typeof built;
    expect(timelineRows(explainStat(copy, db, { kind: 'skill', skill: 'stealth' }).timeline)).toContain('1 Trained [Kholo Lore] = trained');
  });

  /*
   * CARRIED FINDING (a), WP3 minor 2: "without a record" must re-run the judges. Fighter 2 (free archetype), Barbarian
   * Dedication in the class slot and Guardian Dedication in the archetype slot, both at 2nd, nothing else training
   * Athletics. In print, Barbarian Dedication trains Athletics and Guardian Dedication, coming after it, is
   * "already trained" → a replacement skill. WITHOUT Barbarian Dedication (the feat picker of the slot it fills,
   * a prerequisite read without it), Guardian Dedication's own Athletics is not redundant and trains it. A replay of
   * the stored steps keeps Guardian's redirect and reads Athletics untrained; the re-run pass reads it trained.
   */
  const faBuild = (o: Partial<BuildState> = {}) =>
    mk({
      level: 2, classId: 'fighter', ancestryId: 'human', heritageId: 'versatile-human', variantRules: FA,
      featPicks: { [slot(2, 'fighter', 'class', { variant: FA })]: 'barbarian-dedication', [slot(2, 'fighter', 'archetype', { variant: FA })]: 'guardian-dedication' },
      ...o,
    });
  it('carried (a): leaving a record out re-runs the judges — a same-level redirect it caused is undone', () => {
    const c = buildCharacter(faBuild(), db);
    // Premise: Guardian Dedication's Athletics is redirected because Barbarian Dedication trained it first.
    expect(c.skillFallbacks).toEqual([{ featId: 'guardian-dedication', skill: 'athletics' }]);
    const w = featSubtreeIds(c, 'barbarian-dedication');
    expect([...w]).toEqual(['barbarian-dedication']);
    expect(skillRanksAtLevel(c, 2, 'end', w)?.athletics, 'the re-run: Guardian Dedication trains Athletics').toBe('trained');
    // The replay cannot judge again (the reason the re-run exists): it reads the same view untrained.
    expect(skillRanksAt(c, 2, 'end', { without: w })?.athletics ?? 'untrained').toBe('untrained');
    // A prerequisite read without Barbarian Dedication (D5): Athletic Strategist ("trained in Athletics") is met.
    expect(checkPrerequisites(db.feats['athletic-strategist'], c, db, { atLevel: 2, without: w }).met).toBe(true);
    // Twin: with nothing else training Athletics (no Guardian Dedication), leaving Barbarian Dedication out leaves
    // Athletics untrained — the re-run counts nothing a later record did not do.
    const solo = buildCharacter(mk({ level: 2, classId: 'fighter', ancestryId: 'human', heritageId: 'versatile-human', featPicks: { [slot(2, 'fighter', 'class')]: 'barbarian-dedication' } }), db);
    const ws = featSubtreeIds(solo, 'barbarian-dedication');
    expect(skillRanksAtLevel(solo, 2, 'end', ws)?.athletics ?? 'untrained').toBe('untrained');
    expect(checkPrerequisites(db.feats['athletic-strategist'], solo, db, { atLevel: 2, without: ws }).met).toBe(false);
  });
  it('carried (a): a stored copy (no pass to re-run) falls back to the replay of its history', () => {
    const c = buildCharacter(faBuild(), db);
    const stored = JSON.parse(JSON.stringify(c)) as typeof c;
    const w = featSubtreeIds(stored, 'barbarian-dedication');
    expect(skillRanksAtLevel(stored, 2, 'end', w)).toEqual(skillRanksAt(stored, 2, 'end', { without: w }));
  });
  /* The same case in the Builder: the feat picker of Barbarian Dedication's slot (a candidate REPLACES it, plan
   * section 2) on an investigator (Athletic Strategist is an investigator feat; P10's shape, free archetype on). */
  const invCase = (id: string, guardian: boolean, offeredAsMet: boolean): SkillOrderReaderCase => ({
    id, title: 'carried (a)', finding: 7, tag: 'P', dir: 'same', reader: 'featPicker', page: 2, feat: 'athletic-strategist',
    slotKey: slot(2, 'investigator', 'class', { variant: FA }), flips: null, print: 'WP3 minor 2',
    build: mk({
      level: 2, classId: 'investigator', keyAbility: 'dex', ancestryId: 'kholo', heritageId: 'dog-kholo', variantRules: FA,
      featPicks: {
        [slot(2, 'investigator', 'class', { variant: FA })]: 'barbarian-dedication',
        ...(guardian ? { [slot(2, 'investigator', 'archetype', { variant: FA })]: 'guardian-dedication' } : {}),
      },
    }),
    expect: { offeredAsMet },
  });
  it("carried (a), in the Builder: the slot's feat picker reads the re-run (Guardian Dedication trains Athletics once Barbarian Dedication is replaced)", async () => {
    const c = invCase('Pa', true, true);
    expect(await read(c, c.expect)).toEqual(c.expect);
  });
  it('carried (a), in the Builder, twin: with no Guardian Dedication nothing else trains Athletics — not met', async () => {
    const c = invCase('Pa-twin', false, false);
    expect(await read(c, c.expect)).toEqual(c.expect);
  });

  /*
   * CARRIED FINDING (b), WP5 F1: the class option's replacement card greys by the ranks at the option's print place.
   * A6e (exemplar 3, class picks Athletics + Arcana at 1, Root Epithet The Brave at 3 → a replacement owed) plus the
   * 3rd-level skill increase on Crafting: the epithet comes before that level's increases (Player Core pg. 29: class
   * features, then the skill increase), so Crafting is untrained at the epithet and a live replacement; the old card
   * read the finished ranks and greyed it. Twin: Arcana, trained by the 1st-level class pick, stays greyed.
   */
  it('carried (b): the class option replacement card offers a skill trained only by the same level\'s later increase', async () => {
    const a6e = SKILL_ORDER_CASES.find((x) => x.id === 'A6e')!;
    const b = { ...a6e.build, skillIncreases: { ...(a6e.build.skillIncreases ?? {}), 3: 'crafting' as ProficiencyKey } };
    expect(buildCharacter(b, db).proficiencies.skills.crafting, 'premise: the finished Crafting is trained').not.toBe('untrained');
    const r = renderDom(createElement(Builder, { content: db, initial: b, onCancel: () => undefined, onCreate: () => undefined }));
    cleanups.push(r.stop);
    r.click(pageButton(r.host, 3));
    const card = r.host.querySelector('[data-subcard="The Brave: Already trained in Athletics — replacement skill"]');
    expect(card, 'the epithet replacement card on page 3').toBeTruthy();
    r.click(card!.querySelector('[data-ctl-title="Replacement skill"]'));
    await flush();
    const crafting = rowFor(pickerRows(), 'Crafting') as HTMLButtonElement | undefined;
    expect(!!crafting && !crafting.disabled, 'Crafting offered (untrained at the epithet)').toBe(true);
    expect((rowFor(pickerRows(), 'Arcana') as HTMLButtonElement | undefined)?.disabled, 'twin: Arcana (1st-level class pick) greyed').toBe(true);
  });

  /*
   * The feat replacement picker, its twin (ruling 2): Kholo Lore at 1 (Stealth already trained by the class pick →
   * a replacement owed), an Arcana increase at 3. At 1st level Arcana is untrained: a live replacement; Society,
   * trained by the 1st-level class pick, is greyed.
   */
  it("the feat replacement card greys by the ranks at the feat's print place", async () => {
    const b = mk({
      level: 3, classId: 'fighter', ancestryId: 'kholo', heritageId: 'dog-kholo', classSkills: ['stealth', 'society'],
      featPicks: { [slot(1, 'fighter', 'ancestry')]: 'kholo-lore' }, skillIncreases: { 3: 'arcana' },
    });
    expect(buildCharacter(b, db).proficiencies.skills.arcana, 'premise: the finished Arcana is trained').toBe('trained');
    const r = renderDom(createElement(Builder, { content: db, initial: b, onCancel: () => undefined, onCreate: () => undefined }));
    cleanups.push(r.stop);
    r.click(pageButton(r.host, 1));
    const card = r.host.querySelector('[data-subcard="Already trained in Stealth — replacement skill"]');
    expect(card, 'the Kholo Lore replacement card on page 1').toBeTruthy();
    r.click(card!.querySelector('[data-ctl-title="Replacement skill"]'));
    await flush();
    const arcana = rowFor(pickerRows(), 'Arcana') as HTMLButtonElement | undefined;
    expect(!!arcana && !arcana.disabled, 'Arcana offered (untrained at 1st)').toBe(true);
    expect((rowFor(pickerRows(), 'Society') as HTMLButtonElement | undefined)?.disabled, 'twin: Society greyed').toBe(true);
  });

  /*
   * "A skill you're trained in" (Assurance's choice, kind 'skills') is asked when the feat is taken: Assurance in the
   * 2nd-level skill slot is not offered Arcana that only the 3rd-level increase trains; twin: Arcana from the
   * 1st-level class pick is offered.
   */
  it("a 'skills' choice pool reads the ranks at the record's level, without the record", () => {
    const def = db.feats['assurance']!.choice as FeatChoiceDef;
    expect(def.kind).toBe('skills');
    const key = slot(2, 'fighter', 'skill');
    const pool = (o: Partial<BuildState>) => {
      const b = mk({ level: 3, classId: 'fighter', ancestryId: 'human', heritageId: 'versatile-human', featPicks: { [key]: 'assurance' }, ...o });
      return buildChoiceOptions('assurance', def, b, db, buildCharacter(b, db), key).map((x) => x.value);
    };
    expect(pool({ skillIncreases: { 3: 'arcana' } }), 'Arcana trained only at 3rd').not.toContain('arcana');
    expect(pool({ classSkills: ['arcana'] }), 'twin: Arcana from the 1st-level class pick').toContain('arcana');
  });
});

/* ---------------------------------------------------------------------------------------------------- */
/* skill-order WP7 round 2: the checker's findings 1-4                                                    */
/* ---------------------------------------------------------------------------------------------------- */
describe('WP7 round 2: one copy of a repeatable feat, the slot reader between levels, the bonus lane, the timeline lines', () => {
  const pageButton = (host: HTMLElement, page: number) =>
    [...host.querySelectorAll('.lstrip button')].find((x) => (x.textContent ?? '').trim() === String(page)) ?? null;

  /*
   * FINDING 1: leaving the slot's feat out by its ID also left out every other copy of it. Fighter 4, Additional Lore
   * (Legal) in the 2nd-level skill slot and Additional Lore (Warfare) in the 4th-level one. The 4th-level slot's
   * picker replaces only ITS Additional Lore: Legal Lore, trained at 2nd by the other copy, still meets Contract
   * Negotiator ("trained in Legal Lore"). Twin: the 2nd-level slot's picker replaces the Legal one — not met.
   */
  const k2 = slot(2, 'fighter', 'skill');
  const k4 = slot(4, 'fighter', 'skill');
  const twoLores = (level = 4, at2 = 'Legal', at4 = 'Warfare') =>
    mk({
      level, classId: 'fighter', ancestryId: 'human', heritageId: 'versatile-human',
      featPicks: { [k2]: 'additional-lore', [k4]: 'additional-lore' },
      featLoreChoices: { [`${k2}:0`]: at2, [`${k4}:0`]: at4 },
    });
  it('finding 1, engine: without one slot\'s Additional Lore, the other copy\'s Lore still counts (re-run and stored replay)', () => {
    const c = buildCharacter(twoLores(), db);
    expect(c.proficiencies.skills['lore:legal' as ProficiencyKey], 'premise: Legal Lore from the 2nd-level copy').toBe('expert');
    const w4 = featSubtreeIds(c, 'additional-lore', k4);
    const cn = db.feats['contract-negotiator']!;
    expect(cn.prerequisites).toEqual(['trained in Legal Lore']);
    expect(checkPrerequisites(cn, c, db, { atLevel: 4, without: w4 }).met, 'without the 4th-level copy').toBe(true);
    expect(skillRanksAtLevel(c, 4, 'end', w4)?.['lore:warfare' as ProficiencyKey] ?? 'untrained', 'its own Lore is left out').toBe('untrained');
    // The id reading (no slot) still leaves out every copy — what a record with no slot asks.
    expect(checkPrerequisites(cn, c, db, { atLevel: 4, without: featSubtreeIds(c, 'additional-lore') }).met).toBe(false);
    // Twin: without the 2nd-level copy, at 2nd, Legal Lore is untrained.
    expect(checkPrerequisites(cn, c, db, { atLevel: 2, without: featSubtreeIds(c, 'additional-lore', k2) }).met).toBe(false);
    // A stored copy (no pass to re-run) replays its history without the copy from its level on: the same answers.
    const stored = JSON.parse(JSON.stringify(c)) as typeof c;
    expect(checkPrerequisites(cn, stored, db, { atLevel: 4, without: featSubtreeIds(stored, 'additional-lore', k4) }).met).toBe(true);
    expect(checkPrerequisites(cn, stored, db, { atLevel: 2, without: featSubtreeIds(stored, 'additional-lore', k2) }).met).toBe(false);
    // At 8th the re-run keeps the 2nd-level copy's whole ladder (master at 7th) without the 4th-level copy.
    const c8 = buildCharacter(twoLores(8), db);
    const r8 = skillRanksAtLevel(c8, 8, 'end', featSubtreeIds(c8, 'additional-lore', k4));
    expect(r8?.['lore:legal' as ProficiencyKey]).toBe('master');
    // …and leaves out the 4th-level copy's own ladder step at 7th (the event keeps its row through the move).
    expect(r8?.['lore:warfare' as ProficiencyKey] ?? 'untrained').toBe('untrained');
  });
  it("finding 1, engine: a granted copy (Kholo Lore's Additional Lore) does not take the slot copy with it", () => {
    const ka = slot(1, 'fighter', 'ancestry');
    const c = buildCharacter(
      mk({ level: 2, classId: 'fighter', ancestryId: 'kholo', heritageId: 'dog-kholo', featPicks: { [ka]: 'kholo-lore', [k2]: 'additional-lore' }, featLoreChoices: { [`${k2}:0`]: 'Legal' } }),
      db,
    );
    expect(c.feats.filter((f) => f.featId === 'additional-lore').map((f) => f.grantedBy ?? f.slotKey), 'premise: a granted and a slot copy').toEqual(['kholo-lore', k2]);
    const r = skillRanksAtLevel(c, 2, 'end', featSubtreeIds(c, 'kholo-lore', ka));
    expect(r?.['lore:legal' as ProficiencyKey], 'the slot copy keeps Legal Lore').toBe('trained');
    expect(r?.['lore:kholo' as ProficiencyKey] ?? 'untrained', "the Additional Lore Kholo Lore grants (Kholo Lore) is left out with it").toBe('untrained');
  });
  /* In the Builder (Contract Negotiator's book is not on by default, so its feat picker never lists it): Additional
   * Lore (Warfare) at 2nd — expert at 3rd by its own ladder — and (Legal) at 4th. The 4th-level slot's picker offers
   * Battle Planner ("expert in Warfare Lore") as met; the 2nd-level slot's, replacing the Warfare copy, does not. */
  const loreCase = (id: string, page: number, key: string, offeredAsMet: boolean): SkillOrderReaderCase => ({
    id, title: 'round 2 finding 1', finding: 7, tag: 'P', dir: 'same', reader: 'featPicker', page, feat: 'battle-planner', slotKey: key,
    flips: null, print: 'WP7 round 2', build: twoLores(4, 'Warfare', 'Legal'), expect: { offeredAsMet },
  });
  it("finding 1, Builder: the 4th-level slot's picker offers Battle Planner as met (the 2nd-level copy's Warfare Lore)", async () => {
    expect(db.feats['battle-planner']?.prerequisites).toEqual(['expert in Warfare Lore']);
    const c = loreCase('L4', 4, k4, true);
    expect(await read(c, c.expect)).toEqual(c.expect);
  });
  it("finding 1, Builder, twin: the 2nd-level slot's picker (replacing the Warfare Lore copy) does not", async () => {
    const c = loreCase('L2', 2, k2, false);
    expect(await read(c, c.expect)).toEqual(c.expect);
  });

  /*
   * FINDING 2 (the feat replacement card's twin): Barbarian Dedication at 4, Athletics trained by the class pick (a
   * replacement owed), Arcana trained only by the 3rd-level increase. At the dedication Arcana IS trained: greyed,
   * a reader of the creation ranks would offer it. Crafting (never trained) is offered. P9c is the slot's twin.
   */
  it('finding 2: the feat replacement card greys a skill a 3rd-level increase trained before the 4th-level feat', async () => {
    const b = mk({
      level: 4, classId: 'fighter', ancestryId: 'human', heritageId: 'versatile-human', classSkills: ['athletics'],
      featPicks: { [slot(4, 'fighter', 'class')]: 'barbarian-dedication' }, skillIncreases: { 3: 'arcana' },
    });
    const r = renderDom(createElement(Builder, { content: db, initial: b, onCancel: () => undefined, onCreate: () => undefined }));
    cleanups.push(r.stop);
    r.click(pageButton(r.host, 4));
    const card = r.host.querySelector('[data-subcard="Already trained in Athletics — replacement skill"]');
    expect(card, 'the replacement card on page 4').toBeTruthy();
    r.click(card!.querySelector('[data-ctl-title="Replacement skill"]'));
    await flush();
    expect((rowFor(pickerRows(), 'Arcana') as HTMLButtonElement | undefined)?.disabled, 'Arcana (3rd-level increase) greyed').toBe(true);
    const crafting = rowFor(pickerRows(), 'Crafting') as HTMLButtonElement | undefined;
    expect(!!crafting && !crafting.disabled, 'Crafting offered').toBe(true);
  });

  /*
   * FINDING 3: the bonus increase starts after this level's main one (deviation 83). Swashbuckler (braggart) 3: the
   * main increase on Acrobatics (trained → expert); the bonus picker reads Acrobatics as Expert — E → M, over the
   * 3rd-level cap, greyed. Twin: the main increase on Athletics leaves Acrobatics trained — T → E, offered.
   */
  const swash = (main: ProficiencyKey) =>
    mk({ level: 3, classId: 'swashbuckler', subclassId: 'braggart', keyAbility: 'dex', ancestryId: 'human', heritageId: 'versatile-human', skillIncreases: { 3: main } });
  const bonusRow = async (b: BuildState, skill: string) => {
    const r = renderDom(createElement(Builder, { content: db, initial: b, onCancel: () => undefined, onCreate: () => undefined }));
    cleanups.push(r.stop);
    r.click(pageButton(r.host, 3));
    const ctl = r.host.querySelector('[data-ctl-title="Bonus skill increase"]');
    expect(ctl, 'the bonus increase control on page 3').toBeTruthy();
    r.click(ctl!.querySelector('.ss-replace') ?? ctl);
    await flush();
    const row = rowFor(pickerRows(), skill) as HTMLButtonElement | undefined;
    expect(row, `${skill} row in the bonus picker`).toBeTruthy();
    return { label: nameOf(row!), disabled: row!.disabled };
  };
  it("finding 3: the bonus increase picker counts this level's main increase", async () => {
    expect(await bonusRow(swash('acrobatics'), 'Acrobatics')).toEqual({ label: 'Acrobatics (E → M)', disabled: true });
  });
  it('finding 3, twin: with the main increase elsewhere, Acrobatics is still trained for the bonus one', async () => {
    expect(await bonusRow(swash('athletics'), 'Acrobatics')).toEqual({ label: 'Acrobatics (T → E)', disabled: false });
  });

  /*
   * FINDING 4: the history timeline's own lines. Kholo Lore at 1 with Stealth already trained by the class pick: the
   * redirect line (answered / unanswered) and the replacement's training. A swashbuckler's bonus increase on a skill
   * Stylish Tricks forbids: the "not applied" line.
   */
  const kholoK = (answer?: ProficiencyKey) =>
    mk({
      level: 1, classId: 'fighter', ancestryId: 'kholo', heritageId: 'dog-kholo', classSkills: ['stealth'],
      featPicks: { [slot(1, 'fighter', 'ancestry')]: 'kholo-lore' },
      ...(answer ? { featSkillChoices: { 'kholo-lore:fallback:stealth': answer } } : {}),
    });
  const lines = (b: BuildState, skill: ProficiencyKey) => timelineRows(explainStat(buildCharacter(b, db), db, { kind: 'skill', skill }).timeline);
  it('finding 4: the redirect line names the answer, or says one is owed, and the replacement names its record', () => {
    expect(lines(kholoK('arcana'), 'stealth')).toContain('1 Kholo Lore: already Trained — you picked Arcana = trained');
    expect(lines(kholoK('arcana'), 'arcana')).toContain('1 Trained [Kholo Lore (replacement skill)] = trained');
    expect(lines(kholoK(), 'stealth')).toContain('1 Kholo Lore: already Trained — a replacement skill is owed = trained');
  });
  it('finding 4: a bonus increase a narrowed lane forbids says it was not applied', () => {
    const b = mk({ level: 3, classId: 'swashbuckler', subclassId: 'braggart', keyAbility: 'dex', ancestryId: 'human', heritageId: 'versatile-human', bonusSkillIncreases: { 3: 'medicine' } });
    expect(lines(b, 'medicine')).toContain('3 Skill increase (not applied: this skill cannot take it) = untrained');
  });
});

/* ---------------------------------------------------------------------------------------------------- */
/* skill-order WP11 step 0h: the three src/builder/shared.tsx creation readers read the creation ranks    */
/* ---------------------------------------------------------------------------------------------------- */
/*
 * work/skill-rank-level-by-level/shared-readers.md. Each of these is a 1st-level creation question, so each reads the
 * ranks at 1st level before its skill increases (`creationSkillRanks` in shared.tsx; every 1st-level source counts,
 * checker finding 1), never the finished character's: what a later level trains is not there yet. Each has a twin (a source from the creation phase IS
 * counted). Planted proof (2026-10-23): each reader's old line put back ("Before" in the recipe) turned its own case
 * red, the twins stayed green; reverted with Edit, no PLANT marker left.
 */
describe('WP11 step 0h: the origin-page creation readers read the ranks at creation', () => {
  const pageButton = (host: HTMLElement, page: number) =>
    [...host.querySelectorAll('.lstrip button')].find((x) => (x.textContent ?? '').trim() === String(page)) ?? null;
  const openPage0 = (b: BuildState) => {
    const r = renderDom(createElement(Builder, { content: db, initial: b, onCancel: () => undefined, onCreate: () => undefined }));
    cleanups.push(r.stop);
    r.click(pageButton(r.host, 0));
    return r;
  };
  const typeInto = (input: HTMLInputElement | null, text: string) => {
    if (!input) throw new Error('no "type your own" field');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };

  /*
   * Reader 1: Chosen One's "Skill" (kind 'skills', "a skill you're trained in"). Fighter 3: Arcana trained only by the
   * 3rd-level skill increase is not offered on the creation card; twin: Arcana from the 1st-level class pick is.
   */
  const chosenOne = (o: Partial<BuildState>) =>
    mk({ level: 3, classId: 'fighter', ancestryId: 'human', heritageId: 'versatile-human', backgroundId: 'chosen-one', ...o });
  const backgroundSkillRows = async (b: BuildState, label = 'Skill') => {
    const r = openPage0(b);
    const card = r.host.querySelector(`[data-subcard="${label}"]`);
    expect(card, `the background's "${label}" card on page 0`).toBeTruthy();
    r.click(card!.querySelector(`[data-ctl-title="${label}"]`));
    await flush();
    return pickerRows().map(nameOf);
  };
  it("reader 1: the background's 'a skill you're trained in' pool leaves out a skill only a 3rd-level increase trains", async () => {
    expect(db.backgrounds['chosen-one']?.choice?.kind, 'premise: a skills choice').toBe('skills');
    const b = chosenOne({ skillIncreases: { 3: 'arcana' } });
    expect(buildCharacter(b, db).proficiencies.skills.arcana, 'premise: the finished Arcana is trained').toBe('trained');
    const rows = await backgroundSkillRows(b);
    expect(rows.some((n) => n.startsWith('Acrobatics (')), 'the class-trained Acrobatics is offered (the list drew)').toBe(true);
    expect(rows.some((n) => n.startsWith('Arcana (')), 'Arcana (3rd-level increase) not offered').toBe(false);
  });
  it('reader 1, twin: Arcana from the 1st-level class pick is offered', async () => {
    const rows = await backgroundSkillRows(chosenOne({ classSkills: ['arcana'] }));
    expect(rows.some((n) => n.startsWith('Arcana (')), 'Arcana offered').toBe(true);
  });

  /*
   * Checker round 2, finding 1 (2026-10-23): a `minRank: 'untrained'` pool (Mechanical Symbiosis, "an additional skill
   * ... determined by the GM": any skill) read from the per-level history lost every skill no step touched — the
   * history holds only touched keys. trainedSkillOptions now lays every core skill under the map at untrained. Fighter
   * 3 with the 3rd-level increase on Stealth: all 16 core skills are offered and Stealth reads (U), its rank at
   * creation. Twin: Haunted (minRank trained) on the same build still offers only trained skills, so no Stealth.
   * Planted proof (2026-10-23): with the fill taken out the first case went red, the twin stayed green; reverted with
   * Edit, no PLANT marker left.
   */
  const featChoicePromptOf = (ch: { prompt?: string; flag?: string }) => featChoicePrompt(ch.prompt, ch.flag);
  const CORE = ['Acrobatics', 'Arcana', 'Athletics', 'Crafting', 'Deception', 'Diplomacy', 'Intimidation', 'Medicine', 'Nature', 'Occultism', 'Performance', 'Religion', 'Society', 'Stealth', 'Survival', 'Thievery'];
  const fighter3 = (backgroundId: string) =>
    mk({ level: 3, classId: 'fighter', ancestryId: 'human', heritageId: 'versatile-human', backgroundId, skillIncreases: { 3: 'stealth' } });
  it("reader 1: an 'any skill' background pool (Mechanical Symbiosis) offers every core skill, at its creation rank", async () => {
    const bg = db.backgrounds['mechanical-symbiosis'];
    expect([bg?.choice?.kind, bg?.choice?.minRank], 'premise: a skills choice at minRank untrained').toEqual(['skills', 'untrained']);
    const b = fighter3('mechanical-symbiosis');
    expect(buildCharacter(b, db).proficiencies.skills.stealth, 'premise: the finished Stealth is trained').toBe('trained');
    const rows = await backgroundSkillRows(b, featChoicePromptOf(bg!.choice!));
    expect(CORE.filter((s) => !rows.some((n) => n.startsWith(`${s} (`))), 'no core skill missing').toEqual([]);
    expect(rows, 'Stealth at its creation rank').toContain('Stealth (U)');
  });
  it('reader 1, twin: Haunted (a trained-only pool) on the same build offers no untrained skill', async () => {
    const bg = db.backgrounds.haunted;
    expect([bg?.choice?.kind, bg?.choice?.minRank ?? 'trained'], 'premise: a skills choice at minRank trained').toEqual(['skills', 'trained']);
    const rows = await backgroundSkillRows(fighter3('haunted'), featChoicePromptOf(bg!.choice!));
    expect(rows.length, 'the list drew').toBeGreaterThan(0);
    expect(rows.filter((n) => n.endsWith('(U)')), 'no untrained skill').toEqual([]);
    expect(rows.some((n) => n.startsWith('Stealth (')), 'Stealth (3rd-level increase) not offered').toBe(false);
  });

  /*
   * Reader 2: a homebrew background naming Stealth, which the rogue's class already trains → its replacement card.
   * Rogue 3 with the 2nd-level increase on Arcana and the 3rd-level one on Stealth: the heading says "Already trained
   * in Stealth" (the rank when the background is taken), not "expert"; Arcana is a live replacement (untrained at
   * creation); twin: Society, the 1st-level class pick, is greyed.
   */
  it('reader 2: the homebrew background replacement card reads the ranks at creation', async () => {
    const b = mk({
      level: 3, classId: 'rogue', keyAbility: 'dex', ancestryId: 'human', heritageId: 'versatile-human',
      backgroundId: CUSTOM_BACKGROUND_ID,
      customBackground: { name: 'Wanderer', description: '', boosts: ['dex', 'con'], trainedSkill: 'stealth', loreSubject: 'Roads', skillFeatId: null },
      classSkills: ['society'], skillIncreases: { 2: 'arcana', 3: 'stealth' },
    });
    const built = buildCharacter(b, db);
    expect(built.skillFallbacks, 'premise: the background owes a replacement').toEqual([{ featId: CUSTOM_BACKGROUND_ID, skill: 'stealth' }]);
    expect([built.proficiencies.skills.stealth, built.proficiencies.skills.arcana], 'premise: finished Stealth expert, Arcana trained').toEqual(['expert', 'trained']);
    const r = openPage0(b);
    const card = r.host.querySelector('[data-subcard$=" — replacement skill"]');
    expect(card?.getAttribute('data-subcard'), 'the heading').toBe('Already trained in Stealth — replacement skill');
    r.click(card!.querySelector('[data-ctl-title="Replacement skill"]'));
    await flush();
    const arcana = rowFor(pickerRows(), 'Arcana') as HTMLButtonElement | undefined;
    expect(!!arcana && !arcana.disabled, 'Arcana offered (untrained at creation)').toBe(true);
    expect((rowFor(pickerRows(), 'Society') as HTMLButtonElement | undefined)?.disabled, 'twin: Society (1st-level class pick) greyed').toBe(true);
  });

  /*
   * Reader 3: `newLoreRefusal`, the Trained skills card's "Learn a new lore". Fighter 2 with Additional Lore (Warfare)
   * in the 2nd-level skill slot: Warfare Lore bought at creation is accepted (print trains it now; the 2nd-level feat
   * then takes its own "already trained" clause); twin: Scribing Lore, the Acolyte's own, is refused.
   */
  const k2 = slot(2, 'fighter', 'skill');
  const warfareAt2 = (o: Partial<BuildState> = {}) =>
    mk({ level: 2, classId: 'fighter', ancestryId: 'human', heritageId: 'versatile-human', featPicks: { [k2]: 'additional-lore' }, featLoreChoices: { [`${k2}:0`]: 'Warfare' }, ...o });
  const learnLore = async (text: string, b: BuildState = warfareAt2()) => {
    if (b.featPicks?.[k2] === 'additional-lore') {
      expect(buildCharacter(b, db).proficiencies.skills['lore:warfare' as ProficiencyKey], 'premise: the finished Warfare Lore is trained').toBe('trained');
    }
    const r = openPage0(b);
    const card = r.host.querySelector('[data-setupcard="Trained skills"]');
    expect(card, 'the Trained skills card').toBeTruthy();
    r.click(card!.querySelector('[data-ctl-title="Add a trained skill"]'));
    await flush();
    r.click([...document.querySelectorAll('.picker-overlay .picker-item')].find((x) => x.textContent?.includes('Learn a new lore')) ?? null);
    await flush();
    typeInto(document.querySelector<HTMLInputElement>('.picker-overlay .popsel-custom input'), text);
    return {
      refusal: document.querySelector('.popsel-custom-refusal')?.textContent ?? null,
      addOff: document.querySelector<HTMLButtonElement>('.picker-overlay .popsel-custom-actions .btn-primary')!.disabled,
    };
  };
  it('reader 3: a Lore only a 2nd-level feat trains is accepted as a new Lore at creation', async () => {
    expect(await learnLore('Warfare')).toEqual({ refusal: null, addOff: false });
  });
  it("reader 3, twin: a Lore the background trains is refused", async () => {
    expect(await learnLore('Scribing')).toEqual({ refusal: 'Already trained in Scribing Lore — from your background. Choose a new Lore.', addOff: true });
  });

  /*
   * Checker finding 1 (2026-10-23): the creation readers read 1st level BEFORE ITS INCREASES, not the P0 phase alone —
   * print gives every 1st-level source together, so the 1st-level ancestry feat Dwarven Lore (placed after P0 by the
   * engine) has already trained Dwarf Lore when the class's "Learn a new lore" asks. Twin: Dwarven Lore taken in the
   * 5th-level ancestry slot does not, so "Dwarf" is accepted. Planted proof (2026-10-23): with the helper's point back
   * on 'creation' the first case went red, the twin stayed green; reverted with Edit, no PLANT marker left.
   */
  const dwarf = (lvl: 1 | 5) =>
    mk({ level: lvl, classId: 'fighter', ancestryId: 'dwarf', heritageId: 'anvil-dwarf', featPicks: { [slot(lvl, 'fighter', 'ancestry')]: 'dwarven-lore' } });
  it('reader 3: a Lore a 1st-level ancestry feat trains (Dwarven Lore) is refused at creation', async () => {
    const b = dwarf(1);
    const c = buildCharacter(b, db);
    expect(c.proficiencies.skills['lore:dwarf' as ProficiencyKey], 'premise: Dwarf Lore trained at 1st').toBe('trained');
    expect(skillRanksAtLevel(c, 1, 'creation')?.['lore:dwarf' as ProficiencyKey] ?? 'untrained', 'premise: not in the P0 phase alone').toBe('untrained');
    const got = await learnLore('Dwarf', b);
    expect(got.addOff, 'Add disabled').toBe(true);
    expect(got.refusal ?? '', 'refused as already trained').toMatch(/^Already trained in Dwarf Lore/);
  });
  it('reader 3, twin: Dwarven Lore at 5th does not make Dwarf Lore "already trained" at creation', async () => {
    expect(await learnLore('Dwarf', dwarf(5))).toEqual({ refusal: null, addOff: false });
  });

  /*
   * Checker finding 2 (2026-10-23): the Languages card's reason for a stored "Lore instead of language" that does not
   * count reads the P0 ranks (where the engine judges it), never the finished ones. Int +0 (no Int slot) and
   * Additional Lore (Warfare) at 2nd: the stored Warfare Lore is idle for want of a slot, not "already trained".
   * Twin: a stored Scribing Lore, the Acolyte's own, is "already trained". Planted proof (2026-10-23): the old line
   * (`ch.proficiencies.skills[key]`) put back turned the first case red, the twin stayed green; reverted with Edit.
   */
  const languageLoreLabel = (stored: string) => {
    const b = warfareAt2({ variantRules: { loreInsteadOfLanguage: true } as BuildState['variantRules'], languageLores: [stored] });
    const c = buildCharacter(b, db);
    expect(Math.floor((c.abilities.int - 10) / 2), 'premise: Int +0 or lower, no Int slot').toBeLessThanOrEqual(0);
    const r = openPage0(b);
    const card = [...r.host.querySelectorAll('.lvl-slot-wrap')].find((w) => (w.querySelector('.lvl-card-val')?.textContent ?? '').trim() === `${stored} Lore`);
    return (card?.querySelector('.lvl-card-label')?.textContent ?? '').trim();
  };
  it("languages card: a stored Lore only a 2nd-level feat trains is idle for want of a slot, not 'already trained'", () => {
    expect(languageLoreLabel('Warfare')).toBe('Lore — not counted: no free language slot from Intelligence');
  });
  it("languages card, twin: a stored Lore the background trains is 'already trained'", () => {
    expect(languageLoreLabel('Scribing')).toMatch(/^Lore — not counted: already trained/);
  });
});
