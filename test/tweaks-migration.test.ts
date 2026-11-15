import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import * as buildModule from '../src/rules/build';
import { buildCharacter, emptyBuild, legacyRankSort, type BuildState } from '../src/rules/build';
import { rankSortFor, unsortedRankKeys, withoutUnsortedRanks, withRankSort } from '../src/rules/blocks/migrate';
import { readLegacyBlocks } from '../src/rules/blocks/stored';
import { deriveSkill } from '../src/rules/derive';
import type { BuildOverrides, Character, ProficiencyRank, TweakMeta } from '../src/rules/types';
import { LEGACY_FIXTURE, legacyDeltas, snapshotSubset } from '../scripts/blocks-parity-snapshot.mjs';
import { content } from './_content';

/**
 * OLD CHARACTERS (Tweaks part B, plan WP3; work/tweaks-part-b-notes/plan.md section 3, decisions B1, B2,
 * B3, B26; docs/overrides-redesign.md spec item 2, open point 2).
 *
 * An old `overrides.proficiencies` entry carries no "at least" / "exactly". It is SORTED when it is read
 * (blocks/migrate.ts, build.ts `legacyRankSort`), never written back:
 *   - B1: against the rank the old `=` REPLACED, measured AT ITS SLOT (the same build with every unsorted
 *     entry removed, read by build.ts's module-private at-slot probe) — never the final rank;
 *   - B2: below it → "exactly"; at or above → "at least"; a Lore under a raw key → always "at least" (it
 *     moves to its `loreKey` row); an unreadable rank, a bare `lore:Lore` or an unknown key → today's `=`;
 *   - B3: the sort is the derived `Character.tweakRankSort`; `character.overrides` is the stored object;
 *   - B26: a sorted entry is a MOVED one: it feeds the build's in-between readers what the old `=` fed them
 *     (a moved floor stays out of the "already trained?" replay; a moved "exactly" is also written at the
 *     old slot) until the player edits it.
 * What may move, and only that (spec 2): case A (an increase the old `=` swallowed now counts), case B (a
 * rank the player lowered stays lowered after a later raise), case C (test/tweaks-max-hp-set.test.ts) and
 * the Lore-row move. The last describe holds every old character of the parity snapshot to that, by stat.
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
    // Acolyte trains Religion and Scribing Lore (`lore:scribing`).
    backgroundId: 'acolyte',
    subclassId: (cls.subclass?.options[0]?.id as string) ?? null,
    levelBoosts: ['str', 'dex', 'con', 'wis'],
    ...more,
  } as BuildState;
}
const build = (b: BuildState, overrides?: BuildOverrides): Character => buildCharacter({ ...b, ...(overrides ? { overrides } : {}) } as BuildState, db);
const old = (proficiencies: Record<string, string>, more: BuildOverrides = {}): BuildOverrides => ({ ...more, proficiencies: proficiencies as Record<string, ProficiencyRank> });
/** The same entry as the Tweaks page will store it after an edit: its meta names the mode (no `moved`). */
const marked = (key: string, rank: string, meta: Partial<TweakMeta>, more: BuildOverrides = {}): BuildOverrides => ({
  ...more,
  proficiencies: { [key]: rank as ProficiencyRank },
  meta: { [`proficiencies:${key}`]: { of: rank, ...meta } },
});
const feat = (featId: string, level: number): BuildOverrides => ({ addedFeats: [{ featId, level, category: 'class' }] });

