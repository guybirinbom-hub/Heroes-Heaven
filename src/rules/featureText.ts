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
 *
 * Card step 12 (docs/card-design.md section 5, the classFeatureDescription row): a lead may name
 * SEVERAL classes — "**Witch, Wizard**", "**Champion, Exemplar, Investigator, Magus**" (Weapon
 * Expertise). Such a lead used to match no single class name, so it was kept for every class: a
 * wizard 11 read the champion's "martial weapons". A lead whose every comma- (or "and"-) separated
 * name is a class is an addendum for exactly those classes.
 */
import type { ContentDatabase } from './types';

/** The classes a bold paragraph lead names, or null when the lead is not (only) class names. */
function leadClasses(lead: string, classNames: ReadonlySet<string>): string[] | null {
  const names = lead.split(/\s*,\s*|\s+and\s+/i).map((n) => n.trim().toLowerCase()).filter(Boolean);
  return names.length > 0 && names.every((n) => classNames.has(n)) ? names : null;
}

export function classFeatureDescription(
  desc: string | undefined,
  viewingClassId: string | null | undefined,
  content: ContentDatabase,
): string {
  if (!desc) return desc ?? '';
  const keep = viewingClassId ? content.classes[viewingClassId]?.name.toLowerCase() : undefined;
  const classNames = new Set(Object.values(content.classes).map((c) => c.name.toLowerCase()));
  const paras = desc.split(/\n{2,}/);
  const kept = paras.filter((p) => {
    const lead = p.match(/^\s*\*\*([^*]+)\*\*/);
    const named = lead ? leadClasses(lead[1], classNames) : null;
    return !named || (!!keep && named.includes(keep));
  });
  return kept.length === paras.length ? desc : kept.join('\n\n');
}

/** A class feature whose text carries addenda for two or more classes (Weapon Expertise's "**Witch,
 *  Wizard**" and "**Druid, Kineticist**" …). Not the whole set of shared features: Reflex Expertise
 *  carries one addendum (Guardian) and Weapon Specialization none — sharedFeatureFallback below finds
 *  those by their page's class instead. */
export function isSharedClassFeature(desc: string | undefined, content: ContentDatabase): boolean {
  if (!desc) return false;
  const classNames = new Set(Object.values(content.classes).map((c) => c.name.toLowerCase()));
  const named = new Set<string>();
  for (const p of desc.split(/\n{2,}/)) {
    const lead = p.match(/^\s*\*\*([^*]+)\*\*/);
    for (const n of (lead ? leadClasses(lead[1], classNames) : null) ?? []) named.add(n);
  }
  return named.size >= 2;
}

/** The mine card's footer for a shared feature drawn from our older text (section 7): a page exists,
 *  just another class's — so it does not say "No Archives page" alone. Per-class pages come with the
 *  data rebuild (card step R). */
export const SHARED_FEATURE_FOOTER = 'No Archives page for your class — text from our older import';

/** The class a shared feature's page belongs to: the Archives prints "Class <Name>" in the page header
 *  (the same reading as the card guard's pageClassName, scripts/lib/card-scope.mjs). */
export function pageClassName(pageText: string, classNames: string[]): string | undefined {
  const m = pageText.replace(/\s+/g, ' ').match(/pg\. ?\d+\s*Class ((?:[A-Z][a-z]+)(?: [A-Z][a-z]+)?)/);
  return m ? classNames.find((c) => m[1].startsWith(c)) : undefined;
}

/**
 * Card step 12 (section 7, "Shared class features"): what a 'mine' card draws for a class feature the
 * viewer's class shares — our older text cut to the viewer's class paragraph (classFeatureDescription), or
 * null when the card should draw the record's page as usual. Two cases, the first the card guard's
 * CLASS_MISMATCH rule exactly (scripts/lib/card-scope.mjs: the viewer's class lists the feature and the
 * page's "Class <Name>" header names another class):
 *   - the feature has a page, the viewer's class lists it, and the page is another class's (Weapon
 *     Specialization's page is the Thaumaturge's, Reflex Expertise's the Guardian's);
 *   - the feature has no page and its text carries addenda for two or more classes (isSharedClassFeature).
 * `pageText` is the page's text (undefined when the record has no page).
 */
export function sharedFeatureFallback(
  featureId: string,
  viewingClassId: string | null | undefined,
  pageText: string | undefined,
  content: ContentDatabase,
): string | null {
  const raw = content.classFeatures?.[featureId]?.description;
  const viewer = viewingClassId ? content.classes[viewingClassId] : undefined;
  if (!viewer || raw === undefined) return null;
  if (pageText === undefined) return isSharedClassFeature(raw, content) ? classFeatureDescription(raw, viewingClassId, content) : null;
  const pageClass = pageClassName(pageText, Object.values(content.classes).map((c) => c.name));
  const listed = (viewer.features ?? []).some((f) => f.featureId === featureId);
  return listed && pageClass && pageClass !== viewer.name ? classFeatureDescription(raw, viewingClassId, content) : null;
}
