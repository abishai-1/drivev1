// Arcade flight: real collisions, but orientation and velocity are steered directly (no aerodynamics).
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { C } from '../palette';
import type { Keys } from '../input';
import { type Ctx, mat, shadowed, syncObject } from '../utils';
import { vehicleInfo } from './presets';
import type { Vehicle } from './types';

const G = 20; // matches world gravity
const AIRCRAFT_GROUP = 2;
const STEP = 1 / 60;
const Z = new CANNON.Vec3(0, 0, 1);
const NO_KEYS: Keys = { forward: false, back: false, left: false, right: false, up: false, down: false, jump: false, handbrake: false, boost: false };

const box = (w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0) => {
  const m = shadowed(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color)));
  m.position.set(x, y, z);
  return m;
};

/**
 * Shared plumbing: body, preStep hook, ground probe, crash detection, interpolated sync.
 * The airframe box never touches the ground (box-vs-heightfield contacts snag on the terrain's triangle
 * prisms). It stands on gear instead: 'skids' = sphere colliders (fine for landing), 'wheels' = raycast
 * wheels like the cars (needed to roll down a runway).
 */
function airframe(
  ctx: Ctx,
  mass: number,
  half: [number, number, number],
  gear: [number, number][],
  mesh: THREE.Group,
  gearType: 'skids' | 'wheels'
) {
  const SKID_R = 0.45;
  const WHEEL_R = 0.4;
  const WHEEL_REST = 0.35;
  const bottom = gearType === 'skids' ? half[1] + SKID_R : half[1] + WHEEL_REST + WHEEL_R; // origin → lowest point
  const body = new CANNON.Body({
    mass,
    material: ctx.materials.slide,
    allowSleep: false,
    linearDamping: 0.05,
    collisionFilterGroup: AIRCRAFT_GROUP, // lets the ground probe ignore our own shapes
  });
  body.addShape(new CANNON.Box(new CANNON.Vec3(...half)));
  let wheels: CANNON.RaycastVehicle | null = null;
  if (gearType === 'skids') {
    for (const [x, z] of gear) body.addShape(new CANNON.Sphere(SKID_R), new CANNON.Vec3(x, -half[1], z));
  } else {
    wheels = new CANNON.RaycastVehicle({ chassisBody: body, indexRightAxis: 0, indexUpAxis: 1, indexForwardAxis: 2 });
    for (const [x, z] of gear) {
      wheels.addWheel({
        radius: WHEEL_R,
        directionLocal: new CANNON.Vec3(0, -1, 0),
        axleLocal: new CANNON.Vec3(-1, 0, 0),
        chassisConnectionPointLocal: new CANNON.Vec3(x, -half[1], z),
        suspensionRestLength: WHEEL_REST,
        suspensionStiffness: 40,
        maxSuspensionTravel: 0.3,
        dampingRelaxation: 2.3,
        dampingCompression: 4.4,
        maxSuspensionForce: 1e6,
        frictionSlip: 3,
        rollInfluence: 0.01,
      });
    }
    wheels.addToWorld(ctx.world);
  }
  ctx.world.addBody(body);
  ctx.scene.add(mesh);

  let crashed = false;
  let armed = 0; // ignore impacts right after spawning
  const onCollide = (e: { contact: CANNON.ContactEquation }) => {
    if (armed > 0) return;
    if (Math.abs(e.contact.getImpactVelocityAlongNormal()) > 13) crashed = true;
  };
  body.addEventListener('collide', onCollide);

  const ray = new CANNON.RaycastResult();
  const from = new CANNON.Vec3();
  const to = new CANNON.Vec3();
  /**
   * Gap between the gear's rest position and whatever is below (≤ 0 when sitting on it; Infinity if > 60 m).
   * Cast from the body's center: compressed suspension can put the "lowest point" below the surface.
   */
  const groundGap = () => {
    from.copy(body.position);
    to.set(from.x, from.y - 60, from.z);
    ray.reset();
    ctx.world.raycastClosest(from, to, { skipBackfaces: true, collisionFilterMask: ~AIRCRAFT_GROUP }, ray);
    return ray.hasHit ? ray.distance - bottom : Infinity;
  };

  return {
    body,
    wheels,
    groundGap,
    tick(dt: number) {
      armed -= dt;
    },
    isCrashed: () => crashed,
    place(x: number, y: number, z: number, yaw: number) {
      body.position.set(x, y + bottom + 0.2, z);
      body.quaternion.setFromEuler(0, yaw, 0);
      body.velocity.setZero();
      body.angularVelocity.setZero();
      body.previousPosition.copy(body.position);
      body.interpolatedPosition.copy(body.position);
      body.previousQuaternion.copy(body.quaternion);
      body.interpolatedQuaternion.copy(body.quaternion);
      crashed = false;
      armed = 1;
    },
    sync() {
      syncObject(mesh, body.interpolatedPosition, body.interpolatedQuaternion);
    },
    dispose(hook: () => void) {
      ctx.world.removeEventListener('preStep', hook);
      wheels?.removeFromWorld(ctx.world);
      body.removeEventListener('collide', onCollide);
      ctx.world.removeBody(body);
      ctx.scene.remove(mesh);
    },
  };
}

