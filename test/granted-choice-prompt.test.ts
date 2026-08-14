import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { content } from './_content';
import { featChoicePrompt } from '../src/rules/build';

/**
 * A granted feat's picker must be labelled the same as a picked one's.
 *
 * `featChoicePrompt(prompt, flag)` falls back to humanising the FLAG when the imported prompt is the
 * placeholder literal "Prompt" — which 30-odd records carry. `renderChoice` passed the flag;
 * `grantedChoicePicker` did not, at three call sites. So the same feat read "Terrain" in a skill-feat
 * slot and "Choose an option" when a background handed it to you.
 */
describe('a granted feat’s choice is labelled from its flag, like a picked one', () => {
  const c = content();

  it('Terrain Expertise reads "Terrain", not "Choose an option"', () => {
    const def = c.feats['terrain-expertise']?.choice;
    expect(def?.prompt).toBe('Prompt'); // the importer's placeholder — the reason the fallback exists
    expect(featChoicePrompt(def?.prompt, def?.flag)).toBe('Terrain');
    // …and the un-flagged call, which is what the granted lane used to make.
    expect(featChoicePrompt(def?.prompt)).toBe('Choose an option');
  });

  // 21, down from the 25 first measured. FOUR records have left the set, and each left because the
  // record got BETTER rather than because the fallback got worse — which is exactly why the bound is a
  // floor and not an equality:
  //   · Manifold Modifications ("Additional initial modification", ruling Q9's filtering lane) and
  //     Sterling Dynamo Dedication ("Sterling dynamo", ruling Q20's echo-picker pass) were given real
  //     prompts and no longer lean on the flag fallback at all;
  //   · Animal Senses and Greater Animal Senses lost their `choice` outright. Each carried a phantom
  //     picker (prompt stored literally as "Prompt") asking the same question as its own live
  //     `effectChoices[sense]` — the picker that actually grants the sense — so the player answered two
  //     controls for one printed decision and the Feats tab printed the answer twice.
  // Measured: 23 before that deletion, 21 after. The six other phantom pickers deleted in the same
  // pass are not in this set, because their prompts are real or their flags humanise to the same
  // string the un-flagged call already produces.
  it('two dozen feats were mislabelled on the granted lane, so this is not one record', () => {
    const affected = Object.values(c.feats).filter((f) => {
      const d = f?.choice;
      return d && featChoicePrompt(d.prompt) !== featChoicePrompt(d.prompt, d.flag);
    });
    expect(affected.length).toBeGreaterThanOrEqual(21);
  });

  /**
   * A behavioural test cannot catch someone dropping the argument again at one of several call sites,
   * so this reads the source. Same idiom as `parked-fields.test.ts`.
   */
  it('EVERY featChoicePrompt call in the builder passes the flag', () => {
    const src = readFileSync('src/builder/Builder.tsx', 'utf8');
    const calls = src.match(/featChoicePrompt\([^)]*\)/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    const bare = calls.filter((call) => !/,\s*def\.flag\s*\)/.test(call));
    expect(bare, `these drop the flag and will render "Choose an option": ${bare.join(', ')}`).toEqual([]);
  });
});
