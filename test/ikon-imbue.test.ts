import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { buildChoiceOptions, buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import type { Character } from '../src/rules/types';

const db = content();
const ikons = (db as unknown as Record<string, Record<string, { id: string; name: string; ikonType?: string }>>).ikon;

/**
 * THE IKON IMBUE LANE — three records the adversarial settle audit ruled we had to build.
 *
 * An exemplar imbue feat prints *"The imbued ikon gains the following ability"*, and its own Usage line
 * names the kind of ikon that may carry it: Twin Stars *"imbued into a one-handed weapon ikon"*, Hurl
 * at the Horizon *"a thrown or melee weapon ikon"*, Leap the Falls *"a body ikon"*.
 *
 * Twin Stars shipped as an inert free-text box; the other two shipped as bare records. The answer was
 * therefore never recorded and the immanence hung on no object.
 */
describe('every ikon knows what kind of thing it is', () => {
  it('all 21 are typed, and the split matches their printed Usage lines', () => {
    const byType = Object.values(ikons).reduce<Record<string, number>>((m, i) => ((m[i.ikonType ?? '(none)'] = (m[i.ikonType ?? '(none)'] ?? 0) + 1), m), {});
    expect(byType).toEqual({ body: 4, weapon: 10, worn: 7 });
  });

  it('the two that defeat a naive prefix rule are filed by what they ARE', () => {
    // *"a wallet, bag, or similar container of 1 Bulk you can wear on your body"* — worn, not a weapon.
    expect(ikons['horn-of-plenty'].ikonType).toBe('worn');
    /* *"a holster or sheath shaped for a ONE-HANDED THROWN WEAPON of light Bulk or less"* — the ikon
     * empowers the weapon it holds, so both imbue feats that name a weapon ikon accept it. Filed worn
     * at first on the strength of the word "holster"; corrected when the differ showed their side
     * offering it to Twin Stars, which wants a one-handed weapon ikon. */
    expect(ikons['shadow-sheath'].ikonType).toBe('weapon');
  });
});

describe('an imbue feat asks which ikon carries it', () => {
  const optionsFor = (featId: string, chosen?: string[]) => {
    const b = {
      ...emptyBuild(), name: 't', level: 8, classId: 'exemplar',
      ...(chosen ? { extraChoices: { ikon: chosen } } : {}),
    } as BuildState;
    const ch = buildCharacter(b, db) as Character;
    return buildChoiceOptions(featId, db.feats[featId].choice!, b, db, ch).map((o) => o.value);
  };

  it.each([
    ['twin-stars', 'weapon'],
    ['hurl-at-the-horizon', 'weapon'],
    ['leap-the-falls', 'body'],
  ])('%s offers only %s ikons', (featId, type) => {
    const def = db.feats[featId].choice!;
    expect(def.kind).toBe('ikons');
    expect(def.ikonType).toBe(type);
    // A real recorded answer, not the inert free-text box Twin Stars used to carry.
    expect(def.inert).toBeUndefined();
    for (const id of optionsFor(featId)) expect(ikons[id].ikonType, id).toBe(type);
  });

  it("offers the character's OWN ikons once they have chosen some", () => {
    const mine = ['barrows-edge', 'skin-hard-as-horn', 'victors-wreath'];
    // Twin Stars wants a weapon ikon: of those three, only Barrow's Edge qualifies.
    expect(optionsFor('twin-stars', mine)).toEqual(['barrows-edge']);
    // Leap the Falls wants a body ikon: only Skin Hard as Horn.
    expect(optionsFor('leap-the-falls', mine)).toEqual(['skin-hard-as-horn']);
  });

  it('falls back to every ikon of the type while none have been chosen yet', () => {
    // An empty picker mid-build reads as broken data rather than as an unanswered question.
    expect(optionsFor('leap-the-falls')).toHaveLength(4);
    expect(optionsFor('twin-stars')).toHaveLength(10);
  });
});
