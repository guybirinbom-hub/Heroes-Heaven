import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { dailyItemSlots } from '../src/rules/dailyItems';
import type { Character, ContentDatabase } from '../src/rules/types';

/**
 * Wanderer's-Guide parity batch 031 — the GAP lane of the `engine` family.
 *
 * Two cross-file gaps the engine builder could not close from its own files: the record's
 * `redundantFallback` flags (src/rules/featGrantsAuto.ts) and the per-taking multiplier
 * (src/rules/dailyItems.ts). Both are pinned here on a BUILT character through the reader the sheet
 * actually calls, and the data half that has yet to land is patched into a content COPY in memory —
 * never asserted as a patched-vs-shipped delta, so every assertion reads the same once the row lands.
 */
const db = content();

/** A content copy with one record's fields overlaid — the in-memory stand-in for a backfill row. */
function patched(bucket: 'feats', id: string, fields: Record<string, unknown>): ContentDatabase {
  const b = db[bucket] as unknown as Record<string, Record<string, unknown>>;
  return { ...db, [bucket]: { ...b, [id]: { ...b[id], ...fields } } } as unknown as ContentDatabase;
}

function buildOn(cdb: ContentDatabase, classId: string, level: number, over: Partial<BuildState> = {}): Character {
  const cls = cdb.classes[classId];
  return buildCharacter(
    {
      ...emptyBuild(),
      name: 't',
      level,
      classId,
      ancestryId: Object.keys(cdb.ancestries)[0],
      backgroundId: Object.keys(cdb.backgrounds)[0],
      keyAbility: (cls && cls.keyAbility.length === 1 ? cls.keyAbility[0] : null) as BuildState['keyAbility'],
      subclassId: (cls?.subclass?.options[0]?.id as string) ?? null,
      ...over,
    },
    cdb,
  );
}

/* ------------------------------------------- golden-league-xun-dedication#already-expert */

describe('golden-league-xun-dedication replaces its dead expert slots (feats/golden-league-xun-dedication)', () => {
  /*
   * AoN feat-2734: "You gain expert proficiency in two of the following skills (OR IN TWO OTHER SKILLS
   * OF YOUR CHOICE IN WHICH YOU'RE TRAINED, IF YOU WERE ALREADY AN EXPERT IN THE LISTED SKILLS):
   * Athletics, Deception, Intimidation, or Stealth."
   *
   * The engine half (the replacement landing at the slot's own rank, and only on a skill the character
   * already holds) shipped with the engine lane, but the record set no `redundantFallback` at all, so
   * `slotFallback` was undefined and the clause reached no character. These assertions run against the
   * SHIPPED registry — no patching — so they fail unless the two slot flags are really on the record.
   */
  const GLX = 'golden-league-xun-dedication';

  /** A level-8 rogue who spent a skill increase on Athletics, so the listed skill is already expert —
   *  the state the parenthetical is written for — with Acrobatics trained and Occultism untrained. */
  const xun = (over: Partial<BuildState> = {}): Character =>
    buildOn(db, 'rogue', 8, {
      classSkills: ['athletics', 'acrobatics'],
      skillIncreases: { 3: 'athletics' },
      featPicks: { '8:class:0': GLX },
      ...over,
    });

  // batch 031: golden-league-xun-dedication#already-expert
  it('golden-league-xun-dedication reports a dead slot as an EXPERT-rank replacement', () => {
    const c = xun();
    expect(c.proficiencies.skills.athletics).toBe('expert'); // the precondition the clause names
    const fb = (c.skillFallbacks ?? []).filter((f) => f.featId === GLX);
    expect(fb.length).toBeGreaterThan(0);
    expect(fb.every((f) => f.rank === 'expert')).toBe(true);
  });

  // batch 031: golden-league-xun-dedication#already-expert
  it('golden-league-xun-dedication raises the replacement skill to expert on the sheet', () => {
    const c = xun({ featSkillChoices: { [`${GLX}:fallback:athletics`]: 'acrobatics' } });
    expect(c.proficiencies.skills.acrobatics).toBe('expert');
    // …and it is the feat that does it: the same rogue without it keeps Acrobatics at trained.
    const without = buildOn(db, 'rogue', 8, { classSkills: ['athletics', 'acrobatics'], skillIncreases: { 3: 'athletics' } });
    expect(without.proficiencies.skills.acrobatics).toBe('trained');
  });
});

