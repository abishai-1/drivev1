import * as THREE from 'three';
import { C } from '../palette';
import { mat, shadowed } from '../utils';
import type { VehicleId, VehicleInfo } from './types';

export const VEHICLES: VehicleInfo[] = [
  { id: 'jeep', name: 'Jeep', icon: '🚙', kind: 'ground', blurb: 'Balanced all-rounder.', stats: { speed: 3, grip: 3, jump: 3 } },
  { id: 'sports', name: 'Sports car', icon: '🏎️', kind: 'ground', blurb: 'Fast and grippy on tarmac.', stats: { speed: 5, grip: 5, jump: 2 } },
  { id: 'monster', name: 'Monster truck', icon: '🛻', kind: 'ground', blurb: 'Climbs anything, huge jumps.', stats: { speed: 2, grip: 3, jump: 5 } },
  { id: 'buggy', name: 'Buggy', icon: '🏁', kind: 'ground', blurb: 'Light, loose and drifty.', stats: { speed: 4, grip: 2, jump: 4 } },
  { id: 'heli', name: 'Helicopter', icon: '🚁', kind: 'air', blurb: 'Hover anywhere. Spawns at the airport.', stats: { speed: 3, grip: 4, jump: 5 } },
  { id: 'jet', name: 'Jet', icon: '✈️', kind: 'air', blurb: 'Take off from the runway. Fastest.', stats: { speed: 5, grip: 2, jump: 5 } },
];

export const vehicleInfo = (id: VehicleId) => {
  const v = VEHICLES.find((x) => x.id === id);
  if (!v) throw new Error(`Unknown vehicle ${id}`);
  return v;
};

export interface GroundPreset {
  /** Chassis half extents. */
  half: [number, number, number];
  mass: number;
  wheelRadius: number;
  wheelWidth: number;
  /** Wheel connection points (x = half track, z = half wheelbase, y = height on chassis). */
  wheelX: number;
  wheelZ: number;
  wheelY: number;
  restLength: number;
  travel: number;
  stiffness: number;
  gripFront: number;
  gripRear: number;
  engine: number;
  maxSpeed: number; // m/s
  steer: number;
  jump: number; // m/s added on jump
  camScale: number;
  /**
   * Lowers the center of mass this far below the chassis box center. cannon-es applies drive force at the
   * tyre contact point, so a tall vehicle with a high center of mass wheelies over; this shortens the lever.
   */
  comDrop?: number;
  build(): THREE.Group;
}

const box = (w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0) => {
  const m = shadowed(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color)));
  m.position.set(x, y, z);
  return m;
};
const headlights = (g: THREE.Group, x: number, y: number, z: number) => {
  const lm = new THREE.MeshStandardMaterial({ color: 0xfff2b0, emissive: 0xffe27a, emissiveIntensity: 0.8 });
  for (const s of [-1, 1]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.16, 0.06), lm);
    l.position.set(s * x, y, z);
    g.add(l);
  }
};

