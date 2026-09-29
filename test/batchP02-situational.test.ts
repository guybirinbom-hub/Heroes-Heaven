// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { characterSituationalIds, explainStat, recordMarkersFor } from '../src/rules/explain';
import { deriveStrikes } from '../src/rules/derive';
import { FEAT_SITUATIONAL, RECORD_MARKERS } from '../src/rules/situationalBonuses';
import type { Character } from '../src/rules/types';

/**
 * Print batch P02, SITUATIONAL lane.
 *
 * Every assertion reads the DERIVED sheet through the reader the sheet itself uses:
 * `explainStat(...).situational` (the rows StatDetailModal lists under a stat) and `recordMarkersFor`
 * (MainTab's action rows, FeatsTab's feat entries). Every character is BUILT, so each id an entry is
 * keyed to has to actually arrive — a magus hybrid study through `ownedFeatureIds`, a background
 * through `backgroundId`, a feat through `feats`. The mutation-proof tests delete the registry entry
 * and require the row to vanish, so a pass cannot come from some other carrier saying the same thing.
 */
const db = content();

type Ref =
  | { kind: 'skill'; skill: string }
  | { kind: 'speed' }
  | { kind: 'ac' }
  | { kind: 'strikeDamage' }
  | { kind: 'strikeAttack' };

/** The situational rows ONE source contributes to a stat, as StatDetailModal reads them. */
const rows = (c: Character, ref: Ref, sourceId: string): string[] => {
  let full: Parameters<typeof explainStat>[2];
  if (ref.kind === 'strikeDamage' || ref.kind === 'strikeAttack') {
    const strike = deriveStrikes(c, db)[0];
    expect(strike, 'the character has at least one Strike to read').toBeTruthy();
    full = { kind: ref.kind, instanceId: strike.instanceId };
  } else {
    full = ref as Parameters<typeof explainStat>[2];
  }
  return (explainStat(c, db, full).situational ?? []).filter((n) => n.sourceId === sourceId).map((n) => n.text);
};

/** The marks ONE source puts on an action / feature row. */
const marks = (c: Character, on: 'action' | 'feature', id: string, sourceId: string) =>
  recordMarkersFor(c, db, on, id).filter((m) => m.sourceId === sourceId);

/** Run `fn` with FEAT_SITUATIONAL[id] deleted, then put it back. */
const withoutStar = <T,>(id: string, fn: () => T): T => {
  const saved = FEAT_SITUATIONAL[id];
  try {
    delete (FEAT_SITUATIONAL as Record<string, unknown>)[id];
    return fn();
  } finally {
    FEAT_SITUATIONAL[id] = saved;
  }
};

/** A built character who has also taken `featId`. */
const withFeat = (c: Character, featId: string, level: number): Character =>
  ({ ...c, feats: [...c.feats, { featId, level, category: 'class' as const }] }) as Character;

const magus = (subclassId: string, level = 7) => build('magus', level, { subclassId });

describe('trusted-rival: the daily-preparation Bastardhall Research skill', () => {
  const rival = build('fighter', 7, { backgroundId: 'trusted-rival' });

  // batch P02: trusted-rival#daily-prep-skill
  it('trusted-rival: the background star reads the daily pick, expert and master at 7th', () => {
    expect(rival.backgroundId).toBe('trusted-rival');
    expect(characterSituationalIds(rival, db)).toContain('trusted-rival');
    // The skill is re-picked each day, so the star is on every skill (the starstone shape).
    // Filtered to the daily-preparation row: trusted-rival#research-bonus (another family) adds the
    // +2 circumstance Research star as a DATA row on the same record, which must not flip this test.
    for (const skill of ['society', 'deception', 'occultism']) {
      const r = rows(rival, { kind: 'skill', skill }, 'trusted-rival').filter((t) => /daily preparations/.test(t));
      expect(r.length, skill).toBe(1);
      expect(r[0]).toMatch(/daily preparations/);
      expect(r[0]).toMatch(/Research a topic associated with Bastardhall/);
      expect(r[0]).toMatch(/expert/);
      expect(r[0]).toMatch(/master at 7th level/);
    }
  });

  // batch P02: trusted-rival#daily-prep-skill
  it('trusted-rival: the row comes from the registry entry (stunted copy)', () => {
    // mutation-proof: stunt FEAT_SITUATIONAL['trusted-rival'] and the row must vanish.
    const daily = (c: Character) => rows(c, { kind: 'skill', skill: 'society' }, 'trusted-rival').filter((t) => /daily preparations/.test(t));
    expect(withoutStar('trusted-rival', () => daily(rival))).toEqual([]);
    expect(daily(build('fighter', 7))).toEqual([]);
  });
});

