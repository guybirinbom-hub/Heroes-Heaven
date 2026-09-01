import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { boundGrantChoice, boundLoreKeys } from '../src/rules/build';
import { FEAT_FEAT_GRANTS, FEAT_GRANT_BOUND_CHOICE } from '../src/rules/featFeatGrants';
import { FEAT_GRANTS, LOCKED_SKILL_KEYS } from '../src/rules/featGrants';
import { audit, unbound } from '../scripts/scan-granted-lore.mjs';
// Safe to import: _ser.ts writes nothing and deliberately does NOT call `requireDirectRun`, unlike
// every apply-*.ts around it.
import { FEAT_FEAT_GRANTS_MARKER } from '../scripts/aon-verify/_ser';
import { readFileSync } from 'node:fs';
import type { BuildState } from '../src/rules/build';

const db = content();

/*
 * THE GRANTED-LORE VEHICLE.
 *
 * 59 records hand out the Additional Lore feat and 48 of them NAME the Lore in the same sentence
 * ("You also gain the Additional Lore general feat FOR CATFOLK LORE"). None of that reached a
 * character: the builder renders Additional Lore's Lore box only for a feat PICKED into a slot, and a
 * granted feat never is, so the subject had nowhere to live and the granted feat trained nothing.
 *
 * Three separate defects live in this lane and each has its own test below:
 *   1. the granter's named Lore was never trained at all;
 *   2. Additional Lore's *"at 3rd, 7th, and 15th levels"* ladder never fired, so every Lore it grants
 *      sat at trained for twenty levels;
 *   3. the subject was stored under `<featId>:<idx>`, so a second taking of a `maxTakable: null` feat
 *      overwrote the first and two takes produced ONE Lore.
 */
describe('a granter that names its Lore trains it', () => {
  it('Athamaru Lore trains Athamaru Lore through the feat it grants', () => {
    const ch = build('fighter', 5, { featPicks: { '1:ancestry:0': 'athamaru-lore' } } as Partial<BuildState>);
    // Was `undefined`: the granted feat had no slot, so `featLoreChoices` had no key for it.
    expect(ch.proficiencies.skills['lore:athamaru']).toBe('expert');
    const granted = ch.feats.find((f) => f.featId === 'additional-lore');
    expect(granted?.grantedBy).toBe('athamaru-lore');
    // The label is read from the same call that trains it, so the sheet cannot name a different Lore.
    expect(granted?.choice).toEqual({ value: 'lore:athamaru', label: 'Athamaru Lore' });
  });

  it('Hellknight Dedication grants Hell Lore, which reached the sheet by no route before', () => {
    // It prints "You gain the Additional Lore general feat for Hell Lore" and had neither the vehicle
    // in FEAT_FEAT_GRANTS nor a direct `lore:hell` grant — the only such record of the seven.
    const ch = build('fighter', 7, { featPicks: { '2:class:0': 'hellknight-dedication' } } as Partial<BuildState>);
    expect(ch.proficiencies.skills['lore:hell']).toBe('master');
    expect(build('fighter', 7).proficiencies.skills['lore:hell']).toBeUndefined();
  });

  it('a granter naming TWO Lores trains both', () => {
    // "You gain the Additional Lore general feat for Sailing Lore and Warfare Lore." One granted feat,
    // two subjects — which a single-string binding could not have said.
    const ch = build('fighter', 15, { featPicks: { '2:class:0': 'viking-dedication' } } as Partial<BuildState>);
    expect(ch.proficiencies.skills['lore:sailing']).toBe('legendary');
    expect(ch.proficiencies.skills['lore:warfare']).toBe('legendary');
    expect(ch.feats.find((f) => f.featId === 'additional-lore')?.choice?.label).toBe('Sailing Lore, Warfare Lore');
  });

  it('Dwarven Lore produces ONE Lore row, not two', () => {
    /*
     * The record prints "the Additional Lore general feat for DWARF Lore" (the Remaster renamed
     * Dwarven Lore → Dwarf Lore) while its direct grant still said `lore:dwarven`. Binding the vehicle
     * to the printed subject without renaming the direct grant would have put both on the sheet.
     */
    const ch = build('fighter', 15, { featPicks: { '1:ancestry:0': 'dwarven-lore' } } as Partial<BuildState>);
    expect(ch.proficiencies.skills['lore:dwarf']).toBe('legendary');
    expect(ch.proficiencies.skills['lore:dwarven']).toBeUndefined();
  });

  it('two different granters each deliver their own Lore', () => {
    /*
     * The feat-granting queue deduped on the feat id alone, so the SECOND granter of Additional Lore
     * was dropped and its Lore went to nobody. A Lore-bound grant is a distinct taking of a repeatable
     * feat, so both now land.
     */
    const ch = build('fighter', 7, {
      featPicks: { '1:ancestry:0': 'catfolk-lore', '2:class:0': 'twilight-talon-dedication' },
    } as Partial<BuildState>);
    expect(ch.proficiencies.skills['lore:catfolk']).toBe('master');
    expect(ch.proficiencies.skills['lore:espionage']).toBe('master');
    const rows = ch.feats.filter((f) => f.featId === 'additional-lore');
    expect(rows.map((f) => f.grantedBy).sort()).toEqual(['catfolk-lore', 'twilight-talon-dedication']);
  });

  it('a granter that does NOT name a Lore is left alone', () => {
    // Nephilim Lore: "…for a Lore subcategory of a plane to which you trace your lineage." The app has
    // no field for that, so it binds nothing rather than inventing a subject.
    expect(FEAT_GRANT_BOUND_CHOICE['nephilim-lore']?.['additional-lore']).toBeUndefined();
    const ch = build('fighter', 7, { featPicks: { '1:ancestry:0': 'nephilim-lore' } } as Partial<BuildState>);
    expect(ch.feats.some((f) => f.featId === 'additional-lore')).toBe(true);
  });
});

