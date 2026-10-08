import type { Character, ContentDatabase } from '../rules/types';
import { formatMod, critSpecSources, strikeShowsCritSpec, type Strike } from '../rules/derive';
import { critSpec } from '../rules/critSpec';
import { shownItemId } from '../rules/cursedItems';
import type { StatRef } from '../rules/explain';
import { useEscapeClose } from './useEscapeClose';
import { PinStar } from './PinStar';
import { PinContext, usePinDesc } from './PinContext';
import { DescBody } from './DescBody';
import { CritSpecText } from './CritSpecText';
import { RecordCard } from './RecordCard';
import { cardOn } from './cardSurfaces';
import { scopeOfCharacter } from './cardScope';
import type { PinDescApi } from './PinContext';
import type { OursLine } from './cardModel';
import type { DescNode } from './descref';

/** Description for strikes that have no backing item (the baseline Fist, kineticist blasts). */
function strikeBlurb(strike: Strike): string {
  if (strike.instanceId === 'fist')
    return 'An unarmed Strike with your fist — every creature can make unarmed attacks. It uses your unarmed proficiency, and Handwraps of Mighty Blows can etch potency, striking, and property runes onto it.';
  if (strike.instanceId.startsWith('blast:'))
    return 'Your kineticist Elemental Blast, channeled through your kinetic gate. A two-action blast adds your Constitution modifier to damage; a melee blast adds your Strength modifier.';
  if (strike.instanceId.startsWith('natural:'))
    return `A natural unarmed attack (${strike.name}) granted by your ancestry or a feat. It uses your unarmed proficiency, and — like any unarmed attack — is buffed by Handwraps of Mighty Blows (striking scales it to ${strike.strikingDice + 1} of its own dice).`;
  return '';
}

interface StrikeDetailProps {
  strike: Strike;
  character: Character;
  content: ContentDatabase;
  onOpenStat?: (ref: StatRef) => void;
  onClose: () => void;
}

/**
 * The strike detail popup: the weapon's (or unarmed/blast) description, plus the attack bonus and
 * damage — each clickable to open its calculation breakdown (the same StatDetailModal the rest of
 * the sheet uses). The description is pinnable like every other description popup.
 *
 * Card step 10 (docs/card-design.md section 9 row 10): with CARD_ON.strikeDetail the popup is the
 * weapon's 'mine' card — StrikeCard below. The legacy popup stays for the switch's off position.
 * Two components, not one with a branch: each registers its own dismiss entry (the card's is
 * RecordCard's), so the choice is made before any hook runs.
 */
export function StrikeDetailModal(props: StrikeDetailProps) {
  return cardOn('strikeDetail') ? <StrikeCard {...props} /> : <LegacyStrikeDetail {...props} />;
}

/** What both popups read off a strike: its weapon (if any), the pin node, and the gated crit block. */
function strikeParts(strike: Strike, character: Character, content: ContentDatabase) {
  const inv = character.inventory.find((i) => i.instanceId === strike.instanceId);
  const item = inv ? content.items[inv.itemId] : undefined;
  const description = item?.description ?? strikeBlurb(strike);
  const descRefs = item?.descRefs;
  // card step 7a (docs/card-design.md section 2 rule 2): the pin opens the WEAPON's own page by its id
  // (the twin's for a hidden cursed weapon) — the strike's name can carry runes or be renamed, so its
  // slug finds another page or none. A strike with no item (Fist, a blast) keeps the title lookup.
  // Card step 19: stored with the pin (play.ts pinOf) — the mode it was pinned from, never its identity.
  const node = { title: strike.name, description, descRefs, key: 'items', mode: 'mine' as const, ...(item ? { slug: shownItemId(item, content) } : {}) };
  // Crit specialization — shown in Strikes ONLY when the character actually has it (matching the row).
  const critText = critSpec(strike.group);
  const showsCrit = !!critText && strikeShowsCritSpec(strike, critSpecSources(character, content));
  return { item, description, descRefs, node, critText, showsCrit };
}

/** Attack bonus and Damage, each a button into its breakdown when the sheet can open one. */
function StrikeStats({ strike, onOpenStat }: { strike: Strike; onOpenStat?: (ref: StatRef) => void }) {
  return (
    <div className="strike-detail-stats">
      <button
        type="button"
        className={'strike-detail-stat' + (onOpenStat ? ' clickable' : '')}
        onClick={onOpenStat ? () => onOpenStat({ kind: 'strikeAttack', instanceId: strike.instanceId }) : undefined}
      >
        <span className="sds-label">Attack bonus</span>
        <span className="sds-value">{formatMod(strike.attack[0])}</span>
        {onOpenStat && (
          <span className="sds-hint">
            show calculation <i className="ti ti-chevron-right" aria-hidden="true" />
          </span>
        )}
      </button>
      <button
        type="button"
        className={'strike-detail-stat' + (onOpenStat ? ' clickable' : '')}
        onClick={onOpenStat ? () => onOpenStat({ kind: 'strikeDamage', instanceId: strike.instanceId }) : undefined}
      >
        <span className="sds-label">Damage</span>
        <span className="sds-value">{strike.damage}</span>
        {onOpenStat && (
          <span className="sds-hint">
            show calculation <i className="ti ti-chevron-right" aria-hidden="true" />
          </span>
        )}
      </button>
    </div>
  );
}

