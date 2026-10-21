import { useMemo, useState } from 'react';
import type { ModeDef, ModeModifier, ModifierType } from '../rules/types';
import {
  MODE_TARGETS,
  MODIFIER_TYPES,
  modeAlsoElsewhere,
  modeListedFor,
  modeOwnedElsewhere,
  modeRelevant,
  modeTargetLabel,
  modeTargetOptions,
  parseTargetKey,
  targetKey,
  type ModeTargetOption,
} from '../rules/modes';
import { usePrefs, togglePinnedMode } from '../data/prefs';
import { rankBySearch, searchMatches } from '../data/searchRank';
import { ModeDetailModal } from './ModeDetailModal';
import { useCopyOnWriteModes, useModeUsage, useModesRemoveFromCharacter, useModesSaveAsCopy } from './CopyOnWriteItems';

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const formatMod = (n: number) => (n >= 0 ? `+${n}` : String(n));

/** Human label for a modifier's target (incl. the save/skill detail). */
function targetLabel(mod: ModeModifier): string {
  if (mod.target === 'save') return mod.detail ? `${cap(mod.detail)} save` : 'Saving throws';
  if (mod.target === 'skill') return mod.detail ? (mod.detail.startsWith('lore:') ? cap(mod.detail.slice(5)) + ' Lore' : cap(mod.detail)) : 'Skills';
  // Every other kind carries its own detail-free label, and 'ability' spells the attribute out.
  if (mod.target === 'ability') return modeTargetLabel(mod);
  return MODE_TARGETS.find((t) => t.kind === mod.target)?.label ?? mod.target;
}
export function summarizeMod(mod: ModeModifier): string {
  const typed = mod.type === 'untyped' ? '' : ` ${mod.type}`;
  return `${formatMod(mod.value)}${typed} to ${targetLabel(mod)}${mod.appliesWhen ? ` — ${mod.appliesWhen}` : ''}`;
}

const newModifier = (): ModeModifier => ({ value: 1, type: 'status', target: 'all-checks' });

/** A scope a user-created mode can belong to — null id = no owner yet (an old mode; see `modeListedFor`). */
export interface ScopeOption {
  id: string | null;
  name: string;
}

/** The words for a mode with no owner. Never "All characters": such a mode becomes the first character's
 *  that switches it on or off or edits it (Guy 2026-10-21: "a mode I made on one shouldn't appear on another"),
 *  so promising "all" would describe the very leak he reported. ModeEditor uses this for every null scope,
 *  whatever name the caller passed (Settings → Modes passes its own). */
export const UNOWNED_MODE_LABEL = 'Not tied to a character';
export const UNOWNED_MODE_HINT =
  'Shows on every character until one of them switches it on or off, or edits it; then it belongs to that character.';
/** The owner choice's words for a mode whose character is not on this device (deleted, or on another device):
 *  Settings → Modes groups such modes as "Other characters (not on this device)". */
export const OTHER_OWNER_LABEL = 'Another character (not on this device)';

/** The "Modes" tab: toggle predefined class/ancestry/archetype modes (gated to your character), plus
 *  your own saved modes. "Pin to top" (a pin) lifts a mode into the Pinned group at the top — but only a mode
 *  this character's panel lists anyway (round 2, 2026-10-21): the pin list is device-wide, and a mode pinned
 *  on one character (an exemplar's ikon aura) must not show on another it does not fit. */
