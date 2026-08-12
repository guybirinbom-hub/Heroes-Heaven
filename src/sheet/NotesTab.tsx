import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Character } from '../rules/types';
import { addNotePage, nextNoteId, removeNotePage, updateNotePage, type PlayUpdater } from '../rules/play';
import { RefSearchModal, refLinkHtml, type RefTarget } from './RichEditor';
import { confirmDialog } from './confirm';
import { DescBody } from './DescBody';
import { useIsMobile } from './useIsMobile';
import { useBackHandler } from './useEscapeClose';
import { decodeEntities } from './RichText';
import { sanitize } from './sanitizeHtml';
import { applyAutoDir } from './autoDir';
import { setPref, usePrefs } from '../data/prefs';

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

/** Bounds for the draggable page-list column (px). Narrower than the min and the titles are unreadable;
 *  wider than the max and the editor stops being the point of the page. */
const NOTES_LIST_MIN = 110;
const NOTES_LIST_MAX = 460;
const NOTES_LIST_DEFAULT = 152;

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

  // Mobile: while focused, pin the toolbar to the bottom of the scroll container via position:sticky
  // (CSS .rte-toolwrap-sticky) — robust against Android adjustResize where the visualViewport math fails.
  const isMobile = useIsMobile();
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    // Sanitize before injecting (see RichEditor): innerHTML executes inline handlers, and note HTML can
    // carry pasted/imported markup. The display path (DescBody) already sanitizes.
    if (ref.current) {
      ref.current.innerHTML = sanitize(initialHtml);
      applyAutoDir(ref.current);
    }
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
    // Re-tag block directions BEFORE reading the HTML: typing Hebrew into a fresh line has to flip that
    // line (and its bullet) immediately, and the dir attributes then travel with the saved content, so
    // the read-only view of the page matches. Setting an attribute never disturbs the caret.
    applyAutoDir(ref.current);
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
      <div
        className={'rte-toolwrap' + (isMobile && focused ? ' rte-toolwrap-sticky' : '')}
      >
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
      </div>
      <div
        className="editor-body"
        contentEditable
        suppressContentEditableWarning
        ref={ref}
        onInput={save}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        data-placeholder="Write your notes…"
      />
      {linking && <RefSearchModal onPick={applyLink} onClose={() => setLinking(false)} />}
    </>
  );
}

/**
 * The icons a page can wear. Grouped so the grid reads as a small library rather than a wall, and
 * searchable (the picker matches the printed label, the raw icon name, and the aliases below — so
 * "fire" finds the flame, "gold" finds the coin).
 *
 * Every name here is verified against the shipped @tabler/icons-webfont set; a typo renders an empty
 * box, so add to these lists only after checking the icon exists.
 */