describe('aloof-firmament: the stance damage, movement and Cat Fall clauses', () => {
  const aloof = magus('aloof-firmament');
  const shadow = magus('laughing-shadow');

  // batch P02: aloof-firmament#cascade-damage
  it('aloof-firmament: the Strike damage row reads the 4 / 6 / 8 one-handed sword increase', () => {
    expect(characterSituationalIds(aloof, db)).toContain('aloof-firmament');
    const r = rows(aloof, { kind: 'strikeDamage' }, 'aloof-firmament');
    expect(r.length).toBe(1);
    expect(r[0]).toMatch(/one-handed sword-group weapon/);
    expect(r[0]).toMatch(/Fly, Leap, High Jump or Long Jump/);
    expect(r[0]).toMatch(/other hand completely free/);
    expect(r[0]).toMatch(/becomes 4 \(6 with weapon specialization, 8 with greater weapon specialization\)/);
    expect(rows(shadow, { kind: 'strikeDamage' }, 'aloof-firmament')).toEqual([]);
  });

  // batch P02: aloof-firmament#cascade-damage
  it('aloof-firmament: the damage row comes from the registry entry (stunted copy)', () => {
    // mutation-proof: stunt FEAT_SITUATIONAL['aloof-firmament'] and the row must vanish.
    expect(withoutStar('aloof-firmament', () => rows(aloof, { kind: 'strikeDamage' }, 'aloof-firmament'))).toEqual([]);
  });

  // batch P02: aloof-firmament#stance-movement
  it('aloof-firmament: the Speed row and the four movement actions carry Quick Jump and no reactions', () => {
    const r = rows(aloof, { kind: 'speed' }, 'aloof-firmament');
    expect(r.length).toBe(1);
    expect(r[0]).toMatch(/Arcane Cascade stance/);
    expect(r[0]).toMatch(/Quick Jump/);
    expect(r[0]).toMatch(/don't trigger reactions/);
    for (const action of ['high-jump', 'long-jump']) {
      const m = marks(aloof, 'action', action, 'aloof-firmament');
      expect(m.length, action).toBe(1);
      expect(m[0].note).toMatch(/Quick Jump/);
      expect(m[0].note).toMatch(/Arcane Cascade stance/);
      // Stance-gated: no unconditional changed cost on the row.
      expect(m[0].value).toBeUndefined();
    }
    for (const action of ['leap', 'fly']) {
      const m = marks(aloof, 'action', action, 'aloof-firmament');
      expect(m.length, action).toBe(1);
      expect(m[0].note).toMatch(/doesn't trigger reactions/);
    }
    expect(marks(shadow, 'action', 'high-jump', 'aloof-firmament')).toEqual([]);
  });

  // batch P02: aloof-firmament#stance-movement
  it('aloof-firmament: the Speed row and the action marks come from the registries (stunted copy)', () => {
    // mutation-proof: stunt FEAT_SITUATIONAL['aloof-firmament'] and RECORD_MARKERS['aloof-firmament'].
    expect(withoutStar('aloof-firmament', () => rows(aloof, { kind: 'speed' }, 'aloof-firmament'))).toEqual([]);
    const saved = RECORD_MARKERS['aloof-firmament'];
    try {
      delete (RECORD_MARKERS as Record<string, unknown>)['aloof-firmament'];
      expect(marks(aloof, 'action', 'high-jump', 'aloof-firmament')).toEqual([]);
      expect(marks(aloof, 'feature', 'cat-fall', 'aloof-firmament')).toEqual([]);
    } finally {
      RECORD_MARKERS['aloof-firmament'] = saved;
    }
  });

  // batch P02: aloof-firmament#cat-fall-condition
  it('aloof-firmament: the granted Cat Fall feat entry carries the shield and armor restriction', () => {
    expect(aloof.feats.some((f) => f.featId === 'cat-fall')).toBe(true);
    const m = marks(aloof, 'feature', 'cat-fall', 'aloof-firmament');
    expect(m.length).toBe(1);
    expect(m[0].note).toMatch(/aren't using a shield/);
    expect(m[0].note).toMatch(/light or no armor/);
    // A magus of another study who took Cat Fall some other way reads no such restriction.
    const other = withFeat(shadow, 'cat-fall', 2);
    expect(marks(other, 'feature', 'cat-fall', 'aloof-firmament')).toEqual([]);
  });
});

describe('resurgent-maelstrom: the Arcane Cascade versatile clause', () => {
  const maelstrom = magus('resurgent-maelstrom');

  // batch P02: resurgent-maelstrom#stance-versatile
  it('resurgent-maelstrom: the Strike damage row adds the in-stance versatile traits beside the old clause', () => {
    expect(characterSituationalIds(maelstrom, db)).toContain('resurgent-maelstrom');
    const r = rows(maelstrom, { kind: 'strikeDamage' }, 'resurgent-maelstrom');
    // No total count: resurgent-maelstrom#trait-already-present (another family) may add a clause here.
    expect(r.some((t) => /minimum damage die 1d6/.test(t))).toBe(true);
    const versatile = r.filter((t) => /versatile/.test(t));
    expect(versatile.length).toBe(1);
    expect(versatile[0]).toMatch(/Arcane Cascade stance/);
    expect(versatile[0]).toMatch(/doesn't normally deal/);
    expect(versatile[0]).toMatch(/versatile P and versatile S/);
  });

  // batch P02: resurgent-maelstrom#stance-versatile
  it('resurgent-maelstrom: the versatile row comes from the registry entry (stunted copy)', () => {
    // mutation-proof: stunt FEAT_SITUATIONAL['resurgent-maelstrom'] and every REGISTRY row must vanish.
    // The one row that survives is resurgent-maelstrom#trait-already-present's backstabber/forceful
    // rider, which data-rows-1 lands as a RECORD field (it concatenates after the table entry), so the
    // stunt cannot reach it — before that row landed the stunted list was empty.
    const stunted = withoutStar('resurgent-maelstrom', () => rows(maelstrom, { kind: 'strikeDamage' }, 'resurgent-maelstrom'));
    // batch P02: resurgent-maelstrom#stance-versatile
    expect(stunted.filter((t) => /versatile|minimum damage die/.test(t))).toEqual([]);
    expect(stunted.every((t) => /backstabber/.test(t) && /forceful/.test(t))).toBe(true);
  });
});

describe('twisting-tree: the one-handed and two-handed staff traits', () => {
  const tree = magus('twisting-tree');

  // batch P02: twisting-tree#staff-traits
  it('twisting-tree: the Strike damage row names both grips and their traits', () => {
    expect(characterSituationalIds(tree, db)).toContain('twisting-tree');
    const r = rows(tree, { kind: 'strikeDamage' }, 'twisting-tree');
    expect(r.length).toBe(1);
    expect(r[0]).toMatch(/staff/);
    expect(r[0]).toMatch(/one-handed: gains agile and its damage die becomes 1d6/);
    expect(r[0]).toMatch(/two-handed: gains parry, reach and trip/);
    expect(rows(magus('laughing-shadow'), { kind: 'strikeDamage' }, 'twisting-tree')).toEqual([]);
  });

  // batch P02: twisting-tree#staff-traits
  it('twisting-tree: the row comes from the registry entry (stunted copy)', () => {
    // mutation-proof: stunt FEAT_SITUATIONAL['twisting-tree'] and the row must vanish.
    expect(withoutStar('twisting-tree', () => rows(tree, { kind: 'strikeDamage' }, 'twisting-tree'))).toEqual([]);
  });
});

describe('twofold-tine: the off-hand Arcane Cascade increase', () => {
  const tine = magus('twofold-tine');

  // batch P02: twofold-tine#cascade-damage
  it('twofold-tine: the Strike damage row reads the 2 / 4 / 6 increase for the other-hand weapon', () => {
    expect(characterSituationalIds(tine, db)).toContain('twofold-tine');
    const r = rows(tine, { kind: 'strikeDamage' }, 'twofold-tine');
    expect(r.length).toBe(1);
    expect(r[0]).toMatch(/different hand/);
    expect(r[0]).toMatch(/until the end of your turn/);
    expect(r[0]).toMatch(/becomes 2 \(4 with weapon specialization, 6 with greater weapon specialization\)/);
    expect(rows(magus('laughing-shadow'), { kind: 'strikeDamage' }, 'twofold-tine')).toEqual([]);
  });

  // batch P02: twofold-tine#cascade-damage
  it('twofold-tine: the row comes from the registry entry (stunted copy)', () => {
    // mutation-proof: stunt FEAT_SITUATIONAL['twofold-tine'] and the row must vanish.
    expect(withoutStar('twofold-tine', () => rows(tine, { kind: 'strikeDamage' }, 'twofold-tine'))).toEqual([]);
  });
});

describe('distracting-spellstrike: the Feint status bonus in Arcane Cascade', () => {
  const taker = withFeat(magus('laughing-shadow', 4), 'distracting-spellstrike', 4);

  // batch P02: distracting-spellstrike#deception-bonus
  it('distracting-spellstrike: the Deception row reads the status bonus equal to the cascade damage', () => {
    expect(characterSituationalIds(taker, db)).toContain('distracting-spellstrike');
    const r = rows(taker, { kind: 'skill', skill: 'deception' }, 'distracting-spellstrike');
    expect(r.length).toBe(1);
    expect(r[0]).toMatch(/Feint/);
    expect(r[0]).toMatch(/Arcane Cascade stance/);
    expect(r[0]).toMatch(/status/);
    expect(r[0]).toMatch(/2 with weapon specialization, 3 with greater weapon specialization/);
    // Deception only — no other skill row gains it.
    expect(rows(taker, { kind: 'skill', skill: 'diplomacy' }, 'distracting-spellstrike')).toEqual([]);
  });

  // batch P02: distracting-spellstrike#deception-bonus
  it('distracting-spellstrike: the row comes from the registry entry (stunted copy)', () => {
    // mutation-proof: stunt FEAT_SITUATIONAL['distracting-spellstrike'] and the row must vanish.
    expect(withoutStar('distracting-spellstrike', () => rows(taker, { kind: 'skill', skill: 'deception' }, 'distracting-spellstrike'))).toEqual([]);
  });
});

describe('exploding-bullet: the scatter / splash change on the firearm Strike', () => {
  const taker = withFeat(magus('volatile-spark', 4), 'exploding-bullet', 4);

  // batch P02: exploding-bullet#splash
  it('exploding-bullet: the Strike damage row reads scatter 5 feet, the chosen energy and the +1 status', () => {
    expect(characterSituationalIds(taker, db)).toContain('exploding-bullet');
    const r = rows(taker, { kind: 'strikeDamage' }, 'exploding-bullet');
    expect(r.length).toBe(1);
    expect(r[0]).toMatch(/firearm Strike/);
    expect(r[0]).toMatch(/arcane trait/);
    expect(r[0]).toMatch(/scatter 5 feet/);
    expect(r[0]).toMatch(/energy type you chose/);
    expect(r[0]).toMatch(/\+1 status to its splash damage/);
  });

  // batch P02: exploding-bullet#splash
  it('exploding-bullet: the row comes from the registry entry (stunted copy)', () => {
    // mutation-proof: stunt FEAT_SITUATIONAL['exploding-bullet'] and the row must vanish.
    expect(withoutStar('exploding-bullet', () => rows(taker, { kind: 'strikeDamage' }, 'exploding-bullet'))).toEqual([]);
  });
});

describe('spirit-sheath: the Stealth condition carries print\'s capacity', () => {
  const taker = withFeat(magus('laughing-shadow', 2), 'spirit-sheath', 2);

  // batch P02: spirit-sheath#situational
  it('spirit-sheath: the Stealth row says up to 1 Bulk worth of weapons, not one weapon', () => {
    const r = rows(taker, { kind: 'skill', skill: 'stealth' }, 'spirit-sheath');
    expect(r.length).toBe(1);
    expect(r[0]).toMatch(/up to 1 Bulk worth of weapons/);
    expect(r[0]).not.toMatch(/one weapon/);
    expect(r[0]).toMatch(/\+2 circumstance/);
  });
});

describe('emergency-targe: the AC trigger is not melee-only', () => {
  const taker = withFeat(magus('sparkling-targe', 4), 'emergency-targe', 4);

  // batch P02: emergency-targe#situational
  it('emergency-targe: the AC row answers any Strike or spell attack from an enemy you are aware of', () => {
    const r = rows(taker, { kind: 'ac' }, 'emergency-targe');
    expect(r.length).toBe(1);
    expect(r[0]).toMatch(/Strike or spell attack roll from an enemy you're aware of/);
    expect(r[0]).not.toMatch(/melee/);
  });
});