/* ----------------------------------------------------------------------- ubiquitous-gadgets */

describe('ubiquitous-gadgets grants its gadgets once per taking (feats/ubiquitous-gadgets)', () => {
  /*
   * AoN feat-3068, the feat's whole mechanic: "Increase the number of temporary gadgets you can create
   * each day by 2. **Special** You can select this feat a second time if you are 14th level or higher."
   *
   * The `dailyTemporaryItems` rows are DATA STILL NEEDED (authored in work/.b031-rows-engine.json), so
   * they are patched into a content copy here. `dailyItemSlots` deduped its sources by feat id, which
   * made the printed second taking buy nothing; the count is now per taking, clamped to `maxTakes()`.
   */
  const GADGET_FILTER = {
    traits: ['gadget'],
    fromKnownFormulas: true,
    note: "Gadgets prepared this way don't cost you any resources to Craft and don't have any sale value; they fall apart at your next daily preparations if you haven't used them.",
  };
  const ROW = [{ id: 'ubiquitous', label: 'Temporary gadget', count: 2, filter: GADGET_FILTER }];
  const cdb = patched('feats', 'ubiquitous-gadgets', { dailyTemporaryItems: ROW });
  const slotsFrom = (c: Character, id: string) => dailyItemSlots(c, cdb).filter((s) => s.sourceId === id);

  // batch 031: ubiquitous-gadgets
  it('one taking of ubiquitous-gadgets gives the printed two gadgets', () => {
    const c = buildOn(cdb, 'inventor', 14, { featPicks: { '8:class:0': 'ubiquitous-gadgets' } });
    expect(c.feats.filter((f) => f.featId === 'ubiquitous-gadgets').length).toBe(1);
    expect(slotsFrom(c, 'ubiquitous-gadgets').length).toBe(2);
  });

  // batch 031: ubiquitous-gadgets
  it('the SECOND taking of ubiquitous-gadgets adds two more, not nothing', () => {
    const c = buildOn(cdb, 'inventor', 14, {
      featPicks: { '8:class:0': 'ubiquitous-gadgets', '14:class:0': 'ubiquitous-gadgets' },
    });
    expect(c.feats.filter((f) => f.featId === 'ubiquitous-gadgets').length).toBe(2);
    expect(slotsFrom(c, 'ubiquitous-gadgets').length).toBe(4);
    // Distinct storage keys, or the Rest sheet would show four rows sharing two answers.
    expect(new Set(slotsFrom(c, 'ubiquitous-gadgets').map((s) => s.key)).size).toBe(4);
  });

  // batch 031: ubiquitous-gadgets
  it('a NON-repeatable source is still counted once however often it reaches c.feats', () => {
    /* The case the dedupe was written for, kept: gadget-specialist has no `maxTakable`, so
     * `maxTakes()` is 1 and two entries grant one feat's worth of slots. */
    const spec = patched('feats', 'gadget-specialist', {
      dailyTemporaryItems: [
        { id: 'gadget', label: 'Temporary gadget', countByProficiency: { key: 'crafting', ranks: { expert: 2, master: 3, legendary: 4 } }, filter: GADGET_FILTER },
      ],
    });
    const c = buildOn(spec, 'inventor', 14, {
      featPicks: { '8:class:0': 'gadget-specialist', '14:class:0': 'gadget-specialist' },
    });
    const n = dailyItemSlots(c, spec).filter((s) => s.sourceId === 'gadget-specialist').length;
    expect(n).toBe(3); // a level-14 inventor is a MASTER in Crafting — feat-3058's printed three
  });
});
