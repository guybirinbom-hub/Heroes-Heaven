import { useEffect, useRef } from 'react';
import type { RollResult } from '../rules/dice';
import { solidFor, faceCentre, faceShowing, orientationShowing, apply, mul, rotate, project, easeOut, IDENT, type Mat3, type Vec3 } from './dice3d';

/**
 * The dice tray: a canvas that tumbles the dice from a roll and settles them showing the faces that
 * were already rolled.
 *
 * The animation NEVER decides the numbers — see dice3d.ts. It reads `RollResult.dice`, which came
 * from `rules/dice.ts`, and choreographs each die into the orientation that shows its face.
 */

export interface DiceTheme {
  id: string;
  name: string;
  /** Face fill, lit and unlit ends of the shading ramp. */
  lit: string;
  dim: string;
  /** Edge stroke and the pip/number colour. */
  edge: string;
  ink: string;
}

export const DICE_THEMES: DiceTheme[] = [
  { id: 'bone', name: 'Bone', lit: '#f3ece0', dim: '#b7ac99', edge: '#7a6f5c', ink: '#3a3228' },
  { id: 'ember', name: 'Ember', lit: '#ff9d5c', dim: '#8c3a12', edge: '#511f08', ink: '#2a1004' },
  { id: 'arcane', name: 'Arcane', lit: '#a98cff', dim: '#4a2f8f', edge: '#2b1a55', ink: '#f0e9ff' },
  { id: 'verdant', name: 'Verdant', lit: '#8fd694', dim: '#2f6b3a', edge: '#1c4023', ink: '#0f2413' },
  { id: 'abyssal', name: 'Abyssal', lit: '#5aa9d6', dim: '#173d57', edge: '#0c2434', ink: '#e4f3ff' },
  { id: 'gilded', name: 'Gilded', lit: '#f5d675', dim: '#8a6b1c', edge: '#4f3c0c', ink: '#2c2106' },
];

export const DEFAULT_THEME = DICE_THEMES[0];

interface Die {
  sides: number;
  value: number;
  /** Where it settles, in canvas units. */
  x: number;
  y: number;
  scale: number;
  /** A random tumble axis and speed, so two identical dice do not spin in lockstep. */
  axis: Vec3;
  spin: number;
  start: Mat3;
  end: Mat3;
  /** Staggered so a handful of dice do not land on the same frame. */
  delay: number;
}

const TUMBLE_MS = 900;

function layout(result: RollResult, w: number, h: number): Die[] {
  const n = result.dice.length;
  const sides = Number(/d(\d+)/.exec(result.formula)?.[1] ?? 20);
  const solid = solidFor(sides);
  // A grid that keeps every die inside the tray however many were rolled.
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const cell = Math.min(w / (cols + 0.5), h / (rows + 0.5));
  const scale = Math.max(10, cell * 0.34);
  return result.dice.map((value, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const rand = seeded(i * 97 + value * 31 + n);
    return {
      sides,
      value,
      x: w / 2 + (col - (cols - 1) / 2) * cell,
      y: h / 2 + (row - (rows - 1) / 2) * cell,
      scale,
      axis: [rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1],
      spin: 5 + rand() * 6,
      start: mul(rotate([rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1], rand() * Math.PI * 2), IDENT),
      end: orientationShowing(solid, faceShowing(solid, value)),
      delay: i * 55,
    };
  });
}

/** Deterministic per-roll jitter: two dice in one roll differ, but a re-render does not reshuffle. */
function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
}

