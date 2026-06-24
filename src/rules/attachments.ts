/*
 * Item attachments — talismans, spellhearts, and banners affix to a weapon/armor/shield.
 * Foundry has no structured "affix target", so we read the item's `usage` string + traits
 * (talismans by consumableType, spellhearts by trait). A host is identified by its itemType.
 */
import type { ArmorRunes, ContentDatabase, InventoryItem, Item, RuneDef, WeaponRunes } from './types';

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

/* =========================================================================
 * Drag-to-attach: decide whether a dragged item (a rune OR an affixable) can go onto a host item,
 * returning the concrete action on success or a SPECIFIC human reason on failure. A rune is etched
 * onto the host's `runes` (and the loose rune consumed); an affixable becomes `attachedTo` the host.
 * ========================================================================= */

type HostRunes = WeaponRunes & ArmorRunes;
const STRIKING_TIER = ['', 'striking', 'greater', 'major'] as const;
const RESILIENT_TIER = ['', 'resilient', 'greater', 'major'] as const;
const aOrAn = (w: string) => (/^[aeiou]/i.test(w) ? `an ${w}` : `a ${w}`);

/** The kind of an affixable item — a host holds at most one of each (RAW: one talisman, etc.). */
function attachKind(item: Item): 'talisman' | 'spellheart' | 'banner' | 'other' {
  if (item.itemType === 'consumable' && item.consumableType === 'talisman') return 'talisman';
  if (item.traits?.includes('spellheart')) return 'spellheart';
  if (/banner/i.test(item.name)) return 'banner';
  return 'other';
}

export type AttachPlan =
  | { ok: false; reason: string }
  | { ok: true; action: 'affix'; verb: 'Affix'; prep: 'to' }
  | { ok: true; action: 'etch'; verb: 'Etch'; prep: 'onto'; runes: HostRunes; consume: boolean };

/** Plan affixing/etching the dragged item onto the host. `content` resolves rune defs + affixed
 *  siblings; `inventory` is the full list (to count one-per-kind attachments). */
export function planAttach(
  attachment: Item,
  attachmentInv: InventoryItem,
  host: Item,
  hostInv: InventoryItem,
  inventory: InventoryItem[],
  content: ContentDatabase,
): AttachPlan {
  if (attachmentInv.instanceId === hostInv.instanceId) return { ok: false, reason: 'An item can’t be attached to itself.' };
  const rune = content.runes[attachment.id];
  if (rune) return planRune(rune, attachment, host, hostInv);
  if (isAttachable(attachment)) return planAffix(attachment, attachmentInv, host, hostInv, inventory, content);
  return { ok: false, reason: `${attachment.name} isn’t a rune or an attachment — there’s nothing to affix onto another item.` };
}

function isHost(host: Item): host is Extract<Item, { itemType: HostType }> {
  return host.itemType === 'weapon' || host.itemType === 'armor' || host.itemType === 'shield';
}

function planRune(rune: RuneDef, attachment: Item, host: Item, hostInv: InventoryItem): AttachPlan {
  if (!isHost(host)) return { ok: false, reason: `Runes can only be etched onto a weapon, armor, or shield — not ${host.name}.` };
  if (rune.slot !== host.itemType) return { ok: false, reason: `${attachment.name} is ${aOrAn(rune.slot)} rune — it can’t be etched onto ${host.name}.` };
  const runes: HostRunes = { ...((hostInv.runes ?? {}) as HostRunes) };
  const v = rune.value ?? 1;
  const etch = (r: HostRunes): AttachPlan => ({ ok: true, action: 'etch', verb: 'Etch', prep: 'onto', runes: r, consume: true });
  if (rune.kind === 'potency') {
    if (runes.potency === v) return { ok: false, reason: `${host.name} already has a +${v} potency rune.` };
    runes.potency = Math.min(v, 4) as HostRunes['potency'];
    runes.property = (runes.property ?? []).slice(0, Math.min(runes.potency ?? 0, 3));
    return etch(runes);
  }
  if (rune.kind === 'striking') {
    const tier = STRIKING_TIER[Math.min(v, 3)] as WeaponRunes['striking'];
    if (runes.striking === tier) return { ok: false, reason: `${host.name} already has a ${tier} striking rune.` };
    runes.striking = tier;
    return etch(runes);
  }
  if (rune.kind === 'resilient') {
    const tier = RESILIENT_TIER[Math.min(v, 3)] as ArmorRunes['resilient'];
    if (runes.resilient === tier) return { ok: false, reason: `${host.name} already has a ${tier} resilient rune.` };
    runes.resilient = tier;
    return etch(runes);
  }
  if (rune.kind === 'reinforcing') {
    if (runes.reinforcing === v) return { ok: false, reason: `${host.name} already has that reinforcing rune.` };
    runes.reinforcing = Math.min(v, 6) as ArmorRunes['reinforcing'];
    return etch(runes);
  }
  // property rune — needs a free slot (slots = the potency value, capped at 3) and no duplicate.
  const free = Math.min(runes.potency ?? 0, 3);
  const used = (runes.property ?? []).length;
  if (free === 0) return { ok: false, reason: `${host.name} needs a potency rune first — property-rune slots come from the potency rune.` };
  if ((runes.property ?? []).includes(rune.id)) return { ok: false, reason: `${host.name} already has the ${attachment.name} rune etched.` };
  if (used >= free) return { ok: false, reason: `No free property-rune slot — ${host.name} has ${used} of ${free} filled. Raise its potency rune for more.` };
  runes.property = [...(runes.property ?? []), rune.id];
  return etch(runes);
}

function planAffix(
  attachment: Item,
  attachmentInv: InventoryItem,
  host: Item,
  hostInv: InventoryItem,
  inventory: InventoryItem[],
  content: ContentDatabase,
): AttachPlan {
  if (!isHost(host)) return { ok: false, reason: `You can only affix attachments to a weapon, armor, or shield — not ${host.name}.` };
  if (attachmentInv.attachedTo) return { ok: false, reason: `${attachment.name} is already affixed to another item — peel it off first.` };
  if (hostInv.attachedTo) return { ok: false, reason: `${host.name} is itself affixed to something — you can’t stack attachments.` };
  const hosts = attachHostTypes(attachment);
  if (!hosts.includes(host.itemType)) return { ok: false, reason: `${attachment.name} can only be affixed to ${hosts.join(' or ')} — not ${host.name}.` };
  const kind = attachKind(attachment);
  if (kind !== 'other') {
    const siblings = inventory
      .filter((i) => i.attachedTo === hostInv.instanceId)
      .map((i) => content.items[i.itemId])
      .filter((d): d is Item => !!d);
    if (siblings.some((s) => attachKind(s) === kind)) return { ok: false, reason: `${host.name} already has a ${kind} affixed — only one ${kind} fits.` };
  }
  return { ok: true, action: 'affix', verb: 'Affix', prep: 'to' };
}