describe("Additional Lore's 3rd/7th/15th-level ladder", () => {
  /** The chosen Lore's rank at `level` for a fighter who picked Additional Lore in a 1st-level slot. */
  const at = (level: number) =>
    build('fighter', level, {
      featPicks: { '1:skill:0': 'additional-lore' },
      featLoreChoices: { '1:skill:0:0': 'Warfare' },
    } as Partial<BuildState>).proficiencies.skills['lore:warfare'];

  it('climbs trained → expert → master → legendary at 3rd, 7th and 15th', () => {
    // Every one of these read `trained` before: the Lore loop granted a flat 'trained' and never
    // consulted the level upgrade, and the record carried no `rankUpgrade` to consult.
    expect(at(2)).toBe('trained');
    expect(at(3)).toBe('expert');
    expect(at(6)).toBe('expert');
    expect(at(7)).toBe('master');
    expect(at(14)).toBe('master');
    expect(at(15)).toBe('legendary');
  });

  it('the three steps are what the builder announces on those level cards', () => {
    // featUpgradesAtLevel is what puts "Additional Lore — becomes Expert" on the level card.
    const steps = FEAT_GRANTS['additional-lore'].rankUpgrade;
    expect(steps).toEqual([
      { level: 3, rank: 'expert' },
      { level: 7, rank: 'master' },
      { level: 15, rank: 'legendary' },
    ]);
  });
});

