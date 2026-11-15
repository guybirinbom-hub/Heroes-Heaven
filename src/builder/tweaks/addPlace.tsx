/*
 * AN EXTRA FEAT PLACE ON THE LEVEL PAGE (Tweaks phase 2, WP7 run 3; plan work/tweaks-phase2-notes/plan.md WP7 step 3,
 * C11-C13, C21, C42). A `choice.addPlace` block with `place: 'feat'` adds a place whose pick lives at
 * `featPicks["<level>:extra<category>:<n>"]` (C8). Here: which places a level draws a card for, in which state, and
 * the "Add a place" control at the end of a level's section. The card itself is the Builder's (it is the place's own
 * slot card, with the slot's picker, notes and questions), inside WP2's `PlaceCardShell`.
 *
 *   - EVERY readable feat place block at the level draws a card, live, paused or with Tweaks off (C11, C42): its key is
 *     one of the level's drawn keys, so its pick is never listed as a "feat with no slot". A key with no block, or an
 *     unreadable or newer block, draws no card (UNKNOWN ≠ EMPTY: it stays a feat with no slot that counts).
 *   - The state is the engine's (blocks/active.ts `heldBackPlaceKeys`, C9): Tweaks off → 'off'; no block of the key on
 *     → 'paused'; else 'live'.
 *   - "Add a place" writes ONE block and asks nothing (C21); opening it writes nothing (C36).
 */
import { useMemo, useState } from 'react';
import type { BuildState } from '../../rules/build';
import { entryOn, featPlaceKey, storedChoiceBlocks } from '../../rules/blocks/active';
import { placeWords, type BlockInstance } from '../../rules/blocks/registry';
import { tweaksSwitchOn } from '../../rules/blocks/stored';
import type { PlaceCardState } from './choiceParts';

/** One extra feat place a level draws. */
export interface FeatPlaceCard {
  /** The slot key its pick and answers live under (C8). */
  slotKey: string;
  level: number;
  /** The book category ('class', 'general' …). */
  category: string;
  n: number;
  state: PlaceCardState;
  /** The block the card's mark and "Turn on" name: the first live one, else the first stored. */
  block: BlockInstance;
  /** Every stored block naming this key, in stored order (one, unless two tabs drew the same `n`). */
  blocks: BlockInstance[];
}

/** Every READABLE extra feat place at `level`, one card per slot key, in stored order (see the header). */
export function featPlaceCardsAt(build: Pick<BuildState, 'overrides' | 'options'>, level: number): FeatPlaceCard[] {
  const byKey = new Map<string, BlockInstance[]>();
  for (const b of storedChoiceBlocks(build)) {
    const p = b.params;
    if (b.kind !== 'choice.addPlace' || p?.place !== 'feat' || p.level !== level) continue;
    const k = featPlaceKey(p.level, p.category, p.n);
    byKey.set(k, [...(byKey.get(k) ?? []), b]);
  }
  if (!byKey.size) return [];
  const on = tweaksSwitchOn(build);
  return [...byKey].map(([slotKey, blocks]) => {
    const live = blocks.find((b) => entryOn(b, true));
    const p = blocks[0].params!;
    return {
      slotKey,
      level,
      category: String(p.category),
      n: Number(p.n),
      state: !on ? 'off' : live ? 'live' : 'paused',
      block: live ?? blocks[0],
      blocks,
    };
  });
}

/** The mark's rule words for a place ("An extra class feat place at level 4"), from the registry's own place words. */
export const featPlaceRule = (c: Pick<FeatPlaceCard, 'level' | 'category'>): string =>
  `An extra ${placeWords({ place: 'feat', level: c.level, category: c.category }) ?? 'feat place'}`;

/** One extra skill-increase or boost place a level draws (WP11, C15 / C16: a CARRIER — the block holds its answer). */
export interface CarrierPlaceCard {
  place: 'skillIncrease' | 'boost';
  level: number;
  /** The skill key or attribute it holds (absent: empty, owed while live). */
  answer?: string;
  state: PlaceCardState;
  block: BlockInstance;
}

/**
 * WP11: every READABLE extra skill-increase and boost place at `level`, ONE card per block (two extra increases at a
 * level are two places, C14), in stored order, in every state (C42): Tweaks off → 'off'; the block's own switch off →
 * 'paused'; else 'live'. An unreadable block (an attribute outside the six, C3) or a newer one draws nothing here: it
 * stays read-only on the Tweaks page.
 */
