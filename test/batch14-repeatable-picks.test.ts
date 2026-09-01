import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveDefenses } from '../src/rules/derive';
import type { BuildState } from '../src/rules/build';

/*
 * BATCH 14's REPEATABLE PICKS — a second taking must be a second answer.
 *
 * `effectChoices` answers are stored once per RECORD, so on a repeatable feat every taking wrote to
 * the same key and the second one granted nothing: the player paid a feat for a duplicate. The
 * record's own `choice` is keyed by SLOT. These assert the DELIVERY of the second take, not the field
 * layout — a migration that keeps the fields and still loses the second grant is the same bug.
 *
 * The three records do NOT share one Special clause, which is why they were migrated one at a time:
 * two say "the one you didn't gain the first time", the third explicitly allows repeating an answer
 * to upgrade it.
 */
const db = content();

const focusOf = (ch: ReturnType<typeof build>) =>
  new Set(ch.spellcasting?.filter((e) => e.type === 'focus').flatMap((e) => Object.values(e.repertoire ?? {}).flat()) ?? []);

describe('batch 14 repeatable picks', () => {
  it('Wyldsinger: two takes learn both songs', () => {
    /* *"You can take this feat a second time, gaining the focus spell you didn't gain the first time."* */
    const ch = build('bard', 12, {
      featPicks: { '2:class': 'wyldsinger', '4:class': 'wyldsinger' },
      featChoices: { '2:class': 'menacing-lament', '4:class': 'valiant-anthem' },
    } as Partial<BuildState>);
    const focus = focusOf(ch);
    expect(focus.has('menacing-lament')).toBe(true);
    expect(focus.has('valiant-anthem'), 'the second take must not overwrite the first').toBe(true);
  });

  it('Special Sentinel Technique: two takes learn both techniques', () => {
    const ch = build('fighter', 12, {
      featPicks: { '6:class': 'special-sentinel-technique', '8:class': 'special-sentinel-technique' },
      featChoices: { '6:class': 'healing', '8:class': 'attack' },
    } as Partial<BuildState>);
    const focus = focusOf(ch);
    expect(focus.has('luminous-stardust-healing')).toBe(true);
    expect(focus.has('shining-starlight-attack')).toBe(true);
  });

  it('Greater Animal Senses: a second taking may UPGRADE the same sense to precise', () => {
    /*
     * *"…either choosing a different sense OR improving an imprecise sense granted by this feat to a
     * precise sense."* Repeating an answer is explicitly legal here, so this record is deliberately
     * NOT marked `distinctAcrossTakes` — and the upgrade branch had no option at all to pick, so a
     * second taking could only re-choose a sense it already had and change nothing.
     */
    const once = build('ranger', 12, {
      featPicks: { '6:class': 'greater-animal-senses' },
      featChoices: { '6:class': 'echolocation' },
    } as Partial<BuildState>);
    expect(deriveDefenses(once, db).senses.find((s) => s.name === 'echolocation')?.acuity).toBe('imprecise');

    const twice = build('ranger', 12, {
      featPicks: { '6:class': 'greater-animal-senses', '8:class': 'greater-animal-senses' },
      featChoices: { '6:class': 'echolocation', '8:class': 'echolocation-precise' },
    } as Partial<BuildState>);
    expect(deriveDefenses(twice, db).senses.find((s) => s.name === 'echolocation')?.acuity, 'the upgrade branch must be reachable').toBe('precise');
  });
});
