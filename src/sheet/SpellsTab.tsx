import { useMemo, useState, type ReactNode } from 'react';
import { cleanRun } from './RichText';
import { listValues } from '../data';
import type { ActionCost, Character, ContentDatabase, Spell, SpellcastingEntry } from '../rules/types';
import { deityDomainsOf, deriveSpellcasting, deriveClassDc, entryClassIdOf, formatMod } from '../rules/derive';
import { signatureSpellsAt } from '../rules/build';
import { toggleKnownRitual,
  bumpItemCounter,
  bumpItemQuantity,
  poolKey,
  removeInventoryItem,
  setFocusUsed,
  setItemCounter,
  setPreparedSpell,
  setRestrictedSpell,
  setRestrictedRank,
  setTradedCantrip,
  prepareCantripOpening,
  addRepertoireSpell,
  removeRepertoireSpell,
  starsAtRank,
  toggleSignatureSpell,
  learnSpell,
  unlearnSpell,
  setSlotsUsed,
  toggleExpended,
  toggleInnateCast,
  addSpellTrade,
  removeSpellTrade,
  spellBlendingEntryId,
  spellTradeError,
  entryTrades,
  untradedIndices,
  slotKeyOf,
  tradeCost,
  CANTRIP_TRADE,
  CANTRIPS_PER_TRADE,
  type PlayUpdater,
} from '../rules/play';
import { itemCounters, chargesFor, chargeCounterId, chargeCostToCast, canCastFromItem, highestSlotRank } from '../rules/itemUses';
import { ActionGlyph, SituationalStar } from './widgets';
import { ItemDetail } from './ItemDetail';
import { useEscapeClose } from './useEscapeClose';
import { useIsMobile } from './useIsMobile';
import { confirmDialog } from './confirm';
import { rankBySearch, searchMatches } from '../data/searchRank';
import { FilterableSelect, PickerRow, descNodeOf } from './FilterableSelect';
import { SPELL_SPEC_BUILDER } from './filterSpecs';
import { DescBody, type RemasteredAs } from './DescBody';
import { DescriptionModal } from './DescriptionModal';
import type { DescNode } from './descref';
import { InfoTerm } from './InfoTerm';
import { PinStar } from './PinStar';
import { useContent } from './ContentContext';
import { useCustomization } from '../data/customization';
import { traitDesc, traitLabel } from '../rules/glossary';
import { spellNotesFor, spellSituationalFor, statHasSituational, statMarkClass, type StatRef } from '../rules/explain';
import { spellCostMatches } from '../rules/spellFilter';
import {
  cantripsOverOf,
  chosenAt,
  collectionUsed,
  hiddenAt,
  pickerSpellOptions,
  repertoireCap,
  restrictedAllowedOnBooks,
  signatureEchoIds,
  spellsHeldBy,
  traditionPool,
  variantGiftCount,
} from '../rules/spellOptions';
import { enabledBookSet, entrySourceOn } from '../rules/sources';
import { bookTitle, keptOffListNote, notInBookNote, overGiftNote, variantGiftNote } from '../rules/spellcasting';
import { heighteningApplies } from '../rules/heightening';
import { useAstNode } from './useAst';
import { isBucketLoaded, type AstNode } from './astStore';
import { HEIGHTEN_STRING_LANE, arrowAt, printedInsideFooter, spellCardModel, stringLaneFooter } from './spellCard';
import { isNotOwnPage } from './astVisibility';
/* Card step 17: the string lane's damage arrow (injectDamageArrow, moved unchanged so the parity gate
 * scripts/heighten-tree-parity.mjs reads the same function) and its tree twin. */
import { injectDamageArrow, injectTreeArrow, treeEntryApplies } from './heighteningTree';
import { AstRenderer } from './AstRenderer';
import { RemasteredLine } from './RemasteredLine';

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function ord(r: number): string {
  return r === 1 ? '1st' : r === 2 ? '2nd' : r === 3 ? '3rd' : `${r}th`;
}

/**
 * The spell popup's stat rows, in the order it prints them, as [label, value]. `Cast` always prints
 * (its value is the cast glyph or castText, drawn by the popup); every other row prints only when its
 * value is set. Card step 1: exported so the card's printed set (docs/card-design.md section 2 rule 4.2)
 * reads the SAME rows the popup renders. Card step 16: SpellDetail renders these only on its FIELD lane
 * (no tree, or a tree that is not a spell / ritual page); with a page, its rows are the page's own
 * (src/sheet/spellCard.ts pageStatLines). The fields themselves are unchanged — the engine reads them.
 */
export function spellStatRows(spell: Spell): [string, string | undefined][] {
  // These are printed as raw strings (not through the description renderer), so run them through the
  // same cleaner — a few records ship an unsubstituted AoN marker, e.g. Discomfiting Whisper's area
  // is "5-foot <%RULES%2387%%>emanation<%END>".
  return [
    ['Cast', undefined],
    ['Range', spell.range && cleanRun(spell.range)],
    ['Area', spell.area && cleanRun(spell.area)],
    ['Targets', spell.targets && cleanRun(spell.targets)],
    ['Duration', spell.duration && cleanRun(spell.duration)],
    [
      'Defense',
      // A spell attack (defense: 'ac') needs a spell attack roll vs AC; it may ALSO have a save.
      [
        spell.defense === 'ac' ? 'spell attack vs AC' : undefined,
        spell.save ? `${spell.save.basic ? 'basic ' : ''}${cap(spell.save.type)} save` : undefined,
      ]
        .filter(Boolean)
        .join(' + ') || undefined,
    ],
  ];
}

/**
 * Highest rank the character can cast — bounds SpellDetail's heightening rank selector. Includes the focus
 * auto-heighten target (ceil(level/2)) so a focus-only caster (champion/monk) can still see the heightened
 * text of e.g. Lay on Hands. Exported (polish round) so the Pinned list reopens a spell pin as the very
 * popup the Spells tab opens (MainTab PinnedDescCard), cast-at picker and auto-heightening included.
 */
export function spellMaxRank(character: Pick<Character, 'level' | 'spellcasting'>): number {
  const mains = character.spellcasting.filter((e) => e.type === 'prepared' || e.type === 'spontaneous');
  const focus = character.spellcasting.find((e) => e.type === 'focus');
  const itemEntries = character.spellcasting.filter((e) => e.type === 'items' || e.type === 'innate');
  return Math.max(
    0,
    focus ? Math.ceil(character.level / 2) : 0,
    // INNATE spells count too. A cantrip auto-heightens to ceil(level/2) — "A cantrip is heightened to
    // a spell rank equal to half your level rounded up" (Awakened Jewel, Awakened Magic, Bone Magic) —
    // and a leveled grant's own rank is the rank it is cast at. This list read prepared/spontaneous/
    // focus ONLY, so a character whose only magic is innate saw every cantrip frozen at its base rank
    // in the detail view, while a class caster's identical cantrip printed "heightened to 10th".
    ...itemEntries
      .filter((e) => e.type === 'innate')
      .flatMap((e) => [
        ...(e.cantrips.length ? [Math.ceil(character.level / 2)] : []),
        ...Object.keys(e.repertoire ?? {}).map(Number),
      ]),
    ...mains.flatMap((e) =>
      [...Object.keys(e.prepared ?? {}), ...Object.keys(e.repertoire ?? {}), ...Object.keys(e.slots ?? {})].map(Number),
    ),
  );
}

/** Signature spells (spontaneous casters) — the only spells SpellDetail keeps the "cast at" picker for. */
export function spellSignatureIds(spellcasting: readonly SpellcastingEntry[]): Set<string> {
  return new Set(spellcasting.flatMap((e) => (e.repertoire ? e.signature ?? [] : [])));
}

/** Detail overlay for a single spell, including its heightening entries. */
function castText(c?: ActionCost): string {
  if (!c) return '';
  if (c.type === 'duration') return c.text;
  return ''; // actions / reaction / free / variable are all shown by the action glyph
}

