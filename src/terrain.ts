import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { C } from './palette';
import { FARM_FIELDS, GRID_STEP, ISLAND_R, PLACES, RIVER_HALF_WIDTH, RUNWAY, STUNT_PAD, WORLD_HALF, type Place } from './layout';
import { ROAD_SINK, type Network } from './paths';
import { toonRamp } from './look';

// ---------- Noise ----------
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

function hash(x: number, y: number) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function noise(x: number, y: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x: number, y: number, octaves = 4) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

// ---------- Height ----------
type FlatPlace = Place & { flat: number };
const FLAT: FlatPlace[] = [...Object.values(PLACES), STUNT_PAD].filter((p): p is FlatPlace => p.flat !== undefined);

/** 1 inside the place, fading to 0 over `falloff` meters outside it. */
export function placeWeight(p: Place, x: number, z: number, falloff = 25) {
  return smoothstep(p.radius + falloff, p.radius, Math.hypot(x - p.x, z - p.z));
}

/** City pavement: a rounded square around the street grid (covers the outer ring of buildings too). */
export function cityWeight(x: number, z: number) {
  const dx = Math.abs(x - PLACES.city.x);
  const dz = Math.abs(z - PLACES.city.z);
  return smoothstep(72, 64, Math.max(dx, dz)) * smoothstep(86, 76, Math.hypot(dx, dz));
}

export function coastRadius(x: number, z: number) {
  return ISLAND_R + (fbm(x / 70 + 31, z / 70 + 17, 3) - 0.5) * 50;
}

/** Terrain height before the race track is carved in. */
export function baseHeight(x: number, z: number) {
  const r = Math.hypot(x, z);
  const coast = coastRadius(x, z);
  const land = smoothstep(coast + 14, coast - 34, r); // 1 on land, 0 at sea (a gentle beach slope)
  const inland = smoothstep(coast - 5, coast - 80, r); // low coastal plain → beaches

  let h = 1.6 + Math.pow(fbm(x / 120, z / 120, 4), 1.6) * 26 * inland;

  const canyon = placeWeight(PLACES.canyon, x, z, 35);
  if (canyon > 0) {
    const ridge = 1 - Math.abs(fbm(x / 40 + 7, z / 40 + 3, 3) * 2 - 1);
    h += canyon * ridge * ridge * 34;
  }
  const jungle = placeWeight(PLACES.jungle, x, z, 30);
  h = h * (1 - jungle * 0.45) + jungle * 1.2;
  // rolling hills for the wind turbines
  h += placeWeight(PLACES.windfarm, x, z, 40) * (6 + fbm(x / 30, z / 30, 2) * 10);

  // sea floor: a wide shallow shelf you can wade back out of, dropping off only far from the coast
  const seaFloor = -0.9 - 5 * smoothstep(coast + 28, coast + 70, r);
  h = h * land + seaFloor * (1 - land);
  for (const p of FLAT) {
    const w = placeWeight(p, x, z);
    if (w > 0) h += (p.flat - h) * w;
  }
  return h;
}

// ---------- Ground colors ----------
const col = (hex: number) => new THREE.Color(hex);
const K = {
  grass: col(C.grass),
  grassDark: col(C.grassDark),
  jungle: col(C.jungle),
  jungleDark: col(C.jungleDark),
  sand: col(C.sand),
  wet: col(C.wetSand),
  canyon: col(C.canyon),
  canyonLight: col(C.canyonLight),
  asphalt: col(C.asphalt),
  concrete: col(C.concrete),
};
const tmp = new THREE.Color();

export function groundColor(x: number, z: number, h: number, slope: number, out: THREE.Color) {
  out.copy(K.grass).lerp(K.grassDark, fbm(x / 22, z / 22, 2));
  const jw = placeWeight(PLACES.jungle, x, z, 20);
  if (jw > 0) out.lerp(tmp.copy(K.jungle).lerp(K.jungleDark, fbm(x / 9, z / 9, 2)), jw);
  const cw = placeWeight(PLACES.canyon, x, z, 25) * smoothstep(3, 8, h);
  if (cw > 0) out.lerp(tmp.copy(K.canyon).lerp(K.canyonLight, 0.5 + 0.5 * Math.sin(h * 0.9)), cw);
  if (slope > 0.5) out.lerp(K.canyon, smoothstep(0.5, 1.1, slope) * 0.8);
  // sand only on the low coastal strip (flat inland places also sit low, at y = 2)
  const r = Math.hypot(x, z);
  const paved = Math.max(placeWeight(PLACES.airport, x, z, 10), cityWeight(x, z), placeWeight(PLACES.stadium, x, z, 10));
  const nearCoast = smoothstep(coastRadius(x, z) - 70, coastRadius(x, z) - 35, r) * (1 - paved);
  const sand = Math.max(smoothstep(2.6, 1.7, h) * nearCoast, placeWeight(PLACES.beach, x, z, 15));
  out.lerp(K.sand, sand);
  out.lerp(K.asphalt, cityWeight(x, z) * 0.85);
  out.lerp(K.concrete, placeWeight(PLACES.studio, x, z, 8) * 0.7);
  out.lerp(K.wet, smoothstep(0.6, -0.4, h));
  return out;
}