export function ModesPanel({
  library: libraryProp,
  predefined: predefinedProp,
  catalog,
  classId,
  ancestryId,
  featIds,
  activeIds,
  charKey,
  charName,
  lores,
  onToggle,
  onSave,
  onDelete,
}: {
  library: ModeDef[];
  predefined: ModeDef[];
  catalog: ModeDef[];
  classId?: string | null;
  ancestryId?: string | null;
  /** Feat ids this character has — gates archetype modes (a mode's `feats` list). */
  featIds?: ReadonlySet<string>;
  activeIds: string[];
  /** Roster id of the character whose panel this is. A mode made here belongs to it, and the panel lists only
   *  the user modes that belong here (src/rules/modes.ts `modeListedFor`, Guy 2026-10-21). */
  charKey?: string;
  charName?: string;
  /** This character's Lore keys, so a custom mode can target one. */
  lores?: string[];
  onToggle: (id: string) => void;
  onSave: (mode: ModeDef) => void;
  onDelete: (id: string) => void;
}) {
  const prefs = usePrefs();
  const copyOnWrite = useCopyOnWriteModes();
  const removeFromCharacter = useModesRemoveFromCharacter();
  const usage = useModeUsage();
  const saveAsCopy = useModesSaveAsCopy();
  const [editing, setEditing] = useState<ModeDef | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [q, setQ] = useState('');
  // The mode whose full write-up is open on top of the list.
  const [reading, setReading] = useState<ModeDef | null>(null);
  const active = new Set(activeIds);

  // An item mode belongs to its consumable — you get it by drinking the thing. It is not the
  // player's to pick, edit, pin or delete, so it is stripped here rather than at each call site:
  // the callers build `library` from content.modes, where an item mode looks exactly like a saved
  // one. (`modeRelevant` rejects them too, but search and "show all" deliberately bypass that gate.)
  // And a user mode is listed only where it belongs (Guy 2026-10-21, "a mode i made on one shouldnt apear
  // on another"): this character's own, one switched on here, and one saved before modes belonged to a
  // character wherever no other character uses it (src/rules/modes.ts `modeListedFor`). Search, "show all"
  // and the Pinned group all draw from this list, so none of them reaches another character's mode.
  const library = libraryProp.filter((m) => !m.fromItemId && modeListedFor(m, charKey, usage, active));
  const predefined = predefinedProp.filter((m) => !m.fromItemId);

  /*
   * A mode with no owner becomes THIS character's the first time this sheet edits it or switches it on or off
   * (src/rules/modes.ts) — a real player edit, saved through `onSave` like any other. Only on the player's
   * OWN sheet, the one view that sets ModesRemoveFromCharacterContext (src/App.tsx): the GM's edit sheet
   * draws a character that is not on his roster, and claiming his own mode for it would take it off his own
   * characters. Never a carried (copy-only) mode: an edit of one becomes the player's own copy, owned here
   * (src/App.tsx saveOwnModeDef), and switching one on writes nothing to their saved modes.
   */
  const claims = (m: ModeDef): boolean => removeFromCharacter && !!charKey && !m.charId && !copyOnWrite?.has(m.id);
  /* A mode another character owns, on the player's OWN sheet (see the toggle below). Not a carried one: that
   * stays listed through what the sheet carries. Not on the GM's edit sheet: there it is one of his own
   * characters' modes, and switching it off for a player is all he asked for. */
  const copiesOnSwitchOff = (m: ModeDef): boolean => removeFromCharacter && !copyOnWrite?.has(m.id) && modeOwnedElsewhere(m, charKey);

  if (editing) {
    // A mode this view may only COPY (./CopyOnWriteItems.tsx): one the sheet carries rather than one of
    // this device's own saved modes.
    const copyOnly = !!copyOnWrite?.has(editing.id);
    // …or one ANOTHER character owns (src/rules/modes.ts `modeOwnedElsewhere`), switched on here: on either
    // sheet an edit saves this character's own copy (src/App.tsx saveOwnModeDef, ./GmEditSheet.tsx saveModeDef)
    // and Delete only takes it off this character (round 2, 2026-10-21). On the GM's edit sheet that is one of
    // his own characters' modes switched on for a player: a plain Delete there would delete it from his own
    // character too.
    const foreign = !copyOnly && modeOwnedElsewhere(editing, charKey);
    // …or one another character has too, whoever owns it (src/rules/modes.ts `modeAlsoElsewhere`): its Delete
    // takes it off this character only, and Save makes this character its own copy (onSave below). On the GM's
    // edit sheet too: the usage map is the viewer's roster, so anyone it lists is one of the GM's OWN characters,
    // and his plain Delete or in-place edit there stripped the mode from, or changed the numbers of, his own
    // character (checker, round 4; ./GmEditSheet.tsx saveModeDef / removeModeDef take the copy / switch-off path).
    // A mode none of his characters uses keeps its plain Delete.
    const elsewhere = !copyOnly && modeAlsoElsewhere(editing, charKey, usage);
    const removeOnly = copyOnly || foreign || elsewhere;
    // The editor names the one character the mode will belong to; there is no "All characters" here. A mode
    // this view only copies (carried, another character's, or one another character also uses) becomes this
    // character's own copy on Save — through `saveAsCopy` on the player's own sheet, through the GM's edit
    // sheet's own saveModeDef there.
    const copiesOnSave = elsewhere && (!!saveAsCopy || !removeFromCharacter);
    const owner = copyOnly || foreign || copiesOnSave ? charKey : (editing.charId ?? (claims(editing) ? charKey : undefined));
    const scopeOptions: ScopeOption[] =
      charKey && owner === charKey ? [{ id: charKey, name: charName ? `Only ${charName}` : 'Only this character' }] : [];
    return (
      <ModeEditor
        draft={editing}
        catalog={catalog}
        scopeOptions={scopeOptions}
        lores={lores}
        onChange={setEditing}
        onCancel={() => setEditing(null)}
        onSave={() => {
          const name = editing.name.trim();
          // A mode another character also uses (`elsewhere`: this character's own or an unowned one, switched on
          // or carried there too) is never edited in place: that changed the other character's numbers (review,
          // 2026-10-21, "Rage" +2→+3 on A changed B). Save makes this character its own copy instead (src/App.tsx
          // copyModeHere); the other character's record is untouched. Only here, never in the toggle's claim.
          if (name && elsewhere && !foreign && saveAsCopy) saveAsCopy({ ...editing, name });
          else if (name) onSave(claims(editing) ? { ...editing, name, charId: charKey } : { ...editing, name });
          setEditing(null);
        }}
        onDelete={
          // Never on a copy-only mode on the GM's edit sheet: a mode the player's sheet carries — deleting it
          // could reach nobody (2026-10-20, saving-R2-chk-2). On the player's OWN sheet a copy-only mode (one a
          // GM push brought) is taken off this character instead (round 3, 2026-10-20, final finding N-a):
          // never deleted from anyone's saved modes. The same for a mode another character has too, on either
          // sheet: the GM's edit sheet takes one of his own characters' modes off this player only
          // (./GmEditSheet.tsx removeModeDef), never deleting it from his character.
          library.some((m) => m.id === editing.id) && (!copyOnly || removeFromCharacter)
            ? () => {
                onDelete(editing.id);
                setEditing(null);
              }
            : undefined
        }
        deleteLabel={removeOnly ? 'Remove from this character' : undefined}
        deleteTitle={
          copyOnly
            ? 'This mode came with the character and is not one of your saved modes. Removing it takes it off this character only.'
            : foreign
              ? 'This mode belongs to another character. Removing it takes it off this character only; the other character keeps it.'
              : elsewhere
                ? 'Another character has this mode too. Removing it takes it off this character only; it stays with the other.'
                : undefined
        }
      />
    );
  }

  const pinned = new Set(prefs.pinnedModes ?? []);
  const ql = q.trim().toLowerCase();
  const matches = (m: ModeDef) => searchMatches(q, m.name);

  // A predefined mode is on the default (non-search, non-show-all) list if it's relevant to the
  // character, OR force-shown because it's currently active (so a gated mode the player turned on never
  // disappears).
  const relevant = (md: ModeDef) => modeRelevant(md, classId, ancestryId, featIds);
  const defaultShow = (md: ModeDef) => relevant(md) || active.has(md.id);

  const allModes = [...library, ...predefined];
  const editableIds = new Set(library.map((m) => m.id));
  /*
   * Pinned HERE: a pinned mode this panel lists anyway — a user mode listed for this character (`library`,
   * already narrowed by `modeListedFor`), or a built-in or gated mode relevant to it or switched on here
   * (round 2, 2026-10-21). The pin list itself is device-wide (src/data/prefs.ts), so before this an
   * exemplar's pinned ikon aura ("Victor's Wreath (immanence)") sat at the top of a wizard's panel. A pin that
   * does not fit is kept, not dropped: it shows under "Show all" or a search, in its own category, its pin on.
   */
  const pinnedHere = (m: ModeDef) => pinned.has(m.id) && (editableIds.has(m.id) || defaultShow(m));
  /* bug 2026-09-13: search-rank. A name-only box, ranked inside each SECTION (Pinned / Your modes /
   * each category) rather than across them: the sections are the panel's structure, and lifting a
   * mode out of its category to the top of the page would tell the player it lives somewhere it
   * doesn't. Within a section the mode whose name was typed is now the first row. */
  const rank = (list: ModeDef[]) => rankBySearch(list, q, (m) => m.name);
  const pinnedList = rank(allModes.filter((m) => pinnedHere(m) && matches(m)));

  // Predefined shown in the categorized section (search → all; show-all → all; else default set),
  // minus the ones already surfaced in the Pinned section.
  const shownPredef = (ql || showAll ? predefined : predefined.filter(defaultShow))
    .filter(matches)
    .filter((m) => !pinnedHere(m));
  const hiddenCount = predefined.filter((md) => !relevant(md)).length;

  const groups: { cat: string; list: ModeDef[] }[] = [];
  for (const md of shownPredef) {
    const cat = md.category ?? 'Other';
    let g = groups.find((x) => x.cat === cat);
    if (!g) {
      g = { cat, list: [] };
      groups.push(g);
    }
    g.list.push(md);
  }
  for (const g of groups) g.list = rank(g.list); // bug 2026-09-13: search-rank

  const row = (mode: ModeDef, editable: boolean) => {
    const on = active.has(mode.id);
    const isPinned = pinned.has(mode.id);
    return (
      <div className={'mode-row' + (on ? ' on' : '')} key={mode.id}>
        <button
          className={'mode-toggle' + (on ? ' on' : '')}
          aria-label={on ? 'Deactivate' : 'Activate'}
          onClick={() => {
            // Switching a mode with no owner on OR off makes it this character's (`claims` above), before the
            // toggle. Off too (checker, round 3): an old mode two characters had on would otherwise leave the
            // list of the one that switched it off, with no way back. The other keeps listing it while it is on.
            if (editable && claims(mode)) onSave({ ...mode, charId: charKey });
            onToggle(mode.id);
            // Switching OFF a mode ANOTHER character owns (round 2, 2026-10-21): listed here only while it is on,
            // it would leave this list for good. So, after the toggle, the player's own sheet saves it — which
            // App turns into THIS character's own copy (src/App.tsx saveOwnModeDef: a fresh id owned here, and
            // whatever else here still has the original on, a companion, pointed at the copy). The copy stays
            // listed, switched off; the other character's mode is untouched.
            if (editable && on && copiesOnSwitchOff(mode)) onSave(mode);
          }}
        >
          <i className={'ti ' + (on ? 'ti-circle-check' : 'ti-circle')} aria-hidden="true" />
        </button>
        {/* Pressing the body READS the mode — it opens the full write-up rather than toggling, so
            reading one never accidentally activates it. The circle is the sole activate control. */}
        <button type="button" className="mode-info cond-row-open" title={`Read ${mode.name}`} onClick={() => setReading(mode)}>
          <div className="mode-name">
            {mode.name}
            {/* Every mode made now belongs to one character, so only the older ones with no owner are marked. */}
            {editable && charKey && !mode.charId && (
              <span
                className="mode-scope-tag"
                title="Saved before modes belonged to one character. It becomes a character’s own when that character switches it on or off, or edits it."
              >
                not tied to a character
              </span>
            )}
          </div>
          {mode.modifiers.length > 0 && <div className="mode-mods">{mode.modifiers.map(summarizeMod).join(' · ')}</div>}
          {mode.note && <div className="mode-note">{mode.note}</div>}
          {mode.modifiers.length === 0 && !mode.note && <div className="mode-mods">no modifiers</div>}
        </button>
        <button
          className={'mode-pin' + (isPinned ? ' on' : '')}
          aria-label={isPinned ? 'Unpin' : 'Pin to top'}
          aria-pressed={isPinned}
          title={isPinned ? 'Unpin' : 'Pin to top'}
          onClick={() => togglePinnedMode(mode.id)}
        >
          {/* A PIN, never the star: the star is the PinStar ("Add to Pinned") everywhere else, and "Pin to
              top" wears the same pin glyph as the sheet's other Pin to top toggles (MainTab.tsx PinToggle). */}
          <i className="ti ti-pin" aria-hidden="true" />
        </button>
        {editable && (
          <button className="mode-edit" aria-label="Edit" onClick={() => setEditing(structuredClone(mode))}>
            <i className="ti ti-edit" aria-hidden="true" />
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="modes-panel">
      <div className="modes-top">
        <span className="modes-hint">Toggle a mode to apply it. Conditional modifiers underline the stat instead of changing it.</span>
        <button
          className="add-item-btn"
          // A new mode belongs to the character it is made on (Guy 2026-10-21).
          onClick={() =>
            setEditing({ id: `mode-${Date.now().toString(36)}`, name: '', modifiers: [newModifier()], ...(charKey ? { charId: charKey } : {}) })
          }
        >
          <i className="ti ti-plus" aria-hidden="true" /> New mode
        </button>
      </div>

      <div className="search modes-search">
        <i className="ti ti-search" aria-hidden="true" />
        <input placeholder="Search modes" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {pinnedList.length > 0 && (
        <>
          <div className="modes-section-head">
            <span className="modes-section-title">Pinned</span>
          </div>
          <div className="modes-list">{pinnedList.map((mode) => row(mode, editableIds.has(mode.id)))}</div>
        </>
      )}

      <div className="modes-section-head">
        <span className="modes-section-title">Your modes</span>
      </div>
      {library.filter((m) => !pinned.has(m.id)).filter(matches).length === 0 ? (
        <div className="acts-empty">
          {library.length === 0
            ? 'No custom modes yet. Create one with “New mode” — optionally starting from a template.'
            : 'All your custom modes are pinned above.'}
        </div>
      ) : (
        <div className="modes-list">{rank(library.filter((m) => !pinned.has(m.id)).filter(matches)).map((mode) => row(mode, true))}</div>
      )}

      <div className="modes-section-head">
        <span className="modes-section-title">Class, ancestry &amp; archetype modes</span>
        {hiddenCount > 0 && (
          <label className="modes-showall">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            Show all ({hiddenCount} more)
          </label>
        )}
      </div>
      {groups.length === 0 ? (
        <div className="acts-empty">No predefined modes match this character. Tick “Show all” to browse every mode.</div>
      ) : (
        groups.map((g) => (
          <div className="modes-cat-block" key={g.cat}>
            <div className="modes-cat">{g.cat}</div>
            <div className="modes-list">{g.list.map((mode) => row(mode, false))}</div>
          </div>
        ))
      )}
      {reading && <ModeDetailModal mode={reading} onClose={() => setReading(null)} />}
    </div>
  );
}

/**
 * Pick what a modifier points at, by typing.
 *
 * A `<select>` of ten kinds plus a follow-up dropdown for "which save" / "which skill" meant the thing
 * you wanted was two controls deep and never where you looked. This is one control over the whole flat
 * list — "Reflex save", "Stealth", "Strength modifier", "Maximum HP" all one search away.
 */
function TargetPicker({
  options,
  value,
  onChange,
}: {
  options: ModeTargetOption[];
  value: string;
  onChange: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const current = options.find((o) => o.value === value);
  const ql = q.trim().toLowerCase();
  const shown = ql
    ? options.filter((o) => searchMatches(q, o.label, `${o.group} | ${o.alias ?? ''}`))
    : options;
  // Keep the picker's own headings, but only for the groups that survived the search.
  const groups: { name: string; list: ModeTargetOption[] }[] = [];
  for (const o of shown) {
    let g = groups.find((x) => x.name === o.group);
    if (!g) groups.push((g = { name: o.group, list: [] }));
    g.list.push(o);
  }
  /* bug 2026-09-13: search-rank. This box matches beyond the label — the group heading and the
   * option's alias — so typing "reflex" listed every option in the Saves GROUP before the Reflex save
   * itself. Ranked within each heading, since the heading is what tells the player where the target
   * lives. */
  for (const g of groups) g.list = rankBySearch(g.list, q, (o) => o.label, (o) => `${o.group} | ${o.alias ?? ''}`);
  return (
    <>
      <button
        type="button"
        className="me-target"
        aria-label="Target"
        title="What this modifier changes"
        onClick={() => {
          setQ('');
          setOpen(true);
        }}
      >
        <span className="me-target-val">{current?.label ?? 'Choose a target…'}</span>
        <i className="ti ti-selector" aria-hidden="true" />
      </button>
      {open && (
        <div className="picker-overlay" onClick={() => setOpen(false)}>
          <div className="picker me-target-picker" onClick={(e) => e.stopPropagation()}>
            <div className="picker-head">
              <span>What does this change?</span>
              <button className="picker-close" onClick={() => setOpen(false)} aria-label="Close">
                <i className="ti ti-x" aria-hidden="true" />
              </button>
            </div>
            <div className="picker-controls">
              <div className="search">
                <i className="ti ti-search" aria-hidden="true" />
                <input autoFocus placeholder="Search — “reflex”, “stealth”, “speed”…" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <span className="ss-count">{shown.length}</span>
            </div>
            <div className="cond-list">
              {groups.map((g) => (
                <div className="modes-cat-block" key={g.name}>
                  <div className="modes-cat">{g.name}</div>
                  <div className="me-target-grid">
                    {g.list.map((o) => (
                      <button
                        type="button"
                        key={o.value}
                        className={'me-target-opt' + (o.value === value ? ' on' : '')}
                        onClick={() => {
                          onChange(o.value);
                          setOpen(false);
                        }}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {shown.length === 0 && <div className="acts-empty">Nothing matches “{q}”.</div>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** The create/edit-a-mode form. Exported so Settings → Modes can reuse it (with the full roster as
 *  scope options). `scopeOptions` drives the universal-vs-character control: two or more is a choice; exactly
 *  one naming a character is shown as a fixed line (a character's own Modes panel); none shows nothing. */
export function ModeEditor({
  draft,
  catalog,
  scopeOptions = [{ id: null, name: UNOWNED_MODE_LABEL }],
  lores = [],
  onChange,
  onSave,
  onCancel,
  onDelete,
  deleteLabel = 'Delete',
  deleteTitle,
}: {
  draft: ModeDef;
  catalog: ModeDef[];
  scopeOptions?: ScopeOption[];
  /** This character's own Lore keys ('lore:warfare'), so a mode can target one. Empty in the
   *  character-less editor (Settings → Modes), where there is no character to read them off. */
  lores?: string[];
  onChange: (m: ModeDef) => void;
  onSave: () => void;
  onCancel: () => void;
  /** Provided only when editing an existing custom mode — renders a Delete button. */
  onDelete?: () => void;
  /** The Delete button's words and tooltip, when it does something narrower than delete the mode — "Remove
   *  from this character" for a mode the sheet carries (ModesPanel, round 3, 2026-10-20). */
  deleteLabel?: string;
  deleteTitle?: string;
}) {
  const targetOptions = useMemo(() => modeTargetOptions(lores), [lores]);
  const setMod = (i: number, patch: Partial<ModeModifier>) =>
    onChange({ ...draft, modifiers: draft.modifiers.map((m, j) => (j === i ? { ...m, ...patch } : m)) });
  const removeMod = (i: number) => onChange({ ...draft, modifiers: draft.modifiers.filter((_, j) => j !== i) });

  const applyTemplate = (id: string) => {
    const t = catalog.find((c) => c.id === id);
    if (!t) return;
    onChange({ ...draft, name: draft.name.trim() || t.name, modifiers: structuredClone(t.modifiers) });
  };
  /*
   * The owner choice (Settings → Modes, every character on this device). A mode whose owner is not among them —
   * a character deleted, or one on another device (modes sync, the roster's characters do not all) — gets its
   * own option, so the select never shows the wrong owner and a save that touches nothing else keeps it
   * (round 2, 2026-10-21). A <select> whose value matches no option shows its FIRST one instead.
   */
  const choice = scopeOptions.length > 1;
  const ownerOptions: ScopeOption[] =
    choice && draft.charId && !scopeOptions.some((s) => s.id === draft.charId)
      ? [...scopeOptions, { id: draft.charId, name: OTHER_OWNER_LABEL }]
      : scopeOptions;

  return (
    <div className="mode-editor">
      <label className="me-field">
        <span className="me-label">Mode name</span>
        <input value={draft.name} placeholder="e.g. Inspired" onChange={(e) => onChange({ ...draft, name: e.target.value })} />
      </label>

      {choice && (
        <label className="me-field">
          <span className="me-label">Available to</span>
          <select
            value={draft.charId ?? ''}
            onChange={(e) => onChange({ ...draft, charId: e.target.value || undefined })}
          >
            {ownerOptions.map((s) => (
              <option key={s.id ?? '__all__'} value={s.id ?? ''}>
                {s.id ? s.name : UNOWNED_MODE_LABEL}
              </option>
            ))}
          </select>
          {!draft.charId && (
            <span className="me-label me-scope-hint">
              {UNOWNED_MODE_HINT}
            </span>
          )}
        </label>
      )}
      {/* One character and no choice (a character's own Modes panel): say whose the mode is. */}
      {scopeOptions.length === 1 && scopeOptions[0].id && (
        <div className="me-field">
          <span className="me-label">Available to</span>
          <span className="me-scope-fixed">{scopeOptions[0].name}</span>
        </div>
      )}

      <label className="me-field">
        <span className="me-label">Start from a template (optional)</span>
        <select value="" onChange={(e) => e.target.value && applyTemplate(e.target.value)}>
          <option value="">— blank —</option>
          {Object.entries(
            catalog.reduce<Record<string, ModeDef[]>>((acc, c) => {
              (acc[c.category ?? 'Other'] ??= []).push(c);
              return acc;
            }, {}),
          ).map(([cat, list]) => (
            <optgroup label={cat} key={cat}>
              {list.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      <div className="me-mods-label">Modifiers</div>
      {draft.modifiers.map((mod, i) => {
        return (
          <div className="me-mod" key={i}>
            <input
              className="me-val"
              type="number"
              value={mod.value}
              aria-label="Value"
              onChange={(e) => setMod(i, { value: parseInt(e.target.value, 10) || 0 })}
            />
            <select value={mod.type} aria-label="Type" onChange={(e) => setMod(i, { type: e.target.value as ModifierType })}>
              {MODIFIER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {cap(t)}
                </option>
              ))}
            </select>
            <TargetPicker
              options={targetOptions}
              value={targetKey(mod.target, mod.detail)}
              onChange={(key) => {
                const { kind, detail } = parseTargetKey(key);
                setMod(i, { target: kind, detail });
              }}
            />
            <input
              className="me-when"
              value={mod.appliesWhen ?? ''}
              placeholder="applies when… (leave blank = always)"
              onChange={(e) => setMod(i, { appliesWhen: e.target.value || undefined })}
            />
            <button className="me-rm" aria-label="Remove modifier" onClick={() => removeMod(i)}>
              <i className="ti ti-x" aria-hidden="true" />
            </button>
          </div>
        );
      })}
      <button className="me-add" onClick={() => onChange({ ...draft, modifiers: [...draft.modifiers, newModifier()] })}>
        <i className="ti ti-plus" aria-hidden="true" /> Add modifier
      </button>

      <div className="me-actions">
        {onDelete && (
          <button className="btn-danger me-delete" title={deleteTitle} onClick={onDelete}>
            <i className="ti ti-trash" aria-hidden="true" /> {deleteLabel}
          </button>
        )}
        <button className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn-primary" disabled={!draft.name.trim()} onClick={onSave}>
          Save mode
        </button>
      </div>
    </div>
  );
}
