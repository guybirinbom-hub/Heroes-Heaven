import { describe, it, expect } from 'vitest';
import {
  loadDb, baseBuild, hostIdsFor, hostContext, slotFor, probeAt, pickersFor,
  declaredChoices, evidenceFor, referenceHosts, isEcho, withAnswer,
} from '../scripts/builder-evidence.mjs';

/**
 * THE HARNESS'S OWN TEST.
 *
 * `scripts/builder-evidence.mjs` measures whether the BUILDER asks the player the right question with
 * the right options. It works by mirroring the picker gates in Builder.tsx, which jiti cannot import —
 * so the mirror is the one part of it that can silently drift out of step with the app, and a
 * measuring script that drifts is worse than none. Four have, in this project.
 *
 * These tests therefore pin the harness against records whose pickers are already known from
 * elsewhere: Domain Initiate's domain list is settled by Ruling Q9, Assurance's skill list by
 * `assurance-skill-choice.test.ts`, Terrain Scout's two picks by `multi-pick-choices.test.ts`, and
 * Pitborn's suppression by the pick-a-feat lane. If Builder.tsx grows a picker the mirror does not
 * know about, the counts here are what should notice.
 */

const db = loadDb();
const hosts = referenceHosts(db);

/** Every picker the builder renders for `featId`, on the feat's own trait-matched host at level 20. */
function pickers(featId: string) {
  const { classId, ancestryId } = hostIdsFor(db.feats[featId], db);
  const probe = probeAt(featId, db, classId, ancestryId, 20);
  expect(probe, `${featId} could not be placed in any slot`).toBeTruthy();
  return probe.pickers as {
    lane: string; prompt: string; kind: string; storage: string; key: string;
    optionCount: number | null; options: { value: string; label: string }[];
    pick?: number; of?: number; declaredBy: string;
  }[];
}

describe('builder-evidence — the host is a real character, not a blank one', () => {
  it("uses the class's own key attribute, not a Strength fallback", () => {
    // ClassDef.keyAbility is an ARRAY. `cls.keyAbility.options[0]` — the shape feat-evidence.mjs
    // uses — is undefined, and every class it builds silently becomes a Strength build.
    expect(baseBuild(db, 'wizard', 'human').keyAbility).toBe(db.classes.wizard.keyAbility[0]);
    expect(baseBuild(db, 'rogue', 'human').keyAbility).toBe(db.classes.rogue.keyAbility[0]);
  });

  it('spends its class skill slots, so a "skills" choice has a plausible list', () => {
    const ctx = hostContext(db, 'fighter', 'human');
    const trained = Object.values(ctx.char.proficiencies.skills).filter((r) => r !== 'untrained');
    // A blank level-20 fighter is trained in two skills, which made Assurance look like a defect.
    expect(trained.length).toBeGreaterThan(6);
  });

  it('the MINIMAL host is deliberately untrained — that is what makes a grant visible', () => {
    const rich = baseBuild(db, 'fighter', 'human', 20, false);
    const min = baseBuild(db, 'fighter', 'human', 20, true);
    expect(rich.classSkills.length).toBeGreaterThan(0);
    expect(min.classSkills.length).toBe(0);
  });

  it('places a feat in a slot the builder really renders, at or above the feat level', () => {
    const ctx = hostContext(db, 'cleric', 'dwarf');
    const slot = slotFor(ctx, db, db.feats['domain-initiate']);
    expect(slot).toBeTruthy();
    expect(slot.level).toBeGreaterThanOrEqual(db.feats['domain-initiate'].level);
    expect(ctx.slots).toContainEqual(slot);
  });
});

