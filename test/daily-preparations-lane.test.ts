import { describe, expect, it } from 'vitest';
import { build, content } from './_content';
import { dailyChoicesFor, dailyChoiceLabel } from '../src/rules/dailyChoices';
import { askedAtDailyPrep, deriveSkill, dailySkillRank } from '../src/rules/derive';
import { applyPlayState, initialPlay } from '../src/rules/play';
import { FEAT_GRANTS } from '../src/rules/featGrants';
import { scanShapeA, scanShapeB, loadCore, loadRegistry } from '../scripts/scan-daily-prep.mjs';

/**
 * "During your daily preparations … until you prepare again" — the TEMPORARY-PROFICIENCY lane.
 *
 * Seven records print that sentence. Ruling Q23 says a pick re-made every morning renders at Daily
 * preparations, never in the builder, and defaults to yesterday's answer.
 *
 * The prerequisite exclusion is the point worth pinning, and it needs no machinery: a daily answer
 * lives in `PlayState.dailyChoices` and is merged in by `deriveSkill`/`applyPlayState`, while
 * `checkPrerequisites` reads the BUILT character. Keeping the grant out of the build IS the
 * enforcement — which is why `FEAT_SKILL_GRANTS['ancient-memories']` and `['endless-memories']`,
 * permanent build-time grants of the same ranks, had to go.
 */
const db = content();

