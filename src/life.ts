// Ambient life: flocks of birds circling, sailboats offshore, and a little plane flying over now and then.
import * as THREE from 'three';
import { ISLAND_R, PLACES, WATER_Y } from './layout';
import { type Ctx, mat, rand, shadowed } from './utils';
import { glow } from './sky';

export function createLife(ctx: Ctx) {
  const { scene } = ctx;

  // ---- birds: a two-triangle "V" whose wings flap ----
  const wing = new THREE.BufferGeometry();
  wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.25, 0, 0, -0.25, 1, 0, 0], 3));
  wing.computeVertexNormals();
  const flocks = [
    { c: PLACES.lake, r: 26, h: 26 },
    { c: PLACES.beach, r: 40, h: 30 },
    { c: PLACES.jungle, r: 60, h: 34 },
    { c: PLACES.farm, r: 35, h: 24 },
  ];
  const PER = 9;
  const birdMat = new THREE.MeshBasicMaterial({ color: 0x3b2a3f, side: THREE.DoubleSide, fog: true });
  const birds = new THREE.InstancedMesh(wing, birdMat, flocks.length * PER * 2);
  birds.frustumCulled = false;
  scene.add(birds);
  const seeds = Array.from({ length: flocks.length * PER }, () => [rand() * 6.28, rand(), rand()]);

  // ---- sailboats circling offshore ----
  const boats = Array.from({ length: 4 }, (_, i) => {
    const g = new THREE.Group();
    const hull = shadowed(new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.8, 6).translate(0, 0.2, 0), mat(i % 2 ? 0xe8604c : 0xfff7ec)));
    const mast = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 6), mat(0x8a5a44)));
    mast.position.set(0, 3.4, 0.4);
    const sailGeo = new THREE.BufferGeometry();
    sailGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.8, 0.5, 0, 6.2, 0.5, 0, 0.8, -2.6], 3));
    sailGeo.computeVertexNormals();
    const sail = new THREE.Mesh(sailGeo, new THREE.MeshToonMaterial({ color: 0xfff7ec, side: THREE.DoubleSide }));
    sail.castShadow = true;
    g.add(hull, mast, sail);
    scene.add(g);
    return { g, a: (i / 4) * Math.PI * 2, r: ISLAND_R + 60 + i * 12, speed: 0.012 + rand() * 0.008 };
  });

  // ---- a little plane on a long straight pass every so often ----
  const plane = new THREE.Group();
  const fus = shadowed(new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 7), mat(0xfff7ec)));
  const wings = shadowed(new THREE.Mesh(new THREE.BoxGeometry(11, 0.25, 1.8), mat(0xe8604c)));
  wings.position.z = 0.6;
  const tail = shadowed(new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.2, 1), mat(0xe8604c)));
  tail.position.set(0, 0.3, -3.1);
  const fin = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.6, 1.2), mat(0xe8604c)));
  fin.position.set(0, 1, -3.1);
  const blink = glow(new THREE.MeshStandardMaterial({ color: 0xff6b5a, emissive: 0xff3b2a, emissiveIntensity: 0.5 }), 0xff3b2a, 0.5, 3);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), blink);
  beacon.position.set(0, 0.8, 0);
  plane.add(fus, wings, tail, fin, beacon);
  plane.visible = false;
  scene.add(plane);
  let pass = { t: -20, from: new THREE.Vector3(), dir: new THREE.Vector3(), len: 1 };
  const startPass = () => {
    const a = rand() * Math.PI * 2;
    const R = ISLAND_R + 150;
    const from = new THREE.Vector3(Math.cos(a) * R, 150 + rand() * 40, Math.sin(a) * R);
    const to = new THREE.Vector3(-Math.cos(a + 0.5) * R, from.y, -Math.sin(a + 0.5) * R);
    const dir = to.clone().sub(from);
    pass = { t: 0, from, dir: dir.clone().normalize(), len: dir.length() };
    plane.visible = true;
  };

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const pos = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);

  return {
    update(t: number, dt: number) {
      // birds
      let k = 0;
      flocks.forEach((f, fi) => {
        for (let b = 0; b < PER; b++) {
          const [ph, rr, hh] = seeds[fi * PER + b];
          const a = t * (0.25 + rr * 0.08) + ph * 0.25 + fi;
          const radius = f.r * (0.75 + rr * 0.5);
          pos.set(f.c.x + Math.cos(a) * radius, ctx.terrain.sample(f.c.x, f.c.z) + f.h + hh * 8 + Math.sin(t * 0.7 + ph) * 2, f.c.z + Math.sin(a) * radius);
          const yaw = -a; // tangent to the circle
          const flap = Math.sin(t * 9 + ph * 3) * 0.6;
          for (const side of [1, -1]) {
            e.set(0, yaw, side * flap);
            q.setFromEuler(e);
            m.compose(pos, q, one.set(side * 0.9, 1, 0.9));
            birds.setMatrixAt(k++, m);
          }
        }
      });
      birds.instanceMatrix.needsUpdate = true;

      // boats
      for (const b of boats) {
        b.a += b.speed * dt;
        const x = Math.cos(b.a) * b.r;
        const z = Math.sin(b.a) * b.r;
        b.g.position.set(x, WATER_Y + Math.sin(t * 1.3 + b.r) * 0.15, z);
        b.g.rotation.set(Math.sin(t * 1.1 + b.r) * 0.05, -b.a, Math.sin(t * 0.9 + b.r) * 0.06);
      }

      // plane
      pass.t += dt;
      if (!plane.visible && pass.t > 35) startPass();
      if (plane.visible) {
        const d = pass.t * 45;
        plane.position.copy(pass.from).addScaledVector(pass.dir, d);
        plane.rotation.set(0, Math.atan2(pass.dir.x, pass.dir.z), Math.sin(t * 0.5) * 0.08);
        beacon.visible = Math.sin(t * 6) > 0.6;
        if (d > pass.len) {
          plane.visible = false;
          pass.t = 0;
        }
      }
    },
  };
}
