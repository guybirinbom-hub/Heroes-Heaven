import { useCallback, useRef } from 'react';
import type { SliderStop } from '../rules/filterValues';

/**
 * A dual-handle slider that snaps to an ordered list of named stops (which may be
 * non-linear, e.g. Touch · 30 ft · 1 mi · ∞). Value is the [low, high] stop indices.
 */
export function RangeSlider({
  stops,
  value,
  onChange,
  label,
}: {
  stops: SliderStop[];
  value: [number, number];
  onChange: (v: [number, number]) => void;
  label?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const last = stops.length - 1;
  const [lo, hi] = value;

  const idxAt = useCallback(
    (clientX: number): number => {
      const el = trackRef.current;
      if (!el) return 0;
      const r = el.getBoundingClientRect();
      const t = r.width <= 0 ? 0 : (clientX - r.left) / r.width;
      return Math.max(0, Math.min(last, Math.round(t * last)));
    },
    [last],
  );

  const startDrag = (which: 'lo' | 'hi') => (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const move = (clientX: number) => {
      const i = idxAt(clientX);
      if (which === 'lo') onChange([Math.min(i, hiRef.current), hiRef.current]);
      else onChange([loRef.current, Math.max(i, loRef.current)]);
    };
    move(e.clientX);
  };

  // Keep the latest lo/hi readable inside the pointer handlers without re-binding.
  const loRef = useRef(lo);
  const hiRef = useRef(hi);
  loRef.current = lo;
  hiRef.current = hi;

  const onPointerMove = (which: 'lo' | 'hi') => (e: React.PointerEvent) => {
    if (e.buttons !== 1) return;
    const i = idxAt(e.clientX);
    if (which === 'lo') onChange([Math.min(i, hiRef.current), hiRef.current]);
    else onChange([loRef.current, Math.max(i, loRef.current)]);
  };

  const pct = (i: number) => (last === 0 ? 0 : (i / last) * 100);

  const onKey = (which: 'lo' | 'hi') => (e: React.KeyboardEvent) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    if (which === 'lo') onChange([Math.max(0, Math.min(lo + d, hi)), hi]);
    else onChange([lo, Math.min(last, Math.max(hi + d, lo))]);
  };

  return (
    <div className="rsl">
      {label && (
        <div className="rsl-label">
          {label}: <span className="rsl-range">{stops[lo].label}{lo !== hi ? ` – ${stops[hi].label}` : ''}</span>
        </div>
      )}
      <div className="rsl-track" ref={trackRef}>
        <div className="rsl-fill" style={{ left: pct(lo) + '%', right: 100 - pct(hi) + '%' }} />
        {stops.map((_, i) => (
          <span key={i} className="rsl-tick" style={{ left: pct(i) + '%' }} />
        ))}
        <button
          type="button"
          className="rsl-handle"
          style={{ left: pct(lo) + '%' }}
          aria-label={`${label ?? 'Range'} minimum`}
          aria-valuetext={stops[lo].label}
          onPointerDown={startDrag('lo')}
          onPointerMove={onPointerMove('lo')}
          onKeyDown={onKey('lo')}
        />
        <button
          type="button"
          className="rsl-handle"
          style={{ left: pct(hi) + '%' }}
          aria-label={`${label ?? 'Range'} maximum`}
          aria-valuetext={stops[hi].label}
          onPointerDown={startDrag('hi')}
          onPointerMove={onPointerMove('hi')}
          onKeyDown={onKey('hi')}
        />
      </div>
      <div className="rsl-scale">
        {stops.map((s, i) => (
          <span key={i} className="rsl-stop" style={{ left: pct(i) + '%' }}>
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
