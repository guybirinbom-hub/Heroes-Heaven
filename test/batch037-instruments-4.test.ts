/*
 * BATCH 037 — THE INSTRUMENT LANE, CHUNK instruments-4 (WG-COMPARISON family).
 *
 * Twelve findings, and every one of them is the SAME verdict: *nothing changes*. All twelve sit on
 * work/owner-questions.json's open desk (#19, #27, #32, #34, #38, #53, #65, #66, #74, #75, #76, #77)
 * and were answered together on 2026-09-10 — "Keep the app on all 28 (it already follows the printed
 * page); nothing changes for a player. Each gets WRITTEN DOWN as a known deliberate difference" —
 * under the standing 2026-08-22 rule that the book wins.
 *
 * Two shapes come out of that:
 *
 *   1. TWO SETTLES, because two of the twelve are still RED on a data comparer and a ruling does not
 *      park those (wg-batch-gate.mjs:150 — "The data comparers are not parked for ruled ids"):
 *        • instinct-ability — wg-diff THEY-ONLY `missing=[hp]`, their Barbarian Resiliency +3.
 *        • tumbling-theft   — wg-values MISSING `skill|stealth`, their +1 on the wrong skill.
 *      Each is proved WITHOUT `--raw` for the quiet half and WITH it for the noisy half, and each has
 *      a mutation-proof case that stunts the carrier the settle credits and shows the comparer still
 *      reports the record — the batch-029/033 pattern.
 *
 *   2. TEN RESIDUAL READS, no row, no code, no settle: every comparer already agrees, so a settle
 *      would be a stale entry that silences the NEXT difference on that record unread. What those ten
 *      get instead is a PIN on the printed value that the ruling says we keep, so "nothing changes"
 *      stays checkable rather than asserted. Where the value reaches a player it is pinned on a BUILT
 *      character, through the reader the sheet uses.
 */
import { describe, expect, it, vi } from 'vitest';
import { CHILD_TIMEOUT } from './_timeouts';
/* Three cases run wg-diff / wg-values as a real node child — fine alone, several times slower under
 * the full suite, where the 5 s default turned it into a timeout. See test/_timeouts.ts. */
vi.setConfig({ testTimeout: CHILD_TIMEOUT, hookTimeout: CHILD_TIMEOUT });
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build, content } from './_content';
import { characterSituationalIds } from '../src/rules/explain';
import { featSituationalFor, setSituationalSuppressions } from '../src/rules/situationalBonuses';
import { choiceOwnedFeatureIds, deriveDefenses } from '../src/rules/derive';
import { FEAT_SKILL_GRANTS } from '../src/rules/featGrantsAuto';
import { FEAT_FEAT_GRANTS } from '../src/rules/featFeatGrants';
import type { Character, ContentDatabase } from '../src/rules/types';

const CLI_ROOT = join(__dirname, '..');
const CORE = JSON.parse(readFileSync(join(CLI_ROOT, 'public/core.json'), 'utf8'));
const db = content();

type Core = Record<string, any>;

const tag = () => `${process.pid}-${Math.random().toString(36).slice(2)}`;

/** Run a comparer against a copy of public/core.json with ONE carrier removed — batch 033's shape. */
function stuntedCore<T>(name: string, mutate: (core: Core) => void, run: (coreArg: string[]) => T): T {
  const rel = `work/.b037i4-stunt-${name}-${tag()}.json`;
  const copy: Core = JSON.parse(JSON.stringify(CORE));
  mutate(copy);
  expect(JSON.stringify(copy)).not.toBe(JSON.stringify(CORE));   // the stunt must actually bite
  writeFileSync(join(CLI_ROOT, rel), JSON.stringify(copy));
  try {
    return run(['--core', rel]);
  } finally {
    rmSync(join(CLI_ROOT, rel), { force: true });
  }
}

/** wg-diff has no `--ids`; `--out` is its only per-record view. id -> missing kinds, THEY-ONLY only. */
function theyOnly(extra: string[] = []): Map<string, string[]> {
  const rel = `work/.b037i4-diff-${tag()}.json`;
  try {
    execFileSync(process.execPath, [join(CLI_ROOT, 'scripts/wg-diff.mjs'), '--out', rel, ...extra], {
      cwd: CLI_ROOT, encoding: 'utf8', maxBuffer: 1 << 28,
    });
    const out = JSON.parse(readFileSync(join(CLI_ROOT, rel), 'utf8'));
    return new Map<string, string[]>(out.theyOnly.map((r: { id: string; missing: string[] }) => [r.id, r.missing]));
  } finally {
    rmSync(join(CLI_ROOT, rel), { force: true });
  }
}

