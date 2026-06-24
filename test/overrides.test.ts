import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { buildCharacter, deriveBuildFromCharacter, applyOverrides } from '../src/rules/build';
import type { FeatCategory } from '../src/rules/types';

const db = content();
// A grantable feat: any general feat available at level 1.
const bonus = Object.values(db.feats).find((f) => f.level === 1 && f.category === 'general')!;

describe('Overrides — creative per-case rule-breaks', () => {
  it('grants a bonus feat with no slot cost (addedFeats)', () => {
    const ch = build('fighter', 3, { keyAbility: 'str', overrides: { addedFeats: [{ featId: bonus.id, level: 1, category: 'general' }] } });
    expect(ch.feats.some((f) => f.featId === bonus.id)).toBe(true);
    expect(ch.overrides?.addedFeats?.[0].featId).toBe(bonus.id);
  });

  it('does not duplicate a feat the character already has', () => {
    const base = build('fighter', 1, { keyAbility: 'str' });
    expect(base.feats.length).toBeGreaterThan(0);
    const existing = base.feats[0].featId;
    const ch = build('fighter', 1, { keyAbility: 'str', overrides: { addedFeats: [{ featId: existing, level: 1, category: 'skill' }] } });
    expect(ch.feats.filter((f) => f.featId === existing).length).toBe(1);
  });

  it('removes an auto-granted feat (removedFeatIds)', () => {
    const base = build('fighter', 1, { keyAbility: 'str' });
    const target = base.feats[0].featId;
    const ch = build('fighter', 1, { keyAbility: 'str', overrides: { removedFeatIds: [target] } });
    expect(ch.feats.some((f) => f.featId === target)).toBe(false);
  });

  it('overrides round-trip, and bonus feats never consume a slot on reopen', () => {
    const ov = {
      allowedFeats: ['power-attack'],
      addedFeats: [{ featId: bonus.id, level: 1, category: 'general' as FeatCategory }],
    };
    const ch = build('fighter', 3, { keyAbility: 'str', overrides: ov });
    const b = deriveBuildFromCharacter(ch, db);
    expect(b.overrides?.allowedFeats).toEqual(['power-attack']);
    expect(b.overrides?.addedFeats?.[0].featId).toBe(bonus.id);
    // the bonus feat must NOT be reconstructed into a feat-slot pick…
    expect(Object.values(b.featPicks)).not.toContain(bonus.id);
    // …and a rebuild stays idempotent — exactly one copy of the bonus feat.
    const ch2 = buildCharacter(b, db);
    expect(ch2.feats.filter((f) => f.featId === bonus.id).length).toBe(1);
  });

  it('a build with no overrides leaves the character clean (no overrides field)', () => {
    const ch = build('fighter', 1, { keyAbility: 'str' });
    expect(ch.overrides).toBeUndefined();
  });

  it('force-sets ability scores with no limits, and stats follow', () => {
    const base = build('fighter', 1, { keyAbility: 'str' });
    const ch = build('fighter', 1, { keyAbility: 'str', overrides: { attributes: { str: 22, con: 18 } } });
    expect(ch.abilities.str).toBe(22);
    expect(ch.abilities.con).toBe(18);
    // HP follows the overridden Con (con mod jumped, so max HP rose vs baseline)
    expect(ch.hitPoints.current).toBeGreaterThan(base.hitPoints.current);
  });

  it('force-sets proficiency on any track to any rank (incl. lowering and adding)', () => {
    const ch = build('fighter', 1, {
      keyAbility: 'str',
      overrides: { proficiencies: { acrobatics: 'legendary', perception: 'expert', heavy: 'master', will: 'master' } },
    });
    expect(ch.proficiencies.skills.acrobatics).toBe('legendary');
    expect(ch.proficiencies.perception).toBe('expert');
    expect(ch.proficiencies.defenses.heavy).toBe('master');
    expect(ch.proficiencies.saves.will).toBe('master');
  });

  it('adds languages past the slot limit', () => {
    const langId = Object.keys(db.languages)[5];
    const ch = build('fighter', 1, { keyAbility: 'str', overrides: { addedLanguages: [langId] } });
    expect(ch.languages).toContain(langId);
  });

  it('grants any class feature (materialized into grantedFeatures)', () => {
    const feature = Object.values(db.classFeatures)[0];
    const ch = build('fighter', 1, { keyAbility: 'str', overrides: { addedFeatures: [{ featureId: feature.id, level: 1 }] } });
    expect(ch.grantedFeatures?.some((g) => g.featureId === feature.id && g.name === feature.name)).toBe(true);
  });

  it('applyOverrides overlays feat-text edits without mutating the shared db, stable when empty', () => {
    const featId = Object.keys(db.feats)[0];
    const origName = db.feats[featId].name;
    // no content edits → identical reference (memo-safe)
    expect(applyOverrides(db, {})).toBe(db);
    expect(applyOverrides(db, { addedFeats: [] })).toBe(db);
    // with an edit → a new db, the entry changed, the shared base untouched, other fields preserved
    const eff = applyOverrides(db, { contentEdits: { feats: { [featId]: { name: 'EDITED' } } } });
    expect(eff).not.toBe(db);
    expect(eff.feats[featId].name).toBe('EDITED');
    expect(db.feats[featId].name).toBe(origName);
    expect(eff.feats[featId].description).toBe(db.feats[featId].description);
  });
});