const NOTE_ICON_GROUPS: { group: string; icons: string[] }[] = [
  {
    group: 'Pages & writing',
    icons: [
      'ti-note', 'ti-notebook', 'ti-writing', 'ti-pencil', 'ti-file-text', 'ti-file-description', 'ti-article',
      'ti-news', 'ti-quote', 'ti-typography', 'ti-bookmark', 'ti-clipboard-text', 'ti-list-check', 'ti-checklist',
      'ti-book-2', 'ti-books', 'ti-library', 'ti-feather', 'ti-certificate', 'ti-license', 'ti-school',
    ],
  },
  {
    group: 'People',
    icons: [
      'ti-user', 'ti-user-circle', 'ti-users', 'ti-user-star', 'ti-user-question', 'ti-friends', 'ti-crown',
      'ti-mask', 'ti-spy', 'ti-ghost', 'ti-ghost-2', 'ti-robot', 'ti-mood-smile', 'ti-mood-neutral', 'ti-mood-sad',
      'ti-military-rank', 'ti-military-award',
    ],
  },
  {
    group: 'Places',
    icons: [
      'ti-map-pin', 'ti-map', 'ti-map-2', 'ti-route', 'ti-compass', 'ti-world', 'ti-building', 'ti-building-castle',
      'ti-building-church', 'ti-building-store', 'ti-building-bank', 'ti-building-monument', 'ti-building-arch',
      'ti-home', 'ti-tent', 'ti-campfire', 'ti-door', 'ti-key', 'ti-lock', 'ti-lock-open', 'ti-trekking',
    ],
  },
  {
    group: 'Quests & time',
    icons: [
      'ti-flag', 'ti-flag-2', 'ti-flag-3', 'ti-flag-star', 'ti-pennant', 'ti-target', 'ti-crosshair', 'ti-trophy',
      'ti-medal', 'ti-award', 'ti-timeline', 'ti-history', 'ti-calendar', 'ti-clock', 'ti-alarm', 'ti-hourglass',
      'ti-bell', 'ti-bell-ringing',
    ],
  },
  {
    group: 'Combat',
    icons: [
      'ti-sword', 'ti-swords', 'ti-axe', 'ti-bow', 'ti-archery-arrow', 'ti-shield', 'ti-shield-checkered',
      'ti-shield-bolt', 'ti-helmet', 'ti-bomb', 'ti-skull', 'ti-bone', 'ti-grave', 'ti-heart', 'ti-heart-broken',
      'ti-heartbeat', 'ti-activity', 'ti-first-aid-kit',
    ],
  },
  {
    group: 'Magic',
    icons: [
      'ti-sparkles', 'ti-wand', 'ti-flame', 'ti-droplet', 'ti-snowflake', 'ti-bolt', 'ti-wind', 'ti-cloud',
      'ti-mist', 'ti-sun', 'ti-moon', 'ti-moon-stars', 'ti-stars', 'ti-planet', 'ti-atom', 'ti-flare', 'ti-spiral',
      'ti-ripple', 'ti-infinity', 'ti-eye', 'ti-eye-off', 'ti-brain', 'ti-magnet', 'ti-crystal-ball',
      'ti-alphabet-runes', 'ti-yin-yang', 'ti-cross', 'ti-ankh', 'ti-pray',
    ],
  },
  {
    group: 'Treasure',
    icons: [
      'ti-coin', 'ti-coins', 'ti-diamond', 'ti-wallet', 'ti-package', 'ti-box', 'ti-backpack', 'ti-basket',
      'ti-shopping-bag', 'ti-scale', 'ti-gavel', 'ti-receipt',
    ],
  },
  {
    group: 'Gear & craft',
    icons: [
      'ti-bottle', 'ti-flask', 'ti-flask-2', 'ti-pill', 'ti-tools', 'ti-tool', 'ti-hammer', 'ti-pick', 'ti-shovel',
      'ti-needle-thread', 'ti-anchor', 'ti-ship', 'ti-sailboat', 'ti-car', 'ti-tir',
    ],
  },
  {
    group: 'Food & drink',
    icons: ['ti-beer', 'ti-cup', 'ti-glass-full', 'ti-soup', 'ti-bread', 'ti-meat', 'ti-cheese', 'ti-apple', 'ti-carrot', 'ti-salt', 'ti-egg'],
  },
  {
    group: 'Nature & beasts',
    icons: [
      'ti-mountain', 'ti-tree', 'ti-trees', 'ti-plant', 'ti-leaf', 'ti-flower', 'ti-cactus', 'ti-mushroom',
      'ti-seeding', 'ti-clover', 'ti-horse', 'ti-horseshoe', 'ti-paw', 'ti-dog', 'ti-cat', 'ti-fish', 'ti-bug',
      'ti-spider', 'ti-butterfly', 'ti-bat', 'ti-deer', 'ti-acorn', 'ti-wood',
    ],
  },
  {
    group: 'Play & performance',
    icons: [
      'ti-dice', 'ti-dice-5', 'ti-cards', 'ti-puzzle', 'ti-chess', 'ti-music', 'ti-microphone', 'ti-theater',
      'ti-masks-theater', 'ti-balloon', 'ti-confetti', 'ti-bulb', 'ti-lamp', 'ti-candle', 'ti-olympic-torch',
    ],
  },
  {
    group: 'Marks',
    icons: [
      'ti-star', 'ti-star-half', 'ti-alert-triangle', 'ti-alert-circle', 'ti-info-circle', 'ti-help',
      'ti-question-mark', 'ti-exclamation-mark', 'ti-check', 'ti-circle-check', 'ti-x', 'ti-circle-x',
      'ti-forbid', 'ti-hand-stop',
    ],
  },
];

