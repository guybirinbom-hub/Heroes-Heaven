/*
 * The three bonus feat pickers' option lists (Tweaks phase 2, WP5 rev 3): the Versatile Human heritage feat, the
 * School of Unified Magical Theory wizard feat, and a dedication's bonus skill feat. Moved here unchanged from
 * their pickers so test/tweaks-p2-slot-sweep.test.ts can hold them to the pre-WP5 lists. Each one's rule is also a
 * spec in featPickGrants.ts (HERITAGE_FEAT_SPEC, UMT_FEAT_SPEC, BONUS_SKILL_FEAT_SPEC), which `pickRefusal` reads
 * for a greyed row's words when "Search every feat" is on; a test holds each spec to its list.
 */
import { listValues } from '../data/index';
import type { ContentDatabase, Feat } from '../rules/types';

/** General or skill feats of 1st level, by name — the Versatile Human heritage feat (shared.tsx). */
export const heritageFeatOptions = (content: ContentDatabase): Feat[] =>
  Object.values(content.feats)
    .filter((f) => f.level <= 1 && (f.category === 'general' || f.category === 'skill'))
    .sort((a, b) => a.name.localeCompare(b.name));

/** Level-1 wizard class feats, by name — the School of Unified Magical Theory bonus feat. */
export const umtFeatOptions = (content: ContentDatabase): Feat[] =>
  listValues(content, content.feats)
    .filter((f) => f.category === 'class' && f.level <= 1 && (f.traits ?? []).includes('wizard'))
    .sort((a, b) => a.name.localeCompare(b.name));

/** Skill feats of every level, level then name — a dedication's bonus skill feat (Rogue Dedication). */
export const bonusSkillFeatOptions = (content: ContentDatabase): Feat[] =>
  listValues(content, content.feats)
    .filter((f) => f.category === 'skill')
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
