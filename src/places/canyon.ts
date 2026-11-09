import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PLACES, STUNT_PAD } from '../layout';
import { type Ctx, clearOfRoad, instanced, makeLabel, mat, rand, staticBox } from '../utils';
import { bowlingPins, crateStack, ramp, scatter } from '../world';

export function buildCanyon(ctx: Ctx) {
  const p = PLACES.canyon;
  const s = STUNT_PAD;
  const y = ctx.terrain.sample(s.x, s.z);

  // boulders on the ridges
  const rocks = scatter(p.x, p.z, p.radius + 20, 70, (x, z) => {
    const h = ctx.terrain.sample(x, z);
    return h > 5 && clearOfRoad(ctx, x, z, 4) && Math.hypot(x - s.x, z - s.z) > s.radius;
  }, [1.2, 3.2]);
  const matrices = rocks.map(([x, z, r]) => {
    const h = ctx.terrain.sample(x, z);
    const body = new CANNON.Body({ mass: 0, shape: new CANNON.Sphere(r * 0.9) });
    body.position.set(x, h + r * 0.3, z);
    ctx.world.addBody(body);
    return new THREE.Matrix4().compose(
      new THREE.Vector3(x, h + r * 0.3, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rand() * 3, rand() * 3, rand() * 3)),
      new THREE.Vector3(r, r * 0.8, r)
    );
  });
  instanced(ctx.scene, new THREE.DodecahedronGeometry(1, 0), mat(0xb5603f), matrices);

  // stunt park
  const label = makeLabel('Stunt Park', '#2f7d6d', 1.4);
  label.position.set(s.x, y + 9, s.z);
  ctx.scene.add(label);
  ramp(ctx, s.x - 10, s.z - 12, 0, 6, 9, 0.26); // kicker heading south
  ramp(ctx, s.x + 8, s.z - 14, 0, 5, 6, 0.42, 0xe8604c); // steep launcher
  ramp(ctx, s.x - 14, s.z + 8, Math.PI / 2, 6, 10, 0.2); // heading east
  // two quarter pipes facing each other = a half-pipe across the east side of the pad
  quarterPipe(ctx, s.x + 12, s.z + 9, 0, 10, y);
  quarterPipe(ctx, s.x + 12, s.z - 9, Math.PI, 10, y);
  crateStack(ctx, s.x - 10, s.z + 2);
  bowlingPins(ctx, s.x + 2, s.z + 10);
}

/** Curved wall rising toward local +z, built from short tilted slabs along a circular arc. */
function quarterPipe(ctx: Ctx, x: number, z: number, yaw: number, width: number, y: number) {
  const R = 6;
  const SEGS = 7;
  const MAX = (80 * Math.PI) / 180;
  const material = mat(0xd8c9b4);
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  for (let k = 0; k < SEGS; k++) {
    const a = ((k + 0.5) / SEGS) * MAX;
    const len = (R * MAX) / SEGS + 0.15;
    const along = R * Math.sin(a);
    const up = R * (1 - Math.cos(a));
    const cx = x + fx * along;
    const cz = z + fz * along;
    const body = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(width / 2, 0.2, len / 2)) });
    body.position.set(cx, y + up, cz);
    body.quaternion.setFromEuler(-a, yaw, 0, 'YXZ');
    ctx.world.addBody(body);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, 0.4, len), material);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.position.set(cx, y + up, cz);
    mesh.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
    ctx.scene.add(mesh);
  }
  staticBox(ctx, x + fx * (R + 0.5), y + R / 2, z + fz * (R + 0.5), width / 2, R / 2, 0.3, yaw); // back wall
}
