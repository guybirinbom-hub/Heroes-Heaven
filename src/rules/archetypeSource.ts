import type { Character, ContentDatabase, Feat } from './types';
import { belongsToArchetype } from './derive';

/**
 * WHICH ARCHETYPE a row on the sheet comes from, by the archetype's printed name.
 *
 * Bug 2026-11-08 (owner): *"feats granted from archytype apearing in class features … we need to have a
 * diffrent filter for each archytype"*. A Fighter who took Bastion Dedication was handed Reactive Shield
 * (`grantedBy: 'bastion-dedication'`), and because Reactive Shield is itself a CLASS feat the Feats &
 * Features page listed it under "Class", as if the fighter had picked it. The same happened to every
 * feat an archetype grants (Dual-Weapon Warrior → Double Slice, Duelist → Quick Draw, Gladiator →
 * Additional Lore …) and to the class features a class archetype substitutes in (Warrior of Legend).
 *
 * The answer comes from three places, in this order:
 *  1. the record itself — a dedication, or a feat that BELONGS to an archetype (`belongsToArchetype`:
 *     the `archetype` slug plus the archetype/dedication/mythic trait; a hellknight-stamped plain class
 *     feat is not one). 198 archetype feats carry no slug at all (Advanced Bow Training, Expert
 *     Herbalism, the Knight Vigilant feats), so their prerequisites are read: "Archer Dedication" names
 *     the archetype outright, and "Expert Necromancer Spellcasting" names a feat whose answer is used;
 *  2. the record that GRANTED it (`grantedBy`), followed back as far as the chain goes, so a feat granted
 *     by a feat an archetype granted still lands under that archetype;
 *  3. a CLASS ARCHETYPE's substituted class feature (`classArchetype.addFeatures`), owned by the
 *     dedication that added it.
 *
 * Undefined = no archetype is involved, and the row keeps its own type (class, skill, general …).
 */
export interface ArchetypeSource {
  /** The archetype a feat row comes from: `featId` taken, `grantedBy` the record that handed it over. */
  ofFeat(featId: string, grantedBy?: string): string | undefined;
  /** The archetype a class-feature row comes from (a class archetype's substituted feature). */
  ofFeature(featureId: string): string | undefined;
}

const nameCache = new WeakMap<ContentDatabase, { bySlug: Map<string, string>; byName: Map<string, Feat> }>();
function indexOf(content: ContentDatabase) {
  let idx = nameCache.get(content);
  if (idx) return idx;
  const bySlug = new Map<string, string>();
  const byName = new Map<string, Feat>();
  for (const f of Object.values(content.feats)) {
    if (f.archetype && f.traits.includes('dedication') && !bySlug.has(f.archetype)) bySlug.set(f.archetype, dedicationName(f));
    const k = f.name.trim().toLowerCase();
    if (!byName.has(k)) byName.set(k, f);
  }
  idx = { bySlug, byName };
  nameCache.set(content, idx);
  return idx;
}

/** "Bastion Dedication" → "Bastion". */
const dedicationName = (f: { name: string }): string => f.name.replace(/\s+Dedication$/i, '').trim();

/**
 * An archetype's printed name from its slug: the archetype record's own name (core.json `archetype`),
 * else its dedication's name, else the slug read as words. The archetype record comes first because a
 * slug can be shared by a legacy and a remaster dedication: `bellflower-tiller` is carried by the
 * Bellflower Tiller feats, and the first dedication stamped with it is the legacy "Bellflower
 * Dedication", so naming by dedication split one archetype into "Bellflower" and "Bellflower Tiller".
 */
export function archetypeName(slug: string, content: ContentDatabase): string {
  const own = (content as unknown as { archetype?: Record<string, { name?: string } | undefined> }).archetype?.[slug]?.name;
  return (
    own ??
    indexOf(content).bySlug.get(slug) ??
    slug
      .split('-')
      .filter(Boolean)
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join(' ')
  );
}

