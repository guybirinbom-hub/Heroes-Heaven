import type { Customization } from '../rules/types';
import { DEFAULT_RAIL_ORDER } from './customization';

/*
 * The redesigned PC sheet is built from BOXES (docs/redesign/boxes.md). Each section of the sheet is built
 * once as a box, and a layout preset (A, B, C) only says which slot each box sits in. Today's vitals rail
 * has 12 cards; several of them hold more than one thing the new layout puts in separate places (the "hp"
 * card holds Hit points, Armor Class with the shield, and the Class/Spell DC tiles), so one old card can
 * feed several boxes.
 *
 * Players have SAVED rail settings by the old card keys (railOrder, railHidden) and tab settings by the
 * old tab names (hiddenTabs, defaultTab 'Main'). Those keys are frozen. The new layout READS them through
 * this mapping and writes nothing on load (a load is not an edit), and no saved choice changes silently:
 *   - a box is hidden exactly when the old card it comes from is hidden;
 *   - a saved rail order is NOT carried over (it would scatter the new priority order); the player is told
 *     once (layoutChangeNotes), and so are players who saw Languages on the rail (except those who hid
 *     the Details page: they keep the Languages box in the column);
 *   - the Main tab became the Actions page: 'Main' reads as 'Actions' and is still what gets stored.
 * The phone never reads any of this: it keeps its own layout until the phone section of the redesign.
 */

/** Every box the PC sheet can show. The ids are stored once layouts are saved, so never rename one. */
export type BoxId =
  | 'hp'
  | 'ac'
  | 'shield'
  | 'dcs'
  | 'perception'
  | 'heroPoints'
  | 'saves'
  | 'conditions'
  | 'attributes'
  | 'skills'
  | 'speed'
  | 'senses'
  | 'reactions'
  | 'initiative'
  | 'iwr'
  | 'resources'
  | 'archetypeDcs'
  | 'specialStats'
  | 'panache'
  | 'champion'
  | 'mythic'
  | 'languages';

/** Where a box's content lives today: one of the 12 rail card keys, or the Main tab. */
export type BoxSource = (typeof DEFAULT_RAIL_ORDER)[number] | 'main';

export interface BoxDef {
  id: BoxId;
  label: string;
  /** The old rail card (or the Main tab) this box's content comes from — what its hidden state follows. */
  from: BoxSource;
  /** True when the box draws nothing for a character with no content for it (archetype DCs, panache …). */
  onlyWithContent?: boolean;
}

export const BOXES: BoxDef[] = [
  { id: 'hp', label: 'Hit points', from: 'hp' },
  { id: 'ac', label: 'Armor Class', from: 'hp' },
  // Guy 2026-10-24: the shield is its own box, not part of the Armor Class box.
  { id: 'shield', label: 'Shield', from: 'hp', onlyWithContent: true },
  { id: 'dcs', label: 'Class DC and spell DC', from: 'hp' },
  { id: 'perception', label: 'Perception', from: 'saves' },
  { id: 'heroPoints', label: 'Hero points', from: 'movement' },
  { id: 'saves', label: 'Saving throws', from: 'saves' },
  { id: 'conditions', label: 'Conditions and modes', from: 'conditions' },
  { id: 'attributes', label: 'Attributes', from: 'main' },
  { id: 'skills', label: 'Skills', from: 'main' },
  { id: 'speed', label: 'Speed', from: 'movement' },
  { id: 'senses', label: 'Senses', from: 'movement' },
  { id: 'reactions', label: 'Reactions', from: 'movement', onlyWithContent: true },
  { id: 'initiative', label: 'Initiative', from: 'movement', onlyWithContent: true },
  { id: 'iwr', label: 'Resistances, weaknesses, immunities', from: 'defenses', onlyWithContent: true },
  { id: 'resources', label: 'Class resources', from: 'resources', onlyWithContent: true },
  { id: 'archetypeDcs', label: 'Archetype class DCs', from: 'multiclassDc', onlyWithContent: true },
  { id: 'specialStats', label: 'Special statistics', from: 'specialStats', onlyWithContent: true },
  { id: 'panache', label: 'Panache and rage', from: 'panache', onlyWithContent: true },
  { id: 'champion', label: 'Cause (champion)', from: 'champion', onlyWithContent: true },
  { id: 'mythic', label: 'Mythic', from: 'mythic', onlyWithContent: true },
  { id: 'languages', label: 'Languages', from: 'languages' },
];