/** The group's critical specialization, drawn only when the character has it (the caller's gate). */
function StrikeCrit({ strike, critText, content }: { strike: Strike; critText: string; content: ContentDatabase }) {
  return (
    <div className="strike-detail-crit">
      <span className="sds-label">Critical specialization · {strike.group ? strike.group.charAt(0).toUpperCase() + strike.group.slice(1) : ''}</span>
      <div className="sd-critspec-text">
        <CritSpecText text={critText} content={content} />
      </div>
    </div>
  );
}

/**
 * The ours lines of a strike's card (section 4): a strike with no weapon behind it (the Fist, a
 * kineticist blast, a natural attack) has no record and no page, so the app's own description of it is
 * a `blurb` line in the ours box — never drawn as if it were print. A weapon's card adds nothing.
 */
export function strikeOursLines(strike: Strike, hasItem: boolean): OursLine[] {
  if (hasItem) return [];
  const text = strikeBlurb(strike);
  return text ? [{ kind: 'blurb', text }] : [];
}

/**
 * The pin the card's built-in star works on (the FeatDetail featCardPin rule, kept here so this file does
 * not import FeatDetail, which imports MainTab, which imports this file). RecordCard's star toggles the
 * node it opened; for that first node only, `has` and `toggle` see the strike's own pin node, so the pin
 * stays exactly the one the legacy star stored. A page opened from a link inside the card pins as always.
 */
export function strikeCardPin(pin: PinDescApi, cardNode: DescNode, starNode: DescNode): PinDescApi {
  const isCardNode = (n: DescNode) => n.key === cardNode.key && n.slug === cardNode.slug && n.title === cardNode.title;
  return { ...pin, has: (n) => pin.has(isCardNode(n) ? starNode : n), toggle: (n) => pin.toggle(isCardNode(n) ? starNode : n) };
}

/**
 * Card step 10 — the weapon's record as a 'mine' card (section 2 rules 4–5, section 6).
 *  - A weapon opens its own Archives page by id (items bucket; the disguise twin's for a hidden cursed
 *    weapon, cursedItems.ts shownItemId): the page's words replace the imported weapon text. The page's
 *    lines show by the printed-set rule with an EMPTY set — this popup prints no stat rows of the page's
 *    labels: its controls are the character's computed numbers, so the page's own "Damage 1d8 S" (the
 *    weapon's printed die, not a META header label in astVisibility.ts) stays as print. S-furniture
 *    leaves; Source and reference lines are dimmed; the page's appended item lists are cut
 *    (withoutItemLists, as on every mine card).
 *  - Attack bonus, Damage and the gated critical specialization stay CONTROLS above the page
 *    (leadControls): the same buttons, the same numbers, the same gate — on the page, loading and no-page
 *    lanes alike.
 *  - A weapon with no own page (homebrew, a record the Archives do not have, a not-own-page id) shows its
 *    old text through the card's no-page lane with that lane's footer line ("Homebrew" / "Not from the
 *    Archives — our text").
 *  - A strike with no weapon (Fist, blast, natural attack) names no record: no page is looked up by its
 *    name (rule 2), and the app's blurb is an ours line (strikeOursLines). It is app-authored, never
 *    print, so it carries no no-page footer (section 7, "App-authored records").
 *  - The PinStar pins the step-19 node it always pinned ({key:'items', slug, title, mode:'mine'} for a
 *    weapon; the key-only node for a strike with no weapon), through strikeCardPin.
 */
function StrikeCard({ strike, character, content, onOpenStat, onClose }: StrikeDetailProps) {
  const { item, node, critText, showsCrit } = strikeParts(strike, character, content);
  // The node the card opens: a weapon's is the pin node itself (it carries the weapon's id); a strike
  // with no weapon opens no record — an empty slug makes the card look nothing up by name.
  const cardNode: DescNode = item ? node : { title: strike.name, description: '', slug: '' };
  const pin = usePinDesc();
  const cardPin = pin ? strikeCardPin(pin, cardNode, node) : null;
  const lead = (
    <>
      <StrikeStats strike={strike} onOpenStat={onOpenStat} />
      {showsCrit && <StrikeCrit strike={strike} critText={critText!} content={content} />}
    </>
  );
  return (
    <PinContext.Provider value={cardPin}>
      <RecordCard
        node={cardNode}
        mode="mine"
        chrome="popup"
        scope={scopeOfCharacter(character)}
        printed={[]}
        leadControls={lead}
        ours={strikeOursLines(strike, !!item)}
        onExit={onClose}
      />
    </PinContext.Provider>
  );
}

/** The legacy popup, kept behind CARD_ON.strikeDetail (card step 10). */
function LegacyStrikeDetail({ strike, character, content, onOpenStat, onClose }: StrikeDetailProps) {
  useEscapeClose(onClose);
  const { description, descRefs, node, critText, showsCrit } = strikeParts(strike, character, content);

  return (
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker info-modal" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <span className="info-title">{strike.name}</span>
          <PinStar node={node} />
          <button className="picker-close" onClick={onClose} aria-label="Close">
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
        <div className="info-body">
          <StrikeStats strike={strike} onOpenStat={onOpenStat} />
          {showsCrit && <StrikeCrit strike={strike} critText={critText!} content={content} />}
          {description && <DescBody description={description} descRefs={descRefs} onExit={onClose} />}
        </div>
      </div>
    </div>
  );
}