export function SpellDetail({
  spell,
  maxRank,
  atRank,
  signature,
  notes,
  onClose,
}: {
  spell: Spell;
  maxRank?: number;
  /** The rank of the SLOT this spell was opened from — a prepared/font slot heightens what it holds. */
  atRank?: number;
  signature?: boolean;
  /** Principle N2 — clauses a record the character HAS writes onto this spell (see spellNotesFor). */
  notes?: { from: string; note: string }[];
  onClose: () => void;
}) {
  const content = useContent();
  useEscapeClose(onClose);
  // Card step 16 (spells phase A, docs/card-design.md section 9 row 16; section 5): the stat rows come
  // from the spell's own Archives page (src/sheet/spellCard.ts pageStatLines), in printed order, in the
  // page's words. The stored fields stay for the engine and are printed only when the spell has no tree,
  // or its tree is not a spell / ritual page (the field lane). Until the tree loads the rows are a
  // placeholder. A homebrew id never resolves a page (section 2 rule 2f).
  const pageId = spell.id && !spell.id.startsWith('hb-') ? spell.id : undefined;
  const { node: tree, loading } = useAstNode(pageId ? 'spells' : undefined, pageId);
  // useAstNode seeds `loading` for a bucket that is loaded but holds no tree for this id; a loaded
  // bucket has answered, so only a bucket still on its way is a load.
  const rowsLoading = !!pageId && !!loading && !isBucketLoaded('spells');
  // ONE copy: the popup renders spellCardModel, the same function the card guard (card-scope.mjs's
  // spellDetail surface) and test/card-noop judge it with. Card step 17 (spells phase B): the body, the
  // Heightened entries and the psychic Amp group come from the page tree (`tree` — heighteningTree.ts
  // splitSpellTree) for every spell page except the few the parity gate keeps on the string lane
  // (src/data/heighten-string-lane.json, scripts/heighten-tree-parity.mjs); there, and with no page or
  // while the page loads, the body is the description string with the preamble the rows print taken
  // off its front, label by label (S-printed), as in phase A.
  const model = spellCardModel(spell, tree, spellStatRows(spell));
  const { lane, rows, base, heightening, body: bodyLane, tree: cut } = model;
  const fromPage = lane === 'page';
  const onTree = bodyLane === 'tree' && !!cut;
  // A spell the parity gate keeps on the string lane HAS a page — the same printing, which prints no line for
  // a Heightened entry our text carries; the text it shows is ours, not the page's, so it carries a marked footer
  // line naming that entry (section 7, section 10: "show our older text, marked as such"). A spell whose page
  // is a newer printing than our text is not kept: the page wins (owner rule R12; heighten-tree-parity.mjs).
  const keptOnString = !!pageId && HEIGHTEN_STRING_LANE.has(spell.id);
  const keptFooter = keptOnString ? stringLaneFooter(spell.id) : null;
  // Section 7 "No own page": an official spell (it names its book) whose page the loaded spells bucket does
  // not hold (or one on the not-own-page list) shows our older text, footed as such. Never while the bucket
  // is still on its way; never on an app-authored record (the seed's demo spells name no book: "never print").
  const noPage = !!pageId && !tree && !!spell.source?.book && (isBucketLoaded('spells') || isNotOwnPage('spells', pageId));
  // The orchestrator's round-3 ruling: a record whose tree is a page of another category (a feat, a rules
  // entry, a hazard) is printed inside that page; until the spells surface draws slices it keeps the string,
  // footed as ours with that page's title (work/card-step17-heighten-reprint-drift.json notOwnPage).
  const insideFooter = pageId ? printedInsideFooter(spell, tree) : null;
  // Every other spell page draws the page's body: while that page is on its way the body is a placeholder
  // too, never the old imported text it will replace (section 1: "not even while the page loads"; section 2
  // rule 3). A spell with no page, or whose loaded bucket holds no tree for it, keeps the string at once.
  const bodyLoading = rowsLoading && !keptOnString;
  // A cross-link in the page's prose opens that record's description popup, as DescBody's page path does.
  const [drill, setDrill] = useState<DescNode | null>(null);
  const openRecord = (bucket: string, slug: string) => {
    const rec = (content as unknown as Record<string, Record<string, { name: string; description?: string; descRefs?: Spell['descRefs'] }> | undefined> | null)?.[bucket]?.[slug];
    if (rec) setDrill({ title: rec.name, description: rec.description ?? '', descRefs: rec.descRefs, key: bucket, slug });
  };
  const remasteredAs = (spell as { remasteredAs?: RemasteredAs }).remasteredAs;
  const baseRank = spell.rank;
  const isCantrip = baseRank === 0;
  // "Focus spells are automatically heightened to half your level rounded up" — the same treatment
  // cantrips get, and 480 spells carry the trait.
  const isFocus = (spell.traits ?? []).includes('focus');
  const top = Math.min(10, Math.max(baseRank, maxRank ?? baseRank));
  // Only spontaneous SIGNATURE spells can be freely re-ranked, so they're the only ones with a "cast
  // at" picker. Cantrips auto-heighten to your max (viewed there, no picker); everything else is viewed
  // at its set rank (highlighted, no picker).
  const showPicker = !!signature && top > baseRank;
  // Focus spells heighten automatically to your maximum, exactly as cantrips do — "focus spells are
  // automatically heightened to half your level rounded up". Only cantrips were covered, so a focus
  // spell's detail view showed its 1st-rank damage forever.
  // …or the rank of the slot it was opened from: a spell prepared in a higher-rank slot is cast at
  // that slot's rank, so its numbers heighten to it (never past the entry's top).
  const autoRank = isCantrip || isFocus ? top : Math.min(top, Math.max(baseRank, atRank ?? baseRank));
  const [castRank, setCastRank] = useState<number>(showPicker ? baseRank : autoRank);
  const r = showPicker ? castRank : autoRank;
  // Upcast scaling at the viewed rank — inline damage in the prose, area on the stat. The orchestrator's
  // round-3 ruling (spellCard.ts arrowAt): drawn only where a printed Heightened entry of the text the player
  // reads applies at this rank and backs it — never at a rank the page does not grant (an engine interval the
  // page does not print, a newer printing with no Heightened line); the engine's values stay as they are.
  const { damage: upDamage, area: upArea } = arrowAt(spell, model, r);
  const shownBase = upDamage && spell.baseDamage ? injectDamageArrow(base, spell.baseDamage, upDamage) : base;
  // The tree lane's arrow: the same value (arrowAt) split into the first body text node holding the
  // base formula (heighteningTree.ts injectTreeArrow). Where no text node holds it, the arrow is an ours
  // line under the prose instead of lost (section 5: electrified-crystal-ward, shadow-illusion).
  const treeArrow = onTree && upDamage && spell.baseDamage ? injectTreeArrow(cut!.body, spell.baseDamage, upDamage) : null;
  const treeBody: AstNode | null = onTree ? { t: 'doc', c: treeArrow ? treeArrow.body : cut!.body } : null;
  const cardWalk = { printed: new Set(rows.map(([k]) => k)) };
  const selfRef = `spells:${spell.id}`;
  const applies = (e: { trigger: { type: 'rel' | 'abs'; n: number } | null }) => r > baseRank && treeEntryApplies(e, baseRank, r);
  const rankLabel = spell.rank === 0 ? 'Cantrip' : `${ord(spell.rank)} rank`;
  // The page's own Cast line ("somatic, verbal", "1 hour"); the glyph beside it stays the field's.
  const pageCast = fromPage ? (rows.find(([k]) => k === 'Cast')?.[1] ?? '') : '';
  // The area suffix rides on whichever Area row renders; on a page row only when the page's Area names
  // the whole base area ("<base>-foot <kind>"), so it never claims a shape the page does not print
  // (section 5: footholds-and-foothills prints a "30-foot radius", not a burst, and gets no suffix).
  const areaSuffix = (val: string) =>
    upArea != null && spell.baseArea && (!fromPage || val.includes(`${spell.baseArea.value}-foot ${spell.baseArea.kind}`)) ? (
      <span className="up-heighten" data-ours=""> (→ {upArea}-foot {spell.baseArea.kind})</span>
    ) : null;
  return (
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker spell-detail" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          {spell.name}
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            {/* card step 7a: `slug` = the spell's own id, so the pinned popup opens THIS spell's page
                (section 2 rule 2), never the page its name slugs to. Polish round (section 6: "A pin made
                from the sheet reopens as mine"): this popup is the Spells tab's — the character's own —
                so its pin stores mode 'mine' and MainTab's PinnedDescCard reopens it as this popup. */}
            <PinStar node={{ title: spell.name, description: spell.description, descRefs: spell.descRefs, key: 'spells', slug: spell.id, mode: 'mine' }} />
            <button className="picker-close" onClick={onClose} aria-label="Close">
              <i className="ti ti-x" aria-hidden="true" />
            </button>
          </span>
        </div>
        <div className="sd-body">
          <div className="sd-sub">
            {rankLabel}
            {spell.traditions?.length ? ` · ${spell.traditions.map(cap).join(', ')}` : ''}
          </div>
          {spell.traits?.length > 0 && (
            <div className="sd-traits">
              {spell.traits.map((t) => (
                <InfoTerm className="ff-trait" key={t} title={traitLabel(t)} description={traitDesc(t, content)}>
                  {traitLabel(t)}
                </InfoTerm>
              ))}
            </div>
          )}
          {rowsLoading ? (
            // The page is on its way: a quiet placeholder, never the field rows it will replace.
            <div className="sd-stats ast-loading" aria-busy="true" />
          ) : (
            <div className="sd-stats" data-lane={fromPage ? 'page' : 'field'}>
              {rows.map(([label, val], i) =>
                label === 'Cast' ? (
                  <div className="sd-stat" key={`${i}:Cast`}>
                    <span className="sd-stat-k">Cast</span>
                    <span className="sd-stat-v">
                      {pageCast ? (
                        <>
                          {/* A duration cast prints as the page's words alone; an action cost keeps its glyph. */}
                          {castText(spell.cast) ? null : <ActionGlyph cost={spell.cast} />}
                          {castText(spell.cast) || !spell.cast ? pageCast : ` ${pageCast}`}
                        </>
                      ) : (
                        castText(spell.cast) || <ActionGlyph cost={spell.cast} />
                      )}
                    </span>
                  </div>
                ) : (
                  <div className="sd-stat" key={`${i}:${label}`}>
                    <span className="sd-stat-k">{label}</span>
                    <span className="sd-stat-v">
                      {val}
                      {label === 'Area' && areaSuffix(val)}
                    </span>
                  </div>
                ),
              )}
            </div>
          )}
          {showPicker ? (
            // Signature spells: pick the cast rank.
            <div className="sd-rank-sel">
              <span className="sd-rank-lbl">Cast at</span>
              {Array.from({ length: top - Math.max(1, baseRank) + 1 }, (_, k) => Math.max(1, baseRank) + k).map((rr) => (
                <button key={rr} className={'sd-rank-chip' + (rr === r ? ' on' : '')} onClick={() => setCastRank(rr)}>
                  {ord(rr)}
                </button>
              ))}
            </div>
          ) : r > baseRank ? (
            // No choice (e.g. a cantrip auto-heightened to your max) — just highlight the viewed rank.
            <div className="sd-rank-sel">
              <span className="sd-rank-lbl">Cast at</span>
              <span className="sd-rank-chip on sd-rank-static">{ord(r)}</span>
            </div>
          ) : null}
          {onTree ? (
            /* Card step 17: the page's own prose, drawn by the mine card's walk (printed set = the rows).
               The arrow is an inline node of the page text (marked ours); an arrow with no anchor in the
               page is a line of the ours box after the page (below). desk #158's "Remastered as …" stays in
               the body, as DescBody draws it. */
            <div className="sd-desc" data-body="tree">
              <AstRenderer node={treeBody!} bodyOnly card={cardWalk} selfRef={selfRef} onOpenRef={openRecord} />
              {remasteredAs ? <RemasteredLine ra={remasteredAs} onOpen={openRecord} /> : null}
            </div>
          ) : bodyLoading ? (
            // The page body is on its way: a quiet placeholder, as for the rows above.
            <div className="sd-desc ast-loading" data-body="loading" aria-busy="true" />
          ) : (
            /* desk #158 — the `shownBase &&` guard was dropped so a spell whose text is empty can still
               show the "Remastered as …" line; DescBody still renders nothing when there is neither. */
            <DescBody description={shownBase} descRefs={spell.descRefs} onExit={onClose} remasteredAs={remasteredAs} />
          )}
          {onTree && cut!.heightening.length > 0 && (
            // Card step 17: every printed Heightened entry, each with what the page prints under it; the ones
            // that apply at the cast rank carry the rail (heightenTrigger on the entry's bold label).
            <div className="sd-heighten">
              <div className="sd-heighten-h">Heightening</div>
              {cut!.heightening.map((e, i) => (
                <div key={i} className={'sd-desc' + (applies(e) ? ' applies' : '')}>
                  <AstRenderer node={{ t: 'doc', c: e.nodes }} bodyOnly card={cardWalk} selfRef={selfRef} onOpenRef={openRecord} />
                </div>
              ))}
            </div>
          )}
          {onTree && cut!.after.length > 0 && (
            // Card step 17: a sidebar the page prints after its Heightened entries (Dragon Form's "Monster
            // Core Dragons" table) describes the spell, not one rank: drawn after the box, never railed.
            <div className="sd-desc sd-after" data-body="tree-after">
              <AstRenderer node={{ t: 'doc', c: cut!.after }} bodyOnly card={cardWalk} selfRef={selfRef} onOpenRef={openRecord} />
            </div>
          )}
          {onTree && cut!.amp.length > 0 && (
            // Card step 17: the psychic Amp paragraphs are their own group, never ordinary heightening; the
            // page's own bold "Amp" heads it (no heading of ours). An "Amp Heightened (+N)" entry carries the
            // rail at the ranks it applies to (when the spell is amped).
            <div className="sd-desc sd-amp">
              {cut!.amp.map((e, i) => (
                <div key={i} className={'sd-desc' + (applies(e) ? ' applies' : '')}>
                  <AstRenderer node={{ t: 'doc', c: e.nodes }} bodyOnly card={cardWalk} selfRef={selfRef} onOpenRef={openRecord} />
                </div>
              ))}
            </div>
          )}
          {!onTree && !bodyLoading && heightening.length > 0 && (
            <div className="sd-heighten">
              <div className="sd-heighten-h">Heightening</div>
              {heightening.map((h, i) => (
                <DescBody
                  key={i}
                  description={h}
                  descRefs={spell.descRefs}
                  className={'sd-desc' + (r > baseRank && heighteningApplies(h, baseRank, r) ? ' applies' : '')}
                  onExit={onClose}
                />
              ))}
            </div>
          )}
          {treeArrow && !treeArrow.found ? (
            // Card step 17 (section 4: one ours box after the body; section 5 "Damage arrow"): a heightened
            // damage the page prose gives no anchor for (electrified-crystal-ward, shadow-illusion) is a line
            // of ours after the page, never spliced into the page's body.
            <div className="card-ours sd-arrow-box" data-ours="">
              <p className="sd-ours sd-arrow-line card-ours-atYourLevel" data-ours="" data-ours-kind="atYourLevel">
                Heightened damage {spell.baseDamage} <span className="up-heighten">(→ {upDamage})</span>
              </p>
            </div>
          ) : null}
          {/* Last, boxed and headed by the record's name: everything above is the spell as printed,
              everything here is what one of YOUR records adds to it. Principle N2 — "make sure that
              it's under that feat in the spell description so the user won't think it's a part of the
              spell usually". */}
          {notes?.map((n, i) => (
            <div className="sd-addnote" key={`${n.from}:${i}`}>
              <div className="sd-addnote-h">
                <i className="ti ti-plus" aria-hidden="true" /> {n.from}
              </div>
              <DescBody description={n.note} className="sd-desc sd-addnote-body" onExit={onClose} />
            </div>
          ))}
          {onTree && cut!.foot.length > 0 && (
            // Card step 17 (section 2 rule 4.6): the page header's lines the rows do not print — its Source
            // line and a PFS Note, dimmed by the card walk — as the footer, after the ours box.
            <div className="sd-desc sd-foot">
              <AstRenderer node={{ t: 'doc', c: cut!.foot }} bodyOnly card={cardWalk} selfRef={selfRef} onOpenRef={openRecord} />
            </div>
          )}
          {keptFooter && (
            // Card step 17 (section 7 fallbacks; section 2 rule 4.6 footer): a spell kept on the string lane
            // shows our older text — said plainly, last, as ours, naming what its same-printing page omits.
            <p className="sd-ours card-nopage" data-ours="" data-ours-kind="stringLane">
              {keptFooter}
            </p>
          )}
          {noPage && (
            // Section 7 "No own page": the footer RecordCard draws for the same case, marked ours.
            <p className="sd-ours card-nopage" data-ours="" data-ours-kind="noPage">
              Not from the Archives — our text
            </p>
          )}
          {insideFooter && (
            // The round-3 ruling: a record printed inside a bigger page of another category, footed as ours.
            <p className="sd-ours card-nopage" data-ours="" data-ours-kind="notOwnPage">
              {insideFooter}
            </p>
          )}
        </div>
        {drill && <DescriptionModal root={drill} onClose={() => setDrill(null)} onExit={onClose} backToSource />}
      </div>
    </div>
  );
}

/** Group in ENCOUNTER order — insertion order of the first member — so two restricted groups always
 *  render in the order the records granted them, not alphabetically. */
function groupBy<T>(items: T[], key: (t: T) => string): [string, T[]][] {
  const out = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const cur = out.get(k);
    if (cur) cur.push(it);
    else out.set(k, [it]);
  }
  return [...out];
}

/*
 * WHAT A SLOT MAY HOLD lives in src/rules/spellOptions.ts, with no React in it, because the RENDER
 * has to ask the same question and used to have its own answer — `spellOptions` (this tab's old
 * `optionsFor`), `traditionPool`, the repertoire cap, and `spellOpenedBy`, re-exported here because
 * it was exported from this file first and two tests import it from here.
 */
export { spellOpenedBy } from '../rules/spellOptions';

/**
 * Table 4-3: Learning a Spell — the materials Price and the typical DC, by the spell's rank. Shown on
 * each row of the Learn a Spell picker so the cost of the activity is in front of you while you choose
 * it. Cantrips share the 1st-rank line ("1st or cantrip").
 */
const LEARN_A_SPELL: Record<number, { price: string; dc: number }> = {
  0: { price: '2 gp', dc: 15 },
  1: { price: '2 gp', dc: 15 },
  2: { price: '6 gp', dc: 18 },
  3: { price: '16 gp', dc: 20 },
  4: { price: '36 gp', dc: 23 },
  5: { price: '70 gp', dc: 26 },
  6: { price: '140 gp', dc: 28 },
  7: { price: '300 gp', dc: 31 },
  8: { price: '650 gp', dc: 34 },
  9: { price: '1,500 gp', dc: 36 },
  10: { price: '7,000 gp', dc: 41 },
};

/**
 * Does Learn a Spell do anything for this caster?
 *
 * Only where the repository is finite: a spellbook to write the spell into, or a repertoire whose
 * choices it widens. A cleric or druid "adds it to their spell list" — but their list is the whole
 * tradition, which the prepare picker already offers in full, so the activity would be a button that
 * changes nothing.
 */
export function canLearnSpells(entry: SpellcastingEntry): boolean {
  return (entry.type === 'prepared' || entry.type === 'spontaneous') && (!!entry.spellbook || !!entry.repertoire);
}

/** The full rules page for the activity, opened from the Learn a Spell popup. */
const LEARN_A_SPELL_NODE: DescNode = {
  title: 'Learn a Spell',
  key: 'actions',
  slug: 'learn-a-spell',
  description:
    'Spend 1 hour per spell rank studying with someone who knows the spell or from magical writing you ' +
    'have, expend materials of the listed Price, and attempt a check with the skill for your tradition. ' +
    'On a success you learn the spell; on a failure you can try again after you gain a level.',
};

/**
 * Learn a Spell — the exploration activity, which is how a caster's repository of spells grows between
 * level-ups. Adds to the spellbook (where the daily preparation can reach it) or, for a repertoire
 * caster, to a learned list the repertoire picker draws on; see `learnedSpells` in play.ts for why the
 * two differ.
 */