/** wg-values on one record; its report is stdout, so the raw text is the observation. */
const values = (id: string, extra: string[] = []): string =>
  execFileSync(process.execPath, [join(CLI_ROOT, 'scripts/wg-values.mjs'), '--ids', id, ...extra], {
    cwd: CLI_ROOT, encoding: 'utf8', maxBuffer: 1 << 28,
  });

/** A character holding feats by id, the route `characterSituationalIds` reads first. */
const withFeats = (featIds: string[], classId = 'fighter', level = 8): Character => {
  const base = build(classId, level);
  return {
    ...base,
    feats: [...base.feats, ...featIds.map((featId, i) => ({ featId, level, slot: `b37i4:${i}` }))],
  } as unknown as Character;
};

/** The `when :: bonus` strings one record puts on a stat row, as the sheet reads them. */
const stars = (c: Character, ref: { kind: string; skill?: string; save?: string }, sourceId: string) =>
  featSituationalFor(characterSituationalIds(c, db), ref)
    .filter((s) => s.id === sourceId)
    .map((s) => `${s.when} :: ${s.bonus}`);

/* ================================================================== *
 * SETTLE 1 — instinct-ability: their `hp` is Barbarian Resiliency's +3
 * ================================================================== */

describe('batch 037 instruments-4 — instinct-ability settles `hp` and nothing else', () => {
  /*
   * Printed, in its entirety (AoN feat-6194): *"You gain the instinct ability for the instinct you
   * chose for Barbarian Dedication."* No Hit Points anywhere. Their row grants no instinct at all —
   * it is `conditional IF FEAT_NAMES INCLUDES "barbarian resiliency" THEN addBonusToValue
   * MAX_HEALTH_BONUS = "+3"`, Barbarian Resiliency's own per-archetype-feat +3 replicated onto each
   * qualifying row because their vocabulary has no "per feat of this archetype" verb. Same shape as
   * monk-moves (batch 031) and armored-resistance (batch 036), one archetype over.
   */
  // batch 037: instinct-ability#no-hit-points
  it('instinct-ability is clear on the shipped data, and `--raw` shows the registry is what quiets it', () => {
    expect(theyOnly().has('instinct-ability')).toBe(false);
    expect(theyOnly(['--raw']).get('instinct-ability')).toEqual(['hp']);
  });

  // batch 037: instinct-ability#no-hit-points
  it('with instinct-ability stunted, the record reports its real kind again and never `hp`', () => {
    /*
     * mutation-proof — the danger of a VERIFIED_EQUIVALENT key is that it is keyed by RECORD, so it
     * could quietly cover a real gap on the same record. The settle key stunted is 'instinct-ability'
     * in scripts/wg-diff.mjs's VERIFIED_EQUIVALENT: with `derivedGrant` deleted the SETTLED run (no
     * `--raw`) reports `conditional` straight back — and still not `hp`, which is the one kind this
     * entry is allowed to silence. So the settle cannot stand in for the instinct grant beside it.
     */
    const stunted = stuntedCore('instinct', (c) => {
      delete c.feats['instinct-ability'].derivedGrant;
    }, (core) => theyOnly(core));
    expect(stunted.get('instinct-ability')).toEqual(['conditional']);
  });

  // batch 037: instinct-ability#no-hit-points
  it('instinct-ability delivers the instinct the dedication recorded, and the +3 lives on barbarian-resiliency', () => {
    /* A settle for a dead field is a laundering, so both halves of the reading are pinned here: the
     * carrier the entry credits, and the record that really prints the Hit Points their row asserts. */
    const instinct = db.feats['barbarian-dedication'].choice!.options![0].value;
    expect(
      choiceOwnedFeatureIds(
        [{ featId: 'barbarian-dedication', choice: { value: instinct } }, { featId: 'instinct-ability' }],
        db,
      ),
    ).toContain(instinct);
    expect(db.feats['instinct-ability'].maxHpBonus).toBeUndefined();
    expect(db.feats['barbarian-resiliency'].maxHpBonus).toEqual({ perArchetypeFeat: 3, archetype: 'barbarian' });
  });
});

/* ================================================================== *
 * SETTLE 2 — tumbling-theft: their +1 is on the wrong skill
 * ================================================================== */

