// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { Builder } from '../src/builder/Builder';
import { emptyBuild, levelChoices, levelGrants, type BuildState } from '../src/rules/build';
import { askedAtDailyPrep } from '../src/rules/derive';
import { dailyChoicesFor } from '../src/rules/dailyChoices';
import type { Character } from '../src/rules/types';

/**
 * A DAILY choice must be asked at DAILY PREPARATIONS — and NOWHERE ELSE (gold-set Q23).
 *
 * > "shouldn't appear in the builder, they should appear when the user presses the daily prep
 * > button… by default it will be the last choice he made."
 *
 * The default-to-last-pick half was already true: `PlayState.dailyChoices` survives `rest()`. The
 * half that was not is this one. Both CLASS-FEATURE call sites in Builder guarded on the flag; the
 * FEAT one did not, so Harbinger's Armament asked for today's rune while you were building the
 * character AND again every morning — two stores for one answer, and only the morning's moved a
 * number (build.ts has never applied a daily answer).
 *
 * Asserted against the RENDERED BUILDER rather than a predicate: the bug was a JSX branch, and a
 * test that only asked whether some function returns false would have passed while it was live.
 */
const c = () => content();
const noop = () => undefined;

/** The `${level}:${category}:${index}` slot key of the first class-feat slot at `level`. */
function classSlotKey(level: number, classId: string): string {
  const g = levelGrants(level, classId, content(), null, undefined, null, null, false, []);
  const i = g.featSlots.findIndex((s) => s === 'class');
  expect(i, `no class feat slot at level ${level}`).toBeGreaterThanOrEqual(0);
  return `${level}:class:${i}`;
}

const buildWith = (level: number, slot: string, featId: string): BuildState => ({
  ...emptyBuild(),
  name: 't',
  level,
  classId: 'fighter',
  ancestryId: 'human',
  heritageId: 'skilled-human',
  backgroundId: 'acolyte',
  keyAbility: 'str',
  featPicks: { [slot]: featId },
});

/** Open a level page in the rendered builder and hand back its text. */
function textAtLevel(b: BuildState, level: number): string {
  const r = renderDom(<Builder content={c()} initial={b} onCancel={noop} onCreate={noop} />);
  const tab = [...r.host.querySelectorAll<HTMLButtonElement>('button')].find(
    (x) => (x.textContent ?? '').trim() === String(level),
  );
  r.click(tab ?? null);
  const text = r.host.textContent ?? '';
  r.stop();
  return text;
}

describe("Q23 — the builder stops asking a feat's daily choice", () => {
  it("does not render Harbinger's Armament rune picker in the builder", () => {
    const slot = classSlotKey(8, 'fighter');
    const text = textAtLevel(buildWith(8, slot, 'harbingers-armament'), 8);
    // We are on the right page and the feat really is picked…
    expect(text).toContain("Harbinger's Armament");
    // …and its daily question is not asked here.
    expect(text).not.toContain('Rune today');
    expect(text).not.toContain('Ghost Touch');
  });

  it('still renders a NON-daily feat choice in the same place — the guard is targeted', () => {
    // Eidolon's Wrath is a 6th-level class feat whose damage type is chosen once, when taken.
    const slot = classSlotKey(6, 'fighter');
    const text = textAtLevel(buildWith(6, slot, 'eidolons-wrath'), 6);
    expect(text).toContain("Eidolon's Wrath");
    expect(text).toContain("Eidolon's Wrath damage type");
  });

  it('the level stops reporting an unanswerable "1 choice left"', () => {
    // The pending count read the same records the picker did. Leaving it alone would have put a
    // permanent "1 choice left" tag on level 8 with no control on the page able to clear it.
    const slot = classSlotKey(8, 'fighter');
    const b = buildWith(8, slot, 'harbingers-armament');
    expect(levelChoices(b, c()).some((m) => m.label.includes("Harbinger's Armament"))).toBe(false);
    // A non-daily choice is still counted, so the counter did not simply go blind.
    const b2 = buildWith(6, classSlotKey(6, 'fighter'), 'eidolons-wrath');
    expect(levelChoices(b2, c()).some((m) => m.label.includes("Eidolon's Wrath"))).toBe(true);
  });

  it('…because daily preparations asks it instead', () => {
    const base = { ...(emptyBuild() as unknown as Character) };
    const ch = {
      ...base,
      level: 8,
      feats: [{ featId: 'harbingers-armament', source: 'test' }],
    } as unknown as Character;
    const asked = dailyChoicesFor(ch, c()).find((d) => d.recordId === 'harbingers-armament');
    expect(asked, 'the rune must be askable at daily prep').toBeTruthy();
    expect(asked!.options.map((o) => o.value)).toContain('ghost-touch');
  });
});