/** Extra search words for icons whose NAME doesn't say what a player would call it. */
const ICON_ALIASES: Record<string, string> = {
  'ti-note': 'note page blank',
  'ti-book-2': 'session recap chapter',
  'ti-feather': 'journal diary quill write',
  'ti-user': 'npc person character',
  'ti-users': 'party faction group',
  'ti-user-star': 'patron ally important npc',
  'ti-user-question': 'mystery stranger unknown npc',
  'ti-map-pin': 'location place where',
  'ti-flag': 'quest objective mission',
  'ti-sword': 'combat fight battle encounter',
  'ti-coin': 'loot treasure gold money reward',
  'ti-coins': 'loot treasure gold money hoard',
  'ti-diamond': 'gem jewel treasure valuable',
  'ti-bulb': 'idea theory plan hunch',
  'ti-quote': 'lore legend story saying',
  'ti-sparkles': 'magic spell arcane enchantment',
  'ti-skull': 'threat danger death villain undead',
  'ti-list-check': 'checklist todo tasks',
  'ti-star': 'important favourite favorite key',
  'ti-flame': 'fire burn torch heat',
  'ti-droplet': 'water rain sea acid',
  'ti-snowflake': 'ice cold frost winter',
  'ti-bolt': 'lightning electricity storm shock',
  'ti-grave': 'graveyard tomb dead cemetery',
  'ti-crystal-ball': 'divination prophecy fortune seer',
  'ti-alphabet-runes': 'runes glyphs inscription cipher',
  'ti-pray': 'religion deity temple faith worship',
  'ti-cross': 'religion cleric temple faith',
  'ti-ankh': 'religion life afterlife',
  'ti-gavel': 'law trial judge court',
  'ti-scale': 'balance justice trade weight',
  'ti-flask': 'potion alchemy brew elixir',
  'ti-flask-2': 'potion alchemy brew elixir',
  'ti-bottle': 'potion drink vial',
  'ti-pill': 'poison drug remedy',
  'ti-beer': 'tavern inn drink ale pub',
  'ti-cup': 'tavern drink inn',
  'ti-building-castle': 'castle keep fortress stronghold',
  'ti-building-church': 'temple shrine cathedral church',
  'ti-building-store': 'shop merchant market vendor',
  'ti-building-bank': 'bank vault guild treasury',
  'ti-tent': 'camp rest wilderness',
  'ti-campfire': 'camp rest downtime night',
  'ti-tir': 'wagon cart caravan travel',
  'ti-masks-theater': 'performance disguise bard drama',
  'ti-theater': 'performance stage bard drama',
  'ti-dice': 'roll random chance dice',
  'ti-dice-5': 'roll random chance dice',
  'ti-paw': 'beast animal companion creature',
  'ti-horse': 'mount steed travel',
  'ti-mist': 'fog weather haze',
  'ti-ripple': 'water wave sea',
  'ti-tools': 'crafting workshop repair',
  'ti-package': 'supplies cargo delivery',
  'ti-backpack': 'inventory gear carry',
  'ti-timeline': 'timeline chronology events',
  'ti-history': 'past backstory chronology',
  'ti-hourglass': 'deadline countdown time pressure',
  'ti-military-rank': 'army rank soldier military',
  'ti-military-award': 'honour honor commendation army',
  'ti-trekking': 'travel journey hike overland',
  'ti-forbid': 'banned forbidden rule off-limits',
  'ti-hand-stop': 'stop warning halt',
};

