// Reusable props: knock-over bricks/crates/pins, ramps, forests.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { C } from './palette';
import { PLACES, STUNT_PAD, ISLAND_R, type Place } from './layout';
import { type Ctx, clearOfRoad, instanced, makeLabel, mat, rand, shadowed, staticBox, syncObject, trs } from './utils';
import { coastRadius, fbm } from './terrain';
import { windify } from './wind';

export function addDynamicBox(ctx: Ctx, size: THREE.Vector3, pos: THREE.Vector3, color: number, mass = 3, yaw = 0) {
  const mesh = shadowed(new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), mat(color)));
  ctx.scene.add(mesh);
  const body = new CANNON.Body({
    mass,
    shape: new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2)),
    sleepSpeedLimit: 0.2,
  });
  body.position.set(pos.x, pos.y, pos.z);
  body.quaternion.setFromEuler(0, yaw, 0);
  body.sleep(); // stay put until something hits it
  ctx.world.addBody(body);
  syncObject(mesh, body.position, body.quaternion);
  ctx.dynamic.push({ mesh, body });
  return body;
}

// 3x5 pixel font for brick words; add letters as needed.
const FONT: Record<string, string[]> = {
  A: ['111', '101', '111', '101', '101'],
  B: ['110', '101', '110', '101', '110'],
  E: ['111', '100', '111', '100', '111'],
  H: ['101', '101', '111', '101', '101'],
  I: ['111', '010', '010', '010', '111'],
  L: ['100', '100', '100', '100', '111'],
  O: ['111', '101', '101', '101', '111'],
  S: ['111', '100', '111', '001', '111'],
};

/** A word in loose bricks, reading along +x (faces a camera looking north). */
export function buildBrickWord(ctx: Ctx, word: string, center: THREE.Vector3) {
  const B = 0.7;
  const letterW = 4 * B;
  const startX = center.x - (word.length * letterW) / 2;
  [...word.toUpperCase()].forEach((ch, li) => {
    const glyph = FONT[ch];
    if (!glyph) throw new Error(`No brick glyph for "${ch}"; add it to FONT in world.ts`);
    glyph.forEach((row, ri) => {
      [...row].forEach((bit, ci) => {
        if (bit !== '1') return;
        const p = new THREE.Vector3(startX + li * letterW + ci * B, center.y + (4 - ri) * B + B / 2, center.z);
        addDynamicBox(ctx, new THREE.Vector3(B, B, B), p, li % 2 ? C.car : C.leaf, 1.5);
      });
    });
  });
}

/** Static tilted slab. `pitch` > 0 rises toward +z of its own yaw. */
export function ramp(ctx: Ctx, x: number, z: number, yaw: number, w: number, len: number, pitch: number, color: number = C.cream) {
  const base = ctx.terrain.sample(x, z);
  const body = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(w / 2, 0.25, len / 2)) });
  body.position.set(x, base + Math.sin(pitch) * (len / 2) - 0.05, z);
  body.quaternion.setFromEuler(-pitch, yaw, 0, 'YXZ');
  ctx.world.addBody(body);
  const mesh = shadowed(new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, len), mat(color)));
  syncObject(mesh, body.position, body.quaternion);
  ctx.scene.add(mesh);
}

export function crateStack(ctx: Ctx, x: number, z: number, layers = 4) {
  const y0 = ctx.terrain.sample(x, z);
  for (let layer = 0; layer < layers; layer++) {
    for (let i = 0; i < layers - layer; i++) {
      const ox = (i - (layers - 1 - layer) / 2) * 1.05;
      addDynamicBox(ctx, new THREE.Vector3(1, 1, 1), new THREE.Vector3(x + ox, y0 + 0.5 + layer, z), C.crate, 2);
    }
  }
}

export function bowlingPins(ctx: Ctx, x: number, z: number) {
  const pinGeo = new THREE.CylinderGeometry(0.22, 0.32, 1.3, 10);
  const y0 = ctx.terrain.sample(x, z);
  for (let row = 0; row < 4; row++) {
    for (let i = 0; i <= row; i++) {
      const mesh = shadowed(new THREE.Mesh(pinGeo, mat(C.pin)));
      ctx.scene.add(mesh);
      const body = new CANNON.Body({ mass: 1, shape: new CANNON.Cylinder(0.22, 0.32, 1.3, 10) });
      body.position.set(x + (i - row / 2) * 1.1, y0 + 0.65, z + row);
      body.sleep();
      ctx.world.addBody(body);
      syncObject(mesh, body.position, body.quaternion);
      ctx.dynamic.push({ mesh, body });
    }
  }
  const label = makeLabel('Strike?', '#2f7d6d');
  label.position.set(x, y0 + 4, z + 1.5);
  ctx.scene.add(label);
}

// ---------- Forests ----------
export type TreeKind = 'pine' | 'broadleaf' | 'palm';

