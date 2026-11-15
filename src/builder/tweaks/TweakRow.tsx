/*
 * One tweak in the Tweaks page's list (decision 27; plan B section 4.2, WP6): one short line — what, where,
 * reason, from level, its notes — with its own on/off switch BESIDE it (never nested in the line's button),
 * and, when opened, its editor under it. The page holds the one open key, so only one tweak is open at a time.
 *
 * WP6 builds the shell of the editor: "Show" (the statistic's breakdown or the record's description, both with
 * the Builder's PinContext, so PinStar stays), "Delete tweak" (asks nothing, decision 20), and for a broken
 * tweak the problem, "Point to another" and "Remove" (decision 13). The parts that change a tweak (target,
 * number, rank, record, text, level, reason) are WP7's TweakRowEditor (./TweakEditor.tsx, assembled from the
 * registry), handed in as `editor` and shown above these actions — never on a broken row (its record or target
 * is chosen again first) or a read-only one.
 * A tweak made by a newer version is read-only: no switch, no parts, only what this version does with it.
 */
import { useMemo, type ReactNode } from 'react';
import type { Character, ContentDatabase, FeatCategory } from '../../rules/types';
import { PopupSelect, SearchSelect } from '../shared';
import { AnswerPart, FeatPlacePart } from './choiceParts';
import { carrierSkillOptions, targetChoices, type TweakGoTo, type TweakRowModel } from './model';
import { PartNote } from './parts';

export interface RepointChoice {
  record?: string;
  target?: string;
  category?: FeatCategory;
}