/** "ti-map-pin" → "Map pin". The printed label under each icon (and part of what search matches). */
const iconLabel = (icon: string) => {
  const words = icon.replace(/^ti-/, '').replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** A small popup for choosing a note's icon/type — opened when adding a page or tapping the icon.
 *  In edit mode it also offers a per-page color (onPickColor), which tints the page icon + header. */
function IconPickerModal({
  current,
  currentColor,
  title,
  onPick,
  onPickColor,
  onClose,
}: {
  current?: string;
  currentColor?: string;
  title: string;
  onPick: (icon: string) => void;
  onPickColor?: (color: string | undefined) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  // Every word must match somewhere ("map pin" and "pin map" both find it).
  const terms = q ? q.split(/\s+/) : [];
  const matches = (icon: string) => {
    if (!terms.length) return true;
    const hay = `${icon.replace(/^ti-/, '').replace(/-/g, ' ')} ${ICON_ALIASES[icon] ?? ''}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  };
  const groups = NOTE_ICON_GROUPS.map((g) => ({ group: g.group, icons: g.icons.filter(matches) })).filter(
    (g) => g.icons.length > 0,
  );

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
        <div className="icon-search-row">
          <div className="search">
            <i className="ti ti-search" aria-hidden="true" />
            <input
              autoFocus
              placeholder="Search icons — try “fire”, “tavern”, “quest”"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search icons"
            />
          </div>
        </div>
        <div className="icon-grid">
          {groups.map((g) => (
            <div className="icon-group" key={g.group}>
              {/* With a search running the groups are just the surviving buckets — still worth naming,
                  so a result set of six icons says which kind of thing each one is. */}
              <div className="icon-group-h">{g.group}</div>
              <div className="icon-group-grid">
                {g.icons.map((icon) => (
                  <button
                    key={icon}
                    className={'icon-opt' + (current === icon ? ' on' : '')}
                    title={iconLabel(icon)}
                    onClick={() => onPick(icon)}
                  >
                    <i className={'ti ' + icon} aria-hidden="true" />
                    <span>{iconLabel(icon)}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {groups.length === 0 && <div className="ff-empty">No icon matches “{query}”.</div>}
        </div>
        {onPickColor && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--app-border)' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--app-text-dim)', marginRight: 2 }}>Color</span>
            {NOTE_COLORS.map((hex) => (
              <button
                type="button"
                key={hex}
                className={'tb-swatch' + (currentColor === hex ? ' on' : '')}
                style={{ background: hex }}
                title={hex}
                aria-label={`Color ${hex}`}
                onClick={() => onPickColor(hex)}
              />
            ))}
            <button type="button" className="tb-swatch tb-swatch-clear" title="Default" aria-label="Default color" onClick={() => onPickColor(undefined)}>
              <i className="ti ti-ban" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function NotesTab({ character, onPlay, hidePrivate }: { character: Character; onPlay?: PlayUpdater; hidePrivate?: boolean }) {
  // A read-only teammate viewing this sheet doesn't see pages marked private; the owner and the GM do.
  const pages = hidePrivate ? character.notes.filter((p) => !p.private) : character.notes;
  const [activeId, setActiveId] = useState<string | null>(pages[0]?.id ?? null);
  const [query, setQuery] = useState('');
  const active = pages.find((p) => p.id === activeId) ?? pages[0];

  const q = query.trim().toLowerCase();
  const shown = q ? pages.filter((p) => p.title.toLowerCase().includes(q) || p.content.toLowerCase().includes(q)) : pages;

  // Choosing an icon either creates a new page with it, or re-icons an existing page.
  const [iconPicker, setIconPicker] = useState<{ mode: 'new' } | { mode: 'edit'; id: string } | null>(null);

  // Mobile uses a List → editor flow: false = show the page list; true = show the editor full-screen.
  const isMobile = useIsMobile();
  const [mobileOpen, setMobileOpen] = useState(false);
  // Android Back / Escape: from the full-screen editor, step back to the page list (don't exit the app).
  useBackHandler(isMobile && mobileOpen, () => setMobileOpen(false));

  // Drag the divider between the page list and the editor. The live width is written straight to the
  // grid's CSS variable (no re-render per pointer move) and saved once, on release.
  const { notesListWidth } = usePrefs();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const startResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    const wrap = wrapRef.current;
    const list = wrap?.querySelector<HTMLElement>('.notes-list-card');
    if (!wrap || !list) return;
    e.preventDefault();
    const startW = list.offsetWidth;
    const startX = e.clientX;
    // Pointer coordinates are in the VISUAL viewport, which html{zoom} has already scaled; offsetWidth
    // is in the element's own CSS pixels. Divide the travel by the zoom or the divider outruns the mouse.
    const zoom = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--zoom')) || 1;
    setDragging(true);
    const move = (ev: PointerEvent) => {
      const w = Math.round(Math.min(NOTES_LIST_MAX, Math.max(NOTES_LIST_MIN, startW + (ev.clientX - startX) / zoom)));
      wrap.style.setProperty('--notes-list-w', `${w}px`);
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      setDragging(false);
      const w = parseInt(wrap.style.getPropertyValue('--notes-list-w'), 10);
      if (Number.isFinite(w)) setPref('notesListWidth', w);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };
  const listWidth = Math.min(NOTES_LIST_MAX, Math.max(NOTES_LIST_MIN, notesListWidth ?? NOTES_LIST_DEFAULT));

  const pickIcon = (icon: string) => {
    if (!onPlay || !iconPicker) return;
    if (iconPicker.mode === 'new') {
      const id = nextNoteId(pages);
      onPlay((p) => addNotePage(p, icon));
      setActiveId(id);
      setMobileOpen(true);
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
  const preview = (html: string) => decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  const showList = !isMobile || !mobileOpen;
  const showEditor = !isMobile || mobileOpen;

  return (
    <div className="notes-wrap" ref={wrapRef} style={{ ['--notes-list-w' as string]: `${listWidth}px` }}>
      {showList && (
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
            <div
              key={p.id}
              className={'note-item' + (p.id === active.id && !isMobile ? ' on' : '') + (isMobile ? ' note-item-m' : '')}
              onClick={() => {
                setActiveId(p.id);
                if (isMobile) setMobileOpen(true);
              }}
            >
              <i
                className={'ti ' + (p.icon ?? 'ti-note')}
                style={{ color: p.color ?? 'var(--app-text-dim)', fontSize: isMobile ? 17 : 15, flex: 'none' }}
                aria-hidden="true"
              />
              {/* dir="auto" so a Hebrew/Arabic page title reads from the right in the list too. */}
              {isMobile ? (
                <div className="ni-text">
                  <span className="ni-name" dir="auto">{p.title}</span>
                  {preview(p.content) && <span className="ni-preview" dir="auto">{preview(p.content)}</span>}
                </div>
              ) : (
                <span className="ni-name" dir="auto">{p.title}</span>
              )}
              {p.private && <i className="ti ti-lock" style={{ fontSize: 12, opacity: 0.65, flex: 'none' }} aria-hidden="true" />}
              {isMobile && <i className="ti ti-chevron-right ni-chev" aria-hidden="true" />}
            </div>
          ))}
          {shown.length === 0 && <div className="ff-empty">No pages match.</div>}
        </div>
      </div>
      )}

      {/* Desktop only — on a phone the list and the editor are separate full-screen steps. */}
      {!isMobile && (
        <div
          className={'notes-split' + (dragging ? ' dragging' : '')}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the page list"
          onPointerDown={startResize}
          onDoubleClick={() => setPref('notesListWidth', NOTES_LIST_DEFAULT)}
          title="Drag to resize · double-click to reset"
        />
      )}

      {showEditor && (
      <div className="card editor-card">
        <div className="editor-head">
          {isMobile && (
            <button type="button" className="icon-btn notes-back" aria-label="Back to notes" onClick={() => setMobileOpen(false)}>
              <i className="ti ti-arrow-left" aria-hidden="true" />
            </button>
          )}
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
                dir="auto"
                // Writes per keystroke — coalesce so typing a title is one undo step, not one per key.
                onChange={(e) => onPlay((pl) => updateNotePage(pl, active.id, { title: e.target.value }), `note-title:${active.id}`)}
              />
            ) : (
              <div className="editor-title" dir="auto">{active.title}</div>
            )}
            <div className="editor-meta">
              <i className="ti ti-check" style={{ fontSize: 12 }} aria-hidden="true" /> Saved · page {activeIndex + 1} of {pages.length}
            </div>
          </div>
          {onPlay && (
            <>
              <button
                className="icon-btn"
                title={active.private ? 'Private — hidden from teammates (the GM can still see it). Make shared' : 'Make private — hide from teammates'}
                onClick={() => onPlay((pl) => updateNotePage(pl, active.id, { private: !active.private }))}
              >
                <i className={'ti ' + (active.private ? 'ti-lock' : 'ti-lock-open')} aria-hidden="true" />
              </button>
              <button
                className="icon-btn"
                title="Delete page"
                onClick={async () => {
                  if (
                    await confirmDialog({
                      title: 'Delete page?',
                      message: `“${active.title}” will be removed.`,
                      confirmLabel: 'Delete',
                      danger: true,
                    })
                  ) {
                    onPlay((pl) => removeNotePage(pl, active.id));
                    if (isMobile) setMobileOpen(false);
                  }
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
          // dirAuto: pages written before the editor started tagging block direction still need it.
          <DescBody description={active.content} className="editor-body" dirAuto />
        )}
      </div>
      )}

      {iconPicker && onPlay && (
        <IconPickerModal
          title={iconPicker.mode === 'new' ? 'New page — choose an icon' : 'Icon & color'}
          current={iconPicker.mode === 'edit' ? pages.find((p) => p.id === iconPicker.id)?.icon : undefined}
          currentColor={iconPicker.mode === 'edit' ? pages.find((p) => p.id === iconPicker.id)?.color : undefined}
          onPick={pickIcon}
          onPickColor={iconPicker.mode === 'edit' ? (color) => onPlay((p) => updateNotePage(p, iconPicker.id, { color })) : undefined}
          onClose={() => setIconPicker(null)}
        />
      )}
    </div>
  );
}
