import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { C } from '../palette';
import { FARM_FIELDS, PLACES } from '../layout';
import { type Ctx, clearOfRoad, clearSpot, instanced, mat, rand, shadowed, staticBox, syncObject, trs } from '../utils';
import { windify, wind } from '../wind';

/** Barn, silo, windmill, crop fields with fences, and hay bales to knock around. */
export function buildFarm(ctx: Ctx) {
  const p = PLACES.farm;

  // crop fields: rows of wheat / cabbages that sway
  const wheat: THREE.Matrix4[] = [];
  const cabbage: THREE.Matrix4[] = [];
  const posts: THREE.Matrix4[] = [];
  const rails: THREE.Matrix4[] = [];
  const ground = (x: number, z: number) => ctx.terrain.sample(x, z);
  FARM_FIELDS.forEach(([cx, cz, hx, hz], f) => {
    for (let x = -hx + 0.8; x <= hx - 0.8; x += 1.6) {
      for (let z = -hz + 0.6; z <= hz - 0.6; z += 0.9) {
        const px = cx + x;
        const pz = cz + z;
        if (!clearOfRoad(ctx, px, pz, 0.8)) continue; // no crops on the farm roads
        const y = ground(px, pz); // follow the ground under every plant
        if (f === 1) cabbage.push(trs(px, y + 0.3, pz, rand() * 6, 0.5, 0.45, 0.5));
        else wheat.push(trs(px + (rand() - 0.5) * 0.3, y + 0.55, pz, rand() * 6, 0.22, 1.1, 0.22));
      }
    }
    // fence around the field
    const corners: [number, number][] = [[-hx - 1, -hz - 1], [hx + 1, -hz - 1], [hx + 1, hz + 1], [-hx - 1, hz + 1]];
    corners.forEach(([ax, az], k) => {
      const [bx, bz] = corners[(k + 1) % 4];
      const len = Math.hypot(bx - ax, bz - az);
      const yaw = Math.atan2(bz - az, bx - ax) * -1;
      for (let s = 0; s <= len; s += 2.5) {
        const px = cx + ax + ((bx - ax) * s) / len;
        const pz = cz + az + ((bz - az) * s) / len;
        if (!clearOfRoad(ctx, px, pz, 0.5)) continue;
        const y = ground(px, pz);
        posts.push(trs(px, y + 0.55, pz, 0, 0.14, 1.1, 0.14));
        const rx = px + ((bx - ax) / len) * 1.25;
        const rz = pz + ((bz - az) / len) * 1.25;
        if (clearOfRoad(ctx, rx, rz, 0.5)) rails.push(trs(rx, (y + ground(rx, rz)) / 2 + 0.8, rz, yaw, 2.5, 0.1, 0.08));
      }
    });
  });
  instanced(ctx.scene, new THREE.ConeGeometry(1, 1, 5).translate(0, 0, 0), windify(mat(0xe6c25a), 0.35, -0.5), wheat);
  instanced(ctx.scene, new THREE.IcosahedronGeometry(1, 0), mat(0x7fb25a), cabbage);
  const box = new THREE.BoxGeometry(1, 1, 1);
  instanced(ctx.scene, box, mat(0xd8c9b4), posts);
  instanced(ctx.scene, box, mat(0xd8c9b4), rails);

  // barn with a gable roof (triangular prism)
  const [bx, bz] = clearSpot(ctx, p.x + 18, p.z + 14, 9);
  const by = ctx.terrain.sample(bx, bz);
  const barn = new THREE.Group();
  barn.position.set(bx, by, bz);
  barn.rotation.y = 0.3;
  const body = shadowed(new THREE.Mesh(new THREE.BoxGeometry(12, 6, 9), mat(0xc4553f)));
  body.position.y = 3;
  const roof = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(5.6, 5.6, 12.4, 3, 1).rotateZ(Math.PI / 2), mat(0x8a5a44)));
  roof.scale.set(1, 0.55, 1);
  roof.position.y = 7.4;
  const doors = new THREE.Mesh(new THREE.BoxGeometry(0.1, 4, 4), mat(C.cream));
  doors.position.set(6.05, 2, 0);
  const cross = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.4, 5.4), mat(0xc4553f));
  cross.position.set(6.1, 2, 0);
  cross.rotation.x = 0.75;
  barn.add(body, roof, doors, cross);
  ctx.scene.add(barn);
  staticBox(ctx, bx, by + 4, bz, 6, 4, 4.5, 0.3);

  // silo
  const [sx, sz] = clearSpot(ctx, bx - 3, bz - 10, 3.5);
  const silo = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 11, 16), mat(0xd9e4d3)));
  silo.position.set(sx, by + 5.5, sz);
  const dome = shadowed(new THREE.Mesh(new THREE.SphereGeometry(2.4, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x5b6f8a)));
  dome.position.set(sx, by + 11, sz);
  ctx.scene.add(silo, dome);
  const sb = new CANNON.Body({ mass: 0, shape: new CANNON.Cylinder(2.4, 2.4, 11, 12) });
  sb.position.set(sx, by + 5.5, sz);
  ctx.world.addBody(sb);

  // windmill (blades turn with the wind)
  const [wx, wz] = clearSpot(ctx, p.x - 22, p.z + 22, 4);
  const wy = ctx.terrain.sample(wx, wz);
  const tower = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(1.8, 3.2, 12, 8), mat(C.cream)));
  tower.position.set(wx, wy + 6, wz);
  const cap = shadowed(new THREE.Mesh(new THREE.ConeGeometry(2.4, 2.6, 8), mat(0xc4553f)));
  cap.position.set(wx, wy + 13.3, wz);
  const rotor = new THREE.Group();
  rotor.position.set(wx, wy + 11.5, wz + 2.2);
  for (let k = 0; k < 4; k++) {
    const arm = new THREE.Group();
    arm.rotation.z = (k * Math.PI) / 2;
    const sail = shadowed(new THREE.Mesh(new THREE.BoxGeometry(1.6, 7, 0.1), mat(0xfff7ec)));
    sail.position.y = 4;
    const spar = new THREE.Mesh(new THREE.BoxGeometry(0.25, 8, 0.25), mat(0x8a5a44));
    spar.position.y = 4;
    arm.add(sail, spar);
    rotor.add(arm);
  }
  ctx.scene.add(tower, cap, rotor);
  staticBox(ctx, wx, wy + 6, wz, 2.4, 6, 2.4);
  ctx.updaters.push((_t, dt) => (rotor.rotation.z += dt * (0.4 + wind.strength * 1.6)));

  // hay bales — dynamic, roll them around
  const baleGeo = new THREE.CylinderGeometry(0.9, 0.9, 1.4, 14); // same axis as the body's cylinder; the body is tipped on its side
  const [baleX, baleZ] = clearSpot(ctx, p.x + 6, p.z - 6, 5);
  for (let i = 0; i < 9; i++) {
    const x = baleX + (i % 3) * 2;
    const z = baleZ + Math.floor(i / 3) * 2.2;
    const y = ctx.terrain.sample(x, z);
    const mesh = shadowed(new THREE.Mesh(baleGeo, mat(0xe6c25a)));
    ctx.scene.add(mesh);
    const b = new CANNON.Body({ mass: 3, shape: new CANNON.Cylinder(0.9, 0.9, 1.4, 10), sleepSpeedLimit: 0.2 });
    b.quaternion.setFromEuler(0, 0, Math.PI / 2);
    b.position.set(x, y + 0.9, z);
    b.sleep();
    ctx.world.addBody(b);
    syncObject(mesh, b.position, b.quaternion);
    ctx.dynamic.push({ mesh, body: b });
  }
}
