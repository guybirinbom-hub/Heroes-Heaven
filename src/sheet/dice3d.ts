/*
 * Polyhedral dice: geometry, projection and the tumble.
 *
 * NO 3D LIBRARY. The app ships offline (Tauri + PWA) so a CDN is out, and a bundled three.js plus a
 * physics engine is most of a megabyte — on an app whose measured bottleneck is already a 22.5 MB
 * payload, that is the wrong trade for a cosmetic feature. These are seven convex solids drawn with
 * software projection onto a 2D canvas: perhaps 300 lines against ~600 KB of dependency.
 *
 * THE ONE DESIGN DECISION THAT MATTERS. Other dice toys roll physically and READ the result off the
 * settled die. This app cannot: `rules/dice.ts` already produced the number, and that number is what
 * the history, the crit/fumble flag and every click-to-roll are keyed to. So the animation is
 * CHOREOGRAPHED — it tumbles freely and then eases into the orientation that shows the face that was
 * already rolled. Rolling physically here would mean two sources of truth and, sooner or later, a die
 * that shows 17 beside a history entry that says 4.
 */

export type Vec3 = [number, number, number];

export interface Solid {
  vertices: Vec3[];
  /** Each face is a list of vertex indices, wound counter-clockwise when seen from outside. */
  faces: number[][];
  /** faceValues[i] is the number printed on faces[i]. */
  faceValues: number[];
}

const PHI = (1 + Math.sqrt(5)) / 2;

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** Face centre = mean of its vertices; used both for depth sorting and for aiming a face at the camera. */
export function faceCentre(s: Solid, f: number): Vec3 {
  const idx = s.faces[f];
  const acc: Vec3 = [0, 0, 0];
  for (const i of idx) {
    acc[0] += s.vertices[i][0];
    acc[1] += s.vertices[i][1];
    acc[2] += s.vertices[i][2];
  }
  return [acc[0] / idx.length, acc[1] / idx.length, acc[2] / idx.length];
}

/**
 * Newell's method — correct for any planar polygon, unlike the cross product of the first three
 * vertices, which is only right when those three happen not to be near-collinear. A dodecahedron's
 * pentagons broke exactly that way: half of them normalised to an inward normal and shaded as though
 * the light were inside the die.
 */
function faceNormal(s: Solid, f: number): Vec3 {
  const idx = s.faces[f];
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < idx.length; i++) {
    const a = s.vertices[idx[i]];
    const b = s.vertices[idx[(i + 1) % idx.length]];
    x += (a[1] - b[1]) * (a[2] + b[2]);
    y += (a[2] - b[2]) * (a[0] + b[0]);
    z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return norm([x, y, z]);
}

/* ---------------------------------------------------------------- the seven solids */

function tetrahedron(): Solid {
  const v: Vec3[] = [
    [1, 1, 1],
    [-1, -1, 1],
    [-1, 1, -1],
    [1, -1, -1],
  ].map((x) => norm(x as Vec3));
  return { vertices: v, faces: [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]], faceValues: [1, 2, 3, 4] };
}

function cube(): Solid {
  const v: Vec3[] = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) v.push(norm([x, y, z]));
  // Indices: 0(-,-,-) 1(-,-,+) 2(-,+,-) 3(-,+,+) 4(+,-,-) 5(+,-,+) 6(+,+,-) 7(+,+,+)
  const faces = [
    [1, 5, 7, 3], // +z
    [4, 0, 2, 6], // -z
    [3, 7, 6, 2], // +y
    [0, 4, 5, 1], // -y
    [5, 4, 6, 7], // +x
    [0, 1, 3, 2], // -x
  ];
  // Opposite faces sum to 7, as a real die does.
  return { vertices: v, faces, faceValues: [1, 6, 2, 5, 3, 4] };
}

function octahedron(): Solid {
  const v: Vec3[] = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  ];
  const faces = [
    [0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4],
    [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5],
  ];
  return { vertices: v, faces, faceValues: [1, 2, 3, 4, 5, 6, 7, 8] };
}

function icosahedron(): Solid {
  const v: Vec3[] = [];
  for (const s1 of [-1, 1]) for (const s2 of [-1, 1]) {
    v.push(norm([0, s1, s2 * PHI]));
    v.push(norm([s1, s2 * PHI, 0]));
    v.push(norm([s1 * PHI, 0, s2]));
  }
  // Build faces by proximity: in an icosahedron every vertex has exactly 5 nearest neighbours, and
  // each face is a triple that are all mutually nearest. Deriving it beats hand-listing 20 triples.
  const faces = trianglesByProximity(v, 5);
  return { vertices: v, faces, faceValues: faces.map((_, i) => i + 1) };
}

