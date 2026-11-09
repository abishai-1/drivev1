// Splines sampled every 2 m with a spatial hash: the race track, roads and rivers all use this.
import * as THREE from 'three';
import {
  LAKES, RIVERS, RIVER_HALF_WIDTH, ROADS, TRACK_HALF_WIDTH, TRACK_POINTS, TRACK_START, WATER_Y,
} from './layout';

export const SAMPLE_STEP = 2;
const CELL = 20;
const MIN_ROAD_Y = 1.4;
const BRIDGE_Y = 3.2;
const MAX_GRADE = 0.09; // 9% max road slope

export interface Path {
  id: string;
  kind: 'track' | 'road' | 'street' | 'river';
  from: string;
  to: string;
  closed: boolean;
  halfWidth: number;
  points: THREE.Vector3[]; // y = surface height (roads) or water level (rivers)
  tangents: THREE.Vector3[]; // horizontal, normalized
  /** Per sample: true where a road crosses a river (bridge deck, terrain left carved below). */
  bridge: boolean[];
  length: number;
}

export interface PathHit {
  dist: number;
  path: Path | null;
  index: number;
}

const FAR: PathHit = { dist: Infinity, path: null, index: -1 };

/** Spatial hash over the samples of many paths. */
export class PathIndex {
  private cells = new Map<number, [Path, number][]>();
  constructor(public paths: Path[]) {
    for (const p of paths) p.points.forEach((pt, i) => this.add(p, i, pt));
  }
  private key(cx: number, cz: number) {
    return cx * 100003 + cz;
  }
  private add(p: Path, i: number, pt: THREE.Vector3) {
    const k = this.key(Math.floor(pt.x / CELL), Math.floor(pt.z / CELL));
    const list = this.cells.get(k);
    if (list) list.push([p, i]);
    else this.cells.set(k, [[p, i]]);
  }
  /** Nearest sample, measured to the path's edge if `edge` (distance minus half width). */
  nearest(x: number, z: number, edge = false): PathHit {
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    let best = Infinity;
    let hit: PathHit = FAR;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const list = this.cells.get(this.key(cx + dx, cz + dz));
        if (!list) continue;
        for (const [p, i] of list) {
          const pt = p.points[i];
          let d = Math.hypot(pt.x - x, pt.z - z);
          if (edge) d -= p.halfWidth;
          if (d < best) {
            best = d;
            hit = { dist: d, path: p, index: i };
          }
        }
      }
    }
    return hit;
  }
}

function sample(id: string, kind: Path['kind'], pts2: [number, number][], closed: boolean, halfWidth: number, from = '', to = ''): Path {
  const curve = new THREE.CatmullRomCurve3(pts2.map(([x, z]) => new THREE.Vector3(x, 0, z)), closed, 'centripetal');
  const length = curve.getLength();
  const n = Math.max(2, Math.round(length / SAMPLE_STEP));
  let points = curve.getSpacedPoints(n);
  if (closed) points = points.slice(0, n);
  const m = points.length;
  const tangents = points.map((_, i) => {
    const a = points[closed ? (i - 1 + m) % m : Math.max(i - 1, 0)];
    const b = points[closed ? (i + 1) % m : Math.min(i + 1, m - 1)];
    return new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
  });
  return { id, kind, from, to, closed, halfWidth, points, tangents, bridge: points.map(() => false), length };
}

function smoothAlong(p: Path, window: number, passes: number) {
  const m = p.points.length;
  let hs = p.points.map((q) => q.y);
  for (let k = 0; k < passes; k++) {
    hs = hs.map((_, i) => {
      let s = 0;
      let c = 0;
      for (let j = -window; j <= window; j++) {
        const idx = p.closed ? (i + j + m) % m : i + j;
        if (idx < 0 || idx >= m) continue;
        s += hs[idx];
        c++;
      }
      return s / c;
    });
  }
  p.points.forEach((q, i) => (q.y = hs[i]));
}

/**
 * Cap how much the road may rise or fall per sample, by relaxing heights toward their neighbours in both
 * directions. Steeper terrain then gets cuttings and embankments instead of a ski jump.
 */
