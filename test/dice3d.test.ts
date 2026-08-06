import { describe, it, expect } from 'vitest';
import { solidFor, faceCentre, orientationShowing, faceShowing, apply, project, IDENT, mul, rotate, type Vec3 } from '../src/sheet/dice3d';

/**
 * The dice are drawn with software 3D rather than a bundled engine, so the geometry has no library
 * validating it. These are the invariants a wrong solid violates — and hand-authored winding was
 * wrong on three of six before the normalisation pass was added.
 */
const SIDES = [4, 6, 8, 10, 12, 20] as const;

/** Recomputed here from the module's OWN data, so the test cannot share a bug with the renderer. */
function normalOf(s: ReturnType<typeof solidFor>, f: number): Vec3 {
  const idx = s.faces[f];
  const c = faceCentre(s, f);
  // Newell's method: correct for any planar polygon, unlike taking the first three vertices, which
  // is only right when those happen not to be near-collinear.
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < idx.length; i++) {
    const a = s.vertices[idx[i]];
    const b = s.vertices[idx[(i + 1) % idx.length]];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const l = Math.hypot(nx, ny, nz) || 1;
  void c;
  return [nx / l, ny / l, nz / l];
}

describe('the solids are the right shape', () => {
  it('each die has exactly as many faces as it has sides', () => {
    for (const n of SIDES) expect(solidFor(n).faces.length, `d${n}`).toBe(n);
  });

  it('every face carries a distinct number, 1..n', () => {
    for (const n of SIDES) {
      const s = solidFor(n);
      expect([...s.faceValues].sort((a, b) => a - b), `d${n}`).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    }
  });

  it('every face winds outward — a die lit from inside is the symptom', () => {
    for (const n of SIDES) {
      const s = solidFor(n);
      for (let f = 0; f < s.faces.length; f++) {
        const c = faceCentre(s, f);
        const nrm = normalOf(s, f);
        const dot = nrm[0] * c[0] + nrm[1] * c[1] + nrm[2] * c[2];
        expect(dot, `d${n} face ${f} winds inward`).toBeGreaterThan(0);
      }
    }
  });

  it('every face is planar, or it cannot be filled as a polygon', () => {
    for (const n of SIDES) {
      const s = solidFor(n);
      for (let f = 0; f < s.faces.length; f++) {
        const nrm = normalOf(s, f);
        const c = faceCentre(s, f);
        for (const i of s.faces[f]) {
          const v = s.vertices[i];
          const d = (v[0] - c[0]) * nrm[0] + (v[1] - c[1]) * nrm[1] + (v[2] - c[2]) * nrm[2];
          expect(Math.abs(d), `d${n} face ${f} is not planar`).toBeLessThan(1e-6);
        }
      }
    }
  });
});

describe('a die lands on the number that was already rolled', () => {
  // This is the whole point: rules/dice.ts produced the result, and the animation must agree with it
  // rather than generate its own. If this fails, the tray shows a different number than the history.
  it('orienting to a face brings that face to the front', () => {
    for (const n of SIDES) {
      const s = solidFor(n);
      for (let value = 1; value <= n; value++) {
        const f = faceShowing(s, value);
        expect(s.faceValues[f], `d${n} has no face ${value}`).toBe(value);
        const m = orientationShowing(s, f);
        const c = apply(m, faceCentre(s, f));
        // …and it is the FRONTMOST face, not merely a forward-facing one.
        const others = s.faces.map((_, i) => apply(m, faceCentre(s, i))[2]);
        expect(c[2], `d${n} value ${value} is not frontmost`).toBeGreaterThanOrEqual(Math.max(...others) - 1e-9);
      }
    }
  });
});

describe('projection', () => {
  it('is perspective — a nearer point projects further from centre', () => {
    const near = project([1, 0, 0.9], 100, 100, 40);
    const far = project([1, 0, -0.9], 100, 100, 40);
    expect(near[0] - 100).toBeGreaterThan(far[0] - 100);
  });

  it('rotation composes and preserves length', () => {
    const m = mul(rotate([0, 1, 0], 0.7), rotate([1, 0, 0], 1.1));
    const v = apply(m, [0, 0, 1]);
    expect(Math.hypot(...v)).toBeCloseTo(1, 10);
    expect(apply(IDENT, [0.3, -0.4, 0.5])).toEqual([0.3, -0.4, 0.5]);
  });
});
