import * as THREE from 'three';
import { C } from '../palette';
import { PLACES } from '../layout';
import { type Ctx, canvasTexture, clearOfRoad, mat, shadowed, staticBox } from '../utils';

export const SCREEN_OFFSET: [number, number] = [-18, 18]; // the race track cuts diagonally through the lot; keep clear of it

export function buildStudio(ctx: Ctx) {
  const p = PLACES.studio;

  // sound-stage hangars wherever they fit next to the road
  const candidates: [number, number, number][] = [
    [-22, 10, 0], [0, 22, 0], [22, 10, 0], [-24, -12, Math.PI / 2], [26, -14, Math.PI / 2], [-6, -30, 0],
  ];
  let placed = 0;
  for (const [dx, dz, yaw] of candidates) {
    if (placed >= 3) break;
    const x = p.x + dx;
    const z = p.z + dz;
    if (!clearOfRoad(ctx, x, z, 13)) continue;
    hangar(ctx, x, z, yaw, `STAGE ${placed + 1}`);
    placed++;
  }

  // the big screen (Greyborn)
  const sx = p.x + SCREEN_OFFSET[0];
  const sz = p.z + SCREEN_OFFSET[1];
  const sy = ctx.terrain.sample(sx, sz);
  const tex = canvasTexture(1024, 512, (g) => {
    const grad = g.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, '#1b1424');
    grad.addColorStop(1, '#3b2a3f');
    g.fillStyle = grad;
    g.fillRect(0, 0, 1024, 512);
    g.fillStyle = '#e8604c';
    g.font = 'bold 150px Georgia, serif';
    g.textAlign = 'center';
    g.fillText('GREYBORN', 512, 250);
    g.fillStyle = '#fff7ec';
    g.font = '40px system-ui, sans-serif';
    g.fillText('a feature film · in production', 512, 330);
    g.font = '30px system-ui, sans-serif';
    g.fillStyle = '#f2b134';
    g.fillText('3D environments, animation & VFX by Abishai', 512, 400);
  });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(22, 11), new THREE.MeshBasicMaterial({ map: tex }));
  screen.position.set(sx, sy + 9, sz);
  const frame = shadowed(new THREE.Mesh(new THREE.BoxGeometry(23, 12, 0.6), mat(C.carDark)));
  frame.position.set(sx, sy + 9, sz - 0.35);
  ctx.scene.add(screen, frame);
  for (const side of [-1, 1]) {
    const leg = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.8, 4, 0.8), mat(C.carDark)));
    leg.position.set(sx + side * 9, sy + 1.6, sz - 0.4);
    ctx.scene.add(leg);
  }
  staticBox(ctx, sx, sy + 9, sz - 0.35, 11.5, 6, 0.4);

  // swinging spotlights
  for (const side of [-1, 1]) {
    const x = sx + side * 15;
    const z = sz + 6;
    const y = ctx.terrain.sample(x, z);
    const stand = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.6, 3, 8), mat(C.carDark)));
    stand.position.set(x, y + 1.5, z);
    const beam = new THREE.Mesh(
      new THREE.ConeGeometry(3, 50, 20, 1, true).translate(0, 25, 0),
      new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
    );
    beam.position.set(x, y + 3, z);
    ctx.scene.add(stand, beam);
    ctx.updaters.push((t) => {
      beam.rotation.z = Math.sin(t * 0.7 + side) * 0.45;
      beam.rotation.x = Math.cos(t * 0.5 + side * 2) * 0.25;
    });
  }
}

function hangar(ctx: Ctx, x: number, z: number, yaw: number, name: string) {
  const y = ctx.terrain.sample(x, z);
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = yaw;
  // half cylinder: axis y → z (rotateX), then the x≥0 half → y≥0 (rotateZ); its caps are the end walls
  const roof = shadowed(
    new THREE.Mesh(
      new THREE.CylinderGeometry(7, 7, 18, 20, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2),
      mat(0xc9c2b8)
    )
  );
  const door = new THREE.Mesh(new THREE.PlaneGeometry(6, 5), mat(C.carDark));
  door.position.set(0, 2.5, 9.05);
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 1.4),
    new THREE.MeshBasicMaterial({
      map: canvasTexture(256, 64, (c) => {
        c.fillStyle = '#e8604c';
        c.fillRect(0, 0, 256, 64);
        c.fillStyle = '#fff7ec';
        c.font = 'bold 40px system-ui, sans-serif';
        c.textAlign = 'center';
        c.fillText(name, 128, 46);
      }),
    })
  );
  sign.position.set(0, 6, 9.06);
  g.add(roof, door, sign);
  ctx.scene.add(g);
  staticBox(ctx, x, y + 3.5, z, 7, 3.5, 9, yaw);
}
