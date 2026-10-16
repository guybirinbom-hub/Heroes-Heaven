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

/** A markdown divider paragraph ("---", "***", "___"): Armor Mastery separates its class paragraphs so. */
const isDivider = (p: string) => /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(p);

/**
 * Package M (2026-10-16): the per-class cut leaves the dividers that stood between OTHER classes'
 * paragraphs — Armor Mastery's fighter text started with two, the barbarian's ended with two, the
 * champion's had one each side. A divider that ends up first, last or beside another divider divides
 * nothing and is dropped; one between two kept paragraphs stays.
 */
function withoutStrayDividers(paras: string[]): string[] {
  const out: string[] = [];
  for (const p of paras) {
    if (isDivider(p) && (out.length === 0 || isDivider(out[out.length - 1]))) continue;
    out.push(p);
  }
  while (out.length && isDivider(out[out.length - 1])) out.pop();
  return out;
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
  const kept = withoutStrayDividers(paras.filter((p) => {
    const lead = p.match(/^\s*\*\*([^*]+)\*\*/);
    const named = lead ? leadClasses(lead[1], classNames) : null;
    return !named || (!!keep && named.includes(keep));
  }));
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
 *  just another class's — so it names the class. Player words only (the owner, 2026-10-08: no "import").
 *  Per-class pages come with the data rebuild (card step R). */
export const SHARED_FEATURE_FOOTER = 'Not from the Archives — our text for your class';

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
 *
 * Package M (2026-10-16): "this page is another class's" is decided from the page's header and the class
 * list ALONE. The descriptions ship in a second file that loads after core.json and is not awaited
 * (src/data/index.ts loadDescriptions), and this used to answer null whenever the text was not there
 * yet, so for that beat — or for good, when the file failed — a swashbuckler's card drew the
 * Thaumaturge's page. Now a page that is another class's answers '' until the text arrives: the card
 * draws its no-page lane (empty, loading), never the other class's page.
 */
export function sharedFeatureFallback(
  featureId: string,
  viewingClassId: string | null | undefined,
  pageText: string | undefined,
  content: ContentDatabase,
): string | null {
  const rec = content.classFeatures?.[featureId];
  const viewer = viewingClassId ? content.classes[viewingClassId] : undefined;
  if (!viewer || !rec) return null;
  const raw = rec.description;
  if (pageText === undefined) {
    return raw !== undefined && isSharedClassFeature(raw, content) ? classFeatureDescription(raw, viewingClassId, content) : null;
  }
  const pageClass = pageClassName(pageText, Object.values(content.classes).map((c) => c.name));
  const listed = (viewer.features ?? []).some((f) => f.featureId === featureId);
  if (!listed || !pageClass || pageClass === viewer.name) return null;
  return raw === undefined ? '' : classFeatureDescription(raw, viewingClassId, content);
}

/** A class feature's name without its trailing "(Class)" qualifier, lowercased: "Weapon Expertise
 *  (Swashbuckler)" and the magus's "Weapon Expertise" share the base name of the shared record. */
export function featureBaseName(name: string | undefined): string {
  return String(name ?? '').replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
}

/** A record that is a later step of a line — "Greater Weapon Specialization", "Greater Mysterious Resolve",
 *  "Legendary Overdrive", "Second Doctrine" — is never a class's own printing of the line's base feature. */
const STEP_PREFIX = /^(?:greater|major|lesser|improved|legendary|master|masterful|expert|incredible|true|double|first|second|third|fourth|fifth|final)\b/;

/**
 * Package M (2026-10-16): the record a class's link opens. A class page's advancement table links "weapon
 * expertise" to the SHARED record (classFeatures:weapon-expertise, whose page is the Thaumaturge's) even
 * where the class lists a record of its own for it. The link opens what the class's own Feats-tab row
 * opens, found in two passes over the records the class lists (never when it lists the linked record):
 *   1. the one record of the same base name: the magus's weapon-expertise-magus, the summoner's
 *      signature-spells-summoner, the swashbuckler's weapon-expertise-swashbuckler (35 class-page links,
 *      measured 2026-10-16). Several of that name: ambiguous, the linked record.
 *   2. else the class-qualified records whose base name ENDS with the linked one, a later step of a line
 *      ("Greater …", STEP_PREFIX) left out: the swashbuckler's, champion's and investigator's "weapon mastery"
 *      opens their Martial Weapon Mastery, the psychic's "weapon specialization" its Psychic Weapon
 *      Specialization, a heading's "Armor Expertise" the class's Light / Medium / Burnished Armor Expertise,
 *      the oracle's "Resolve" its Mysterious Resolve. Of several, the one the class gains first, when one is
 *      first — a class's own line starts at its first record: the swashbuckler's "Evasion" (in the "Confident
 *      Evasion" heading) opens Confident Evasion (7th), not Assured Evasion (13th). (50 more class-page
 *      links, measured 2026-10-16.)
 * A class that lists the linked record itself, none of these, or no class at all: the linked record.
 */
export function classOwnFeatureId(featureId: string, classId: string | null | undefined, content: ContentDatabase): string {
  const cls = classId ? content.classes[classId] : undefined;
  const rec = content.classFeatures?.[featureId];
  if (!cls || !rec) return featureId;
  const firstLevel = new Map<string, number>();
  for (const f of cls.features ?? []) firstLevel.set(f.featureId, Math.min(firstLevel.get(f.featureId) ?? Infinity, f.level ?? Infinity));
  if (firstLevel.has(featureId)) return featureId;
  const base = featureBaseName(rec.name);
  if (!base) return featureId;
  const nameOf = (id: string) => (content.classFeatures?.[id] ? featureBaseName(content.classFeatures[id].name) : '');
  const listed = [...firstLevel.keys()].filter((id) => id !== featureId);
  const same = listed.filter((id) => nameOf(id) === base);
  if (same.length) return same.length === 1 ? same[0] : featureId;
  const tail = listed.filter((id) => { const n = nameOf(id); return n.endsWith(` ${base}`) && !STEP_PREFIX.test(n); });
  if (tail.length <= 1) return tail[0] ?? featureId;
  const lo = Math.min(...tail.map((id) => firstLevel.get(id) ?? Infinity));
  const first = tail.filter((id) => firstLevel.get(id) === lo);
  return first.length === 1 ? first[0] : featureId;
}

/**
 * Package M (2026-10-16): the Source line under a shared feature's class paragraph. The shared record's
 * own book is whichever printing the merged text came from ("Pathfinder Dark Archive (Remastered)", the
 * Thaumaturge's, under the swashbuckler's Player Core 2 paragraph), so it is never printed there. The
 * viewing class's own book is — the class paragraph is that class's printing — when the class record
 * names one; otherwise no Source line at all. No page number: the class record's page is its class page.
 */
export function sharedFeatureBook(viewingClassId: string | null | undefined, content: ContentDatabase): string | undefined {
  const src = viewingClassId ? content.classes[viewingClassId]?.source : undefined;
  const book = typeof src?.book === 'string' ? src.book.trim() : '';
  return book && src?.license !== 'homebrew' ? book : undefined;
}
