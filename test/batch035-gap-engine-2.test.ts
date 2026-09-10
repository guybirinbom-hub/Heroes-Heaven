import { describe, expect, it } from 'vitest';
import { build, content } from './_content';
import { deriveEidolon, LANGUAGE_UNCHOSEN } from '../src/rules/companions';
import { COMPANION_MODS } from '../src/rules/companionGrants';
import type { CompanionConfig } from '../src/rules/types';

/*
 * BATCH 035 gaps, engine-2 family — the two demon-eidolon CROSS-FILE lines the engine-2 chunk filed
 * against src/rules/companionGrants.ts and could not take inside its own file grant.
 *
 * Both assertions run on a BUILT 5th-level summoner whose eidolon type is the demon, through the
 * same deriveEidolon route the sheet's Companions tab uses.
 */

const eidolonBlock = (typeId: string) => {
  const c = content();
  const ch = build('summoner', 5, { subclassId: typeId });
  const cfg: CompanionConfig = { id: `c-${typeId}`, kind: 'eidolon', name: 'Test Eidolon', typeId, eidolon: {} };
  return deriveEidolon(cfg, ch, c);
};

describe('batch 035 gap — demon-eidolon speaks the language print names', () => {
  // batch 035: demon-eidolon#language-abyssal
  // AoN eidolon-5: "**Language** Abyssal" — a fixed ANSWER, not a pick. The row carried no
  // `languages`, so the eidolon block showed no Languages line at all.
  it('demon-eidolon shows Abyssal on the block, with no unanswered pick', () => {
    expect(COMPANION_MODS['demon-eidolon'].languages).toEqual(['Abyssal']);
    expect(COMPANION_MODS['demon-eidolon'].languageChoices).toBeUndefined();
    const b = eidolonBlock('demon-eidolon');
    expect(b.languages).toEqual(['Abyssal']);
    expect(b.languages).not.toContain(LANGUAGE_UNCHOSEN);
  });

  // batch 035: demon-eidolon#language-abyssal
  // The printed NAME, not an id: content.languages is remaster-only and has no 'abyssal' record, so
  // deriveEidolon's `content.languages?.[l]?.name ?? l` must fall through to the string as written.
  // This pins WHY the entry is spelled "Abyssal" and not "abyssal" — the id form would print the
  // raw token to the player the day someone "tidies" it.
  it('demon-eidolon carries the printed name because no abyssal language record exists', () => {
    expect(content().languages?.['abyssal']).toBeUndefined();
  });
});

describe('batch 035 gap — demon-eidolon Demonic Strikes note matches the remastered print', () => {
  // batch 035: demon-eidolon#demonic-strikes-note
  // AoN eidolon-5: "Your eidolon's unarmed Strikes gain the unholy trait and deal 1 extra spirit
  // damage to holy creatures and creatures with weakness to unholy. Additionally, choose one of your
  // eidolon's unarmed attacks that deals physical damage; it gains your choice of versatile B,
  // versatile P, or versatile S." The old note said "an extra 1 unholy (evil) damage": wrong damage
  // type, no target restriction and no versatile clause, rendered beside the correct typeAbilities.
  it('demon-eidolon note names spirit damage, the holy target restriction and the versatile pick', () => {
    const note = COMPANION_MODS['demon-eidolon'].note ?? '';
    expect(note).toContain('unholy trait');
    expect(note).toContain('1 extra spirit damage to holy creatures');
    expect(note).toContain('versatile B, P or S');
    expect(note).not.toContain('unholy (evil) damage'); // the pre-remaster wording is gone
    expect(eidolonBlock('demon-eidolon').evoNotes).toContain(note);
  });
});
