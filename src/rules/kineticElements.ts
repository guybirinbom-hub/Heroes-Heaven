/*
 * A character's kinetic elements, and the one rule that gates impulse feats on them.
 *
 * This lives in its own leaf module rather than in build.ts because BOTH of its readers are option
 * filters and one of them, `featPickGrants.ts`, cannot import a value from build.ts — build.ts
 * imports `pickableFeats` from it, so a value import back would be a runtime cycle. build.ts
 * re-exports `kineticistElements` so every existing import path keeps working.
 *
 * One rule, one place, on purpose: the gate was written out twice before (once in the feat-slot
 * picker, and not at all in the bonus-feat picker), which is how an archetype kineticist came to be
 * offered every element's impulses no matter which element they chose.
 */
import type { BuildState } from './build';

/** The six element traits a kineticist gate can carry. An impulse naming none of them is elementless
 *  (Command Elemental, Counter Element) and works with whichever elements you have. */
export const KINETIC_ELEMENTS = ['air', 'earth', 'fire', 'metal', 'water', 'wood'] as const;

/**
 * The ARCHETYPE feats that hand a non-kineticist a kinetic element, and store the answer on the feat
 * rather than in `extraChoices.element` — which is the class's own store and stays empty for them.
 *
 * Both offer the same six `<element>-gate` option ids the class picker does, so their answers drop
 * straight into the same set with no translation.
 */
const ARCHETYPE_ELEMENT_FEATS: readonly string[] = ['kineticist-dedication', 'add-element'];

/**
 * A character's effective kinetic elements: the L1 gate picks plus any gained via Fork the Path at a
 * reached Gate's Threshold — or, for an ARCHETYPE kineticist, the elements their dedication and Add
 * Element named. Returns element option ids (e.g. 'fire-gate').
 *
 * Ruling Q20 is why the archetype half exists. Kineticist Dedication's *"choose one element to be
 * your kinetic element"* reached nothing at all: every consumer read `extraChoices.element`, which
 * only a kineticist BY CLASS ever fills, so the pick was an echo of the feat's own label and an
 * archetype kineticist was offered every element's impulses regardless of what they chose.
 */
export function kineticistElements(build: BuildState, level: number): string[] {
  const base = build.extraChoices?.['element'] ?? [];
  const forks = Object.entries(build.gateForks ?? {})
    .filter(([lvl, el]) => !!el && Number(lvl) <= level)
    .map(([, el]) => el);
  // Read off featPicks/featChoices rather than off a built character: both callers are BUILDER option
  // filters, which run while a picker is open and must not pay for a full build.
  const archetype: string[] = [];
  for (const [slotKey, featId] of Object.entries(build.featPicks ?? {})) {
    if (!featId || !ARCHETYPE_ELEMENT_FEATS.includes(featId)) continue;
    // A feat slotted ABOVE the character's current level is not yet theirs — the same filter `forks`
    // applies, and without it planning level 10 would widen a level-6 picker.
    if (Number(slotKey.split(':')[0]) > level) continue;
    const answer = build.featChoices?.[slotKey];
    if (answer) archetype.push(answer);
  }
  return [...new Set([...base, ...forks, ...archetype])];
}

/**
 * Whether an impulse feat is available to a character holding `elements` (bare names, no `-gate`).
 *
 * Fails OPEN in two cases, both deliberate: a character with no elements recorded yet (nothing to
 * filter against — hiding everything would look like a broken picker), and an ELEMENTLESS impulse,
 * which works with whichever element you have.
 */
export function impulseAllowedFor(featTraits: readonly string[], elements: readonly string[]): boolean {
  const featElements = featTraits.filter((t) => (KINETIC_ELEMENTS as readonly string[]).includes(t));
  if (!elements.length || !featElements.length) return true;
  return featElements.some((t) => elements.includes(t));
}

/** `kineticistElements`' `<element>-gate` ids reduced to the bare trait names impulse feats carry. */
export function elementTraitsOf(build: BuildState, level: number): string[] {
  return kineticistElements(build, level).map((id) => id.replace(/-gate$/, ''));
}