describe('rank.legacySet: an old entry is sorted against the rank its `=` met AT ITS SLOT (B1, B2)', () => {
  it("rank.legacySet: an old 'trained' plus a later increase now gives expert (case A)", () => {
    const wiz3 = hero('wizard', 3, { skillIncreases: { 3: 'athletics' } } as Partial<BuildState>);
    const c = build(wiz3, old({ athletics: 'trained' }));
    expect(c.tweakRankSort).toEqual({ athletics: 'atLeast' });
    expect(c.proficiencies.skills.athletics).toBe('expert');
    // The same number as the entry marked "at least" — the old `=` gave trained.
    expect(deriveSkill(c, 'athletics', db).modifier).toBe(deriveSkill(build(wiz3, marked('athletics', 'trained', { mode: 'atLeast' })), 'athletics', db).modifier);
  });

  it('an old entry lower than its AT-SLOT rank becomes exactly and stays lowered after a later feat raise (case B: a skill increase makes Medicine trained at the slot, the entry says untrained, Medic Dedication raises it after)', () => {
    const f4 = hero('fighter', 4, { skillIncreases: { 3: 'medicine' } } as Partial<BuildState>);
    const medic = feat('medic-dedication', 2);
    expect(build(f4, medic).proficiencies.skills.medicine, 'premise: trained by the increase, expert after Medic Dedication').toBe('expert');
    const c = build(f4, { ...medic, ...old({ medicine: 'untrained' }) });
    expect(c.tweakRankSort).toEqual({ medicine: 'exactly' });
    expect(c.proficiencies.skills.medicine).toBe('untrained');
    expect(c.feats.some((f) => f.featId === 'medic-dedication'), 'the feat is still held').toBe(true);
  });

  it('an old entry at or above the at-slot rank becomes at least — the same number as before', () => {
    // A wizard is trained in Arcana by the class; an old "trained" there was redundant, an old "master" in
    // Athletics lifted it: both sort "at least" and give what the `=` gave (nothing raises them later).
    const c = build(hero('wizard', 5), old({ arcana: 'trained', athletics: 'master', reflex: 'expert' }));
    expect(c.tweakRankSort).toEqual({ arcana: 'atLeast', athletics: 'atLeast', reflex: 'atLeast' });
    expect(c.proficiencies.skills.arcana).toBe('trained');
    expect(c.proficiencies.skills.athletics).toBe('master');
    expect(c.proficiencies.saves.reflex).toBe('expert');
  });

  it('a redundant old entry plus a conditional-upgrade dedication keeps expert (Intimidation trained before the slot + Blackjacket Dedication: expert, as today)', () => {
    // The blocker's pin (plan section 3.1). Blackjacket Dedication runs AFTER the slot: "expert if already
    // trained". At the slot Intimidation is trained (a class skill), so the redundant 'trained' entry sorts
    // "at least" and the dedication still upgrades it. MUTATION NOTE: sorted against the FINAL rank (expert)
    // the entry would be "exactly trained" and the clamp would take the dedication's expert away — this fails.
    const f4 = hero('fighter', 4, { classSkills: ['intimidation'] } as Partial<BuildState>);
    const bj = feat('blackjacket-dedication', 2);
    expect(build(f4).proficiencies.skills.intimidation, 'premise: trained before the slot').toBe('trained');
    expect(build(f4, bj).proficiencies.skills.intimidation, 'premise: the dedication upgrades it').toBe('expert');
    const c = build(f4, { ...bj, ...old({ intimidation: 'trained' }) });
    expect(c.tweakRankSort).toEqual({ intimidation: 'atLeast' });
    expect(c.proficiencies.skills.intimidation).toBe('expert');
    // What the mutation would give: the same entry held at "exactly".
    expect(build(f4, { ...bj, ...marked('intimidation', 'trained', { mode: 'exactly' }) }).proficiencies.skills.intimidation).toBe('trained');
  });

  it('the at-slot rank is read in the same build with every unsorted entry removed; sorted entries stay', () => {
    const host = { ...hero('bard', 5), overrides: { proficiencies: { 'lore:Sailing Lore': 'expert', 'lore:sailing': 'trained', athletics: 'Expert' }, meta: { 'proficiencies:lore:Sailing Lore': { mode: 'atLeast', of: 'expert' } }, maxHp: 40 } } as BuildState;
    const probe = withoutUnsortedRanks(host)!;
    expect(probe.keys).toEqual(['lore:sailing']);
    // The inner build keeps the sorted entry, the unsortable one, the meta and every other key…
    expect(probe.inner.overrides).toEqual({ ...host.overrides, proficiencies: { 'lore:Sailing Lore': 'expert', athletics: 'Expert' } });
    // …and is a copy: the stored object is untouched.
    expect(host.overrides!.proficiencies).toHaveProperty('lore:sailing', 'trained');
    // The kept, SORTED floor (at least expert on the same row) is in the at-slot rank: 'trained' is below
    // it → "exactly". Had the sorted entry been removed too, the row would be untrained there → "at least".
    const c = buildCharacter(host, db);
    expect(c.tweakRankSort).toEqual({ 'lore:sailing': 'exactly' });
    expect(c.proficiencies.skills['lore:sailing']).toBe('trained');
  });

  it('a language-Lore rerun still reports the at-slot ranks of the build it returns', () => {
    // "Lore instead of language" (a variant rule): more stored Lores than Int slots once languages are
    // picked → buildCharacter builds again with fewer Lores (the `languageLoreRerun` tail call). The first
    // pass trains Sailing Lore before the slot, the returned build does not.
    const dwarf = (languages: string[]): BuildState =>
      ({
        ...emptyBuild(),
        name: 't',
        level: 1,
        ancestryId: 'dwarf',
        heritageId: 'ancient-blooded-dwarf',
        backgroundId: 'scholar',
        classId: 'fighter',
        keyAbility: 'str',
        ancestryBoosts: ['int'],
        backgroundBoosts: ['int'],
        levelBoosts: ['int', 'str', 'dex', 'con'],
        variantRules: { loreInsteadOfLanguage: true },
        languageLores: ['lore:warfare', 'lore:sailing', 'lore:mining'],
        languages,
        overrides: { proficiencies: { 'lore:sailing': 'untrained' } },
      }) as BuildState;
    const noRerun = dwarf([]);
    expect(legacyRankSort(noRerun, db), 'premise: Sailing Lore is a trained language Lore at the slot').toEqual({ 'lore:sailing': 'exactly' });
    const rerun = dwarf(['elven', 'gnomish']);
    const c = buildCharacter(rerun, db);
    expect(c.languages).toEqual(expect.arrayContaining(['elven', 'gnomish']));
    // MUTATION NOTE: without the probe handed on to the rerun's build object, the snapshot is the FIRST
    // pass's (Sailing Lore trained) → 'exactly' — not the build that is returned.
    expect(legacyRankSort(rerun, db)).toEqual({ 'lore:sailing': 'atLeast' });
    expect(c.tweakRankSort).toEqual(legacyRankSort(rerun, db));
  });
});

