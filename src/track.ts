import * as THREE from 'three';
import type { Network, Path } from './paths';
import { type Ctx, makeLabel, mat, shadowed, staticBox } from './utils';

export interface TrackHit {
  dist: number;
  h: number;
  index: number;
}

export interface TrackPath extends Path {
  checkpoints: number[]; // sample indices; [0] = start/finish
  nearest(x: number, z: number): TrackHit;
}

const CHECKPOINTS = 12;

export function makeTrack(net: Network): TrackPath {
  const t = net.track;
  const n = t.points.length;
  const only = net.roadIndex;
  return {
    ...t,
    checkpoints: Array.from({ length: CHECKPOINTS }, (_, k) => Math.round((k * n) / CHECKPOINTS)),
    nearest(x, z) {
      // nearest road sample, but only report it if it's on the track
      const hit = only.nearest(x, z);
      if (hit.path?.id !== 'track') {
        // fall back to a direct scan of nearby track samples
        let best = Infinity;
        let idx = -1;
        for (let i = 0; i < n; i += 1) {
          const p = t.points[i];
          const d = (p.x - x) ** 2 + (p.z - z) ** 2;
          if (d < best) [best, idx] = [d, i];
        }
        return { dist: Math.sqrt(best), h: t.points[idx].y, index: idx };
      }
      return { dist: hit.dist, h: t.points[hit.index].y, index: hit.index };
    },
  };
}

// ---------- Visuals ----------

export function stripeTexture(draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, w = 64, h = 64) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas not supported');
  draw(g, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

/** Ribbon along a path between lateral offsets a..b (meters from center), lifted by `lift`. */
export function ribbon(path: Path, a: number, b: number, lift: number, vScale: number) {
  const { points, tangents, closed } = path;
  const n = points.length;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let dist = 0;
  const count = closed ? n + 1 : n;
  for (let i = 0; i < count; i++) {
    const p = points[i % n];
    const t = tangents[i % n];
    if (i > 0) dist += p.distanceTo(points[(i - 1) % n]);
    const rx = -t.z;
    const rz = t.x;
    pos.push(p.x + rx * a, p.y + lift, p.z + rz * a, p.x + rx * b, p.y + lift, p.z + rz * b);
    uv.push(0, dist / vScale, 1, dist / vScale);
    if (i < count - 1) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); // counter-clockwise seen from above → faces up
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export const decalMat = (map: THREE.Texture, offset: number) =>
  new THREE.MeshStandardMaterial({ map, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -offset, polygonOffsetUnits: -offset * 2 });

export function buildTrack(ctx: Ctx) {
  const { scene, track } = ctx;
  const hw = track.halfWidth;

  const roadTex = stripeTexture((g, w, h) => {
    g.fillStyle = '#5d5862';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff7ec';
    g.fillRect(w / 2 - 2, 0, 4, h / 2);
    g.fillRect(3, 0, 2, h);
    g.fillRect(w - 5, 0, 2, h);
  });
  const road = new THREE.Mesh(ribbon(track, -hw, hw, 0.08, 8), decalMat(roadTex, 3));
  road.receiveShadow = true;
  scene.add(road);

  const curbTex = stripeTexture((g, w, h) => {
    g.fillStyle = '#e8604c';
    g.fillRect(0, 0, w, h / 2);
    g.fillStyle = '#fff7ec';
    g.fillRect(0, h / 2, w, h / 2);
  });
  const curbMat = decalMat(curbTex, 3);
  for (const side of [-1, 1]) {
    const a = side * hw;
    const b = side * (hw + 1);
    const curb = new THREE.Mesh(ribbon(track, Math.min(a, b), Math.max(a, b), 0.1, 3), curbMat);
    curb.receiveShadow = true;
    scene.add(curb);
  }

  // checkpoint arches
  const postGeo = new THREE.BoxGeometry(0.6, 6, 0.6);
  const bannerGeo = new THREE.BoxGeometry(hw * 2 + 3, 1.2, 0.4);
  const checker = stripeTexture((g, w, h) => {
    const s = w / 8;
    for (let y = 0; y < h / s; y++)
      for (let x = 0; x < 8; x++) {
        g.fillStyle = (x + y) % 2 ? '#3b2a3f' : '#fff7ec';
        g.fillRect(x * s, y * s, s, s);
      }
  }, 128, 32);
  checker.repeat.set(4, 1);
  track.checkpoints.forEach((ci, k) => {
    const p = track.points[ci];
    const t = track.tangents[ci];
    const yaw = Math.atan2(t.x, t.z);
    const gate = new THREE.Group();
    gate.position.set(p.x, p.y, p.z);
    gate.rotation.y = yaw;
    const color = k === 0 ? 0x3b2a3f : 0xe8604c;
    for (const side of [-1, 1]) {
      const post = shadowed(new THREE.Mesh(postGeo, mat(color)));
      post.position.set(side * (hw + 1.6), 3, 0);
      gate.add(post);
      const [wx, wz] = [p.x + Math.cos(yaw) * side * (hw + 1.6), p.z - Math.sin(yaw) * side * (hw + 1.6)];
      staticBox(ctx, wx, p.y + 3, wz, 0.3, 3, 0.3, yaw);
    }
    const banner = shadowed(new THREE.Mesh(bannerGeo, k === 0 ? new THREE.MeshStandardMaterial({ map: checker }) : mat(color)));
    banner.position.y = 6.2;
    gate.add(banner);
    scene.add(gate);
    if (k === 0) {
      const label = makeLabel('START / FINISH', '#3b2a3f');
      label.position.set(p.x, p.y + 8.5, p.z);
      scene.add(label);
    }
  });
}

// ---------- Lap timing ----------

export interface LapState {
  started: boolean;
  lapTime: number;
  last: number | null;
  best: number | null;
  next: number;
  total: number;
  lastCheckpoint: number;
}

const BEST_KEY = 'drivefolio.bestLap';

function loadBest(): number | null {
  try {
    const v = Number(localStorage.getItem(BEST_KEY));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}

export function createLapTimer(track: TrackPath) {
  const state: LapState = { started: false, lapTime: 0, last: null, best: loadBest(), next: 0, total: track.checkpoints.length, lastCheckpoint: 0 };
  let startAt = 0;
  const n = track.points.length;

  return {
    state,
    update(x: number, z: number, now: number): 'lap' | 'checkpoint' | null {
      if (state.started) state.lapTime = (now - startAt) / 1000;
      const hit = track.nearest(x, z);
      if (hit.dist > track.halfWidth + 3) return null;
      const target = track.checkpoints[state.next];
      const d = Math.abs(hit.index - target);
      if (Math.min(d, n - d) > 3) return null;

      let event: 'lap' | 'checkpoint' = 'checkpoint';
      if (state.next === 0) {
        if (state.started) {
          const t = (now - startAt) / 1000;
          state.last = t;
          if (state.best === null || t < state.best) {
            state.best = t;
            try {
              localStorage.setItem(BEST_KEY, String(t));
            } catch {
              /* storage unavailable: best lap just won't persist */
            }
          }
          event = 'lap';
        }
        state.started = true;
        startAt = now;
        state.lapTime = 0;
      }
      state.lastCheckpoint = state.next;
      state.next = (state.next + 1) % state.total;
      return event;
    },
  };
}
