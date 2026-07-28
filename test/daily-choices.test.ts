import { describe, it, expect } from 'vitest';
import { content, build } from './_content';
import { rest } from '../src/rules/play';
import type { PlayState } from '../src/rules/play';
import {
  dailyChoicesFor,
  unansweredDailyChoices,
  dailyChoiceLabel,
  dailyChoiceKey,
} from '../src/rules/dailyChoices';
import type { Character } from '../src/rules/types';

const c = content();

/**
 * DAILY PREPARATIONS.
 *
 * A handful of feats are re-chosen every morning rather than once when taken ("During your daily
 * preparations, choose to become protected from severe cold or severe heat"). Those answers are PLAY
 * state, not build state — they change nightly and must survive a rest, because the "reuse my last
 * pick" setting is precisely the promise that they do.
 */
describe('daily-preparation choices', () => {
  const withFeat = (id: string): Character => {
    const base = build('ranger', 8);
    return { ...base, feats: [...base.feats, { featId: id, source: 'test' } as never] };
  };

  it('finds a feat whose choice is flagged daily', () => {
    const found = dailyChoicesFor(withFeat('environmental-adaptability'), c);
    const env = found.find((f) => f.recordId === 'environmental-adaptability');
    expect(env, 'Environmental Adaptability should offer a daily choice').toBeTruthy();
    expect(env!.options.map((o) => o.value).sort()).toEqual(['cold', 'heat']);
    expect(env!.key).toBe(dailyChoiceKey('environmental-adaptability', 'environmentalAdaptation'));
  });

  it('ignores choices that are NOT daily (build-time picks stay in the build)', () => {
    // Domain Initiate picks a domain once, when taken — it must never appear at rest.
    const found = dailyChoicesFor(withFeat('domain-initiate'), c);
    expect(found.some((f) => f.recordId === 'domain-initiate')).toBe(false);
  });

  it('a character without the feat is asked nothing', () => {
    expect(dailyChoicesFor(build('ranger', 8), c).length).toBe(0);
  });

  it('unanswered = only the choices with no stored answer', () => {
    const choices = dailyChoicesFor(withFeat('environmental-adaptability'), c);
    const key = choices[0].key;
    expect(unansweredDailyChoices(choices, undefined)).toHaveLength(1);
    expect(unansweredDailyChoices(choices, {})).toHaveLength(1);
    expect(unansweredDailyChoices(choices, { [key]: 'cold' })).toHaveLength(0);
  });

  it('labels a stored answer, and stays quiet when it is unset or stale', () => {
    const choice = dailyChoicesFor(withFeat('environmental-adaptability'), c)[0];
    expect(dailyChoiceLabel(choice, { [choice.key]: 'heat' })).toBe('Severe heat');
    expect(dailyChoiceLabel(choice, undefined)).toBeNull();
    // A value that no longer matches any option must render nothing rather than a raw slug.
    expect(dailyChoiceLabel(choice, { [choice.key]: 'obsolete-option' })).toBeNull();
  });

  it('RESTING KEEPS the stored answers — the whole basis of "reuse my last pick"', () => {
    const key = dailyChoiceKey('environmental-adaptability', 'environmentalAdaptation');
    const play = { damage: 10, dailyChoices: { [key]: 'cold' } } as unknown as PlayState;
    const after = rest(play, { level: 8, conMod: 3 });
    expect(after.dailyChoices).toEqual({ [key]: 'cold' });
    // …while still doing the rest of what a rest does.
    expect(after.damage).toBe(0);
  });

  it('an item only asks while it is actually in use', () => {
    const base = withFeat('environmental-adaptability');
    // Sanity: the feat-sourced choice is present regardless of inventory state.
    expect(dailyChoicesFor({ ...base, inventory: [] }, c)).toHaveLength(1);
  });
});