// ---------- Build ----------
export interface Terrain {
  /** Ground height at (x, z), matching the rendered mesh. */
  sample(x: number, z: number): number;
  heights: Float32Array; // index = i + j * n, x = -HALF + i*STEP, z = -HALF + j*STEP
  n: number;
  /** RGBA float: r = height, g = grass density (0..1). Nearest-filtered; sampled by the grass shader. */
  dataTexture: THREE.DataTexture;
  /** Ground color (sRGB), linear-filtered; tints the grass. */
  colorTexture: THREE.DataTexture;
}

const RIVER_BED = -0.85; // shallow: cars wade across slowly

/** 0..1 inside the runway rectangle (+ margin). */
function onRunway(x: number, z: number) {
  const dx = x - RUNWAY.x;
  const dz = z - RUNWAY.z;
  const u = dx * RUNWAY.dir[0] + dz * RUNWAY.dir[1];
  const v = dx * RUNWAY.side[0] + dz * RUNWAY.side[1];
  return Math.abs(u) < RUNWAY.length / 2 + 4 && Math.abs(v) < RUNWAY.width / 2 + 2;
}
const inField = (x: number, z: number) => FARM_FIELDS.some(([cx, cz, hx, hz]) => Math.abs(x - cx) < hx + 1 && Math.abs(z - cz) < hz + 1);