function drawDie(ctx: CanvasRenderingContext2D, die: Die, m: Mat3, theme: DiceTheme) {
  const solid = solidFor(die.sides);
  const light: Vec3 = [-0.4, 0.75, 0.55];
  const faces = solid.faces
    .map((_, i) => {
      const c = apply(m, faceCentre(solid, i));
      return { i, depth: c[2], centre: c };
    })
    // Painter's algorithm: far faces first. Cheap, and correct for a convex solid.
    .sort((a, b) => a.depth - b.depth);

  for (const { i, centre } of faces) {
    const pts = solid.faces[i].map((vi) => project(apply(m, solid.vertices[vi]), die.x, die.y, die.scale));
    /*
     * Back-face cull from the winding of the PROJECTED polygon.
     *
     * The sign is inverted on purpose. Canvas Y grows DOWNWARD, and `project` flips it, so a face
     * wound counter-clockwise in 3D comes out CLOCKWISE — a negative shoelace area — on screen.
     * Testing for positive area culled every FRONT face and drew nothing at all.
     */
    let area = 0;
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k];
      const b = pts[(k + 1) % pts.length];
      area += a[0] * b[1] - b[0] * a[1];
    }
    if (area >= 0) continue;

    const nrm = normalize(centre);
    const lam = Math.max(0.12, nrm[0] * light[0] + nrm[1] * light[1] + nrm[2] * light[2]);
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
    ctx.closePath();
    ctx.fillStyle = mixColour(theme.dim, theme.lit, lam);
    ctx.fill();
    ctx.strokeStyle = theme.edge;
    ctx.lineWidth = Math.max(1, die.scale * 0.035);
    ctx.stroke();

    // The number goes on the face pointing most directly at the camera.
    if (centre[2] > 0.55) {
      const p = project(apply(m, faceCentre(solid, i)), die.x, die.y, die.scale);
      ctx.fillStyle = theme.ink;
      ctx.font = `600 ${Math.round(die.scale * 0.62)}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(solid.faceValues[i]), p[0], p[1]);
    }
  }
}

const normalize = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

function mixColour(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const k = Math.max(0, Math.min(1, t));
  const ch = (sh: number) => Math.round((((pa >> sh) & 255) * (1 - k) + ((pb >> sh) & 255) * k));
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

export function DiceTray({ result, theme = DEFAULT_THEME, onDone }: { result: RollResult | null; theme?: DiceTheme; onDone?: () => void }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const raf = useRef(0);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !result) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Respect the OS setting: no tumble, just the settled dice.
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const dice = layout(result, w, h);
    const t0 = performance.now();
    let finished = false;

    const frame = (now: number) => {
      ctx.clearRect(0, 0, w, h);
      let allDone = true;
      for (const die of dice) {
        const t = still ? 1 : Math.max(0, Math.min(1, (now - t0 - die.delay) / TUMBLE_MS));
        if (t < 1) allDone = false;
        // Tumble freely, then blend into the orientation that shows the rolled face. The blend is
        // what guarantees the die agrees with rules/dice.ts.
        const spun = mul(rotate(die.axis, die.spin * (1 - easeOut(t)) * 2 + t * 0.6), die.start);
        const k = easeOut(t);
        const m: Mat3 = spun.map((v, idx) => v * (1 - k) + die.end[idx] * k) as Mat3;
        drawDie(ctx, die, k > 0.999 ? die.end : m, theme);
      }
      if (allDone) {
        if (!finished) {
          finished = true;
          onDone?.();
        }
        return;
      }
      raf.current = requestAnimationFrame(frame);
    };
    // Draw the SETTLED dice once, synchronously, before asking for a frame.
    //
    // requestAnimationFrame does not fire in a tab that is not compositing — backgrounded, occluded,
    // or in an automated browser — so a tray that only ever drew from the callback showed nothing at
    // all in those cases. Painting the resting state first means the worst outcome is a missed
    // tumble, not an empty tray, and the animation simply overwrites it on the next frame.
    for (const die of dice) drawDie(ctx, die, die.end, theme);
    if (!still) raf.current = requestAnimationFrame(frame);
    else onDone?.();
    return () => cancelAnimationFrame(raf.current);
  }, [result, theme, onDone]);

  if (!result) return null;
  return (
    <div className="dice-tray">
      <canvas ref={ref} className="dice-tray-canvas" aria-hidden="true" />
      {/* The canvas is decorative: the authoritative numbers are the history list, which screen
          readers already get. This line is what a screen reader announces for the roll. */}
      <span className="sr-only" role="status">
        {result.formula}: rolled {result.dice.join(', ')} for {result.total}
      </span>
    </div>
  );
}