/** The column slots of a PC layout. */
export type SlotId = 'col1' | 'col2';

/** One line of a column: a box alone, or two boxes side by side. When one half of a pair is hidden or
 *  has no content, the other half takes the whole line. */
export type ColumnEntry = BoxId | [BoxId, BoxId];

export interface Preset {
  col1: ColumnEntry[];
  col2: ColumnEntry[];
  /** Placed in a column but hidden until the player shows it in Customize. */
  offByDefault: BoxId[];
}

/**
 * Layout A: two columns on the left (226 px and 204 px), pages on the right. Column 1 holds what is read
 * and changed during a fight (Guy's "always in view" list first, then the class's own play boxes), column 2
 * what is rolled (attributes, skills) and then the numbers looked up now and then.
 *
 * Languages: the Details page always lists them (its own section, not a box), so the Languages box starts
 * hidden at the end of column 1 (Guy, 2026-10-24: one click away, players rarely check them).
 *
 * Measured on the grey samples with the full test champion (docs/redesign/boxes.md, "Fit" and "Fit of the
 * fresh sample", the latter with the shield in its own box). The pairs are part of that fit: unpaired,
 * those six boxes take up to three more lines.
 */
export const PRESET_A: Preset = {
  col1: [
    'hp',
    'ac',
    'shield',
    ['perception', 'heroPoints'],
    ['initiative', 'reactions'],
    'saves',
    ['speed', 'senses'],
    'conditions',
    'panache',
    'champion',
    'resources',
    'mythic',
    'languages',
  ],
  col2: ['attributes', 'skills', 'dcs', 'archetypeDcs', 'iwr', 'specialStats'],
  offByDefault: ['languages'],
};

/** Every box of a column, in order, pairs flattened. */
export function boxesIn(entries: ColumnEntry[]): BoxId[] {
  return entries.flatMap((e) => (Array.isArray(e) ? e : [e]));
}

export interface BoxLayout {
  col1: ColumnEntry[];
  col2: ColumnEntry[];
  /** Hidden boxes: the ones whose old card the player hid, plus the preset's off-by-default boxes. A hidden
   *  box keeps its place for when it is shown. */
  hidden: BoxId[];
}

/**
 * Resolve a character's saved Customize settings onto a preset. Pure: never writes anything back.
 *
 * Only the HIDDEN cards carry over: a box is hidden exactly when the old card it comes from is hidden. The
 * ORDER follows the preset. The old rail was one column, and any saved order would scatter the preset's
 * priority order (one moved card re-sorts everything, and the old default order has Conditions 11th of 12),
 * pushing always-in-view boxes off screen. So the order is not carried over; `layoutChangeNotes` tells the
 * player once, which is what keeps the change from being silent.
 */
export function boxesFromLegacy(c: Customization, preset: Preset = PRESET_A): BoxLayout {
  const hiddenCards = new Set(c.railHidden ?? []);
  const hidden = new Set<BoxId>(preset.offByDefault);
  // Languages start hidden only because the Details page lists them. A player who hid Details and kept
  // Languages on the rail would otherwise see them nowhere.
  if (languagesStayInColumn(c)) hidden.delete('languages');
  for (const b of BOXES) if (b.from !== 'main' && hiddenCards.has(b.from)) hidden.add(b.id);
  const order = [...boxesIn(preset.col1), ...boxesIn(preset.col2)];
  return {
    col1: preset.col1.map((e) => (Array.isArray(e) ? [e[0], e[1]] : e)),
    col2: preset.col2.map((e) => (Array.isArray(e) ? [e[0], e[1]] : e)),
    hidden: order.filter((id) => hidden.has(id)),
  };
}