describe('one stored answer per taking', () => {
  it('two takings with two subjects train TWO Lores', () => {
    // Both answers used to be written to `additional-lore:0`, so take 2 overwrote take 1 and the
    // character ended with exactly one Lore — for a feat whose Special clause requires a NEW
    // subcategory each time.
    const ch = build('fighter', 6, {
      featPicks: { '1:skill:0': 'additional-lore', '2:skill:0': 'additional-lore' },
      featLoreChoices: { '1:skill:0:0': 'Warfare', '2:skill:0:0': 'Sailing' },
    } as Partial<BuildState>);
    expect(ch.proficiencies.skills['lore:warfare']).toBe('expert');
    expect(ch.proficiencies.skills['lore:sailing']).toBe('expert');
  });

  it('a character saved under the old bare-id key keeps its subject', () => {
    const ch = build('fighter', 6, {
      featPicks: { '1:skill:0': 'additional-lore' },
      featLoreChoices: { 'additional-lore:0': 'Warfare' },
    } as Partial<BuildState>);
    expect(ch.proficiencies.skills['lore:warfare']).toBe('expert');
  });

  it("Gnome Obsession's bound Assurance survives the key change", () => {
    /*
     * THE REGRESSION THIS PAIR EXISTS TO CATCH. `boundGrantChoice` read only `<granterId>:<index>`,
     * so the moment the builder started writing the slot key, Gnome Obsession's Assurance resolved to
     * undefined — the builder would have rendered "answer that and this fills in" forever on a
     * question the player had already answered, and the Q20 star would have vanished.
     */
    const slot = build('wizard', 4, {
      featPicks: { '1:ancestry:0': 'gnome-obsession' },
      featLoreChoices: { '1:ancestry:0:0': 'Games' },
    } as Partial<BuildState>);
    expect(slot.feats.find((f) => f.featId === 'assurance')?.choice).toEqual({ value: 'lore:games', label: 'Games Lore' });
    expect(slot.proficiencies.skills['lore:games']).toBe('expert');

    const legacy = build('wizard', 4, {
      featPicks: { '1:ancestry:0': 'gnome-obsession' },
      featLoreChoices: { 'gnome-obsession:0': 'Games' },
    } as Partial<BuildState>);
    expect(legacy.feats.find((f) => f.featId === 'assurance')?.choice).toEqual({ value: 'lore:games', label: 'Games Lore' });

    // …and the direct helper, both ways round.
    expect(boundGrantChoice({ featLoreChoices: { '1:ancestry:0:0': 'Games' } }, db, 'gnome-obsession', 'assurance', '1:ancestry:0')?.value).toBe('lore:games');
    expect(boundGrantChoice({ featLoreChoices: { 'gnome-obsession:0': 'Games' } }, db, 'gnome-obsession', 'assurance')?.value).toBe('lore:games');
  });
});

/*
 * THE GUARD. The audit named three records; the printed clause turned out to be on 48. A scanner over
 * the whole corpus plus this test is what keeps the next one from being missed, rather than a list
 * that goes stale — `npm run scan:lore` prints the same classification a human can read.
 */
describe('every granter that names its Lore is bound (corpus guard)', () => {
  it('no named-Lore granter is left unbound', () => {
    expect(unbound()).toEqual([]);
  });

  it('the classification still covers all 59 granters', () => {
    const a = audit();
    const total = Object.values(a).reduce((n, v) => n + v.length, 0);
    expect(total).toBe(Object.entries(FEAT_FEAT_GRANTS).filter(([, g]) => g.includes('additional-lore')).length);
    expect(a.named.length + a.multi.length).toBe(48);
    // The nine deliberately unbound: six name a Lore the app has no field for, three offer a choice.
    expect([...a.open, ...a.choice].map((r) => r.granter).sort()).toEqual([
      'chelaxian-scion-dedication',
      'lizardfolk-lore',
      'nephilim-lore',
      'past-life',
      'pirate-dedication',
      'remnants-of-the-past',
      'settlement-scholastics',
      'surface-culture',
      'wisdom-from-another-life',
    ]);
  });

  it('every bound Lore key resolves to a real Lore proficiency key', () => {
    const bad: string[] = [];
    for (const [granter, grants] of Object.entries(FEAT_GRANT_BOUND_CHOICE)) {
      for (const [granted, spec] of Object.entries(grants)) {
        if (spec.kind !== 'fixedLore') continue;
        for (const k of boundLoreKeys(spec)) if (!/^lore:[a-z0-9-]+$/.test(k)) bad.push(`${granter} → ${granted}: ${k}`);
        if (!FEAT_GRANTS[granted]?.loreChoices) bad.push(`${granted} has no Lore slot to fill`);
      }
    }
    expect(bad).toEqual([]);
  });
});

