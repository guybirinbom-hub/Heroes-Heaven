import { getTheme, type Theme } from './themes';

/*
 * One palette, drawn as a miniature of itself.
 *
 * The picker used to be a row of ordinary chips wearing the ACTIVE palette's surface with a single dot
 * of the offered palette's accent — so every tile looked the same except for one dot, and the owner's
 * word for it was "weird". A tile now paints its own background, panel, both text colours and its
 * accent, which is the whole of what choosing it changes.
 *
 * Inline styles, deliberately: the colours come from the palette being OFFERED, not the one in force,
 * so they can't be CSS classes — and that also makes this component self-contained enough to render in
 * the tracker (tracker/src/components/HHAppearance.tsx), which doesn't load HH's stylesheets. Only the
 * name under the tile follows the host app's theme, through vars both apps define.
 */

/** The two text lines inside the panel. Bars, not letters: at this size type is mush, and the point is
 *  the two text COLOURS. */
function line(color: string, width?: string) {
  return { height: 3, width, borderRadius: 2, background: color };
}

export function PaletteTile({
  theme,
  selectedId,
  onPick,
}: {
  theme: Theme;
  /** The id currently chosen, or null/undefined when nothing here is (e.g. "Match device"). */
  selectedId?: string | null;
  onPick: () => void;
}) {
  const t = theme.tokens;
  // Through getTheme, so a RETIRED id marks the palette it actually paints (a device still saved as
  // `abyss` gets Stellar's tile lit, instead of the picker showing nothing chosen at all).
  const active = getTheme(selectedId)?.id === theme.id;
  return (
    <button
      type="button"
      className="palette-tile"
      onClick={onPick}
      aria-pressed={active}
      title={theme.name}
      style={{
        width: 86,
        padding: 0,
        border: 'none',
        background: 'none',
        font: 'inherit',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
      }}
    >
      <span
        style={{
          height: 46,
          boxSizing: 'border-box',
          padding: 6,
          borderRadius: 7,
          display: 'block',
          background: t['--app-bg'],
          border: `2px solid ${t['--app-border']}`,
          // The chosen one is ringed OUTSIDE its own frame, not by recolouring it: High contrast's
          // border is white, and a recoloured frame made it read as the chosen palette at a glance.
          // An outline takes no layout space, so nothing shifts as the choice moves.
          outline: active ? `2px solid ${t['--app-accent']}` : undefined,
          outlineOffset: 2,
        }}
      >
        <span
          style={{
            height: '100%',
            boxSizing: 'border-box',
            padding: '0 5px',
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            background: t['--app-surface'],
            border: `1px solid ${t['--app-border']}`,
          }}
        >
          <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={line(t['--app-text'])} />
            <span style={line(t['--app-text-dim'], '62%')} />
          </span>
          <span style={{ width: 11, height: 11, flex: 'none', borderRadius: 3, background: t['--app-accent'] }} />
        </span>
      </span>
      <span
        style={{
          // A fixed two-line box, so a name that wraps ("Verdant Grove" at a small zoom) doesn't make
          // its tile taller than the rest of the row.
          minHeight: 26,
          fontSize: 11,
          lineHeight: 1.2,
          textAlign: 'center',
          fontWeight: active ? 600 : 400,
          color: active ? 'var(--app-text)' : 'var(--app-text-dim)',
        }}
      >
        {theme.name}
      </span>
    </button>
  );
}
