import { describe, it, expect } from 'vitest';
import { content, build } from './_content';
import { buildCharacter, deriveBuildFromCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { bonusSkillFeatCount, bonusSkillFeatKey, FEAT_GRANTS } from '../src/rules/featGrants';
import type { Character, ContentDatabase } from '../src/rules/types';

/*
 * Batch 032, WG-comparison lane — the GAP-ENGINE half (the engine family's own CROSS-FILE GAPS and
 * DATA STILL NEEDED lines, closed here).
 *
 * The two lane-sibling findings need data rows the driver applies from
 * work/.b032-rows-gap-engine.json, so those tests build against a content copy with the field PATCHED
 * IN MEMORY — never a patched-vs-shipped delta, which would flip meaning once the row lands. The
 * magical-knowledge half is pure code (featGrants.ts + featGrantsLane.ts + build.ts + Builder.tsx),
 * so it is asserted against the shipped registries directly.
 */

/** A shallow content clone with the feats bucket copied, so a patch cannot leak into the cache. */
function patched(mut: (db: ContentDatabase) => void): ContentDatabase {
  const db = content();
  const clone = { ...db, feats: { ...db.feats } } as ContentDatabase;
  mut(clone);
  return clone;
}

/** `build()` from _content.ts, against a patched database. */
function buildWith(db: ContentDatabase, classId: string, level: number, over: Partial<BuildState> = {}): Character {
  const cls = db.classes[classId];
  return buildCharacter(
    {
      ...emptyBuild(),
      name: 't',
      level,
      classId,
      ancestryId: Object.keys(db.ancestries)[0],
      backgroundId: Object.keys(db.backgrounds)[0],
      keyAbility: (cls && cls.keyAbility.length === 1 ? cls.keyAbility[0] : null) as BuildState['keyAbility'],
      subclassId: (db.classes[classId]?.subclass?.options[0]?.id as string) ?? null,
      ...over,
    },
    db,
  );
}

/** Set the innate grants' traditionFromCasting flag on a feat, the way the spec row does. */
const withTraditionFlag = (featId: string) =>
  patched((db) => {
    const f = db.feats[featId];
    db.feats[featId] = { ...f, innateSpells: (f.innateSpells ?? []).map((g) => ({ ...g, traditionFromCasting: true })) };
  });

/** Set the Intelligence spellcasting profile on a feat, the way the spec row does. */
const withIntProfile = (featId: string) =>
  patched((db) => {
    db.feats[featId] = {
      ...db.feats[featId],
      spellcastingGrant: { tradition: 'arcane', keyAbility: 'int', proficiency: 'trained' },
    };
  });

describe('batch 032 gap-engine — magical-knowledge grants a skill feat for EACH chosen skill', () => {
  // batch 032: magical-knowledge#skill-feats
  it('magical-knowledge: the lane asks for TWO bonus skill feats, not one', () => {
    // "You gain a skill feat associated with each of the skills you chose" — two skills chosen.
    expect(bonusSkillFeatCount(FEAT_GRANTS['magical-knowledge'])).toBe(2);
    // The legacy boolean carrier is unchanged: Rogue Dedication's "You gain a skill feat" is one.
    expect(bonusSkillFeatCount(FEAT_GRANTS['rogue-dedication'])).toBe(1);
  });

  // batch 032: magical-knowledge#skill-feats
  it('magical-knowledge: BOTH picked skill feats reach the built character', () => {
    const ch = build('fighter', 8, {
      keyAbility: 'str',
      featPicks: { '8:class:0': 'magical-knowledge' },
      dedicationSkillFeats: {
        [bonusSkillFeatKey('magical-knowledge', 0)]: 'cat-fall',
        [bonusSkillFeatKey('magical-knowledge', 1)]: 'quick-jump',
      },
    });
    const skill = ch.feats.filter((f) => f.category === 'skill').map((f) => f.featId);
    expect(skill).toContain('cat-fall');
    expect(skill).toContain('quick-jump');
  });

  /* Index 0 keeps the BARE feat-id key, so every character saved before the count existed keeps the
   * answer it had — and a boolean grant still reads exactly that one key. */
  // batch 032: magical-knowledge#skill-feats
  it('magical-knowledge: a BOOLEAN grant (rogue-dedication) still takes only the index-0 key', () => {
    const ch = build('fighter', 2, {
      keyAbility: 'str',
      featPicks: { '2:class:0': 'rogue-dedication' },
      dedicationSkillFeats: { 'rogue-dedication': 'cat-fall', 'rogue-dedication:1': 'quick-jump' },
    });
    const skill = ch.feats.filter((f) => f.category === 'skill').map((f) => f.featId);
    expect(skill).toContain('cat-fall');
    expect(skill).not.toContain('quick-jump');
  });

  /* Round trip: deriveBuildFromCharacter has to hand a same-level skill feat back to a FREE INDEX of
   * the grant, not to the feat id alone, or reopening the builder loses the second pick (and the feat
   * would eat a real skill-feat slot). */
  // batch 032: magical-knowledge#skill-feats
  it('magical-knowledge: both bonus feats are recovered onto their own keys, not one', () => {
    const answers = {
      [bonusSkillFeatKey('magical-knowledge', 0)]: 'cat-fall',
      [bonusSkillFeatKey('magical-knowledge', 1)]: 'quick-jump',
    };
    const ch = build('fighter', 8, { keyAbility: 'str', featPicks: { '8:class:0': 'magical-knowledge' }, dedicationSkillFeats: answers });
    const recovered = deriveBuildFromCharacter(ch, content()).dedicationSkillFeats ?? {};
    expect(new Set(Object.values(recovered))).toEqual(new Set(['cat-fall', 'quick-jump']));
    expect(Object.keys(recovered).sort()).toEqual(['magical-knowledge', 'magical-knowledge:1']);
  });
});

describe('batch 032 gap-engine — the magic-finder lane siblings follow the caster’s own tradition', () => {
  // batch 032 premise: feat-1131 "If you could already cast spells, these spells are of the same tradition."
  it('lore-seeker: a divine cleric reads the granted spells as divine, not arcane', () => {
    const ch = buildWith(withTraditionFlag('lore-seeker'), 'cleric', 8, { featPicks: { '8:class:0': 'lore-seeker' } });
    const innate = ch.spellcasting.find((e) => e.type === 'innate');
    expect(innate?.spellTraditions?.['translate']).toBe('divine');
  });

  // batch 032 premise: feat-1131 "Otherwise, they are arcane spells"
  it('lore-seeker: a fighter (no casting) keeps the printed arcane fallback', () => {
    const ch = buildWith(withTraditionFlag('lore-seeker'), 'fighter', 8, { keyAbility: 'str', featPicks: { '8:class:0': 'lore-seeker' } });
    const innate = ch.spellcasting.find((e) => e.type === 'innate');
    expect(innate?.spellTraditions?.['translate']).toBe('arcane');
  });

  // batch 032 premise: feat-2237 "If you can already cast spells, these spells are of the same tradition."
  it('cautious-delver: a divine cleric reads the granted spells as divine, not arcane', () => {
    const ch = buildWith(withTraditionFlag('cautious-delver'), 'cleric', 10, { featPicks: { '10:class:0': 'cautious-delver' } });
    const innate = ch.spellcasting.find((e) => e.type === 'innate');
    expect(innate?.spellTraditions?.['knock']).toBe('divine');
  });

  // batch 032 premise: feat-2237 "Otherwise, they're arcane spells"
  it('cautious-delver: a fighter (no casting) keeps the printed arcane fallback', () => {
    const ch = buildWith(withTraditionFlag('cautious-delver'), 'fighter', 10, { keyAbility: 'str', featPicks: { '10:class:0': 'cautious-delver' } });
    const innate = ch.spellcasting.find((e) => e.type === 'innate');
    expect(innate?.spellTraditions?.['knock']).toBe('arcane');
  });
});

describe('batch 032 gap-engine — the magic-finder lane siblings key their innate spells off Intelligence', () => {
  // batch 032 premise: feat-1131 "you use Intelligence as your spellcasting ability"
  it('lore-seeker: a non-casting fighter’s innate entry is INT, not the Charisma fallback', () => {
    const ch = buildWith(withIntProfile('lore-seeker'), 'fighter', 8, { keyAbility: 'str', featPicks: { '8:class:0': 'lore-seeker' } });
    expect(ch.spellcasting.find((e) => e.type === 'innate')?.keyAbility).toBe('int');
  });

  // batch 032 premise: feat-2237 "you use Intelligence as your spellcasting ability"
  it('cautious-delver: a non-casting fighter’s innate entry is INT, not the Charisma fallback', () => {
    const ch = buildWith(withIntProfile('cautious-delver'), 'fighter', 10, { keyAbility: 'str', featPicks: { '10:class:0': 'cautious-delver' } });
    expect(ch.spellcasting.find((e) => e.type === 'innate')?.keyAbility).toBe('int');
  });

  /* The other half of the same sentence: "IF YOU COULD ALREADY CAST SPELLS" — the grant must not
   * drag a real caster off their own attribute. */
  // batch 032 premise: feat-1131 "If you could already cast spells, these spells are of the same tradition."
  it('lore-seeker: a wisdom cleric keeps their OWN spellcasting attribute', () => {
    const ch = buildWith(withIntProfile('lore-seeker'), 'cleric', 8, { featPicks: { '8:class:0': 'lore-seeker' } });
    expect(ch.spellcasting.find((e) => e.type === 'innate')?.keyAbility).toBe('wis');
  });
});
