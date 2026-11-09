import * as THREE from 'three';
import { PLACES, STUNT_PAD } from '../layout';
import { type Ctx, clearOfRoad, instanced, mat, rand, shadowed, staticBox, trs } from '../utils';
import { addDynamicBox, plantTrees, scatter } from '../world';

export function buildJungle(ctx: Ctx) {
  const p = PLACES.jungle;
  const studio = PLACES.studio;
  const temple: [number, number] = [p.x + 15, p.z - 20]; // clear of the jungle river
  const ok = (x: number, z: number, margin: number) =>
    ctx.terrain.sample(x, z) > 1.4 &&
    clearOfRoad(ctx, x, z, margin) &&
    Math.hypot(x - studio.x, z - studio.z) > studio.radius + 4 &&
    Math.hypot(x - STUNT_PAD.x, z - STUNT_PAD.z) > STUNT_PAD.radius + 6 &&
    Math.hypot(x - temple[0], z - temple[1]) > 16;

  // dense canopy: broadleaf giants + pines at the edges
  plantTrees(ctx, 'broadleaf', scatter(p.x, p.z, p.radius, 260, (x, z) => ok(x, z, 2.5), [0.9, 1.6]));
  plantTrees(ctx, 'pine', scatter(p.x, p.z, p.radius + 20, 60, (x, z) => ok(x, z, 3), [1, 1.6]));

  // undergrowth (no collision)
  const bushes = scatter(p.x, p.z, p.radius, 220, (x, z) => ok(x, z, 0.5), [0.5, 1.2]).map(([x, z, s]) =>
    trs(x, ctx.terrain.sample(x, z) + 0.4 * s, z, rand() * 6, s * 1.4, s * 0.9, s * 1.4)
  );
  const colors = bushes.map(() => new THREE.Color().setHSL(0.3 + rand() * 0.06, 0.45, 0.28 + rand() * 0.1));
  instanced(ctx.scene, new THREE.IcosahedronGeometry(1, 0), mat(0xffffff), bushes, colors, false);

  // stepped temple ruin you can drive up
  const [tx, tz] = temple;
  const ty = ctx.terrain.sample(tx, tz);
  const stone = mat(0x9c9a86);
  for (let i = 0; i < 4; i++) {
    const s = 14 - i * 3;
    const block = shadowed(new THREE.Mesh(new THREE.BoxGeometry(s, 1.2, s), stone));
    block.position.set(tx, ty + 0.6 + i * 1.2, tz);
    ctx.scene.add(block);
    staticBox(ctx, tx, ty + 0.6 + i * 1.2, tz, s / 2, 0.6, s / 2);
  }
  // loose pillars to knock over
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const x = tx + Math.cos(a) * 11;
    const z = tz + Math.sin(a) * 11;
    addDynamicBox(ctx, new THREE.Vector3(1, 3.2, 1), new THREE.Vector3(x, ctx.terrain.sample(x, z) + 1.6, z), 0xb3b19c, 2, a);
  }
}
