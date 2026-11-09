import * as THREE from 'three';
import { C } from '../palette';
import { PLACES } from '../layout';
import { type Ctx, clearOfRoad, instanced, mat, rand, randRange, staticBox, trs } from '../utils';
import { plantTrees, scatter } from '../world';

const WALLS = [0xfff1dc, 0xf6d7b0, 0xe8d6c0, 0xd9e4d3, 0xf0c9a8, 0xe3d2e6];
const ROOFS = [0xc4553f, 0x8a5a44, 0x2f7d6d, 0x5b6f8a, 0xb86a4a];

/** Cozy houses with pyramid roofs, chimneys, gardens and fences. */
export function buildVillage(ctx: Ctx) {
  const p = PLACES.village;
  const walls: THREE.Matrix4[] = [];
  const wallColors: THREE.Color[] = [];
  const roofs: THREE.Matrix4[] = [];
  const roofColors: THREE.Color[] = [];
  const doors: THREE.Matrix4[] = [];
  const windows: THREE.Matrix4[] = [];
  const chimneys: THREE.Matrix4[] = [];
  const fencePosts: THREE.Matrix4[] = [];
  const fenceRails: THREE.Matrix4[] = [];
  const placed: [number, number][] = [];

  for (let ring = 0; ring < 2; ring++) {
    const r = 14 + ring * 14;
    const count = 7 + ring * 6;
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + ring * 0.4;
      const x = p.x + Math.cos(a) * r + randRange(-2, 2);
      const z = p.z + Math.sin(a) * r + randRange(-2, 2);
      const w = randRange(5.5, 7.5);
      const d = randRange(5, 6.5);
      if (!clearOfRoad(ctx, x, z, Math.max(w, d) / 2 + 2)) continue;
      if (placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < 10)) continue;
      placed.push([x, z]);
      const y = ctx.terrain.sample(x, z);
      // face the village center (doors toward the square)
      const yaw = Math.atan2(p.x - x, p.z - z);
      const hgt = randRange(3.2, 4.2);
      walls.push(trs(x, y + hgt / 2, z, yaw, w, hgt, d));
      wallColors.push(new THREE.Color(WALLS[Math.floor(rand() * WALLS.length)]));
      const roofH = randRange(2.2, 3.2);
      roofs.push(trs(x, y + hgt + roofH / 2, z, yaw + Math.PI / 4, w * 0.78, roofH, d * 0.78));
      roofColors.push(new THREE.Color(ROOFS[Math.floor(rand() * ROOFS.length)]));
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      doors.push(trs(x + fx * (d / 2 + 0.02), y + 1.1, z + fz * (d / 2 + 0.02), yaw, 1.1, 2.2, 0.06));
      for (const s of [-1, 1]) {
        const ox = Math.cos(yaw) * s * w * 0.3;
        const oz = -Math.sin(yaw) * s * w * 0.3;
        windows.push(trs(x + fx * (d / 2 + 0.03) + ox, y + 2.2, z + fz * (d / 2 + 0.03) + oz, yaw, 1, 0.9, 0.06));
      }
      if (rand() < 0.7) chimneys.push(trs(x + Math.cos(yaw) * w * 0.25, y + hgt + roofH * 0.6, z - Math.sin(yaw) * w * 0.25, yaw, 0.6, 1.6, 0.6));
      staticBox(ctx, x, y + hgt / 2, z, w / 2, hgt / 2, d / 2, yaw);

      // little front garden fence
      if (rand() < 0.6) {
        const gx = x + fx * (d / 2 + 3);
        const gz = z + fz * (d / 2 + 3);
        if (clearOfRoad(ctx, gx, gz, 1)) {
          for (let f = -2; f <= 2; f++) {
            const px = gx + Math.cos(yaw) * f * 1.4;
            const pz = gz - Math.sin(yaw) * f * 1.4;
            fencePosts.push(trs(px, y + 0.5, pz, yaw, 0.15, 1, 0.15));
          }
          fenceRails.push(trs(gx, y + 0.75, gz, yaw, 5.8, 0.12, 0.08), trs(gx, y + 0.4, gz, yaw, 5.8, 0.12, 0.08));
        }
      }
    }
  }

  const box = new THREE.BoxGeometry(1, 1, 1);
  const pyramid = new THREE.ConeGeometry(Math.SQRT1_2 * 1.0, 1, 4);
  instanced(ctx.scene, box, mat(0xffffff), walls, wallColors);
  instanced(ctx.scene, pyramid, mat(0xffffff), roofs.map((m) => m.scale(new THREE.Vector3(Math.SQRT2, 1, Math.SQRT2))), roofColors);
  instanced(ctx.scene, box, mat(0x8a5a44), doors, undefined, false);
  instanced(ctx.scene, box, new THREE.MeshStandardMaterial({ color: 0xfff2b0, emissive: 0xffd27a, emissiveIntensity: 0.5 }), windows, undefined, false);
  instanced(ctx.scene, box, mat(0x9a7b63), chimneys);
  instanced(ctx.scene, box, mat(C.cream), fencePosts);
  instanced(ctx.scene, box, mat(C.cream), fenceRails);

  // village green: a big shady tree and a well
  plantTrees(ctx, 'broadleaf', [[p.x + 3, p.z - 3, 1.5]]);
  const well = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.3, 1, 12), mat(0xb3b19c));
  const y = ctx.terrain.sample(p.x - 4, p.z + 4);
  well.position.set(p.x - 4, y + 0.5, p.z + 4);
  well.castShadow = well.receiveShadow = true;
  ctx.scene.add(well);
  staticBox(ctx, p.x - 4, y + 0.5, p.z + 4, 1.2, 0.5, 1.2);

  // orchards around the edge
  plantTrees(ctx, 'broadleaf', scatter(p.x, p.z, p.radius + 30, 26, (x, z) => {
    const d = Math.hypot(x - p.x, z - p.z);
    return d > p.radius + 2 && clearOfRoad(ctx, x, z, 3) && ctx.terrain.sample(x, z) > 2;
  }, [0.55, 0.8]));
}