describe('the temporary-proficiency lane', () => {
  it('every record in the family is asked at daily preparations, never in the builder', () => {
    for (const id of [
      'ageless-spirit',
      'ancestral-longevity',
      'ancient-memories',
      'ancestral-linguistics',
      'endless-memories',
      'expert-longevity',
      'twilight-talon-dedication',
    ]) {
      const def = db.feats[id]?.choice;
      expect(def, `${id} carries no choice at all`).toBeTruthy();
      expect(askedAtDailyPrep(def), `${id} must be askable at the Rest sheet`).toBe(true);
    }
  });

  it('offers only skills you are UNTRAINED in — every other option is a wasted grant (Q21)', () => {
    const ch = build('wizard', 3, { featPicks: { '1:ancestry:0': 'ancestral-longevity' } });
    const choice = dailyChoicesFor(ch, db).find((c) => c.recordId === 'ancestral-longevity');
    expect(choice, 'never reached the Rest sheet').toBeTruthy();
    // Asserted against the real build, not a guess, so a class change cannot make this vacuous.
    expect(ch.proficiencies.skills.arcana).toBe('trained');
    expect(ch.proficiencies.skills.stealth ?? 'untrained').toBe('untrained');
    const offered = choice!.options.map((o) => o.value);
    expect(offered).not.toContain('arcana');
    expect(offered).not.toContain('religion');
    expect(offered).toContain('stealth');
    expect(offered).toHaveLength(14);
  });

  it("the morning's answer moves the skill, and does NOT enter the build", () => {
    const ch = build('wizard', 3, { featPicks: { '1:ancestry:0': 'ancestral-longevity' } });
    const KEY = 'ancestral-longevity:ancestralLongevitySkill';
    const before = deriveSkill(ch, 'stealth', db);
    const after = deriveSkill({ ...ch, dailyChoices: { [KEY]: 'stealth' } }, 'stealth', db);
    expect(before.rank).toBe('untrained');
    expect(after.rank).toBe('trained');
    expect(after.modifier).toBeGreaterThan(before.modifier);
    // "you can't use it as a prerequisite for a skill increase or a permanent character option like a
    // feat" — enforced by the rank never reaching the store `checkPrerequisites` reads.
    expect(ch.proficiencies.skills.stealth ?? 'untrained').toBe('untrained');
    // …and the sheet's "today" badge reads the same source, so the row can say the rank lapses.
    expect(dailySkillRank({ ...ch, dailyChoices: { [KEY]: 'stealth' } }, db, 'stealth')).toBe('trained');
    expect(dailySkillRank(ch, db, 'stealth')).toBeUndefined();
  });

  it('Ancient Memories no longer trains a skill permanently by defaulting a second picker', () => {
    // FEAT_SKILL_GRANTS['ancient-memories'] asked the same question again in the builder, and an
    // unanswered slot defaults to its FIRST option — so a character who answered nothing silently
    // became trained in Acrobatics, in the very store the feat's text forbids.
    expect(FEAT_GRANTS['ancient-memories']).toBeUndefined();
    const ch = build('wizard', 3, { featPicks: { '1:ancestry:0': 'ancient-memories' } });
    expect(ch.proficiencies.skills.acrobatics ?? 'untrained').toBe('untrained');
  });

  it('Endless Memories upgrades a TRAINED skill, and grants nothing permanently', () => {
    expect(FEAT_GRANTS['endless-memories']).toBeUndefined();
    const ch = build('wizard', 9, {
      ancestryId: 'ghoran',
      featPicks: { '1:ancestry:0': 'ancient-memories', '9:ancestry:0': 'endless-memories' },
    });
    // It used to be EXPERT here, unchosen, from the same defaulting bug one rank up.
    expect(ch.proficiencies.skills.acrobatics ?? 'untrained').toBe('untrained');
    const row = dailyChoicesFor(ch, db).find((c) => c.recordId === 'endless-memories')!;
    const offered = row.options.map((o) => o.value);
    expect(offered).toContain('arcana'); // trained by the class
    expect(offered).not.toContain('stealth'); // untrained — not what the sentence offers
    const KEY = 'endless-memories:endlessMemoriesSkill';
    expect(deriveSkill({ ...ch, dailyChoices: { [KEY]: 'arcana' } }, 'arcana', db).rank).toBe('expert');
  });

  it('Expert Longevity — the elf twin — is asked on the same screen as its parent', () => {
    // Its own sentence ends "This lasts until your Ancestral Longevity expires", so it is a daily
    // pick; it used to be a BUILD-time `kind: 'skills'` picker while its parent asked nothing at all.
    const ch = build('wizard', 9, {
      ancestryId: 'elf',
      featPicks: { '1:ancestry:0': 'ancestral-longevity', '9:ancestry:0': 'expert-longevity' },
    });
    const rows = dailyChoicesFor(ch, db).map((r) => r.recordId);
    expect(rows).toContain('ancestral-longevity');
    expect(rows).toContain('expert-longevity');
    const KEY = 'expert-longevity:longevitySkill';
    expect(deriveSkill({ ...ch, dailyChoices: { [KEY]: 'arcana' } }, 'arcana', db).rank).toBe('expert');
  });

  it('the caveat each record prints reaches the Rest sheet', () => {
    // `FeatChoiceDef.note` had always carried it and `DailyChoice` had no field to pass it through,
    // so these records stated their most important rule to nobody.
    const base = build('wizard', 9, {});
    for (const id of ['ageless-spirit', 'ancient-memories', 'endless-memories', 'twilight-talon-dedication']) {
      // The feat is attached directly rather than through an ancestry slot, so one loop covers a
      // leshy feat, two ghoran feats and an archetype dedication without four different builds.
      const withFeat = { ...base, feats: [{ featId: id, source: 'test' }] };
      const choice = dailyChoicesFor(withFeat, db).find((c) => c.recordId === id);
      expect(choice?.note, `${id} — DailyChoice.note is what renders it`).toMatch(/until you prepare again|until your/i);
    }
  });
});

