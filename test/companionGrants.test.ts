import { describe, it, expect } from 'vitest';
import { featGrantedCompanions, FEAT_COMPANION_GRANTS } from '../src/rules/companionGrants';
import { content } from './_content';

const db = content();

describe('featGrantedCompanions', () => {
  it('surfaces a familiar for the Pet feat', () => {
    const got = featGrantedCompanions(new Set(['pet']));
    expect(got).toHaveLength(1);
    expect(got[0].grantSlug).toBe('pet');
    expect(got[0].id).toBe('featcmp-pet');
    expect(got[0].grant.kind).toBe('familiar');
    expect(got[0].grant.abilityBudget).toBe(2);
    expect(got[0].grant.lockedAbilities ?? []).toEqual([]);
  });

  it('surfaces an aquatic pet with locked Darkvision + Tough for Friend of the Sea', () => {
    const got = featGrantedCompanions(new Set(['friend-of-the-sea']));
    expect(got).toHaveLength(1);
    expect(got[0].grant.kind).toBe('familiar');
    expect(got[0].grant.lockedAbilities).toEqual(['darkvision', 'tough']);
  });

  it('dedupes overlapping grants: Friend of the Sea supersedes the plain Pet', () => {
    // Friend of the Sea grants the Pet feat, so a character with both must get ONE companion.
    const got = featGrantedCompanions(new Set(['pet', 'friend-of-the-sea']));
    expect(got).toHaveLength(1);
    expect(got[0].grantSlug).toBe('friend-of-the-sea');
  });

  it('returns nothing when no granting feat is taken', () => {
    expect(featGrantedCompanions(new Set(['reactive-strike', 'toughness']))).toEqual([]);
  });

  it('fires for subclass-feature grants (druid order / inventor / animist / wizard thesis)', () => {
    // these ids come from character.subclassId (druid order, inventor innovation, animist subclass)
    // or a slugified extra-choice name (wizard thesis) — see CompanionsTab's grant-source set.
    for (const [id, kind] of [['animal-order', 'animal'], ['construct-innovation', 'animal'], ['shaman', 'familiar'], ['improved-familiar-attunement', 'familiar']] as const) {
      const got = featGrantedCompanions(new Set([id]));
      expect(got, id).toHaveLength(1);
      expect(got[0].grant.kind, id).toBe(kind);
    }
  });

  it('a druid order supersedes the base Leshy Familiar / Animal Companion feat (one companion)', () => {
    expect(featGrantedCompanions(new Set(['animal-order', 'animal-companion']))).toHaveLength(1);
    expect(featGrantedCompanions(new Set(['leaf-order', 'leshy-familiar']))).toHaveLength(1);
  });

  it('covers the full companion-grant catalog (feats + class features)', () => {
    expect(Object.keys(FEAT_COMPANION_GRANTS).length).toBeGreaterThan(40);
    // the flagship + a spread of the workflow-verified grants must be present
    for (const s of ['pet', 'friend-of-the-sea', 'animal-companion', 'beastmaster-dedication', 'familiar-witch', 'draconic-familiar', 'leshy-familiar'])
      expect(FEAT_COMPANION_GRANTS[s]).toBeTruthy();
  });

  it('every locked familiar ability is a real familiarAbilities id', () => {
    const valid = new Set(Object.keys(db.familiarAbilities));
    for (const [slug, g] of Object.entries(FEAT_COMPANION_GRANTS))
      for (const a of g.lockedAbilities ?? []) expect(valid.has(a), `${slug} → ${a}`).toBe(true);
  });

  it('every supersedes target is itself a grant in the table', () => {
    for (const [slug, g] of Object.entries(FEAT_COMPANION_GRANTS))
      for (const s of g.supersedes ?? []) expect(FEAT_COMPANION_GRANTS[s], `${slug} supersedes ${s}`).toBeTruthy();
  });

  it('animal-kind grants carry no familiar-only params; familiar grants have a positive budget when set', () => {
    for (const [slug, g] of Object.entries(FEAT_COMPANION_GRANTS)) {
      if (g.kind === 'animal') { expect(g.abilityBudget, slug).toBeUndefined(); expect(g.lockedAbilities ?? [], slug).toEqual([]); }
      if (g.abilityBudget != null) expect(g.abilityBudget, slug).toBeGreaterThan(0);
    }
  });
});
