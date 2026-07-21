/*
 * Icons — Heroes Heaven's icon set (Tabler webfont), behind the tracker's ORIGINAL component API.
 *
 * WHY: matching HH's colour tokens got the palette right, but the app still *read* as a different
 * product, because it was drawn in a different hand. Icons are the loudest part of that. HH uses the
 * Tabler webfont (`ti ti-*`) everywhere; the tracker had 33 bespoke SVGs.
 *
 * HOW, WITHOUT LOSING ANYTHING: every export keeps its exact name and props ({size, className,
 * style}, plus StarIcon's `filled`), so all 86 call sites are untouched and no behaviour changes —
 * only the glyphs do. Sizing moves from width/height to font-size, which is how a webfont scales;
 * an explicit width/height passed via `style` still wins, because `style` spreads last.
 *
 * Every glyph name below was verified to exist in the installed Tabler 3.44 webfont.
 *
 * StarIcon: the webfont ships no `ti-star-filled` — and HH doesn't use one either (all 21 of its own
 * call sites are plain `ti-star`, with state signalled by COLOUR). `filled` is therefore accepted for
 * API compatibility and the favourite state stays just as visible, because every call site already
 * sets colour from the same condition. Matching the builder beats inventing a variant it lacks.
 *
 * The old InitiativeCycleIcon brand mark is gone — the app now uses Heroes Heaven's real <Logo>.
 */

interface IconProps {
  size?: number
  className?: string
  style?: React.CSSProperties
}

function Glyph({ name, size, className, style }: IconProps & { name: string }) {
  return (
    <i
      className={'ti ti-' + name + (className ? ' ' + className : '')}
      aria-hidden="true"
      style={{
        fontSize: size ?? 14,
        lineHeight: 1,
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        verticalAlign: 'middle',
        ...style,
      }}
    />
  )
}

// ── Editing ───────────────────────────────────────────────────────────────
export const PencilIcon = (p: IconProps) => <Glyph name="pencil" {...p} />
export const TrashIcon = (p: IconProps) => <Glyph name="trash" {...p} />
export const XIcon = (p: IconProps) => <Glyph name="x" {...p} />
export const PlusIcon = (p: IconProps) => <Glyph name="plus" {...p} />
export const CheckIcon = (p: IconProps) => <Glyph name="check" {...p} />

// ── Data / files ──────────────────────────────────────────────────────────
export const ImportIcon = (p: IconProps) => <Glyph name="file-import" {...p} />
export const SaveIcon = (p: IconProps) => <Glyph name="device-floppy" {...p} />
export const NotesIcon = (p: IconProps) => <Glyph name="notes" {...p} />
export const ImageIcon = (p: IconProps) => <Glyph name="photo" {...p} />
export const LinkIcon = (p: IconProps) => <Glyph name="link" {...p} />
export const TableIcon = (p: IconProps) => <Glyph name="table" {...p} />

// ── Navigation / chrome ───────────────────────────────────────────────────
export const ChevronLeftIcon = (p: IconProps) => <Glyph name="chevron-left" {...p} />
export const ChevronRightIcon = (p: IconProps) => <Glyph name="chevron-right" {...p} />
export const SearchIcon = (p: IconProps) => <Glyph name="search" {...p} />
export const SettingsIcon = (p: IconProps) => <Glyph name="settings" {...p} />
export const EyeIcon = (p: IconProps) => <Glyph name="eye" {...p} />
export const ScreenIcon = (p: IconProps) => <Glyph name="layout-board" {...p} />
export const MinimizeIcon = (p: IconProps) => <Glyph name="minus" {...p} />
export const MaximizeIcon = (p: IconProps) => <Glyph name="square" {...p} />
export const WindowRestoreIcon = (p: IconProps) => <Glyph name="copy" {...p} />

// ── Combat ────────────────────────────────────────────────────────────────
export const PlayIcon = (p: IconProps) => <Glyph name="player-play" {...p} />
export const StopIcon = (p: IconProps) => <Glyph name="player-stop" {...p} />
export const DiceIcon = (p: IconProps) => <Glyph name="dice" {...p} />
export const ShieldIcon = (p: IconProps) => <Glyph name="shield" {...p} />
export const SwordIcon = (p: IconProps) => <Glyph name="sword" {...p} />
export const SkullIcon = (p: IconProps) => <Glyph name="skull" {...p} />
export const BandageIcon = (p: IconProps) => <Glyph name="bandage" {...p} />
export const RestoreIcon = (p: IconProps) => <Glyph name="rotate" {...p} />
export const ClockIcon = (p: IconProps) => <Glyph name="clock" {...p} />
export const SignalIcon = (p: IconProps) => <Glyph name="antenna-bars-5" {...p} />

// ── Misc ──────────────────────────────────────────────────────────────────
export const UsersIcon = (p: IconProps) => <Glyph name="users" {...p} />
export const CoinIcon = (p: IconProps) => <Glyph name="coins" {...p} />

/** `filled` is accepted for API compatibility — see the note at the top of this file. */
export const StarIcon = ({ filled: _filled, ...p }: IconProps & { filled?: boolean }) => (
  <Glyph name="star" {...p} />
)
