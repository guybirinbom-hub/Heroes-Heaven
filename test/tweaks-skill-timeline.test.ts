import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEngine } from '../scripts/blocks-parity-snapshot.mjs';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { explainStat, type TimelineEntry } from '../src/rules/explain';
import type { BuildOverrides, Character, ProficiencyRank, TweakMeta } from '../src/rules/types';
import { content } from './_content';

/**
 * THE TIMELINES NAME THE RANK TWEAKS (plan B WP5; part B open point 4). A skill's breakdown timeline is
 * replayed in level order from untrained, the way the build applies it: the 1st-level training, an
 * "at least" floor at its start level before that level's increases, each skill increase stepped with the
 * build's own step and level cap (an increase that changed nothing says so), a raise the replay cannot
 * name, and an "exactly" hold last. The save, Perception, class DC and armor timelines get the same floor
 * and hold lines. Its last rank is the stored rank — checked on every character of the parity snapshot.
 * Synthetic characters only.
 */

const db = content();

function hero(classId: string, level: number, more: Partial<BuildState> = {}): BuildState {
  const cls = db.classes[classId];
  return {
    ...emptyBuild(),
    name: 't',
    level,
    classId,
    keyAbility: (cls.keyAbility.length === 1 ? cls.keyAbility[0] : 'str') as BuildState['keyAbility'],
    ancestryId: 'human',
    // Acolyte trains Religion and Scribing Lore; a wizard is trained in Arcana. Athletics: neither.
    backgroundId: 'acolyte',
    subclassId: (cls.subclass?.options[0]?.id as string) ?? null,
    levelBoosts: ['str', 'dex', 'con', 'wis'],
    ...more,
  } as BuildState;
}
const rankTweak = (key: string, rank: string, meta: Partial<TweakMeta>): BuildOverrides => ({
  proficiencies: { [key]: rank as ProficiencyRank },
  meta: { [`proficiencies:${key}`]: { of: rank, ...meta } },
});
const atLeast = (key: string, rank: string, more: Partial<TweakMeta> = {}) => rankTweak(key, rank, { mode: 'atLeast', ...more });
const exactly = (key: string, rank: string, more: Partial<TweakMeta> = {}) => rankTweak(key, rank, { mode: 'exactly', ...more });
const build = (b: BuildState, overrides?: BuildOverrides): Character => buildCharacter({ ...b, ...(overrides ? { overrides } : {}) } as BuildState, db);

const skillLine = (c: Character, skill: string) => explainStat(c, db, { kind: 'skill', skill }).timeline;
const rows = (t: TimelineEntry[]) => t.map((e) => `${e.level} ${e.text}${e.detail ? ` [${e.detail}]` : ''} = ${e.rank}`);
const lastRank = (t: TimelineEntry[]) => t[t.length - 1]?.rank ?? 'untrained';

