// Canyon stunt run: fly through numbered hoops over the stunt park's ramps, against the clock.
import * as THREE from 'three';
import { STUNT_PAD } from './layout';
import { type Ctx, makeLabel } from './utils';
import { outline } from './look';
import { glow } from './sky';
import type { RunState } from './hud';

const BEST_KEY = 'drivefolio.stuntBest';
const TIME_LIMIT = 90;

/** [dx, dz, height of the hoop center above ground, yaw] relative to the stunt pad. */
const GATES: [number, number, number, number][] = [
  [-10, -26, 3.4, 0], // start, lined up with the kicker
  [-10, -1, 4.6, 0], // over the kicker's landing
  [12, 0, 3.4, 0], // through the half-pipe
  [-26, 8, 3.4, Math.PI / 2], // line up with the east ramp
  [0, 8, 4.4, Math.PI / 2], // off the east ramp
  [8, -24, 3.4, Math.PI], // finish, by the steep launcher
];

export function createStuntRun(ctx: Ctx) {
  let best: number | null = null;
  try {
    const v = Number(localStorage.getItem(BEST_KEY));
    best = v > 0 ? v : null;
  } catch {
    /* no saved best */
  }

  const idle = new THREE.MeshStandardMaterial({ color: 0xfff7ec, emissive: 0x000000, roughness: 0.6 });
  const next = glow(new THREE.MeshStandardMaterial({ color: 0xf2b134, emissive: 0xc77d10, emissiveIntensity: 0.5, roughness: 0.4 }), 0xffc04a, 0.5, 1.6);
  const geo = new THREE.TorusGeometry(3.2, 0.32, 10, 36);
  const gates = GATES.map(([dx, dz, lift, yaw], i) => {
    const x = STUNT_PAD.x + dx;
    const z = STUNT_PAD.z + dz;
    const y = ctx.terrain.sample(x, z) + lift;
    const ring = outline(new THREE.Mesh(geo, idle));
    ring.castShadow = true;
    ring.position.set(x, y, z);
    ring.rotation.y = yaw;
    const label = makeLabel(i === 0 ? 'Stunt run ▶' : i === GATES.length - 1 ? 'Finish' : String(i), i === 0 ? '#2f7d6d' : '#e8604c', i === 0 ? 1 : 0.6);
    label.position.set(x, y + 4.6, z);
    ctx.scene.add(ring, label);
    return { ring, label, pos: new THREE.Vector3(x, y, z) };
  });

  const state: RunState = { active: false, name: 'Stunt run', time: 0, best, next: 0, total: GATES.length };
  let startedAt = 0;
  const paint = () =>
    gates.forEach((g, i) => {
      g.ring.material = i === state.next || (!state.active && i === 0) ? next : idle;
      g.ring.visible = !state.active || i >= state.next;
    });
  paint();
  ctx.updaters.push((t) => gates.forEach((g, i) => (g.ring.rotation.z = Math.sin(t * 1.5 + i) * 0.06)));

  return {
    state,
    start: gates[0].pos,
    /** Returns 'start' | 'gate' | 'finish' | 'timeout' when something happens. */
    update(at: THREE.Vector3, now: number): 'start' | 'gate' | 'finish' | 'timeout' | null {
      if (state.active) {
        state.time = (now - startedAt) / 1000;
        if (state.time > TIME_LIMIT) {
          state.active = false;
          state.next = 0;
          paint();
          return 'timeout';
        }
      }
      const target = state.active ? state.next : 0;
      const g = gates[target].pos;
      if (Math.hypot(at.x - g.x, at.z - g.z) > 4.2 || Math.abs(at.y - g.y) > 4.5) return null;
      if (!state.active) {
        state.active = true;
        startedAt = now;
        state.time = 0;
        state.next = 1;
        paint();
        return 'start';
      }
      state.next++;
      if (state.next >= gates.length) {
        state.active = false;
        state.next = 0;
        if (state.best === null || state.time < state.best) {
          state.best = state.time;
          try {
            localStorage.setItem(BEST_KEY, String(state.time));
          } catch {
            /* best just won't persist */
          }
        }
        paint();
        return 'finish';
      }
      paint();
      return 'gate';
    },
  };
}
