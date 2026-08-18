import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { buildChoiceOptions, buildCharacter, emptyBuild } from '../src/rules/build';
import { openChoiceOptions } from '../src/rules/openChoice';

const c = content();

/**
 * CAN THE PLAYER ACTUALLY REACH THE CHOICE?
 *
 * Every other measure in this suite asks whether the ENGINE honours a record — does the field have a
 * reader, does the number come out right. None of them asked the first half of the question. Domain
 * Initiate passed every engine measure there is: all 485 deities, all 1,911 deity×domain combinations
 * granted the correct focus spell. It was still reported as broken, because with no deity chosen the
 * domain menu offered nothing and said nothing, and the player never got as far as the engine.
 *
 * So: every record carrying a choice, hosted on a class that can legally take it, asking the SAME
 * function the builder asks. A menu that comes back empty is a picker the player cannot use.
 *
 * ⚠ ASK THE FUNCTION THE BUILDER ASKS. The first version of this scan reported 30 broken pickers and
 * every one was a false positive: `kind: 'text'` renders a free-text input and has no list by design,
 * and `kind: 'open'` resolves through `openChoiceOptions`, not through the narrowing path. This
 * project has now shipped that mistake five separate times — a detector that matches the CONDITION
 * instead of the OUTCOME reads as coverage while finding a fraction of the cases.
 */
const SLOT = '1:class:0';
const anyDeity = Object.entries(c.deities).find(([, d]) => (d.domains ?? []).length)![0];

/**
 * Menus whose pool is computed from something a synthetic host does not have. These are NOT defects:
 * an `own-item` menu is meant to be empty until you own the item, and a rank-gated skill menu until
 * you are expert. Each was verified individually — see scripts/scan-empty-pickers.mjs.
 */
const NEEDS_MORE_THAN_A_CLASS = new Set([
  'westyrs-wayfinder-repository', // own-spell — needs spells learned
  'fused-staff', // own-item weapon
  'built-in-tools', // own-item equipment
  'vehicle-mechanic-dedication', // own-companion
  'automatic-knowledge', // skills at expert
  'fuse-stance', // own-feat with the stance trait, needs two
  'signature-weapon', // own-item weapon
  'celestial-armaments', // own-item weapon
  'beast-lord-dedication', // own-companion
  'autonomous-arms', // own-item weapon
  'warshard-warrior-dedication', // own-item weapon
  'blessed-blood-sorcerer', // own-spell
]);

const host = (classId: string, level: number, over: Record<string, unknown> = {}) =>
  ({
    ...emptyBuild(),
    name: 't',
    level: Math.max(1, Math.min(20, level || 1)),
    classId,
    ancestryId: Object.keys(c.ancestries)[0],
    backgroundId: Object.keys(c.backgrounds)[0],
    keyAbility: c.classes[classId]?.keyAbility?.length === 1 ? c.classes[classId].keyAbility[0] : null,
    subclassId: c.classes[classId]?.subclass?.options?.[0]?.id ?? null,
    featPicks: { [SLOT]: '' },
    ...over,
  }) as never;

describe('every choice picker can be filled', () => {
  it('no record offers an empty menu on a host that satisfies it', () => {
    const empties: string[] = [];
    for (const coll of ['feats', 'classFeatures'] as const) {
      for (const [id, rec] of Object.entries(c[coll] ?? {})) {
        const r = rec as { choice?: unknown; traits?: string[]; level?: number };
        const defs = Array.isArray(r.choice) ? r.choice : r.choice ? [r.choice] : [];
        if (!defs.length || NEEDS_MORE_THAN_A_CLASS.has(id)) continue;
        /* A general, skill or ancestry feat names no class — any class can take it, so hosting it on
         * an arbitrary one is correct rather than a skip. Skipping them silently was the first
         * sweep's other flaw: 214 records went uncounted and the run still read as complete. */
        const classId = (r.traits ?? []).find((t) => c.classes[t]) ?? Object.keys(c.classes)[0];
        for (const def of defs as { kind?: string; from?: unknown; domainPool?: unknown }[]) {
          if (def.kind === 'text') continue; // free text: no list to be empty
          const b = host(classId, r.level ?? 1, {
            featPicks: { [SLOT]: id },
            deityId: anyDeity,
            archetypeTradition: 'divine',
          });
          const n =
            def.kind === 'open'
              ? openChoiceOptions(def.from as never, c, { character: buildCharacter(b, c) }).length
              : buildChoiceOptions(id, def as never, b, c, buildCharacter(b, c), SLOT).length;
          if (n === 0) empties.push(`${coll}/${id} (${def.kind})`);
        }
      }
    }
    expect(empties, 'a picker the player cannot use').toEqual([]);
  });

  it('a domain menu is empty without a deity — and the builder says so rather than showing a blank list', () => {
    /* The reported bug, pinned. The engine was never wrong; the builder was silent. Builder.tsx turns
     * exactly this state into "Choose a deity first", so if the pool ever fills without a deity, or
     * stops filling with one, that message is either wrong or unreachable. */
    const withoutDeity = host('cleric', 1, { featPicks: { [SLOT]: 'domain-initiate' }, deityId: null });
    const withDeity = host('cleric', 1, { featPicks: { [SLOT]: 'domain-initiate' }, deityId: anyDeity });
    const def = c.feats['domain-initiate'].choice as never;
    expect(buildChoiceOptions('domain-initiate', def, withoutDeity, c, buildCharacter(withoutDeity, c), SLOT)).toEqual([]);
    expect(
      buildChoiceOptions('domain-initiate', def, withDeity, c, buildCharacter(withDeity, c), SLOT).length,
    ).toBe(c.deities[anyDeity].domains!.length);
  });
});