describe('nothing is hidden from BOTH screens', () => {
  /*
   * The one way this change could be worse than the bug: a daily choice the Rest sheet cannot render
   * either. `dailyChoicesFor` only handles 'array' / 'text' / 'open' — a 'skills' or 'domains' menu
   * resolves against the build, not the morning — so `askedAtDailyPrep` requires BOTH the flag and an
   * askable kind, and anything else keeps its builder picker.
   *
   * Ancient Memories WAS the single record in that state, and it is why this list was ever non-empty:
   * its `kind: 'skills'` menu resolved through `trainedSkillOptions`, i.e. the skills you are ALREADY
   * trained in, so every option the builder offered was a wasted grant and the untrained skills the
   * feat exists to help could not be picked at all. It is now a `kind: 'array'` daily menu of the
   * skills you are UNTRAINED in, like Haunting Memories and Endless Memories, so the list is EMPTY.
   * This pins it: a new record in that state fails here rather than silently becoming unanswerable.
   */
  it('every daily choice is asked on exactly one of the two screens', () => {
    const db = c();
    const stranded: string[] = [];
    const buckets = ['feats', 'classFeatures', 'items', 'ancestries', 'heritages', 'backgrounds'] as const;
    for (const bucket of buckets) {
      for (const [id, rec] of Object.entries(db[bucket] as Record<string, { choice?: { daily?: boolean; kind?: string } }>)) {
        const def = rec?.choice;
        if (!def?.daily) continue;
        // Hidden from the builder ⇒ the Rest sheet must be able to render it, and vice versa.
        if (!askedAtDailyPrep(def as never)) stranded.push(`${id} (kind ${def.kind})`);
      }
    }
    expect(stranded.sort()).toEqual([]);
  });

  it('Ancient Memories is asked at daily preparations and NOT in the builder', () => {
    const slot = classSlotKey(4, 'fighter');
    const text = textAtLevel(buildWith(4, slot, 'ancient-memories'), 4);
    // We are on the right page and the feat really is picked…
    expect(text).toContain('Ancient Memories');
    // …and its daily question is not asked here (Q23), nor is the duplicate FEAT_SKILL_GRANTS picker
    // that used to render a second 16-skill "Trained skill" list beside it.
    expect(text).not.toContain('Skill remembered from a past life');
    // ⚠ `(?!s)` is load-bearing: the character rail on this very page reads "Trained skills", so a
    // plain substring check passes whatever the builder does. Positive control below.
    expect(text).not.toMatch(/Trained skill(?!s)/);
  });

  it('…and that assertion can still fail — a feat that DOES keep its skill picker still shows it', () => {
    // Without this control the test above would pass if `SubCard label="Trained skill"` were deleted
    // outright, or if the regex were wrong. Cleric Dedication grants "trained in one skill of your
    // choice" permanently, at build time — the picker there is correct and must stay.
    const slot = classSlotKey(4, 'fighter');
    const text = textAtLevel(buildWith(4, slot, 'cleric-dedication'), 4);
    expect(text).toContain('Cleric Dedication');
    expect(text).toMatch(/Trained skill(?!s)/);
  });
});
