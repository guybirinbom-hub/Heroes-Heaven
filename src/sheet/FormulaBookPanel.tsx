import { useMemo, useState } from 'react';
import type { Character, ContentDatabase, InventoryItem, Item } from '../rules/types';
import { addFormula, pickFormula, removeFormula, type PlayUpdater } from '../rules/play';
import {
  FORMULA_BOOK_CAPACITY,
  formulaOptions,
  formulaSlots,
  type FormulaSlot,
} from '../rules/formulaBook';
import { FilterableSelect, PickerRow, descNodeOf } from './FilterableSelect';
import { DescriptionModal } from './DescriptionModal';
import { ITEM_SPEC } from './filterSpecs';
import type { DescNode } from './descref';

/**
 * What lives inside a formula book: the formulas it holds, and the empty slots a record still owes.
 *
 * A formula is a REFERENCE — "<item name> formula" — so nothing here touches the inventory. Pressing
 * an empty slot opens only what that record allows; pressing Add formula opens everything, because a
 * formula can also be bought, found, or invented. Both write straight into this book instance, and
 * answering a slot marks the grant spent for good (see src/rules/formulaBook.ts).
 */
export function FormulaBookPanel({
  character,
  inv,
  content,
  onPlay,
}: {
  character: Character;
  inv: InventoryItem;
  content: ContentDatabase;
  onPlay?: PlayUpdater;
}) {
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [slot, setSlot] = useState<FormulaSlot | null>(null);
  const [descNode, setDescNode] = useState<DescNode | null>(null);

  const formulas = inv.formulas ?? [];
  const full = formulas.length >= FORMULA_BOOK_CAPACITY;
  // Slots the character has never answered. The ledger lives on the character, not on the book, so a
  // book that was lost and replaced shows no slots at all — the grant is already spent.
  const openSlots = useMemo(
    () => formulaSlots(character, content).filter((s) => !(s.key in (character.formulaPicks ?? {}))),
    [character, content],
  );
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return formulas
      .map((id) => ({ id, item: content.items[id] as Item | undefined }))
      .filter((r) => !needle || (r.item?.name ?? r.id).toLowerCase().includes(needle))
      .sort((a, b) => (a.item?.name ?? a.id).localeCompare(b.item?.name ?? b.id));
  }, [formulas, content.items, q]);

  const slotPool = useMemo(() => (slot ? formulaOptions(slot, character, content) : []), [slot, character, content]);
  const allItems = useMemo(() => Object.values(content.items), [content.items]);

  return (
    <div className="sd-uses sd-formulas">
      <span className="sd-uses-title">
        Formulas <span className="fb-count">{formulas.length} / {FORMULA_BOOK_CAPACITY}</span>
      </span>
      {onPlay && openSlots.length > 0 && (
        <div className="fb-slots">
          {/* Disabled once the book is full. `pickFormula` records the slot as spent whether or not
              `withFormula` accepted the write, so pressing one of these at capacity burned the grant
              and wrote nothing — inert AND destructive, with no sign of either. */}
          {openSlots.map((s) => (
            <button
              key={s.key}
              type="button"
              className="fb-slot"
              disabled={full}
              title={full ? `This book already holds ${FORMULA_BOOK_CAPACITY} formulas — remove one before using this slot.` : s.note}
              onClick={() => setSlot(s)}
            >
              <i className="ti ti-plus" aria-hidden="true" />
              <span className="fb-slot-label">{s.label}</span>
              <span className="fb-slot-src">from {s.sourceName}</span>
            </button>
          ))}
        </div>
      )}
      {formulas.length > 1 && (
        <input className="hb-input fb-search" placeholder="Search this book…" value={q} onChange={(e) => setQ(e.currentTarget.value)} />
      )}
      {rows.length > 0 ? (
        <ul className="fb-list">
          {rows.map(({ id, item }) => {
            const node = item ? descNodeOf({ name: item.name, description: item.description, descRefs: item.descRefs }, 'items') : null;
            return (
              <li className="fb-row" key={id}>
                {node ? (
                  <button type="button" className="fb-name" onClick={() => setDescNode(node)} title="View item">
                    {item!.name} formula
                  </button>
                ) : (
                  <span className="fb-name fb-name-static">{item?.name ?? id} formula</span>
                )}
                {item && <span className="fb-lvl">Lvl {item.level ?? 0}</span>}
                {onPlay && (
                  <button
                    type="button"
                    className="fb-remove"
                    aria-label={`Remove the ${item?.name ?? id} formula`}
                    title="Remove this formula"
                    onClick={() => onPlay((p) => removeFormula(p, inv.instanceId, id))}
                  >
                    <i className="ti ti-x" aria-hidden="true" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <span className="sd-uses-hint">{q.trim() ? 'No formula in this book matches.' : 'This book is empty.'}</span>
      )}
      {onPlay && (
        <span className="sd-uses-row">
          <button type="button" className="sd-use-btn" disabled={full} title={full ? 'This book holds 100 formulas — the most one can hold.' : undefined} onClick={() => setAdding(true)}>
            <i className="ti ti-plus" aria-hidden="true" /> Add formula
          </button>
          {full && <span className="sd-uses-hint">A formula book holds {FORMULA_BOOK_CAPACITY} formulas.</span>}
        </span>
      )}
      {adding && onPlay && (
        <FormulaPicker
          title="Add a formula"
          items={allItems}
          have={formulas}
          onClose={() => setAdding(false)}
          onSelect={(itemId) => {
            onPlay((p) => addFormula(p, inv.instanceId, itemId));
            setAdding(false);
          }}
        />
      )}
      {slot && onPlay && (
        <FormulaPicker
          title={`${slot.label} — from ${slot.sourceName}`}
          items={slotPool}
          have={formulas}
          note={slot.note}
          onClose={() => setSlot(null)}
          onSelect={(itemId) => {
            onPlay((p) => pickFormula(p, inv.instanceId, slot.key, itemId));
            setSlot(null);
          }}
        />
      )}
      {descNode && <DescriptionModal root={descNode} onClose={() => setDescNode(null)} />}
    </div>
  );
}

/** The item picker both routes use — the full catalog for Add formula, a grant's own pool for a slot. */
function FormulaPicker({
  title,
  items,
  have,
  note,
  onClose,
  onSelect,
}: {
  title: string;
  items: Item[];
  have: string[];
  note?: string;
  onClose: () => void;
  onSelect: (itemId: string) => void;
}) {
  return (
    <FilterableSelect
      title={title}
      icon="ti-book"
      items={items}
      spec={ITEM_SPEC}
      rowKey={(it) => it.id}
      onClose={onClose}
      headerExtra={note ? <span className="fsel-note">{note}</span> : undefined}
      renderRow={(it, openDesc) => {
        const node = descNodeOf({ name: it.name, description: it.description, descRefs: it.descRefs }, 'items');
        const known = have.includes(it.id);
        return (
          <PickerRow
            lead={<span className="alchemy-pick-lvl">Lvl {it.level ?? 0}</span>}
            name={it.name}
            chosen={known}
            onOpenDesc={node ? () => openDesc(node) : undefined}
            selectLabel="Write"
            selectDisabled={known}
            disabledReason={known ? 'This book already holds that formula' : undefined}
            onSelect={() => onSelect(it.id)}
          />
        );
      }}
    />
  );
}
