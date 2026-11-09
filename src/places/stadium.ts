import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { C } from '../palette';
import { PLACES } from '../layout';
import { type Ctx, clearOfRoad, instanced, mat, shadowed, staticBox, trs } from '../utils';

export const PODIUM_OFFSET: [number, number] = [-14, 16]; // clear of the road from Home (enters from the west)

export function buildStadium(ctx: Ctx) {
  const p = PLACES.stadium;
  const y = ctx.terrain.sample(p.x, p.z);
  const A = 30; // semi-axis x
  const B = 46; // semi-axis z (the track runs along z through the middle)

  // stepped stands around an ellipse, with gaps where the track enters
  const seats: THREE.Matrix4[] = [];
  const colors: THREE.Color[] = [];
  const palette = [0xe8604c, 0xfff7ec, 0x4fa88f];
  const SEGMENTS = 56;
  for (let s = 0; s < SEGMENTS; s++) {
    const a = (s / SEGMENTS) * Math.PI * 2;
    for (let tier = 0; tier < 4; tier++) {
      const k = 1 + tier * 0.07;
      const x = p.x + Math.cos(a) * A * k;
      const z = p.z + Math.sin(a) * B * k;
      if (!clearOfRoad(ctx, x, z, 6)) continue;
      // align the box's local x with the ellipse tangent (-A sin a, B cos a); yaw maps x → (cos, -sin)
      const yaw = Math.atan2(-Math.cos(a) * B, -Math.sin(a) * A);
      const h = 1.2 + tier * 1.4;
      const len = ((Math.PI * 2 * Math.hypot(A, B)) / Math.SQRT2 / SEGMENTS) * k + 0.4;
      seats.push(trs(x, y + h / 2, z, yaw, len, h, 2.2));
      colors.push(new THREE.Color(palette[(s + tier) % 3]));
      if (tier === 3) staticBox(ctx, x, y + 3, z, len / 2, 3, 4.5, yaw);
    }
  }
  instanced(ctx.scene, new THREE.BoxGeometry(1, 1, 1), mat(0xffffff), seats, colors);

  // floodlights
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const x = p.x + sx * A * 1.35;
    const z = p.z + sz * B * 0.8;
    const pole = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 18, 8), mat(C.carDark)));
    pole.position.set(x, y + 9, z);
    const lamp = new THREE.Mesh(
      new THREE.BoxGeometry(3.5, 2, 0.8),
      new THREE.MeshStandardMaterial({ color: 0xfff2b0, emissive: 0xffe27a, emissiveIntensity: 1 })
    );
    lamp.position.set(x, y + 18.5, z);
    lamp.lookAt(p.x, y, p.z);
    ctx.scene.add(pole, lamp);
    staticBox(ctx, x, y + 9, z, 0.5, 9, 0.5);
  }

  // podium (Achievements)
  const px = p.x + PODIUM_OFFSET[0];
  const pz = p.z + PODIUM_OFFSET[1];
  const tiers: [number, number, number][] = [[0, 2.2, C.gold], [0, 1.5, 0xc9ccd6], [0, 1, 0xd08a55]];
  const offsets = [0, -3.2, 3.2];
  tiers.forEach(([, h, color], i) => {
    const block = shadowed(new THREE.Mesh(new THREE.BoxGeometry(3, h, 3), mat(color)));
    block.position.set(px, y + h / 2, pz + offsets[i]);
    ctx.scene.add(block);
    staticBox(ctx, px, y + h / 2, pz + offsets[i], 1.5, h / 2, 1.5);
  });
  const trophy = new THREE.Group();
  const cup = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.35, 1.4, 16), new THREE.MeshStandardMaterial({ color: C.gold, metalness: 0.8, roughness: 0.25 })));
  cup.position.y = 1.3;
  const stem = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.6, 8), cup.material));
  stem.position.y = 0.3;
  const base = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 0.9), mat(C.carDark)));
  trophy.add(base, stem, cup);
  trophy.position.set(px, y + 2.2, pz);
  ctx.scene.add(trophy);
  ctx.updaters.push((t) => (trophy.rotation.y = t * 0.8));

  // a ball to push around the infield
  const ball = shadowed(new THREE.Mesh(new THREE.IcosahedronGeometry(1.2, 1), mat(C.cream)));
  const body = new CANNON.Body({ mass: 2, shape: new CANNON.Sphere(1.2), linearDamping: 0.3, angularDamping: 0.3 });
  body.position.set(p.x + 14, y + 1.3, p.z + 14);
  ctx.world.addBody(body);
  ctx.scene.add(ball);
  ctx.dynamic.push({ mesh: ball, body });
}
