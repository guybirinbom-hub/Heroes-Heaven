// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { renderDom } from './_render';
import { deriveDefenses } from '../src/rules/derive';
import { ItemDetail } from '../src/sheet/ItemDetail';
import { applyPlayState, initialPlay, type PlayState } from '../src/rules/play';
import type { Character, InventoryItem } from '../src/rules/types';

/**
 * Batch 036, gap B — the crafter's energy pick for an ETCHED armour property rune.
 *
 * Energy-Resistant: *"You gain resistance 5 to acid, cold, electricity, or fire. The crafter chooses
 * the damage type when creating the rune."* The reader `etchedRuneDefences` (derive.ts) looks for the
 * answer at `effectChoices['<runeId>:<choiceId>']` on the HOST row — the armour — and before this
 * chunk nothing anywhere wrote that key: ItemDetail's Choices block keys an item's own choices by the
 * BARE choice id on the item's own row, and etching consumes the rune's row entirely. So every
 * choice-carrying armour rune silently took options[0] = acid, whatever the crafter chose.
 */
const c = () => content();
const noop = () => undefined;

/** A fighter wearing leather armour with Energy-Resistant etched on it. */
function wearer(effectChoices?: Record<string, string>): Character {
  const armour: InventoryItem = {
    instanceId: 'armour-1',
    itemId: 'leather-armor',
    quantity: 1,
    worn: true,
    // potency 1, not 0: planAttach (attachments.ts, "property-rune slots come from the potency rune")
    // refuses a property rune on a potency-0 suit, so a 0 here would pin a state the app cannot make.
    runes: { potency: 1, resilient: 0, property: ['energy-resistant'] },
    ...(effectChoices ? { effectChoices } : {}),
  } as InventoryItem;
  return { ...build('fighter', 8), inventory: [armour] } as Character;
}

const resistances = (ch: Character) => deriveDefenses(ch, c()).resistances ?? [];

describe('batch 036 gap B — the etched energy-resistant rune asks the crafter, and the answer reaches the sheet', () => {
  // batch 036: energy-resistant
  it('renders one control per etched-rune choice, and answering "cold" moves energy-resistant off acid', () => {
    const ch = wearer();
    // The player opens the ARMOUR (the rune has no row of its own once it is etched).
    let play: PlayState = initialPlay(ch, c());
    const onPlay = (fn: (p: PlayState) => PlayState) => {
      play = fn(play);
    };
    const { host, stop } = renderDom(
      <ItemDetail
        inv={play.inventory![0]}
        item={c().items['leather-armor']}
        content={c()}
        inventory={play.inventory}
        character={ch}
        onPlay={onPlay}
        onClose={noop}
      />,
    );
    const label = c().items['energy-resistant'].name;
    expect(host.textContent).toContain('Etched rune choices');
    expect(host.textContent).toContain(label);
    // The control itself: one select carrying the four printed energy types.
    const select = [...host.querySelectorAll('select')].find((s) =>
      [...s.options].some((o) => o.value === 'cold') && [...s.options].some((o) => o.value === 'electricity'),
    );
    expect(select).toBeTruthy();
    select!.value = 'cold';
    select!.dispatchEvent(new Event('change', { bubbles: true }));
    stop();
    // …and the answer is written where the reader looks: on the HOST row, keyed `<runeId>:<choiceId>`.
    expect(play.inventory![0].effectChoices?.['energy-resistant:energy']).toBe('cold');
    const res = resistances(applyPlayState(ch, play, c()));
    expect(res.find((r) => r.type === 'cold')?.value).toBe(5);
    // The acid fallback must NOT survive an explicit answer — a rune grants ONE type, not two.
    expect(res.some((r) => r.type === 'acid')).toBe(false);
  });

  // batch 036: energy-resistant
  it('still grants acid 5 for an energy-resistant rune nobody answered, matching what WG grants', () => {
    // An etched rune always HAS a type — the crafter chose one whether or not this sheet recorded it —
    // so the unanswered case takes the first option rather than granting nothing. Pinned so the
    // fallback cannot be removed by accident once the control above exists.
    const res = resistances(wearer());
    expect(res.find((r) => r.type === 'acid')?.value).toBe(5);
    // …and an ANSWER on that same row is what displaces it (the two halves are one lane).
    const answered = resistances(wearer({ 'energy-resistant:energy': 'fire' }));
    expect(answered.find((r) => r.type === 'fire')?.value).toBe(5);
    expect(answered.some((r) => r.type === 'acid')).toBe(false);
  });

  // batch 036: energy-resistant
  it('says which type an UNANSWERED energy-resistant control is granting, instead of a bare "Choose…"', () => {
    // The control and the reader must tell the same story. The reader falls back to options[0] because
    // *"the crafter chooses the damage type when creating the rune"* — the rune has a type either way —
    // so a placeholder reading "Choose…" beside an acid 5 on the Defences card is the sheet contradicting
    // itself. Verifier fix; the sibling "Choices" block keeps its bare placeholder because an unanswered
    // item choice genuinely grants nothing.
    const ch = wearer();
    const play: PlayState = initialPlay(ch, c());
    const { host, stop } = renderDom(
      <ItemDetail
        inv={play.inventory![0]}
        item={c().items['leather-armor']}
        content={c()}
        inventory={play.inventory}
        character={ch}
        onPlay={() => undefined}
        onClose={noop}
      />,
    );
    const select = [...host.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'electricity'));
    const empty = [...select!.options].find((o) => o.value === '');
    stop();
    // The fallback the reader actually applies for this unanswered row…
    expect(resistances(ch).find((r) => r.type === 'acid')?.value).toBe(5);
    // …is the one the placeholder names, taken from the same options[0] rather than hard-coded here.
    expect(empty!.textContent).toContain(c().items['energy-resistant'].effectChoices![0].options![0].label);
    expect(empty!.textContent).not.toBe('Choose…');
  });
});