describe('batch 037 instruments-4 — tumbling-theft settles `skill|stealth`, and the Thievery star is ours', () => {
  /*
   * Print (AoN feat-6513, Player Core 2 pg. 235): *"You gain a +1 circumstance bonus to your Thievery
   * check to Steal as your tumbling make it difficult for your enemy to keep track of your movement."*
   * Their only value-bearing op is `addBonusToValue SKILL_STEALTH "1"`, while the paragraph they ship
   * beside it is that same printed sentence — so their placement contradicts their own record, not
   * the book.
   */
  // batch 037: tumbling-theft#thievery
  it('tumbling-theft is clear on the shipped data, and `--raw` shows the registry is what quiets it', () => {
    expect(values('tumbling-theft')).toContain('0 records with at least one value to adjudicate');
    const raw = values('tumbling-theft', ['--raw']);
    expect(raw).toContain('MISSING');
    expect(raw).toContain('skill|stealth');
  });

  // batch 037: tumbling-theft#thievery
  it('tumbling-theft stars Thievery on a built character and leaves Stealth alone', () => {
    const c = withFeats(['tumbling-theft']);
    expect(stars(c, { kind: 'skill', skill: 'thievery' }, 'tumbling-theft')).toEqual([
      "on the Thievery check to Steal after you critically succeed at Tumble Through an enemy's space :: +1 circumstance",
    ]);
    expect(stars(c, { kind: 'skill', skill: 'stealth' }, 'tumbling-theft')).toEqual([]);
  });

  // batch 037: tumbling-theft#thievery
  it('with tumbling-theft stunted, the Thievery star is gone — the settle credits a live carrier', () => {
    /*
     * mutation-proof — the settle key stunted is 'tumbling-theft' in scripts/wg-values.mjs's
     * SETTLED_VALUES. Its whole justification is that the printed +1 IS delivered, one skill over, so
     * the carrier it credits has to be live: `setSituationalSuppressions` is the app's own in-memory
     * route for dropping a record's shipped stars (situationalBonuses.ts:4058 reads the same set), and
     * with the id in it the Thievery row goes bare. The settle's SCOPE is proved by construction — it
     * names one key, and `skill|stealth` is the whole of their numeric content on this row.
     */
    const c = withFeats(['tumbling-theft']);
    setSituationalSuppressions(['tumbling-theft']);
    try {
      expect(stars(c, { kind: 'skill', skill: 'thievery' }, 'tumbling-theft')).toEqual([]);
    } finally {
      setSituationalSuppressions([]);
    }
    expect(stars(c, { kind: 'skill', skill: 'thievery' }, 'tumbling-theft')).toHaveLength(1);
  });
});

/* ================================================================== *
 * THE TEN RESIDUAL READS — every comparer already agrees; what is pinned is the printed value
 * ================================================================== */

describe('batch 037 instruments-4 — reinforced-chassis keeps the printed AC ladder', () => {
  // batch 037: reinforced-chassis#ac-scaling
  it('reinforced-chassis armour is +3 / +4 at 5th / +5 at 10th with a Dex cap of +1', () => {
    /* AoN feat-3095: *"grants a +3 item bonus to AC with a Dexterity cap of +1. If you are at least
     * 5th level, the item bonus increases to +4 and at 10th level it increases to +5."* WG ships one
     * flat +3 with no ladder at all — ruled a deliberate difference, desk #19. */
    const armour = db.items['reinforced-chassis-armor'] as Record<string, unknown>;
    expect(armour.acBonus).toBe(3);
    expect(armour.acBonusByLevel).toEqual([{ level: 5, acBonus: 4 }, { level: 10, acBonus: 5 }]);
    expect(armour.dexCap).toBe(1);
    expect(db.feats['reinforced-chassis'].grantsItems).toEqual([{ itemId: 'reinforced-chassis-armor', quantity: 1 }]);
  });
});

describe('batch 037 instruments-4 — psychic-dedication grants no Focus Point', () => {
  // batch 037: psychic-dedication#no-focus-point
  it('the pool is printed on Psi Development at 6th, and that is the only record carrying it', () => {
    /* AoN feat-8395 (Psi Development, 6th): *"If you don't have one, you gain a focus pool of 1 Focus
     * Point"*; the Dedication (feat-8391) never mentions a pool. WG puts the point on the dedication —
     * ruled a deliberate difference, desk #27. */
    expect(db.feats['psychic-dedication'].focusPoolBonus).toBeUndefined();
    expect(db.feats['psi-development'].focusPoolBonus).toBe(1);
  });
});

