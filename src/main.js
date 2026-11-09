import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// ---------- Palette ----------
const C = {
  sky: 0xf6d7b0,
  ground: 0xf0b98a,
  path: 0xe9a877,
  car: 0xe8604c,
  carDark: 0x3b2a3f,
  cream: 0xfff7ec,
  leaf: 0x4fa88f,
  leafDark: 0x2f7d6d,
  trunk: 0x8a5a44,
  rock: 0xc98d6b,
  crate: 0xffc65c,
  pin: 0xfff7ec,
};

// ---------- Renderer / scene ----------
const canvas = document.getElementById('scene');
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

const dynamic = []; // { mesh, body } pairs kept in sync each frame

const mat = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true });

function shadowed(mesh) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// Seeded random so the world layout is stable between reloads
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// ---------- Ground ----------
const ISLAND_R = 70;
const groundMesh = new THREE.Mesh(new THREE.CircleGeometry(ISLAND_R + 6, 64), mat(C.ground));
groundMesh.rotation.x = -Math.PI / 2;
groundMesh.receiveShadow = true;
scene.add(groundMesh);

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

// ---------- Car ----------
const chassisBody = new CANNON.Body({ mass: 150, allowSleep: false });
chassisBody.addShape(new CANNON.Box(new CANNON.Vec3(0.9, 0.35, 1.6)));
chassisBody.angularDamping = 0.4;
const SPAWN = new CANNON.Vec3(0, 2, 0);
chassisBody.position.copy(SPAWN);

const vehicle = new CANNON.RaycastVehicle({
  chassisBody,
  indexRightAxis: 0,
  indexUpAxis: 1,
  indexForwardAxis: 2,
});
const wheelBase = {
  radius: 0.45,
  directionLocal: new CANNON.Vec3(0, -1, 0),
  suspensionStiffness: 32,
  suspensionRestLength: 0.4,
  frictionSlip: 2.2,
  dampingRelaxation: 2.3,
  dampingCompression: 4.4,
  maxSuspensionForce: 100000,
  rollInfluence: 0.02,
  axleLocal: new CANNON.Vec3(-1, 0, 0),
  maxSuspensionTravel: 0.3,
  customSlidingRotationalSpeed: -30,
  useCustomSlidingRotationalSpeed: true,
};
// 0,1 = front (+z), 2,3 = rear
for (const [x, z] of [[0.85, 1.15], [-0.85, 1.15], [0.85, -1.15], [-0.85, -1.15]]) {
  vehicle.addWheel({ ...wheelBase, chassisConnectionPointLocal: new CANNON.Vec3(x, 0, z) });
}
vehicle.addToWorld(world);

const carMesh = new THREE.Group();
{
  const body = shadowed(new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.6, 3.2), mat(C.car)));
  const cabin = shadowed(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.6, 1.5), mat(C.cream)));
  cabin.position.set(0, 0.6, -0.25);
  const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.42, 0.05), mat(C.carDark));
  windshield.position.set(0, 0.62, 0.51);
  const bumper = shadowed(new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.25, 0.25), mat(C.carDark)));
  bumper.position.set(0, -0.2, 1.62);
  const rearBumper = bumper.clone();
  rearBumper.position.z = -1.62;
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xfff2b0, emissive: 0xffe27a, emissiveIntensity: 0.8 });
  for (const x of [-0.6, 0.6]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 0.06), lightMat);
    l.position.set(x, 0.05, 1.61);
    carMesh.add(l);
  }
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 4), mat(C.carDark));
  antenna.position.set(0.55, 1.3, -0.8);
  const flag = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.22, 0.35), mat(C.leaf));
  flag.position.set(0.55, 1.7, -0.98);
  carMesh.add(body, cabin, windshield, bumper, rearBumper, antenna, flag);
}
scene.add(carMesh);

const wheelGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.38, 16).rotateZ(Math.PI / 2);
const hubGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.4, 8).rotateZ(Math.PI / 2);
const wheelMeshes = vehicle.wheelInfos.map(() => {
  const g = new THREE.Group();
  g.add(shadowed(new THREE.Mesh(wheelGeo, mat(C.carDark))));
  g.add(new THREE.Mesh(hubGeo, mat(C.cream)));
  scene.add(g);
  return g;
});