describe('builder-evidence — it sees the pickers that are known to exist', () => {
  it("Canny Acumen: one picker, the record's four options", () => {
    const p = pickers('canny-acumen');
    expect(p).toHaveLength(1);
    expect(p[0].lane).toBe('choice');
    expect(p[0].options.map((o) => o.value)).toEqual(['fortitude', 'reflex', 'will', 'perception']);
  });

  it('Domain Initiate: Ruling Q9 — only the deity\'s domains, never the whole list', () => {
    const p = pickers('domain-initiate');
    expect(p).toHaveLength(1);
    expect(p[0].kind).toBe('domains');
    const { classId, ancestryId } = hostIdsFor(db.feats['domain-initiate'], db);
    const deity = db.deities[baseBuild(db, classId, ancestryId).deityId!];
    const legal = new Set([...(deity.domains ?? []), ...(deity.alternateDomains ?? [])]);
    expect(p[0].optionCount).toBeGreaterThan(0);
    for (const o of p[0].options) expect(legal.has(o.value), `${o.value} is not a domain of ${deity.name}`).toBe(true);
  });

  it('Assurance: the skills the HOST is trained in, resolved from the build', () => {
    const p = pickers('assurance');
    expect(p).toHaveLength(1);
    expect(p[0].kind).toBe('skills');
    const { classId, ancestryId } = hostIdsFor(db.feats['assurance'], db);
    const trained = Object.entries(hostContext(db, classId, ancestryId).char.proficiencies.skills)
      .filter(([, r]) => r !== 'untrained')
      .map(([k]) => k);
    expect(p[0].options.map((o) => o.value).sort()).toEqual(trained.sort());
  });

  it('Automatic Knowledge: minRank expert is a STRICT subset of Assurance\'s list', () => {
    const expert = pickers('automatic-knowledge')[0];
    const trained = pickers('assurance')[0];
    expect(expert.optionCount).toBeGreaterThan(0);
    expect(expert.optionCount!).toBeLessThan(trained.optionCount!);
  });

  it('Terrain Scout: picks:2 renders TWO pickers under one prompt', () => {
    const p = pickers('terrain-scout').filter((x) => x.declaredBy === 'record.choice');
    expect(p).toHaveLength(2);
    expect(p[0].of).toBe(2);
    expect(p[0].prompt).toBe(p[1].prompt);
    expect(p[0].key).not.toBe(p[1].key);
  });

  it('Pitborn: the pick-a-feat picker REPLACES the record\'s own dropdown', () => {
    // Builder.tsx:1636 suppresses `choice` when flag is 'feat' and FEAT_PICK_GRANTS has the feat.
    // Reading `feat.choice` and asserting "a picker exists" would report the wrong one here.
    expect(db.feats['pitborn'].choice.flag).toBe('feat');
    const p = pickers('pitborn');
    expect(p.map((x) => x.lane)).toContain('pickFeat');
    expect(p.filter((x) => x.lane === 'choice')).toHaveLength(0);
  });

  it('Rogue Dedication: the registry lanes render too, not only the record field', () => {
    const lanes = pickers('rogue-dedication').map((p) => p.lane);
    expect(lanes).toContain('skillChoice');    // FEAT_GRANTS.skillChoices
    expect(lanes).toContain('bonusSkillFeat'); // FEAT_GRANTS.bonusSkillFeat
    expect(lanes).toContain('choice');         // the record's own
  });

  it('Multilingual: the language lane reports the BUDGET it grants, not a list of pickers', () => {
    const lang = pickers('multilingual').find((p) => p.lane === 'language');
    expect(lang).toBeTruthy();
    expect((lang as unknown as { slotsGranted: number }).slotsGranted).toBeGreaterThan(0);
  });

  it('declaredChoices names both halves — the record field and the registry entry', () => {
    expect(declaredChoices('rogue-dedication', db)).toEqual(
      expect.arrayContaining(['record.choice', 'registry.FEAT_GRANTS.skillChoices[0]', 'registry.FEAT_GRANTS.bonusSkillFeat']),
    );
    expect(declaredChoices('multilingual', db)).toContain('record.languageChoices');
    expect(declaredChoices('general-training', db)).toContain('registry.FEAT_PICK_GRANTS');
  });
});

describe('builder-evidence — the echo guard', () => {
  it('the recorded answer is NOT counted as the answer being read', () => {
    expect(isEcho('stored.feats[assurance].choice.label')).toBe(true);
    expect(isEcho('stored.feats[assurance].choice.value')).toBe(true);
    expect(isEcho('stored.effectPicks[0].label')).toBe(true);
  });

  it('…but a real derived value is', () => {
    expect(isEcho('stored.proficiencies.skills.stealth')).toBe(false);
    expect(isEcho('stored.spellcasting[cleric-focus].repertoire.1[0]')).toBe(false);
    expect(isEcho('skills.stealth.rank')).toBe(false);
    expect(isEcho('stored.feats[assurance].featId')).toBe(false);
  });

  it('withAnswer writes to the storage the builder writes to', () => {
    const b = baseBuild(db, 'fighter', 'human');
    expect(withAnswer(b, { storage: 'featChoices', key: 'k' }, 'v').featChoices.k).toBe('v');
    expect(withAnswer(b, { storage: 'effectChoices', key: 'k' }, 'v').effectChoices.k).toBe('v');
    expect(withAnswer(b, { storage: 'pickFeatChoices', key: 'k' }, 'v').pickFeatChoices.k).toBe('v');
    // …and never mutates the build it was given.
    expect(b.featChoices.k).toBeUndefined();
  });
});