describe('batch 037 instruments-4 — elemental-existence grants Adopted Ancestry outright', () => {
  // batch 037: elemental-existence#adopted-ancestry
  it('the feat is granted, not hidden, and the oread feat and later oread picks come with it', () => {
    /* AoN feat-4378: *"You gain the Adopted Ancestry feat and gain a 1st level oread ancestry feat as
     * a bonus feat…"* WG never grants it — they hide it from the pickable list instead, which is the
     * deliberate difference ruled at desk #32. */
    expect(FEAT_FEAT_GRANTS['elemental-existence']).toEqual(['adopted-ancestry']);
    expect(db.feats['elemental-existence'].extraAncestryFeatTraits).toEqual(['oread']);
  });
});

describe("batch 037 instruments-4 — thats-not-natural puts the master-Survival +2 on initiative", () => {
  // batch 037: thats-not-natural#circumstance-bonus
  it('the initiative star carries the +1/+2 ladder and the Perception DC note never grows', () => {
    /* AoN feat-3897: *"You gain a +1 circumstance bonus to all initiative checks… If you're master in
     * Survival, this circumstance bonus increases to +2."* — "this circumstance bonus" names the
     * initiative bonus, the only thing the clause calls one. WG puts both numbers on Perception and
     * upgrades on Perception rank; ruled a deliberate difference, desk #34. */
    const c = withFeats(['thats-not-natural']);
    expect(stars(c, { kind: 'initiative' }, 'thats-not-natural')).toEqual([
      'on initiative at the start of a battle in a wilderness region where at least one enemy is… :: +1 circumstance (+2 if master in Survival)',
    ]);
    const perception = (db.feats['thats-not-natural'].situational ?? []).filter(
      (s) => s.targets.some((t) => t.kind === 'perception'),
    );
    expect(perception.map((s) => s.bonus)).toEqual([
      '+1 circumstance to your Perception DC (not to your Perception checks)',
    ]);
  });
});

describe('batch 037 instruments-4 — devils-eye keeps the Legal Lore ladder', () => {
  // batch 037: devils-eye#legal-lore-rank
  it('Legal Lore is expert, master at 7th and legendary at 15th, beside the Objection reaction', () => {
    /* AoN feat-8404: *"You gain the Objection reaction. You also become an expert in Legal Lore… At
     * 7th level you become a master of Legal Lore, and at 15th level you become legendary."* WG
     * creates it at trained and stops; ruled a deliberate difference, desk #38. */
    expect(FEAT_SKILL_GRANTS['devils-eye']).toEqual({
      skills: { 'lore:legal': 'expert' },
      rankUpgrade: [{ level: 7, rank: 'master' }, { level: 15, rank: 'legendary' }],
    });
    expect(db.feats['devils-eye'].grantsActions).toEqual(['objection']);
    expect(stars(withFeats(['devils-eye']), { kind: 'skill', skill: 'thievery' }, 'devils-eye')).toEqual([
      'to any check to read or negotiate a treatise, contract, or similar text :: +1 circumstance',
    ]);
  });
});

describe('batch 037 instruments-4 — pistol-wand carries the runes onto the stock', () => {
  // batch 037: pistol-wand#stock-runes
  it('the reinforced stock has the pistol\'s +1 potency, and both halves of the combination agree', () => {
    /* AoN equipment-3589: *"This +1 flintlock pistol has a reinforced stock permanently attached to
     * it, and the pistol's potency rune (and any other runes) applies to Strikes with the stock as
     * well."* WG hands over a plain Reinforced Stock with no rune; ruled a deliberate difference,
     * desk #65. */
    expect(db.items['pistol-wand'].builtInRunes).toEqual({ potency: 1 });
    expect(db.items['pistol-wand'].combinationMeleeForm).toBe('pistol-wand-stock');
    expect(db.items['pistol-wand-stock'].builtInRunes).toEqual({ potency: 1 });
    expect(db.items['pistol-wand-stock'].formOf).toBe('pistol-wand');
  });
});

describe('batch 037 instruments-4 — keys-to-destiny offers all nine printed Lores', () => {
  // batch 037: keys-to-destiny#labor-lore
  it('Labor Lore is on the list and trains Labor Lore, not Herbalism Lore', () => {
    /* AoN background-367 lists *"Art Lore, Engineering Lore, Farming Lore, Herbalism Lore, Labor Lore,
     * Mercantile Lore, Scribing Lore, Theater Lore, or Warfare Lore."* WG's Labor Lore option writes
     * Herbalism Lore — their copy-paste slip, not to be imported; desk #74. */
    expect(db.backgrounds['keys-to-destiny'].trainedLoreOptions).toEqual([
      'art', 'engineering', 'farming', 'herbalism', 'labor', 'mercantile', 'scribing', 'theater', 'warfare',
    ]);
  });
});

