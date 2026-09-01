import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import type { BuildState } from '../src/rules/build';
import { FEAT_RANK_FEAT_GRANTS } from '../src/rules/featFeatGrants';
import { FEAT_GRANTS } from '../src/rules/featGrants';

const db = content();

/**
 * A feat grant the character's OWN PROFICIENCY decides.
 *
 * Two records print one and both shipped granting NOBODY, because every other feat→feat lane
 * (`FEAT_FEAT_GRANTS`, `CHOICE_FEAT_GRANTS`, a record's `grantsFeats`) is unconditional, so the only
 * authorings available were "hand it to everyone" or "hand it to no one".
 *
 *   Stonemason's Eye — "You become trained in Crafting. If you're ALREADY trained in Crafting, you
 *                       instead gain the Specialty Crafting skill feat for stonemasonry."
 *   Gildedsoul       — "…trained in your choice of Diplomacy or Society… If you're trained in
 *                       Society, you also gain the Courtly Graces skill feat."
 *
 * Both were verified against Wanderer's Guide's raw `operations` (a `conditional` whose condition is
 * a `prof` comparison) and Foundry's rule elements (a `GrantItem` with a `skill:*:rank` predicate),
 * which agree with each other and with the printed text.
 */

/** A level-1 character with one ancestry feat in the 1st-level slot. */
const withAncestryFeat = (featId: string, over: Partial<BuildState> = {}) =>
  build('rogue', 1, { featPicks: { '1:ancestry': featId } as BuildState['featPicks'], ...over });

const featIds = (ch: ReturnType<typeof build>) => ch.feats.map((f) => f.featId);
const granted = (ch: ReturnType<typeof build>, id: string) => ch.feats.find((f) => f.featId === id);

describe('rank-gated feat grants — the registry itself', () => {
  it('names only feats that ship, and only real skill keys', () => {
    for (const [granterId, rows] of Object.entries(FEAT_RANK_FEAT_GRANTS)) {
      expect(db.feats[granterId], `granter ${granterId}`).toBeTruthy();
      for (const r of rows) {
        expect(db.feats[r.feat], `${granterId} → ${r.feat}`).toBeTruthy();
        expect(typeof r.skill).toBe('string');
      }
    }
  });
});

describe("Stonemason's Eye — the ALREADY-trained gate", () => {
  it('trains Crafting and grants nothing when the character was untrained', () => {
    const ch = withAncestryFeat('stonemasons-eye');
    expect(ch.proficiencies.skills.crafting).toBe('trained');
    expect(featIds(ch)).not.toContain('specialty-crafting');
  });

  /*
   * The gate must ignore the feat's OWN Crafting grant. `countOwnGrant` is absent here precisely
   * because the text says "ALREADY trained" — WG expresses the same thing as `SKILL_CRAFTING EQUALS
   * U` guarding its own adjValue. Read the wrong way round, every dwarf who took this feat would get
   * Specialty Crafting, since the feat itself always trains Crafting.
   */
  it('does not let its own Crafting grant open its own gate', () => {
    expect(FEAT_GRANTS['stonemasons-eye']?.skills?.crafting).toBe('trained');
    expect(FEAT_RANK_FEAT_GRANTS['stonemasons-eye'][0].countOwnGrant).toBeFalsy();
  });

  it('grants Specialty Crafting instead when Crafting came from somewhere else', () => {
    const ch = withAncestryFeat('stonemasons-eye', {
      overrides: { proficiencies: { crafting: 'trained' } },
    } as Partial<BuildState>);
    expect(featIds(ch)).toContain('specialty-crafting');
    expect(granted(ch, 'specialty-crafting')?.grantedBy).toBe('stonemasons-eye');
  });

  /* The gate is read inside the feat→feat expansion, which runs BEFORE the feat-proficiency pass —
   * so `proficiencies.skills` alone reports "untrained" for a character another FEAT trained. The
   * scan over the other feats' own grant entries is what stops that, and this is its test. */
  it('counts Crafting trained by a DIFFERENT feat', () => {
    // Dwarven Lore — the other dwarf ancestry feat that trains Crafting, so both fit one character
    // legally. Asserted rather than assumed: if its grant ever changes, this says why the test moved.
    expect(FEAT_GRANTS['dwarven-lore']?.skills?.crafting).toBe('trained');
    const ch = build('rogue', 5, {
      featPicks: { '1:ancestry': 'dwarven-lore', '5:ancestry': 'stonemasons-eye' } as BuildState['featPicks'],
    });
    expect(featIds(ch)).toContain('dwarven-lore');
    expect(featIds(ch)).toContain('specialty-crafting');
  });

  /* "…for stonemasonry" — the specialty is named, so the granted feat must not ask its own
   * twelve-way question. WG and Foundry both preselect it. */
  it('binds the granted feat to stonemasonry', () => {
    const ch = withAncestryFeat('stonemasons-eye', {
      overrides: { proficiencies: { crafting: 'trained' } },
    } as Partial<BuildState>);
    expect(granted(ch, 'specialty-crafting')?.choice?.value).toBe('stonemasonry');
    expect(granted(ch, 'specialty-crafting')?.choice?.label).toBe('Stonemasonry');
    // …and it is a real option on the granted feat, not a value invented here.
    expect(db.feats['specialty-crafting'].choice?.options?.map((o) => o.value)).toContain('stonemasonry');
  });
});

