/**
 * Per-surface switches for the card migration (docs/card-design.md section 9).
 *
 * Each sheet surface moves onto RecordCard in its own step. Until its step lands, its switch stays
 * false and the surface keeps its legacy render; its legacy assertions stay in a test block that runs
 * while the switch is off, so turning a surface back is one line here and its tests still hold.
 *
 * Step 3 (this file's birth): EVERY switch is false. The only live card path is DescriptionModal's
 * own (the browse popup) — and that is not a switch: DescriptionModal now IS the browse card.
 * Step 5: statDetail is on (StatDetailModal's full text renders RecordCard mode 'mine').
 * Step 6: hostPage is on (CampaignTracker's HostPage renders RecordCard mode 'gm', chrome 'embed').
 * Step 9: actionDetail is on (the Main-tab action popup renders RecordCard mode 'mine' for an action
 * that names its record: activities, feat / class-feature / granted actions, tactics, runes).
 * Step 11: featDetail is on (the Feats-tab popup — feats, class features, heritages, choice rows — renders
 * RecordCard mode 'mine' for the row's record; a heritage row reads the heritages bucket by its id).
 * Step 22 removes this file together with the legacy paths.
 *
 * Names follow section 6 ("mine" sheet popups, the builder rows, the GM page).
 */
export const CARD_ON = {
  /** StatDetailModal full text (step 5) — ON: the record's 'mine' card. */
  statDetail: true,
  /** HostPage in the campaign tracker, gm mode with embed chrome (step 6) — ON: the GM screen page is the card. */
  hostPage: true,
  /** ActionDetailModal on the Main tab (step 9) — ON: an action that names its record opens its 'mine' card. */
  actionDetail: true,
  /** StrikeDetailModal (step 10). */
  strikeDetail: false,
  /** FeatDetail: feats, class features, heritages, choice rows (step 11) — ON: the row's record opens its 'mine' card. */
  featDetail: true,
  /** ItemDetail (step 14). */
  itemDetail: false,
  /** Builder ChoiceDetails for granted features (step 15). */
  choiceDetails: false,
  /** SpellDetail (steps 16-17). */
  spellDetail: false,
  /** Details-tab class card (step 20). */
  detailsClassCard: false,
} as const satisfies Record<string, boolean>;

export type CardSurface = keyof typeof CARD_ON;

/** Is this surface rendered through the card yet? */
export function cardOn(surface: CardSurface): boolean {
  return CARD_ON[surface];
}