describe('the skill timeline names the rank tweaks', () => {
  const wiz3 = hero('wizard', 3, { skillIncreases: { 3: 'athletics' } } as Partial<BuildState>);

  it("the skill timeline names an 'at least' floor", () => {
    const c = build(wiz3, atLeast('athletics', 'trained', { reason: 'tutored' }));
    expect(c.proficiencies.skills.athletics).toBe('expert');
    expect(rows(skillLine(c, 'athletics'))).toEqual(['1 At least Trained [Tweak (tutored)] = trained', '3 Skill increase → Expert = expert']);
  });

  it("names an 'exactly' hold and an increase that changed nothing", () => {
    // A hold: the increase still shows where it was spent, the hold is the last line.
    const held = build(wiz3, exactly('athletics', 'trained'));
    expect(held.proficiencies.skills.athletics).toBe('trained');
    const t = skillLine(held, 'athletics');
    expect(t[t.length - 1]).toMatchObject({ level: 1, text: 'Held at Trained', detail: 'Tweak: exactly trained', rank: 'trained' });
    expect(rows(t)).toContain('3 Skill increase → Trained = trained');
    // A floor at expert from 1st level: the level-3 increase (capped at expert) changes nothing.
    const floored = build(wiz3, atLeast('athletics', 'expert'));
    expect(floored.proficiencies.skills.athletics).toBe('expert');
    expect(rows(skillLine(floored, 'athletics'))).toEqual(['1 At least Expert [Tweak] = expert', '3 Skill increase (no change: already Expert) = expert']);
  });

  it('a floor from level 5 is not in the timeline before level 5', () => {
    const tw = atLeast('athletics', 'expert', { from: 5 });
    expect(skillLine(build(hero('wizard', 4), tw), 'athletics').some((e) => e.text.startsWith('At least'))).toBe(false);
    const at5 = skillLine(build(hero('wizard', 5), tw), 'athletics');
    expect(rows(at5)).toEqual(['5 At least Expert [Tweak] = expert']);
  });

  it("a skill trained at 1st level, then increased, with no tweak: the timeline it always showed", () => {
    const c = build(hero('wizard', 3, { skillIncreases: { 3: 'arcana' } } as Partial<BuildState>));
    expect(rows(skillLine(c, 'arcana'))).toEqual(['1 Trained [from your Wizard] = trained', '3 Skill increase → Expert = expert']);
  });

  it('a floor and an increase on the SAME level: the floor lands first, so the increase changes nothing', () => {
    // The order the build applies them (plan B WP5: "floors land at their start level before that
    // level's increases"); the other order would read "Skill increase → Trained" then the floor.
    const c = build(wiz3, atLeast('athletics', 'expert', { from: 3 }));
    expect(c.proficiencies.skills.athletics).toBe('expert');
    expect(rows(skillLine(c, 'athletics'))).toEqual(['3 At least Expert [Tweak] = expert', '3 Skill increase (no change: already Expert) = expert']);
  });

  it("a background's printed Lore is named as the background's, with or without a hold", () => {
    const lore = 'lore:scribing';
    const plain = build(hero('wizard', 1));
    expect(plain.proficiencies.skills[lore]).toBe('trained');
    expect(rows(skillLine(plain, lore))).toEqual(['1 Trained [from the Acolyte background] = trained']);
    const held = build(hero('wizard', 1), exactly(lore, 'untrained'));
    expect(held.proficiencies.skills[lore] ?? 'untrained').toBe('untrained');
    expect(rows(skillLine(held, lore))).toEqual(['1 Trained [from the Acolyte background] = trained', '1 Held at Untrained [Tweak: exactly untrained] = untrained']);
  });

  it('a skill an increase trains is not "trained at 1st level" (the replay starts from untrained)', () => {
    const c = build(wiz3);
    expect(rows(skillLine(c, 'athletics'))).toEqual(['3 Skill increase → Trained = trained']);
  });

  it('a raise from a feat (Medic Dedication) is one line, so the last rank is the sheet rank', () => {
    const c = build(hero('fighter', 4), { addedFeats: [{ featId: 'medic-dedication', level: 2, category: 'class' }] });
    const t = skillLine(c, 'medicine');
    expect(lastRank(t)).toBe(c.proficiencies.skills.medicine);
    expect(c.proficiencies.skills.medicine).toBe('expert');
    // skill-order WP7: P7 — the history names the record (plan section 2, explain row: the per-level history, not an
    // unnamed "Raised to Expert" at the character's level). The level is the feat's own: given at 2nd (Player Core
    // pg. 29, leveling up: a feat's benefits are gained at the level it is taken).
    expect(t[t.length - 1]).toMatchObject({ level: 2, text: 'Expert', detail: 'Medic Dedication', rank: 'expert' });
  });
});

describe('the save and Perception timelines name a floor or hold', () => {
  it('a Reflex floor and a Perception hold (fighter, 9th level)', () => {
    const b = hero('fighter', 9);
    const c0 = build(b);
    expect(c0.proficiencies.saves.reflex).toBe('expert');
    const both = (a: BuildOverrides, z: BuildOverrides): BuildOverrides => ({ proficiencies: { ...a.proficiencies, ...z.proficiencies }, meta: { ...a.meta, ...z.meta } });
    const c = build(b, both(atLeast('reflex', 'master'), exactly('perception', 'trained')));
    const reflex = explainStat(c, db, { kind: 'save', save: 'reflex' }).timeline;
    expect(reflex.find((e) => e.text.startsWith('At least'))).toMatchObject({ level: 1, text: 'At least Master', detail: 'Tweak', rank: 'master' });
    expect(lastRank(reflex)).toBe(c.proficiencies.saves.reflex);
    const perception = explainStat(c, db, { kind: 'perception' }).timeline;
    expect(perception[perception.length - 1]).toMatchObject({ text: 'Held at Trained', detail: 'Tweak: exactly trained', rank: 'trained' });
    expect(c.proficiencies.perception).toBe('trained');
    // With no tweak the timelines are what they were: no floor, no hold line.
    expect(explainStat(c0, db, { kind: 'save', save: 'reflex' }).timeline.some((e) => /^(At least|Held at)/.test(e.text))).toBe(false);
  });

  it('a floor above a LATER class raise: the raise says "no change", and the last rank is the sheet rank (wizard L9 Reflex)', () => {
    const c = build(hero('wizard', 9), atLeast('reflex', 'master'));
    expect(c.proficiencies.saves.reflex).toBe('master');
    const reflex = explainStat(c, db, { kind: 'save', save: 'reflex' }).timeline;
    expect(lastRank(reflex)).toBe(c.proficiencies.saves.reflex);
    expect(reflex.find((e) => e.level === 5)).toMatchObject({ text: 'Raised to Expert (no change: already Master)', rank: 'master' });
    // The same with no tweak: the raise is a plain raise.
    const plain = explainStat(build(hero('wizard', 9)), db, { kind: 'save', save: 'reflex' }).timeline;
    expect(plain.find((e) => e.level === 5)).toMatchObject({ text: 'Raised to Expert', rank: 'expert' });
  });
});

