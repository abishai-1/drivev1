import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { C } from '../palette';
import { type Ctx, shadowed, syncObject } from '../utils';
import { toonSolid as mat } from '../look';
import { GROUND, vehicleInfo } from './presets';
import type { Vehicle } from './types';

const JUMP_COOLDOWN = 0.6;

export function createGroundVehicle(ctx: Ctx, id: keyof typeof GROUND): Vehicle {
  const { scene, world } = ctx;
  const P = GROUND[id];

  const drop = P.comDrop ?? 0; // body origin (= center of mass) sits this far below the chassis center
  const connY = P.wheelY + drop; // wheel mounts relative to the center of mass

  const mesh = new THREE.Group();
  const bodyMesh = P.build(); // squashed on jump, so keep it separate from the wheels
  bodyMesh.position.y = drop;
  mesh.add(bodyMesh);
  scene.add(mesh);

  // low-friction chassis: if it scrapes a crest or kerb it slides over instead of being tripped onto its roof
  const body = new CANNON.Body({ mass: P.mass, allowSleep: false, material: ctx.materials.slide });
  body.addShape(new CANNON.Box(new CANNON.Vec3(...P.half)), new CANNON.Vec3(0, drop, 0));
  body.angularDamping = 0.4;

  const vehicle = new CANNON.RaycastVehicle({ chassisBody: body, indexRightAxis: 0, indexUpAxis: 1, indexForwardAxis: 2 });
  // 0,1 = front (+z), 2,3 = rear
  const corners: [number, number, number][] = [[1, 1, P.gripFront], [-1, 1, P.gripFront], [1, -1, P.gripRear], [-1, -1, P.gripRear]];
  for (const [sx, sz, grip] of corners) {
    vehicle.addWheel({
      radius: P.wheelRadius,
      directionLocal: new CANNON.Vec3(0, -1, 0),
      suspensionStiffness: P.stiffness,
      suspensionRestLength: P.restLength,
      frictionSlip: grip,
      dampingRelaxation: 2.3,
      dampingCompression: 4.4,
      maxSuspensionForce: 1e6,
      rollInfluence: 0.02,
      axleLocal: new CANNON.Vec3(-1, 0, 0),
      maxSuspensionTravel: P.travel,
      customSlidingRotationalSpeed: -30,
      useCustomSlidingRotationalSpeed: true,
      chassisConnectionPointLocal: new CANNON.Vec3(sx * P.wheelX, connY, sz * P.wheelZ),
    });
  }
  vehicle.addToWorld(world);

  // wheels are children of the car mesh so they share its interpolated pose
  const wheelGeo = new THREE.CylinderGeometry(P.wheelRadius, P.wheelRadius, P.wheelWidth, 18).rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(P.wheelRadius * 0.45, P.wheelRadius * 0.45, P.wheelWidth + 0.02, 8).rotateZ(Math.PI / 2);
  const tyre = mat(C.carDark);
  const hub = mat(C.cream);
  const wheelMeshes = vehicle.wheelInfos.map(() => {
    const g = new THREE.Group();
    g.add(shadowed(new THREE.Mesh(wheelGeo, tyre)), new THREE.Mesh(hubGeo, hub));
    mesh.add(g);
    return g;
  });

  let steer = 0;
  let jumpCooldown = 0;
  let squash = 0;
  const fwd = new CANNON.Vec3();
  const localX = new CANNON.Vec3();
  const invQ = new CANNON.Quaternion();
  const localPos = new CANNON.Vec3();
  const localQ = new CANNON.Quaternion();
  const Z = new CANNON.Vec3(0, 0, 1);
  const X = new CANNON.Vec3(1, 0, 0);
  const Y = new CANNON.Vec3(0, 1, 0);
  const up = new CANNON.Vec3();
  const downforce = new CANNON.Vec3();
  const upright = new CANNON.Quaternion();
  let upsideDown = 0;

  // cannon-es resets isInContact inside updateWheelTransform(), so count contacts before sync() calls it
  let touching = 0;
  const countContacts = () => vehicle.wheelInfos.reduce((n, w) => n + (w.isInContact ? 1 : 0), 0);
  let load = 0;
  let handbraking = false;
  const tyrePoints: THREE.Vector3[] = [];
  const tyrePool = [new THREE.Vector3(), new THREE.Vector3()];
  const tyreSlots: (THREE.Vector3 | null)[] = [null, null]; // per rear wheel, null when airborne
  let skidding = false;

  return {
    info: vehicleInfo(id),
    mesh,
    body,
    camScale: P.camScale,

    place(x, y, z, yaw) {
      body.position.set(x, y + P.wheelRadius + P.restLength - connY + 0.3, z);
      body.quaternion.setFromEuler(0, yaw, 0);
      body.velocity.setZero();
      body.angularVelocity.setZero();
      body.previousPosition.copy(body.position);
      body.interpolatedPosition.copy(body.position);
      body.previousQuaternion.copy(body.quaternion);
      body.interpolatedQuaternion.copy(body.quaternion);
    },

    drive(keys, enabled, dt) {
      body.quaternion.vmult(Z, fwd);
      const fwdSpeed = body.velocity.dot(fwd);
      const speed = body.velocity.length();
      const wantFwd = enabled && (keys.forward || keys.up);
      const wantBack = enabled && (keys.back || keys.down);
      const boost = enabled && keys.boost ? 1.5 : 1;

      let force = 0;
      let brake = 0;
      if (wantFwd) {
        if (fwdSpeed < -1.5) brake = 14; // moving backwards: brake first
        else if (fwdSpeed < P.maxSpeed * boost) force = -P.engine * boost; // negative = +z forward
      } else if (wantBack) {
        if (fwdSpeed > 1.5) brake = 14; // moving forwards: brake first, then reverse
        else if (fwdSpeed > -P.maxSpeed * 0.4) force = P.engine * 0.6;
      } else {
        brake = 0.4; // gentle coasting drag
      }

      // stability (arcade): downforce keeps the car planted; unless you're on the handbrake, sideways sliding
      // bleeds off and the turn rate is capped by speed, so a hard turn carves instead of spinning out
      if (touching >= 2) {
        body.applyForce(downforce.set(0, -P.mass * Math.min(speed, 40) * 0.25, 0));
        if (!(enabled && keys.handbrake)) {
          body.quaternion.vmult(X, localX);
          const lateral = body.velocity.dot(localX);
          body.velocity.vsub(localX.scale(lateral * (1 - Math.exp(-3 * dt))), body.velocity);
          const maxYaw = Math.min(2.4, 24 / Math.max(speed, 1));
          body.angularVelocity.y = THREE.MathUtils.clamp(body.angularVelocity.y, -maxYaw, maxYaw);
          if (!keys.left && !keys.right) body.angularVelocity.y *= Math.exp(-4 * dt);
        }
      }
      // anti-roll: on the ground, ease the car back upright and soak up roll/pitch spin, so cambered roads,
      // kerbs and junction lips can't tip it over (jumps and air control are untouched)
      body.quaternion.vmult(Y, up);
      if (touching >= 1) {
        const k = 9 * dt;
        body.angularVelocity.x += -up.z * k;
        body.angularVelocity.z += up.x * k;
        const damp = Math.exp(-3 * dt);
        body.angularVelocity.x *= damp;
        body.angularVelocity.z *= damp;
      }
      // stuck on its side or roof: flip back onto the wheels after a moment
      upsideDown = up.y < 0.35 && speed < 4 ? upsideDown + dt : 0;
      if (upsideDown > 1.2) {
        upsideDown = 0;
        body.position.y += 1.2;
        body.quaternion.copy(upright.setFromEuler(0, Math.atan2(fwd.x, fwd.z), 0));
        body.angularVelocity.setZero();
        body.velocity.setZero();
      }

      vehicle.applyEngineForce(force, 2);
      vehicle.applyEngineForce(force, 3);
      load = THREE.MathUtils.damp(load, Math.abs(force) / P.engine, 6, dt);

      const limit = P.steer * THREE.MathUtils.clamp(1 - speed / 38, 0.22, 1); // calmer steering at speed
      const want = enabled ? (keys.left ? limit : 0) + (keys.right ? -limit : 0) : 0;
      steer = THREE.MathUtils.damp(steer, want, 10, dt);
      vehicle.setSteeringValue(steer, 0);
      vehicle.setSteeringValue(steer, 1);

      const handbrake = enabled && keys.handbrake;
      handbraking = handbrake;
      for (let i = 0; i < 4; i++) vehicle.setBrake(brake, i);
      vehicle.wheelInfos[2].frictionSlip = vehicle.wheelInfos[3].frictionSlip = handbrake ? P.gripRear * 0.45 : P.gripRear;
      if (handbrake) {
        vehicle.setBrake(25, 2);
        vehicle.setBrake(25, 3);
      }

      // jump
      jumpCooldown -= dt;
      if (enabled && keys.jump && touching >= 2 && jumpCooldown <= 0) {
        body.velocity.y += P.jump;
        jumpCooldown = JUMP_COOLDOWN;
        squash = 1;
      }

      // a little air control
      if (touching === 0 && enabled) {
        const turn = (keys.left ? 1 : 0) - (keys.right ? 1 : 0);
        const pitch = (wantFwd ? 1 : 0) - (wantBack ? 1 : 0); // + about local x = nose down
        body.angularVelocity.y += turn * 4 * dt;
        body.quaternion.vmult(X, localX);
        body.angularVelocity.vadd(localX.scale(pitch * 3 * dt), body.angularVelocity);
      }
    },

    sync(dt) {
      touching = countContacts();
      // rear tyre contact points (before updateWheelTransform clears the contact flags)
      tyrePoints.length = 0;
      tyreSlots[0] = tyreSlots[1] = null;
      skidding = handbraking;
      for (const i of [2, 3]) {
        const w = vehicle.wheelInfos[i];
        if (!w.isInContact) continue;
        const h = w.raycastResult.hitPointWorld;
        tyrePoints.push(tyrePool[i - 2].set(h.x, h.y, h.z));
        tyreSlots[i - 2] = tyrePool[i - 2];
        if (w.sliding) skidding = true;
      }
      syncObject(mesh, body.interpolatedPosition, body.interpolatedQuaternion);
      squash = Math.max(0, squash - dt * 5);
      bodyMesh.scale.set(1 + squash * 0.08, 1 - squash * 0.18, 1 + squash * 0.08);
      body.quaternion.conjugate(invQ);
      vehicle.wheelInfos.forEach((w, i) => {
        vehicle.updateWheelTransform(i);
        w.worldTransform.position.vsub(body.position, localPos);
        invQ.vmult(localPos, localPos);
        invQ.mult(w.worldTransform.quaternion, localQ);
        syncObject(wheelMeshes[i], localPos, localQ);
      });
    },

    dispose() {
      vehicle.removeFromWorld(world);
      scene.remove(mesh);
    },

    speed: () => body.velocity.length(),
    heading() {
      body.quaternion.vmult(Z, fwd);
      return Math.atan2(fwd.x, fwd.z);
    },
    grounded: () => touching >= 2,
    crashed: () => false,
    throttle: () => load,
    tyres: () => ({ points: tyrePoints, slots: tyreSlots, sliding: skidding }),
  };
}
