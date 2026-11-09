import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { C } from './palette';
import { type Ctx, mat, shadowed, syncObject } from './utils';
import type { Keys } from './input';

const MAX_FORCE = 1100;
const MAX_STEER = 0.55;
const SPAWN = new CANNON.Vec3(0, 2, 0);

export interface Car {
  mesh: THREE.Group;
  body: CANNON.Body;
  reset(toSpawn?: boolean): void;
  /** Apply controls before the physics step. */
  drive(keys: Keys, enabled: boolean, dt: number): void;
  /** Copy physics state to meshes after the physics step. */
  sync(): void;
}

export function createCar({ scene, world }: Ctx): Car {
  const body = new CANNON.Body({ mass: 150, allowSleep: false });
  body.addShape(new CANNON.Box(new CANNON.Vec3(0.9, 0.35, 1.6)));
  body.angularDamping = 0.4;
  body.position.copy(SPAWN);

  const vehicle = new CANNON.RaycastVehicle({
    chassisBody: body,
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
  const wheelPositions: [number, number][] = [[0.85, 1.15], [-0.85, 1.15], [0.85, -1.15], [-0.85, -1.15]];
  for (const [x, z] of wheelPositions) {
    vehicle.addWheel({ ...wheelBase, chassisConnectionPointLocal: new CANNON.Vec3(x, 0, z) });
  }
  vehicle.addToWorld(world);

  const mesh = buildCarMesh();
  scene.add(mesh);

  const wheelGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.38, 16).rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.4, 8).rotateZ(Math.PI / 2);
  const wheelMeshes = vehicle.wheelInfos.map(() => {
    const g = new THREE.Group();
    g.add(shadowed(new THREE.Mesh(wheelGeo, mat(C.carDark))));
    g.add(new THREE.Mesh(hubGeo, mat(C.cream)));
    scene.add(g);
    return g;
  });

  let steer = 0;

  return {
    mesh,
    body,

    reset(toSpawn = false) {
      const euler = new CANNON.Vec3();
      body.quaternion.toEuler(euler);
      if (toSpawn) {
        body.position.copy(SPAWN);
        body.quaternion.set(0, 0, 0, 1);
      } else {
        body.position.y += 2;
        body.quaternion.setFromEuler(0, euler.y, 0);
      }
      body.velocity.setZero();
      body.angularVelocity.setZero();
    },

    drive(keys, enabled, dt) {
      const speed = body.velocity.length();
      const boost = keys.boost ? 1.8 : 1;
      let force = 0;
      if (enabled) {
        if (keys.forward) force = -MAX_FORCE * boost; // negative = +z forward in this setup
        if (keys.back) force = MAX_FORCE * 0.6;
      }
      vehicle.applyEngineForce(force, 2);
      vehicle.applyEngineForce(force, 3);

      // steer less at high speed so it doesn't flip
      const limit = MAX_STEER * THREE.MathUtils.clamp(1 - speed / 40, 0.35, 1);
      const want = enabled ? (keys.left ? limit : 0) + (keys.right ? -limit : 0) : 0;
      steer = THREE.MathUtils.damp(steer, want, 10, dt);
      vehicle.setSteeringValue(steer, 0);
      vehicle.setSteeringValue(steer, 1);

      const coasting = !keys.forward && !keys.back;
      const brake = keys.brake ? 12 : coasting ? 1.2 : 0;
      for (let i = 0; i < 4; i++) vehicle.setBrake(brake, i);
    },

    sync() {
      if (body.position.y < -10) this.reset(true);
      syncObject(mesh, body.position, body.quaternion);
      vehicle.wheelInfos.forEach((w, i) => {
        vehicle.updateWheelTransform(i);
        syncObject(wheelMeshes[i], w.worldTransform.position, w.worldTransform.quaternion);
      });
    },
  };
}

function buildCarMesh(): THREE.Group {
  const car = new THREE.Group();
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
    car.add(l);
  }
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 4), mat(C.carDark));
  antenna.position.set(0.55, 1.3, -0.8);
  const flag = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.22, 0.35), mat(C.leaf));
  flag.position.set(0.55, 1.7, -0.98);
  car.add(body, cabin, windshield, bumper, rearBumper, antenna, flag);
  return car;
}
