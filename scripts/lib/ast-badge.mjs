/*
 * AoN's page badge, read out of a display tree.
 *
 * Every AoN page title carries a `right=` attribute naming what the page IS: "Rogue Racket",
 * "Alchemist Research Field", "Class Sample Build", "Item 0+", "Creature 10", "Background". It is the
 * sharpest available signal for "is this record showing the right kind of document", sharper than
 * category compatibility — `classFeatures` legitimately points into ~40 categories, so the category
 * table has to be permissive, and being permissive is what let twenty subclass options render pregen
 * build guides unnoticed.
 *
 * Lives in a lib because two scripts need it: the check that fails the build and the fixer that repairs
 * it. Importing it from the check script would run that script's body as a side effect.
 */

/** The `right=` badge on a tree's page title, or null. */
export function badgeOf(node) {
  let found = null;
  (function walk(n) {
    if (found || !n || typeof n !== 'object') return;
    if (n.t === 'title' && n.right) { found = String(n.right).trim(); return; }
    for (const c of n.c || []) walk(c);
  })(node);
  return found;
}

/**
 * Badges that are never a class feature, matched on the leading word so "Item 0+", "Creature 10" and
 * "Archetype 2" all match.
 *
 * ⚠ `Action` IS included, but on its own it means nothing — a class feature that grants a reaction is
 * legitimately documented on an Action page (Glimpse of Redemption, Liberating Step, Quick Alchemy,
 * Exploit Vulnerability), and flagging every one reported ~100 correct records as broken. What makes it
 * actionable is the SECOND condition the callers apply: a foreign badge is only a defect when another
 * bucket already ships a page for the same slug that looks like class content. Dropping `Action` from
 * this list instead of relying on that filter missed `classFeatures/battle`, an oracle mystery that was
 * rendering a Kingmaker ARMY action ("Battle — Kingmaker Adventure Path pg. 579").
 */
export const FOREIGN_TO_CLASS_FEATURE = [
  /^class sample build/i,
  /^item\b/i,
  /^background\b/i,
  /^creature\b/i,          // "Creature 10" and "Creature Family"
  /^archetype\b/i,
  /^action\b/i,
  /^ritual\b/i,
  /^domain\b/i,
  /^trait\b/i,
  /^spell\b/i,
  /^hazard\b/i,
  /^equipment\b/i,
  /^relic\b/i,
];

export const isForeignToClassFeature = (badge) =>
  !!badge && FOREIGN_TO_CLASS_FEATURE.some((re) => re.test(badge));

/**
 * The name a class gives a choice group -> the core.json bucket holding those pages.
 * Every key appears as a `subclass.name` or an `extraChoices[].name` in public/core.json.
 */
export const GROUP_BUCKET = {
  'research field': 'researchField', racket: 'racket', style: 'style', practice: 'practice',
  muse: 'muse', mystery: 'mystery', implements: 'implement', implement: 'implement',
  instinct: 'instinct', patron: 'patron', 'patron theme': 'patron', eidolon: 'eidolon',
  bloodline: 'bloodline', doctrine: 'doctrine', "hunter's edge": 'huntersEdge',
  'hunter’s edge': 'huntersEdge', methodology: 'methodology', cause: 'cause', lesson: 'lesson',
  'conscious mind': 'consciousMind', 'subconscious mind': 'subconsciousMind',
  order: 'druidicOrder', 'druidic order': 'druidicOrder', way: 'way', innovation: 'innovation',
  'hybrid study': 'hybridStudy',
};

/**
 * featureId -> the choice group that offers it, read off the class records.
 *
 * This is the SECOND condition both the check and the fixer apply, and they must apply the SAME one.
 * When the check merely asked "does any other bucket ship this slug", it reported six records the
 * fixer would never touch — a check that flags what the fixer declines just teaches people to ignore it.
 */
export function offeredBy(core) {
  const map = new Map();
  const add = (id, groupName, cls) => {
    if (!id || map.has(id)) return;
    map.set(id, { group: String(groupName ?? '').trim(), cls });
  };
  for (const [cid, cls] of Object.entries(core.classes ?? {})) {
    const sc = cls.subclass;
    if (sc) for (const o of sc.options ?? []) add(o?.id ?? o?.featureId ?? o, sc.name ?? sc.id, cid);
    for (const ec of cls.extraChoices ?? []) for (const o of ec.options ?? []) add(o?.id ?? o?.featureId ?? o, ec.name ?? ec.id, cid);
  }
  return map;
}
