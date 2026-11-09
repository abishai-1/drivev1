import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { C } from './palette';
import { type Ctx, mat, rand, shadowed, makeLabel, syncObject } from './utils';

export const ISLAND_R = 70;

export function buildIsland({ scene, world }: Ctx) {
  const ground = new THREE.Mesh(new THREE.CircleGeometry(ISLAND_R + 6, 64), mat(C.ground));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const groundBody = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  groundBody.updateAABB(); // cannon-es caches the plane AABB before rotation; without this wheel raycasts miss
  world.addBody(groundBody);

  // Boundary rocks
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    const r = 2 + rand() * 1.4;
    const x = Math.cos(a) * (ISLAND_R - 2);
    const z = Math.sin(a) * (ISLAND_R - 2);
    const rock = shadowed(new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), mat(C.rock)));
    rock.position.set(x, r * 0.5, z);
    rock.rotation.set(rand() * 3, rand() * 3, rand() * 3);
    scene.add(rock);
    const body = new CANNON.Body({ mass: 0, shape: new CANNON.Sphere(r) });
    body.position.set(x, r * 0.5, z);
    world.addBody(body);
  }
}

function addDynamicBox(ctx: Ctx, size: THREE.Vector3, pos: THREE.Vector3, color: number, mass = 3, yaw = 0) {
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
  ctx.dynamic.push({ mesh, body });
}

/** "HELLO" in loose bricks near the spawn point. */
export function buildHelloWall(ctx: Ctx, center = new THREE.Vector3(13, 0, 13)) {
  const font: Record<string, string[]> = {
    H: ['101', '101', '111', '101', '101'],
    E: ['111', '100', '111', '100', '111'],
    L: ['100', '100', '100', '100', '111'],
    O: ['111', '101', '101', '101', '111'],
  };
  const word = 'HELLO';
  const B = 0.7; // brick size
  const along = new THREE.Vector3(-1, 0, 1).normalize(); // reads left-to-right from the camera
  const letterW = 4 * B;
  const start = center.clone().addScaledVector(along, -(word.length * letterW) / 2);
  [...word].forEach((ch, li) => {
    font[ch].forEach((row, ri) => {
      [...row].forEach((bit, ci) => {
        if (bit !== '1') return;
        const p = start.clone().addScaledVector(along, li * letterW + ci * B);
        p.y = (4 - ri) * B + B / 2;
        addDynamicBox(ctx, new THREE.Vector3(B, B, B), p, li % 2 ? C.car : C.leaf, 1.5, Math.PI / 4);
      });
    });
  });
}

/** Ramp + crate pyramid, and a set of bowling pins. */
export function buildPlayground(ctx: Ctx) {
  const { scene, world, dynamic } = ctx;

  const ramp = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(3, 0.25, 4.5)) });
  ramp.position.set(0, 0.9, 30);
  ramp.quaternion.setFromEuler(-0.24, 0, 0);
  world.addBody(ramp);
  const rampMesh = shadowed(new THREE.Mesh(new THREE.BoxGeometry(6, 0.5, 9), mat(C.cream)));
  syncObject(rampMesh, ramp.position, ramp.quaternion);
  scene.add(rampMesh);
  const rampLabel = makeLabel('Send it!', '#2f7d6d');
  rampLabel.position.set(0, 4.5, 30);
  scene.add(rampLabel);

  for (let layer = 0; layer < 4; layer++) {
    for (let i = 0; i < 4 - layer; i++) {
      const x = (i - (3 - layer) / 2) * 1.05;
      addDynamicBox(ctx, new THREE.Vector3(1, 1, 1), new THREE.Vector3(x, 0.5 + layer, 44), C.crate, 2);
    }
  }

  const pinGeo = new THREE.CylinderGeometry(0.22, 0.32, 1.3, 10);
  const origin = new THREE.Vector3(-34, 0, 26);
  for (let row = 0; row < 4; row++) {
    for (let i = 0; i <= row; i++) {
      const mesh = shadowed(new THREE.Mesh(pinGeo, mat(C.pin)));
      scene.add(mesh);
      const body = new CANNON.Body({ mass: 1, shape: new CANNON.Cylinder(0.22, 0.32, 1.3, 10) });
      body.position.set(origin.x + (i - row / 2) * 1.1, 0.65, origin.z + row);
      body.sleep();
      world.addBody(body);
      dynamic.push({ mesh, body });
    }
  }
  const pinLabel = makeLabel('Strike?', '#2f7d6d');
  pinLabel.position.set(origin.x, 4, origin.z + 1.5);
  scene.add(pinLabel);
}

function addTree({ scene, world }: Ctx, x: number, z: number) {
  const s = 0.8 + rand() * 0.7;
  const trunk = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.25 * s, 0.35 * s, 1.6 * s, 6), mat(C.trunk)));
  trunk.position.set(x, 0.8 * s, z);
  const crown = shadowed(
    new THREE.Mesh(new THREE.ConeGeometry(1.4 * s, 2.8 * s, 7), mat(rand() > 0.5 ? C.leaf : C.leafDark))
  );
  crown.position.set(x, 2.8 * s, z);
  crown.rotation.y = rand() * Math.PI;
  scene.add(trunk, crown);
  const body = new CANNON.Body({ mass: 0, shape: new CANNON.Cylinder(0.35 * s, 0.35 * s, 3, 8) });
  body.position.set(x, 1.5, z);
  world.addBody(body);
}

/** Scatter trees, keeping clear of the given spots and the lane to the ramp. */
export function buildTrees(ctx: Ctx, keepClear: THREE.Vector3[], count = 70) {
  let placed = 0;
  while (placed < count) {
    const a = rand() * Math.PI * 2;
    const r = 8 + rand() * (ISLAND_R - 14);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (keepClear.some((p) => Math.hypot(p.x - x, p.z - z) < 10)) continue;
    if (Math.abs(x) < 5 && z > 0 && z < 50) continue;
    addTree(ctx, x, z);
    placed++;
  }
}