/** Instanced trees with cheap box colliders. */
export function plantTrees(ctx: Ctx, kind: TreeKind, spots: [number, number, number][]) {
  const trunks: THREE.Matrix4[] = [];
  const crowns: THREE.Matrix4[] = [];
  const crownColors: THREE.Color[] = [];
  const light = new THREE.Color(kind === 'palm' ? 0x6cb36a : C.leaf);
  const dark = new THREE.Color(kind === 'broadleaf' ? 0x2f6b40 : C.leafDark);
  for (const [x, z, s] of spots) {
    const y = ctx.terrain.sample(x, z);
    const yaw = rand() * Math.PI * 2;
    const tall = kind === 'pine' ? 1.6 : kind === 'palm' ? 4.5 : 3.2;
    trunks.push(trs(x, y + (tall * s) / 2, z, yaw, s, s * tall, s));
    if (kind === 'pine') crowns.push(trs(x, y + 2.8 * s, z, yaw, s, s, s));
    else if (kind === 'palm') crowns.push(trs(x, y + tall * s, z, yaw, s, s, s));
    else crowns.push(trs(x, y + tall * s + 1.6 * s, z, yaw, s, s * 0.85, s));
    crownColors.push(new THREE.Color().lerpColors(light, dark, rand()));
    staticBox(ctx, x, y + 1.5, z, 0.35 * s, 1.5, 0.35 * s);
  }
  const trunkGeo =
    kind === 'pine'
      ? new THREE.CylinderGeometry(0.25, 0.35, 1, 6)
      : kind === 'palm'
        ? new THREE.CylinderGeometry(0.18, 0.3, 1, 6)
        : new THREE.CylinderGeometry(0.3, 0.45, 1, 6);
  const crownGeo =
    kind === 'pine'
      ? new THREE.ConeGeometry(1.4, 2.8, 7)
      : kind === 'palm'
        ? new THREE.ConeGeometry(2.6, 0.9, 7).translate(0, -0.1, 0)
        : new THREE.IcosahedronGeometry(2.2, 0);
  instanced(ctx.scene, trunkGeo, mat(C.trunk), trunks);
  // crowns sway in the wind (base of each crown geometry stays put)
  const crownMat =
    kind === 'pine' ? windify(mat(0xffffff), 0.12, -1.4) : kind === 'palm' ? windify(mat(0xffffff), 0.2, -0.6) : windify(mat(0xffffff), 0.07, -2.2);
  instanced(ctx.scene, crownGeo, crownMat, crowns, crownColors);
}

/** Pick random spots inside a circle that pass `ok`. */
export function scatter(
  cx: number,
  cz: number,
  radius: number,
  count: number,
  ok: (x: number, z: number) => boolean,
  size: [number, number] = [0.8, 1.5]
): [number, number, number][] {
  const out: [number, number, number][] = [];
  let tries = 0;
  while (out.length < count && tries++ < count * 30) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * radius;
    const x = cx + Math.cos(a) * r;
    const z = cz + Math.sin(a) * r;
    if (ok(x, z)) out.push([x, z, size[0] + rand() * (size[1] - size[0])]);
  }
  return out;
}

/** Forests, groves, bushes and rocks across open land, away from places, roads and shore. */
export function buildCountryside(ctx: Ctx) {
  const avoid: Place[] = [...Object.values(PLACES).filter((p) => p.id !== 'canyon' && p.id !== 'windfarm'), STUNT_PAD];
  const open = (x: number, z: number, margin: number) =>
    ctx.terrain.sample(x, z) > 2.6 &&
    Math.hypot(x, z) < coastRadius(x, z) - 20 &&
    clearOfRoad(ctx, x, z, margin) &&
    avoid.every((p) => Math.hypot(x - p.x, z - p.z) > p.radius + 6);
  // forests cluster where a low-frequency noise is high; a few lone trees elsewhere
  const forest = (x: number, z: number) => fbm(x / 70 + 40, z / 70 - 12, 3);
  plantTrees(ctx, 'pine', scatter(0, 0, ISLAND_R, 900, (x, z) => open(x, z, 4) && (forest(x, z) > 0.55 || rand() < 0.06), [0.8, 1.7]));
  plantTrees(ctx, 'broadleaf', scatter(0, 0, ISLAND_R, 160, (x, z) => open(x, z, 4) && forest(x, z) < 0.42 && rand() < 0.5, [0.6, 1.1]));

  // bushes (no collision), swaying
  const bushes = scatter(0, 0, ISLAND_R, 900, (x, z) => open(x, z, 1.5), [0.5, 1.3]).map(([x, z, s]) =>
    trs(x, ctx.terrain.sample(x, z) + 0.35 * s, z, rand() * 6, s * 1.3, s * 0.85, s * 1.3)
  );
  const bushColors = bushes.map(() => new THREE.Color().setHSL(0.24 + rand() * 0.08, 0.45, 0.3 + rand() * 0.12));
  instanced(ctx.scene, new THREE.IcosahedronGeometry(1, 0), windify(mat(0xffffff), 0.12, -1), bushes, bushColors);

  // rocks: small ones are decoration, big ones are solid
  const rocks = scatter(0, 0, ISLAND_R, 260, (x, z) => open(x, z, 2), [0.4, 2.2]);
  const rockM = rocks.map(([x, z, r]) => {
    const y = ctx.terrain.sample(x, z);
    if (r > 1.1) {
      const body = new CANNON.Body({ mass: 0, shape: new CANNON.Sphere(r * 0.85) });
      body.position.set(x, y + r * 0.2, z);
      ctx.world.addBody(body);
    }
    return new THREE.Matrix4().compose(
      new THREE.Vector3(x, y + r * 0.2, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rand() * 3, rand() * 3, rand() * 3)),
      new THREE.Vector3(r, r * 0.75, r)
    );
  });
  instanced(ctx.scene, new THREE.DodecahedronGeometry(1, 0), mat(0xb9a899), rockM);
}