const forwardOf = (body: CANNON.Body, out: CANNON.Vec3) => body.quaternion.vmult(Z, out);
const headingOf = (body: CANNON.Body) => {
  const f = body.quaternion.vmult(Z);
  return Math.atan2(f.x, f.z);
};

// ---------- Helicopter ----------
export function createHeli(ctx: Ctx): Vehicle {
  const mesh = new THREE.Group();
  mesh.add(
    box(2, 1.6, 3, 0x2f7d6d, 0, 0.1, 0.2),
    box(1.8, 1, 1.2, 0x5b6f8a, 0, 0.35, 1.3), // windscreen
    box(0.4, 0.4, 4, 0x2f7d6d, 0, 0.4, -3.2), // tail boom
    box(0.12, 1.1, 0.8, C.car, 0, 0.9, -5), // tail fin
    box(0.15, 0.15, 3.6, C.carDark, 0.75, -0.95, 0.2), // skids
    box(0.15, 0.15, 3.6, C.carDark, -0.75, -0.95, 0.2)
  );
  const rotor = new THREE.Group();
  rotor.add(box(9, 0.06, 0.35, C.carDark), box(0.35, 0.06, 9, C.carDark), box(0.4, 0.5, 0.4, C.carDark, 0, -0.25, 0));
  rotor.position.y = 1.25;
  const tailRotor = new THREE.Group();
  tailRotor.add(box(0.05, 1.8, 0.2, C.carDark));
  tailRotor.position.set(0.2, 0.9, -5);
  mesh.add(rotor, tailRotor);

  const frame = airframe(ctx, 300, [1, 0.8, 1.6], [[0.75, 1.2], [-0.75, 1.2], [0.75, -0.9], [-0.75, -0.9]], mesh, 'skids');
  const { body } = frame;
  let keys = NO_KEYS;
  let enabled = false;
  let yaw = 0;
  let pitch = 0;
  let roll = 0;
  let spin = 0;

  const hook = () => {
    const climb = (keys.jump ? 1 : 0) - (keys.handbrake ? 1 : 0);
    const fwdIn = (keys.forward || keys.up ? 1 : 0) - (keys.back || keys.down ? 1 : 0);
    const turn = (keys.left ? 1 : 0) - (keys.right ? 1 : 0);
    const landed = frame.groundGap() < 0.25;
    const engine = enabled && (climb !== 0 || fwdIn !== 0 || turn !== 0 || !landed);
    spin = THREE.MathUtils.damp(spin, engine ? 1 : 0.15, 1.5, STEP);

    if (engine) {
      body.applyForce(new CANNON.Vec3(0, body.mass * G, 0)); // hover: cancel gravity
      const top = keys.boost ? 42 : 26;
      const tx = Math.sin(yaw) * fwdIn * top;
      const tz = Math.cos(yaw) * fwdIn * top;
      const ty = climb > 0 ? 11 : climb < 0 ? -9 : 0;
      const k = 1 - Math.exp(-1.6 * STEP);
      body.velocity.x += (tx - body.velocity.x) * k;
      body.velocity.z += (tz - body.velocity.z) * k;
      body.velocity.y += (ty - body.velocity.y) * (1 - Math.exp(-3 * STEP));
      yaw += turn * 1.5 * STEP;
    }
    pitch = THREE.MathUtils.damp(pitch, engine ? fwdIn * 0.22 : 0, 3, STEP);
    roll = THREE.MathUtils.damp(roll, engine ? -turn * 0.18 : 0, 3, STEP);
    body.quaternion.setFromEuler(pitch, yaw, roll, 'YXZ');
    body.angularVelocity.setZero();
  };
  ctx.world.addEventListener('preStep', hook);

  return {
    info: vehicleInfo('heli'),
    mesh,
    body,
    camScale: 1.7,
    drive(k, on, dt) {
      keys = on ? k : NO_KEYS;
      enabled = on;
      frame.tick(dt);
    },
    sync(dt) {
      frame.sync();
      rotor.rotation.y += spin * 28 * dt;
      tailRotor.rotation.x += spin * 34 * dt;
    },
    place(x, y, z, h) {
      yaw = h;
      pitch = roll = 0;
      frame.place(x, y, z, h);
    },
    dispose: () => frame.dispose(hook),
    speed: () => body.velocity.length(),
    heading: () => headingOf(body),
    grounded: () => frame.groundGap() < 0.4,
    crashed: frame.isCrashed,
    throttle: () => spin,
  };
}