describe('Gildedsoul — the choice satisfies its own gate', () => {
  it('offers Diplomacy or Society as a skill slot', () => {
    const slot = FEAT_GRANTS['gildedsoul']?.skillChoices?.[0];
    expect(slot?.options).toEqual(['diplomacy', 'society']);
    expect(slot?.rank).toBe('trained');
    expect(slot?.redundantFallback).toBe(true);
  });

  it('grants Courtly Graces when the player picks Society', () => {
    const ch = withAncestryFeat('gildedsoul', {
      featSkillChoices: { 'gildedsoul:0': 'society' },
    } as Partial<BuildState>);
    expect(ch.proficiencies.skills.society).toBe('trained');
    expect(featIds(ch)).toContain('courtly-graces');
    expect(granted(ch, 'courtly-graces')?.grantedBy).toBe('gildedsoul');
  });

  it('grants nothing when the player picks Diplomacy and Society is untrained', () => {
    const ch = withAncestryFeat('gildedsoul', {
      featSkillChoices: { 'gildedsoul:0': 'diplomacy' },
      overrides: { proficiencies: { society: 'untrained' } },
    } as Partial<BuildState>);
    expect(ch.proficiencies.skills.diplomacy).toBe('trained');
    expect(featIds(ch)).not.toContain('courtly-graces');
  });

  /* "If you're trained in Society" — no "already", so training from ANY source satisfies it, which
   * is why this row carries `countOwnGrant`. */
  it('grants Courtly Graces on Society trained from elsewhere, even when the pick was Diplomacy', () => {
    const ch = withAncestryFeat('gildedsoul', {
      featSkillChoices: { 'gildedsoul:0': 'diplomacy' },
      overrides: { proficiencies: { society: 'trained' } },
    } as Partial<BuildState>);
    expect(featIds(ch)).toContain('courtly-graces');
  });

  /*
   * The record moved off a core.json `effectChoices` picker (shipped v0.1.16, live for six releases)
   * onto a `skillChoices` slot, which changes the key the answer is stored under. A character saved
   * before the move still holds the old key; without the bridge their Society silently becomes
   * Diplomacy — losing the training AND the feat that hangs off it.
   */
  it('still honours an answer saved under the retired effectChoices key', () => {
    const ch = withAncestryFeat('gildedsoul', {
      effectChoices: { 'gildedsoul:gildedsoul-skill': 'society' },
    } as Partial<BuildState>);
    expect(ch.proficiencies.skills.society).toBe('trained');
    expect(featIds(ch)).toContain('courtly-graces');
  });

  it('lets the new key win over the retired one', () => {
    const ch = withAncestryFeat('gildedsoul', {
      featSkillChoices: { 'gildedsoul:0': 'diplomacy' },
      effectChoices: { 'gildedsoul:gildedsoul-skill': 'society' },
      overrides: { proficiencies: { society: 'untrained' } },
    } as Partial<BuildState>);
    expect(featIds(ch)).not.toContain('courtly-graces');
  });

  it('no longer carries the retired core.json fields', () => {
    expect(db.feats['gildedsoul'].effectChoices).toBeUndefined();
    expect(db.feats['gildedsoul'].choice).toBeUndefined();
  });
});

describe('Gildedsoul — the redundancy clause on a CHOSEN skill', () => {
  /*
   * "If you would automatically become trained in BOTH these skills (from your background or class,
   * for example), you instead become trained in a skill of your choice."
   *
   * This is the only consumer of `skillChoices[].redundantFallback`. The record-wide flag cannot say
   * it: that reader is guarded on a STATIC `skills` entry, and Gildedsoul's only training is the
   * slot. WG expresses the same clause as a conditional whose condition is DIPLOMACY >= T AND
   * SOCIETY >= T; ours fires when the slot's pick bought nothing, and the two agree because
   * `skillSlotGrant` greys a dead option, so a redundant pick means BOTH options were dead.
   */
  const bothTrained = (over: Partial<BuildState> = {}) =>
    withAncestryFeat('gildedsoul', {
      featSkillChoices: { 'gildedsoul:0': 'society' },
      overrides: { proficiencies: { diplomacy: 'trained', society: 'trained' } },
      ...over,
    } as Partial<BuildState>);

  it('reports the dead slot so the builder can offer a replacement', () => {
    const ch = bothTrained();
    expect(ch.skillFallbacks ?? []).toContainEqual({ featId: 'gildedsoul', skill: 'society' });
  });

  it('trains the replacement the player names', () => {
    const ch = bothTrained({
      featSkillChoices: { 'gildedsoul:0': 'society', 'gildedsoul:fallback:society': 'occultism' },
    } as Partial<BuildState>);
    expect(ch.proficiencies.skills.occultism).toBe('trained');
  });

  it('offers no replacement while the slot still buys something', () => {
    const ch = withAncestryFeat('gildedsoul', {
      featSkillChoices: { 'gildedsoul:0': 'society' },
      overrides: { proficiencies: { society: 'untrained' } },
    } as Partial<BuildState>);
    expect((ch.skillFallbacks ?? []).some((f) => f.featId === 'gildedsoul')).toBe(false);
  });

  /* The clause is a REPLACEMENT, not an extra: a redundant slot must not also hand over Courtly
   * Graces on the strength of the Society it did not train. Here Society IS trained (by the
   * override), so the grant is correct — this pins that the fallback did not suppress it. */
  it('still grants Courtly Graces when Society was already trained', () => {
    expect(featIds(bothTrained())).toContain('courtly-graces');
  });
});