describe('Ancestral Linguistics — a language re-chosen every morning', () => {
  const KEY = 'ancestral-linguistics:ancestralLanguage';
  const elf = () => build('wizard', 3, { ancestryId: 'elf', featPicks: { '1:ancestry:0': 'ancestral-linguistics' } });

  it('is asked at daily preparations, over the whole language list', () => {
    const choice = dailyChoicesFor(elf(), db).find((c) => c.recordId === 'ancestral-linguistics');
    expect(choice?.kind).toBe('open');
    // "one common language or one other language you have access to" — Q5: an access clause gates
    // nothing in the app, so the whole list is offered rather than a guessed two-tier split.
    expect(choice!.options.length).toBeGreaterThan(50);
  });

  it('does NOT offer a language you already speak (Q27 / Q21)', () => {
    // An option the applier discards must not be rendered as a live one: `applyPlayState` filters
    // these, so offering them is a control that does nothing when pressed.
    const ch = elf();
    const offered = dailyChoicesFor(ch, db).find((c) => c.recordId === 'ancestral-linguistics')!.options.map((o) => o.value);
    expect(ch.languages.length).toBeGreaterThan(0);
    for (const known of ch.languages) expect(offered, `${known} is already known`).not.toContain(known);
    expect(offered).toContain('aklo');
  });

  it('carries the rarity the picker computes, WITHOUT putting it in the stored label', () => {
    // `openChoiceOptions` returns note: 'uncommon' | 'rare' and `dailyChoicesFor` used to drop it, so
    // the two-tier distinction the text draws reached no pixel. It rides on `note`, not `label`, so
    // the "reusing yesterday's answers" summary still reads "Akitonian" rather than "Akitonian (rare)".
    const choice = dailyChoicesFor(elf(), db).find((c) => c.recordId === 'ancestral-linguistics')!;
    const rare = choice.options.find((o) => o.value === 'akitonian')!;
    expect(rare.label).toBe('Akitonian');
    expect(rare.note).toBe('rare');
    expect(choice.options.some((o) => o.note === 'uncommon')).toBe(true);
    expect(dailyChoiceLabel(choice, { [KEY]: 'akitonian' })).toBe('Akitonian');
  });

  it("this morning's answer becomes a language the sheet shows, marked as temporary", () => {
    const ch = elf();
    expect(ch.languages).not.toContain('aklo');
    const live = applyPlayState(ch, { ...initialPlay(ch, db), dailyChoices: { [KEY]: 'aklo' } }, db);
    expect(live.languages).toContain('aklo');
    expect(live.dailyLanguages).toEqual(['aklo']);
    // …and it stays out of the BUILD, which is what a prerequisite would be read from.
    expect(ch.languages).not.toContain('aklo');
  });

  it('an answer that is not a real language grants nothing', () => {
    const ch = elf();
    const live = applyPlayState(ch, { ...initialPlay(ch, db), dailyChoices: { [KEY]: 'not-a-language' } }, db);
    expect(live.dailyLanguages).toBeUndefined();
    expect(live.languages).toEqual(ch.languages);
  });

  it('the one NON-granting language picker in the data is untouched', () => {
    // Settlement Scholastics also has `from.type === 'language'`. Keying the grant off the type
    // alone would have made it start granting silently; `grantLanguage` is the opt-in that stops it.
    expect(db.feats['settlement-scholastics'].choice?.from?.grantLanguage).toBeUndefined();
    const ch = build('wizard', 5, { featPicks: { '4:class:0': 'settlement-scholastics' } });
    const live = applyPlayState(
      ch,
      { ...initialPlay(ch, db), dailyChoices: { 'settlement-scholastics:settlementLanguage': 'aklo' } },
      db,
    );
    expect(live.dailyLanguages).toBeUndefined();
    expect(live.languages).toEqual(ch.languages);
  });
});

/**
 * The corpus guards. `npm run scan:daily` reports these two shapes; the detectors are imported here
 * rather than re-implemented, so the CLI and the guard can never disagree.
 */