/** Faces of a regular deltahedron: every mutually-adjacent triple of vertices, deduped. */
function trianglesByProximity(v: Vec3[], degree: number): number[][] {
  const d = (a: number, b: number) => Math.hypot(v[a][0] - v[b][0], v[a][1] - v[b][1], v[a][2] - v[b][2]);
  const near: number[][] = v.map((_, i) =>
    v
      .map((_, j) => j)
      .filter((j) => j !== i)
      .sort((x, y) => d(i, x) - d(i, y))
      .slice(0, degree),
  );
  const seen = new Set<string>();
  const out: number[][] = [];
  for (let i = 0; i < v.length; i++)
    for (const j of near[i])
      for (const k of near[j])
        if (near[i].includes(k)) {
          const key = [i, j, k].sort((a, b) => a - b).join(',');
          if (seen.has(key)) continue;
          seen.add(key);
          // Wind counter-clockwise as seen from outside: the normal must point away from the centre.
          const tri = [i, j, k];
          const n = faceNormal({ vertices: v, faces: [tri], faceValues: [0] }, 0);
          const c = faceCentre({ vertices: v, faces: [tri], faceValues: [0] }, 0);
          out.push(n[0] * c[0] + n[1] * c[1] + n[2] * c[2] < 0 ? [i, k, j] : tri);
        }
  return out;
}

function dodecahedron(): Solid {
  const v: Vec3[] = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) v.push(norm([x, y, z]));
  for (const s1 of [-1, 1]) for (const s2 of [-1, 1]) {
    v.push(norm([0, s1 / PHI, s2 * PHI]));
    v.push(norm([s1 / PHI, s2 * PHI, 0]));
    v.push(norm([s1 * PHI, 0, s2 / PHI]));
  }
  /*
   * Faces from the EDGE GRAPH, not from an assumed duality.
   *
   * The first attempt took the icosahedron's vertices as face normals and grabbed the 5 nearest
   * vertices to each. That looks right — a dodecahedron's 12 faces do correspond to an icosahedron's
   * 12 vertices — but only for the correctly aligned dual, and these two constructions are not. The
   * five "nearest" vertices came back with dot products of 0.98, 0.79, 0.79, 0.61, 0.49 where a real
   * face has five EQUAL ones, so each face was a ragged non-planar pick.
   *
   * The edge graph needs no such assumption: in a dodecahedron every vertex has exactly 3 neighbours
   * at the minimum vertex distance, and every face is a 5-cycle in that graph.
   */
  const dist = (a: number, b: number) => Math.hypot(v[a][0] - v[b][0], v[a][1] - v[b][1], v[a][2] - v[b][2]);
  let edge = Infinity;
  for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) edge = Math.min(edge, dist(i, j));
  const adj = v.map((_, i) => v.map((_, j) => j).filter((j) => j !== i && Math.abs(dist(i, j) - edge) < 1e-6));

  const seen = new Set<string>();
  const faces: number[][] = [];
  for (let a = 0; a < v.length; a++)
    for (const b of adj[a])
      for (const c of adj[b]) {
        if (c === a) continue;
        for (const d of adj[c]) {
          if (d === b || d === a) continue;
          for (const e of adj[d]) {
            if (e === c || e === b || e === a) continue;
            if (!adj[e].includes(a)) continue;
            const cyc = [a, b, c, d, e];
            const key = [...cyc].sort((x, y) => x - y).join(',');
            if (seen.has(key)) continue;
            seen.add(key);
            faces.push(cyc);
          }
        }
      }
  return { vertices: v, faces, faceValues: faces.map((_, i) => i + 1) };
}