describe('rank.legacySet: Lores and entries the sort cannot take (B2)', () => {
  it("an old Lore under a raw key moves to its loreKey row and is always 'at least'", () => {
    const bard = hero('bard', 5);
    expect(build(bard).proficiencies.skills['lore:scribing'], 'premise: the background trains Scribing Lore').toBe('trained');
    const c = build(bard, old({ 'lore:Scribing Lore': 'untrained', 'lore:Sailing Lore': 'expert' }));
    expect(c.tweakRankSort).toEqual({ 'lore:Scribing Lore': 'atLeast', 'lore:Sailing Lore': 'atLeast' });
    // The raw rows are gone; the real rows carry the entries — and an "untrained" raw Lore lowers nothing
    // (the old `=` wrote its own row and never lowered the real one).
    expect(c.proficiencies.skills['lore:scribing']).toBe('trained');
    expect(c.proficiencies.skills['lore:sailing']).toBe('expert');
    expect(Object.keys(c.proficiencies.skills).filter((k) => /^lore:[A-Z]/.test(k))).toEqual([]);
    expect(rankSortFor('lore:Sailing Lore', 'untrained', 'master')).toBe('atLeast');
  });

  it('an old canonical Lore entry sorts like a skill', () => {
    const bard = hero('bard', 5);
    const lowered = build(bard, old({ 'lore:scribing': 'untrained' }));
    expect(lowered.tweakRankSort).toEqual({ 'lore:scribing': 'exactly' });
    expect(lowered.proficiencies.skills['lore:scribing']).toBe('untrained');
    const raised = build(bard, old({ 'lore:scribing': 'expert' }));
    expect(raised.tweakRankSort).toEqual({ 'lore:scribing': 'atLeast' });
    expect(raised.proficiencies.skills['lore:scribing']).toBe('expert');
  });

  it("an unreadable rank, a bare 'lore:Lore' or an unknown key stays as today", () => {
    const w1 = hero('wizard', 1);
    const ov = old({ athletics: 'Expert', 'lore:Lore': 'trained', foo: 'expert' });
    expect(legacyRankSort({ ...w1, overrides: ov } as BuildState, db)).toBeUndefined();
    const c = build(w1, ov);
    expect(c.tweakRankSort).toBeUndefined();
    for (const b of readLegacyBlocks(ov)) expect(b.kind, b.key).toBe('rank.legacySet');
    // Today's `=`, each untouched by part B: the bare Lore and the unknown key write their own raw rows,
    // the unreadable text is written as it is (WP3 report, "Out of scope").
    expect(c.proficiencies.skills['lore:Lore' as never]).toBe('trained');
    expect((c.proficiencies.skills as Record<string, string>).foo).toBe('expert');
    expect(c.proficiencies.skills.athletics).toBe('Expert');
  });

  it('the sort is emitted as tweakRankSort and character.overrides is the stored object', () => {
    const stored = old({ thievery: 'trained', fortitude: 'trained' }, { meta: { 'proficiencies:thievery': { reason: 'old note', of: 'trained' } } });
    const frozen = JSON.stringify(stored);
    const c = build(hero('fighter', 7, { skillIncreases: { 5: 'thievery' } } as Partial<BuildState>), stored);
    expect(c.tweakRankSort).toEqual({ thievery: 'atLeast', fortitude: 'exactly' });
    expect(c.overrides, 'the stored object itself, not a sorted copy').toBe(stored);
    expect(JSON.stringify(stored), 'nothing written into it').toBe(frozen);
    expect(stored.meta).toEqual({ 'proficiencies:thievery': { reason: 'old note', of: 'trained' } });
    expect(stored.v).toBeUndefined();
    // The readers' in-memory view: the matching meta kept, the mode and `moved` laid over it.
    expect(withRankSort(stored, c.tweakRankSort)!.meta).toEqual({
      'proficiencies:thievery': { reason: 'old note', of: 'trained', mode: 'atLeast', moved: true },
      'proficiencies:fortitude': { mode: 'exactly', of: 'trained', moved: true },
    });
    // A character with no old rank entry carries no field at all.
    expect('tweakRankSort' in build(hero('fighter', 7))).toBe(false);
  });

  it('a stamped entry is never re-sorted, even after a level-up', () => {
    // At 1st Medicine is untrained at the slot: an old 'untrained' sorts "at least" — and the Builder-open
    // stamp (WP4) writes that down. At 3rd an increase trains Medicine BEFORE the slot: re-sorted there the
    // same entry would be "exactly untrained"; stamped, it stays a floor and the increase counts.
    const stamped = marked('medicine', 'untrained', { mode: 'atLeast' });
    const unstamped = old({ medicine: 'untrained' });
    expect(build(hero('wizard', 1), unstamped).tweakRankSort).toEqual({ medicine: 'atLeast' });
    const w3 = hero('wizard', 3, { skillIncreases: { 3: 'medicine' } } as Partial<BuildState>);
    const c = build(w3, stamped);
    expect(c.tweakRankSort).toBeUndefined();
    expect(c.proficiencies.skills.medicine).toBe('trained');
    // …while the never-stamped entry is sorted against the build it is in now.
    expect(build(w3, unstamped).tweakRankSort).toEqual({ medicine: 'exactly' });
    expect(build(w3, unstamped).proficiencies.skills.medicine).toBe('untrained');
  });

  it('a rank meta with a mode this version does not know is never sorted: kept, read as newer, applied as the old `=`', () => {
    // plan B WP6 carry-over (wp4-report): a newer app's `mode` (here "atMost") is its own sort. This version
    // neither re-sorts it (unsortedRankKeys / withRankSort skip it) nor writes over it; the Tweaks page lists
    // it read-only under "Made in a newer version" (test/tweaks-page.test.tsx), and it applies as today's `=`.
    const f7 = hero('fighter', 7);
    const ov = marked('fortitude', 'trained', { mode: 'atMost' as TweakMeta['mode'] });
    const frozen = JSON.stringify(ov);
    expect(unsortedRankKeys(ov), 'not an unsorted entry').toEqual([]);
    expect(legacyRankSort({ ...f7, overrides: ov } as BuildState, db), 'no sort at all').toBeUndefined();
    const c = build(f7, ov);
    expect(c.tweakRankSort).toBeUndefined();
    expect(c.proficiencies.saves.fortitude, "today's `=`: trained, as an older app applies it").toBe('trained');
    const [inst] = readLegacyBlocks(ov);
    expect(inst.kind).toBe('rank.legacySet');
    expect(inst.newer).toBe('a rank kind "atMost" this version does not know');
    // A sort handed in from elsewhere never lands on it either.
    expect(withRankSort(ov, { fortitude: 'exactly' })).toBe(ov);
    expect(JSON.stringify(ov), 'nothing written').toBe(frozen);
    // The same entry with no mode IS sorted (the guard is the mode, not the meta).
    expect(unsortedRankKeys(marked('fortitude', 'trained', { reason: 'x' }))).toEqual(['fortitude']);
  });
});