function resetCar(toSpawn = false) {
  const yaw = new CANNON.Vec3();
  chassisBody.quaternion.toEuler(yaw);
  if (toSpawn) {
    chassisBody.position.copy(SPAWN);
    chassisBody.quaternion.set(0, 0, 0, 1);
  } else {
    chassisBody.position.y += 2;
    chassisBody.quaternion.setFromEuler(0, yaw.y, 0);
  }
  chassisBody.velocity.setZero();
  chassisBody.angularVelocity.setZero();
}

// ---------- Helpers for props ----------
function addDynamicBox(size, pos, color, mass = 3, yaw = 0) {
  const mesh = shadowed(new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), mat(color)));
  scene.add(mesh);
  const body = new CANNON.Body({
    mass,
    shape: new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2)),
    sleepSpeedLimit: 0.2,
  });
  body.position.set(pos.x, pos.y, pos.z);
  body.quaternion.setFromEuler(0, yaw, 0);
  body.sleep(); // start at rest until something hits it
  world.addBody(body);
  dynamic.push({ mesh, body });
}

function addTree(x, z) {
  const s = 0.8 + rand() * 0.7;
  const trunk = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.25 * s, 0.35 * s, 1.6 * s, 6), mat(C.trunk)));
  trunk.position.set(x, 0.8 * s, z);
  const crown = shadowed(new THREE.Mesh(new THREE.ConeGeometry(1.4 * s, 2.8 * s, 7), mat(rand() > 0.5 ? C.leaf : C.leafDark)));
  crown.position.set(x, 2.8 * s, z);
  crown.rotation.y = rand() * Math.PI;
  scene.add(trunk, crown);
  const body = new CANNON.Body({ mass: 0, shape: new CANNON.Cylinder(0.35 * s, 0.35 * s, 3, 8) });
  body.position.set(x, 1.5, z);
  world.addBody(body);
}

function makeLabel(text, color = '#e8604c') {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff7ec';
  ctx.beginPath();
  ctx.roundRect(8, 8, 496, 112, 56);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.font = 'bold 64px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  sprite.scale.set(6, 1.5, 1);
  return sprite;
}

// ---------- Zones (portfolio sections) ----------
// Edit the HTML here to fill in your own content.
const zones = [
  {
    title: 'About me',
    pos: new THREE.Vector3(-18, 0, 12),
    html: `<p>I'm a developer who likes building playful things for the web.</p>
           <p>Replace this text with your own story in <code>src/main.js</code>.</p>`,
  },
  {
    title: 'Projects',
    pos: new THREE.Vector3(16, 0, -18),
    html: `<ul>
             <li><a href="#">Project one</a>: what it does</li>
             <li><a href="#">Project two</a>: what it does</li>
             <li><a href="#">This island</a>: Three.js + cannon-es</li>
           </ul>`,
  },
  {
    title: 'Contact',
    pos: new THREE.Vector3(-22, 0, -22),
    html: `<p>Say hi!</p>
           <ul>
             <li><a href="mailto:you@example.com">you@example.com</a></li>
             <li><a href="#">GitHub</a></li>
             <li><a href="#">LinkedIn</a></li>
           </ul>`,
  },
];
const ZONE_R = 5;
for (const z of zones) {
  z.ring = new THREE.Mesh(
    new THREE.RingGeometry(ZONE_R - 0.5, ZONE_R, 48),
    new THREE.MeshBasicMaterial({ color: C.cream, transparent: true, opacity: 0.7 })
  );
  z.ring.rotation.x = -Math.PI / 2;
  z.ring.position.copy(z.pos).setY(0.03);
  z.pad = new THREE.Mesh(
    new THREE.CircleGeometry(ZONE_R - 0.5, 48),
    new THREE.MeshBasicMaterial({ color: C.path, transparent: true, opacity: 0.6 })
  );
  z.pad.rotation.x = -Math.PI / 2;
  z.pad.position.copy(z.pos).setY(0.02);
  z.label = makeLabel(z.title);
  z.label.position.copy(z.pos).setY(4);
  scene.add(z.ring, z.pad, z.label);
}