/** A d10 is a pentagonal trapezohedron: two offset rings of 5, plus a tip at each pole. */
function trapezohedron10(): Solid {
  /*
   * The ring height is SOLVED, not guessed. A kite [apex, upper_i, lower_i, upper_i+1] is only planar
   * for one ring height given the apex height, and an eyeballed 0.35 left every face 0.09 out of
   * plane — which a flat fill renders as a visibly creased die. Bisection on the coplanarity residual
   * is exact enough and keeps the shape honest.
   */
  const R = 1;
  const C = 1.25; // apex height
  const ang = (i: number) => (i / 5) * Math.PI * 2;
  const residual = (h: number) => {
    const top: Vec3 = [0, C, 0];
    const u0: Vec3 = [Math.cos(ang(0)) * R, h, Math.sin(ang(0)) * R];
    const u1: Vec3 = [Math.cos(ang(1)) * R, h, Math.sin(ang(1)) * R];
    const l0: Vec3 = [Math.cos(ang(0.5)) * R, -h, Math.sin(ang(0.5)) * R];
    // Signed distance of l0 from the plane through (top, u0, u1).
    const a: Vec3 = [u0[0] - top[0], u0[1] - top[1], u0[2] - top[2]];
    const b: Vec3 = [u1[0] - top[0], u1[1] - top[1], u1[2] - top[2]];
    const n = norm([a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]);
    return (l0[0] - top[0]) * n[0] + (l0[1] - top[1]) * n[1] + (l0[2] - top[2]) * n[2];
  };
  let lo = 0.01;
  let hi = 1.2;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (residual(lo) * residual(mid) <= 0) hi = mid;
    else lo = mid;
  }
  const H = (lo + hi) / 2;

  const v: Vec3[] = [];
  for (let i = 0; i < 5; i++) v.push([Math.cos(ang(i)) * R, H, Math.sin(ang(i)) * R]);
  for (let i = 0; i < 5; i++) v.push([Math.cos(ang(i + 0.5)) * R, -H, Math.sin(ang(i + 0.5)) * R]);
  v.push([0, C, 0]);
  v.push([0, -C, 0]);
  const TOP = 10;
  const BOT = 11;
  // upper[i] sits at angle i·72°, lower[i] at (i+0.5)·72° — so lower[i] falls BETWEEN upper[i] and
  // upper[i+1]. The ten kites therefore alternate: one hanging from the top tip, one from the bottom.
  const faces: number[][] = [];
  for (let i = 0; i < 5; i++) {
    const u = i;
    const un = (i + 1) % 5;
    const l = 5 + i;
    const ln = 5 + ((i + 1) % 5);
    faces.push([TOP, u, l, un]);
    faces.push([BOT, ln, un, l]);
  }
  return { vertices: v, faces, faceValues: faces.map((_, i) => i + 1) };
}

const SOLIDS: Record<number, () => Solid> = {
  4: tetrahedron,
  6: cube,
  8: octahedron,
  10: trapezohedron10,
  12: dodecahedron,
  20: icosahedron,
  // A d100 is rolled as two d10s in PF2e; the tray shows a d10 and labels it.
  100: trapezohedron10,
};

/**
 * Force every face to wind counter-clockwise as seen from OUTSIDE.
 *
 * Hand-authored winding was wrong on three of the six solids, and the symptom is subtle: the depth
 * sort still works, so the die looks right until a face lights as though the light were inside it.
 * Deriving the fix from the geometry beats getting 60 index triples right by eye.
 */
function faceOutward(s: Solid): Solid {
  const faces = s.faces.map((f, i) => {
    const c = faceCentre(s, i);
    const n = faceNormal(s, i);
    return n[0] * c[0] + n[1] * c[1] + n[2] * c[2] < 0 ? [...f].reverse() : f;
  });
  return { ...s, faces };
}

const cache = new Map<number, Solid>();
export function solidFor(sides: number): Solid {
  const key = SOLIDS[sides] ? sides : 6;
  let s = cache.get(key);
  if (!s) {
    s = faceOutward(SOLIDS[key]());
    cache.set(key, s);
  }
  return s;
}

/* ---------------------------------------------------------------- rotation + projection */

export type Mat3 = [number, number, number, number, number, number, number, number, number];

export const IDENT: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function mul(a: Mat3, b: Mat3): Mat3 {
  const o = new Array(9).fill(0) as unknown as Mat3;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
}

export function rotate(axis: Vec3, angle: number): Mat3 {
  const [x, y, z] = norm(axis);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ];
}

export function apply(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/**
 * The rotation that brings a face's normal to point at the camera (+z).
 *
 * This is what makes the die land on the number that was already rolled. Without it the animation
 * would have to be read for its result, which would put a second source of truth beside dice.ts.
 */
export function orientationShowing(s: Solid, faceIndex: number): Mat3 {
  const n = faceNormal(s, faceIndex);
  const target: Vec3 = [0, 0, 1];
  const dot = n[0] * target[0] + n[1] * target[1] + n[2] * target[2];
  if (dot > 0.9999) return IDENT;
  if (dot < -0.9999) return rotate([1, 0, 0], Math.PI);
  const axis: Vec3 = [n[1] * target[2] - n[2] * target[1], n[2] * target[0] - n[0] * target[2], n[0] * target[1] - n[1] * target[0]];
  return rotate(axis, Math.acos(Math.max(-1, Math.min(1, dot))));
}

/** The face index showing `value`, or the first face when the die has no such number. */
export function faceShowing(s: Solid, value: number): number {
  const i = s.faceValues.indexOf(value);
  return i >= 0 ? i : 0;
}

/** Perspective projection to canvas pixels. */
export function project(v: Vec3, cx: number, cy: number, scale: number): [number, number, number] {
  const depth = 4;
  const k = depth / (depth - v[2]);
  return [cx + v[0] * scale * k, cy - v[1] * scale * k, v[2]];
}

/** Smooth settle: fast at first, then easing to rest. */
export const easeOut = (t: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);
