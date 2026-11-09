import * as THREE from 'three';
import { C } from '../palette';
import { PLACES } from '../layout';
import { type Ctx, clearOfRoad, instanced, mat, shadowed, staticBox, trs } from '../utils';
import { plantTrees, scatter } from '../world';

export const LIGHTHOUSE_OFFSET: [number, number] = [-12, 14];

export function buildBeach(ctx: Ctx) {
  const p = PLACES.beach;
  const out = Math.atan2(p.z, p.x); // direction out to sea
  const ox = Math.cos(out);
  const oz = Math.sin(out);

  // palms on the sand
  const palms = scatter(p.x, p.z, p.radius + 25, 40, (x, z) => {
    const h = ctx.terrain.sample(x, z);
    return h > 0.7 && h < 3 && clearOfRoad(ctx, x, z, 3) && Math.hypot(x - (p.x + LIGHTHOUSE_OFFSET[0]), z - (p.z + LIGHTHOUSE_OFFSET[1])) > 8;
  }, [0.8, 1.2]);
  plantTrees(ctx, 'palm', palms);

  // drivable pier out over the water
  const yaw = Math.atan2(ox, oz); // local +z points out to sea
  const start = p.radius - 6;
  const len = 44;
  const cx = p.x + ox * (start + len / 2);
  const cz = p.z + oz * (start + len / 2);
  const deckY = 1.5;
  const deck = shadowed(new THREE.Mesh(new THREE.BoxGeometry(7, 0.4, len), mat(0xb07a52)));
  deck.position.set(cx, deckY, cz);
  deck.rotation.y = yaw;
  ctx.scene.add(deck);
  staticBox(ctx, cx, deckY, cz, 3.5, 0.2, len / 2, yaw);
  const posts: THREE.Matrix4[] = [];
  for (let d = 0; d <= len; d += 5.5) {
    for (const side of [-1, 1]) {
      const x = p.x + ox * (start + d) + Math.cos(yaw) * side * 3.2;
      const z = p.z + oz * (start + d) - Math.sin(yaw) * side * 3.2;
      posts.push(trs(x, deckY - 3, z, 0, 0.4, 6, 0.4));
    }
  }
  instanced(ctx.scene, new THREE.BoxGeometry(1, 1, 1), mat(0x7a5238), posts);

  // lighthouse (Contact)
  const lx = p.x + LIGHTHOUSE_OFFSET[0];
  const lz = p.z + LIGHTHOUSE_OFFSET[1];
  const ly = ctx.terrain.sample(lx, lz);
  const tower = new THREE.Group();
  tower.position.set(lx, ly, lz);
  for (let i = 0; i < 6; i++) {
    const r0 = 2.6 - i * 0.22;
    const seg = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(r0 - 0.22, r0, 3, 20), mat(i % 2 ? C.car : C.cream)));
    seg.position.y = 1.5 + i * 3;
    tower.add(seg);
  }
  const deckTop = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 0.4, 20), mat(C.carDark)));
  deckTop.position.y = 18.2;
  const lamp = new THREE.Mesh(
    new THREE.CylinderGeometry(1.1, 1.1, 1.8, 16),
    new THREE.MeshStandardMaterial({ color: 0xfff2b0, emissive: 0xffd76a, emissiveIntensity: 1.5 })
  );
  lamp.position.y = 19.3;
  const cap = shadowed(new THREE.Mesh(new THREE.ConeGeometry(1.5, 1.5, 16), mat(C.car)));
  cap.position.y = 21;
  tower.add(deckTop, lamp, cap);

  const beam = new THREE.Mesh(
    new THREE.ConeGeometry(4, 40, 24, 1, true).rotateZ(Math.PI / 2).translate(20, 0, 0),
    new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })
  );
  beam.position.y = 19.3;
  tower.add(beam);
  ctx.scene.add(tower);
  ctx.updaters.push((t) => (beam.rotation.y = t * 0.9));
  staticBox(ctx, lx, ly + 9, lz, 2.3, 9, 2.3);
}
