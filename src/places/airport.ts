import * as THREE from 'three';
import { C } from '../palette';
import { RUNWAY, runwayPoint } from '../layout';
import { type Ctx, canvasTexture, instanced, mat, shadowed, staticBox, trs } from '../utils';

const runwayYaw = Math.atan2(RUNWAY.dir[0], RUNWAY.dir[1]); // local +z along the runway

/** Where the aircraft spawn: [x, z, yaw]. */
export const JET_SPAWN = { at: runwayPoint(-RUNWAY.length / 2 + 12, 0), yaw: runwayYaw };
export const HELI_SPAWN = { at: runwayPoint(50, 34), yaw: runwayYaw };
export const TOWER_AT = runwayPoint(-25, 34);

export function buildAirport(ctx: Ctx) {
  const y = ctx.terrain.sample(RUNWAY.x, RUNWAY.z);
  const lift = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 };

  // runway with centerline dashes
  const runway = new THREE.Mesh(
    new THREE.PlaneGeometry(RUNWAY.width, RUNWAY.length).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x5d5862, roughness: 0.95, ...lift })
  );
  runway.position.set(RUNWAY.x, y + 0.05, RUNWAY.z);
  runway.rotation.y = runwayYaw;
  runway.receiveShadow = true;
  ctx.scene.add(runway);

  const dashes: THREE.Matrix4[] = [];
  const lights: THREE.Matrix4[] = [];
  for (let u = -RUNWAY.length / 2 + 8; u < RUNWAY.length / 2 - 8; u += 10) {
    const [x, z] = runwayPoint(u, 0);
    dashes.push(trs(x, y + 0.08, z, runwayYaw, 0.6, 0.02, 5));
    for (const side of [-1, 1]) {
      const [lx, lz] = runwayPoint(u, side * (RUNWAY.width / 2 + 0.6));
      lights.push(trs(lx, y + 0.25, lz, 0, 0.35, 0.5, 0.35));
    }
  }
  const box = new THREE.BoxGeometry(1, 1, 1);
  instanced(ctx.scene, box, new THREE.MeshBasicMaterial({ color: C.cream }), dashes, undefined, false);
  instanced(ctx.scene, box, new THREE.MeshStandardMaterial({ color: 0xfff2b0, emissive: 0xffc94a, emissiveIntensity: 1.2 }), lights, undefined, false);

  // threshold stripes at both ends
  for (const end of [-1, 1]) {
    for (let k = -3; k <= 3; k++) {
      const [x, z] = runwayPoint(end * (RUNWAY.length / 2 - 4), k * 2.6);
      const stripe = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: C.cream }));
      stripe.scale.set(1.2, 0.02, 6);
      stripe.position.set(x, y + 0.08, z);
      stripe.rotation.y = runwayYaw;
      ctx.scene.add(stripe);
    }
  }

  // hangar
  const [hx, hz] = runwayPoint(15, 40);
  const hangar = shadowed(
    new THREE.Mesh(new THREE.CylinderGeometry(11, 11, 26, 24, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2), mat(0xb9c2c9))
  );
  hangar.position.set(hx, y, hz);
  hangar.rotation.y = runwayYaw + Math.PI / 2;
  ctx.scene.add(hangar);
  staticBox(ctx, hx, y + 5.5, hz, 11, 5.5, 13, runwayYaw + Math.PI / 2);

  // control tower
  const [tx, tz] = TOWER_AT;
  const shaft = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2, 16, 12), mat(C.cream)));
  shaft.position.set(tx, y + 8, tz);
  const cab = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(4, 3.2, 3, 12), new THREE.MeshStandardMaterial({ color: 0x5b6f8a, emissive: 0x2b3a52, roughness: 0.3 })));
  cab.position.set(tx, y + 17.5, tz);
  const roof = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(4.4, 4.4, 0.6, 12), mat(C.car)));
  roof.position.set(tx, y + 19.3, tz);
  ctx.scene.add(shaft, cab, roof);
  staticBox(ctx, tx, y + 8, tz, 2, 8, 2);

  // helipad
  const [px, pz] = HELI_SPAWN.at;
  const pad = new THREE.Mesh(
    new THREE.CircleGeometry(7, 32).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({
      map: canvasTexture(256, 256, (g) => {
        g.fillStyle = '#5d5862';
        g.beginPath();
        g.arc(128, 128, 128, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = '#f2b134';
        g.lineWidth = 12;
        g.beginPath();
        g.arc(128, 128, 108, 0, Math.PI * 2);
        g.stroke();
        g.fillStyle = '#fff7ec';
        g.font = 'bold 150px system-ui, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('H', 128, 136);
      }),
      ...lift,
    })
  );
  pad.position.set(px, y + 0.06, pz);
  ctx.scene.add(pad);

  // windsock
  const [wx, wz] = runwayPoint(RUNWAY.length / 2 - 15, -18);
  const pole = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 6, 6), mat(C.cream)));
  pole.position.set(wx, y + 3, wz);
  const sock = shadowed(new THREE.Mesh(new THREE.ConeGeometry(0.6, 3, 10, 1, true).rotateZ(Math.PI / 2).translate(1.5, 0, 0), mat(C.car)));
  sock.position.set(wx, y + 5.6, wz);
  ctx.scene.add(pole, sock);
  ctx.updaters.push((t) => (sock.rotation.y = Math.sin(t * 0.4) * 0.6 + 0.8));
}
