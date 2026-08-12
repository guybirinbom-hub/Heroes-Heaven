import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { cropToAvatar, imageSize } from './imageUtil';
import { useEscapeClose } from './useEscapeClose';

/**
 * Choose which square of a picture becomes the character's avatar.
 *
 * The small portrait — the sheet's top bar, roster cards, the party list — is a square, and a plain
 * centre crop of a standing figure lands on their chest. This is the step that lets the player put the
 * frame on the face instead. The picture itself is never altered: only the framed square is baked into
 * `appearance.avatar`, and `appearance.portrait` keeps the whole image for the Details page.
 *
 * The frame is fixed in the middle of the stage and the IMAGE moves under it (drag to pan, slider to
 * zoom) — the same model as every phone's crop screen, and it makes "what you see is the avatar"
 * literally true: the bright square is exactly the pixels that get saved.
 */
export function AvatarCropModal({
  src,
  onCancel,
  onDone,
}: {
  /** The picture to crop — the full portrait, not a previous avatar. */
  src: string;
  onCancel: () => void;
  /** Receives the baked square avatar as a data URL. */
  onDone: (avatar: string) => void;
}) {
  useEscapeClose(onCancel);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  // Zoom 1 = the image's shorter edge exactly fills the frame (the tightest fit with no empty corners).
  const [zoom, setZoom] = useState(1);
  // Pan in FRAME pixels, from the centred position. Clamped so the frame never leaves the image.
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  useEffect(() => {
    let alive = true;
    imageSize(src)
      .then((s) => alive && setNat(s))
      .catch(() => alive && setNat({ w: 1, h: 1 }));
    return () => {
      alive = false;
    };
  }, [src]);

  // The on-screen frame is a fixed square; FRAME is its side in CSS px.
  const FRAME = 260;
  const MAX_ZOOM = 4;

  // Displayed image size at this zoom: the shorter edge is FRAME * zoom, the longer one follows the
  // aspect ratio. Panning is limited to the overhang, so the frame can never show past an edge.
  const ratio = nat ? nat.w / nat.h : 1;
  const dispW = ratio >= 1 ? FRAME * zoom * ratio : FRAME * zoom;
  const dispH = ratio >= 1 ? FRAME * zoom : (FRAME * zoom) / ratio;
  const maxPanX = Math.max(0, (dispW - FRAME) / 2);
  const maxPanY = Math.max(0, (dispH - FRAME) / 2);
  const clamp = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v));
  const px = clamp(pan.x, maxPanX);
  const py = clamp(pan.y, maxPanY);

  // Move/up are bound to the WINDOW, not the stage: a quick drag leaves the 260px square long before
  // the pan reaches its limit, and a stage-bound listener would drop the gesture the moment it did.
  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, px, py };
    drag.current = start;
    // Pointer coordinates are in the visual viewport, which html{zoom} has already scaled.
    const z = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--zoom')) || 1;
    const move = (ev: PointerEvent) => setPan({ x: start.px + (ev.clientX - start.x) / z, y: start.py + (ev.clientY - start.y) / z });
    const end = () => {
      drag.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  const apply = () => {
    if (!nat || busy) return;
    setBusy(true);
    // Map the frame back onto source pixels: the frame is FRAME wide on a dispW-wide rendering of a
    // nat.w-wide image, and the pan moved the image by px (frame px) under it.
    const scale = nat.w / dispW; // source px per displayed px
    const size = FRAME * scale;
    const x = (dispW - FRAME) / 2 * scale - px * scale;
    const y = (dispH - FRAME) / 2 * scale - py * scale;
    cropToAvatar(src, { x, y, size })
      .then(onDone)
      .catch(() => onDone(src)) // no canvas — keep the whole image rather than losing the upload
      .finally(() => setBusy(false));
  };

  return (
    <div className="picker-overlay" onClick={onCancel}>
      <div className="picker crop-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Choose the avatar area">
        <div className="picker-head">
          <span>
            <i className="ti ti-crop" aria-hidden="true" /> Frame the avatar
          </span>
          <button className="picker-close" onClick={onCancel} aria-label="Cancel">
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
        <div className="crop-body">
          <p className="crop-hint">
            Drag the picture to move it and use the slider to zoom. The bright square is what shows as the small
            portrait — the whole picture is still kept on the Details page.
          </p>
          <div
            className="crop-stage"
            ref={stageRef}
            style={{ width: FRAME, height: FRAME }}
            onPointerDown={startDrag}
          >
            {/* Two copies: a dimmed one showing the parts being cropped away, and a bright one clipped
                to the frame. The player can see what they're cutting off, which is the whole point. */}
            <img className="crop-img crop-img-ghost" src={src} alt="" draggable={false} style={{ width: dispW, height: dispH, transform: `translate(${px}px, ${py}px)` }} />
            <div className="crop-window">
              <img className="crop-img" src={src} alt="Avatar preview" draggable={false} style={{ width: dispW, height: dispH, transform: `translate(${px}px, ${py}px)` }} />
            </div>
          </div>
          <label className="crop-zoom">
            <i className="ti ti-zoom-out" aria-hidden="true" />
            <input
              type="range"
              min={1}
              max={MAX_ZOOM}
              step={0.01}
              value={zoom}
              aria-label="Zoom"
              onChange={(e) => setZoom(Number(e.target.value))}
            />
            <i className="ti ti-zoom-in" aria-hidden="true" />
          </label>
        </div>
        <div className="crop-foot">
          <button
            className="btn"
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
          >
            Reset
          </button>
          <span className="crop-foot-spacer" />
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn-primary" disabled={!nat || busy} onClick={apply}>
            Use this area
          </button>
        </div>
      </div>
    </div>
  );
}