describe("B26: a sorted (moved) entry feeds the build's in-between readers what the old `=` fed them", () => {
  const slot = '5:ancestry:0';
  const moltenWit = (ov?: BuildOverrides) => build({ ...hero('fighter', 9), featPicks: { [slot]: 'molten-wit' }, featChoices: { [slot]: 'deception' } } as BuildState, ov);

  it('a moved \'at least\' floor is not in the asOf replay: an old Deception entry plus Molten Wit takes the same branch as before (skillRankBefore unchanged)', () => {
    const none = moltenWit();
    expect(none.skillRankBefore?.['molten-wit']).toEqual({ deception: 'untrained', diplomacy: 'untrained' });
    const c = moltenWit(old({ deception: 'trained' }));
    expect(c.tweakRankSort).toEqual({ deception: 'atLeast' });
    // The old `=` ran after the replay's baseline, so Molten Wit read Deception untrained and trained it
    // (not the "already trained → Diplomacy" branch). MUTATION NOTE: let the moved floor into
    // `skillsBeforeIncreases` / `laterFloorsOf` and the replay reads trained → Diplomacy trained; this fails.
    expect(c.skillRankBefore?.['molten-wit']).toEqual({ deception: 'untrained', diplomacy: 'untrained' });
    expect(c.proficiencies.skills.deception).toBe('trained');
    expect(c.proficiencies.skills.diplomacy).toBe('untrained');
  });

  it("a moved 'exactly' is written at the old slot too: a feat's 'already trained?' reader between the slot and the clamp sees the lowered rank (a redundantFallback skill is not handed out)", () => {
    // A fighter trained in Athletics by the class takes Barbarian Dedication ("trained in Athletics; if
    // already trained, a skill of your choice"), which runs after the slot. The old entry 'untrained'
    // lowered Athletics AT the slot, so the dedication trained it and owed no replacement skill.
    const f4 = hero('fighter', 4, { classSkills: ['athletics'] } as Partial<BuildState>);
    const barb = feat('barbarian-dedication', 2);
    expect(build(f4, barb).skillFallbacks, 'premise: without the entry the replacement skill is owed').toEqual([{ featId: 'barbarian-dedication', skill: 'athletics' }]);
    const c = build(f4, { ...barb, ...old({ athletics: 'untrained' }) });
    expect(c.tweakRankSort).toEqual({ athletics: 'exactly' });
    // MUTATION NOTE: drop the slot write (B26 b) and the dedication reads the at-slot 'trained' → the
    // replacement skill is handed out; this fails.
    expect(c.skillFallbacks ?? []).toEqual([]);
    // Case B: the lowered rank stays lowered after the dedication's raise (the old `=` ended trained).
    expect(c.proficiencies.skills.athletics).toBe('untrained');
  });

  it('after the player edits the entry (moved dropped) it is a plain floor / clamp', () => {
    // The same two entries as the Tweaks page stores them after an edit: a mode, no `moved`.
    const floor = moltenWit(marked('deception', 'trained', { mode: 'atLeast' }));
    expect(floor.tweakRankSort).toBeUndefined();
    // A plain floor from 1st IS in the replay: Molten Wit now reads Deception trained (the other branch).
    expect(floor.skillRankBefore?.['molten-wit']).toEqual({ deception: 'trained', diplomacy: 'untrained' });
    expect(floor.proficiencies.skills.diplomacy).toBe('trained');
    const f4 = hero('fighter', 4, { classSkills: ['athletics'] } as Partial<BuildState>);
    const clamp = build(f4, { ...feat('barbarian-dedication', 2), ...marked('athletics', 'untrained', { mode: 'exactly' }) });
    // A plain clamp is only the last step: the dedication read the class's 'trained' and owed the skill.
    expect(clamp.skillFallbacks).toEqual([{ featId: 'barbarian-dedication', skill: 'athletics' }]);
    expect(clamp.proficiencies.skills.athletics).toBe('untrained');
  });

  it('the at-slot probe is not reachable from outside build.ts', () => {
    expect(Object.keys(buildModule).filter((k) => /probe|at_?slot/i.test(k))).toEqual([]);
    const src = readFileSync(join(__dirname, '..', 'src', 'rules', 'build.ts'), 'utf8');
    expect(src).toMatch(/^const AT_SLOT_PROBE = new WeakMap</m);
    expect(src).not.toMatch(/export\s+(const|let|var|\{[^}]*)\s*AT_SLOT_PROBE/);
  });
});

