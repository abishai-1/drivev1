import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import type { Terrain } from './terrain';
import type { TrackPath } from './track';
import type { Network } from './paths';
import { outline, outlineMaterial, toon, trackHull } from './look';

/** Shared handles every builder needs. */
export interface Ctx {
  scene: THREE.Scene;
  world: CANNON.World;
  /** Mesh/body pairs synced every frame. */
  dynamic: { mesh: THREE.Object3D; body: CANNON.Body }[];
  /** Per-frame animation hooks (lighthouse beam, spotlights...). */
  updaters: ((t: number, dt: number) => void)[];
  terrain: Terrain;
  track: TrackPath;
  net: Network;
  materials: { ground: CANNON.Material; slide: CANNON.Material };
}

export function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id} in index.html`);
  return node as T;
}

/** Toon-shaded solid material (see look.ts). */
export const mat = (color: number) => toon(color);

/** Cast + receive shadows, and ink the silhouette. */
export function shadowed<T extends THREE.Mesh>(mesh: T): T {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return outline(mesh);
}

/** Copy a cannon position/rotation onto a three object (their vector types are not interchangeable). */
export function syncObject(obj: THREE.Object3D, pos: CANNON.Vec3, quat: CANNON.Quaternion) {
  obj.position.set(pos.x, pos.y, pos.z);
  obj.quaternion.set(quat.x, quat.y, quat.z, quat.w);
}

// Seeded random so the world layout is stable between reloads
let seed = 7;
export const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
export const randRange = (a: number, b: number) => a + rand() * (b - a);

const UP = new THREE.Vector3(0, 1, 0);
/** Translation + yaw + scale matrix for instancing. */
export function trs(x: number, y: number, z: number, yaw = 0, sx = 1, sy = 1, sz = 1) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(UP, yaw),
    new THREE.Vector3(sx, sy, sz)
  );
}

/** One draw call for many copies of the same mesh. */
export function instanced(
  scene: THREE.Scene,
  geo: THREE.BufferGeometry,
  material: THREE.Material,
  matrices: THREE.Matrix4[],
  colors?: THREE.Color[],
  shadows = true
) {
  // big sets spread across the island are split into 120 m cells so off-screen ones are culled
  // (one island-wide InstancedMesh is always drawn, twice with shadows)
  const groups = new Map<number, number[]>();
  const p = new THREE.Vector3();
  matrices.forEach((t, i) => {
    p.setFromMatrixPosition(t);
    const key = matrices.length > 300 ? Math.floor(p.x / 160) * 1000 + Math.floor(p.z / 160) : 0;
    const g = groups.get(key);
    if (g) g.push(i);
    else groups.set(key, [i]);
  });
  if (!groups.size) groups.set(0, []);
  for (const idx of groups.values()) {
    const m = new THREE.InstancedMesh(geo, material, Math.max(idx.length, 1));
    m.count = idx.length;
    idx.forEach((src, i) => {
      m.setMatrixAt(i, matrices[src]);
      if (colors?.[src]) m.setColorAt(i, colors[src]);
    });
    m.castShadow = shadows;
    m.receiveShadow = true;
    m.computeBoundingSphere();
    scene.add(m);
    if (shadows && !material.transparent) {
      // ink outline: a back-face hull drawn with the same instance matrices
      const o = new THREE.InstancedMesh(geo, outlineMaterial(material), Math.max(idx.length, 1));
      o.instanceMatrix = m.instanceMatrix;
      o.count = m.count;
      o.boundingSphere = m.boundingSphere;
      scene.add(o);
      trackHull(o);
    }
  }
}

/** Invisible static collider (half extents). */
export function staticBox(ctx: Ctx, x: number, y: number, z: number, hx: number, hy: number, hz: number, yaw = 0) {
  const body = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(hx, hy, hz)) });
  body.position.set(x, y, z);
  if (yaw) body.quaternion.setFromEuler(0, yaw, 0);
  ctx.world.addBody(body);
  return body;
}

/** True when (x, z) is at least `margin` meters off the edge of every road (track included) and out of rivers. */
export const clearOfRoad = (ctx: Ctx, x: number, z: number, margin = 3) =>
  ctx.net.roadIndex.nearest(x, z, true).dist > margin && ctx.net.riverIndex.nearest(x, z, true).dist > 2;

/**
 * Nearest spot to (x, z) whose footprint of radius `r` is clear of roads, searched on rings out to `maxShift`.
 * Returns the original spot if nothing better is found.
 */
export function clearSpot(ctx: Ctx, x: number, z: number, r: number, maxShift = 30): [number, number] {
  if (clearOfRoad(ctx, x, z, r)) return [x, z];
  for (let d = 2; d <= maxShift; d += 2) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const nx = x + Math.cos(a) * d;
      const nz = z + Math.sin(a) * d;
      if (clearOfRoad(ctx, nx, nz, r)) return [nx, nz];
    }
  }
  return [x, z];
}

export function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('2D canvas not supported');
  draw(g);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function makeLabel(text: string, color = '#e8604c', scale = 1): THREE.Sprite {
  const tex = canvasTexture(512, 128, (g) => {
    g.fillStyle = '#fff7ec';
    g.beginPath();
    g.roundRect(8, 8, 496, 112, 56);
    g.fill();
    g.fillStyle = color;
    g.font = 'bold 60px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 256, 68, 470);
  });
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  sprite.scale.set(6 * scale, 1.5 * scale, 1);
  return sprite;
}