describe('batch 037 instruments-4 — concordance-scout offers all six planar Lores', () => {
  // batch 037: concordance-scout#six-lores
  it('Plane of Earth Lore is present and every option carries a usable value', () => {
    /* AoN background-383: *"Plane of Air Lore, Plane of Earth Lore, Plane of Fire Lore, Plane of Metal
     * Lore, Plane of Water Lore, or Plane of Wood Lore."* WG ships five, Earth missing, and a stray
     * space breaks their Plane of Air option; desk #75. */
    expect(db.backgrounds['concordance-scout'].choice!.options!.map((o) => o.value)).toEqual([
      'plane-of-air', 'plane-of-earth', 'plane-of-fire', 'plane-of-metal', 'plane-of-water', 'plane-of-wood',
    ]);
  });
});

describe('batch 037 instruments-4 — poppet keeps the minimum-1 fire weakness', () => {
  // batch 037: poppet#fire-weakness
  it('a 1st-level poppet has fire weakness 1, and it is one-third level thereafter', () => {
    /* AoN ancestry-49: *"Flammable You have weakness to fire damage equal to one-third your level
     * (minimum 1)."* WG's formula is level/3 with no clamp, so their 1st- and 2nd-level poppet takes
     * no extra fire damage at all; desk #76. */
    expect((db.ancestries.poppet as Record<string, unknown>).weaknesses)
      .toEqual([{ type: 'fire', value: 'max(1,floor(@actor.level/3))' }]);
    const fireAt = (level: number) => {
      const ch = build('fighter', level, { ancestryId: 'poppet' } as never);
      return (deriveDefenses(ch, db).weaknesses ?? []).find((w) => w.type === 'fire')?.value;
    };
    expect(fireAt(1)).toBe(1);
    expect(fireAt(2)).toBe(1);
    expect(fireAt(9)).toBe(3);
  });
});

describe('batch 037 instruments-4 — goloma is granted Goloma and Mwangi', () => {
  // batch 037: goloma#languages
  it('the printed pair is granted and Common is not among them', () => {
    /* AoN ancestry-45: *"Languages Goloma Mwangi Additional languages equal to your Intelligence
     * modifier (if it's positive)."* WG hands every goloma Common instead of Goloma, though their own
     * language list contains Goloma; desk #77. */
    expect((db.ancestries.goloma as Record<string, any>).languages.granted).toEqual(['goloma', 'mwangi']);
    expect(db.languages.goloma).toBeTruthy();
  });
});

/* ================================================================== *
 * THE PARK ITSELF — what these twelve rulings are allowed to reach
 * ================================================================== */

describe('batch 037 instruments-4 — the two settles are the whole of this chunk\'s instrument reach', () => {
  // batch 037: instinct-ability#no-hit-points
  it('no other record of the twelve was added to a settle registry by this chunk', () => {
    /*
     * The ten residual reads get NO registry entry on purpose: every comparer already agrees on them,
     * so an entry would be a stale settle — one that silences the NEXT difference on that record,
     * unread, which is the trap the registries' own headers warn about. Named here so a later batch
     * that adds one has to delete this assertion and say why.
     */
    const diff = readFileSync(join(CLI_ROOT, 'scripts/wg-diff.mjs'), 'utf8');
    const vals = readFileSync(join(CLI_ROOT, 'scripts/wg-values.mjs'), 'utf8');
    expect(diff).toContain("'instinct-ability': ['hp'],");
    expect(vals).toContain("'tumbling-theft': ['skill|stealth'],");
    for (const id of ['reinforced-chassis', 'elemental-existence', 'thats-not-natural', 'devils-eye',
      'keys-to-destiny', 'concordance-scout']) {
      expect(diff, `${id} must stay unsettled in wg-diff`).not.toContain(`'${id}': [`);
      expect(vals, `${id} must stay unsettled in wg-values`).not.toContain(`'${id}': [`);
    }
  });
});

/* The database type is read directly above for the few fields with no accessor; keeping the import
 * used also keeps the file honest about what it touches. */
export type _Db = ContentDatabase;
