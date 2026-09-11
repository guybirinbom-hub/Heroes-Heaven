import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { archetypeCantripAllowed, activeCasterArchetype } from '../src/rules/casterArchetypes';
import type { Character, ContentDatabase, InventoryItem } from '../src/rules/types';

/**
 * BATCH 037, family gap-data-rows-2 — the READERS the data chunk was blocked on.
 *
 * Three of the eleven findings in work/.b037-rows-data-rows-2.json authored a field with no reader
 * (`resonant.spellNotes` on the three aeon stones) and a fourth could not be authored at all because
 * no grant could be gated on ANOTHER record's answer (locate-lawbreakers). Both readers are built
 * here, plus the one restriction that no data row could ever express (oatia-skysage-dedication, whose
 * cantrip list is computed in code from the tradition).
 *
 * Every assertion is made on a BUILT character. The two data rows this family emits
 * (work/.b037-rows-gap-data-rows-2.json) have NOT landed yet, so each reader is exercised against a
 * content copy with the field PATCHED IN MEMORY and its mirror image with the field ABSENT — never a
 * patched-vs-shipped delta, which would flip meaning the moment the overlay row is applied.
 */
const db = content();

/** A shipped record with one field patched in memory (`undefined` removes it). */
const patched = <T extends object>(rec: T, patch: Record<string, unknown>): T => {
  const out = { ...rec } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete out[k];
    else out[k] = v;
  }
  return out as T;
};

const withItem = (id: string, patch: Record<string, unknown>, base = db): ContentDatabase =>
  ({ ...base, items: { ...base.items, [id]: patched(base.items[id], patch) } }) as ContentDatabase;

const withFeat = (id: string, patch: Record<string, unknown>, base = db): ContentDatabase =>
  ({ ...base, feats: { ...base.feats, [id]: patched(base.feats[id], patch) } }) as ContentDatabase;

/*
 * ⚠ The inventory goes INTO the build, never spread onto an already-built character: innate spells
 * and the spell-note registry are both collected during buildCharacter, so attaching gear afterwards
 * never re-runs the collector and the assertion silently reads an empty list.
 */
const hero = (over: Partial<BuildState>, content_ = db): Character =>
  buildCharacter(
    { ...emptyBuild(), name: 't', level: 6, classId: 'fighter', keyAbility: 'str', ancestryId: 'human', backgroundId: 'acrobat', ...over } as BuildState,
    content_,
  );

const inv = (itemId: string, state: Partial<InventoryItem>): InventoryItem =>
  ({ instanceId: itemId, itemId, quantity: 1, ...state }) as InventoryItem;

// ─────────────────────────────────────────────────────────────────────────────
// aeon-stone-agate-ellipsoid#resonant-note / dusty-rose-prism / western-star —
// the reader for `resonant.spellNotes`.
// ─────────────────────────────────────────────────────────────────────────────

