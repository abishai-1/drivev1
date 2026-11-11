// A few little cars cruising the country roads. They follow the road splines in their own lane, slow down
// for you, and turn around at the end of the road. Kinematic bodies: you can bump them, they don't flip.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import type { Path } from './paths';
import { type Ctx, mat, rand, shadowed } from './utils';
import { glow } from './sky';

const COLORS = [0x59c3e8, 0xf2b134, 0x7a4fd1, 0xfff7ec, 0x4fa88f, 0xe8604c, 0xd9a0c8];
const LANE = 2.2;
const CRUISE = 13; // m/s

function carMesh(color: number) {
  const g = new THREE.Group();
  const body = shadowed(new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, 3.4), mat(color)));
  body.position.y = 0.55;
  const cabin = shadowed(new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.55, 1.7), mat(0xfff7ec)));
  cabin.position.set(0, 1.1, -0.2);
  g.add(body, cabin);
  const tyre = mat(0x3b2a3f);
  const wheel = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 12).rotateZ(Math.PI / 2);
  for (const [x, z] of [[0.82, 1.1], [-0.82, 1.1], [0.82, -1.1], [-0.82, -1.1]]) {
    const w = new THREE.Mesh(wheel, tyre);
    w.position.set(x, 0.36, z);
    g.add(w);
  }
  const lights = glow(new THREE.MeshStandardMaterial({ color: 0xfff2b0, emissive: 0xffe27a, emissiveIntensity: 0.3 }), 0xfff0c0, 0.3, 2.2);
  for (const x of [-0.55, 0.55]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.14, 0.05), lights);
    l.position.set(x, 0.6, 1.71);
    g.add(l);
  }
  return g;
}

export function createTraffic(ctx: Ctx, count = 12) {
  const roads = ctx.net.roads.filter((r) => r.kind === 'road' && r.length > 120);
  const sample = (road: Path, s: number, out: THREE.Vector3, tan: THREE.Vector3) => {
    const n = road.points.length;
    const f = THREE.MathUtils.clamp(s / road.length, 0, 1) * (n - 1);
    const i = Math.min(Math.floor(f), n - 2);
    const u = f - i;
    out.lerpVectors(road.points[i], road.points[i + 1], u);
    tan.lerpVectors(road.tangents[i], road.tangents[i + 1], u).normalize();
  };

  const cars = Array.from({ length: count }, (_, k) => {
    const road = roads[k % roads.length];
    const mesh = carMesh(COLORS[k % COLORS.length]);
    ctx.scene.add(mesh);
    const body = new CANNON.Body({ type: CANNON.Body.KINEMATIC, mass: 0, shape: new CANNON.Box(new CANNON.Vec3(0.85, 0.6, 1.7)) });
    ctx.world.addBody(body);
    return { road, s: rand() * road.length, dir: rand() < 0.5 ? 1 : -1, speed: CRUISE * (0.8 + rand() * 0.4), mesh, body, v: 0 };
  });

  const p = new THREE.Vector3();
  const t = new THREE.Vector3();
  const prev = new THREE.Vector3();
  return {
    update(dt: number, player: THREE.Vector3) {
      if (dt <= 0) return;
      for (const c of cars) {
        // brake for the player if they're just ahead in our lane
        sample(c.road, c.s, p, t);
        const fx = t.x * c.dir;
        const fz = t.z * c.dir;
        const dx = player.x - p.x;
        const dz = player.z - p.z;
        const along = dx * fx + dz * fz;
        const side = Math.abs(dx * -fz + dz * fx - LANE);
        const blocked = along > 0 && along < 14 && side < 3 && Math.abs(player.y - p.y) < 3;
        const want = blocked ? 0 : c.speed;
        c.v += (want - c.v) * (1 - Math.exp(-(blocked ? 4 : 1) * dt));
        c.s += c.v * c.dir * dt;
        if (c.s < 4 || c.s > c.road.length - 4) {
          c.dir = -c.dir; // U-turn at the end of the road
          c.s = THREE.MathUtils.clamp(c.s, 4, c.road.length - 4);
        }
        sample(c.road, c.s, p, t);
        // keep right: lane offset to the right of the driving direction
        const rx = -t.z * c.dir;
        const rz = t.x * c.dir;
        const x = p.x + rx * LANE;
        const z = p.z + rz * LANE;
        const y = p.y + 0.05;
        const yaw = Math.atan2(t.x * c.dir, t.z * c.dir);
        prev.copy(c.mesh.position);
        c.mesh.position.set(x, y, z);
        c.mesh.rotation.y = yaw;
        c.body.position.set(x, y + 0.6, z);
        c.body.velocity.set((x - prev.x) / dt, (y - prev.y) / dt, (z - prev.z) / dt);
        if (c.body.velocity.length() > 40) c.body.velocity.setZero(); // after a U-turn jump
        c.body.quaternion.setFromEuler(0, yaw, 0);
        c.body.aabbNeedsUpdate = true;
      }
    },
  };
}
