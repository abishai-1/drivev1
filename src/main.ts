import './style.css';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { C } from './palette';
import { HOME_SPAWN, PLACES, STUNT_PAD, WATER_Y } from './layout';
import { type Ctx, el, syncObject } from './utils';
import { setupInput } from './input';
import { baseHeight, buildTerrain, coastRadius, groundColor, smoothstep } from './terrain';
import { buildNetwork } from './paths';
import { buildTrack, createLapTimer, makeTrack } from './track';
import { createWater } from './water';
import { buildPlaces } from './places';
import { HELI_SPAWN, JET_SPAWN } from './places/airport';
import { createZones, updateZones, type Zone } from './zones';
import { createHud } from './hud';
import { createMap } from './map';
import { createSelector } from './selector';
import { createGroundVehicle } from './vehicles/groundVehicle';
import { createHeli, createJet } from './vehicles/aircraft';
import type { Vehicle, VehicleId } from './vehicles/types';
import { createGrass } from './grass';
import { createClouds, createWindStreaks, wind } from './wind';
import { createParticles } from './particles';
import { createAudio } from './audio';
import { createCameraRig } from './camera';

// ---------- Renderer / scene ----------
const canvas = el<HTMLCanvasElement>('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(C.sky);
scene.fog = new THREE.Fog(C.sky, 160, 620);

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.5, 1600);
camera.position.set(0, 20, 30);
camera.lookAt(0, 0, 0);

scene.add(new THREE.HemisphereLight(0xfff1dd, 0xc98d6b, 1.5));
const SUN_OFFSET = new THREE.Vector3(30, 50, 18);
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -55, right: 55, top: 55, bottom: -55, near: 1, far: 160 });
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);