describe('items/aeon-stone-agate-ellipsoid carries its resonant clause to the Augury entry', () => {
  const CLAUSE =
    'The resonant power causes the *augury* spell from the aeon stone to always succeed at the DC 6 flat check to give an answer other than "nothing."';
  const stone = (slotted: boolean, withNotes: boolean) =>
    hero(
      { inventory: [inv('aeon-stone-agate-ellipsoid', { worn: true, invested: true, ...(slotted ? { designations: ['wayfinder-slotted' as const] } : {}) })] },
      /* Both halves are PATCHED copies. The row has landed, so the shipped record now carries
       * `resonant.spellNotes` and a `: db` branch here would compare the patched value against
       * itself; the stunted copy is built by deleting the field instead. */
      withItem('aeon-stone-agate-ellipsoid', {
        resonant: patched(db.items['aeon-stone-agate-ellipsoid'].resonant!, {
          spellNotes: withNotes ? [{ spellId: 'augury', note: CLAUSE }] : undefined,
        }),
      }),
    );

  /* equipment-407-868: "The resonant power causes the augury spell from the aeon stone to always
   * succeed at the DC 6 flat check to give an answer other than \"nothing.\"" — a rule about the
   * spell the stone grants, reachable before this only by opening the item. */
  // batch 037: aeon-stone-agate-ellipsoid#resonant-note
  it('prints the clause on Augury, attributed to the stone, once the stone is slotted', () => {
    const on = stone(true, true).spellNotes?.augury ?? [];
    expect(on, 'no clause reached the Augury entry').toHaveLength(1);
    expect(on[0].from, 'the player must be able to see which record wrote it').toBe('Aeon Stone (Agate Ellipsoid) (resonant)');
    expect(on[0].note).toBe(CLAUSE);
  });

  /* The mirror image: the same reader, the same character, the field ABSENT — which is exactly the
   * shipped record today. A clause that appears without the data would be the test passing for the
   * wrong reason. */
  // batch 037: aeon-stone-agate-ellipsoid#resonant-note
  it('…and nothing at all when the stone carries no spellNotes', () => {
    expect(stone(true, false).spellNotes?.augury ?? []).toHaveLength(0);
  });

  /* The whole reason the clause hangs on `resonant` and not on the item's own top-level `spellNotes`
   * lane: that lane fires for any worn or invested item with no designation check, and would print
   * the resonant rule on a stone merely orbiting the player's head. */
  // batch 037: aeon-stone-agate-ellipsoid#resonant-note
  it('…and nothing while the stone is worn but NOT slotted in a wayfinder', () => {
    expect(stone(false, true).spellNotes?.augury ?? []).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// locate-lawbreakers#order-of-the-gate — a heighten ladder gated on ANOTHER
// record's answer.
// ─────────────────────────────────────────────────────────────────────────────

describe('locate-lawbreakers heightens Locate only for the Order of the Gate', () => {
  /* The row work/.b037-rows-gap-data-rows-2.json emits: the shipped four-option picker with the
   * printed clause's two halves added to every option's grant. Built here from the shipped value so
   * the test cannot drift from the row. */
  const gated = (() => {
    const ec = JSON.parse(JSON.stringify(db.feats['locate-lawbreakers'].effectChoices)) as {
      options: { grant: { innateSpells: Record<string, unknown>[] } }[];
    }[];
    for (const o of ec[0].options) {
      o.grant.innateSpells[0].heightenAt = [{ level: 14, rank: 5 }];
      o.grant.innateSpells[0].heightenWhenFlag = { flag: 'hellknightOrder', value: 'order-of-the-gate' };
    }
    return ec;
  })();

  /*
   * …and its mirror image, the STUNTED copy. The row has now LANDED, so `db` carries the ladder and
   * the old "shipped" branch below would have compared the patched value against itself. Both halves
   * are therefore built here: `gated` adds the two fields if they are missing, `ungated` removes them
   * whether or not they are there, so the pair says the same thing before and after the overlay row.
   */
  const ungated = (() => {
    const ec = JSON.parse(JSON.stringify(db.feats['locate-lawbreakers'].effectChoices)) as {
      options: { grant: { innateSpells: Record<string, unknown>[] } }[];
    }[];
    for (const o of ec[0].options) {
      delete o.grant.innateSpells[0].heightenAt;
      delete o.grant.innateSpells[0].heightenWhenFlag;
    }
    return ec;
  })();

  const ranksOf = (c: Character) => {
    const innate = c.spellcasting.find((s) => s.type === 'innate');
    return Object.entries(innate?.repertoire ?? {})
      .filter(([, ids]) => (ids as string[]).includes('locate'))
      .map(([r]) => Number(r));
  };

  const hellknight = (order: string | null, patch: boolean, level = 14) =>
    hero(
      {
        level,
        featPicks: { '2:class:0': 'hellknight-dedication', '2:class:1': 'locate-lawbreakers' },
        ...(order ? { featChoices: { '2:class:0:0': order } } : {}),
        effectChoices: { 'locate-lawbreakers:locate-tradition': 'occult' },
      } as Partial<BuildState>,
      withFeat('locate-lawbreakers', { effectChoices: patch ? gated : ungated }),
    );

  /* hellknight-order-9: "If you're a member of the Order of the Gate, when you reach 14th level, the
   * spell is heightened to 5th rank." The order is asked once, on Hellknight Dedication. */
  // batch 037: locate-lawbreakers#order-of-the-gate
  it('a member of the Order of the Gate casts it at 5th rank from 14th level', () => {
    expect(ranksOf(hellknight('order-of-the-gate', true)), 'the gated ladder did not fire').toEqual([5]);
  });

  /* The half Wanderer's Guide gets wrong — they heighten it for every Hellknight at 14. Print gates
   * it on the order, and Locate's own rank is 3. */
  // batch 037: locate-lawbreakers#order-of-the-gate
  it('a Hellknight of any other order still casts it, at its own 3rd rank', () => {
    expect(ranksOf(hellknight('order-of-the-nail', true)), 'the grant itself must never be gated').toEqual([3]);
  });

  /* Unanswered reads as "not that order": the ladder is a benefit, so withholding it until the
   * question is answered can only under-grant, never over-grant. */
  // batch 037: locate-lawbreakers#order-of-the-gate
  it('…and an unanswered order does not heighten it either', () => {
    expect(ranksOf(hellknight(null, true))).toEqual([3]);
  });

  /* The mirror image on a copy with NO ladder at all: 3rd rank for everyone, including a Gate member
   * — so the two assertions above are reading the patched field and nothing else. Built by stripping
   * rather than by reading the shipped record, because the row has landed and the shipped record now
   * carries the ladder. */
  // batch 037: locate-lawbreakers#order-of-the-gate
  it('…and a copy of the record with no ladder heightens for nobody', () => {
    expect(ranksOf(hellknight('order-of-the-gate', false))).toEqual([3]);
  });

  /* Below 14 the ladder has not been reached, order or no order — the level half of the clause. */
  // batch 037: locate-lawbreakers#order-of-the-gate
  it('…and a Gate member below 14th level casts it at 3rd rank', () => {
    expect(ranksOf(hellknight('order-of-the-gate', true, 13))).toEqual([3]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// oatia-skysage-dedication#cantrip-picker — a restriction no data row can carry.
// ─────────────────────────────────────────────────────────────────────────────

describe('oatia-skysage-dedication grants only the four cantrips it names', () => {
  const PRINTED = ['detect-magic', 'guidance', 'know-the-way', 'read-aura'];
  const skysage = (cantrips: string[]) =>
    hero({ level: 4, featPicks: { '2:class:0': 'oatia-skysage-dedication' }, cantrips } as Partial<BuildState>);
  const entryOf = (c: Character) => c.spellcasting.find((e) => e.id === 'oatia-skysage-dedication-casting');

  /* feat-8112: "You gain a spell repertoire with two of the following cantrips of your choice: detect
   * magic, guidance, know the way, or read aura." The list the pickers offer is computed in code from
   * the archetype's tradition — all 38 occult cantrips — so no core.json field could say this. */
  // batch 037: oatia-skysage-dedication#cantrip-picker
  it('the printed four are allowed and every other occult cantrip is not', () => {
    const arch = activeCasterArchetype(['oatia-skysage-dedication'])!;
    for (const id of PRINTED) expect(archetypeCantripAllowed(arch, id), id).toBe(true);
    for (const id of ['daze', 'prestidigitation', 'shield']) expect(archetypeCantripAllowed(arch, id), id).toBe(false);
    /* …and the restriction is this archetype's alone: every other caster archetype still offers its
     * whole tradition, which is what its own printed text says. */
    expect(archetypeCantripAllowed(activeCasterArchetype(['wizard-dedication']), 'daze')).toBe(true);
  });

  // batch 037: oatia-skysage-dedication#cantrip-picker
  it('a pick from the printed four reaches the sheet', () => {
    expect(entryOf(skysage(['detect-magic', 'read-aura']))?.cantrips).toEqual(['detect-magic', 'read-aura']);
  });

  /* Owner 2026-09-10 #113: a character holding a pick made before the restriction existed must
   * re-choose. Narrowed on READ rather than migrated — these builds live in localStorage, in Supabase
   * and in exported .codex files — so the stored pick stops being delivered and the sheet says why. */
  // batch 037: oatia-skysage-dedication#cantrip-picker
  it('a stored pick outside the four is not delivered, and the player is told', () => {
    const c = skysage(['detect-magic', 'daze']);
    expect(entryOf(c)?.cantrips, 'Daze is not one of the four').toEqual(['detect-magic']);
    expect(
      (c.effectWarnings ?? []).some((w) => w.message.includes('Daze') && w.message.includes('choose again')),
      'the entry went short with nothing said',
    ).toBe(true);
  });
});
