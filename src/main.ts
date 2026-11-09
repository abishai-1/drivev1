import './style.css';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { C } from './palette';
import { type Ctx, el, syncObject } from './utils';
import { setupInput } from './input';
import { createCar } from './car';
import { createZones, updateZones, type Zone } from './zones';
import { buildIsland, buildHelloWall, buildPlayground, buildTrees } from './world';

// ---------- Renderer / scene ----------
const canvas = el<HTMLCanvasElement>('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(C.sky);
scene.fog = new THREE.Fog(C.sky, 45, 110);

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 300);
const CAM_OFFSET = new THREE.Vector3(-14, 16, -14);
const SUN_OFFSET = new THREE.Vector3(18, 30, 8);
camera.position.copy(CAM_OFFSET);

scene.add(new THREE.HemisphereLight(0xfff1dd, 0xc98d6b, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 80 });
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);

// ---------- Physics ----------
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -20, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.allowSleep = true;
world.defaultContactMaterial.friction = 0.3;
world.defaultContactMaterial.restitution = 0.15;

// ---------- World ----------
const ctx: Ctx = { scene, world, dynamic: [] };
buildIsland(ctx);
const car = createCar(ctx);
const zones = createZones(ctx);
const wallCenter = new THREE.Vector3(13, 0, 13);
buildHelloWall(ctx, wallCenter);
buildPlayground(ctx);
buildTrees(ctx, [
  ...zones.map((z) => z.pos),
  new THREE.Vector3(0, 0, 0),
  wallCenter,
  new THREE.Vector3(0, 0, 36),
  new THREE.Vector3(-34, 0, 28),
]);

// ---------- UI ----------
const keys = setupInput(() => car.reset());

let started = false;
const intro = el('intro');
el('start').addEventListener('click', () => {
  started = true;
  intro.classList.add('opacity-0', 'pointer-events-none');
  canvas.focus();
});

const panel = el('panel');
const panelTitle = el('panel-title');
const panelBody = el('panel-body');
const PANEL_HIDDEN = 'translate-x-[calc(100%+40px)]';
let activeZone: Zone | null = null;

function setZone(z: Zone | null) {
  if (z === activeZone) return;
  activeZone = z;
  if (z) {
    panelTitle.textContent = z.title;
    panelBody.innerHTML = z.html;
  }
  panel.classList.toggle(PANEL_HIDDEN, !z);
  panel.classList.toggle('translate-x-0', !!z);
}

// ---------- Loop ----------
const camTarget = new THREE.Vector3();
const clock = new THREE.Clock();

function tick() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;

  car.drive(keys, started, dt);
  world.step(1 / 60, dt, 3);
  car.sync();
  for (const { mesh, body } of ctx.dynamic) syncObject(mesh, body.position, body.quaternion);

  // camera + sun follow the car
  camTarget.lerp(car.mesh.position, 1 - Math.exp(-6 * dt));
  camera.position.copy(camTarget).add(CAM_OFFSET);
  camera.lookAt(camTarget);
  sun.position.copy(camTarget).add(SUN_OFFSET);
  sun.target.position.copy(camTarget);

  setZone(updateZones(zones, car.mesh.position, t));

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
