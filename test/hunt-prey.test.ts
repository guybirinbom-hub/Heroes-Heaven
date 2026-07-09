import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { buildCharacter, emptyBuild } from '../src/rules/build';
import { deriveStrikes } from '../src/rules/derive';
import { resourcesForCharacter } from '../src/rules/classResources';
import type { Character } from '../src/rules/types';

const c = content();
const anc = Object.keys(c.ancestries)[0];
const bg = Object.keys(c.backgrounds)[0];

function precisionRanger(hunting: boolean): Character {
  const ch = buildCharacter(
    { ...emptyBuild(), name: 't', level: 5, classId: 'ranger', ancestryId: anc, backgroundId: bg, keyAbility: 'dex', subclassId: 'precision' },
    c,
  );
  return { ...ch, classResources: { ...ch.classResources, 'hunt-prey': hunting ? 1 : 0 } };
}

function preyRider(ch: Character) {
  return deriveStrikes(ch, c)
    .flatMap((s) => s.conditionalDamage ?? [])
    .find((r) => r.note.includes('prey')) ?? null;
}

describe('Hunt Prey / Devise a Stratagem toggles', () => {
  it('a ranger has a Hunt Prey toggle; an investigator has Devise a Stratagem', () => {
    expect(resourcesForCharacter('ranger', new Set()).map((r) => r.id)).toContain('hunt-prey');
    expect(resourcesForCharacter('investigator', new Set()).map((r) => r.id)).toContain('devise-stratagem');
  });

  it('a fighter with Ranger Dedication also gets Hunt Prey (archetype parity)', () => {
    expect(resourcesForCharacter('fighter', new Set(['ranger-dedication'])).map((r) => r.id)).toContain('hunt-prey');
  });

  it('the precision ranger rider appears only while Hunt Prey is toggled on', () => {
    expect(preyRider(precisionRanger(false))).toBeNull();
    const on = preyRider(precisionRanger(true));
    expect(on).toBeTruthy();
    expect(on!.text).toContain('d8 precision');
    expect(on!.note).toContain('*');
  });
});
