/*
 * Shared class-feature descriptions.
 *
 * Several class features are ONE shared Foundry item used by many classes (Reflex Expertise,
 * Weapon Expertise, Iron Will, the spellcaster-expertise line, …). Their description carries a
 * generic paragraph plus class-SPECIFIC addendum paragraphs, each led by a bold class name —
 * e.g. Reflex Expertise has "**Guardian** Even in the heaviest of armors…". Because the feature
 * is shared, a bard would otherwise see the Guardian note too.
 *
 * `classFeatureDescription` strips addendum paragraphs that name a DIFFERENT class than the one
 * viewing the feature. A paragraph led by bold text that ISN'T a class name (e.g. a degree-of-
 * success row like "**Critical Success**") is always kept.
 */
import type { ContentDatabase } from './types';

export function classFeatureDescription(
  desc: string | undefined,
  viewingClassId: string | null | undefined,
  content: ContentDatabase,
): string {
  if (!desc) return desc ?? '';
  const keep = viewingClassId ? content.classes[viewingClassId]?.name.toLowerCase() : undefined;
  const otherClassNames = new Set(
    Object.values(content.classes)
      .map((c) => c.name.toLowerCase())
      .filter((n) => n !== keep),
  );
  const paras = desc.split(/\n{2,}/);
  const kept = paras.filter((p) => {
    const lead = p.match(/^\*\*([^*]+)\*\*/);
    return !lead || !otherClassNames.has(lead[1].trim().toLowerCase());
  });
  return kept.length === paras.length ? desc : kept.join('\n\n');
}
