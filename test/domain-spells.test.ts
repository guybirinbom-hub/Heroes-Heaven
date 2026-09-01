import { describe, expect, it } from 'vitest';
import { content, build, grantPicker } from './_content';
import { DOMAIN_SPELLS } from '../src/rules/domains';

/**
 * Every domain a deity carries must grant a focus spell.
 *
 * The registry had 42 of the 64, and its comment said the rest were "uncommon/apocryphal domains
 * without a confident mapping". They were neither uncommon nor unmappable: Duty is carried by 71
 * deities, Change by 67, Darkness by 50, and a cleric of any of them who took Domain Initiate got
 * nothing at all. AoN files each domain as its own record naming its initial and advanced spells —
 * and Advanced Domain, in this same data, already offered all 64.
 */
const c = () => content();

describe('domain focus spells', () => {
  it('every domain any deity carries has a mapping', () => {
    const used = new Set<string>();
    for (const d of Object.values(c().deities)) {
      for (const dom of [...(d.domains ?? []), ...(d.alternateDomains ?? [])]) used.add(dom);
    }
    expect(used.size).toBeGreaterThan(50);
    expect([...used].filter((d) => !DOMAIN_SPELLS[d])).toEqual([]);
  });

  it('every mapped spell exists and is not superseded', () => {
    // Secrecy pointed at `forced-quiet`, which the app itself marks `superseded` and hides — so the
    // one domain that DID have a mapping handed out a spell the player could never see.
    for (const [domain, spellId] of Object.entries(DOMAIN_SPELLS)) {
      const spell = c().spells[spellId];
      expect(spell, `${domain} -> ${spellId}`).toBeTruthy();
      expect(spell.edition, `${domain} -> ${spellId}`).not.toBe('superseded');
    }
    expect(DOMAIN_SPELLS.secrecy).toBe('whispering-quiet');
  });

  it('the legacy domain NAMES still resolve', () => {
    // 48 deity records carry the Gods & Magic spellings. Mapping both keeps either working rather
    // than rewriting those records and breaking a character who already picked one.
    expect(DOMAIN_SPELLS.wyrmkin).toBe(DOMAIN_SPELLS.dragon);
    expect(DOMAIN_SPELLS.void).toBe(DOMAIN_SPELLS.nothingness);
    expect(DOMAIN_SPELLS.delirium).toBe(DOMAIN_SPELLS.disorientation);
  });

  it('Domain Initiate on a previously-unmapped domain now grants the spell', () => {
    // Nalinivati carries Wyrmkin; before this a cleric of hers got no focus spell from it.
    const withDomain = build('cleric', 3, {
      subclassId: 'cloistered-cleric',
      deityId: 'nalinivati',
      featPicks: { '1:class:0': 'domain-initiate' },
      featChoices: { '1:class:0': 'wyrmkin' },
    });
    const focus = withDomain.spellcasting.find((e) => e.type === 'focus');
    expect(focus, 'a focus entry exists').toBeTruthy();
    const all = Object.values(focus!.repertoire ?? {}).flat();
    expect(all).toContain(DOMAIN_SPELLS.wyrmkin);
  });

  it('the two halves now offer exactly the same domains', () => {
    // Advanced Domain already listed all 64 with their advanced spells, which is how the gap showed:
    // a cleric could take the advanced spell of a domain whose initial spell the app could not give
    // them. The legacy aliases are in both, because deity records carry those spellings.
    /* Asked through grantPicker: Advanced Domain is repeatable, so its pick moved to the per-taking
     * `choice`. What this test compares — the two halves offering the SAME domains — is unchanged. */
    const options = ((grantPicker(c().feats['advanced-domain'])?.options ?? []) as { value: string }[]).map((o) => o.value);
    expect([...options].sort()).toEqual(Object.keys(DOMAIN_SPELLS).sort());
  });
});