// Move the shadow camera in whole shadow-map texels so shadow edges don't shimmer while driving.
const SHADOW_TEXEL = (sun.shadow.camera.right - sun.shadow.camera.left) / sun.shadow.mapSize.x;
const lightRot = new THREE.Matrix4().lookAt(SUN_OFFSET, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
const lightRotInv = lightRot.clone().invert();
const snapped = new THREE.Vector3();
function followSun(target: THREE.Vector3) {
  snapped.copy(target).applyMatrix4(lightRotInv);
  snapped.x = Math.round(snapped.x / SHADOW_TEXEL) * SHADOW_TEXEL;
  snapped.y = Math.round(snapped.y / SHADOW_TEXEL) * SHADOW_TEXEL;
  snapped.applyMatrix4(lightRot);
  sun.target.position.copy(snapped);
  sun.position.copy(snapped).add(SUN_OFFSET);
}

// ---------- Physics ----------
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -20, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.allowSleep = true;
world.defaultContactMaterial.friction = 0.3;
world.defaultContactMaterial.restitution = 0.15;
const groundMat = new CANNON.Material('ground');
const slideMat = new CANNON.Material('slide');
world.addContactMaterial(new CANNON.ContactMaterial(groundMat, slideMat, { friction: 0.02, restitution: 0 }));

// ---------- UI handles ----------
const intro = el('intro');
const introTitle = el('intro-title');
const startBtn = el<HTMLButtonElement>('start');
const muteBtn = el<HTMLButtonElement>('mute');
const panel = el('panel');
const panelTitle = el('panel-title');
const panelBody = el('panel-body');
const PANEL_HIDDEN = '-translate-x-[calc(100%+40px)]';

// Build after the intro has painted, so the page isn't blank while the island generates.
requestAnimationFrame(() => setTimeout(init, 30));

function init() {
  const t0 = performance.now();

  // ---------- World ----------
  const net = buildNetwork(baseHeight);
  const terrain = buildTerrain(scene, world, groundMat, net);
  const track = makeTrack(net);
  const ctx: Ctx = { scene, world, dynamic: [], updaters: [], terrain, track, net, materials: { ground: groundMat, slide: slideMat } };
  const water = createWater(scene, terrain);
  buildTrack(ctx);
  buildPlaces(ctx);
  // cannon-es computes a static body's AABB when its shape is added (at the origin) and never again,
  // so raycasts — i.e. the vehicles' wheels — would miss every ramp, bridge deck and pier. Refresh them.
  for (const b of world.bodies) if (b.type === CANNON.Body.STATIC) b.updateAABB();
  const zones = createZones(ctx);
  const lap = createLapTimer(track);
  const hud = createHud();
  const map = createMap(terrain, net, track, zones);
  const camRig = createCameraRig(camera, canvas, terrain.sample);
  const updateGrass = createGrass(scene, terrain, camRig.touch ? 26000 : 70000);
  const updateStreaks = createWindStreaks(scene);
  const updateClouds = createClouds(scene);
  const fx = createParticles(scene, renderer);
  const audio = createAudio();
  console.info(`[island] built in ${Math.round(performance.now() - t0)} ms, ${world.bodies.length} bodies`);

  // ---------- Vehicles ----------
  let vehicle: Vehicle = makeVehicle('jeep');
  const safe = { x: HOME_SPAWN.x, z: HOME_SPAWN.z, yaw: HOME_SPAWN.yaw };
  let safeTimer = 0;
  vehicle.place(safe.x, terrain.sample(safe.x, safe.z), safe.z, safe.yaw);

  function makeVehicle(id: VehicleId): Vehicle {
    if (id === 'heli') return createHeli(ctx);
    if (id === 'jet') return createJet(ctx);
    return createGroundVehicle(ctx, id);
  }

  function spawnPoint(v: Vehicle): [number, number, number] {
    if (v.info.id === 'jet') return [JET_SPAWN.at[0], JET_SPAWN.at[1], JET_SPAWN.yaw];
    if (v.info.id === 'heli') return [HELI_SPAWN.at[0], HELI_SPAWN.at[1], HELI_SPAWN.yaw];
    return [safe.x, safe.z, safe.yaw];
  }

  function respawn() {
    const [x, z, yaw] = spawnPoint(vehicle);
    vehicle.place(x, terrain.sample(x, z), z, yaw);
    camRig.snap();
  }

  function switchVehicle(id: VehicleId) {
    if (id === vehicle.info.id) return;
    const wasGround = vehicle.info.kind === 'ground';
    const p = vehicle.body.position;
    const yaw = vehicle.heading();
    vehicle.dispose();
    vehicle = makeVehicle(id);
    if (vehicle.info.kind === 'ground' && wasGround) vehicle.place(p.x, terrain.sample(p.x, p.z), p.z, yaw);
    else respawn();
    camRig.snap();
  }

  // ---------- Input / overlays ----------
  let playing = false;
  const selector = createSelector('jeep', () => audio.click());
  const keys = setupInput({
    reset() {
      if (!playing) return;
      if (vehicle.info.kind === 'air') return respawn();
      const p = vehicle.body.position;
      vehicle.place(p.x, Math.max(terrain.sample(p.x, p.z), p.y - 1), p.z, vehicle.heading());
    },
    toggleMap: () => playing && map.toggle(),
    toggleGarage() {
      if (playing) openGarage();
      else if (intro.dataset.mode === 'garage') closeOverlay();
    },
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyN' && !e.repeat) toggleMute();
  });
  muteBtn.addEventListener('click', () => toggleMute());
  function toggleMute() {
    const m = audio.toggleMute();
    muteBtn.textContent = m ? '🔇' : '🔊';
    muteBtn.blur();
  }
  muteBtn.textContent = audio.muted ? '🔇' : '🔊';

  function openGarage() {
    playing = false;
    intro.dataset.mode = 'garage';
    introTitle.innerHTML = 'Garage';
    startBtn.textContent = 'Drive';
    intro.classList.remove('opacity-0', 'pointer-events-none');
  }
  function closeOverlay() {
    audio.start(); // needs a user gesture
    switchVehicle(selector.selected);
    playing = true;
    intro.classList.add('opacity-0', 'pointer-events-none');
    canvas.focus();
  }
  startBtn.disabled = false;
  startBtn.textContent = 'Start engine';
  startBtn.addEventListener('click', closeOverlay);

  let activeZone: Zone | null = null;
  function setZone(z: Zone | null) {
    if (z === activeZone) return;
    activeZone = z;
    if (z) {
      panelTitle.textContent = z.title;
      panelBody.innerHTML = z.html;
      audio.zone();
      fx.sparkle(z.pos.clone().setY(z.pos.y + 1.5));
    }
    panel.classList.toggle(PANEL_HIDDEN, !z);
    panel.classList.toggle('translate-x-0', !!z);
  }

  const placeList = [...Object.values(PLACES), STUNT_PAD].sort((a, b) => a.radius - b.radius); // smallest first
  const placeAt = (x: number, z: number) => placeList.find((p) => Math.hypot(x - p.x, z - p.z) < p.radius)?.name ?? null;

  // ---------- Loop ----------
  const clock = new THREE.Clock();
  const dustColor = new THREE.Color();
  const tmp = new THREE.Vector3();
  const back = new THREE.Vector3();
  const focus = new THREE.Vector3();
  let simTime = 0;
  let airTime = 0;
  let lastVy = 0;
  let wasGrounded = true;

  function tick() {
    frame(Math.min(clock.getDelta(), 0.1));
    requestAnimationFrame(tick);
  }

  function frame(dt: number) {
    simTime += dt;
    const t = simTime;
    wind.update(t);

    const vyBefore = vehicle.body.velocity.y;
    vehicle.drive(keys, playing, dt);
    world.step(1 / 60, dt, 3);
    vehicle.sync(dt);
    for (const { mesh, body } of ctx.dynamic) {
      if (body.sleepState !== CANNON.Body.SLEEPING) syncObject(mesh, body.interpolatedPosition, body.interpolatedQuaternion);
    }
    for (const u of ctx.updaters) u(t, dt);
    water.update(t, dt);

    const p = vehicle.body.position;
    const m = vehicle.mesh.position;
    const air = vehicle.info.kind === 'air';
    const ground = terrain.sample(p.x, p.z);
    const speed = vehicle.speed();

    // ---- drowning, crashes, falling out of the world ----
    const sunk = air ? p.y < WATER_Y + 0.6 : p.y < WATER_Y - 0.4;
    if (sunk || vehicle.crashed() || p.y < -30) {
      tmp.set(p.x, WATER_Y + 0.3, p.z);
      if (sunk) {
        water.splash(p.x, p.z);
        fx.splash(tmp);
        audio.splash();
      } else {
        fx.sparks(tmp.set(p.x, p.y, p.z));
        audio.crash();
      }
      hud.toast(sunk ? 'Splash! 🌊' : vehicle.crashed() ? 'Crash! 💥' : 'Whoops');
      respawn();
    }
    safeTimer -= dt;
    if (!air && safeTimer <= 0 && vehicle.grounded() && p.y > WATER_Y + 1 && vehicle.body.velocity.length() < 25) {
      safeTimer = 0.5;
      Object.assign(safe, { x: p.x, z: p.z, yaw: vehicle.heading() });
    }

    // ---- jumps & landings (ground vehicles) ----
    const grounded = vehicle.grounded();
    if (!air) {
      if (vehicle.body.velocity.y - vyBefore > 4 && wasGrounded) audio.jump();
      if (!grounded) airTime += dt;
      else {
        if (airTime > 0.35) {
          const impact = Math.abs(lastVy);
          audio.land(impact);
          groundColor(p.x, p.z, ground, 0, dustColor);
          fx.puff(tmp.set(p.x, ground + 0.3, p.z), dustColor.clone().lerp(new THREE.Color(0xffffff), 0.35), Math.min(impact / 15, 1));
        }
        airTime = 0;
      }
      lastVy = vehicle.body.velocity.y;
    }
    wasGrounded = grounded;

    // ---- particles from the vehicle ----
    const tyres = vehicle.tyres?.();
    if (tyres && speed > 4) {
      for (const pt of tyres.points) {
        const onRoad = net.roadIndex.nearest(pt.x, pt.z, true).dist < 0;
        if (Math.random() < Math.min(1, speed / 18) * (onRoad ? 0.2 : 1)) {
          if (onRoad) dustColor.set(0xd8d0c8);
          else groundColor(pt.x, pt.z, pt.y, 0, dustColor).lerp(new THREE.Color(0xf6e3c6), 0.45);
          fx.dust(tmp.copy(pt).setY(pt.y + 0.2), dustColor.getHex(), 1);
        }
        if (tyres.sliding && speed > 7) fx.smoke(tmp.copy(pt).setY(pt.y + 0.3));
      }
    }
    if (vehicle.info.id === 'jet' && vehicle.throttle() > 0.05) {
      const h = vehicle.heading();
      back.set(-Math.sin(h), 0, -Math.cos(h));
      fx.exhaust(tmp.copy(m).addScaledVector(back, 4.2), back, vehicle.throttle());
    }
    if (vehicle.info.id === 'heli' && vehicle.throttle() > 0.4 && p.y - ground < 9 && ground > WATER_Y) {
      for (let k = 0; k < 2; k++) {
        const a = Math.random() * Math.PI * 2;
        tmp.set(p.x + Math.cos(a) * 3, ground + 0.3, p.z + Math.sin(a) * 3);
        groundColor(tmp.x, tmp.z, ground, 0, dustColor).lerp(new THREE.Color(0xf6e3c6), 0.5);
        fx.emit(tmp, { vel: [Math.cos(a) * 8, 0.6, Math.sin(a) * 8], velJitter: 2, size: [0.6, 1.1], life: [0.5, 0.9], color: dustColor.getHex(), grow: 2.5, drag: 2, alpha: 0.45, windy: 0.3 });
      }
    }

    // ---- laps (ground vehicles only) ----
    if (!air && playing) {
      const event = lap.update(p.x, p.z, performance.now());
      if (event === 'checkpoint') audio.checkpoint();
      if (event === 'lap') {
        audio.lap();
        fx.confetti(tmp.set(p.x, p.y + 2, p.z));
        hud.toast(`Lap ${hud.fmt(lap.state.last)}${lap.state.last === lap.state.best ? ' 🏆 new best!' : ''}`, 3500);
      }
    }

    // ---- camera, environment, UI ----
    camRig.update({ position: m, heading: vehicle.heading(), speed, kind: vehicle.info.id === 'jet' ? 'jet' : vehicle.info.id === 'heli' ? 'heli' : 'ground', scale: vehicle.camScale }, dt);
    focus.copy(m);
    followSun(focus);
    updateGrass(focus, m, !air || p.y - ground < 3);
    updateStreaks(focus, dt);
    updateClouds(dt);
    fx.ambient(focus, dt);
    fx.update(dt);

    const coastGap = coastRadius(p.x, p.z) - Math.hypot(p.x, p.z);
    audio.update(
      { vehicle: vehicle.info.id, speed, throttle: playing ? vehicle.throttle() : 0, grounded, wind: wind.strength, shore: 1 - smoothstep(10, 70, coastGap) },
      dt
    );

    setZone(playing ? updateZones(zones, m, t) : null);
    hud.update(speed * 3.6, lap.state, air, p.y - ground);
    if (playing) hud.place(placeAt(p.x, p.z));
    map.update(p.x, p.z, vehicle.heading(), lap.state.next, t);

    renderer.render(scene, camera);
  }
  tick();

  // Dev-only test hook (stripped from production builds): drive the sim from the console / automation.
  if (import.meta.env.DEV) {
    Object.assign(window, {
      __game: {
        keys,
        get vehicle() {
          return vehicle;
        },
        lap: lap.state,
        map,
        net,
        track,
        audio,
        scene,
        camera,
        /** Advance the game by `seconds` at 60 Hz, regardless of the display's frame rate. */
        run(seconds: number) {
          for (let i = 0; i < Math.round(seconds * 60); i++) frame(1 / 60);
        },
        teleport(x: number, z: number, yaw = 0) {
          vehicle.place(x, terrain.sample(x, z), z, yaw);
          camRig.snap();
        },
        switchVehicle,
        groundAt: terrain.sample,
      },
    });
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