function sameOrder(a: string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** True when the Languages box stays shown in its column: Languages were on the rail and Details is hidden. */
function languagesStayInColumn(c: Customization): boolean {
  return !(c.railHidden ?? []).includes('languages') && (c.hiddenTabs ?? []).includes('Details');
}

export interface LayoutNote {
  /** 'order' is about this character's own saved order; 'languages' says the same thing for every
   *  character, so the sheet shows it once per device rather than once per character. */
  kind: 'order' | 'languages';
  text: string;
}

/**
 * What the one-time notice tells a player when layout A first opens a character, so nothing changes
 * silently. Pass the EFFECTIVE customization (`effectiveCustomization(global, override)`): a card order or
 * hidden Languages set in Settings → Appearance counts as much as one set on the character. Empty =
 * nothing they chose changed. Each text is one plain sentence or two.
 */
export function layoutChangeNotes(c: Customization): LayoutNote[] {
  const notes: LayoutNote[] = [];
  const saved = (c.railOrder ?? []).filter((id, i, a) => DEFAULT_RAIL_ORDER.includes(id) && a.indexOf(id) === i);
  const order = [...saved, ...DEFAULT_RAIL_ORDER.filter((id) => !saved.includes(id))];
  if (saved.length && !sameOrder(order, DEFAULT_RAIL_ORDER)) {
    notes.push({
      kind: 'order',
      text: 'The sheet has a new layout, so your own order of the side cards was not kept. Hidden cards stay hidden. You can move boxes again in Customize.',
    });
  }
  if (!(c.railHidden ?? []).includes('languages') && !languagesStayInColumn(c)) {
    notes.push({ kind: 'languages', text: 'Languages moved to the Details page. You can show the Languages box in a column again in Customize.' });
  }
  return notes;
}

/**
 * Which layout setting a character's sheet follows, so a DEVICE-wide layout never silently undoes a
 * character's own choices. The character's own new layout wins; then the character's own hidden cards
 * (railHidden in its override — railOrder no longer counts, because layout A does not use it); only then
 * the device default's new layout; and last the device default's rail settings. Read from the two levels
 * SEPARATELY: `effectiveCustomization` merges them, which would let a device `pcLayout` hide a character's
 * own railHidden.
 */
export type LayoutSource = 'character-layout' | 'character-rail' | 'device-layout' | 'device-rail';
export function layoutSource(
  device: { pcLayout?: unknown },
  character: { pcLayout?: unknown; railOrder?: string[]; railHidden?: string[] } | null | undefined,
): LayoutSource {
  if (character?.pcLayout !== undefined) return 'character-layout';
  if (character?.railHidden !== undefined) return 'character-rail';
  if (device.pcLayout !== undefined) return 'device-layout';
  return 'device-rail';
}

/** The PC pages of layout A, in order. The Main tab's actions became the Actions page. */
export const PC_PAGES = ['Actions', 'Spells', 'Inventory', 'Feats & features', 'Companions', 'Notes', 'Details'];

/** An old tab name (a saved defaultTab, or the remembered last tab) as a page of layout A. */
export function pageFromLegacyTab(tab: string | undefined): string | undefined {
  if (tab === undefined) return undefined;
  if (tab === 'Main') return 'Actions';
  return PC_PAGES.includes(tab) ? tab : undefined;
}

/**
 * A page of layout A as it is STORED (defaultTab, and the remembered last tab). The phone reads the same
 * two values, and on the phone 'Main' is the stats page and 'Actions' a page of its own — so the PC keeps
 * storing 'Main' for its Actions page, or a PC edit would change the phone's opening page.
 */
export function storedTabFromPage(page: string): string {
  return page === 'Actions' ? 'Main' : page;
}

/** Saved hidden tabs as hidden pages. Every hideable tab kept its name; the Actions page, like Main, is never hidden. */
export function pagesHiddenFromLegacy(hiddenTabs: string[] | undefined): string[] {
  return (hiddenTabs ?? []).filter((t) => t !== 'Main' && t !== 'Actions' && PC_PAGES.includes(t));
}