/* ───────────── every old character of the parity snapshot: only cases A, B, C and the Lore-row move ───────────── */

type Diff = Record<string, { before: unknown; after: unknown }>;
type FixtureRow = { gates: Record<string, { deltas?: Record<string, unknown>; absolute?: Record<string, unknown>; error?: string }> };
const fixture = JSON.parse(readFileSync(join(__dirname, '..', LEGACY_FIXTURE), 'utf8')) as { characters: Record<string, FixtureRow> };

/* What each old character's numbers do against the part-A fixture (WP0 deltas vs its `#none` twin). One
 * entry per allowed stat, with its case; every character and gate not listed must not move at all. */
// Case A: fighter 7, old thievery 'trained' plus a level-5 increase on Thievery the old `=` swallowed.
const CASE_A_THIEVERY: Diff = {
  'deltas.pc.skills.Thievery': { before: '<none>', after: { twin: '12T', with: '14E' } },
  'deltas.skill.thievery': { before: '<none>', after: 2 },
  'deltas.skill.thievery.rank': { before: '<none>', after: { twin: 'trained', with: 'expert' } },
};
// The Lore-row move: the raw `lore:Sailing Lore` row is gone, the real `lore:sailing` row carries the entry.
const LORE_MOVE: Diff = {
  'deltas.skill.lore:Sailing Lore': { before: { twin: '<absent>', with: 7 }, after: '<none>' },
  'deltas.skill.lore:Sailing Lore.rank': { before: { twin: '<absent>', with: 'trained' }, after: '<none>' },
  'deltas.skill.lore:sailing': { before: '<none>', after: { twin: '<absent>', with: 7 } },
  'deltas.skill.lore:sailing.rank': { before: '<none>', after: { twin: '<absent>', with: 'trained' } },
};
// Case B: an increase trained Medicine at the slot, the old entry 'untrained' sorts "exactly", and Medic
// Dedication's later expert no longer overrides it (the old `=` was raised again by the dedication).
const CASE_B_MEDICINE: Diff = {
  'deltas.pc.skills.Medicine': { before: '<none>', after: { twin: '9E', with: '1U' } },
  'deltas.skill.medicine': { before: '<none>', after: -8 },
  'deltas.skill.medicine.rank': { before: '<none>', after: { twin: 'expert', with: 'untrained' } },
};
// Case C: a set max HP of 77 is a term now; the mode / Con mode / Drained apply on top (current HP is play
// state and stays where it was). Azata's Grace's own max-HP bonus (+50) is dark at trust gate ON, so the
// two Azata characters move at gate OFF only; the +1 Con mode (+5 at 5th) moves at both.
const hpAbs = (before: number, after: number): Diff => ({
  'absolute.hp.max': { before, after },
  'absolute.pc.maxHP': { before, after },
  'absolute.summary.hpMax': { before, after },
});
const EXPECTED: Record<string, Record<string, Diff>> = {
  'overrides:proficiencies:fighter-L7': { off: CASE_A_THIEVERY, on: CASE_A_THIEVERY },
  // hidden-card: the same allowed stats as its sibling (its card was hidden; its changes always counted).
  'overrides:hidden-card:fighter-L7': { off: CASE_A_THIEVERY, on: CASE_A_THIEVERY },
  'overrides:lore:bard-L5': { off: LORE_MOVE, on: LORE_MOVE },
  'overrides:lowered-raise:fighter-L4': { off: CASE_B_MEDICINE, on: CASE_B_MEDICINE },
  'overrides:maxHp:wizard-L5#mode': { off: hpAbs(77, 127) },
  'overrides:maxHp:wizard-L5#mode-drained': { off: hpAbs(67, 117) },
  'overrides:maxHp:wizard-L5#con-mode': { off: hpAbs(77, 82), on: hpAbs(77, 82) },
};
const NEVER_MOVES = /^overrides:(at-slot|asof|firearm|daily|legacy-misc|import-meta):/;

