/*
 * THE TWEAKS PAGE (decisions 26-29; plan B section 4, WP6 + WP7). It opens from the Tweaks button in the
 * Builder's top bar and takes the level page's place in `.bmain`; the Character panel beside it (or above it on
 * a phone) is the Builder's and is left alone, so the stats stay in view while a tweak is changed.
 *
 * Every stored tweak is one row (tweaks/model.ts `tweakRows` — the page's one reader of `overrides`),
 * grouped by the registry's `group`, with its own on/off switch; one row or one "Add a tweak" menu is open at
 * a time (`openKey`). Every write goes through the write door (blocks/write.ts `writeTweaks`) against the
 * draft, so Cancel still throws it all away and Save stores it (blocks/save.ts).
 *
 * WP6 built the shell: the list, the switches, Delete, Show, the broken row's "Point to another" / Remove, and
 * the "Add a tweak" menus. WP7 puts the editors in (./TweakEditor.tsx, read off the registry's parts): an open
 * row shows its own editor (each change written at once, B22), an open menu the "Add a tweak" editor (a draft
 * until "Add"). The open row follows its tweak when an edit moves its key (a given feat's level, a rank's
 * target, a kind stored under another key), and a tweak just added opens as its row. While the Add editor
 * holds a draft, `onPendingChange(true)` tells the Builder that leaving would lose it.
 *
 * WP8: a feat given through Tweaks asks its OWN questions (its choice, Lore, bonus skill feat, the feats it
 * grants …) under its open row — the Builder's `featQuestions`, handed in as `renderFeatQuestions`, with the
 * key its answers are stored under (`override:<featId>`). Only an ACTIVE given feat asks (heldFeats.ts: on,
 * held at the character's level, not removed, no slot holding it). What is still unanswered (`pending`, the
 * Builder's `levelChoices` lines on `TWEAKS_PAGE`) shows as the page's "choices left" tag and on its row.
 * `focusKey` opens one row when the page opens ("Show in Tweaks" on the attribute card).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { BuildState, MissingChoice } from '../../rules/build';
import { heldFeatSlots, overrideSlotKey } from '../../rules/heldFeats';
import { explainStat } from '../../rules/explain';
import { recordName } from '../../rules/blocks/names';
import { pinAddedIds, writeTweaks, type TweakWrite } from '../../rules/blocks/write';
import type { Character, ContentDatabase, DescRef } from '../../rules/types';
import { DescriptionModal } from '../../sheet/DescriptionModal';
import { descNodeOf } from '../../sheet/FilterableSelect';
import type { DescNode } from '../../sheet/descref';
import { StatDetailModal } from '../../sheet/StatDetailModal';
import type { BuilderActions } from '../shared';
import { addedTweakKeys, groupRows, tweakMenus, tweakRows, type TweakGoTo, type TweakRowModel, type TweakShow } from './model';
import { TweakAddEditor, TweakRowEditor, type EditorWriteResult } from './TweakEditor';
import { TweakRow, type RepointChoice } from './TweakRow';

const NO_PENDING: MissingChoice[] = [];

const GROUP_ICON: Record<string, string> = {
  Numbers: 'ti-hash',
  Ranks: 'ti-award',
  Feats: 'ti-star',
  'Class features': 'ti-puzzle',
  Languages: 'ti-language',
  Spells: 'ti-sparkles',
  Text: 'ti-edit',
  Choices: 'ti-list-check',
};

export function TweaksPage({
  build,
  actions,
  content,
  bookContent,
  character,
  derivedBuild,
  onDone,
  onPendingChange,
  renderFeatQuestions,
  pending = NO_PENDING,
  focusKey,
  onGoTo,
}: {
  build: BuildState;
  actions: BuilderActions;
  /** The Builder's FULL content view (`ovContent`), never the Sources-filtered one (a record from a book
   *  switched off would read as broken). */
  content: ContentDatabase;
  /** The content without the player's text edits (the Builder's `baseContent`): what a text edit is measured
   *  against. Defaults to `content`. */
  bookContent?: ContentDatabase;
  /** The character the draft builds (`featPrereqChar`): names, casting entries, the breakdowns. */
  character: Character;
  /** The Builder was opened on a build rebuilt from the sheet (no stored build; open point 3). */
  derivedBuild?: boolean;
  onDone: () => void;
  /** The "Add a tweak" editor holds a draft (true) or not (false): leaving the Builder then asks first. */
  onPendingChange?: (dirty: boolean) => void;
  /** A given feat's own questions (the Builder's `featQuestions`), drawn under its open row (plan B WP8). */
  renderFeatQuestions?: (featId: string, key: string) => ReactNode;
  /** The choices still owed on this page (`levelChoices` lines on `TWEAKS_PAGE`). */
  pending?: MissingChoice[];
  /** The row to open when the page opens. */
  focusKey?: string | null;
  /** Tweaks phase 2: a choice row's "Go to" (the level page or Setup, then `flashPlace`). Absent = no button;
   *  the Builder wires it with the first picker work package. */
  onGoTo?: (goTo: TweakGoTo) => void;
}) {
  // The ACTIVE given feats, by their row key: only those ask their questions here.
  const givenFeatOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of heldFeatSlots(build, undefined, { via: ['override'] })) if (e.tweakKey) m.set(e.tweakKey, e.featId);
    return m;
  }, [build]);
  // A record with nothing to show (no text, no refs, no page of its own: `descNodeOf` → null) gets no Show
  // button, never an empty popup (WP6 fix round 1). A given feat that still owes an answer says so on its row.
  const rows = useMemo(
    () =>
      tweakRows(build, character, content).map((r) => {
        const row = r.show && 'record' in r.show && !recordNode(content, r.show.record.bucket, r.show.record.id) ? { ...r, show: undefined } : r;
        const featId = givenFeatOf.get(r.key);
        const owed = featId ? pending.filter((m) => m.featId === featId).length : 0;
        return owed ? { ...row, chips: [...row.chips, { kind: 'choicesLeft' as const, text: owed === 1 ? '1 choice left' : `${owed} choices left` }] } : row;
      }),
    [build, character, content, givenFeatOf, pending],
  );
  const groups = useMemo(() => groupRows(rows), [rows]);
  const menus = useMemo(() => tweakMenus(), []);
  const [openKey, setOpenKey] = useState<string | null>(focusKey ?? null);
  const [advOpen, setAdvOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [show, setShow] = useState<TweakShow | null>(null);
  /** A retry the updater refused (WP1 finding: the newer build refused the write the page had already opened a
   *  row for). The updater only records it — it must stay pure — and the effect below closes that row and says
   *  why on the next render. */
  const refusedRetry = useRef<{ keys: string[]; why: string } | null>(null);
  useEffect(() => {
    const r = refusedRetry.current;
    if (!r) return;
    refusedRetry.current = null;
    setOpenKey((k) => (k && r.keys.includes(k) ? null : k));
    setNotice(`Not saved: ${r.why}`);
  });

  /** Every write through the door (two writes as one where one change of the player's needs both). A refusal
   *  writes nothing and comes back with why; `added` holds the row keys the write created. */
  const write = (w: TweakWrite | TweakWrite[]): EditorWriteResult => {
    const ws = Array.isArray(w) ? w : [w];
    const tried = writeTweaks(build, ws);
    if (tried.refused) return { refused: tried.refused, added: [] };
    const added = addedTweakKeys(build, tried);
    const gone = addedTweakKeys(tried, build);
    // Tweaks phase 2 (C4): a new block id carries a random tail, so writing the same change twice mints two
    // different ids. On the build this write was made against, the updater hands back THAT write (an updater
    // React runs twice stays pure); on a newer build it writes again with the ids the first try minted pinned
    // (`pinAddedIds`), so the row `added` opens is the block stored (WP1 check, F5: the retry minted a new id and
    // the page opened a row no block had).
    const again = pinAddedIds(ws, tried);
    actions.patch((b) => {
      const r = b === build ? tried : writeTweaks(b, again);
      if (r.refused) refusedRetry.current = { keys: added, why: r.refused };
      return r.refused ? {} : { overrides: r.overrides };
    });
    // The open row follows its tweak when the write moved it to another key.
    if (added.length === 1) setOpenKey((k) => (k && gone.includes(k) ? added[0] : k));
    return { added };
  };
  /** The page's own controls (a switch, Delete, Point to another): a refusal shows as the page's notice. */
  const pageWrite = (w: TweakWrite) => setNotice(write(w).refused ?? null);

  const toggleOpen = (key: string) => setOpenKey((k) => (k === key ? null : key));
  const repoint = (row: TweakRowModel, to: RepointChoice) => {
    pageWrite({ op: 'repoint', key: row.key, ...to });
  };

  const hasRankTweak = rows.some((r) => r.kind.startsWith('rank.'));
  const main = menus.filter((m) => m.place === 'main');
  const advanced = menus.filter((m) => m.place === 'advanced');
  const openMenu = openKey?.startsWith('menu:') ? menus.find((m) => `menu:${m.name}` === openKey) : undefined;
  const ctx = { build, character, content, bookContent: bookContent ?? content, rows, write };

  return (
    <div className="card-sec lvl-page tw-page">
      <div className="lvl-page-head">
        <span className="bsec-title">
          <i className="ti ti-adjustments" aria-hidden="true" />
          Tweaks
        </span>
        {/* The level pages' tag: what a given feat still asks (its row says which). */}
        {pending.length > 0 && (
          <span className="lvl-pending-tag tw-pending" title={pending.map((m) => m.label).join('\n')}>
            <i className="ti ti-alert-circle" aria-hidden="true" /> {pending.length} {pending.length === 1 ? 'choice' : 'choices'} left
          </span>
        )}
        <button type="button" className="tw-done" onClick={onDone}>
          Done
        </button>
      </div>
      <p className="setup-note tw-intro">Your own changes to this character&rsquo;s rules. Each one can have a reason, a start level and its own on/off.</p>
      {derivedBuild && hasRankTweak && (
        <p className="setup-note tw-derived">
          <i className="ti ti-info-circle" aria-hidden="true" /> This character had no saved build, so it was rebuilt from its sheet: a skill you picked may show as given by a tweak.
        </p>
      )}
      {notice && (
        <p className="tw-notice" role="status">
          <i className="ti ti-alert-circle" aria-hidden="true" /> {notice}
        </p>
      )}

      {groups.length === 0 && <p className="tw-empty">No tweaks yet. Add one below.</p>}
      {groups.map((g) => (
        <section key={g.group} className="lvl-group tw-group" data-group={g.group}>
          <div className="lvl-group-h">
            <i className={'ti ' + (GROUP_ICON[g.group] ?? 'ti-versions')} aria-hidden="true" />
            <span className="tw-group-name">{g.group}</span>
            <span className="tw-group-count">{g.rows.length}</span>
          </div>
          <ul className="tw-list">
            {g.rows.map((row) => (
              <TweakRow
                key={row.key}
                row={row}
                open={openKey === row.key}
                onOpen={() => toggleOpen(row.key)}
                onClose={() => setOpenKey(null)}
                onToggle={() => pageWrite({ op: 'setOn', key: row.key, on: !row.on })}
                onRemove={() => {
                  setOpenKey(null);
                  pageWrite({ op: 'remove', key: row.key });
                }}
                onShow={() => row.show && setShow(row.show)}
                onRepoint={(to) => repoint(row, to)}
                onRepointFields={(fields) => pageWrite({ op: 'update', key: row.key, draft: { fields } })}
                onGoTo={onGoTo}
                content={content}
                character={character}
                editor={
                  openKey === row.key ? (
                    <>
                      <TweakRowEditor row={row} {...ctx} />
                      {(() => {
                        // An active given feat's own questions, under its editor (plan B WP8).
                        const featId = givenFeatOf.get(row.key);
                        return featId && renderFeatQuestions ? (
                          <div className="tw-feat-questions" data-feat-questions={featId}>
                            {renderFeatQuestions(featId, overrideSlotKey(featId))}
                          </div>
                        ) : null;
                      })()}
                    </>
                  ) : undefined
                }
              />
            ))}
          </ul>
        </section>
      ))}

      <div className="tw-add">
        <div className="tw-add-h">Add a tweak</div>
        <div className="tw-menus">
          {main.map((m) => (
            <MenuButton key={m.name} name={m.name} open={openKey === `menu:${m.name}`} onClick={() => toggleOpen(`menu:${m.name}`)} />
          ))}
        </div>
        <button type="button" className="tw-adv-toggle" aria-expanded={advOpen} onClick={() => setAdvOpen((o) => !o)}>
          <i className={'ti ' + (advOpen ? 'ti-chevron-down' : 'ti-chevron-right')} aria-hidden="true" /> Advanced
        </button>
        {advOpen && (
          <div className="tw-adv tw-menus">
            {advanced.map((m) => (
              <MenuButton key={m.name} name={m.name} open={openKey === `menu:${m.name}`} onClick={() => toggleOpen(`menu:${m.name}`)} />
            ))}
          </div>
        )}
        {openMenu && (
          <TweakAddEditor
            key={openMenu.name}
            menu={openMenu}
            {...ctx}
            onAdded={(added) => setOpenKey(added[0] ?? null)}
            onCancel={() => setOpenKey(null)}
            onPending={onPendingChange}
          />
        )}
      </div>

      {show && 'stat' in show && (
        <StatDetailModal breakdown={explainStat(character, content, show.stat, build)} character={character} content={content} onClose={() => setShow(null)} />
      )}
      {show && 'record' in show && (() => {
        const root = recordNode(content, show.record.bucket, show.record.id);
        return root ? <DescriptionModal root={root} onClose={() => setShow(null)} /> : null;
      })()}
    </div>
  );
}

function MenuButton({ name, open, onClick }: { name: string; open: boolean; onClick: () => void }) {
  return (
    <button type="button" className={'tw-menu' + (open ? ' on' : '')} aria-expanded={open} onClick={onClick}>
      <i className="ti ti-plus" aria-hidden="true" /> {name}
    </button>
  );
}

/** The description popup's root for a record (its own page by id when it has one; PinStar via RecordCard):
 *  the pickers' one helper `descNodeOf`, so a record with nothing to show is null, not an empty popup. */
function recordNode(content: ContentDatabase, bucket: string, id: string): DescNode | null {
  const rec = (content as unknown as Record<string, Record<string, { description?: string; descRefs?: DescRef[] }> | undefined>)[bucket]?.[id];
  return descNodeOf({ id, name: recordName(content, bucket as Parameters<typeof recordName>[1], id), description: rec?.description, descRefs: rec?.descRefs }, bucket);
}