// ---------- "HELLO" brick wall you can smash ----------
{
  const font = {
    H: ['101', '101', '111', '101', '101'],
    E: ['111', '100', '111', '100', '111'],
    L: ['100', '100', '100', '100', '111'],
    O: ['111', '101', '101', '101', '111'],
  };
  const word = 'HELLO';
  const B = 0.7; // brick size
  const along = new THREE.Vector3(-1, 0, 1).normalize(); // reads left-to-right from the camera
  const center = new THREE.Vector3(13, 0, 13);
  const letterW = 4 * B;
  const start = center.clone().addScaledVector(along, -((word.length * letterW) / 2));
  [...word].forEach((ch, li) => {
    font[ch].forEach((row, ri) => {
      [...row].forEach((bit, ci) => {
        if (bit !== '1') return;
        const p = start.clone().addScaledVector(along, li * letterW + ci * B);
        p.y = (4 - ri) * B + B / 2;
        addDynamicBox(new THREE.Vector3(B, B, B), p, li % 2 ? C.car : C.leaf, 1.5, Math.PI / 4);
      });
    });
  });
}

// ---------- Playground: ramp, crates, pins ----------
{
  const rampSize = new CANNON.Vec3(3, 0.25, 4.5);
  const ramp = new CANNON.Body({ mass: 0, shape: new CANNON.Box(rampSize) });
  ramp.position.set(0, 0.9, 30);
  ramp.quaternion.setFromEuler(-0.24, 0, 0);
  world.addBody(ramp);
  const rampMesh = shadowed(new THREE.Mesh(new THREE.BoxGeometry(6, 0.5, 9), mat(C.cream)));
  rampMesh.position.copy(ramp.position);
  rampMesh.quaternion.copy(ramp.quaternion);
  scene.add(rampMesh);
  const rampLabel = makeLabel('Send it!', '#2f7d6d');
  rampLabel.position.set(0, 4.5, 30);
  scene.add(rampLabel);

  // crate pyramid beyond the ramp
  for (let layer = 0; layer < 4; layer++) {
    for (let i = 0; i < 4 - layer; i++) {
      const x = (i - (3 - layer) / 2) * 1.05;
      addDynamicBox(new THREE.Vector3(1, 1, 1), new THREE.Vector3(x, 0.5 + layer * 1.0, 44), C.crate, 2);
    }
  }

  // bowling pins
  const pinGeo = new THREE.CylinderGeometry(0.22, 0.32, 1.3, 10);
  const origin = new THREE.Vector3(-34, 0, 26);
  for (let row = 0; row < 4; row++) {
    for (let i = 0; i <= row; i++) {
      const mesh = shadowed(new THREE.Mesh(pinGeo, mat(C.pin)));
      scene.add(mesh);
      const body = new CANNON.Body({ mass: 1, shape: new CANNON.Cylinder(0.22, 0.32, 1.3, 10) });
      body.position.set(origin.x + (i - row / 2) * 1.1, 0.65, origin.z + row * 1.0);
      body.sleep();
      world.addBody(body);
      dynamic.push({ mesh, body });
    }
  }
  const pinLabel = makeLabel('Strike?', '#2f7d6d');
  pinLabel.position.set(origin.x, 4, origin.z + 1.5);
  scene.add(pinLabel);
}

// ---------- Trees (kept clear of zones and spawn) ----------
{
  const keepClear = [
    ...zones.map((z) => z.pos),
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(13, 0, 13),
    new THREE.Vector3(0, 0, 36),
    new THREE.Vector3(-34, 0, 28),
  ];
  let placed = 0;
  while (placed < 70) {
    const a = rand() * Math.PI * 2;
    const r = 8 + rand() * (ISLAND_R - 14);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (keepClear.some((p) => Math.hypot(p.x - x, p.z - z) < 10)) continue;
    if (Math.abs(x) < 5 && z > 0 && z < 50) continue; // lane to the ramp
    addTree(x, z);
    placed++;
  }
}