function LearnSpellModal({
  entry,
  character,
  content,
  onPlay,
  onClose,
}: {
  entry: SpellcastingEntry;
  character: Character;
  content: ContentDatabase;
  onPlay: PlayUpdater;
  onClose: () => void;
}) {
  useEscapeClose(onClose);
  const [picking, setPicking] = useState(false);
  const [rules, setRules] = useState(false);
  const pool = traditionPool(character, entry, content);

  // "…and you can cast spells of that rank." The highest rank this caster has any way to cast — slots
  // for a spontaneous caster, prepared slots for a prepared one.
  // …and never past what the BOOK can hold: a hedge mage's keepsake holds 1st-rank spells (2nd with
  // Expert, 3rd with Master) though its slots go to 8th (`entry.bookMaxRank`).
  const maxRank = Math.min(
    entry.bookMaxRank ?? Infinity,
    Math.max(
      0,
      ...Object.keys(entry.slots ?? {}).map(Number),
      ...Object.keys(entry.prepared ?? {}).map(Number),
      ...Object.keys(entry.repertoire ?? {}).map(Number),
    ),
  );

  // Already in the repository (or already learned) — offering it again would just create a duplicate.
  const known = new Set<string>([
    ...entry.cantrips,
    // `cantrips` is TODAY's openings on the overlaid entry; `cantripPool` is the build's own list, so a
    // cantrip the caster knows but did not prepare today is not offered back (checker, 2026-10-15).
    ...(entry.cantripPool ?? []),
    // A book caster's book holds more cantrips than it prepares today (owner's bug 2026-10-14).
    ...(entry.bookCantrips ?? []),
    ...Object.values(entry.spellbook ?? {}).flat(),
    ...Object.values(entry.repertoire ?? {}).flat(),
    ...Object.values(entry.learned ?? {}).flat(),
    // …and what a FEAT put in this entry (`spellSources`): Adapted Cantrip's on a prepared class is an
    // option, not in `cantrips`, so a Flexible Spellcaster cleric was offered to learn — and pay for — the
    // cantrip it already has (2026-10-15).
    ...Object.keys(entry.spellSources ?? {}),
  ]);

  // A caster who prepares from the whole tradition list (cleric, druid) has no spell to learn — the
  // picker is then the rituals route only (owner, 2026-09-02).
  const spellsLearnable = canLearnSpells(entry);
  // desk #170 (owner 2026-09-30, "yes the player sources should aplly to everything he has accses to"): only the
  // character's books (entrySourceOn: no book = always), except a spell a record adds to the list by name
  // (spellsHeldBy); what is already known is left out above either way.
  const books = enabledBookSet(character.enabledSources);
  const named = spellsHeldBy(character, entry);
  const options = spellsLearnable
    ? [
        ...(pool.byRank[0] ?? []),
        ...(maxRank >= 1 ? pool.upTo[maxRank] ?? [] : []),
      ].filter((s) => !known.has(s.id) && (entrySourceOn(books, s) || named.has(s.id)))
    : [];

  const learnedRanks = Object.keys(entry.learned ?? {})
    .map(Number)
    .filter((r) => (entry.learned?.[r] ?? []).length > 0)
    .sort((a, b) => a - b);

  const learn = (s: Spell) => {
    onPlay((p) => learnSpell(p, entry.id, s.rank, s.id));
    setPicking(false);
  };

  // Rituals are tradition-less by rule, so no entry's spell list ever offers one — they used to need a
  // separate "Learn a ritual" button and picker. Owner 2026-09-02: "the user will use Learn a spell to
  // learn a ritual", so that picker's candidate list (every ritual the character doesn't already know)
  // rides along here as a labelled group at the end of the results. Learning one still goes through
  // toggleKnownRitual — the path the page's Rituals section reads from.
  // …and, like the spells above, only from the character's books (desk #170); a known ritual is not offered anyway.
  const rituals = useMemo(() => {
    const have = new Set(character.knownRituals ?? []);
    const ritualBooks = enabledBookSet(character.enabledSources);
    return listValues(content, content.spells)
      .filter((s) => s.ritual && !have.has(s.id) && entrySourceOn(ritualBooks, s))
      .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  }, [content, character.knownRituals, character.enabledSources]);

  const learnRitual = (s: Spell) => {
    onPlay((p) => toggleKnownRitual(p, s.id));
    setPicking(false);
  };

  return (
    <>
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker manage-spells" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <span>Learn a spell — {cap(entry.tradition)}</span>
          <button className="picker-close" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Close">
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>

        {picking ? (
          <FilterableSelect
            title="Learn a spell"
            items={options}
            spec={SPELL_SPEC_BUILDER}
            rowKey={(s) => s.id}
            onClose={() => setPicking(false)}
            renderRow={(s, openDesc) => {
              const node = descNodeOf(s, 'spells');
              const cost = LEARN_A_SPELL[s.rank];
              return (
                <PickerRow
                  lead={
                    <span className="spell-cost">
                      <ActionGlyph cost={s.cast} />
                    </span>
                  }
                  name={s.name}
                  meta={
                    <div className="picker-traits">
                      {s.rank === 0 ? 'Cantrip' : `${ord(s.rank)} rank`}
                      {cost ? ` · ${cost.price} · DC ${cost.dc}` : ''}
                    </div>
                  }
                  onOpenDesc={node ? () => openDesc(node) : undefined}
                  selectLabel="Learn"
                  onSelect={() => learn(s)}
                />
              );
            }}
            // The Rituals group. Rendered in the footer rather than mixed into `items`: the spell
            // facets (tradition, rank against this entry's slots) describe a caster's spell list, and
            // a ritual is on nobody's list — filtering by them would silently hide every ritual. It
            // still answers the name search, which is how the group is actually used.
            resultsFooter={(q, openDesc) => {
              const ql = q.trim().toLowerCase();
              // bug 2026-09-13: search-rank — the ritual whose name was typed heads its group.
              const shown = ql ? rankBySearch(rituals.filter((s) => searchMatches(q, s.name)), q, (s) => s.name) : rituals;
              if (!shown.length) return null;
              return (
                <>
                  <div className="ms-rank-hdr">Rituals</div>
                  {shown.map((s) => {
                    const node = descNodeOf(s, 'spells');
                    return (
                      <PickerRow
                        key={s.id}
                        name={s.name}
                        meta={
                          <div className="picker-traits">
                            {`${ord(s.rank)} rank`}
                            {s.ritualPrimary ? ` · ${s.ritualPrimary}` : ''}
                          </div>
                        }
                        onOpenDesc={node ? () => openDesc(node) : undefined}
                        selectLabel="Learn"
                        onSelect={() => learnRitual(s)}
                      />
                    );
                  })}
                </>
              );
            }}
          />
        ) : (
          <div className="ms-body">
            <div className="ms-hint">
              {entry.spellbook
                ? `A spell you learn goes into your ${entry.bookNoun ?? 'spellbook'}, so you can prepare it from then on.`
                : 'A learned spell isn’t added to your repertoire automatically — you know only so many spells — but you can pick it the next time you add or swap one.'}{' '}
              <button type="button" className="ms-hint-link" onClick={() => setRules(true)}>
                Read the rules
              </button>
            </div>
            {learnedRanks.length === 0 ? (
              <div className="ms-cap-note">Nothing learned yet.</div>
            ) : (
              learnedRanks.map((rank) => (
                <div key={rank} className="ms-rank">
                  <div className="ms-rank-hdr">{rank === 0 ? 'Cantrips' : `${ord(rank)} rank`}</div>
                  {(entry.learned?.[rank] ?? []).map((id) => {
                    const sp = content.spells[id];
                    return (
                      <div key={id} className="ms-slot">
                        <span className="ms-slot-name">{sp?.name ?? id}</span>
                        <button
                          className="ms-remove"
                          aria-label="Unlearn"
                          title="Remove — you didn't learn this after all"
                          onClick={async () => {
                            if (
                              await confirmDialog({
                                title: `Unlearn ${sp?.name ?? id}?`,
                                message: entry.spellbook
                                  ? `The spell is struck from your ${entry.bookNoun ?? 'spellbook'}. Anything prepared from it keeps its slot until you re-prepare.`
                                  : 'The spell is no longer one you’ve learned.',
                                confirmLabel: 'Unlearn',
                                danger: true,
                              })
                            )
                              onPlay((p) => unlearnSpell(p, entry.id, rank, id));
                          }}
                        >
                          <i className="ti ti-x" aria-hidden="true" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
            {/* Rituals count: the picker has something to offer even when every spell on this
                entry's list is already known. */}
            <button className="ms-add" onClick={() => setPicking(true)} disabled={options.length === 0 && rituals.length === 0}>
              <i className="ti ti-plus" aria-hidden="true" /> Learn a spell
            </button>
          </div>
        )}
      </div>
    </div>
    {/* A SIBLING of the overlay, not a child: inside it, every click in the rules popup would bubble to
        the overlay's onClick and close the whole thing. */}
    {rules && <DescriptionModal root={LEARN_A_SPELL_NODE} onClose={() => setRules(false)} backToSource />}
    </>
  );
}

/** In-play spell management. PREPARED casters: change what's prepared in each slot
 *  (from the wizard's spellbook or the whole tradition list). SPONTANEOUS casters:
 *  add/remove repertoire spells per rank and set a signature spell (one per rank). */
function ManageSpellsModal({
  entry,
  character,
  content,
  onPlay,
  onClose,
}: {
  entry: SpellcastingEntry;
  character: Character;
  content: ContentDatabase;
  onPlay: PlayUpdater;
  onClose: () => void;
}) {
  useEscapeClose(onClose);
  /* Key off the entry's declared TYPE, never the mere presence of `repertoire`. A PREPARED entry that
   * picked up one granted spell used to flip to spontaneous here and hide all of its prepared ranks
   * behind an empty picker — an entry's kind is a property of the caster, not of which fields happen
   * to be populated. */
  const spontaneous = entry.type === 'spontaneous';
  const [picking, setPicking] = useState<{ rank: number; slot: number | null; cantripTrade?: boolean; preparedCantrip?: boolean; restricted?: string } | null>(null);
  const ranks = Object.keys((spontaneous ? entry.repertoire : entry.prepared) ?? {})
    .map(Number)
    .sort((a, b) => a - b);

  /* The class whose table decides signature spells is the one that OWNS this entry: the second class's
   * entry (`${classId2}-casting`, the id buildCharacter gives it) reads the second class's table. Read
   * off the first class alone, a Fighter/Bard's bard repertoire never offered a signature toggle, and a
   * Sorcerer/Oracle's oracle entry used the sorcerer's levels. */
  const entryClassId = entryClassIdOf(character, entry);
  const cls = entryClassId ? content.classes[entryClassId] : undefined;
  const sigAvailable =
    spontaneous && signatureSpellsAt(cls, character.level);

  const listReplacement = (() => {
    const r = character.spellListReplacement;
    return r && (!r.entryId || r.entryId === entry.id) ? r : undefined;
  })();

  /*
   * Spells you may add (spontaneous) / prepare (prepared) at a rank — rank ≤ the slot's rank.
   *
   * ⛔ The rule itself is `spellOptions` in src/rules/spellOptions.ts and nothing here may re-decide
   * it: the RENDER (applyPlayState) asks the same function about a pick the player already made, and
   * while the two were separate implementations they answered differently — a spell this picker had
   * offered stopped being drawn, or one it would refuse kept casting. All that is left here is the
   * DEDUPE, which is not legality: a rank does not offer what it already knows, and a cantrip opening
   * does not offer a cantrip another opening is holding.
   *
   * `entry` is the OVERLAID entry, so `restrictedSlots` includes the ones a toggled mode grants.
   */
  const optionsFor = (rank: number, restrictedId?: string, keep?: string | null): Spell[] => {
    // desk #170 (owner 2026-09-30, "yes the player sources should aplly to everything he has accses to"): the
    // picker offers the character's books, keeping what the entry holds; the render still asks the book-blind
    // `spellOptions`, so nothing held is pruned (pickerSpellOptions). `keep`: the asking cantrip opening's own
    // pick, which a book caster's picker keeps on offer in THAT opening only.
    const all = pickerSpellOptions({ character, entry, content }, rank, restrictedId, enabledBookSet(character.enabledSources), keep);
    if (!spontaneous || restrictedId) return all;
    const known = new Set(entry.repertoire?.[rank] ?? []);
    return all.filter((s) => !known.has(s.id));
  };

  /*
   * desk 155 / ruling #102 — A FLEXIBLE COLLECTION IS ONE FLAT POOL, NOT A REPERTOIRE PER RANK.
   *
   * `entry.spellCollection` is the pool size, stamped by fillSpellCollection (src/rules/build.ts); its
   * presence is what says this entry is a collection. Capping an add at the rank's own slot count is
   * the PF2e repertoire rule and is exactly wrong here: a 4th-level flexible wizard holding four
   * 1st-rank spells was told "Repertoire full (2 known)" while the pool still had two places, so the
   * ruling was unreachable from the sheet even though the engine had built it.
   *
   * Two carve-outs, both already modelled by the engine and mirrored rather than re-decided:
   *   · THE 1ST-RANK FLOOR — *"you must select at least one 1st-level spell for your collection each
   *     time you prepare"* (archetype-99). While no 1st-rank spell is collected, one place is reserved
   *     and cannot be spent on a higher rank.
   *   · THE 10TH-RANK CAPSTONE — that slot is a class feature's, not one of "the spell slots you get
   *     each day from your class spells", and flexibleCollectionSize() already excludes it. Rank 10
   *     keeps its own slot cap.
   */
  const collectionSize = entry.spellCollection;
  // A spontaneous caster knows at most as many spells per rank as they have slots of that rank (the
  // PF2e repertoire cap), or, for a flexible collection, as the flat pool has left — `repertoireCap`,
  // beside `spellOptions`, because the ADD GATE is the only place a cap is enforced and the render
  // has to know what that number was.
  const repCap = (rank: number) => repertoireCap(entry, rank);
  /** D5 — the count the gate refused on includes places the fresh build is not DRAWING, so where any
   *  are hidden the note SAYS so: "Repertoire full (4 known)" beside an empty list, with no ✕ and no
   *  Add, is a refusal whose cause is off screen. (A collection is one flat pool, so it counts the
   *  pool's hidden places rather than the rank's.) */
  const hiddenNote = (rank: number) => {
    const pooled = collectionSize !== undefined && rank >= 1 && rank <= 9;
    const n = pooled
      ? Array.from({ length: 9 }, (_, i) => hiddenAt(entry, i + 1)).reduce((a, b) => a + b, 0)
      : hiddenAt(entry, rank);
    return n ? ` — ${n} of them ${n === 1 ? 'is' : 'are'} not on your current spell list` : '';
  };
  /** What a refused add is called — a collection is full as a POOL, not at a rank. */
  const capNote = (rank: number) =>
    (collectionSize !== undefined && rank >= 1 && rank <= 9
      ? `Collection full (${collectionUsed(entry)} of ${collectionSize})`
      : `Repertoire full (${repCap(rank)} known)`) + hiddenNote(rank);
  /** D5 — over the cap is REPORTED, never hidden: every one of the player's spells is drawn and the
   *  rank says so. Only a build edit can produce the state (a level entered wrong, a subclass swap). */
  const overAt = (rank: number) => entry.overCap?.find((o) => o.rank === rank)?.by ?? 0;
  const overNote = (by: number) => `${by} over the limit — remove ${by > 1 ? 'some' : 'one'}`;

  const pick = (spellId: string | null) => {
    if (picking) {
      if (picking.preparedCantrip) {
        // A cantrip OPENING re-prepared for the day — before the spontaneous branch, because the
        // flexible spellcaster's entry is spontaneous-shaped and still prepares its cantrips.
        // …storing, with it, every opening showing a stand-in (`entry.cantripStandIns`), so this edit
        // cannot flip one back (prepareCantripOpening).
        onPlay((p) => prepareCantripOpening(p, entry, picking.slot!, spellId));
      } else if (picking.restricted) {
        onPlay((p) => setRestrictedSpell(p, picking.restricted!, spellId));
      } else if (spontaneous) {
        if (spellId) {
          const cur = entry.repertoire?.[picking.rank] ?? [];
          // The cap counts only player-CHOSEN spells — granted (bloodline/mystery/conscious-mind) spells
          // live in the repertoire too but don't count, matching the "Add" button's display gate. Counting
          // the full array here silently dropped a legal add whenever chosen + granted filled the slots.
          const granted = entry.grantedRepertoire?.[picking.rank] ?? [];
          if (!cur.includes(spellId) && chosenAt(entry, picking.rank) < repCap(picking.rank))
            // ⛔ The WRITER edits the stored list by this one id — never the rendered list `cur`, which
            // is missing whatever the build is currently hiding and carries grants that are not the
            // player's. `own` is the base for a rank the player has never touched.
            onPlay((p) =>
              addRepertoireSpell(p, entry.id, picking.rank, spellId, cur.filter((id) => !granted.includes(id)), granted),
            );
        }
      } else {
        if (picking.cantripTrade) onPlay((p) => setTradedCantrip(p, entry.id, picking.slot!, spellId));
        else onPlay((p) => setPreparedSpell(p, entry.id, picking.rank, picking.slot!, spellId, entry.prepared?.[picking.rank]?.[picking.slot!]));
      }
    }
    setPicking(null);
  };

  const removeKnown = (rank: number, id: string) => {
    const granted = entry.grantedRepertoire?.[rank] ?? [];
    const own = (entry.repertoire?.[rank] ?? []).filter((x) => !granted.includes(x));
    onPlay((p) => removeRepertoireSpell(p, entry.id, rank, id, own, granted));
  };

  /* A signature spell a RECORD granted is not the player's to un-star — the feat's text says it IS
   * one — so the ★ on it refuses rather than appearing to work and silently coming back. */
  const fixedSig = new Set(entry.signatureFixed ?? []);
  // One signature spell per rank: toggling a new one drops any existing same-rank signature.
  const toggleSig = (rank: number, id: string) => {
    if (fixedSig.has(id)) return;
    // A granted signature never yields its rank to a new pick, for the same reason. The write itself
    // edits the STORED star list by this one id (see toggleSignatureSpell): the rendered `signature`
    // holds the record's granted stars, which are not the player's to store, and omits any ★ the
    // build is currently hiding, which writing the whole list back would have thrown away.
    //
    // ⛔ D3 — and so is the list of stars it DISPLACES: `starsAtRank` reads the store, because this
    // read `entry.repertoire[rank]` (the drawn list) and left a ★ on a spell the render was hiding
    // undisplaced, which is two signature spells at one rank as soon as that spell comes back.
    //
    // ⚠ `rank` is THE RANK THIS ROW IS DRAWN UNDER — where the repertoire files the spell — and that
    // is the only rank a star is at. Passing the spell's own rank from `content` as a second reading
    // deleted the player's ★ on a lower-rank spell filed higher up, on an unrelated click (R2).
    const granted = entry.grantedRepertoire?.[rank] ?? [];
    const own = (entry.repertoire?.[rank] ?? []).filter((x) => !granted.includes(x));
    onPlay((p) => toggleSignatureSpell(p, entry.id, id, starsAtRank(p, entry.id, rank, own, granted).filter((x) => !fixedSig.has(x))));
  };

  // (The "Reset to default repertoire/preparation" button was removed at the owner's request, 2026-09-02.)

  const pickItems: Spell[] = !picking
    ? []
    : picking.preparedCantrip
      ? // Today's other openings already hold their cantrips — offer the rest (an at-will
        // cantrip prepared twice does nothing). The opening's own current pick stays offered.
        optionsFor(0, undefined, entry.cantripSlots?.[picking.slot!]).filter(
          (s) => !entry.cantrips.includes(s.id) || entry.cantripSlots?.[picking.slot!] === s.id,
        )
      : picking.cantripTrade
        ? optionsFor(0, undefined, entry.tradedCantrips?.[picking.slot!])
        : optionsFor(picking.rank, picking.restricted);
  /* A BOOK caster's picker adds only out of its book (owner's bug 2026-10-14), so a fresh wizard or magus
   * whose builder book holds nothing at this rank yet is offered nothing at all — and the list must say
   * where the spells come from, not "Nothing matches these filters" alone (lane C3, 2026-10-15). */
  const emptyBookNote =
    picking && entry.bookNoun && !picking.restricted && pickItems.length === 0
      ? `Your ${entry.bookNoun} holds nothing this ${picking.preparedCantrip || picking.cantripTrade ? 'opening' : 'slot'} can take yet — add spells to it in the builder.`
      : undefined;

  return (
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker manage-spells" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <span>
            {/* A replaced list still casts on its own tradition, so name BOTH — an elementalist wizard
                is an arcane caster picking from the elemental list, and the header used to say only
                "Arcane spells" while offering something else entirely. */}
            {`${spontaneous ? 'Repertoire' : 'Prepare'} — ${listReplacement ? `${cap(listReplacement.list)} list (${cap(entry.tradition)})` : `${cap(entry.tradition)} spells`}`}
          </span>
          <button className="picker-close" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Close">
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
        {listReplacement && (
          <div className="hint" style={{ margin: '0 0 8px' }}>
            {listReplacement.from} replaced your spell list with the {listReplacement.list} spell list; your tradition is
            unchanged.{listReplacement.note ? ` ${listReplacement.note}` : ''}
          </div>
        )}

        {picking ? (
          <FilterableSelect
            key={'pick-' + picking.rank + (picking.preparedCantrip ? ':c' : '')}
            title={picking.preparedCantrip ? 'Prepare a cantrip' : `${spontaneous && !picking.restricted ? 'Add' : 'Prepare'} a ${ord(picking.rank)}-rank spell`}
            items={pickItems}
            spec={SPELL_SPEC_BUILDER}
            rowKey={(s) => s.id}
            onClose={() => setPicking(null)}
            resultsFooter={emptyBookNote ? () => <div className="fsel-empty ms-book-empty">{emptyBookNote}</div> : undefined}
            headerExtra={
              !spontaneous || picking.restricted || picking.preparedCantrip ? (
                <button className="fsel-arch" onClick={() => pick(null)}>
                  Leave slot empty
                </button>
              ) : undefined
            }
            renderRow={(s, openDesc) => {
              const node = descNodeOf(s, 'spells');
              // A repertoire add that `pick` would refuse — already known at this rank, or the rank
              // full. Both bail without touching state, so the row has to say so rather than look live.
              const addingToRepertoire = spontaneous && !picking.restricted && !picking.preparedCantrip;
              const cur = addingToRepertoire ? entry.repertoire?.[picking.rank] ?? [] : [];
              const alreadyKnown = addingToRepertoire && cur.includes(s.id);
              // `chosenAt`, not the drawn list: what the player HOLDS at the rank includes the picks
              // the fresh build is hiding, and counting only the visible ones is how the sheet could
              // hand out places a rank did not have (see repertoireHeld).
              const rankFull = addingToRepertoire && chosenAt(entry, picking.rank) >= repCap(picking.rank);
              const cantAdd = alreadyKnown || rankFull;
              return (
                <PickerRow
                  lead={
                    <span className="spell-cost">
                      <ActionGlyph cost={s.cast} />
                    </span>
                  }
                  name={s.name}
                  meta={
                    <div className="picker-traits">
                      {s.rank === 0 ? 'Cantrip' : `${ord(s.rank)} rank`}
                      {/* "you can select it when you add or swap spells" — this is that moment, so say
                          which of the options you already paid an hour and materials to learn. Only for
                          a repertoire: a spellbook caster's learned spells are IN the book, so every
                          option would carry the tag and it would say nothing. */}
                      {spontaneous && (entry.learned?.[s.rank] ?? []).includes(s.id) && ' · learned'}
                    </div>
                  }
                  onOpenDesc={node ? () => openDesc(node) : undefined}
                  selectLabel={addingToRepertoire ? 'Add' : 'Prepare'}
                  selectDisabled={cantAdd}
                  disabledReason={
                    alreadyKnown
                      ? 'Already in your repertoire at this rank.'
                      : rankFull
                        ? // D5 — the refusal names every reason it is refusing, including the places
                          // the fresh build is not drawing (hiddenNote): the count in this sentence
                          // is the STORE's, so without it the player reads "full (4 known)" over a
                          // list of two and has nothing on screen to act on.
                          (collectionSize !== undefined && picking.rank >= 1 && picking.rank <= 9
                            ? `Your spell collection is full (${collectionUsed(entry)} of ${collectionSize})${chosenAt(entry, 1) === 0 && picking.rank !== 1 ? ' — one place is held for a 1st-rank spell' : ''}`
                            : `Your ${ord(picking.rank)}-rank repertoire is full (${repCap(picking.rank)} known)`) +
                          hiddenNote(picking.rank) +
                          '.'
                        : undefined
                  }
                  onSelect={() => pick(s.id)}
                />
              );
            }}
          />
        ) : (
          <div className="ms-body">
            <div className="ms-hint">
              {spontaneous
                ? 'Add or remove known spells; tap ★ to set a rank’s signature spell. Changes apply to this play session.'
                : entry.bookNoun
                  ? // A book caster prepares only out of its book (owner's bug 2026-10-14), so the list is
                    // shorter than the tradition on purpose — said, so it does not read as a bug.
                    `Tap a slot to change what’s prepared — from your ${entry.bookNoun}; add spells to it in the builder. Changes apply to this play session.`
                  : 'Tap a slot to change what’s prepared. Changes apply to this play session.'}
            </div>
            {/* "You prepare your cantrips" — a prepared caster's cantrips are part of daily
                preparations (owner, 2026-09-02), so they re-prepare here like any slot. Granted
                cantrips (a psychic's psi cantrips) are not openings and don't appear — the overlay
                keeps them whatever is prepared. */}
            {entry.cantripsPrepared && (entry.cantripCap ?? 0) > 0 && (
              <div className="ms-rank">
                <div className="ms-rank-hdr">Cantrips</div>
                {(entry.cantripSlots ?? Array.from({ length: entry.cantripCap! }, (_, i) => entry.cantrips[i] ?? null)).map((id, i) => {
                  const sp = id ? content.spells[id] : null;
                  return (
                    <button
                      key={'pc' + i}
                      className={'ms-slot' + (id ? '' : ' empty')}
                      onClick={() => setPicking({ rank: 0, slot: i, preparedCantrip: true })}
                    >
                      <span className="ms-slot-name">
                        {sp?.name ?? 'Empty cantrip'}
                        <OffBookTag entry={entry} id={id} />
                      </span>
                      <i className="ti ti-pencil" aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
            )}
            {ranks.map((rank) =>
              spontaneous ? (
                (() => {
                  // Bloodline/mystery/muse spells never spend one of the player's places and can't be
                  // removed in play. (A sorcerer's gift is one of the rank's places by print, so its
                  // allowance is that much smaller — `repertoireCap` subtracts it, lane C2.)
                  const granted = entry.grantedRepertoire?.[rank] ?? [];
                  const knownCount = chosenAt(entry, rank);
                  // The flat pool's own report rides the first rank shown — a collection has no rank
                  // of its own to hang it on.
                  const over = overAt(rank) || (rank === ranks[0] ? overAt(0) : 0);
                  return (
                <div key={rank} className="ms-rank">
                  <div className="ms-rank-hdr">{ord(rank)} rank</div>
                  {!!over && <div className="ms-cap-note">{overNote(over)}</div>}
                  {(entry.repertoire?.[rank] ?? []).map((id) => {
                    const sp = content.spells[id];
                    const isSig = entry.signature?.includes(id);
                    const isGranted = granted.includes(id);
                    return (
                      <div key={id} className={'ms-slot' + (isSig ? ' sig' : '')}>
                        {sigAvailable && (
                          <button
                            className={'ms-sig' + (isSig ? ' on' : '') + (fixedSig.has(id) ? ' fixed' : '')}
                            title={
                              fixedSig.has(id)
                                ? 'Signature spell — granted, so it can’t be unset'
                                : isSig
                                  ? 'Signature spell — click to unset'
                                  : 'Set as signature spell'
                            }
                            aria-label="Toggle signature spell"
                            aria-disabled={fixedSig.has(id) || undefined}
                            disabled={fixedSig.has(id)}
                            onClick={() => toggleSig(rank, id)}
                          >
                            <i className="ti ti-star" aria-hidden="true" />
                          </button>
                        )}
                        <span className="ms-slot-name">
                          {sp?.name ?? id}
                          {!isGranted && <OffBookTag entry={entry} id={id} />}
                        </span>
                        {isGranted ? (
                          <span className="ms-granted" title="Granted by your bloodline/mystery — always known">
                            <i className="ti ti-lock" aria-hidden="true" />
                          </span>
                        ) : (
                          <button
                            className="ms-remove"
                            aria-label="Remove from repertoire"
                            title="Remove from repertoire"
                            onClick={async () => {
                              if (
                                await confirmDialog({
                                  title: `Remove ${sp?.name ?? id}?`,
                                  message: 'The spell is removed from your repertoire.',
                                  confirmLabel: 'Remove',
                                  danger: true,
                                })
                              )
                                removeKnown(rank, id);
                            }}
                          >
                            <i className="ti ti-x" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {knownCount < repCap(rank) ? (
                    <button className="ms-add" onClick={() => setPicking({ rank, slot: null })}>
                      <i className="ti ti-plus" aria-hidden="true" /> Add {ord(rank)}-rank spell
                    </button>
                  ) : (
                    <div className="ms-cap-note">{capNote(rank)}</div>
                  )}
                </div>
                  );
                })()
              ) : (
                <div key={rank} className="ms-rank">
                  <div className="ms-rank-hdr">{ord(rank)} rank</div>
                  {(entry.prepared?.[rank] ?? []).map((slot, i) => {
                    const sp = slot.spellId ? content.spells[slot.spellId] : null;
                    // A slot traded away is not preparable — it is shown so the trade is visible, not
                    // so it can be filled.
                    if (slot.traded)
                      return (
                        <div key={i} className="ms-slot empty" aria-disabled="true">
                          <span className="ms-slot-name">Traded away (spell blending)</span>
                        </div>
                      );
                    return (
                      <button
                        key={i}
                        className={'ms-slot' + (slot.spellId ? '' : ' empty')}
                        onClick={() => setPicking({ rank, slot: i })}
                      >
                        <span className="ms-slot-name">
                          {sp?.name ?? (slot.spellId || 'Empty slot')}
                          {slot.bonusFrom != null && <em className="ms-slot-tag"> · bonus from {ord(slot.bonusFrom)}</em>}
                          <OffBookTag entry={entry} id={slot.spellId} />
                        </span>
                        <i className="ti ti-pencil" aria-hidden="true" />
                      </button>
                    );
                  })}
                </div>
              ),
            )}
            {/* Restricted slots — their own group, because they are not slots of the ranks above:
                what may go in them is narrower, and Sin Reservoir's rank moves at each preparation. */}
            {groupBy(entry.restrictedSlots ?? [], (s) => s.label).map(([label, group]) => (
              <div key={'rs-' + label} className="ms-rank">
                <div className="ms-rank-hdr">{label}</div>
                {group[0].note && <div className="ms-cap-note">{group[0].note}</div>}
                {group.map((slot) => {
                  const sp = slot.spellId ? content.spells[slot.spellId] : null;
                  // A spontaneous caster prepares nothing — its restricted slot is one extra CAST, so
                  // there is no SPELL to pick and the pip says so. The RANK select still renders: a
                  // rank-choice group ("designate one of your spell slots" — Master Summoner) is
                  // answered by this control and no other, and returning before it left the printed
                  // designation unanswerable for every spontaneous bounded caster. The ordinary slot
                  // it costs is deducted by the play overlay against the group's FINAL rank
                  // (play.ts's documented invariant), so the select is the whole fix.
                  if (slot.spontaneous)
                    return (
                      <div key={slot.id} style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
                        <div className="ms-slot empty" style={{ flex: 1 }} aria-disabled="true">
                          <span className="ms-slot-name">
                            {ord(slot.rank)} rank — one extra cast<em className="ms-slot-tag"> · spend it on the sheet</em>
                          </span>
                        </div>
                        {!!slot.rankOptions?.length && (
                          <select
                            className="ms-rank-select"
                            aria-label="Slot rank"
                            value={slot.rank}
                            onChange={(ev) => onPlay((p) => setRestrictedRank(p, slot.id, Number(ev.target.value)))}
                          >
                            {slot.rankOptions.map((r) => (
                              <option key={r} value={r}>
                                {ord(r)}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    );
                  // Spell Combination: the slot holds TWO spells, so it shows two buttons. The second
                  // is keyed `<id>#2`, which rides the same prepared-spells map as the first.
                  const sp2 = slot.pairs && slot.spellId2 ? content.spells[slot.spellId2] : null;
                  return (
                    <div key={slot.id} style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
                      <button className={'ms-slot' + (slot.spellId ? '' : ' empty')} style={{ flex: 1 }} onClick={() => setPicking({ rank: slot.rank, slot: null, restricted: slot.id })}>
                        <span className="ms-slot-name">
                          {sp?.name ?? (slot.spellId || 'Empty slot')}
                          <em className="ms-slot-tag"> · {ord(slot.rank)} rank{slot.maxRank ? ` · up to ${ord(slot.maxRank)}` : ''}</em>
                          {slot.keptOffList ? <em className="ms-slot-tag spell-offbook"> · {keptOffListNote(slot.label)}</em> : <OffBookTag entry={entry} id={slot.spellId} />}
                        </span>
                        <i className="ti ti-pencil" aria-hidden="true" />
                      </button>
                      {slot.pairs && (
                        <button
                          className={'ms-slot' + (slot.spellId2 ? '' : ' empty')}
                          style={{ flex: 1 }}
                          onClick={() => setPicking({ rank: slot.rank, slot: null, restricted: `${slot.id}#2` })}
                        >
                          <span className="ms-slot-name">
                            {sp2?.name ?? (slot.spellId2 || 'Empty — second spell')}
                            <em className="ms-slot-tag"> · combined</em>
                            <OffBookTag entry={entry} id={slot.spellId2} />
                          </span>
                          <i className="ti ti-pencil" aria-hidden="true" />
                        </button>
                      )}
                      {!!slot.rankOptions?.length && (
                        <select
                          className="ms-rank-select"
                          aria-label="Slot rank"
                          value={slot.rank}
                          onChange={(ev) => onPlay((p) => setRestrictedRank(p, slot.id, Number(ev.target.value)))}
                        >
                          {slot.rankOptions.map((r) => (
                            <option key={r} value={r}>
                              {ord(r)}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
            {!!entry.tradedCantrips?.length && (
              <div className="ms-rank">
                <div className="ms-rank-hdr">Traded cantrips</div>
                {entry.tradedCantrips.map((id, i) => {
                  const sp = id ? content.spells[id] : null;
                  return (
                    <button key={i} className={'ms-slot' + (id ? '' : ' empty')} onClick={() => setPicking({ rank: 0, slot: i, cantripTrade: true })}>
                      <span className="ms-slot-name">
                        {sp?.name ?? 'Empty cantrip'}
                        <OffBookTag entry={entry} id={id} />
                      </span>
                      <i className="ti ti-pencil" aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Spell Blending — the wizard thesis's daily slot trade.
 *
 * "During your daily preparations, you can trade two spell slots of the same spell rank for a bonus
 * spell slot of up to 2 spell ranks higher… Bonus spell slots must be of a spell rank you can normally
 * cast, and each bonus spell slot must be of a different spell rank. You can also trade any spell slot
 * for two additional cantrips, though you can't trade more than one spell slot at a time for
 * additional cantrips in this way."
 *
 * Every one of those limits is enforced by `spellTradeError`, whose sentence becomes the disabled
 * reason here — a silently ignored click would read as a broken button.
 */
function SpellBlendingModal({
  entry,
  onPlay,
  onClose,
}: {
  entry: SpellcastingEntry;
  onPlay: PlayUpdater;
  onClose: () => void;
}) {
  const ranks = Object.keys(entry.prepared ?? {})
    .map(Number)
    .filter((r) => r > 0)
    .sort((a, b) => a - b);
  const trades = entryTrades(entry);

  const targets = (from: number) => [from + 1, from + 2, CANTRIP_TRADE];
  const label = (to: number) => (to === CANTRIP_TRADE ? `${CANTRIPS_PER_TRADE} cantrips` : `${ord(to)} slot`);

  return (
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker manage-spells" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <span>Spell Blending — trade slots</span>
          <button className="picker-close" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Close">
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
        <div className="ms-body">
          <div className="ms-hint">
            Trade two slots of the same rank for one bonus slot up to two ranks higher, or one slot for{' '}
            {CANTRIPS_PER_TRADE} extra cantrips. Part of your daily preparations.
          </div>

          {trades.length > 0 && (
            <div className="ms-rank">
              <div className="ms-rank-hdr">Traded today</div>
              {trades.map((t, i) => (
                <div key={i} className="ms-slot">
                  <span className="ms-slot-name">
                    {t.to === CANTRIP_TRADE
                      ? `1 slot → ${CANTRIPS_PER_TRADE} cantrips`
                      : `2 × ${ord(t.from)} → one ${ord(t.to)} slot`}
                  </span>
                  <button className="ms-btn" onClick={() => onPlay((p) => removeSpellTrade(p, entry.id, t.to))}>
                    <i className="ti ti-rotate" aria-hidden="true" /> Undo
                  </button>
                </div>
              ))}
            </div>
          )}

          {ranks.map((from) => {
            const free = untradedIndices(entry, from).length;
            return (
              <div key={from} className="ms-rank">
                <div className="ms-rank-hdr">
                  {ord(from)} rank <span className="spell-rankhdr-right">{free} untraded</span>
                </div>
                {targets(from).map((to) => {
                  const err = spellTradeError(entry, from, to);
                  return (
                    <button
                      key={to}
                      className={'ms-slot' + (err ? ' empty' : '')}
                      disabled={!!err}
                      title={err ?? undefined}
                      onClick={() => onPlay((p) => addSpellTrade(p, entry, from, to))}
                    >
                      <span className="ms-slot-name">
                        {tradeCost(to)} × {ord(from)} → {label(to)}
                        {err && <em className="ms-slot-tag"> · {err}</em>}
                      </span>
                      {!err && <i className="ti ti-arrow-right" aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const COST_FILTERS: { id: string; label: string; cost: ActionCost }[] = [
  { id: '1', label: 'one action', cost: { type: 'actions', value: 1 } },
  { id: '2', label: 'two actions', cost: { type: 'actions', value: 2 } },
  { id: '3', label: 'three actions', cost: { type: 'actions', value: 3 } },
  { id: 'f', label: 'free action', cost: { type: 'free' } },
  { id: 'r', label: 'reaction', cost: { type: 'reaction' } },
];

/**
 * "Not in your spellbook — add it in the builder" — a pick this entry is DRAWING that its book does not
 * hold (`entry.notInBook`, written by applyPlayState). The spell stays prepared and castable; the tag
 * says why the picker will not offer it again once it is changed (owner's bug 2026-10-14). Nothing for
 * a spell in the book, or an entry with no book.
 */
/** The player's own picks drawn PAST a sorcerer's allowance — the last `by` of them, in the order the
 *  rank draws them (the builder's pick order, the gift first), so the one marked is the one a builder
 *  from before lane C2 let them add beside the gift. Empty unless the entry counts its gift inside.
 *  Never a spell a feat put there (`spellSources` — Adapted Cantrip's, drawn last): it is not one of the
 *  player's picks, and `cantripsOverOf` does not count it (2026-10-15). */
function pastGiftIds(entry: SpellcastingEntry, ids: string[], granted: string[], by: number): Set<string> {
  if (!entry.grantsCountInside || by <= 0) return new Set();
  const fromFeats = entry.spellSources ?? {};
  return new Set(ids.filter((id) => !granted.includes(id) && !(id in fromFeats)).slice(-by));
}

function offBookNote(entry: SpellcastingEntry, id: string | null | undefined): string | undefined {
  return id && entry.notInBook?.includes(id) ? notInBookNote(entry.bookNoun) : undefined;
}
function OffBookTag({ entry, id }: { entry: SpellcastingEntry; id: string | null | undefined }) {
  const note = offBookNote(entry, id);
  return note ? <em className="ms-slot-tag spell-offbook"> · {note}</em> : null;
}

function SpellCard({
  name,
  cost,
  meta,
  sig,
  fp,
  pip,
  onPip,
  empty,
  onClick,
  onCast,
  castDisabled,
  castTitle,
  marks,
  note,
}: {
  name: string;
  cost?: ActionCost;
  meta: string;
  sig?: boolean;
  fp?: boolean;
  pip?: 'filled' | 'empty';
  /** When set, the slot pip becomes a button that expends/restores this slot. */
  onPip?: () => void;
  empty?: boolean;
  onClick?: () => void;
  /** When set, a "Cast" button on the card spends the item's charges to cast this spell. */
  onCast?: () => void;
  castDisabled?: boolean;
  castTitle?: string;
  /** Ruling G: conditional bonuses that belong on THIS spell, because the spell is what you are
   *  looking at when you cast it. Display-only, like every other star. */
  marks?: { source: string; when: string; bonus: string }[];
  /** A short warning line under the card — "Not in your spellbook — add it in the builder" (offBookNote). */
  note?: string;
}) {
  return (
    <div
      className={'spell-card' + (empty ? ' empty' : '') + (onClick ? ' clickable' : '')}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onClick()) : undefined}
    >
      <div className="spell-top">
        <span className="spell-cost">
          <ActionGlyph cost={cost} />
        </span>
        <span className="spell-name">{name}</span>
        {sig && <i className="ti ti-star spell-star" aria-hidden="true" />}
        {!!marks?.length && (
          <span className="spell-mark" title={marks.map((m) => `${m.bonus} from ${m.source} — ${m.when}`).join('\n')}>
            <SituationalStar />
          </span>
        )}
      </div>
      <div className="spell-meta">
        <span className="spell-meta-text">{meta}</span>
        {fp && <span className="fp-tag">1 FP</span>}
        {pip &&
          (onPip ? (
            <button
              type="button"
              className={'slot-pip btn' + (pip === 'filled' ? ' on' : '')}
              title={pip === 'filled' ? 'Cast — click to restore' : 'Click to cast (expend slot)'}
              aria-label={pip === 'filled' ? 'Restore slot' : 'Expend slot'}
              onClick={(e) => {
                e.stopPropagation();
                onPip();
              }}
            />
          ) : (
            <span className={'slot-pip' + (pip === 'filled' ? ' on' : '')} />
          ))}
        {onCast && (
          <button
            type="button"
            className="spell-cast-btn"
            disabled={castDisabled}
            title={castTitle ?? 'Cast'}
            aria-label={castTitle ?? 'Cast'}
            onClick={(e) => {
              e.stopPropagation();
              onCast();
            }}
          >
            <i className="ti ti-bolt" aria-hidden="true" /> Cast
          </button>
        )}
      </div>
      {note && <div className="spell-offbook-note">{note}</div>}
    </div>
  );
}

export function SpellsTab({
  character,
  content,
  onPlay,
  onOpenStat,
}: {
  character: Character;
  content: ContentDatabase;
  onPlay?: PlayUpdater;
  onOpenStat?: (ref: StatRef) => void;
}) {
  const isMobile = useIsMobile();
  const custom = useCustomization();
  // Ruling G: a bonus that belongs to a SPELL marks the spell's own card, "since that's what you're
  // looking at when you cast it". Gated on the character actually having the record that grants it.
  const marksFor = (spellId?: string) => (spellId ? spellSituationalFor(character, content, spellId) : []);
  const [filters, setFilters] = useState<Set<string>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(false); // mobile: filter row toggles open over the results
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<Spell | null>(null);
  /* The rank of the SLOT a spell was opened from. A spell prepared in (or cast from) a higher-rank
   * slot IS heightened to that slot — a rank-2 font Heal is 2d8, and the popup showed 1d8 forever.
   * Set by the prepared-slot and font cards, cleared by every other opener (openDetail). */
  const [detailAtRank, setDetailAtRank] = useState<number | undefined>(undefined);
  const openDetail = (sp: Spell, atRank?: number) => {
    setDetailAtRank(atRank);
    setDetail(sp);
  };
  // Mobile: the spellcasting-detail popup (which entry's details are shown), opened by tapping the header.
  const [scInfo, setScInfo] = useState<string | null>(null);
  // Mobile: which spell section tab is active (cantrips / a rank / focus / items / …); '' = first.
  const [spellTab, setSpellTab] = useState<string>('');
  const [manageId, setManageId] = useState<string | null>(null);
  const [learnId, setLearnId] = useState<string | null>(null);
  const [blendId, setBlendId] = useState<string | null>(null);
  // An item-spell source opened from its Spells-page header → the item's full detail popup.
  const [itemView, setItemView] = useState<string | null>(null);
  // Collapsible spellcasting sections (in-component, like the Actions sub-tab).
  const [collapsedSecs, setCollapsedSecs] = useState<Set<string>>(new Set());
  // Always open when there's no chevron to reopen it with — otherwise a section collapsed while there
  // were several of them would be stuck shut if the page later came down to one.
  const secOpen = (id: string) => collapsibleSections < 2 || !collapsedSecs.has(id);
  const toggleSec = (id: string) =>
    setCollapsedSecs((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  /* Collapsing is for getting one section out of the way of the others. With a single section on the
   * page there is nothing to get out of the way of — the chevron would only ever hide the entire page's
   * contents — so it isn't drawn. `collapsibleSections` is counted just before the render, once every
   * section node exists. Only ever READ from JSX, so it's initialised long before this runs. */
  const SecChevron = ({ id }: { id: string }) =>
    collapsibleSections < 2 ? null : (
      <button type="button" className="sc-collapse" aria-expanded={secOpen(id)} title={secOpen(id) ? 'Collapse' : 'Expand'} onClick={() => toggleSec(id)}>
        <i className={'ti ' + (secOpen(id) ? 'ti-chevron-down' : 'ti-chevron-right')} aria-hidden="true" />
      </button>
    );
  const mains = character.spellcasting.filter((e) => e.type === 'prepared' || e.type === 'spontaneous');
  const manageEntry = manageId ? mains.find((m) => m.id === manageId) : null;
  const learnEntry = learnId ? mains.find((m) => m.id === learnId) : null;
  const blendEntry = blendId ? mains.find((m) => m.id === blendId) : null;
  // The wizard's arcane thesis — and the ONE entry it trades on (the wizard's own), the same answer the
  // render's `liveTrades` reads, so the button and the slots cannot disagree about which card it is.
  const blendOwnerId = useMemo(() => spellBlendingEntryId(character, content), [character, content]);
  const focusEntries = character.spellcasting.filter((e) => e.type === 'focus');
  const focus = focusEntries[0]; // first entry — for existence checks + maxCastRank; rendering uses focusEntries
  const itemEntries = character.spellcasting.filter((e) => e.type === 'items' || e.type === 'innate');
  // The character's OWN rituals: what Overrides → Add spell put here, PLUS what a record TAUGHT them
  // — "You learn the Commune ritual if you didn't know it already". Eleven feats/features/items say
  // exactly that, and none of them reached this list, so the section stayed empty for all of them.
  // With none from either source the section (and its catalog bar) is hidden entirely.
  const myRituals = useMemo(() => {
    const granted = new Map((character.grantedRituals ?? []).map((g) => [g.spellId, g]));
    const ids = [
      ...new Set([
        ...(character.overrides?.addedSpells ?? []).map((a) => a.spellId),
        ...granted.keys(),
        // …and the ones the player LEARNED, through the picker in the section below. 148 of the 151
        // rituals are on no spell list (rituals are tradition-less by rule), so before this the only
        // route to one was Setup → Overrides — the rule-BREAKING panel — for an ordinary thing a
        // character does.
        ...(character.knownRituals ?? []),
      ]),
    ];
    return ids
      .map((id) => content.spells[id])
      .filter((s): s is Spell => !!s && !!s.ritual)
      .map((s) => ({ spell: s, grant: granted.get(s.id) }))
      .sort((a, b) => a.spell.rank - b.spell.rank || a.spell.name.localeCompare(b.spell.name));
  }, [character.overrides, character.grantedRituals, character.knownRituals, content]);
  // Highest rank the character can cast — bounds the heightening rank selector (spellMaxRank, shared
  // with the Pinned list's reopened spell pin, MainTab PinnedDescCard).
  const maxRank = spellMaxRank(character);
  // Through the helper, not off the deity record: Splinter Faith replaces which four domains this
  // character's deity has, and reading the printed list here would show a splinter-faith cleric the
  // domains they gave up.
  const deityDomains = deityDomainsOf(character, content).domains;
  // Signature spells (spontaneous casters) — the only spells you can freely re-rank when casting, so
  // they're the only ones that keep the "cast at" rank picker in the detail view.
  const signatureIds = useMemo(() => spellSignatureIds(character.spellcasting), [character.spellcasting]);
  const multi = mains.length > 1;

  function toggleFilter(id: string) {
    setFilters((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  // ── Filtering: search by name + action-cost chips. When neither is active the
  // lists render verbatim (unchanged behaviour). ──────────────────────────────
  const query = search.trim().toLowerCase();
  const filtering = query !== '' || filters.size > 0;
  function matchesCostFilters(cost: ActionCost | undefined): boolean {
    if (filters.size === 0) return true;
    if (!cost) return false;
    for (const id of filters) {
      const def = COST_FILTERS.find((c) => c.id === id);
      if (def && spellCostMatches(cost, def.cost)) return true;
    }
    return false;
  }
  /** Whether a spell passes the active search + action-cost filters. */
  function visible(sp: Spell | undefined): boolean {
    if (!filtering) return true;
    if (!sp) return false;
    if (!searchMatches(query, sp.name)) return false;
    return matchesCostFilters(sp.cast);
  }
  /* bug 2026-09-13: search-rank. This page FILTERED and never ORDERED, so a match sat wherever the
   * player's own list put it — a spellbook holding Wall of Fire before Fireball answered "fireball"
   * with Wall of Fire on top. Every PLAIN list below is ranked (known cantrips, a repertoire's spells,
   * the spellbook, learned spells, focus spells, an item's or an innate entry's spells). The prepared
   * SLOTS are not: a slot's position IS its identity — its pip key is `…:<rank>:<index>` — so
   * reordering them would move the expended pips onto other slots. */
  const rankSpellIds = <T,>(list: T[], idOf: (t: T) => string) =>
    rankBySearch(list, query, (t) => content.spells[idOf(t)]?.name ?? idOf(t));

  // Only bail when the character has NO castable magic at all — a focus-only caster (champion, monk/
  // ranger with focus feats) or a staff/wand holder has no prepared/spontaneous pool but still needs
  // the focus / item / innate sections below.
  //
  // RITUALS are not spellcasting: "anyone can cast a ritual" given the skill proficiency, so a
  // fighter who has learned Commune belongs on this page. Bailing before the rituals section left a
  // non-caster unable to see one, learn one, or read one.
  if (!mains.length && !focus && !itemEntries.length && !myRituals.length && !onPlay) {
    return (
      <div className="placeholder">
        <i className="ti ti-sparkles" aria-hidden="true" />
        <span>No spellcasting</span>
      </div>
    );
  }

  // The per-rank cards for ONE casting pool. A class may have two pools — e.g. the
  // animist's prepared "animist" pool and its spontaneous "apparition" pool.
  function buildRanks(main: SpellcastingEntry): { key: string; label: string; node: ReactNode; badge?: string }[] {
    const ranks: { key: string; label: string; node: ReactNode; badge?: string }[] = [];
    // Cantrips auto-heighten to HALF YOUR LEVEL rounded up (ceil(level/2)) — by character level, NOT the
    // pool's highest slot rank. For a full caster the two coincide, but a spellcasting-archetype / multiclass
    // caster's slot ranks lag their level, so their cantrips must still heighten to ceil(level/2).
    const maxRank = Math.min(10, Math.ceil(character.level / 2));
    // Cantrips bought with Spell Blending sit beside the known ones, labelled, so a player can see
    // what today's trade actually bought them. An unfilled opening still shows, or the trade would
    // look like it did nothing.
    const tradedCantrips = main.tradedCantrips ?? [];
    /* Unpicked cantrip OPENINGS. With zero cantrips chosen the whole section used to vanish — a new
     * caster asked "why don't I have a place for my cantrips?" and the sheet had no answer. The
     * spell-slot convention already shows "Empty slot" cards, so unfilled cantrip openings get the
     * same treatment, pointing at where the picking actually happens (the builder). */
    const emptyCantrips = Math.max(0, (main.cantripCap ?? 0) - main.cantrips.length);
    // A sorcerer's cantrip drawn past its five (the gift is one of them — lane C2): drawn, and said.
    const pastCantrips = pastGiftIds(main, main.cantrips, main.grantedCantrips ?? [], cantripsOverOf(main));
    // …and a gift cantrip the record lists one of per VARIANT (elemental: one per element), each drawn
    // and each saying only one is the character's (`variantGiftCount`, lane C4).
    const variantCantrips = variantGiftCount(main, 0);
    if (main.cantrips.length || tradedCantrips.length || emptyCantrips > 0) {
      const cards = rankSpellIds(main.cantrips, (id) => id)
        .map((id, i) => {
          const sp = content.spells[id];
          // A cantrip a RECORD put in this pool — Adapted Cantrip's "you can cast this cantrip as a
          // spell of your class's tradition" — is named, so the extra row does not read as one of the
          // player's own picks. `spellSources` was populated for the pooled entries and read only
          // there; the class pool never wrote it, so the attribution costs no new field.
          const from = main.spellSources?.[id];
          const note =
            offBookNote(main, id) ??
            (pastCantrips.has(id) ? overGiftNote(main.cantripCap ?? 0, true) : undefined) ??
            (variantCantrips && main.grantedCantrips?.includes(id) ? variantGiftNote(variantCantrips) : undefined);
          return sp && visible(sp) ? (
            <SpellCard key={id + i} name={sp.name} cost={sp.cast} meta={from ? `at will · from ${from}` : 'at will'} marks={marksFor(id)} note={note} onClick={() => openDetail(sp)} />
          ) : null;
        })
        .concat(
          tradedCantrips.map((id, i) => {
            const sp = id ? content.spells[id] : null;
            if (!sp) return filtering ? null : <SpellCard key={'tc' + i} name="Empty cantrip" meta="traded" empty />;
            return visible(sp) ? (
              <SpellCard key={'tc' + i} name={sp.name} cost={sp.cast} meta="traded · at will" marks={marksFor(sp.id)} note={offBookNote(main, sp.id)} onClick={() => openDetail(sp)} />
            ) : null;
          }),
        )
        .concat(
          filtering
            ? []
            : Array.from({ length: emptyCantrips }, (_, i) => (
                <SpellCard
                  key={'ec' + i}
                  name="Empty cantrip"
                  // A prepared caster prepares cantrips each morning — the Prepare button is the
                  // affordance; a spontaneous class's cantrips are known, chosen in the builder.
                  meta={main.cantripsPrepared ? 'tap Prepare to choose' : 'pick in the builder (Edit)'}
                  empty
                />
              )),
        )
        .filter(Boolean);
      if (cards.length) {
        ranks.push({
          key: 'cantrips',
          label: 'Cantrips',
          node: (
            <div key="cantrips">
              <div className="spell-rankhdr">
                Cantrips
                <span className="spell-rankhdr-right">
                  {maxRank > 0 ? `at will · heightened to ${ord(maxRank)}` : 'at will'}
                </span>
              </div>
              <div className="spell-grid">{cards}</div>
            </div>
          ),
        });
      }
    }

  if (main.type === 'prepared' && main.prepared) {
    for (const rank of Object.keys(main.prepared).map(Number).sort((a, b) => a - b)) {
      const slots = main.prepared[rank];
      // A slot traded away by Spell Blending is not a slot you have today, so it counts for nothing
      // here. `slots.length` is the ARRAY size — using it would over-count every traded rank.
      const live = slots.filter((s) => !s.traded);
      const used = live.filter((s) => s.expended).length;
      const cards = slots
        .map((slot, i) => {
          if (slot.traded)
            return filtering ? null : (
              <SpellCard key={i} name="Traded away" meta="spell blending" pip="empty" empty />
            );
          if (!slot.spellId)
            return filtering ? null : (
              <SpellCard key={i} name="Empty slot" meta={slot.bonusFrom != null ? `bonus · from ${ord(slot.bonusFrom)}` : 'rank ' + rank} pip="empty" empty />
            );
          const sp = content.spells[slot.spellId];
          if (!visible(sp)) return null;
          return (
            <SpellCard
              key={i}
              name={sp?.name ?? slot.spellId}
              marks={marksFor(slot.spellId)}
              note={offBookNote(main, slot.spellId)}
              cost={sp?.cast}
              meta={slot.bonusFrom != null ? `bonus · from ${ord(slot.bonusFrom)}` : 'rank ' + rank}
              pip={slot.expended ? 'filled' : 'empty'}
              // A bonus slot carries its own key, derived from the rank it was traded FROM, so undoing
              // a different trade can't renumber it and move this spell.
              onPip={onPlay ? () => onPlay((p) => toggleExpended(p, slotKeyOf(main.id, rank, i, slot))) : undefined}
              onClick={sp ? () => openDetail(sp, rank) : undefined}
            />
          );
        })
        .filter(Boolean);
      if (!cards.length) continue;
      ranks.push({
        key: 'r' + rank,
        label: ord(rank),
        badge: `${live.length - used}/${live.length}`,
        node: (
          <div key={'r' + rank}>
            <div className="spell-rankhdr">
              {ord(rank)} rank
              <span className="spell-rankhdr-right">
                {used} / {live.length} slot{live.length === 1 ? '' : 's'} used
              </span>
            </div>
            <div className="spell-grid">{cards}</div>
          </div>
        ),
      });
    }
  } else if (main.type === 'spontaneous' && main.repertoire) {
    // A signature spell can be cast (heightened) from ANY slot of its base rank or higher, so it
    // echoes — starred — at every higher rank that has a slot pool. Echoes are display-only: the
    // spell stays repertoired only at its base rank (no data-model change, no known-count impact).
    const allRanks = [...new Set([...Object.keys(main.repertoire), ...Object.keys(main.slots ?? {})].map(Number))].sort(
      (a, b) => a - b,
    );
    for (const rank of allRanks) {
      const ids = rankSpellIds(main.repertoire[rank] ?? [], (id) => id);
      const pool = main.slots?.[rank];
      // A sorcerer's pick drawn past the rank's allowance (lane C2): the card says it where the spell
      // is, not only in Manage spells. Counted here rather than read off `overCap`, so a character
      // drawn without a play overlay says it too — for these entries it is the same number
      // (`overCapOf` puts no build floor under a `grantsCountInside` rank).
      const grantedHere = main.grantedRepertoire?.[rank] ?? [];
      const ownHere = (main.repertoire[rank] ?? []).filter((id) => !grantedHere.includes(id)).length;
      const pastRank = pastGiftIds(main, main.repertoire[rank] ?? [], grantedHere, ownHere - repertoireCap(main, rank));
      const rankPlaces = main.repertoireMax?.[rank] ?? pool?.max ?? 0;
      const variantHere = variantGiftCount(main, rank);
      const baseCards = ids
        .map((id, i) => {
          const sp = content.spells[id];
          if (!visible(sp)) return null;
          return (
            <SpellCard
              key={id + i}
              name={sp?.name ?? id} marks={marksFor(id)}
              note={
                offBookNote(main, id) ??
                (pastRank.has(id) ? overGiftNote(rankPlaces, false, !!main.repertoireOnSheet?.includes(rank)) : undefined) ??
                (variantHere && grantedHere.includes(id) ? variantGiftNote(variantHere) : undefined)
              }
              cost={sp?.cast}
              meta={'rank ' + rank}
              sig={main.signature?.includes(id)}
              onClick={sp ? () => openDetail(sp) : undefined}
            />
          );
        })
        .filter(Boolean);
      const echoCards = signatureEchoIds(main, rank)
        .filter((id) => visible(content.spells[id]))
        .map((id) => {
          const sp = content.spells[id];
          return (
            <SpellCard
              key={'sig:' + id + ':' + rank}
              name={sp?.name ?? id} marks={marksFor(id)}
              cost={sp?.cast}
              meta={'rank ' + rank + ' · signature'}
              sig={true}
              onClick={sp ? () => openDetail(sp) : undefined}
            />
          );
        });
      const cards = [...baseCards, ...echoCards];
      if (!cards.length) continue;
      ranks.push({
        key: 'r' + rank,
        label: ord(rank),
        badge: pool ? `${pool.max - pool.used}/${pool.max}` : undefined,
        node: (
        <div key={'r' + rank}>
          <div className="spell-rankhdr">
            {ord(rank)} rank
            <span className="spell-rankhdr-right">
              {pool && (
                <span className="pool-pips">
                  {Array.from({ length: pool.max }, (_, i) => {
                    const avail = pool.max - pool.used;
                    const on = i < avail;
                    // Click sets available to i+1 (fill up) or i (spend the top one) — like hero pips.
                    return onPlay ? (
                      <button
                        type="button"
                        key={i}
                        className={'slot-pip btn' + (on ? ' on' : '')}
                        aria-label="Toggle spell slot"
                        title={on ? 'Click to cast (expend slot)' : 'Click to restore slot'}
                        onClick={() =>
                          onPlay((p) => setSlotsUsed(p, poolKey(main.id, rank), pool.max - (i + 1 === avail ? i : i + 1), pool.max))
                        }
                      />
                    ) : (
                      <span key={i} className={'slot-pip' + (on ? ' on' : '')} />
                    );
                  })}
                </span>
              )}
              {pool ? `${pool.max - pool.used} / ${pool.max}` : ''}
            </span>
          </div>
          <div className="spell-grid">{cards}</div>
        </div>
        ),
      });
    }
  }

  // Divine Font — a second heal/harm-only prepared list (cleric). Battle Creed instead gets a BATTLE
  // FONT: Bane-or-Bless slots cast with the class DC.
  const isBattle = main.font?.type === 'battle';
  if (main.font && main.font.slots > 0 && (!filtering || isBattle || visible(content.spells[main.font.type]))) {
    const fontSpell = isBattle ? undefined : content.spells[main.font.type];
    const fr = main.font.rank ?? 1;
    const used = (main.font.expended ?? []).filter(Boolean).length;
    const allowedNames = isBattle ? (main.font.allowed ?? []).map((id) => content.spells[id]?.name ?? id).join(' / ') : '';
    ranks.push({
      key: 'font',
      label: isBattle ? 'Battle font' : 'Divine font',
      badge: `${main.font.slots - used}/${main.font.slots}`,
      node: (
      <div key="font">
        <div className="spell-rankhdr">
          {isBattle ? `Battle Font · ${allowedNames}` : `Divine Font · ${cap(main.font.type)}`}
          <span className="spell-rankhdr-right">
            {isBattle && main.font.useClassDc ? `Class DC ${deriveClassDc(character).dc} · ` : ''}
            {used} / {main.font.slots} used
          </span>
        </div>
        <div className="spell-grid">
          {Array.from({ length: main.font.slots }, (_, i) => (
            <SpellCard
              key={'font' + i}
              name={isBattle ? allowedNames || 'Bane / Bless' : fontSpell?.name ?? cap(main.font!.type)}
              cost={fontSpell?.cast}
              meta={ord(fr) + ' rank'}
              pip={(main.font!.expended ?? [])[i] ? 'filled' : 'empty'}
              onPip={onPlay ? () => onPlay((p) => toggleExpended(p, `${main.id}:font:${i}`)) : undefined}
              onClick={fontSpell ? () => openDetail(fontSpell, fr) : undefined}
            />
          ))}
        </div>
      </div>
      ),
    });
  }

  // Restricted slots — one section per group, kept out of the rank sections above because what they
  // may hold is narrower than their rank and, for Sin Reservoir, the rank itself moves each morning.
  for (const [label, group] of groupBy(main.restrictedSlots ?? [], (s) => s.label)) {
    const cards = group
      .map((slot) => {
        const sp = slot.spellId ? content.spells[slot.spellId] : null;
        // desk #170: an "extra cast" card names only what the picker would offer — a trait search's spells
        // (Master Summoner) follow the character's books; a record's own list stays whole.
        const allowedNames = restrictedAllowedOnBooks({ character, entry: main, content }, slot, enabledBookSet(character.enabledSources)).map(
          (id) => content.spells[id]?.name ?? id,
        );
        if (sp && !visible(sp)) return null;
        // Nothing is prepared into a spontaneous caster's restricted slot — it is one extra cast, so
        // the card names what it may be spent on rather than a spell.
        if (!sp && filtering) return null;
        // A Spell Combination slot is ONE cast of two spells at once, so it reads as one card naming
        // both — showing them as two cards would imply two casts.
        const sp2 = slot.pairs && slot.spellId2 ? content.spells[slot.spellId2] : null;
        return (
          <SpellCard
            key={slot.id}
            name={
              sp && sp2
                ? `${sp.name} + ${sp2.name}`
                : sp?.name ?? (slot.spontaneous ? allowedNames.slice(0, 3).join(' / ') || 'Extra cast' : 'Empty slot')
            }
            marks={sp ? marksFor(slot.spellId!) : undefined}
            note={(slot.keptOffList ? keptOffListNote(label) : undefined) ?? offBookNote(main, slot.spellId) ?? offBookNote(main, slot.spellId2)}
            cost={sp?.cast}
            meta={`${ord(slot.rank)} rank · ${label.toLowerCase()}`}
            pip={slot.expended ? 'filled' : 'empty'}
            onPip={onPlay ? () => onPlay((p) => toggleExpended(p, slot.id)) : undefined}
            onClick={sp ? () => openDetail(sp) : undefined}
            empty={!sp && !slot.spontaneous}
          />
        );
      })
      .filter(Boolean);
    if (!cards.length) continue;
    const used = group.filter((s) => s.expended).length;
    ranks.push({
      key: 'rs-' + label,
      label,
      badge: `${group.length - used}/${group.length}`,
      node: (
        <div key={'rs-' + label}>
          <div className="spell-rankhdr">
            {label}
            <span className="spell-rankhdr-right">
              {used} / {group.length} used
            </span>
          </div>
          {group[0].note && <div className="spell-rank-note">{group[0].note}</div>}
          <div className="spell-grid">{cards}</div>
        </div>
      ),
    });
  }
  return ranks;
  }

  /* ONE BOOK SECTION PER BOOK. Lane C2 gave a second-class witch, magus and necromancer their book, and
   * this read only the first (`mains.find`), so on a Wizard/Witch the familiar — and the spells the witch
   * learned, which play merges into it — appeared in no section at all (lane C3, 2026-10-15). Each book is
   * titled with its own word for it ("Spellbook", "Familiar’s spells", "Dirge"), and named for its class
   * when there are several. The first keeps the section id `spellbook`, so a collapse the player set on
   * a one-book character stays where it was. */
  const bookMains = mains.filter((m) => m.spellbook);
  const bookSections = bookMains.map((m, i) => {
    const book = m.spellbook!;
    const cards: ReactNode[] = [];
    /* The book's CANTRIPS first — the builder's (`bookCantrips`, owner's bug 2026-10-14: a book holds
     * 10 / 10 / 8 / 8 of them against the five it prepares) and any learned with Learn a Spell, which
     * play merges into `spellbook[0]`. Labelled "Cantrip": a rank-0 list read as "0th rank" before. */
    const cantripPages = [...new Set([...(m.bookCantrips ?? []), ...(book[0] ?? [])])].map((id) => ({ rank: 0, id }));
    // The whole book is ONE grid, so it ranks as one list; with no query rankSpellIds hands back the
    // same array and the rank-then-book order below is untouched.
    const pages = [
      ...cantripPages,
      ...Object.keys(book)
        .map(Number)
        .filter((rank) => rank > 0)
        .sort((a, b) => a - b)
        .flatMap((rank) => book[rank].map((id) => ({ rank, id }))),
    ];
    for (const { rank, id } of rankSpellIds(pages, (p) => p.id)) {
      const sp = content.spells[id];
      if (!visible(sp)) continue;
      /* A spell a RECORD wrote into the book — a lesson's *"your familiar learns Spirit Link"*, Expanded
       * Necromancy's grisly growths in the dirge, Adapted Cantrip — says which, so it does not read as one
       * the player chose (build.ts `grantIntoBook` / the class book's lesson marking, `spellSources`). */
      const from = m.spellSources?.[id];
      cards.push(
        <SpellCard
          key={'sb' + rank + id}
          name={sp?.name ?? id} marks={marksFor(id)}
          cost={sp?.cast}
          meta={`${rank === 0 ? 'Cantrip' : ord(rank) + ' rank'}${from ? ` · from ${from}` : ''}`}
          onClick={sp ? () => openDetail(sp) : undefined}
        />,
      );
    }
    // Whose book: the class for a class entry (`<class id>-casting`), the dedication for an archetype's
    // (`<dedication id>-casting`), else the entry's own name.
    const classId = entryClassIdOf(character, m);
    const className =
      (classId && m.id === `${classId}-casting` ? content.classes[classId]?.name : undefined) ??
      (m.id.endsWith('-dedication-casting') ? content.feats[m.id.slice(0, -'-casting'.length)]?.name : undefined) ??
      m.name;
    return {
      entry: m,
      secId: i === 0 ? 'spellbook' : `spellbook:${m.id}`,
      title: bookMains.length > 1 ? `${className} — ${bookTitle(m.bookNoun)}` : bookTitle(m.bookNoun),
      tabLabel: bookMains.length > 1 ? `${className} book` : 'Book',
      cards,
    };
  }).filter((s) => s.cards.length > 0);

  /* Spells learned by a caster with no spellbook. A spellbook caster's learned spells are merged into
     the spellbook and show in the card above; a repertoire caster's have nowhere else to appear, and
     they need to — they're what you may pick from the next time you swap a repertoire spell. */
  const learnedMain = mains.find((m) => !m.spellbook && m.learned);
  const learnedCards: ReactNode[] = [];
  if (learnedMain?.learned) {
    const learned = learnedMain.learned;
    const known = Object.keys(learned)
      .map(Number)
      .sort((a, b) => a - b)
      .flatMap((rank) => learned[rank].map((id) => ({ rank, id })));
    for (const { rank, id } of rankSpellIds(known, (k) => k.id)) {
      const sp = content.spells[id];
      if (!visible(sp)) continue;
      learnedCards.push(
        <SpellCard
          key={'ln' + rank + id}
          name={sp?.name ?? id} marks={marksFor(id)}
          cost={sp?.cast}
          meta={rank === 0 ? 'Cantrip' : ord(rank) + ' rank'}
          onClick={sp ? () => openDetail(sp) : undefined}
        />,
      );
    }
  }

  // Focus spells auto-heighten to half your level rounded up — show that rank, not the base. Built per
  // focus entry so each source (dual-class / archetype) can render its own section with its own DC.
  const buildFocusCards = (entry: (typeof focusEntries)[number]): ReactNode[] => {
    const out: ReactNode[] = [];
    if (!entry.repertoire) return out;
    const focusHeighten = Math.min(10, Math.ceil(character.level / 2));
    const rep = entry.repertoire;
    const spells = Object.keys(rep)
      .map(Number)
      .sort((a, b) => a - b)
      .flatMap((rank) => rep[rank].map((id) => ({ rank, id })));
    for (const { rank, id } of rankSpellIds(spells, (s) => s.id)) {
      const sp = content.spells[id];
      if (!visible(sp)) continue;
      const shown = Math.max(rank, focusHeighten);
      // Focus spells pool from many feats/subclasses — name the source so it's clear where each came from.
      const from = entry.spellSources?.[id];
      out.push(
        <SpellCard
          key={entry.id + '/' + id}
          name={sp?.name ?? id} marks={marksFor(id)}
          cost={sp?.cast}
          meta={`rank ${shown}${from ? ` · from ${from}` : ''}`}
          fp
          onClick={sp ? () => openDetail(sp) : undefined}
        />,
      );
    }
    return out;
  };

  // Rituals matching the search — hoisted out of ritualsNode so the section count below can be taken
  // without building the node.
  // bug 2026-09-13: search-rank — as in the picker's ritual group above.
  const ritualsShown = query
    ? rankBySearch(myRituals.filter((r) => searchMatches(query, r.spell.name)), query, (r) => r.spell.name)
    : myRituals;

  /* How many collapsible sections this page actually renders — one per spell pool, plus whichever of
   * the focus / item / spellbook / learned / ritual cards exist. Drives whether a collapse chevron is
   * drawn at all (see SecChevron).
   *
   * Counted from the CONDITIONS rather than from the node consts, and declared above them: the nodes
   * call secOpen() eagerly in a style prop, so reading them here would put the count after its own
   * first use and throw a temporal-dead-zone error the moment a character had a spellbook, an item
   * spell source or a ritual. */
  const collapsibleSections =
    mains.length +
    itemEntries.length +
    bookSections.length +
    (learnedCards.length > 0 ? 1 : 0) +
    (focusEntries.length > 0 ? 1 : 0) +
    (ritualsShown.length > 0 ? 1 : 0);

  // ── Section nodes lifted out of the return so both the desktop stack AND the mobile
  // page-level tab row can render the SAME JSX. Each builder references in-scope locals
  // (secOpen, focusCards, onPlay, character, content, …) — unchanged from the inline version. ──

  const bookNodes = bookSections.map((s) => ({
    ...s,
    node: (
      <section className="card" key={s.secId} data-book-entry={s.entry.id}>
        <div className="ct" style={{ margin: secOpen(s.secId) ? '0 0 10px' : 0 }}>
          <SecChevron id={s.secId} />
          <i className="ti ti-book" aria-hidden="true" />
          {/* "Spellbook", "Familiar’s spells", "Dirge" — the class's own word for it. */}
          {s.title}
          <span className="ct-note">{s.cards.length} spell{s.cards.length === 1 ? '' : 's'}</span>
        </div>
        {secOpen(s.secId) && <div className="spell-grid">{s.cards}</div>}
      </section>
    ) as ReactNode,
  }));

  const learnedNode: ReactNode =
    learnedCards.length > 0 ? (
      <section className="card">
        <div className="ct" style={{ margin: secOpen('learned') ? '0 0 10px' : 0 }}>
          <SecChevron id="learned" />
          <i className="ti ti-book-2" aria-hidden="true" />
          Learned spells
          <span className="ct-note">available when you add or swap a repertoire spell</span>
        </div>
        {secOpen('learned') && <div className="spell-grid">{learnedCards}</div>}
      </section>
    ) : null;

  // One shared focus-point pool (character.focus), but a section per focus SOURCE. With a single source
  // the DC sits in the header; with two (dual-class / archetype) each source shows its own DC.
  const singleFocusSc = focusEntries.length === 1 ? deriveSpellcasting(character, focusEntries[0]) : null;
  const focusNode: ReactNode = focusEntries.length ? (
    <section className="card">
      <div className="focus-head">
        <div className="ct" style={{ margin: 0 }}>
          <SecChevron id="focus" />
          <i className="ti ti-flame" aria-hidden="true" />
          Focus spells
        </div>
        {singleFocusSc && (
          <div className="focus-dc">
            <span className="tile focus-dc-tile">
              <span className="tlab">Attack</span>
              <span className="tval">{formatMod(singleFocusSc.attack)}</span>
            </span>
            <span className="tile focus-dc-tile">
              <span className="tlab">Focus DC</span>
              <span className="tval">{singleFocusSc.dc}</span>
            </span>
          </div>
        )}
        <div className="focus-pool">
          {Array.from({ length: character.focus?.max ?? 0 }, (_, i) => {
            const cur = character.focus?.current ?? 0;
            const fmax = character.focus?.max ?? 0;
            const on = i < cur;
            return onPlay ? (
              <button
                type="button"
                key={i}
                className={'focus-circ btn' + (on ? ' on' : '')}
                aria-label="Toggle focus point"
                title={on ? 'Spend focus point' : 'Restore focus point'}
                onClick={() => onPlay((p) => setFocusUsed(p, fmax - (i + 1 === cur ? i : i + 1), fmax))}
              />
            ) : (
              <span key={i} className={'focus-circ' + (on ? ' on' : '')} />
            );
          })}
          <span style={{ fontSize: 11.5, color: 'var(--app-text-dim)' }}>
            {character.focus?.current ?? 0} / {character.focus?.max ?? 0}
          </span>
          {onPlay && (character.focus?.current ?? 0) < (character.focus?.max ?? 0) && (
            <button
              className="refocus-btn"
              title={
                character.focus?.refocusRestore
                  ? `Refocus (${character.focus.refocusRestore === 'all' ? 'refill your pool' : `restore ${character.focus.refocusRestore} Focus Points`}${character.focus.refocusSource ? ` — ${character.focus.refocusSource}` : ''})`
                  : 'Refocus (restore 1 focus point)'
              }
              onClick={() => {
                const fmax = character.focus?.max ?? 0;
                const used = fmax - (character.focus?.current ?? 0);
                // Domain/Bloodline/Conflux/Amp Focus refill the whole pool; the Wellspring feats give
                // N. Every printed N carries the same threshold ("recover 3 … if you have spent at
                // least 3"), so falling back to 1 below N is the rule, not a clamp — a character who
                // spent 2 with Bloodline Wellspring gets 1, exactly as written.
                const back = character.focus?.refocusRestore;
                const n = typeof back === 'number' ? back : 1;
                const restored = back === 'all' ? used : used >= n ? n : 1;
                onPlay((p) => setFocusUsed(p, used - restored, fmax));
              }}
            >
              <i className="ti ti-refresh" style={{ fontSize: 12 }} aria-hidden="true" /> Refocus
            </button>
          )}
        </div>
      </div>
      {secOpen('focus') &&
        (focusEntries.some((e) => buildFocusCards(e).length) ? (
          focusEntries.map((entry) => {
            const cards = buildFocusCards(entry);
            if (!cards.length) return null;
            const sc = deriveSpellcasting(character, entry);
            return (
              <div key={entry.id} className="focus-source">
                {focusEntries.length > 1 && (
                  <div className="focus-source-head">
                    <span className="focus-source-name">{entry.name}</span>
                    <span className="focus-source-dc">
                      Attack {formatMod(sc.attack)} · Focus DC {sc.dc}
                    </span>
                  </div>
                )}
                <div className="spell-grid">{cards}</div>
              </div>
            );
          })
        ) : (
          <div className="spell-empty">{filtering ? 'No focus spells match.' : 'No focus spells.'}</div>
        ))}
    </section>
  ) : null;

  // A staff's charge pool is sized by its WIELDER ("charges equal to the rank of your highest-rank
  // spell slot"), not by the staff's own level — see itemUses.ts.
  const staffMax = highestSlotRank(character);
  // Extra spell sources: staff/wand held spells and innate spells — read-only cards, cast with your spell DC.
  const itemNodes: { id: string; name: string; node: ReactNode }[] = itemEntries.map((entry) => {
    const isInnate = entry.type === 'innate';
    const innateUsedSet = new Set(entry.innateUsed ?? []); // leveled innate spells cast today (1/day)
    // Item entries: resolve the inventory instance + def + its live charge counter (the SAME
    // inv.counters the Inventory edits → charges stay in sync both ways for free). The instance
    // id is on `itemInstanceId`, or recoverable from the entry id (`item:<instanceId>`) for
    // characters built before that field existed.
    const itemInstId = entry.itemInstanceId ?? (entry.type === 'items' && entry.id.startsWith('item:') ? entry.id.slice(5) : undefined);
    const itemInv = !isInnate && itemInstId ? character.inventory.find((iv) => iv.instanceId === itemInstId) : undefined;
    const itemDef = itemInv ? content.items[itemInv.itemId] : undefined;
    const counterId = itemDef ? chargeCounterId(itemDef) : null;
    const counter = itemDef && itemInv && counterId ? itemCounters(itemDef, itemInv, staffMax).find((c) => c.id === counterId) : undefined;

    // Casting a rank-N held spell spends the item's charges (staff = N, wand = 1) or consumes a
    // single-use item. Per-spell cast props are attached to the leveled SpellCards below.
    const castProps = (rank: number) => {
      if (isInnate || !itemDef || !itemInv || !onPlay) return {};
      const cid = chargeCounterId(itemDef);
      const cost = chargeCostToCast(itemDef, rank);
      return {
        castDisabled: !canCastFromItem(itemDef, itemInv, rank, staffMax),
        castTitle:
          cid === 'pool' ? `Cast — spend ${cost} charge${cost === 1 ? '' : 's'}` : cid === 'freq' ? 'Cast — uses the daily charge' : 'Cast — uses the item',
        // Both branches step from the LIVE value in `p`, never from the stack/charge count this render
        // captured: two casts in one React batch have to spend two scrolls, or two charges.
        onCast: () =>
          onPlay((p) => {
            const live = (p.inventory ?? []).find((i) => i.instanceId === itemInv.instanceId);
            if (cid === null) return (live?.quantity ?? itemInv.quantity) > 1 ? bumpItemQuantity(p, itemInv.instanceId, -1) : removeInventoryItem(p, itemInv.instanceId);
            const u = itemCounters(itemDef, itemInv, staffMax).find((c) => c.id === cid);
            if (!u || cost <= 0) return p;
            return bumpItemCounter(p, itemInv.instanceId, u, -cost);
          }),
      };
    };

    const cards: ReactNode[] = [];
    for (const id of rankSpellIds(entry.cantrips, (i) => i)) {
      const sp = content.spells[id];
      if (!visible(sp)) continue;
      // An innate cantrip carries the same two facts a leveled innate does and printed NEITHER: the
      // rank it is cast at ("heightened to a spell rank equal to half your level rounded up") and which
      // record granted it. `spellSources` was populated for these all along and read only by the leveled
      // branch below — a write-only field for this one shape — so a fighter's Detect Magic from Arcane
      // Sense read as a bare "at will", unranked and unattributed. The tradition is appended only when
      // it differs from the pooled entry's, which is the whole point of `spellTraditions`.
      const cTrad = entry.spellTraditions?.[id];
      const cFrom = entry.spellSources?.[id];
      const cMeta = isInnate
        ? `at will · heightened to ${ord(Math.min(10, Math.ceil(character.level / 2)))}${cFrom ? ` · from ${cFrom}` : ''}${cTrad && cTrad !== entry.tradition ? ` · ${cTrad}` : ''}`
        : 'cantrip · at will';
      cards.push(
        <SpellCard key={`${entry.id}:c:${id}`} name={sp?.name ?? id} cost={sp?.cast} meta={cMeta} marks={marksFor(id)} onClick={sp ? () => openDetail(sp) : undefined} />,
      );
    }
    const rep = entry.repertoire ?? {};
    const held = Object.keys(rep)
      .map(Number)
      .sort((a, b) => a - b)
      .flatMap((rank) => rep[rank].map((id) => ({ rank, id })));
    for (const { rank, id } of rankSpellIds(held, (h) => h.id)) {
      const sp = content.spells[id];
      if (!visible(sp)) continue;
      const cost = !isInnate && itemDef ? chargeCostToCast(itemDef, rank) : 0;
      // Innate cadence: per-spell override (0 = at-will, N = N/day), default 1/day.
      const uses = entry.innateUses?.[id];
      const cadence = entry.innateCadence?.[id];
      // Pooled entries (innate / focus) draw from many feats — name the granting source so it's
      // obvious where each spell came from.
      const from = entry.spellSources?.[id];
      // …and its TRADITION when that differs from the entry's. One pooled entry has one tradition and
      // its spells do not, so the header was a majority vote: a psychic's heritage spell and an
      // invested item's outvote each other and the loser is described wrongly.
      const trad = entry.spellTraditions?.[id];
      const meta = isInnate
        ? `rank ${rank} · ${uses === 0 ? 'at will' : cadence ?? `${uses ?? 1}/day`}${from ? ` · from ${from}` : ''}${trad && trad !== entry.tradition ? ` · ${trad}` : ''}`
        : counterId === 'pool'
          ? `rank ${rank} · ${cost} charge${cost === 1 ? '' : 's'}`
          : counterId === 'freq'
            ? `rank ${rank} · 1/day`
            : `rank ${rank}`;
      cards.push(
        <SpellCard
          key={`${entry.id}:${rank}:${id}`}
          name={sp?.name ?? id} marks={marksFor(id)}
          cost={sp?.cast}
          meta={meta}
          onClick={sp ? () => openDetail(sp) : undefined}
          pip={isInnate && uses !== 0 ? (innateUsedSet.has(id) ? 'empty' : 'filled') : undefined}
          onPip={isInnate && uses !== 0 && onPlay ? () => onPlay((p) => toggleInnateCast(p, entry.id, id)) : undefined}
          {...castProps(rank)}
        />,
      );
    }
    return {
      id: entry.id,
      name: entry.name,
      node: (
        <section className="card" key={entry.id}>
          <div className="ct" style={{ margin: secOpen(entry.id) ? '0 0 10px' : 0 }}>
            <SecChevron id={entry.id} />
            <i className={'ti ' + (isInnate ? 'ti-sparkles' : 'ti-wand')} aria-hidden="true" />{' '}
            {!isInnate && itemDef && itemInv ? (
              <button type="button" className="sc-item-name" title="Open item details" onClick={() => setItemView(itemInv.instanceId)}>
                {entry.name}
              </button>
            ) : (
              entry.name
            )}
            <span style={{ fontSize: 11.5, color: 'var(--app-text-dim)', marginLeft: 6 }}>
              {/* Every tradition present, not just the majority vote — "innate spells (Arcane)" over a
                  sarangay's occult cantrip is the pooled-header defect this fixes. */}
              · {isInnate ? 'innate' : 'item'} spells ({[...new Set([entry.tradition, ...Object.values(entry.spellTraditions ?? {})])].map(cap).join(', ')})
            </span>
            {counter && itemInv && (
              <span className="item-charges">
                {Array.from({ length: counter.max }, (_, i) => {
                  const on = i < counter.current;
                  return onPlay ? (
                    <button
                      key={i}
                      type="button"
                      className={'slot-pip btn' + (on ? ' on' : '')}
                      title={on ? 'Spend a charge' : 'Restore a charge'}
                      aria-label={on ? 'Spend a charge' : 'Restore a charge'}
                      onClick={() => onPlay((p) => setItemCounter(p, itemInv.instanceId, counter.id, chargesFor(counter, i + 1 === counter.current ? i : i + 1)))}
                    />
                  ) : (
                    <span key={i} className={'slot-pip' + (on ? ' on' : '')} />
                  );
                })}
                <span className="item-charges-n">
                  {counter.current}/{counter.max} {counter.label.toLowerCase()}
                </span>
              </span>
            )}
          </div>
          {secOpen(entry.id) &&
            (cards.length ? (
              <div className="spell-grid">{cards}</div>
            ) : (
              <div className="spell-empty">{filtering ? 'No spells match.' : 'No spells.'}</div>
            ))}
        </section>
      ),
    };
  });

  // Rituals the character has — granted by a record, or added via Overrides. Hidden when there are none.
  const ritualsNode: ReactNode = (() => {
    const shown = ritualsShown;
    // Owner 2026-09-02: "if the character doesn't have any rituals then don't have a ritual section —
    // if it's empty there isn't a point". The section no longer has to exist to host a picker: rituals
    // are learned from the Learn a spell picker now, so an empty section is pure noise.
    if (!shown.length) return null;
    return (
      <section className="card">
        <div className="ct" style={{ margin: secOpen('rituals') ? '0 0 10px' : 0 }}>
          <SecChevron id="rituals" />
          <i className="ti ti-books" aria-hidden="true" /> Rituals
        </div>
        {secOpen('rituals') && (
          <div className="spell-grid">
            {shown.map(({ spell: sp, grant }) => (
              <SpellCard
                key={`ritual:${sp.id}`}
                name={sp.name} marks={marksFor(sp.id)}
                cost={sp.cast}
                // The granting record and the clause it attaches — Read the Land's Commune is cast in
                // 1 hour without a secondary caster, which is the whole reason to take the feat.
                meta={`rank ${sp.rank}${sp.ritualPrimary ? ` · ${sp.ritualPrimary}` : ''}${grant ? ` · ${grant.from}` : ''}${grant?.note ? ` · ${grant.note}` : ''}`}
                onClick={() => openDetail(sp)}
              />
            ))}
          </div>
        )}
      </section>
    );
  })();

  // Unified mobile tab list: every pool's rank sections, then focus, items, spellbook, rituals.
  // Order matches the desktop stacked layout. Only consumed on mobile, but computing always is fine.
  const spellTabs: { key: string; label: string; node: ReactNode; badge?: string }[] = [];
  for (const main of mains) {
    for (const s of buildRanks(main)) {
      spellTabs.push({ key: main.id + '/' + s.key, label: s.label, node: s.node, badge: s.badge });
    }
  }
  if (focus && focusNode)
    spellTabs.push({
      key: 'focus',
      label: 'Focus',
      node: focusNode,
      badge: character.focus && character.focus.max ? `${character.focus.current}/${character.focus.max}` : undefined,
    });
  for (const it of itemNodes) spellTabs.push({ key: it.id, label: it.name, node: it.node });
  for (const b of bookNodes) spellTabs.push({ key: b.secId, label: b.tabLabel, node: b.node });
  if (learnedNode) spellTabs.push({ key: 'learned', label: 'Learned', node: learnedNode });
  if (ritualsNode) spellTabs.push({ key: 'rituals', label: 'Rituals', node: ritualsNode });
  const spellTabActiveKey = spellTabs.some((t) => t.key === spellTab) ? spellTab : spellTabs[0]?.key;

  return (
    <div className="maincol">
      <div className="acts-controls" style={{ marginBottom: 0 }}>
        <div className="search">
          <i className="ti ti-search" aria-hidden="true" />
          <input placeholder="Search spells" value={search} onChange={(e) => setSearch(e.target.value)} />
          {search && (
            <button className="search-clear" aria-label="Clear search" title="Clear" onClick={() => setSearch('')}>
              <i className="ti ti-x" aria-hidden="true" />
            </button>
          )}
        </div>
        <button
          type="button"
          className={'filter-toggle' + (filtersOpen || filters.size > 0 ? ' on' : '')}
          aria-label="Filters"
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen((o) => !o)}
        >
          <i className="ti ti-filter" aria-hidden="true" />
        </button>
        <div className={'af-row' + (filtersOpen ? ' open' : '')}>
          {COST_FILTERS.map((c) => (
            <button
              key={c.id}
              className={'af' + (filters.has(c.id) ? ' on' : '')}
              title={c.label}
              aria-label={'filter ' + c.label}
              onClick={() => toggleFilter(c.id)}
            >
              <ActionGlyph cost={c.cost} />
            </button>
          ))}
        </div>
      </div>

      {mains.map((main) => {
        const sc = deriveSpellcasting(character, main);
        const rankNodes = buildRanks(main);
        return (
          <div key={main.id}>
            <div className="card sc-head" data-entry={main.id}>
              <SecChevron id={main.id} />
              <div className="sc-info">
                <div className="sc-name-row">
                  {isMobile ? (
                    <button type="button" className="sc-name sc-name-btn" title="Spellcasting details" onClick={() => setScInfo(main.id)}>
                      {multi ? main.name : `${cap(main.tradition)} spellcasting`}
                      <i className="ti ti-info-circle" aria-hidden="true" />
                    </button>
                  ) : (
                    <span className="sc-name">{multi ? main.name : `${cap(main.tradition)} spellcasting`}</span>
                  )}
                  {onPlay && (main.type === 'prepared' || main.type === 'spontaneous') && (
                    <button className="ms-btn" onClick={() => setManageId(main.id)} title="Manage spells for this session">
                      <i className="ti ti-pencil-plus" aria-hidden="true" /> {main.type === 'spontaneous' ? 'Repertoire' : 'Prepare'}
                    </button>
                  )}
                  {/* Learn a Spell widens a finite repository (a spellbook, a repertoire). A cleric or
                      druid prepares from the whole tradition list, so for them the picker offers
                      RITUALS only — since the owner's 2026-09-02 decision made this the one way to learn
                      a ritual on the sheet, every caster gets the button. */}
                  {onPlay && (main.type === 'prepared' || main.type === 'spontaneous') && (
                    <button className="ms-btn" onClick={() => setLearnId(main.id)} title="Learn a Spell (exploration activity)">
                      <i className="ti ti-book-2" aria-hidden="true" /> Learn a spell
                    </button>
                  )}
                  {/* Only on the entry the thesis trades on — the wizard's own. It was gated on "has a
                      book", which stopped meaning "the wizard" once lane C2 gave a second-class witch,
                      magus and necromancer theirs (a Wizard/Magus showed it on the magus card too). */}
                  {onPlay && main.id === blendOwnerId && main.type === 'prepared' && (
                    <button className="ms-btn" onClick={() => setBlendId(main.id)} title="Spell Blending — trade slots">
                      <i className="ti ti-arrows-exchange" aria-hidden="true" /> Trade slots
                    </button>
                  )}
                </div>
                <div className="sc-detail">
                  <div className="sc-sub">
                    {cap(main.type)} · key attribute {cap(main.keyAbility)}
                  </div>
                  {main.font && main.font.type === 'battle' && (
                    <div className="sc-sub">
                      Battle font: {main.font.slots} Bane/Bless slots (class DC, highest rank)
                    </div>
                  )}
                  {main.font && main.font.type !== 'battle' && (
                    <div className="sc-sub">
                      Divine font: {main.font.slots} extra {cap(main.font.type)} {main.font.slots === 1 ? 'spell' : 'spells'}{' '}
                      (highest rank)
                    </div>
                  )}
                  {!multi && deityDomains.length > 0 && <div className="sc-sub">Domains: {deityDomains.join(', ')}</div>}
                  {main.note && <div className="sc-sub">{main.note}</div>}
                </div>
              </div>
              {/* These tiles never carried the situational `*`, so conditional spellcasting bonuses were
                  invisible here even though the same stats show them in the vitals rail. */}
              {([
                { label: 'Spell attack', value: formatMod(sc.attack), ref: { kind: 'spell', entryId: main.id, which: 'attack' } },
                { label: 'Spell DC', value: sc.dc, ref: { kind: 'spell', entryId: main.id, which: 'dc' } },
                // Spell damage has no total of its own — each spell rolls its own dice — so this tile
                // appears only when something actually modifies it (Dangerous Sorcery, Channeler's Stance).
                ...(statHasSituational(character, { kind: 'spellDamage', entryId: main.id }, content)
                  ? [{ label: 'Spell damage', value: 'varies', ref: { kind: 'spellDamage', entryId: main.id } }]
                  : []),
              ] as { label: string; value: string | number; ref: StatRef }[]).map((t) => (
                <div
                  key={t.label}
                  className={'tile' + (onOpenStat ? ' openable' : '') + statMarkClass(character, t.ref, content)}
                  title={onOpenStat ? 'How is this calculated?' : undefined}
                  onClick={onOpenStat ? () => onOpenStat(t.ref) : undefined}
                >
                  <div className="tlab">
                    {t.label}
                    {statHasSituational(character, t.ref, content) && <SituationalStar />}
                  </div>
                  <div className="tval">{t.value}</div>
                </div>
              ))}
            </div>
            {/* On mobile, only the header renders here; ALL sections live under the single
                page-level tab row below. On desktop, the per-main collapsible rank section. */}
            {!isMobile &&
              secOpen(main.id) && (
                <section className="card">
                  {rankNodes.length ? (
                    rankNodes.map((s) => s.node)
                  ) : (
                    <div className="spell-empty">
                      {filtering ? 'No spells match your search or filters.' : 'No spells prepared yet.'}
                    </div>
                  )}
                </section>
              )}
          </div>
        );
      })}

      {/* MOBILE: one page-level tab row covering every section (pools, focus, items, book, …). */}
      {isMobile &&
        (spellTabs.length ? (
          <>
            <div className="subtabs spell-subtabs">
              {spellTabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={t.key === spellTabActiveKey}
                  className={'stab' + (t.key === spellTabActiveKey ? ' on' : '')}
                  onClick={() => setSpellTab(t.key)}
                >
                  {t.label}
                  {t.badge && custom.showSlotBadges && <span className="stab-badge">{t.badge}</span>}
                </button>
              ))}
            </div>
            <section className="card">{(spellTabs.find((t) => t.key === spellTabActiveKey) ?? spellTabs[0])?.node}</section>
          </>
        ) : (
          <section className="card">
            <div className="spell-empty">
              {filtering ? 'No spells match your search or filters.' : 'No spells prepared yet.'}
            </div>
          </section>
        ))}

      {/* DESKTOP: the spellbook / focus / item & innate / rituals sections
          stacked exactly as before. On mobile these all live inside the page-level tab row above. */}
      {!isMobile && (
        <>
          {bookNodes.map((b) => b.node)}
          {learnedNode}
          {focusNode}
          {itemNodes.map((it) => it.node)}
          {ritualsNode}
        </>
      )}

      {scInfo &&
        (() => {
          const m = mains.find((x) => x.id === scInfo);
          if (!m) return null;
          return (
            <div className="picker-overlay" onClick={() => setScInfo(null)}>
              <div className="picker info-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
                <div className="picker-head">
                  <span className="info-title">{multi ? m.name : `${cap(m.tradition)} spellcasting`}</span>
                  <button className="picker-close" aria-label="Close" onClick={() => setScInfo(null)}>
                    <i className="ti ti-x" aria-hidden="true" />
                  </button>
                </div>
                <div className="sc-detail-pop">
                  <div className="sc-sub">{cap(m.type)} · key attribute {cap(m.keyAbility)}</div>
                  {m.font && m.font.type === 'battle' && (
                    <div className="sc-sub">Battle font: {m.font.slots} Bane/Bless slots (class DC, highest rank)</div>
                  )}
                  {m.font && m.font.type !== 'battle' && (
                    <div className="sc-sub">
                      Divine font: {m.font.slots} extra {cap(m.font.type)} {m.font.slots === 1 ? 'spell' : 'spells'} (highest rank)
                    </div>
                  )}
                  {!multi && deityDomains.length > 0 && <div className="sc-sub">Domains: {deityDomains.join(', ')}</div>}
                  {m.note && <div className="sc-sub">{m.note}</div>}
                </div>
              </div>
            </div>
          );
        })()}
      {detail && (
        <SpellDetail
          key={detail.id}
          spell={detail}
          maxRank={maxRank}
          atRank={detailAtRank}
          signature={signatureIds.has(detail.id)}
          notes={spellNotesFor(character, detail.id)}
          onClose={() => setDetail(null)}
        />
      )}
      {itemView &&
        (() => {
          const inv = character.inventory.find((iv) => iv.instanceId === itemView);
          const item = inv ? content.items[inv.itemId] : undefined;
          return inv && item ? (
            <ItemDetail inv={inv} item={item} content={content} inventory={character.inventory} feats={character.feats} character={character} charLevel={character.level} onPlay={onPlay} activeModes={character.activeModes} onClose={() => setItemView(null)} />
          ) : null;
        })()}
      {manageEntry && onPlay && (
        <ManageSpellsModal
          entry={manageEntry}
          character={character}
          content={content}
          onPlay={onPlay}
          onClose={() => setManageId(null)}
        />
      )}
      {learnEntry && onPlay && (
        <LearnSpellModal
          entry={learnEntry}
          character={character}
          content={content}
          onPlay={onPlay}
          onClose={() => setLearnId(null)}
        />
      )}
      {blendEntry && onPlay && (
        <SpellBlendingModal entry={blendEntry} onPlay={onPlay} onClose={() => setBlendId(null)} />
      )}
    </div>
  );
}
