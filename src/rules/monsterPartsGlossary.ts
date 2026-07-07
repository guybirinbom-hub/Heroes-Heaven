/*
 * Monster Parts — authored term descriptions for the click-a-term popups.
 *
 * Two kinds of clickable term appear in the Monster-Parts UI (the imbue editor, the item-detail
 * "Applied Monster Parts" readout, and the rules-reference page):
 *
 *   • PATH names  — Magic / Might / Technique / main. Authored here (`MP_PATH_GLOSSARY`), paraphrased
 *     from the ruleset's "three paths" note.
 *   • PROPERTY names — Fire, Sonic, Charisma, … Built FROM THE CATALOG (`mpPropertyDesc`) so the popup
 *     text (requirement + effect + a compact per-path level summary) can never drift from the mechanics.
 *
 * Game terms that already have a description elsewhere in the app (conditions like off-guard / frightened,
 * plus a handful of MP-specific rules terms with no content entry — persistent damage, weakness,
 * resistance, precision, hardness) are linkified inside effect prose by `MpProse`
 * (src/sheet/MpProse.tsx); the MP-specific ones are authored in `MP_TERM_GLOSSARY` below. Conditions and
 * actions are reused straight from the imported content — we never re-author those.
 */
import type { MpProperty, MpPath } from './monsterParts';
import { resolvePath } from './monsterParts';

/** All searchable text of a property (name, requirement, effect, choice, every path name + level entry),
 *  lowercased — so the rules-page search can match effect and path text, not just the property name. */
export function propertyHaystack(p: MpProperty): string {
  const bits = [p.name, p.requirement, p.effect, p.choicePrompt ?? '', ...(p.choiceOptions ?? [])];
  for (const path of p.paths) {
    bits.push(path.name, path.note ?? '');
    for (const lv of path.levels) bits.push(lv.text);
  }
  return bits.join(' ').toLowerCase();
}

/** Whether a property matches a free-text query across its name + effect + path/level text. Empty
 *  (or whitespace-only) query matches everything. */
export function propertyMatchesQuery(p: MpProperty, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return propertyHaystack(p).includes(q);
}

/** Concise descriptions of the three weapon-imbuement paths (plus 'main' for single-path properties). */
export const MP_PATH_GLOSSARY: Record<string, { title: string; description: string }> = {
  magic: {
    title: 'Magic path',
    description:
      'The **thematic spell-granting** path. As an imbued property levels up, the item lets you Cast a Spell fitting its theme (cantrips at will, higher-rank spells once per day). The item gains a command + Interact activation matching the spell; its DC is based on the item level and its spell attack modifier is that DC − 10. You pick the tradition (e.g. arcane or primal) the first time the property is imbued on this path.',
  },
  might: {
    title: 'Might path',
    description:
      'The **direct-damage** path. Each Strike with the weapon deals extra damage of the property\'s energy type, scaling from a flat +1 up through dice as the property\'s level rises. Higher levels often add on-critical riders and, near the top, let the damage ignore resistances or impose a brief weakness.',
  },
  technique: {
    title: 'Technique path',
    description:
      'The **special / ongoing-effect** path. Its hallmark is persistent damage and other lingering or situational effects (conditions on a hit, damage over time), rather than the raw per-hit bonus of the Might path.',
  },
  main: {
    title: 'Effect',
    description:
      'This property has a single effect track (no Magic / Might / Technique choice). Its benefits are cumulative as the property levels up.',
  },
};

/** MP-specific rules terms that have no imported content entry but appear in effect prose. Conditions
 *  (off-guard, frightened, enfeebled, stupefied, …) and named actions are NOT listed here — those are
 *  linkified from the imported content instead, so their descriptions never drift. */
export const MP_TERM_GLOSSARY: Record<string, { title: string; description: string }> = {
  'persistent damage': {
    title: 'Persistent damage',
    description:
      'Damage that continues each round. At the end of each of the affected creature\'s turns it takes the listed persistent damage, then attempts a DC 15 flat check to end the effect (a helpful action or environmental factor can lower that DC).',
  },
  weakness: {
    title: 'Weakness',
    description:
      'A vulnerability to a damage type or category. When a creature with weakness N takes at least 1 damage of that type, it takes N additional damage of that type.',
  },
  resistance: {
    title: 'Resistance',
    description:
      'A defense against a damage type or category. Resistance N reduces the damage of that type the creature takes by N (to a minimum of 0). Damage that "ignores resistances" is not reduced this way.',
  },
  resistances: {
    title: 'Resistance',
    description:
      'A defense against a damage type or category. Resistance N reduces the damage of that type the creature takes by N (to a minimum of 0). Damage that "ignores resistances" is not reduced this way.',
  },
  precision: {
    title: 'Precision damage',
    description:
      'Extra damage from striking a vulnerable spot. Precision damage is the same type as the triggering attack and is added to its total; a creature resistant or immune to that damage type resists or ignores the precision portion too.',
  },
  hardness: {
    title: 'Hardness',
    description:
      'An object\'s (or shield\'s) toughness. When it would take damage, subtract its Hardness from the amount first; only the remainder reduces its Hit Points. Damage dealt "before Hardness" bypasses this subtraction.',
  },
};

/** Look up a path description by path id (magic/might/technique/main). */
export function mpPathDesc(pathId: string): { title: string; description: string } | undefined {
  return MP_PATH_GLOSSARY[pathId] ?? MP_PATH_GLOSSARY.main;
}

/** Look up an authored MP-term description by its lowercased term text. */
export function mpTermDesc(term: string): { title: string; description: string } | undefined {
  return MP_TERM_GLOSSARY[term.trim().toLowerCase()];
}

/** All MP-specific glossary term labels (for building the linkify regex), longest-first. */
export const MP_TERM_LABELS: string[] = Object.keys(MP_TERM_GLOSSARY).sort((a, b) => b.length - a.length);

/** A compact one-line-per-path level summary for a property, sourced from the catalog so it can't drift.
 *  Each path lists its level entries (level: text), giving the popup a full-but-scannable ladder. */
function pathSummary(path: MpPath): string {
  const riders = resolvePath(path, 20).riders;
  const label = path.name || 'Effect';
  const lines = riders.map((r) => `- **${r.level}${ordSuffix(r.level)}** ${r.text}`).join('\n');
  return `**${label}**\n${lines}`;
}

function ordSuffix(n: number): string {
  const t = n % 100;
  if (t >= 11 && t <= 13) return 'th';
  switch (n % 10) {
    case 1:
      return 'st';
    case 2:
      return 'nd';
    case 3:
      return 'rd';
    default:
      return 'th';
  }
}

/**
 * Build a property's description popup content from the catalog: item types it applies to, its parts
 * requirement, its effect line, any choice/reuse note, and a per-path level ladder. Kept catalog-sourced
 * so the popup always matches the live mechanics.
 */
export function mpPropertyDesc(prop: MpProperty): { title: string; description: string } {
  const parts: string[] = [];
  parts.push(`*Applies to: ${prop.appliesTo.join(', ')}.*`);
  parts.push(`**Parts:** ${prop.requirement}`);
  if (prop.effect) parts.push(prop.effect);
  if (prop.choicePrompt) {
    parts.push(`**Choose:** ${prop.choicePrompt}${prop.choiceOptions ? ` — ${prop.choiceOptions.join(', ')}` : ''}`);
  }
  if (prop.reusesPathsOf) {
    parts.push(`Uses the **${prop.reusesPathsOf}** property's paths and level entries.`);
  }
  for (const path of prop.paths) parts.push(pathSummary(path));
  return { title: prop.name, description: parts.join('\n\n') };
}
