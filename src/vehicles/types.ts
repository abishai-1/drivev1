import type * as THREE from 'three';
import type * as CANNON from 'cannon-es';
import type { Keys } from '../input';

export type VehicleId = 'jeep' | 'sports' | 'monster' | 'buggy' | 'heli' | 'jet';

export interface VehicleInfo {
  id: VehicleId;
  name: string;
  icon: string;
  blurb: string;
  kind: 'ground' | 'air';
  /** 1-5 for the selector cards. */
  stats: { speed: number; grip: number; jump: number };
}

export interface Vehicle {
  info: VehicleInfo;
  mesh: THREE.Object3D;
  body: CANNON.Body;
  /** Apply controls before the physics step. */
  drive(keys: Keys, enabled: boolean, dt: number): void;
  /** Copy physics state to meshes after the physics step. */
  sync(dt: number): void;
  /** Teleport, upright, facing `yaw` (forward = (sin yaw, 0, cos yaw)). */
  place(x: number, y: number, z: number, yaw: number): void;
  dispose(): void;
  speed(): number;
  heading(): number;
  grounded(): boolean;
  /** True after a hard crash (aircraft) — main loop respawns. */
  crashed(): boolean;
  /** 0..1 engine load, for sound and exhaust. */
  throttle(): number;
  /** Ground vehicles: where the rear tyres touch the ground (for dust), and whether they're skidding. */
  tyres?(): { points: THREE.Vector3[]; slots: (THREE.Vector3 | null)[]; sliding: boolean };
  /** Distance the follow camera should sit back (scales with size). */
  camScale: number;
}
