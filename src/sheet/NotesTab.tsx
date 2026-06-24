import { useEffect, useRef, useState } from 'react';
import type { Character } from '../rules/types';
import { addNotePage, nextNoteId, removeNotePage, updateNotePage, type PlayState } from '../rules/play';
import { RefSearchModal, refLinkHtml, type RefTarget } from './RichEditor';
import { DescBody } from './DescBody';

/** Toolbar formatting commands (document.execCommand on the focused contentEditable). */
const TOOLS: { cmd: string; arg?: string; icon?: string; text?: string; title: string }[] = [
  { cmd: 'bold', icon: 'ti-bold', title: 'Bold' },
  { cmd: 'italic', icon: 'ti-italic', title: 'Italic' },
  { cmd: 'underline', icon: 'ti-underline', title: 'Underline' },
  { cmd: 'formatBlock', arg: 'h2', text: 'H2', title: 'Heading 2' },
  { cmd: 'formatBlock', arg: 'h3', text: 'H3', title: 'Heading 3' },
  { cmd: 'formatBlock', arg: 'blockquote', icon: 'ti-quote', title: 'Blockquote' },
  { cmd: 'insertUnorderedList', icon: 'ti-list', title: 'Bullet list' },
  { cmd: 'insertOrderedList', icon: 'ti-list-numbers', title: 'Numbered list' },
  { cmd: 'insertHorizontalRule', icon: 'ti-separator-horizontal', title: 'Divider' },
  { cmd: 'removeFormat', icon: 'ti-clear-formatting', title: 'Clear formatting' },
];

/** Swatch palette for the notes text/highlight color pickers. */
const NOTE_COLORS = ['#e5484d', '#f59e0b', '#10b981', '#0ea5e9', '#6366f1', '#a855f7', '#ec4899', '#64748b'];

/**
 * An uncontrolled rich-text editor. The contentEditable is filled from `initialHtml`
 * once on mount (keyed by page id so switching pages remounts it); thereafter it
 * persists on every input WITHOUT re-rendering its own DOM, so the cursor never jumps.
 */
function NoteEditor({
  pageId,
  initialHtml,
  onSave,
}: {
  pageId: string;
  initialHtml: string;
  onSave: (id: string, html: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const latest = useRef(initialHtml);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  // Open popover for the color/glyph toolbar extras (null = none).
  const [pop, setPop] = useState<'fore' | 'hili' | 'glyph' | null>(null);
  // Description-link flow: the saved selection + whether the ref-search modal is open.
  const savedRange = useRef<Range | null>(null);
  const [linking, setLinking] = useState(false);

  useEffect(() => {
    if (ref.current) ref.current.innerHTML = initialHtml;
    // mount-only: never re-apply from props, or it would reset the caret mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist 400ms after the last keystroke (each save rewrites the whole roster, so we don't
  // want one per keystroke), and flush any pending save when the page switches/unmounts.
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        onSaveRef.current(pageId, latest.current);
      }
    },
    [pageId],
  );

  const save = () => {
    if (!ref.current) return;
    latest.current = ref.current.innerHTML;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onSaveRef.current(pageId, latest.current), 400);
  };
  const exec = (cmd: string, arg?: string) => {
    // formatBlock toggles: applying the current block type again reverts to a paragraph.
    if (cmd === 'formatBlock' && arg) {
      const cur = (document.queryCommandValue('formatBlock') || '').toLowerCase();
      document.execCommand('formatBlock', false, cur === arg.toLowerCase() ? 'p' : arg);
    } else {
      document.execCommand(cmd, false, arg);
    }
    ref.current?.focus();
    save();
  };
  // Apply a text/highlight color to the selection. styleWithCSS makes it emit inline-style spans
  // (WebView2/Chromium) rather than deprecated <font> tags.
  const execColor = (cmd: 'foreColor' | 'hiliteColor', hex: string | null) => {
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand(cmd === 'foreColor' ? 'foreColor' : 'hiliteColor', false, hex ?? 'inherit');
    ref.current?.focus();
    save();
    setPop(null);
  };
  // Insert an action-cost glyph (renders via the global .pf2-action font) at the caret.
  const insertGlyph = (char: string) => {
    document.execCommand('insertHTML', false, `<span class="pf2-action">${char}</span>&nbsp;`);
    ref.current?.focus();
    save();
    setPop(null);
  };
  // Link flow: remember the selection, open the search; on pick, wrap the selection (or insert the
  // target's name) as a ref-link anchor that the read-only renderer makes clickable.
  const openLink = () => {
    const sel = window.getSelection();
    savedRange.current = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    setPop(null);
    setLinking(true);
  };
  const applyLink = (t: RefTarget) => {
    setLinking(false);
    const el = ref.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (savedRange.current && sel) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
    const text = savedRange.current ? savedRange.current.toString() : '';
    const label = text.trim() || t.name;
    document.execCommand('insertHTML', false, `${refLinkHtml(t, label)}&nbsp;`);
    el.focus();
    save();
  };

  return (
    <>
      <div className="toolbar">
        {TOOLS.map((t, i) => (
          <button
            key={i}
            className={'tb-btn' + (t.text ? ' tb-text' : '')}
            title={t.title}
            // mousedown + preventDefault keeps the editor's selection while clicking.
            onMouseDown={(e) => {
              e.preventDefault();
              exec(t.cmd, t.arg);
            }}
          >
            {t.text ?? <i className={'ti ' + t.icon} aria-hidden="true" />}
          </button>
        ))}
        {/* Color + action-glyph extras open a small swatch/glyph popover (preventDefault preserves the selection). */}
        <button className="tb-btn" title="Text color" onMouseDown={(e) => (e.preventDefault(), setPop(pop === 'fore' ? null : 'fore'))}>
          <i className="ti ti-letter-a" aria-hidden="true" />
        </button>
        <button className="tb-btn" title="Highlight" onMouseDown={(e) => (e.preventDefault(), setPop(pop === 'hili' ? null : 'hili'))}>
          <i className="ti ti-highlight" aria-hidden="true" />
        </button>
        <button className="tb-btn" title="Action glyph" onMouseDown={(e) => (e.preventDefault(), setPop(pop === 'glyph' ? null : 'glyph'))}>
          <i className="ti ti-circle-1" aria-hidden="true" />
        </button>
        <button className="tb-btn" title="Link selected text to a description" onMouseDown={(e) => (e.preventDefault(), openLink())}>
          <i className="ti ti-link" aria-hidden="true" />
        </button>
      </div>
      {(pop === 'fore' || pop === 'hili') && (
        <div className="tb-pop">
          {NOTE_COLORS.map((hex) => (
            <button
              key={hex}
              className="tb-swatch"
              style={{ background: hex }}
              title={hex}
              onMouseDown={(e) => (e.preventDefault(), execColor(pop === 'fore' ? 'foreColor' : 'hiliteColor', hex))}
            />
          ))}
          <button className="tb-swatch tb-swatch-clear" title="Default" onMouseDown={(e) => (e.preventDefault(), execColor(pop === 'fore' ? 'foreColor' : 'hiliteColor', null))}>
            <i className="ti ti-ban" aria-hidden="true" />
          </button>
        </div>
      )}
      {pop === 'glyph' && (
        <div className="tb-pop">
          {[
            { c: '1', t: '1 action' },
            { c: '2', t: '2 actions' },
            { c: '3', t: '3 actions' },
            { c: '4', t: 'Free action' },
            { c: '5', t: 'Reaction' },
          ].map((g) => (
            <button key={g.c} className="tb-btn" title={g.t} onMouseDown={(e) => (e.preventDefault(), insertGlyph(g.c))}>
              <span className="pf2-action">{g.c}</span>
            </button>
          ))}
        </div>
      )}
      <div
        className="editor-body"
        contentEditable
        suppressContentEditableWarning
        ref={ref}
        onInput={save}
        data-placeholder="Write your notes…"
      />
      {linking && <RefSearchModal onPick={applyLink} onClose={() => setLinking(false)} />}
    </>
  );
}