export function archetypeSourceOf(character: Character, content: ContentDatabase): ArchetypeSource {
  const { byName } = indexOf(content);
  // The archetypes this character holds a dedication for, so a feat open to two archetypes ("Archer
  // Dedication or Ranger Dedication") lands under the one the character actually took.
  const held = new Set<string>();
  const heldSlugs = new Set<string>();
  for (const fc of character.feats) {
    const rec = content.feats[fc.featId];
    if (rec?.traits.includes('dedication')) held.add(rec.archetype ? archetypeName(rec.archetype, content) : dedicationName(rec));
    if (rec?.traits.includes('dedication') && rec.archetype) heldSlugs.add(rec.archetype);
  }
  // The classes the character holds: a class feat of NEITHER that an archetype it holds lists (a rogue's
  // Reflexive Shield, open to the Bastion archetype) can only have come through that archetype.
  const heldClassIds = [character.classId, character.variantRules?.dualClass ? character.classId2 : undefined].filter((x): x is string => !!x);
  // A class archetype's substituted features → the archetype whose dedication added them.
  const addedBy = new Map<string, string>();
  for (const fc of character.feats) {
    const rec = content.feats[fc.featId];
    for (const af of rec?.classArchetype?.addFeatures ?? []) {
      if (!addedBy.has(af.featureId)) addedBy.set(af.featureId, rec!.archetype ? archetypeName(rec!.archetype, content) : dedicationName(rec!));
    }
  }

  const ownMemo = new Map<string, string | undefined>();
  /** The archetype a FEAT RECORD belongs to, ignoring who granted it. */
  const own = (rec: Feat | undefined, depth = 0): string | undefined => {
    if (!rec) return undefined;
    if (ownMemo.has(rec.id)) return ownMemo.get(rec.id);
    ownMemo.set(rec.id, undefined); // cycle guard
    let out: string | undefined;
    const prereqs = (rec.prerequisites ?? []).flatMap((p) => p.split(/;|,|\bor\b/i)).map((p) => p.trim()).filter(Boolean);
    const named = prereqs.flatMap((p) => {
      const m = p.match(/^(.+?)\s+Dedication$/i);
      return m ? [m[1].trim()] : [];
    });
    // A feat open to several archetypes ("Druid Dedication or Wizard Dedication": Cunning Trickster Mask,
    // stamped `wizard`) goes under the one this character HOLDS, before its slug is asked — or a druid
    // got a "Wizard" section for an archetype they never took (checker finding, 2026-11-08).
    const heldName = named.map((n) => [...held].find((h) => h.toLowerCase() === n.toLowerCase())).find(Boolean);
    const isArchetypeFeat = belongsToArchetype(rec) || rec.traits.includes('archetype');
    // A dedication names its own archetype — through its slug when it has one, the same name `held` uses.
    if (rec.traits.includes('dedication') && rec.archetype && belongsToArchetype(rec)) out = archetypeName(rec.archetype, content);
    else if (rec.traits.includes('dedication') && !rec.traits.includes('mythic')) out = dedicationName(rec);
    else if (heldName && isArchetypeFeat) out = heldName;
    else if (rec.archetype && belongsToArchetype(rec)) out = archetypeName(rec.archetype, content);
    else if (rec.archetype && rec.category === 'class' && heldSlugs.has(rec.archetype) && heldClassIds.length && !heldClassIds.some((id) => rec.traits.includes(id)))
      out = heldName ?? archetypeName(rec.archetype, content);
    else if (rec.traits.includes('archetype') && depth < 6) {
      out = named[0];
      if (!out) {
        // "Expert Necromancer Spellcasting": a feat of the same archetype; use its answer.
        for (const p of prereqs) {
          const viaFeat = own(byName.get(p.toLowerCase().replace(/\s*\(.*\)$/, '')), depth + 1);
          if (viaFeat) {
            out = viaFeat;
            break;
          }
        }
      }
    }
    ownMemo.set(rec.id, out);
    return out;
  };

  const ofFeat = (featId: string, grantedBy?: string, seen: Set<string> = new Set()): string | undefined => {
    const mine = own(content.feats[featId]);
    if (mine || !grantedBy || seen.has(grantedBy)) return mine;
    seen.add(grantedBy);
    if (addedBy.has(grantedBy)) return addedBy.get(grantedBy);
    const granter = content.feats[grantedBy];
    if (!granter) return undefined;
    // The granter's own row on this character, so its own `grantedBy` can be followed further back.
    const row = character.feats.find((f) => f.featId === grantedBy);
    return ofFeat(grantedBy, row?.grantedBy, seen);
  };

  return {
    ofFeat: (featId, grantedBy) => ofFeat(featId, grantedBy),
    ofFeature: (featureId) => addedBy.get(featureId),
  };
}