describe('npm run scan:daily — the corpus stays clean', () => {
  const core = loadCore();
  const registry = loadRegistry();

  it('SHAPE B is ZERO: nothing grants the same proficiency in the build AND every morning', () => {
    expect(scanShapeB(core, registry)).toEqual([]);
  });

  it('SHAPE A has no TODO: every record printing the clause is askable at daily preparations', () => {
    const a = scanShapeA(core);
    expect(a.length, 'the detector matched nothing — it has been narrowed to uselessness').toBeGreaterThanOrEqual(8);
    expect(a.filter((r) => !r.ok && !r.exempt).map((r) => r.key)).toEqual([]);
    // Every exemption states its reason, so a future narrowing cannot hide behind an empty string.
    for (const r of a.filter((r) => r.exempt)) expect(r.exempt!.length).toBeGreaterThan(40);
  });

  it('…and both detectors STILL FIRE — proven against the pre-fix state, not assumed', () => {
    /*
     * A scanner that reports zero is only evidence if it has been seen to report something. These
     * fixtures are the exact shapes that shipped before this lane was built:
     *   · ancient-memories with `kind: 'skills'` (askable nowhere) — SHAPE A
     *   · its `FEAT_SKILL_GRANTS` line back in the registry — SHAPE B
     */
    const beforeCore = {
      feats: {
        'ancient-memories': {
          name: 'Ancient Memories',
          description: 'During your daily preparations, you can explore your memories of your past lives to become trained in one skill of your choice. This proficiency lasts until you prepare again.',
          choice: { flag: 'ancientMemoriesSkill', prompt: 'Skill remembered from a past life', kind: 'skills', daily: true },
        },
      },
    };
    const a = scanShapeA(beforeCore);
    expect(a).toHaveLength(1);
    expect(a[0].ok, "kind 'skills' is askable at neither screen").toBe(false);
    expect(a[0].exempt).toBeNull();

    const beforeRegistry = "  'ancient-memories': { skillChoices: [{ options: 'any', rank: 'trained' }] },\n";
    const b = scanShapeB(beforeCore, beforeRegistry);
    expect(b.map((r) => r.id)).toEqual(['ancient-memories']);

    // And it does not fire on a record that is merely IN the registry with a daily choice that moves
    // no skill — the false positive the naive version of this detector produced.
    const innocent = {
      feats: {
        'harbingers-armament': {
          name: "Harbinger's Armament",
          description: 'During your daily preparations, choose a rune.',
          choice: { flag: 'rune', prompt: 'Rune today', kind: 'array', daily: true, options: [{ value: 'ghost-touch', label: 'Ghost Touch' }] },
        },
      },
    };
    expect(scanShapeB(innocent, "  'harbingers-armament': { skills: { crafting: 'trained' } },\n")).toEqual([]);
  });
});

/**
 * THE PICKER HAS TO REMEMBER ITS OWN ANSWER.
 *
 * `dailyChoicesFor` drops languages the character already speaks — right, because a language you know
 * is wasted for the whole career and Q27 says don't render an option that does nothing. But the
 * character the sheet passes in is the applyPlayState OUTPUT, whose `languages` already contains this
 * morning's pick. So the filter removed the answer from its own option list: the `<select>` found no
 * matching `<option>` and showed the placeholder every morning while the answer was still stored, and
 * the reuse summary printed "not set" while the Details tab showed the language — two screens
 * disagreeing, which is exactly what Q27 exists to prevent.
 *
 * ⚠ These assert on the LIVE character, not the build one. The original test for this lane checked
 * only the build character, where the bug cannot appear — which is why it passed while shipping this.
 */
describe('a daily language choice on the live character', () => {
  const setup = () => {
    const con = content();
    const ch = build('fighter', 6, { ancestryId: 'elf', featPicks: { '1:ancestry:0': 'ancestral-linguistics' } });
    const row = dailyChoicesFor(ch, con).find((r) => r.recordId === 'ancestral-linguistics')!;
    const play = { ...initialPlay(ch, con), dailyChoices: { [row.key]: 'aklo' } };
    return { con, ch, row, play, live: applyPlayState(ch, play, con) };
  };

  it('keeps the answer in its own option list, so the select can show it', () => {
    const { con, live, play } = setup();
    const rowLive = dailyChoicesFor(live, con).find((r) => r.recordId === 'ancestral-linguistics')!;
    expect(live.languages ?? []).toContain('aklo');
    expect(rowLive.options.map((o) => o.value)).toContain('aklo');
    expect(dailyChoiceLabel(rowLive, play.dailyChoices)).toBe('Aklo');
  });

  it('and still hides a language the character knows permanently', () => {
    const { con, live } = setup();
    const rowLive = dailyChoicesFor(live, con).find((r) => r.recordId === 'ancestral-linguistics')!;
    const permanent = (live.languages ?? []).find((l) => !(live.dailyLanguages ?? []).includes(l))!;
    expect(permanent).toBeTruthy();
    expect(rowLive.options.map((o) => o.value)).not.toContain(permanent);
  });
});
