import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { C } from '../palette';
import { PLACES } from '../layout';
import { type Ctx, canvasTexture, clearOfRoad, instanced, mat, rand, shadowed, staticBox, trs } from '../utils';
import { patchMaterial } from '../look';
import { addHalo, env, glow } from '../sky';
import { windUniforms } from '../wind';

const SHIRTS = [0xe8604c, 0xf2b134, 0x4fa88f, 0x7a4fd1, 0xfff7ec, 0x59c3e8, 0x2f7d6d];
const SKINS = [0xf1c9a5, 0xd9a47a, 0xa8714f, 0x7a4e35, 0xffdcc0];

/** 0..1: how hard the crowd is cheering. main.ts kicks it on laps; it eases back by itself. */
export const stadiumCheer = { value: 0 };

let scoreCtx: CanvasRenderingContext2D | null = null;
const scoreTexture = canvasTexture(512, 184, (g) => {
  scoreCtx = g;
  drawScore(g, null);
});
function drawScore(g: CanvasRenderingContext2D, best: string | null) {
  g.fillStyle = '#2a1f30';
  g.fillRect(0, 0, 512, 184);
  g.fillStyle = '#f2b134';
  g.font = 'bold 40px system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText('DRIVEFOLIO GP', 256, 58);
  g.fillStyle = '#fff7ec';
  g.font = 'bold 64px ui-monospace, monospace';
  g.fillText(best ? 'BEST ' + best : 'BEST --:--.-', 256, 140);
}
/** Show a new best lap on the stadium scoreboard. */
export function setScoreboard(best: string) {
  if (!scoreCtx) return;
  drawScore(scoreCtx, best);
  scoreTexture.needsUpdate = true;
}

export const PODIUM_OFFSET: [number, number] = [-14, 16]; // clear of the road from Home (enters from the west)

