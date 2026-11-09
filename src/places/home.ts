import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { C } from '../palette';
import { PLACES } from '../layout';
import { type Ctx, mat, shadowed } from '../utils';
import { buildBrickWord } from '../world';

export function buildHome(ctx: Ctx) {
  const p = PLACES.home;
  const y = ctx.terrain.sample(p.x, p.z);

  const plaza = new THREE.Mesh(
    new THREE.CircleGeometry(p.radius - 4, 48).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: C.plaza, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 })
  );
  plaza.position.set(p.x, y + 0.03, p.z);
  plaza.receiveShadow = true;
  ctx.scene.add(plaza);

  // your name, waiting to be driven through
  buildBrickWord(ctx, 'ABISHAI', new THREE.Vector3(p.x, y, p.z - 12));

  // fountain
  const fx = p.x + 12;
  const fz = p.z + 4;
  const basin = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(3, 3.3, 0.8, 24), mat(C.cream)));
  basin.position.set(fx, y + 0.4, fz);
  const pool = new THREE.Mesh(new THREE.CircleGeometry(2.7, 24).rotateX(-Math.PI / 2), mat(C.waterShallow));
  pool.position.set(fx, y + 0.82, fz);
  const spout = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, 2.2, 10), mat(C.cream)));
  spout.position.set(fx, y + 1.5, fz);
  ctx.scene.add(basin, pool, spout);
  const body = new CANNON.Body({ mass: 0, shape: new CANNON.Cylinder(3.3, 3.3, 0.8, 12) });
  body.position.set(fx, y + 0.4, fz);
  ctx.world.addBody(body);
}