// ---------- Input ----------
const keys = { forward: false, back: false, left: false, right: false, brake: false, boost: false };
const keyMap = {
  KeyW: 'forward', ArrowUp: 'forward',
  KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'brake',
  ShiftLeft: 'boost', ShiftRight: 'boost',
};
window.addEventListener('keydown', (e) => {
  if (keyMap[e.code]) { keys[keyMap[e.code]] = true; e.preventDefault(); }
  if (e.code === 'KeyR') resetCar();
});
window.addEventListener('keyup', (e) => {
  if (keyMap[e.code]) keys[keyMap[e.code]] = false;
});
document.querySelectorAll('#touch button').forEach((btn) => {
  const k = btn.dataset.key;
  btn.addEventListener('pointerdown', () => (keys[k] = true));
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, () => (keys[k] = false)));
});

let started = false;
document.getElementById('start').addEventListener('click', () => {
  started = true;
  document.getElementById('intro').classList.add('hidden');
  canvas.focus();
});

// ---------- UI panel ----------
const panel = document.getElementById('panel');
const panelTitle = document.getElementById('panel-title');
const panelBody = document.getElementById('panel-body');
let activeZone = null;
function setZone(z) {
  if (z === activeZone) return;
  activeZone = z;
  if (z) {
    panelTitle.textContent = z.title;
    panelBody.innerHTML = z.html;
    panel.classList.add('open');
  } else {
    panel.classList.remove('open');
  }
}

// ---------- Loop ----------
const MAX_FORCE = 1100;
const MAX_STEER = 0.55;
let steer = 0;
const camTarget = new THREE.Vector3();
const clock = new THREE.Clock();

function updateControls(dt) {
  const speed = chassisBody.velocity.length();
  const boost = keys.boost ? 1.8 : 1;
  let force = 0;
  if (started) {
    if (keys.forward) force = -MAX_FORCE * boost; // negative = +z forward in this setup
    if (keys.back) force = MAX_FORCE * 0.6;
  }
  vehicle.applyEngineForce(force, 2);
  vehicle.applyEngineForce(force, 3);

  // steer less at high speed so it doesn't flip
  const limit = MAX_STEER * THREE.MathUtils.clamp(1 - speed / 40, 0.35, 1);
  const want = started ? (keys.left ? limit : 0) + (keys.right ? -limit : 0) : 0;
  steer = THREE.MathUtils.damp(steer, want, 10, dt);
  vehicle.setSteeringValue(steer, 0);
  vehicle.setSteeringValue(steer, 1);

  const brake = keys.brake ? 12 : !keys.forward && !keys.back ? 1.2 : 0;
  for (let i = 0; i < 4; i++) vehicle.setBrake(brake, i);
}

function tick() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;

  updateControls(dt);
  world.step(1 / 60, dt, 3);

  if (chassisBody.position.y < -10) resetCar(true);

  carMesh.position.copy(chassisBody.position);
  carMesh.quaternion.copy(chassisBody.quaternion);
  vehicle.wheelInfos.forEach((w, i) => {
    vehicle.updateWheelTransform(i);
    wheelMeshes[i].position.copy(w.worldTransform.position);
    wheelMeshes[i].quaternion.copy(w.worldTransform.quaternion);
  });
  for (const { mesh, body } of dynamic) {
    mesh.position.copy(body.position);
    mesh.quaternion.copy(body.quaternion);
  }

  // camera + sun follow
  camTarget.lerp(carMesh.position, 1 - Math.exp(-6 * dt));
  camera.position.copy(camTarget).add(CAM_OFFSET);
  camera.lookAt(camTarget);
  sun.position.copy(camTarget).add(new THREE.Vector3(18, 30, 8));
  sun.target.position.copy(camTarget);

  // zones
  let inside = null;
  for (const z of zones) {
    const d = Math.hypot(carMesh.position.x - z.pos.x, carMesh.position.z - z.pos.z);
    const on = d < ZONE_R;
    if (on) inside = z;
    z.label.position.y = 4 + Math.sin(t * 2 + z.pos.x) * 0.25;
    z.ring.material.opacity = on ? 1 : 0.6;
    z.ring.scale.setScalar(on ? 1 + Math.sin(t * 6) * 0.03 : 1);
  }
  setZone(inside);

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
