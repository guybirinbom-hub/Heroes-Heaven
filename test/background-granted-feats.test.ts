import { describe, it, expect } from 'vitest';
import { content, build } from './_content';
import { backgroundGrantedFeats } from '../src/rules/build';

const c = content();

/**
 * BACKGROUNDS THAT GRANT TWO FEATS.
 *
 * `Background.grantedFeatId` was a single string, but two backgrounds grant a PAIR:
 *   Eagle Hunter — "You gain the Pet general feat AND the Train Animal skill feat"
 *   Returned     — "You gain the Diehard feat and the Additional Lore feat for Boneyard Lore"
 * The second feat was silently dropped everywhere the field was read. The field now accepts
 * `string | string[]` and every reader goes through backgroundGrantedFeats().
 */
describe('background-granted feats', () => {
  it('normalises both the single and the pair form', () => {
    expect(backgroundGrantedFeats(undefined)).toEqual([]);
    expect(backgroundGrantedFeats({ grantedFeatId: 'toughness' } as never)).toEqual(['toughness']);
    expect(backgroundGrantedFeats({ grantedFeatId: ['pet', 'train-animal'] } as never)).toEqual(['pet', 'train-animal']);
  });

  it('Eagle Hunter grants BOTH Pet and Train Animal', () => {
    expect(backgroundGrantedFeats(c.backgrounds['eagle-hunter'])).toEqual(['pet', 'train-animal']);
  });

  it('Returned grants BOTH Diehard and Additional Lore', () => {
    expect(backgroundGrantedFeats(c.backgrounds['returned'])).toEqual(['diehard', 'additional-lore']);
  });

  it('Shielded Fortune grants Toughness (it granted nothing before)', () => {
    expect(backgroundGrantedFeats(c.backgrounds['shielded-fortune'])).toEqual(['toughness']);
  });

  it('both feats actually land on a built character, not just the first', () => {
    const ch = build('fighter', 1, { backgroundId: 'eagle-hunter' });
    const ids = new Set(ch.feats.map((f) => f.featId));
    expect(ids.has('pet'), 'Pet must be granted').toBe(true);
    expect(ids.has('train-animal'), 'Train Animal must be granted').toBe(true);
  });

  it('every granted id resolves to a real feat', () => {
    for (const bg of Object.values(c.backgrounds)) {
      for (const id of backgroundGrantedFeats(bg)) {
        expect(c.feats[id], `${bg.id} grants missing feat '${id}'`).toBeTruthy();
      }
    }
  });
});
