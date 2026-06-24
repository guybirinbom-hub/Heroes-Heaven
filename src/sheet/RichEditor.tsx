import { useEffect, useMemo, useRef, useState } from 'react';
import { useContent } from './ContentContext';
import { useEscapeClose } from './useEscapeClose';

/** Toolbar formatting commands (document.execCommand on the focused contentEditable) — the same set
 *  the Notes editor uses, so item descriptions get an identical toolbar. */
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
const NOTE_COLORS = ['#e5484d', '#f59e0b', '#10b981', '#0ea5e9', '#6366f1', '#a855f7', '#ec4899', '#64748b'];

/** Content maps a description link can point at — anything the user might want a popup for. */
const REF_MAPS: { key: string; label: string }[] = [
  { key: 'feats', label: 'Feat' },
  { key: 'spells', label: 'Spell' },
  { key: 'items', label: 'Item' },
  { key: 'actions', label: 'Action' },
  { key: 'conditions', label: 'Condition' },
  { key: 'classFeatures', label: 'Class feature' },
  { key: 'deities', label: 'Deity' },
  { key: 'ancestries', label: 'Ancestry' },
  { key: 'heritages', label: 'Heritage' },
  { key: 'backgrounds', label: 'Background' },
];

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** A picked target for a description link. */
export interface RefTarget {
  key: string;
  id: string;
  name: string;
}

/** The anchor HTML a description link inserts — `.ref-link` is what the read-only renderer
 *  (DescBody) makes clickable. Shared so the Notes editor inserts the identical markup. */
export function refLinkHtml(t: RefTarget, label: string): string {
  return `<a class="ref-link" data-ref-key="${escapeHtml(t.key)}" data-ref-id="${escapeHtml(t.id)}">${escapeHtml(label)}</a>`;
}

/** Search every linkable content entry by name; pick one to turn the highlighted text into a link
 *  that opens that entry's description popup. */
export function RefSearchModal({ onPick, onClose }: { onPick: (t: RefTarget) => void; onClose: () => void }) {
  useEscapeClose(onClose);
  const content = useContent();
  const [q, setQ] = useState('');
  const index = useMemo(() => {
    const out: (RefTarget & { kind: string })[] = [];
    for (const { key, label } of REF_MAPS) {
      const map = (content as unknown as Record<string, Record<string, { name?: string; description?: string }>>)[key];
      if (!map) continue;
      for (const [id, e] of Object.entries(map)) if (e?.name && (e.description || key === 'actions')) out.push({ key, id, name: e.name, kind: label });
    }
    return out;
  }, [content]);
  const ql = q.trim().toLowerCase();
  const results = ql ? index.filter((e) => e.name.toLowerCase().includes(ql)).slice(0, 60) : [];

  return (
    <div className="picker-overlay ref-search-overlay" onClick={onClose}>
      <div className="picker ref-search" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          Link to a description
          <button className="picker-close" onClick={onClose} aria-label="Close">
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
        <div className="picker-controls">
          <div className="search">
            <i className="ti ti-search" aria-hidden="true" />
            <input autoFocus placeholder="Search feats, spells, items, conditions…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <span className="ss-count">{results.length}</span>
        </div>
        <div className="ref-search-list">
          {!ql ? (
            <div className="acts-empty">Type to search any feat, spell, item, action, condition…</div>
          ) : results.length === 0 ? (
            <div className="acts-empty">No matches.</div>
          ) : (
            results.map((e) => (
              <button key={`${e.key}:${e.id}`} type="button" className="ref-search-row" onClick={() => onPick(e)}>
                <span className="ref-search-name">{e.name}</span>
                <span className="ref-search-kind">{e.kind}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * An uncontrolled rich-text editor (the same toolbar as Notes). The contentEditable fills from
 * `initialHtml` on mount; thereafter it reports its HTML on every input via `onChange` without
 * re-syncing its own DOM, so the caret never jumps. To reset it (e.g. "copy from item"), change its
 * React `key`. With `enableRefLink`, a link button turns selected text into a description hyperlink.
 */
export function RichEditor({
  initialHtml,
  onChange,
  enableRefLink,
  placeholder,
}: {
  initialHtml: string;
  onChange: (html: string) => void;
  enableRefLink?: boolean;
  placeholder?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const savedRange = useRef<Range | null>(null);
  const [pop, setPop] = useState<'fore' | 'hili' | 'glyph' | null>(null);
  const [linking, setLinking] = useState(false);

  useEffect(() => {
    if (ref.current) ref.current.innerHTML = initialHtml;
    // mount-only: re-applying from props would reset the caret mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = () => {
    if (ref.current) onChangeRef.current(ref.current.innerHTML);
  };
  const exec = (cmd: string, arg?: string) => {
    if (cmd === 'formatBlock' && arg) {
      const cur = (document.queryCommandValue('formatBlock') || '').toLowerCase();
      document.execCommand('formatBlock', false, cur === arg.toLowerCase() ? 'p' : arg);
    } else {
      document.execCommand(cmd, false, arg);
    }
    ref.current?.focus();
    save();
  };
  const execColor = (cmd: 'foreColor' | 'hiliteColor', hex: string | null) => {
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand(cmd, false, hex ?? 'inherit');
    ref.current?.focus();
    save();
    setPop(null);
  };
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
            onMouseDown={(e) => {
              e.preventDefault();
              exec(t.cmd, t.arg);
            }}
          >
            {t.text ?? <i className={'ti ' + t.icon} aria-hidden="true" />}
          </button>
        ))}
        <button className="tb-btn" title="Text color" onMouseDown={(e) => (e.preventDefault(), setPop(pop === 'fore' ? null : 'fore'))}>
          <i className="ti ti-letter-a" aria-hidden="true" />
        </button>
        <button className="tb-btn" title="Highlight" onMouseDown={(e) => (e.preventDefault(), setPop(pop === 'hili' ? null : 'hili'))}>
          <i className="ti ti-highlight" aria-hidden="true" />
        </button>
        <button className="tb-btn" title="Action glyph" onMouseDown={(e) => (e.preventDefault(), setPop(pop === 'glyph' ? null : 'glyph'))}>
          <i className="ti ti-circle-1" aria-hidden="true" />
        </button>
        {enableRefLink && (
          <button className="tb-btn" title="Link selected text to a description" onMouseDown={(e) => (e.preventDefault(), openLink())}>
            <i className="ti ti-link" aria-hidden="true" />
          </button>
        )}
      </div>
      {(pop === 'fore' || pop === 'hili') && (
        <div className="tb-pop">
          {NOTE_COLORS.map((hex) => (
            <button key={hex} className="tb-swatch" style={{ background: hex }} title={hex} onMouseDown={(e) => (e.preventDefault(), execColor(pop === 'fore' ? 'foreColor' : 'hiliteColor', hex))} />
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
      <div className="editor-body" contentEditable suppressContentEditableWarning ref={ref} onInput={save} data-placeholder={placeholder ?? 'Write…'} />
      {linking && <RefSearchModal onPick={applyLink} onClose={() => setLinking(false)} />}
    </>
  );
}
