import * as THREE from 'three';
import { PLACES } from '../layout';
import { glow } from '../sky';
import { type Ctx, clearOfRoad, instanced, makeLabel, mat, rand, randRange, staticBox, trs } from '../utils';

const TOWER_COLORS = [0xe8d6c0, 0xd9b8a0, 0xc7c2d6, 0xb8d0c8, 0xf0c9a8, 0x9fb3c8, 0xe6e0d4];
/** Your projects get the landmark towers. */
const LANDMARKS = ['Multioks', 'Ilish 3D', 'Forge Founder'];

export const WORK_ZONE_OFFSET: [number, number] = [0, 32]; // plaza south of the avenue

export function buildCity(ctx: Ctx) {
  const p = PLACES.city;
  const BLOCK = 30;
  const matrices: THREE.Matrix4[] = [];
  const colors: THREE.Color[] = [];
  const roofs: THREE.Matrix4[] = [];
  const windows: THREE.Matrix4[] = [];
  const zoneX = p.x + WORK_ZONE_OFFSET[0];
  const zoneZ = p.z + WORK_ZONE_OFFSET[1];
  let landmark = 0;

  // Lots: a 2x2 grid inside every block between the streets (lines at ±15, ±45), plus a ring of buildings
  // just outside the grid. Closest to downtown first, so the landmark towers land in the middle.
  const lots: [number, number][] = [];
  for (const bx of [-30, 0, 30]) for (const bz of [-30, 0, 30]) for (const ox of [-4.6, 4.6]) for (const oz of [-4.6, 4.6]) lots.push([p.x + bx + ox, p.z + bz + oz]);
  for (let s = -40; s <= 40; s += 11) {
    lots.push([p.x + s, p.z - 57], [p.x + s, p.z + 57], [p.x - 57, p.z + s], [p.x + 57, p.z + s]);
  }
  lots.sort((a, b) => Math.hypot(a[0] - p.x, a[1] - p.z) - Math.hypot(b[0] - p.x, b[1] - p.z));

  for (const [x, z] of lots) {
    {
      if (Math.hypot(x - p.x, z - p.z) > p.radius + 4) continue;
      const w = randRange(7, 8.4);
      const d = randRange(7, 8.4);
      // clear of the road edge by half the building plus the 1.8 m sidewalk
      if (!clearOfRoad(ctx, x, z, Math.max(w, d) / 2 + 2)) continue;
      if (Math.hypot(x - zoneX, z - zoneZ) < 13) continue;
      const isLandmark = landmark < LANDMARKS.length && Math.abs(z - p.z) <= BLOCK + 10;
      const h = isLandmark ? 42 - landmark * 5 : randRange(8, 30);
      const y = ctx.terrain.sample(x, z);
      matrices.push(trs(x, y + h / 2, z, 0, w, h, d));
      colors.push(new THREE.Color(TOWER_COLORS[Math.floor(rand() * TOWER_COLORS.length)]));
      roofs.push(trs(x, y + h + 0.3, z, 0, w + 0.6, 0.6, d + 0.6));
      // window bands on the two faces the camera sees most
      for (let fy = 3; fy < h - 1; fy += 3.2) {
        windows.push(trs(x, y + fy, z + d / 2 + 0.03, 0, w * 0.8, 1.1, 0.05));
        windows.push(trs(x - w / 2 - 0.03, y + fy, z, Math.PI / 2, d * 0.8, 1.1, 0.05));
      }
      staticBox(ctx, x, y + h / 2, z, w / 2, h / 2, d / 2);
      if (isLandmark) {
        const label = makeLabel(LANDMARKS[landmark], '#2f7d6d', 1.6);
        label.position.set(x, y + h + 3.5, z);
        ctx.scene.add(label);
        landmark++;
      }
    }
  }

  const box = new THREE.BoxGeometry(1, 1, 1);
  instanced(ctx.scene, box, mat(0xffffff), matrices, colors);
  instanced(ctx.scene, box, mat(0x8a7f8f), roofs);
  instanced(
    ctx.scene,
    box,
    // windows light up warm after dark
    glow(new THREE.MeshStandardMaterial({ color: 0x5b6f8a, emissive: 0x2b3a52, roughness: 0.3, metalness: 0.2 }), 0xffc56b, 1, 1.3),
    windows,
    undefined,
    false
  );

  // parked cars along the streets (static), for a lived-in look; lamps come from roads.ts
  const cars: THREE.Matrix4[] = [];
  const carColors: THREE.Color[] = [];
  for (const road of ctx.net.roads) {
    if (road.kind !== 'street') continue;
    for (let i = 3; i < road.points.length - 3; i += 7) {
      if (rand() < 0.45) continue;
      const q = road.points[i];
      const t = road.tangents[i];
      const side = rand() < 0.5 ? -1 : 1;
      const x = q.x - t.z * side * (road.halfWidth + 3.2);
      const z = q.z + t.x * side * (road.halfWidth + 3.2);
      if (!clearOfRoad(ctx, x, z, 1)) continue;
      const y = ctx.terrain.sample(x, z);
      const yaw = Math.atan2(t.x, t.z);
      cars.push(trs(x, y + 0.7, z, yaw, 1.8, 1.1, 3.8));
      carColors.push(new THREE.Color(TOWER_COLORS[Math.floor(rand() * TOWER_COLORS.length)]).multiplyScalar(0.8));
      staticBox(ctx, x, y + 0.7, z, 0.9, 0.55, 1.9, yaw);
    }
  }
  instanced(ctx.scene, box, mat(0xffffff), cars, carColors);
}