let diffs: Record<string, Record<string, Diff>> = {};
beforeAll(async () => {
  const { characters } = await snapshotSubset('^overrides:');
  const now = legacyDeltas(characters) as Record<string, FixtureRow>;
  const sj = (x: unknown) => JSON.stringify(x);
  for (const [cid, row] of Object.entries(fixture.characters)) {
    for (const [g, before] of Object.entries(row.gates)) {
      const after = now[cid]?.gates?.[g] ?? { error: 'missing from the snapshot' };
      const d: Diff = {};
      if (sj(after.error) !== sj(before.error)) d.error = { before: before.error ?? '<none>', after: after.error ?? '<none>' };
      for (const part of ['deltas', 'absolute'] as const) {
        const a = after[part] ?? {};
        const b = before[part] ?? {};
        for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (sj(a[k]) !== sj(b[k])) d[`${part}.${k}`] = { before: k in b ? b[k] : '<none>', after: k in a ? a[k] : '<none>' };
      }
      if (Object.keys(d).length) (diffs[cid] ??= {})[g] = d;
    }
  }
}, 240_000);

describe('old characters: every number equal to part A except cases A, B, C and the Lore-row move', () => {
  it('old characters: every number equal to part A except cases A, B, C and the Lore-row move', () => {
    expect(Object.keys(fixture.characters).length, 'the fixture covers the old characters').toBeGreaterThan(15);
    for (const cid of Object.keys(fixture.characters)) {
      for (const g of Object.keys(fixture.characters[cid].gates)) {
        expect(diffs[cid]?.[g] ?? {}, `${cid} at gate ${g}`).toEqual(EXPECTED[cid]?.[g] ?? {});
      }
    }
  });

  it('the characters part B must never move have no allowed stat at all (at-slot, asof, firearm, daily, legacy-misc, import-meta)', () => {
    const never = Object.keys(fixture.characters).filter((c) => NEVER_MOVES.test(c));
    expect(never.length).toBe(7);
    for (const cid of never) {
      expect(EXPECTED[cid], cid).toBeUndefined();
      expect(diffs[cid], cid).toBeUndefined();
    }
    // Every allowed character is a real fixture character (a typo would allow nothing and pass).
    for (const cid of Object.keys(EXPECTED)) expect(fixture.characters[cid], cid).toBeTruthy();
  });

  it('hidden-card moves exactly as its sibling (an old hidden card always counted)', () => {
    expect(diffs['overrides:hidden-card:fighter-L7']).toEqual(diffs['overrides:proficiencies:fighter-L7']);
  });
});