// ---------- Jet ----------
export function createJet(ctx: Ctx): Vehicle {
  const mesh = new THREE.Group();
  const fuselage = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.9, 7, 14).rotateX(Math.PI / 2), mat(C.cream)));
  const nose = shadowed(new THREE.Mesh(new THREE.ConeGeometry(0.75, 2, 14).rotateX(Math.PI / 2), mat(C.car)));
  nose.position.z = 4.5;
  const canopy = shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x5b6f8a)));
  canopy.scale.set(1, 0.8, 2.2);
  canopy.position.set(0, 0.55, 1.8);
  const glow = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.7, 0.3, 14).rotateX(Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xffb36b, emissive: 0xff7a2a, emissiveIntensity: 0 })
  );
  glow.position.z = -3.6;
  mesh.add(
    fuselage,
    nose,
    canopy,
    glow,
    box(9, 0.15, 2.2, C.car, 0, -0.1, -0.2), // wings
    box(3.6, 0.12, 1, C.car, 0, 0.1, -3.1), // tail plane
    box(0.15, 1.6, 1.2, C.car, 0, 0.9, -3.1), // fin
    box(0.15, 0.6, 0.15, C.carDark, 0, -0.95, 2.2), // gear
    box(0.15, 0.6, 0.15, C.carDark, 1.2, -0.95, -0.6),
    box(0.15, 0.6, 0.15, C.carDark, -1.2, -0.95, -0.6)
  );

  const frame = airframe(ctx, 400, [1.2, 0.6, 3.6], [[0, 2.2], [1.2, -0.6], [-1.2, -0.6]], mesh, 'wheels');
  const { body } = frame;
  let keys = NO_KEYS;
  let throttle = 0;
  let yaw = 0;
  let pitch = 0;
  let roll = 0;
  const fwd = new CANNON.Vec3();

  const hook = () => {
    const thr = (keys.forward ? 1 : 0) - (keys.back ? 1 : 0);
    const turn = (keys.left ? 1 : 0) - (keys.right ? 1 : 0);
    const pull = (keys.down ? 1 : 0) - (keys.up ? 1 : 0); // flight-stick style: ↓ = pull back (climb), ↑ = push (dive)
    throttle = THREE.MathUtils.clamp(throttle + thr * 0.6 * STEP, 0, 1);
    const burner = keys.boost ? 1.5 : 1;

    forwardOf(body, fwd);
    const speed = body.velocity.dot(fwd);
    const onGround = frame.groundGap() < 0.5;
    const lift = THREE.MathUtils.clamp((speed - 22) / 16, 0, 1);

    // top speed ≈ thrust / drag = 18 / 0.26 ≈ 70 m/s (≈105 with afterburner)
    body.applyForce(fwd.scale(throttle * burner * body.mass * 18));
    body.applyForce(new CANNON.Vec3(0, body.mass * G * lift, 0));
    body.applyForce(body.velocity.scale(-body.mass * 0.26)); // drag

    // in the air, keep velocity pointing where the nose points (arcade); on the ground the wheels do this
    if (!onGround) {
      const lateral = body.velocity.vsub(fwd.scale(speed));
      body.velocity.vsub(lateral.scale((1 - Math.exp(-2.5 * STEP)) * lift), body.velocity);
    }
    const brake = onGround && throttle === 0 && keys.back ? 12 : 0.05;
    frame.wheels?.wheelInfos.forEach((_, i) => frame.wheels?.setBrake(brake, i));

    if (onGround) {
      yaw += turn * 0.9 * STEP * Math.min(Math.abs(speed) / 6, 1);
      roll = THREE.MathUtils.damp(roll, 0, 6, STEP);
      const rotate = speed > 24 && pull > 0 ? -0.22 : 0; // rotate for takeoff
      pitch = THREE.MathUtils.damp(pitch, rotate, 3, STEP);
    } else {
      roll = THREE.MathUtils.damp(roll, -turn * 0.85, 2.5, STEP);
      yaw += -roll * 1.1 * STEP * (0.3 + lift * 0.7);
      pitch = THREE.MathUtils.clamp(pitch - pull * 0.9 * STEP, -0.9, 0.9);
      if (lift < 0.35) pitch = THREE.MathUtils.damp(pitch, 0.35, 0.8, STEP); // stall: nose drops
    }
    body.quaternion.setFromEuler(pitch, yaw, roll, 'YXZ');
    body.angularVelocity.setZero();
  };
  ctx.world.addEventListener('preStep', hook);

  return {
    info: vehicleInfo('jet'),
    mesh,
    body,
    camScale: 1.6,
    drive(k, on, dt) {
      keys = on ? k : NO_KEYS;
      frame.tick(dt);
    },
    sync() {
      frame.sync();
      glow.material.emissiveIntensity = throttle * (keys.boost ? 3 : 1.6);
    },
    place(x, y, z, h) {
      yaw = h;
      pitch = roll = 0;
      throttle = 0;
      frame.place(x, y, z, h);
    },
    dispose: () => frame.dispose(hook),
    speed: () => body.velocity.length(),
    heading: () => headingOf(body),
    grounded: () => frame.groundGap() < 0.6,
    crashed: frame.isCrashed,
    throttle: () => throttle,
  };
}