export function TweakRow({
  row,
  open,
  onOpen,
  onToggle,
  onRemove,
  onShow,
  onRepoint,
  onRepointFields,
  onGoTo,
  onClose,
  content,
  character,
  editor,
}: {
  row: TweakRowModel;
  open: boolean;
  onOpen: () => void;
  onToggle: () => void;
  onRemove: () => void;
  onShow: () => void;
  onRepoint: (to: RepointChoice) => void;
  /** Tweaks phase 2: a broken choice tweak pointed at another place, question or answer — its own fields
   *  rewritten (`op: 'update'` with `fields`), never a new tweak. */
  onRepointFields?: (fields: Record<string, unknown>) => void;
  /** "Go to": the page that draws the tweak's pick or place (`row.goTo`). Absent = no button. */
  onGoTo?: (goTo: TweakGoTo) => void;
  onClose: () => void;
  /** The Builder's FULL content view (`ovContent`): the record pickers ignore Sources (gold-set R12). */
  content: ContentDatabase;
  character: Character;
  /** The row's own editor (WP7), shown while it is open. */
  editor?: ReactNode;
}) {
  const sub: { cls: string; text: string }[] = [
    { cls: 'tw-row-where', text: row.where },
    ...(row.reason ? [{ cls: 'tw-row-reason', text: `“${row.reason}”` }] : []),
    ...(row.fromLevel ? [{ cls: 'tw-row-from', text: `from level ${row.fromLevel}` }] : []),
    ...(!row.on && !row.readOnly ? [{ cls: 'tw-row-paused', text: 'paused' }] : []),
  ];
  return (
    <li
      className={'tw-row' + (open ? ' open' : '') + (!row.live ? ' off' : '') + (row.broken ? ' broken' : '') + (row.readOnly ? ' newer' : '')}
      data-key={row.key}
      data-kind={row.kind}
    >
      <div className="tw-row-line">
        <button type="button" className="tw-row-head" aria-expanded={open} onClick={onOpen}>
          <i className={'ti tw-row-chev ' + (open ? 'ti-chevron-down' : 'ti-chevron-right')} aria-hidden="true" />
          {(row.broken || row.readOnly) && <i className={'ti tw-row-warn ' + (row.broken ? 'ti-alert-triangle' : 'ti-versions')} aria-hidden="true" />}
          <span className="tw-row-text">
            <span className="tw-row-what">{row.what}</span>
            <span className="tw-row-sub">
              {sub.map((s) => (
                <span key={s.cls} className={s.cls}>
                  {s.text}
                </span>
              ))}
              {row.chips.map((c) => (
                <span key={c.kind} className={'tw-chip tw-chip-' + c.kind}>
                  {c.text}
                </span>
              ))}
            </span>
          </span>
        </button>
        {!row.readOnly && (
          <button
            type="button"
            className={'inv-toggle tw-toggle' + (row.on ? ' on' : '')}
            aria-pressed={row.on}
            aria-label={`${row.on ? 'Turn off' : 'Turn on'}: ${row.what}`}
            title={row.on ? 'On — click to pause this tweak' : 'Paused — click to turn it back on'}
            onClick={onToggle}
          >
            <span className="tw-switch" aria-hidden="true" />
          </button>
        )}
      </div>
      {open && (
        <div className="tw-editor">
          {row.newer && <p className="tw-editor-note">{row.newer}</p>}
          {row.broken && (
            <>
              <p className="tw-problem">
                <i className="ti ti-alert-triangle" aria-hidden="true" /> This tweak is not applied: {row.broken}.
              </p>
              <RepointPart row={row} content={content} character={character} onRepoint={onRepoint} onRepointFields={onRepointFields} />
            </>
          )}
          {/* WP6 (C29): "Not in use" (a removed feat slot no longer drawn) offers Point to another beside Remove. */}
          {!row.broken && !row.readOnly && row.repoint && <RepointPart row={row} content={content} character={character} onRepoint={onRepoint} onRepointFields={onRepointFields} />}
          {!row.broken && !row.readOnly && editor}
          {!row.readOnly && (
            <div className="tw-editor-actions">
              {row.goTo && onGoTo && (
                <button type="button" className="tw-goto tw-goto-place" onClick={() => onGoTo(row.goTo!)}>
                  <i className="ti ti-arrow-right" aria-hidden="true" /> Go to
                </button>
              )}
              {row.show && (
                <button type="button" className="tw-goto" onClick={onShow}>
                  <i className="ti ti-arrow-right" aria-hidden="true" /> Show
                </button>
              )}
              <button type="button" className="tw-del" onClick={onRemove}>
                <i className="ti ti-trash" aria-hidden="true" /> {row.broken ? 'Remove' : (row.deleteLabel ?? 'Delete tweak')}
              </button>
              <button type="button" className="tw-row-done" onClick={onClose}>
                Done
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** "Point to another" for a broken tweak (decision 13): its record, or its target, chosen again. */
function RepointPart({
  row,
  content,
  character,
  onRepoint,
  onRepointFields,
}: {
  row: TweakRowModel;
  content: ContentDatabase;
  character: Character;
  onRepoint: (to: RepointChoice) => void;
  onRepointFields?: (fields: Record<string, unknown>) => void;
}) {
  const rp = row.repoint;
  const recordOptions = useMemo(() => {
    if (!rp || !('records' in rp)) return [];
    const isText = row.kind === 'text.edit';
    // `only` narrows a bucket to the ids it names (the sanctification repoint: the records that ask one).
    const only = rp.only ? new Set(rp.only) : null;
    return rp.records.flatMap((bucket) =>
      Object.entries((content[bucket] ?? {}) as Record<string, { name?: string; level?: number }>)
        .filter(([id]) => !only || only.has(id))
        .map(([id, r]) => ({
        id: isText ? `${bucket}/${id}` : id,
        name: r.name ?? id,
        ...(typeof r.level === 'number' ? { note: `Level ${r.level}` } : {}),
        ...(rp.records.length > 1 ? { group: bucket === 'feats' ? 'Feats' : bucket === 'classFeatures' ? 'Class features' : bucket } : {}),
      })),
    );
  }, [rp, row.kind, content]);
  const targetOptions = useMemo(() => (rp && 'aspect' in rp ? targetChoices(rp.aspect, rp.kinds, character) : []), [rp, character]);
  if (!rp) return null;
  if ('answer' in rp) {
    // Only the answer broke: another one for the same place (rev 3 finding 16). WP13: an extra skill increase's skill
    // is the one broken answer this version re-points (a changed answer, WP10, comes after the record rebuild).
    if (!onRepointFields) return null;
    // WP11: an extra skill increase points to a skill or Lore the character knows at its level (its own greys).
    return (
      <div className="tw-repoint">
        <AnswerPart
          mode={rp.answer}
          label="Point to another"
          value={undefined}
          options={carrierSkillOptions(character, row.inst?.params?.level as number | undefined)}
          newLore={false}
          onCommit={(v) => onRepointFields({ skill: v })}
        />
      </div>
    );
  }
  if ('places' in rp && rp.options) {
    // A removed feat slot no longer drawn (WP6): another drawn slot, written to the row's own place fields. WP14: a
    // removed skill-increase or boost place: another drawn place of the same kind.
    if (!onRepointFields) return null;
    const options = rp.options;
    return (
      <div className="tw-repoint">
        <FeatPlacePart
          label="Point to another"
          value={undefined}
          options={options}
          onChange={(key) => {
            const o = options.find((x) => x.value === key);
            // A Setup boost set has no level: an update clears a level-set place's own (undefined clears a field).
            if (o && !o.disabled) onRepointFields({ ...o.place, ...(o.place.place === 'boost' && o.place.level === undefined ? { level: undefined } : {}) });
          }}
        />
      </div>
    );
  }
  if ('places' in rp) {
    // A removed place with nothing to point at (second check, finding 2: no control that does nothing). WP13: the one
    // removal that could break this way, a class choice whose group left the class, is WP16, after the record rebuild.
    return <PartNote text="This place is not drawn any more. Remove this tweak." />;
  }
  if ('records' in rp) {
    return (
      <div className="tw-part tw-repoint" data-part="record">
        <SearchSelect
          label="Point to another"
          value={null}
          placeholder="Point to another…"
          options={recordOptions}
          sortByName
          bare
          onChange={(id) => {
            if (row.kind === 'grant.feat') {
              const category = (content.feats?.[id] as { category?: FeatCategory } | undefined)?.category;
              onRepoint({ record: id, ...(category ? { category } : {}) });
            } else onRepoint({ record: id });
          }}
        />
      </div>
    );
  }
  return (
    <div className="tw-part tw-repoint" data-part="target">
      <PopupSelect
        value={null}
        title="Point to another"
        placeholder="Point to another…"
        search
        options={targetOptions.map((t) => ({ value: t.key, label: t.label, note: t.group }))}
        onChange={(key) => onRepoint({ target: key })}
      />
    </div>
  );
}
