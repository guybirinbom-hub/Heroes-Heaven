import type { Character, ContentDatabase } from '../rules/types';
import { formatMod, critSpecSources, strikeShowsCritSpec, type Strike } from '../rules/derive';
import { critSpec } from '../rules/critSpec';
import type { StatRef } from '../rules/explain';
import { useEscapeClose } from './useEscapeClose';
import { PinStar } from './PinStar';
import { DescBody } from './DescBody';
import { CritSpecText } from './CritSpecText';

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

/**
 * The strike detail popup: the weapon's (or unarmed/blast) description, plus the attack bonus and
 * damage — each clickable to open its calculation breakdown (the same StatDetailModal the rest of
 * the sheet uses). The description is pinnable like every other description popup.
 */
export function StrikeDetailModal({
  strike,
  character,
  content,
  onOpenStat,
  onClose,
}: {
  strike: Strike;
  character: Character;
  content: ContentDatabase;
  onOpenStat?: (ref: StatRef) => void;
  onClose: () => void;
}) {
  useEscapeClose(onClose);
  const inv = character.inventory.find((i) => i.instanceId === strike.instanceId);
  const item = inv ? content.items[inv.itemId] : undefined;
  const description = item?.description ?? strikeBlurb(strike);
  const descRefs = item?.descRefs;
  const node = { title: strike.name, description, descRefs, key: 'items' };
  // Crit specialization — shown in Strikes ONLY when the character actually has it (matching the row).
  const critText = critSpec(strike.group);
  const showsCrit = !!critText && strikeShowsCritSpec(strike, critSpecSources(character, content));

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
          <div className="strike-detail-stats">
            <button
              type="button"
              className={'strike-detail-stat' + (onOpenStat ? ' clickable' : '')}
              onClick={onOpenStat ? () => onOpenStat({ kind: 'strikeAttack', instanceId: strike.instanceId }) : undefined}
            >
              <span className="sds-label">Attack bonus</span>
              <span className="sds-value">{formatMod(strike.attack[0])}</span>
              {onOpenStat && <span className="sds-hint">show calculation</span>}
            </button>
            <button
              type="button"
              className={'strike-detail-stat' + (onOpenStat ? ' clickable' : '')}
              onClick={onOpenStat ? () => onOpenStat({ kind: 'strikeDamage', instanceId: strike.instanceId }) : undefined}
            >
              <span className="sds-label">Damage</span>
              <span className="sds-value">{strike.damage}</span>
              {onOpenStat && <span className="sds-hint">show calculation</span>}
            </button>
          </div>
          {showsCrit && (
            <div className="strike-detail-crit">
              <span className="sds-label">Critical specialization · {strike.group ? strike.group.charAt(0).toUpperCase() + strike.group.slice(1) : ''}</span>
              <div className="sd-critspec-text">
                <CritSpecText text={critText!} content={content} />
              </div>
            </div>
          )}
          {description && <DescBody description={description} descRefs={descRefs} onExit={onClose} />}
        </div>
      </div>
    </div>
  );
}
