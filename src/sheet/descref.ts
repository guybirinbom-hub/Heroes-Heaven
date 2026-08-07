import type { ContentDatabase, DescRef } from '../rules/types';

/** A node in the description-navigation stack: a title + its (linkable) description. */
export interface DescNode {
  title: string;
  description: string;
  descRefs?: DescRef[];
  /** The content-map name this node resolves against ('feats'/'spells'/…). Carried into the pin
   *  identity to disambiguate cross-map name collisions (a feat + a spell sharing a name). */
  key?: string;
  /** The record's slug id — lets the popup render its ast (new pipeline) instead of the markdown. */
  slug?: string;
}

/** Same slug rule as the importer, so a ref label resolves to its content id. */
function slugify(s: string): string {
  return s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Per-(content,key) lowercase-name → entry index, memoized so repeated lookups are cheap.
const nameIdxCache = new WeakMap<object, Record<string, Map<string, { name: string; description?: string; descRefs?: DescRef[] }>>>();

function nameIndex(content: ContentDatabase, key: string) {
  let perContent = nameIdxCache.get(content);
  if (!perContent) {
    perContent = {};
    nameIdxCache.set(content, perContent);
  }
  if (!perContent[key]) {
    const idx = new Map<string, { name: string; description?: string; descRefs?: DescRef[] }>();
    const map = (content as unknown as Record<string, Record<string, { name: string }>>)[key];
    if (map) for (const e of Object.values(map)) if (e?.name) idx.set(e.name.toLowerCase(), e as never);
    perContent[key] = idx;
  }
  return perContent[key];
}

/** Resolve a description cross-reference to the node it points at, or null if not found.
 *  Handles valued labels ("Frightened 2" → frightened) and parentheticals. */
export function lookupRef(content: ContentDatabase, ref: DescRef): DescNode | null {
  const map = (content as unknown as Record<string, Record<string, { name: string; description?: string; descRefs?: DescRef[] }>>)[ref.key];
  if (!map) return null;
  const raw = ref.label.trim();
  const base = raw
    .replace(/\s*\(.*\)\s*$/, '') // drop a trailing "(...)"
    .replace(/\s+\d+$/, '') // drop a trailing condition value ("Frightened 2")
    .trim();
  /*
   * …and the INFLECTED forms, which is what the remaining misses actually are. A description says
   * "when Escaping", "if the target Requests", "you gain Concealment" — the records are Escape,
   * Request and the concealed condition. 507 refs failed to resolve across 301 distinct labels, and
   * this shape dominates them: a plural, a gerund, or the noun form of a condition's adjective.
   *
   * Candidates are tried in order, so an exact match always beats a de-inflected guess.
   */
  const forms = (s: string): string[] => {
    const out: string[] = [];
    if (/ies$/i.test(s)) out.push(s.replace(/ies$/i, 'y'));
    if (/(ches|shes|sses|xes)$/i.test(s)) out.push(s.replace(/es$/i, ''));
    if (/s$/i.test(s) && !/ss$/i.test(s)) out.push(s.replace(/s$/i, ''));
    if (/ing$/i.test(s)) {
      out.push(s.replace(/ing$/i, ''), s.replace(/ing$/i, 'e'));
      // "Grabbing" → "Grab": a doubled consonant before the suffix.
      if (/(\w)\1ing$/i.test(s)) out.push(s.replace(/(\w)\1ing$/i, '$1'));
    }
    if (/ed$/i.test(s)) out.push(s.replace(/ed$/i, ''), s.replace(/ed$/i, 'e'));
    // A condition named as a noun: "Concealment" → concealed, "Invisibility" → invisible.
    if (/ment$/i.test(s)) out.push(s.replace(/ment$/i, 'ed'));
    if (/ility$/i.test(s)) out.push(s.replace(/ility$/i, 'ible'));
    if (/ability$/i.test(s)) out.push(s.replace(/ability$/i, 'able'));
    // Multi-word labels inflect their FIRST word: "Avoiding Notice" → Avoid Notice, "Sustain the
    // Spell" → Sustain a Spell. Articles and possessives are dropped ("Treat your Wounds").
    const words = s.split(/\s+/);
    if (words.length > 1) {
      const trimmed = words.filter((w, i) => i === 0 || !/^(the|a|an|your|his|her|their|its)$/i.test(w));
      if (trimmed.length !== words.length) out.push(trimmed.join(' '));
      for (const head of forms(words[0])) out.push([head, ...words.slice(1)].join(' '));
      const noArticles = trimmed.slice();
      for (const head of forms(noArticles[0])) out.push([head, ...noArticles.slice(1)].join(' '));
    }
    // An item GRADE leads the printed name and trails the id: "Greater Vitalizing" is vitalizing-greater.
    const grade = /^(greater|lesser|major|true|minor|moderate)\s+(.+)$/i.exec(s);
    if (grade) out.push(`${grade[2]} (${grade[1]})`, `${grade[2]} ${grade[1]}`);
    // The article is SUBSTITUTED, not dropped: the actions are "Cast a Spell" and "Sustain a Spell",
    // and descriptions write "Cast the Spell". Both directions, since either can be the printed form.
    if (/\bthe\b/i.test(s)) out.push(s.replace(/\bthe\b/i, 'a'), s.replace(/\bthe\b/i, 'an'));
    if (/\ba\b/i.test(s)) out.push(s.replace(/\ba\b/i, 'the'));
    // A plural on the LAST word of a multi-word action: "Pick Locks" → Pick a Lock, "Disable
    // Devices" → Disable a Device.
    if (words.length > 1 && /s$/i.test(words[words.length - 1]) && !/ss$/i.test(words[words.length - 1])) {
      const sing = [...words.slice(0, -1), words[words.length - 1].replace(/s$/i, '')];
      out.push(sing.join(' '), [sing[0], 'a', ...sing.slice(1)].join(' '));
    }
    // A QUALIFIED condition: "Persistent Bleed Damage" and "Persistent Acid or Persistent Fire
    // Damage" are both the persistent damage condition.
    const persistent = /^persistent\b.*\bdamage$/i.exec(s);
    if (persistent) out.push('Persistent Damage');
    return out;
  };
  const cands = [...new Set([raw, ...(base && base !== raw ? [base] : []), ...forms(base || raw)])].filter(Boolean);
  for (const cand of cands) {
    const e = map[slugify(cand)];
    if (e) return toNode(e, ref.key);
  }
  const idx = nameIndex(content, ref.key);
  for (const cand of cands) {
    const e = idx.get(cand.toLowerCase());
    if (e) return toNode(e, ref.key);
  }
  return null;
}

function toNode(e: { id?: string; name: string; description?: string; descRefs?: DescRef[] }, key?: string): DescNode {
  return { title: e.name, description: e.description ?? '', descRefs: e.descRefs, key, slug: e.id };
}