/** Note "types" — each is just an icon + label the player picks when creating/editing a page. */
const NOTE_ICONS: { icon: string; label: string }[] = [
  { icon: 'ti-note', label: 'Note' },
  { icon: 'ti-book-2', label: 'Session' },
  { icon: 'ti-feather', label: 'Journal' },
  { icon: 'ti-user', label: 'NPC' },
  { icon: 'ti-map-pin', label: 'Location' },
  { icon: 'ti-flag', label: 'Quest' },
  { icon: 'ti-sword', label: 'Combat' },
  { icon: 'ti-coin', label: 'Loot' },
  { icon: 'ti-bulb', label: 'Idea' },
  { icon: 'ti-quote', label: 'Lore' },
  { icon: 'ti-sparkles', label: 'Magic' },
  { icon: 'ti-skull', label: 'Threat' },
  { icon: 'ti-list-check', label: 'Checklist' },
  { icon: 'ti-star', label: 'Important' },
];

/** A small popup for choosing a note's icon/type — opened when adding a page or tapping the icon. */
function IconPickerModal({ current, title, onPick, onClose }: { current?: string; title: string; onPick: (icon: string) => void; onClose: () => void }) {
  return (
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker icon-picker" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <span>
            <i className="ti ti-palette" aria-hidden="true" /> {title}
          </span>
          <button className="picker-close" onClick={onClose} aria-label="Close">
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
        <div className="icon-grid">
          {NOTE_ICONS.map((o) => (
            <button
              key={o.icon}
              className={'icon-opt' + (current === o.icon ? ' on' : '')}
              title={o.label}
              onClick={() => onPick(o.icon)}
            >
              <i className={'ti ' + o.icon} aria-hidden="true" />
              <span>{o.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function NotesTab({ character, onPlay }: { character: Character; onPlay?: (fn: (play: PlayState) => PlayState) => void }) {
  const pages = character.notes;
  const [activeId, setActiveId] = useState<string | null>(pages[0]?.id ?? null);
  const [query, setQuery] = useState('');
  const active = pages.find((p) => p.id === activeId) ?? pages[0];

  const q = query.trim().toLowerCase();
  const shown = q ? pages.filter((p) => p.title.toLowerCase().includes(q) || p.content.toLowerCase().includes(q)) : pages;

  // Choosing an icon either creates a new page with it, or re-icons an existing page.
  const [iconPicker, setIconPicker] = useState<{ mode: 'new' } | { mode: 'edit'; id: string } | null>(null);

  const pickIcon = (icon: string) => {
    if (!onPlay || !iconPicker) return;
    if (iconPicker.mode === 'new') {
      const id = nextNoteId(pages);
      onPlay((p) => addNotePage(p, icon));
      setActiveId(id);
    } else {
      onPlay((p) => updateNotePage(p, iconPicker.id, { icon }));
    }
    setIconPicker(null);
  };

  if (!active) {
    return (
      <div className="placeholder">
        <i className="ti ti-notebook" aria-hidden="true" />
        <span>No notes yet</span>
        {onPlay && (
          <button className="add-item-btn" style={{ marginTop: 10 }} onClick={() => setIconPicker({ mode: 'new' })}>
            <i className="ti ti-plus" aria-hidden="true" /> New page
          </button>
        )}
        {iconPicker && onPlay && (
          <IconPickerModal title="New page — choose an icon" onPick={pickIcon} onClose={() => setIconPicker(null)} />
        )}
      </div>
    );
  }

  const activeIndex = pages.findIndex((p) => p.id === active.id);

  return (
    <div className="notes-wrap">
      <div className="card notes-list-card">
        <div className="notes-search-row">
          <div className="search">
            <i className="ti ti-search" aria-hidden="true" />
            <input placeholder="Search in notes" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {onPlay && (
            <button className="new-page-btn" title="New page" onClick={() => setIconPicker({ mode: 'new' })}>
              <i className="ti ti-plus" aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="notes-list">
          {shown.map((p) => (
            <div key={p.id} className={'note-item' + (p.id === active.id ? ' on' : '')} onClick={() => setActiveId(p.id)}>
              <i
                className={'ti ' + (p.icon ?? 'ti-note')}
                style={{ color: p.color ?? 'var(--app-text-dim)', fontSize: 15, flex: 'none' }}
                aria-hidden="true"
              />
              <span className="ni-name">{p.title}</span>
              {p.private && <i className="ti ti-lock" style={{ fontSize: 12, opacity: 0.65, flex: 'none' }} aria-hidden="true" />}
            </div>
          ))}
          {shown.length === 0 && <div className="ff-empty">No pages match.</div>}
        </div>
      </div>

      <div className="card editor-card">
        <div className="editor-head">
          <button
            type="button"
            className={'editor-icon' + (onPlay ? ' editable' : '')}
            style={{
              background: `color-mix(in srgb, ${active.color ?? 'var(--app-accent)'} 18%, transparent)`,
              color: active.color ?? 'var(--app-accent)',
            }}
            title={onPlay ? 'Change icon' : undefined}
            onClick={onPlay ? () => setIconPicker({ mode: 'edit', id: active.id }) : undefined}
            disabled={!onPlay}
          >
            <i className={'ti ' + (active.icon ?? 'ti-note')} style={{ fontSize: 16 }} aria-hidden="true" />
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            {onPlay ? (
              <input
                className="editor-title-input"
                value={active.title}
                onChange={(e) => onPlay((pl) => updateNotePage(pl, active.id, { title: e.target.value }))}
              />
            ) : (
              <div className="editor-title">{active.title}</div>
            )}
            <div className="editor-meta">
              <i className="ti ti-check" style={{ fontSize: 12 }} aria-hidden="true" /> Saved · page {activeIndex + 1} of {pages.length}
            </div>
          </div>
          {onPlay && (
            <>
              <button
                className="icon-btn"
                title={active.private ? 'Make shared' : 'Make private'}
                onClick={() => onPlay((pl) => updateNotePage(pl, active.id, { private: !active.private }))}
              >
                <i className={'ti ' + (active.private ? 'ti-lock' : 'ti-lock-open')} aria-hidden="true" />
              </button>
              <button
                className="icon-btn"
                title="Delete page"
                onClick={() => {
                  if (confirm(`Delete the page "${active.title}"?`)) onPlay((pl) => removeNotePage(pl, active.id));
                }}
              >
                <i className="ti ti-trash" aria-hidden="true" />
              </button>
            </>
          )}
        </div>

        {onPlay ? (
          <NoteEditor
            key={active.id}
            pageId={active.id}
            initialHtml={active.content}
            onSave={(id, html) => onPlay((pl) => updateNotePage(pl, id, { content: html }))}
          />
        ) : (
          <DescBody description={active.content} className="editor-body" />
        )}
      </div>

      {iconPicker && onPlay && (
        <IconPickerModal
          title={iconPicker.mode === 'new' ? 'New page — choose an icon' : 'Change icon'}
          current={iconPicker.mode === 'edit' ? pages.find((p) => p.id === iconPicker.id)?.icon : undefined}
          onPick={pickIcon}
          onClose={() => setIconPicker(null)}
        />
      )}
    </div>
  );
}