export const GROUND: Record<'jeep' | 'sports' | 'monster' | 'buggy', GroundPreset> = {
  jeep: {
    half: [0.9, 0.35, 1.6], mass: 150, wheelRadius: 0.45, wheelWidth: 0.38, wheelX: 0.85, wheelZ: 1.15, wheelY: 0,
    restLength: 0.4, travel: 0.3, stiffness: 32, gripFront: 2.2, gripRear: 2.2, engine: 1200, maxSpeed: 32, steer: 0.55,
    jump: 8, camScale: 1,
    build() {
      const g = new THREE.Group();
      g.add(box(1.8, 0.6, 3.2, C.car), box(1.5, 0.6, 1.5, C.cream, 0, 0.6, -0.25), box(1.52, 0.42, 0.05, C.carDark, 0, 0.62, 0.51));
      g.add(box(1.9, 0.25, 0.25, C.carDark, 0, -0.2, 1.62), box(1.9, 0.25, 0.25, C.carDark, 0, -0.2, -1.62));
      g.add(box(0.04, 1, 0.04, C.carDark, 0.55, 1.3, -0.8), box(0.02, 0.22, 0.35, C.leaf, 0.55, 1.7, -0.98));
      headlights(g, 0.6, 0.05, 1.61);
      return g;
    },
  },
  sports: {
    half: [0.95, 0.25, 2.0], mass: 130, wheelRadius: 0.38, wheelWidth: 0.42, wheelX: 0.9, wheelZ: 1.35, wheelY: 0,
    restLength: 0.3, travel: 0.2, stiffness: 46, gripFront: 3.0, gripRear: 3.0, engine: 1700, maxSpeed: 46, steer: 0.45,
    jump: 6, camScale: 1.05, comDrop: 0.25,
    build() {
      const g = new THREE.Group();
      g.add(box(1.9, 0.45, 4, 0x2f7d6d), box(1.5, 0.4, 1.7, C.carDark, 0, 0.4, -0.2));
      const nose = box(1.9, 0.25, 0.9, 0x2f7d6d, 0, -0.05, 2.1);
      g.add(nose, box(1.9, 0.08, 0.5, C.carDark, 0, 0.75, -1.85), box(0.1, 0.4, 0.1, C.carDark, -0.6, 0.5, -1.85), box(0.1, 0.4, 0.1, C.carDark, 0.6, 0.5, -1.85));
      g.add(box(0.3, 0.46, 4.02, C.cream, 0, 0, 0)); // racing stripe
      headlights(g, 0.7, 0.05, 2.56);
      return g;
    },
  },
  monster: {
    half: [1.2, 0.55, 1.9], mass: 260, wheelRadius: 0.95, wheelWidth: 0.8, wheelX: 1.45, wheelZ: 1.4, wheelY: -0.2,
    restLength: 0.7, travel: 0.55, stiffness: 18, gripFront: 2.6, gripRear: 2.6, engine: 2600, maxSpeed: 27, steer: 0.5,
    jump: 13, camScale: 1.35, comDrop: 0.9,
    build() {
      const g = new THREE.Group();
      g.add(box(2.2, 0.9, 3.8, 0x7a4fd1), box(2, 0.8, 1.6, C.cream, 0, 0.85, -0.3), box(2.02, 0.55, 0.05, C.carDark, 0, 0.9, 0.51));
      g.add(box(2.6, 0.3, 0.4, C.carDark, 0, -0.35, 2), box(2.6, 0.3, 0.4, C.carDark, 0, -0.35, -2));
      g.add(box(2.2, 0.15, 0.4, C.gold, 0, 1.33, -0.3)); // light bar
      headlights(g, 0.75, 0.15, 1.91);
      return g;
    },
  },
  buggy: {
    // light and nimble, but with balanced grip so it doesn't spin out (handbrake still drifts it)
    half: [0.85, 0.3, 1.4], mass: 115, wheelRadius: 0.52, wheelWidth: 0.42, wheelX: 1.0, wheelZ: 1.15, wheelY: 0,
    restLength: 0.45, travel: 0.35, stiffness: 30, gripFront: 2.7, gripRear: 2.5, engine: 1050, maxSpeed: 36, steer: 0.48,
    jump: 10, camScale: 0.95,
    build() {
      const g = new THREE.Group();
      g.add(box(1.4, 0.3, 2.6, C.gold), box(0.7, 0.5, 0.6, C.carDark, 0, 0.35, -0.2));
      // roll cage
      for (const s of [-1, 1]) {
        g.add(box(0.08, 1.1, 0.08, C.carDark, s * 0.6, 0.7, 0.4), box(0.08, 1.1, 0.08, C.carDark, s * 0.6, 0.7, -0.8));
        g.add(box(0.08, 0.08, 1.3, C.carDark, s * 0.6, 1.25, -0.2));
      }
      g.add(box(1.28, 0.08, 0.08, C.carDark, 0, 1.25, 0.4), box(1.28, 0.08, 0.08, C.carDark, 0, 1.25, -0.8));
      g.add(box(0.5, 0.35, 0.5, C.car, 0, 0.2, -1.2)); // engine
      headlights(g, 0.4, 0.1, 1.31);
      return g;
    },
  },
};