function limitGrade(p: Path, maxStep: number, pins?: Map<number, number>) {
  const m = p.points.length;
  const ys = p.points.map((q) => q.y);
  for (let pass = 0; pass < 6; pass++) {
    for (let dir = 0; dir < 2; dir++) {
      for (let k = 1; k < m + (p.closed ? m : 0); k++) {
        const i = dir === 0 ? k % m : (m - 1 - (k % m) + m) % m;
        const prev = dir === 0 ? (i - 1 + m) % m : (i + 1) % m;
        if (!p.closed && (dir === 0 ? i === 0 : i === m - 1)) continue;
        if (pins?.has(i)) continue; // junction heights are fixed; neighbours adapt to them
        ys[i] = Math.min(Math.max(ys[i], ys[prev] - maxStep), ys[prev] + maxStep);
      }
    }
  }
  p.points.forEach((q, i) => (q.y = Math.max(ys[i], MIN_ROAD_Y)));
}

export interface Network {
  track: Path;
  roads: Path[]; // includes the track
  rivers: Path[];
  roadIndex: PathIndex;
  riverIndex: PathIndex;
  /** Distance to the nearest lake shore (negative inside). */
  lakeDist(x: number, z: number): number;
}

/**
 * Build all paths. Road heights come from a low-pass of the terrain so crossing roads agree on height,
 * then get lifted to bridge height where they cross a river.
 */
export function buildNetwork(baseHeight: (x: number, z: number) => number): Network {
  const smoothBase = (x: number, z: number) => {
    let s = 0;
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) s += baseHeight(x + i * 6, z + j * 6);
    return s / 25;
  };

  const rivers = RIVERS.map((pts, i) => sample(`river-${i}`, 'river', pts, false, RIVER_HALF_WIDTH));
  rivers.forEach((r) => r.points.forEach((p) => (p.y = WATER_Y)));
  const riverIndex = new PathIndex(rivers);
  const lakeDist = (x: number, z: number) => Math.min(...LAKES.map((l) => Math.hypot(x - l.x, z - l.z) - l.r));

  let track = sample('track', 'track', TRACK_POINTS, true, TRACK_HALF_WIDTH);
  // start the loop at the sample nearest the stadium
  let start = 0;
  let best = Infinity;
  track.points.forEach((p, i) => {
    const d = Math.hypot(p.x - TRACK_START[0], p.z - TRACK_START[1]);
    if (d < best) [best, start] = [d, i];
  });
  const rot = <T,>(a: T[]) => [...a.slice(start), ...a.slice(0, start)];
  track = { ...track, points: rot(track.points), tangents: rot(track.tangents), bridge: rot(track.bridge) };

  const roads = [
    track,
    ...ROADS.map((r) => sample(r.id, r.points.length === 2 ? 'street' : 'road', r.points, false, r.halfWidth, r.from, r.to)),
  ];
  // Roads are settled in priority order (track first). Where a road meets one already settled, its height
  // is pinned to that road's, so junctions meet flush instead of one road being buried under the other.
  const done: Path[] = [];
  for (const road of roads) {
    road.points.forEach((p, i) => {
      p.y = Math.max(smoothBase(p.x, p.z), MIN_ROAD_Y);
      const wet = Math.min(riverIndex.nearest(p.x, p.z, true).dist, lakeDist(p.x, p.z));
      if (wet < road.halfWidth + 4) road.bridge[i] = true;
      if (wet < road.halfWidth + 14) p.y = Math.max(p.y, BRIDGE_Y); // ramp up to the deck
    });
    const pins = new Map<number, number>();
    if (done.length) {
      const index = new PathIndex(done);
      road.points.forEach((p, i) => {
        const hit = index.nearest(p.x, p.z);
        if (hit.path && hit.dist < Math.max(road.halfWidth, hit.path.halfWidth) + 3) pins.set(i, hit.path.points[hit.index].y);
      });
    }
    const pin = () => pins.forEach((y, i) => (road.points[i].y = y));
    pin();
    smoothAlong(road, 10, 4);
    pin();
    limitGrade(road, MAX_GRADE * SAMPLE_STEP, pins);
    smoothAlong(road, 3, 2); // round off the kinks the grade limit leaves
    pin();
    limitGrade(road, MAX_GRADE * SAMPLE_STEP * 1.2, pins);
    done.push(road);
  }

  return { track, roads, rivers, roadIndex: new PathIndex(roads), riverIndex, lakeDist };
}