export function buildStadium(ctx: Ctx) {
  const p = PLACES.stadium;
  const y = ctx.terrain.sample(p.x, p.z);
  const A = 30; // semi-axis x
  const B = 46; // semi-axis z (the track runs along z through the middle)

  // stepped stands around an ellipse, with gaps where the track enters
  const seats: THREE.Matrix4[] = [];
  const colors: THREE.Color[] = [];
  const palette = [0xe8604c, 0xfff7ec, 0x4fa88f];
  const people: THREE.Matrix4[] = [];
  const heads: THREE.Matrix4[] = [];
  const shirts: THREE.Color[] = [];
  const skins: THREE.Color[] = [];
  const SEGMENTS = 56;
  for (let s = 0; s < SEGMENTS; s++) {
    const a = (s / SEGMENTS) * Math.PI * 2;
    for (let tier = 0; tier < 4; tier++) {
      const k = 1 + tier * 0.07;
      const x = p.x + Math.cos(a) * A * k;
      const z = p.z + Math.sin(a) * B * k;
      if (!clearOfRoad(ctx, x, z, 6)) continue;
      // align the box's local x with the ellipse tangent (-A sin a, B cos a); yaw maps x → (cos, -sin)
      const yaw = Math.atan2(-Math.cos(a) * B, -Math.sin(a) * A);
      const h = 1.2 + tier * 1.4;
      const len = ((Math.PI * 2 * Math.hypot(A, B)) / Math.SQRT2 / SEGMENTS) * k + 0.4;
      seats.push(trs(x, y + h / 2, z, yaw, len, h, 2.2));
      // a crowd on top of each tier
      const tx = Math.cos(yaw);
      const tz = -Math.sin(yaw);
      for (let u = -len / 2 + 0.6; u < len / 2 - 0.3; u += 1.05) {
        if (rand() < 0.18) continue;
        const px = x + tx * u;
        const pz = z + tz * u;
        people.push(trs(px, y + h + 0.45, pz, yaw, 0.55, 0.9, 0.4));
        heads.push(trs(px, y + h + 1.12, pz, 0, 0.42, 0.42, 0.42));
        shirts.push(new THREE.Color(SHIRTS[Math.floor(rand() * SHIRTS.length)]));
        skins.push(new THREE.Color(SKINS[Math.floor(rand() * SKINS.length)]));
      }
      colors.push(new THREE.Color(palette[(s + tier) % 3]));
      if (tier === 3) staticBox(ctx, x, y + 3, z, len / 2, 3, 4.5, yaw);
    }
  }
  instanced(ctx.scene, new THREE.BoxGeometry(1, 1, 1), mat(0xffffff), seats, colors);
  // the crowd bounces (harder when someone crosses the line, see stadiumCheer)
  const cheerPatch = (m: THREE.Material) =>
    patchMaterial(m, 'cheer', (sh) => {
      sh.uniforms.uTime = windUniforms.uTime;
      sh.uniforms.uCheer = stadiumCheer;
      sh.vertexShader = 'uniform float uTime;\nuniform float uCheer;\n' + sh.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 cP = vec3(instanceMatrix[3]);
          float cPh = fract(sin(dot(cP.xz, vec2(12.9898, 78.233))) * 43758.5453) * 6.28;
          float bounce = abs(sin(uTime * (3.0 + uCheer * 5.0) + cPh)) * (0.06 + uCheer * 0.5);
          transformed.y += bounce / max(length(vec3(instanceMatrix[1])), 0.001);
        #endif`
      );
    });
  const cheer = (m: THREE.Material) => {
    cheerPatch(m);
    m.userData.motion = { key: 'cheer', apply: cheerPatch }; // outlines bounce along
    return m;
  };
  instanced(ctx.scene, new THREE.BoxGeometry(1, 1, 1), cheer(mat(0xffffff)), people, shirts);
  instanced(ctx.scene, new THREE.IcosahedronGeometry(1, 0), cheer(mat(0xffffff)), heads, skins);

  // floodlights
  const floodMat = glow(new THREE.MeshStandardMaterial({ color: 0xfff2b0, emissive: 0xffe27a, emissiveIntensity: 0.6 }), 0xfff4c4, 0.6, 2.5);
  const coneLen = 34;
  const coneGeo = new THREE.ConeGeometry(9, coneLen, 24, 1, true).translate(0, -coneLen / 2, 0);
  const coneMat = new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: true });
  ctx.updaters.push(() => (coneMat.opacity = env.night * 0.09));
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const x = p.x + sx * A * 1.35;
    const z = p.z + sz * B * 0.8;
    const pole = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 18, 8), mat(C.carDark)));
    pole.position.set(x, y + 9, z);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(3.5, 2, 0.8), floodMat);
    lamp.position.set(x, y + 18.5, z);
    lamp.lookAt(p.x, y, p.z);
    // a soft light cone toward the field, visible after dark
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.position.copy(lamp.position);
    cone.lookAt(p.x, y, p.z);
    cone.rotateX(Math.PI / 2);
    addHalo(x, y + 18.5, z, 6, 0xffe6a0);
    ctx.scene.add(pole, lamp, cone);
    staticBox(ctx, x, y + 9, z, 0.5, 9, 0.5);
  }

  // podium (Achievements)
  const px = p.x + PODIUM_OFFSET[0];
  const pz = p.z + PODIUM_OFFSET[1];
  const tiers: [number, number, number][] = [[0, 2.2, C.gold], [0, 1.5, 0xc9ccd6], [0, 1, 0xd08a55]];
  const offsets = [0, -3.2, 3.2];
  tiers.forEach(([, h, color], i) => {
    const block = shadowed(new THREE.Mesh(new THREE.BoxGeometry(3, h, 3), mat(color)));
    block.position.set(px, y + h / 2, pz + offsets[i]);
    ctx.scene.add(block);
    staticBox(ctx, px, y + h / 2, pz + offsets[i], 1.5, h / 2, 1.5);
  });
  const trophy = new THREE.Group();
  const cup = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.35, 1.4, 16), new THREE.MeshStandardMaterial({ color: C.gold, metalness: 0.8, roughness: 0.25 })));
  cup.position.y = 1.3;
  const stem = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.6, 8), cup.material));
  stem.position.y = 0.3;
  const base = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 0.9), mat(C.carDark)));
  trophy.add(base, stem, cup);
  trophy.position.set(px, y + 2.2, pz);
  ctx.scene.add(trophy);
  ctx.updaters.push((t) => (trophy.rotation.y = t * 0.8));

  // scoreboard with the best lap
  const board = new THREE.Mesh(new THREE.PlaneGeometry(14, 5), new THREE.MeshBasicMaterial({ map: scoreTexture, fog: true }));
  const bx = p.x + A * 1.32;
  board.position.set(bx, y + 14, p.z);
  board.rotation.y = -Math.PI / 2;
  const frame = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.6, 6, 15), mat(C.carDark)));
  frame.position.set(bx + 0.35, y + 14, p.z);
  const legs = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.5, 11, 0.5), mat(C.carDark)));
  legs.position.set(bx + 0.35, y + 5.5, p.z);
  ctx.scene.add(board, frame, legs);
  staticBox(ctx, bx + 0.35, y + 5.5, p.z, 0.3, 5.5, 0.3);

  // a ball to push around the infield
  const ball = shadowed(new THREE.Mesh(new THREE.IcosahedronGeometry(1.2, 1), mat(C.cream)));
  const body = new CANNON.Body({ mass: 2, shape: new CANNON.Sphere(1.2), linearDamping: 0.3, angularDamping: 0.3 });
  body.position.set(p.x + 14, y + 1.3, p.z + 14);
  ctx.world.addBody(body);
  ctx.scene.add(ball);
  ctx.dynamic.push({ mesh: ball, body });
}