export function carrierPlaceCardsAt(build: Pick<BuildState, 'overrides' | 'options'>, level: number): CarrierPlaceCard[] {
  const out: CarrierPlaceCard[] = [];
  const on = tweaksSwitchOn(build);
  for (const b of storedChoiceBlocks(build)) {
    const p = b.params;
    if (b.kind !== 'choice.addPlace' || p?.level !== level || (p.place !== 'skillIncrease' && p.place !== 'boost')) continue;
    const answer = p.place === 'skillIncrease' ? p.skill : p.attribute;
    out.push({
      place: p.place,
      level,
      ...(typeof answer === 'string' ? { answer } : {}),
      state: !on ? 'off' : entryOn(b, true) ? 'live' : 'paused',
      block: b,
    });
  }
  return out;
}

/** The mark's rule words for a carrier place ("An extra skill increase at level 5"). */
export const carrierPlaceRule = (c: Pick<CarrierPlaceCard, 'place' | 'level'>): string => `An extra ${placeWords({ place: c.place, level: c.level }) ?? 'place'}`;

/**
 * "Add a place" at the end of a level's section (Tweaks on only; the caller draws it then): one button; pressed, the
 * place kinds this version adds — a feat place, with the feat kinds this character may add (`categories`, read when it
 * opens: C13's one list), and (WP11) an extra skill increase and an extra attribute boost. A kind pressed is `onAdd`
 * or `onAddCarrier`, which writes one block and asks nothing (C21). Pressing the button writes nothing.
 */
export function AddPlaceControl({
  level,
  categories,
  label,
  onAdd,
  onAddCarrier,
}: {
  level: number;
  /** The feat kinds offered (model.ts `featPlaceCategories`), read only once the control opens. */
  categories: () => readonly string[];
  /** A kind's name on its button ("Class feat"). */
  label: (category: string) => string;
  onAdd: (category: string) => void;
  /** WP11: an empty extra skill-increase or boost place at this level (the player answers it on its card). */
  onAddCarrier?: (place: 'skillIncrease' | 'boost') => void;
}) {
  const [open, setOpen] = useState(false);
  const cats = useMemo(() => (open ? categories() : []), [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open)
    return (
      <div className="lvl-add-place" data-add-place={level}>
        <button type="button" className="lvl-add-place-btn" aria-expanded={false} onClick={() => setOpen(true)}>
          <i className="ti ti-square-plus" aria-hidden="true" /> Add a place
        </button>
      </div>
    );
  return (
    <div className="lvl-add-place open" data-add-place={level} role="group" aria-label={`Add a place at level ${level}`}>
      <div className="lvl-add-place-head">
        <span className="lvl-add-place-kind">
          <i className="ti ti-square-plus" aria-hidden="true" /> Feat place
        </span>
        <button type="button" className="lvl-add-place-cancel" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <div className="lvl-add-place-cats">
        {cats.map((c) => (
          <button
            key={c}
            type="button"
            className="lvl-add-place-cat"
            data-category={c}
            onClick={() => {
              setOpen(false);
              onAdd(c);
            }}
          >
            {label(c)}
          </button>
        ))}
      </div>
      {onAddCarrier && (
        // Fix round 1: their own heading, beside "Feat place" (plan section 2 lists three kinds of place).
        <div className="lvl-add-place-head" data-add-carriers-head={level}>
          <span className="lvl-add-place-kind">
            <i className="ti ti-square-plus" aria-hidden="true" /> Skill increase or attribute boost
          </span>
        </div>
      )}
      {onAddCarrier && (
        <div className="lvl-add-place-cats" data-add-carriers={level}>
          {(
            [
              ['skillIncrease', 'Skill increase', 'ti-arrow-up'],
              ['boost', 'Attribute boost', 'ti-hexagon'],
            ] as const
          ).map(([place, text, icon]) => (
            <button
              key={place}
              type="button"
              className="lvl-add-place-cat"
              data-carrier={place}
              onClick={() => {
                setOpen(false);
                onAddCarrier(place);
              }}
            >
              <i className={`ti ${icon}`} aria-hidden="true" /> {text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