describe('builder-evidence — the two checks', () => {
  it('Domain Initiate\'s answer MOVES a derived value (the harness can see a working choice)', () => {
    const pack = evidenceFor('domain-initiate', db, hosts);
    const a = pack.answerIsRead[0];
    expect(a.verdict).toBe('read');
    expect(a.movedPaths.length).toBeGreaterThan(0);
  });

  it('Canny Acumen\'s answer moves NOTHING — the app reads a value the picker cannot emit', () => {
    /*
     * A verified defect, kept as a test because it is the harness's strongest self-check: the picker
     * emits 'fortitude'|'reflex'|'will'|'perception', while FEAT_GRANTS.choiceGrants is keyed by the
     * old Foundry paths ('system.saves.fortitude.rank'). `feat-grants.test.ts` passes because it feeds
     * the OLD values straight to buildCharacter, which the builder can no longer produce. If the keys
     * are ever realigned this test fails, and that failure is the fix landing.
     */
    const pack = evidenceFor('canny-acumen', db, hosts);
    expect(pack.answerIsRead[0].moved).toBe(false);
    expect(['not-read', 'echo-only']).toContain(pack.answerIsRead[0].verdict);
  });

  it('an empty option list caused by the HOST owning nothing is not counted as a defect', () => {
    // "Which weapon carries your celestial blessing?" resolves from the character's own weapons, and
    // the reference host carries none. Counting that would be the harness reporting itself.
    const pack = evidenceFor('celestial-armaments', db, hosts);
    expect(pack.checks.zeroOptionsHostDependent.length).toBeGreaterThan(0);
    expect(pack.checks.pickerWithZeroOptions).toEqual([]);
  });

  it('every declared choice on a working feat reaches a picker', () => {
    for (const id of ['domain-initiate', 'rogue-dedication', 'terrain-scout', 'pitborn', 'multilingual', 'general-training']) {
      const pack = evidenceFor(id, db, hosts);
      expect(pack.checks.declaredWithoutPicker, id).toEqual([]);
    }
  });

  it('eligibleHosts names only characters that pass BOTH the slot and the prerequisites', () => {
    const pack = evidenceFor('domain-initiate', db, hosts);
    // A cleric feat: no wizard, no fighter. The spread must not report everyone as eligible.
    expect(pack.eligibleHosts.length).toBeGreaterThan(0);
    expect(pack.eligibleHosts.length).toBeLessThan(hosts.length);
    for (const h of pack.eligibleHosts) expect(h.startsWith('cleric/')).toBe(true);
  });
});

describe('builder-evidence — pickersFor is driven by the build, not by the record alone', () => {
  it('a redundant skill grant produces a replacement picker only on a host that already has it', () => {
    // The skillFallback lane is reported by the CHARACTER (`skillFallbacks`), so it exists on the rich
    // host and not on the minimal one. A record-reading checker cannot see it at all.
    const rich = probeAt('goloma-lore', db, ...Object.values(hostIdsFor(db.feats['goloma-lore'], db)) as [string, string], 20, false);
    const min = probeAt('goloma-lore', db, ...Object.values(hostIdsFor(db.feats['goloma-lore'], db)) as [string, string], 1, true);
    expect(rich.pickers.some((p: { lane: string }) => p.lane === 'skillFallback')).toBe(true);
    expect(min.pickers.some((p: { lane: string }) => p.lane === 'skillFallback')).toBe(false);
    expect(db.feats['goloma-lore'].choice).toBeUndefined();
  });

  it('pickersFor and the build agree on the storage key', () => {
    // The key the harness writes must be the key buildCharacter reads, or every answer looks unread.
    const p = pickers('domain-initiate')[0];
    const { classId, ancestryId } = hostIdsFor(db.feats['domain-initiate'], db);
    const probe = probeAt('domain-initiate', db, classId, ancestryId, 20);
    expect(p.key).toBe(probe.slotKey);
    expect(p.storage).toBe('featChoices');
  });
});
