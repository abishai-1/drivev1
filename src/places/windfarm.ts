import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { C } from '../palette';
import { LAKES, PLACES } from '../layout';
import { type Ctx, clearOfRoad, instanced, mat, rand, shadowed, trs } from '../utils';
import { wind, windify } from '../wind';
import { scatter } from '../world';

/** Tall turbines on the north-east hills; rotors spin with the wind. */
export function buildWindFarm(ctx: Ctx) {
  const p = PLACES.windfarm;
  const spots = scatter(p.x, p.z, p.radius + 20, 7, (x, z) => clearOfRoad(ctx, x, z, 10) && ctx.terrain.sample(x, z) > 3, [1, 1]);
  const kept: [number, number][] = [];
  for (const [x, z] of spots) {
    if (kept.some(([kx, kz]) => Math.hypot(kx - x, kz - z) < 26)) continue;
    kept.push([x, z]);
    const y = ctx.terrain.sample(x, z) - 0.5;
    const tower = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.55, 1.1, 30, 10), mat(C.cream)));
    tower.position.set(x, y + 15, z);
    const nacelle = shadowed(new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 4), mat(C.cream)));
    nacelle.position.set(x, y + 30.5, z);
    const rotor = new THREE.Group();
    rotor.position.set(x, y + 30.5, z);
    const hub = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.4, 10).rotateX(Math.PI / 2), mat(C.car));
    hub.position.z = 2.6;
    rotor.add(hub);
    for (let k = 0; k < 3; k++) {
      const blade = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.9, 12, 0.18).translate(0, 6, 0), mat(0xffffff)));
      blade.rotation.z = (k * Math.PI * 2) / 3;
      blade.position.z = 2.4;
      rotor.add(blade);
    }
    ctx.scene.add(tower, nacelle, rotor);
    const body = new CANNON.Body({ mass: 0, shape: new CANNON.Cylinder(1, 1, 30, 8) });
    body.position.set(x, y + 15, z);
    ctx.world.addBody(body);
    ctx.updaters.push((_t, dt) => {
      // turbines turn to face into the wind and spin with its strength
      const yaw = Math.atan2(-wind.dir.x, -wind.dir.y);
      nacelle.rotation.y = rotor.rotation.y = THREE.MathUtils.lerp(nacelle.rotation.y, yaw, dt * 0.5);
      rotor.children.forEach((c, i) => {
        if (i > 0) c.rotation.z += dt * (0.3 + wind.strength * 2.2);
      });
    });
  }
}

/** Reeds and lily pads around the lake, plus a small jetty. */
export function buildLake(ctx: Ctx) {
  const reeds: THREE.Matrix4[] = [];
  const pads: THREE.Matrix4[] = [];
  for (const l of LAKES) {
    for (let k = 0; k < 160; k++) {
      const a = rand() * Math.PI * 2;
      const r = l.r + (rand() - 0.3) * 5;
      const x = l.x + Math.cos(a) * r;
      const z = l.z + Math.sin(a) * r;
      const y = ctx.terrain.sample(x, z);
      if (y > 1.8 || y < -1.2) continue;
      reeds.push(trs(x, Math.max(y, -0.3) + 0.9, z, rand() * 6, 0.08, 1.8 + rand(), 0.08));
    }
    for (let k = 0; k < 30; k++) {
      const a = rand() * Math.PI * 2;
      const r = rand() * l.r * 0.8;
      pads.push(trs(l.x + Math.cos(a) * r, 0.05, l.z + Math.sin(a) * r, rand() * 6, 0.6 + rand() * 0.5, 1, 0.6 + rand() * 0.5));
    }
  }
  instanced(ctx.scene, new THREE.CylinderGeometry(1, 1, 1, 4), windify(mat(0x6f8f4a), 0.25, -0.5), reeds, undefined, false);
  instanced(ctx.scene, new THREE.CircleGeometry(1, 8).rotateX(-Math.PI / 2), mat(0x5d9b52), pads, undefined, false);
}
