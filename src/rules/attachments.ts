/*
 * Item attachments — talismans, spellhearts, and banners affix to a weapon/armor/shield.
 * Foundry has no structured "affix target", so we read the item's `usage` string + traits
 * (talismans by consumableType, spellhearts by trait). A host is identified by its itemType.
 */
import type { Item } from './types';

export type HostType = 'weapon' | 'armor' | 'shield';

/** Whether an item can be affixed onto a weapon/armor/shield (vs worn on the body / placed). */
export function isAttachable(item: Item): boolean {
  const u = item.usage ?? '';
  if (item.itemType === 'consumable' && item.consumableType === 'talisman') return true;
  if (item.traits?.includes('spellheart')) return true;
  // "affixed-to-…/attached-to-…" usages that target gear (not creatures, ground, walls, ships…).
  if (/^(affixed|attached)/.test(u) && /weapon|armor|shield|clothing|unarmored|instrument/.test(u)) return true;
  if (/banner/i.test(item.name) && /affixed/.test(u)) return true;
  return false;
}

/** Which host item types this attachment can go on (parsed from its usage; talismans/spellhearts
 *  with no explicit gear word default to all three). */
export function attachHostTypes(item: Item): HostType[] {
  const u = item.usage ?? '';
  const out = new Set<HostType>();
  // Weapon-subtype synonyms — a usage like "affixed to a firearm/crossbow/bow" means the weapon host.
  if (/weapon|instrument|firearm|crossbow|bow|gun/.test(u)) out.add('weapon');
  if (/armor|clothing|unarmored/.test(u)) out.add('armor');
  if (/shield/.test(u)) out.add('shield');
  // Banners affix to a weapon or shield.
  if (/banner/i.test(item.name)) {
    out.add('weapon');
    out.add('shield');
  }
  if (out.size === 0 && isAttachable(item)) {
    out.add('weapon');
    out.add('armor');
    out.add('shield');
  }
  return [...out];
}

/** Whether `attachment` may be affixed to a host of the given itemType. */
export function canAttachTo(attachment: Item, hostType: string): boolean {
  return isAttachable(attachment) && attachHostTypes(attachment).includes(hostType as HostType);
}