/*
 * The guard: on EVERY character of the parity snapshot (scripts/blocks-parity-snapshot.mjs — every class
 * at its sweep levels, every record, the Overrides and state characters), at both trust gates, every
 * skill's and Lore's timeline ends on the rank the sheet shows — unless a daily-preparation pick beats it
 * (the timeline is the build's story, not this morning's) — and so does every save, Perception, class DC
 * and worn-armour timeline (a battle form's AC has none). The skill fallback lines are ratcheted.
 */
describe("the timeline's last rank equals the sheet rank on every snapshot character with no daily or firearm beat", () => {
  type Engine = Awaited<ReturnType<typeof loadEngine>> & Record<string, any>;
  let E: Engine;
  beforeAll(async () => {
    E = (await loadEngine()) as Engine;
  }, 180_000);
  afterAll(() => E?.clearTrustGate());
  /** Skill timelines that end on a "Raised to / Set to" line, per gate (the ratchet below). */
  /* skill-order WP7: P7 — the history names the record (plan section 2, explain row): every snapshot skill whose
   * per-level history agrees with the sheet (`historyAgrees`) is told from the history, which names each raise's
   * record and level, so no "Raised to / Set to" line is left. Measured 2026-10-22 in the lane, both gates
   * (scratchpad probe over every snapshot character): off 153 → 0, on 151 → 0. A line here now means a history that
   * disagrees with the sheet (an import patched after its build, or an engine defect): the pin is exact. */
  const FALLBACK_PIN = { off: 0, on: 0 } as const;
  /* The skill-order families (work/skill-rank-level-by-level/plan.md WP0 step 6: `skillorder:` and
   * `tweaks-browser:`) are counted on their own pin: most `skillorder:` cases are built to show today's
   * increase-first order, whose swallowed steps the replay can only name as a raise. The skill-order job
   * lowers this pin as each WP flips its cases; the pin above stays the guard for everything else. */
  const SKILL_ORDER_FAMILY = /^(skillorder|tweaks-browser):/;
  // skill-order WP0: skillorder family (plan WP0 step 6) — measured 2026-10-22 on main (6f59895)
  /* skill-order WP3: AA7b, BJ1, J1, LS1 — the print order makes a feat's or heritage's raise land BEFORE the
   * increase (Ancient Ash expert at 5 then the increase at 7; Blackjacket's expert at 2 then the increase at 7;
   * Linguist Dedication's "already trained → expert" at 2 on the heritage's Society), and explain's replay, which
   * knows only the 1st-level training and the increases, can name that raise only as "Raised to". Measured
   * 2026-10-22 in the lane, both engines: WP0 off 17 / on 15, WP3 off 21 (+AA7b stealth, BJ1 intimidation, J1 society,
   * LS1 society) / on 17 (+BJ1 intimidation, J1 society; Ancient Ash and Lorekeeper Shisk are darkened at gate on).
   * WP7 names them from the history and lowers the pin. */
  /* skill-order WP3 fix round: BJ3, OV5 — two NEW family characters (checker round 1, findings 1 and 3), not a
   * moved line: their Lore timelines carry the same "Raised to" every Blackjacket / Kholo Lore case has had since
   * WP0 (BJ1/BJ2 lore:warfare, K2/K3/OV2 lore:kholo). Measured 2026-10-22 in the lane: off 23 (+BJ3 lore:warfare,
   * +OV5 lore:kholo) / on 18 (+OV5 lore:kholo; BJ3's lore:warfare is darkened at gate on, as BJ1's). */
  /* skill-order WP7: P7 — the history names the record: the family's raises are named from the per-level history
   * (Ancient Ash's expert at 5, Blackjacket's, Linguist Dedication's, the Kholo Lore and warfare Lore lines). Measured
   * 2026-10-22 in the lane, both gates: off 23 → 0, on 18 → 0 (Done when: at most {off 19, on 16}). */
  const SKILL_ORDER_FALLBACK_PIN = { off: 0, on: 0 } as const;
  /* Known, not fixed here (WP0 changes nothing under src/): the save timeline (src/rules/explain.ts) names only
   * the FIRST class's 1st-level save training, so a Dual Class save the SECOND class trains higher ends a step
   * low (DC2: rogue + fighter, Fortitude "Trained [from your Rogue]", sheet expert; DC3: fighter + rogue, Will
   * "Trained [from your Fighter]", sheet expert). These are the snapshot's first Dual Class characters. The list
   * is exact: a fix turns this red until the entry is removed. The same defect also names the wrong source on
   * DC1 / DC1n Will (credited to Bravery at 3, though the rogue made it expert at 1st); their last rank happens to
   * match, so they are not listed. chat-todo.md "Found 2026-10-22 while building skill-rank order WP0". */
  // skill-order WP0: DC2, DC3 (explain.ts Dual Class save timeline; GM Core Dual Class, rules-1329: "add everything from each class except Hit Points and starting skills")
  const KNOWN_BAD = ['skillorder:DC2 {"kind":"save","save":"fortitude"}', 'skillorder:DC3 {"kind":"save","save":"will"}'];

  for (const gate of ['off', 'on'] as const) {
    it(`gate ${gate}`, () => {
      E.setGate(gate);
      const bad: string[] = [];
      let checked = 0;
      let profChecked = 0;
      let fallbacks = 0;
      let orderFallbacks = 0;
      for (const spec of E.specs as { id: string; build: BuildState; play?: object; dbPatch?: (d: unknown) => unknown }[]) {
        const baseDb = spec.dbPatch ? spec.dbPatch(E.DB[gate]) : E.DB[gate];
        let ch: Character;
        let sheetDb: typeof db;
        try {
          const built = E.buildCharacter(spec.build, baseDb);
          ch = E.applyPlayState(built, { ...E.initialPlay(built, baseDb), ...(spec.play ?? {}) }, baseDb);
          sheetDb = E.playerFacingContent(E.contentFor(baseDb, built), ch.inventory);
        } catch {
          continue; // a character the snapshot itself cannot build is its own row there
        }
        const lores = E.sheetLoreKeys(ch, sheetDb) as string[];
        for (const k of [...(E.SKILLS as string[]), ...lores]) {
          if (E.derive.dailySkillRank(ch, sheetDb, k)) continue;
          const sheet = E.derive.skillResolved(ch, k, sheetDb).ownRank as ProficiencyRank;
          const t = E.explainStat(ch, sheetDb, { kind: 'skill', skill: k }, spec.build).timeline as TimelineEntry[];
          checked++;
          if (t.some((e) => /^(Raised|Set) to /.test(e.text))) {
            if (SKILL_ORDER_FAMILY.test(spec.id)) orderFallbacks++;
            else fallbacks++;
          }
          if (lastRank(t) !== sheet) bad.push(`${spec.id} ${k}: timeline ends ${lastRank(t)}, sheet ${sheet} — ${rows(t).join(' | ')}`);
        }
        // The class-advancement timelines: the saves, Perception, class DC and the worn armour's track.
        const profRefs = [
          { kind: 'save', save: 'fortitude' },
          { kind: 'save', save: 'reflex' },
          { kind: 'save', save: 'will' },
          { kind: 'perception' },
          { kind: 'classDc' },
          { kind: 'ac' },
        ] as const;
        for (const ref of profRefs) {
          const x = E.explainStat(ch, sheetDb, ref, spec.build) as { rank?: ProficiencyRank; timeline: TimelineEntry[] };
          if (!x.timeline.length || !x.rank) continue; // a battle form's AC has no timeline
          profChecked++;
          if (lastRank(x.timeline) !== x.rank) bad.push(`${spec.id} ${JSON.stringify(ref)}: timeline ends ${lastRank(x.timeline)}, sheet ${x.rank} — ${rows(x.timeline).join(' | ')}`);
        }
      }
      console.log(`[timeline guard] gate ${gate}: ${checked} skill checks, ${profChecked} track checks, ${fallbacks} fallbacks (+${orderFallbacks} skill-order), ${bad.length} bad`);
      expect(checked).toBeGreaterThan(1000);
      expect(profChecked).toBeGreaterThan(1000);
      const isKnown = (b: string) => KNOWN_BAD.some((k) => b.startsWith(`${k}:`));
      expect(bad.filter((b) => !isKnown(b)).slice(0, 20)).toEqual([]);
      expect(bad.filter(isKnown).map((b) => KNOWN_BAD.find((k) => b.startsWith(`${k}:`))).sort()).toEqual([...KNOWN_BAD].sort());
      expect(orderFallbacks).toBeLessThanOrEqual(SKILL_ORDER_FALLBACK_PIN[gate]);
      /* The last-rank check alone cannot fail on a wrong replay: a skill the replay misses gets the
       * "Raised to / Set to <stored>" line and still ends on the stored rank. So the number of skill
       * timelines that need that line is a RATCHET (measured 2026-10-21, WP5 fix round): a replay error —
       * floors after the level's increases, a wrong increase cap — sends more skills to it and fails here.
       * Lower the pin when a change names more raises; never raise it without finding why. */
      expect(fallbacks).toBeLessThanOrEqual(FALLBACK_PIN[gate]);
    }, 600_000);
  }
});