export function buildTerrain(scene: THREE.Scene, world: CANNON.World, groundMat: CANNON.Material, net: Network): Terrain {
  const n = (WORLD_HALF * 2) / GRID_STEP + 1;
  const H = new Float32Array(n * n);
  const roadDist = new Float32Array(n * n); // distance to nearest road edge, for grass density
  const rw = RIVER_HALF_WIDTH;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = -WORLD_HALF + i * GRID_STEP;
      const z = -WORLD_HALF + j * GRID_STEP;
      let h = baseHeight(x, z);

      // rivers and lakes: carve a bed below the water line; the sea plane fills them
      const wet = Math.min(net.riverIndex.nearest(x, z).dist - rw, net.lakeDist(x, z));
      if (wet < 22) h = Math.min(h, RIVER_BED + (h - RIVER_BED) * smoothstep(-rw * 0.5, 22, wet)); // gentle banks

      // roads: carve a flat bed, except on bridges where the river stays open below
      const r = net.roadIndex.nearest(x, z, true);
      roadDist[i + j * n] = r.dist;
      if (r.path && !r.path.bridge[r.index]) {
        const w = smoothstep(9, 1.5, r.dist);
        // sit the ground a little under the road surface so faceted terrain never pokes through it
        const target = r.path.points[r.index].y - ROAD_SINK * smoothstep(1.5, -0.5, r.dist);
        h += (target - h) * w;
      } else if (r.path && r.dist < 1.5) {
        // under a bridge: only ever lower the ground (the riverbank must not bulge up through the deck)
        h = Math.min(h, r.path.points[r.index].y - ROAD_SINK - 0.4);
      }
      H[i + j * n] = h;
    }
  }

  const sample = (x: number, z: number) => {
    const fx = Math.min(Math.max((x + WORLD_HALF) / GRID_STEP, 0), n - 1.001);
    const fz = Math.min(Math.max((z + WORLD_HALF) / GRID_STEP, 0), n - 1.001);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const a = H[i + j * n];
    const b = H[i + 1 + j * n];
    const c = H[i + (j + 1) * n];
    const d = H[i + 1 + (j + 1) * n];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };

  // visible mesh + baked textures for the grass shader
  const colors = new Float32Array(n * n * 3);
  const data = new Float32Array(n * n * 4);
  const colorBytes = new Uint8Array(n * n * 4);
  const c = new THREE.Color();
  const srgb = { r: 0, g: 0, b: 0 };
  for (let k = 0; k < n * n; k++) {
    const i = k % n;
    const j = (k - i) / n;
    const x = i * GRID_STEP - WORLD_HALF;
    const z = j * GRID_STEP - WORLD_HALF;
    const h = H[k];
    const hx = H[Math.min(i + 1, n - 1) + j * n] - H[Math.max(i - 1, 0) + j * n];
    const hz = H[i + Math.min(j + 1, n - 1) * n] - H[i + Math.max(j - 1, 0) * n];
    const slope = Math.hypot(hx, hz) / (2 * GRID_STEP);
    groundColor(x, z, h, slope, c);
    colors.set([c.r, c.g, c.b], k * 3);

    // grass density: none on water, sand, pavement, rock, roads, runway, plaza, crop fields
    let dens = 0.85 + placeWeight(PLACES.jungle, x, z, 20) * 0.15;
    dens *= smoothstep(1.6, 2.4, h); // shore / riverbanks
    dens *= 1 - smoothstep(0.35, 0.7, slope); // cliffs
    dens *= smoothstep(0.5, 2.5, roadDist[k]);
    dens *= 1 - cityWeight(x, z);
    dens *= 1 - placeWeight(PLACES.studio, x, z, 6);
    dens *= 1 - placeWeight(PLACES.beach, x, z, 12);
    dens *= 1 - placeWeight(PLACES.canyon, x, z, 20) * smoothstep(4, 8, h);
    dens *= 1 - smoothstep(3.2, 1.6, h) * smoothstep(coastRadius(x, z) - 70, coastRadius(x, z) - 35, Math.hypot(x, z)); // beach strip
    if (Math.hypot(x - PLACES.home.x, z - PLACES.home.z) < PLACES.home.radius - 3) dens = 0;
    if (onRunway(x, z) || inField(x, z)) dens = 0;
    data.set([h, dens, 0, 1], k * 4);
    c.getRGB(srgb, THREE.SRGBColorSpace);
    colorBytes.set([srgb.r * 255, srgb.g * 255, srgb.b * 255, 255], k * 4);
  }
  // the visible ground is split into 100 m tiles so the camera (and shadow camera) only draw what they see
  const groundMaterial = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonRamp });
  const T = 50; // cells per tile
  for (let ti = 0; ti < n - 1; ti += T) {
    for (let tj = 0; tj < n - 1; tj += T) {
      const w = Math.min(T, n - 1 - ti);
      const d = Math.min(T, n - 1 - tj);
      const geo = new THREE.PlaneGeometry(w * GRID_STEP, d * GRID_STEP, w, d).rotateX(-Math.PI / 2);
      const pos = geo.attributes.position;
      const col = new Float32Array(pos.count * 3);
      const nor = geo.attributes.normal;
      for (let v = 0; v < pos.count; v++) {
        const i = ti + (v % (w + 1));
        const j = tj + Math.floor(v / (w + 1));
        const k = i + j * n;
        pos.setXYZ(v, i * GRID_STEP - WORLD_HALF, H[k], j * GRID_STEP - WORLD_HALF);
        col.set(colors.subarray(k * 3, k * 3 + 3), v * 3);
        // smooth normals straight from the height grid, so tiles match at their seams
        const hx = H[Math.min(i + 1, n - 1) + j * n] - H[Math.max(i - 1, 0) + j * n];
        const hz = H[i + Math.min(j + 1, n - 1) * n] - H[i + Math.max(j - 1, 0) * n];
        const len = Math.hypot(hx, 2 * GRID_STEP, hz);
        nor.setXYZ(v, -hx / len, (2 * GRID_STEP) / len, -hz / len);
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, groundMaterial);
      mesh.receiveShadow = true;
      mesh.userData.noMerge = true; // tiles stay separate so they cull
      scene.add(mesh);
    }
  }

  const dataTexture = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.FloatType);
  dataTexture.magFilter = dataTexture.minFilter = THREE.NearestFilter;
  dataTexture.needsUpdate = true;
  const colorTexture = new THREE.DataTexture(colorBytes, n, n, THREE.RGBAFormat);
  colorTexture.colorSpace = THREE.SRGBColorSpace;
  colorTexture.magFilter = colorTexture.minFilter = THREE.LinearFilter;
  colorTexture.needsUpdate = true;

  // physics heightfield: data[i][k] with k running from +z to -z (see rotation below)
  const hf: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = new Array(n);
    for (let k = 0; k < n; k++) row[k] = H[i + (n - 1 - k) * n];
    hf.push(row);
  }
  const body = new CANNON.Body({ mass: 0, material: groundMat, shape: new CANNON.Heightfield(hf, { elementSize: GRID_STEP }) });
  // local (x, y, height) → world (x, height, -y); offset so local (0,0) is world (-HALF, +HALF)
  body.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  body.position.set(-WORLD_HALF, 0, WORLD_HALF);
  // cannon caches a new collision pillar for every terrain cell a box ever touches and never frees them, so
  // memory grows the longer you drive and garbage-collection pauses stutter the game. Reuse one pillar instead.
  (body.shapes[0] as CANNON.Heightfield).cacheEnabled = false;
  body.updateAABB();
  world.addBody(body);

  return { sample, heights: H, n, dataTexture, colorTexture };
}