/*
 * BARDIC LORE — the other half of this cluster's Lore work, and two clauses in one sentence:
 * *"You are trained in Bardic Lore… If you have legendary proficiency in Occultism, you gain expert
 * proficiency in Bardic Lore, but you can't increase your proficiency rank in Bardic Lore by any
 * other means."* Neither could be said before: `conditionalSkills` reads the granted skill's OWN
 * prior rank, and nothing anywhere could forbid a skill increase.
 */
describe('Bardic Lore is gated on Occultism and locked against increases', () => {
  const enigma = (over: Partial<BuildState> = {}) => build('bard', 20, { subclassId: 'enigma', ...over } as Partial<BuildState>);

  it('becomes expert only when Occultism is legendary', () => {
    // Was `trained` at every level and every Occultism rank: the gate had no field to live in.
    expect(enigma({ skillIncreases: { 3: 'occultism', 7: 'occultism', 15: 'occultism' } } as Partial<BuildState>)
      .proficiencies.skills['lore:bardic']).toBe('expert');
    const master = enigma({ skillIncreases: { 3: 'occultism', 7: 'occultism' } } as Partial<BuildState>);
    expect(master.proficiencies.skills.occultism).toBe('master');
    expect(master.proficiencies.skills['lore:bardic']).toBe('trained');
  });

  it('a skill increase spent on it is dropped, not applied', () => {
    // Measured before: three increases took it to MASTER, which its own sentence forbids.
    const ch = enigma({ skillIncreases: { 3: 'lore:bardic', 7: 'lore:bardic', 15: 'lore:bardic' } } as Partial<BuildState>);
    expect(ch.proficiencies.skills['lore:bardic']).toBe('trained');
    // …and the level reads as an unspent increase, which is the true state and prompts a re-pick.
    expect(ch.skillIncreases.filter((s) => s.skill === 'lore:bardic')).toEqual([]);
  });

  it('the builder has a reason to print when it greys the option', () => {
    // Q27: an option that cannot be picked must LOOK unpickable, and say why.
    // Every locked key must carry a reason, not just be listed.
    for (const [key, why] of Object.entries(LOCKED_SKILL_KEYS)) expect(why, key).toMatch(/can't be increased/);
    /* The three Lores whose printed text forbids raising them by any other means. Folktales and Gossip
     * joined in parity batch 13, where their conditional expert step was built — the lock is the other
     * half of the same sentence ("…but you can't increase your proficiency rank … by any other means").
     * Pinned so a NEW lock stays a deliberate act: locking a skill removes a player's choice. */
    expect(Object.keys(LOCKED_SKILL_KEYS).sort()).toEqual(['lore:bardic', 'lore:folktales', 'lore:gossip']);
  });
});

/*
 * THE OTHER GUARD, and the one with teeth: five scripts rewrite `src/rules/featGrantsAuto.ts` WHOLE
 * and two of them rewrite `src/rules/featFeatGrants.ts` too. Everything this lane authors — the
 * `rankUpgrade` ladder in one file, the 48 bindings in the other — lives in their blast radius.
 */
describe('the scripts that rewrite these two tables cannot silently truncate them', () => {
  const WRITERS = [
    'scripts/aon-verify/apply-reviewed.ts',
    'scripts/aon-verify/apply-clear.ts',
    'scripts/aon-verify/apply-conditional.ts',
    'scripts/aon-verify/apply-fixes.ts',
    'scripts/aon-verify/fix-conditional-ranks.ts',
  ];

  it('every writer of featGrantsAuto.ts uses the shared lossless serialiser', () => {
    const bad: string[] = [];
    for (const f of WRITERS) {
      const src = readFileSync(f, 'utf8');
      if (!src.includes("from './_ser.ts'")) bad.push(`${f}: does not import the shared serialiser`);
      // An enumerating serialiser is the bug: it emits the keys it knows and deletes the rest.
      if (/if \(g\.skills\) p\.push/.test(src)) bad.push(`${f}: still carries its own field-enumerating ser()`);
    }
    expect(bad).toEqual([]);
  });

  it('the featFeatGrants.ts header marker preserves FEAT_GRANT_BOUND_CHOICE', () => {
    /*
     * MEASURED: splitting on the short string `'export const FEAT_FEAT_GRANTS'` matched
     * `FEAT_FEAT_GRANTS_LEVELED` first and preserved 901 characters instead of 3372 — deleting
     * BoundGrantAnswer, FEAT_GRANT_BOUND_CHOICE and isBoundGrant, all imported by build.ts.
     */
    const file = readFileSync('src/rules/featFeatGrants.ts', 'utf8');
    expect(file.split(FEAT_FEAT_GRANTS_MARKER).length - 1).toBe(1);
    const header = file.split(FEAT_FEAT_GRANTS_MARKER)[0];
    for (const sym of ['FEAT_FEAT_GRANTS_LEVELED', 'BoundGrantAnswer', 'FEAT_GRANT_BOUND_CHOICE', 'isBoundGrant']) {
      expect(header).toContain(sym);
    }
    for (const f of ['scripts/aon-verify/apply-reviewed.ts', 'scripts/aon-verify/apply-fixes.ts']) {
      expect(readFileSync(f, 'utf8')).not.toContain(".split('export const FEAT_FEAT_GRANTS')");
    }
  });
});

/**
 * ONE GRANTER, ONE ROW — the two vehicles must not both fire.
 *
 * A record can carry `grantsFeats: ['additional-lore']` in core.json AND an entry in
 * FEAT_GRANT_BOUND_CHOICE naming which Lore. The data vehicle knows only the player's free pick — for
 * a granted Lore there is none — so it pushed a bare "Additional Lore" row with no subject; the bound
 * vehicle then pushed the real row and, for a `fixedLore` grant, deliberately bypasses the taken-feats
 * dedupe so a second granter's Lore is not swallowed. Both landed.
 *
 * Measured when it happened: of 48 fixed-Lore granters, 41 rendered one row and exactly 7 rendered TWO
 * — one of them blank, and both sharing a React key because they carry the same level. Proficiency was
 * unaffected, which is why the whole suite stayed green: a dead row trains nothing.
 *
 * The bound lane owns the grant now. This sweeps every granter rather than the 7, because the next
 * record to gain a `grantsFeats` entry would reintroduce it silently.
 */
describe('a granted Additional Lore appears exactly once', () => {
  const granters = () => {
    const con = content();
    return Object.entries(FEAT_GRANT_BOUND_CHOICE)
      .filter(([, m]) => Object.values(m).some((v) => (v as { kind?: string })?.kind === 'fixedLore'))
      .map(([id]) => id)
      .filter((id) => con.feats[id]);
  };

  it('never twice, and never without its subject', () => {
    const con = content();
    const bad: string[] = [];
    for (const id of granters()) {
      const lvl = Math.max(1, con.feats[id].level ?? 1);
      const cat = con.feats[id].category === 'class' ? 'class' : con.feats[id].category === 'ancestry' ? 'ancestry' : 'skill';
      const ch = build('fighter', Math.max(lvl, 6), { featPicks: { [`${lvl}:${cat}:0`]: id } } as Partial<BuildState>);
      if (!ch.feats.some((f) => f.featId === id)) continue;
      const rows = ch.feats.filter((f) => f.featId === 'additional-lore');
      if (rows.length !== 1) bad.push(`${id}: ${rows.length} rows -> ${JSON.stringify(rows.map((r) => r.choice?.value ?? null))}`);
      else if (!rows[0].choice?.value) bad.push(`${id}: 1 row but NO subject — it renders as a bare "Additional Lore"`);
    }
    expect(bad, 'both grant vehicles fired for the same record').toEqual([]);
  });

  it('and there are enough granters for that sweep to mean something', () => {
    expect(granters().length).toBeGreaterThanOrEqual(40);
  });
});
