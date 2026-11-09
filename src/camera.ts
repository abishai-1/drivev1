// Chase camera for every vehicle. Desktop: drag to orbit, wheel to zoom (eases back behind after a moment).
// Touch devices: a plain third-person chase cam.
import * as THREE from 'three';

const TAU = Math.PI * 2;
const wrap = (a: number) => ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
const dampAngle = (from: number, to: number, k: number, dt: number) => from + wrap(to - from) * (1 - Math.exp(-k * dt));

export interface CamTarget {
  position: THREE.Vector3;
  heading: number;
  speed: number;
  kind: 'ground' | 'heli' | 'jet';
  scale: number;
}

export function createCameraRig(camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement, groundAt: (x: number, z: number) => number) {
  const touch = window.matchMedia('(pointer: coarse)').matches;
  let orbitYaw = 0;
  let orbitPitch = 0;
  let zoom = 1;
  let dragging = false;
  let idle = 99; // seconds since the last mouse input
  let camYaw = 0;
  const focus = new THREE.Vector3();
  const look = new THREE.Vector3();
  let first = true;

  if (!touch) {
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse') return;
      dragging = true;
      canvas.setPointerCapture(e.pointerId);
      canvas.classList.add('cursor-grabbing');
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      orbitYaw -= e.movementX * 0.006;
      orbitPitch = THREE.MathUtils.clamp(orbitPitch + e.movementY * 0.004, -0.3, 0.9);
      idle = 0;
    });
    const end = () => {
      dragging = false;
      canvas.classList.remove('cursor-grabbing');
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        zoom = THREE.MathUtils.clamp(zoom * Math.exp(e.deltaY * 0.001), 0.55, 2.6);
        idle = 0;
      },
      { passive: false }
    );
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  return {
    touch,
    /** Jump the camera straight to its resting spot (after teleports / respawns). */
    snap() {
      first = true;
    },
    update(t: CamTarget, dt: number) {
      idle += dt;
      if (!dragging && idle > 2.5) {
        orbitYaw = wrap(orbitYaw) * Math.exp(-1.5 * dt);
        orbitPitch *= Math.exp(-1.5 * dt);
      }
      const follow = t.kind === 'jet' ? 2.5 : t.kind === 'heli' ? 2 : t.speed > 3 ? 3.5 : 1.2;
      camYaw = first ? t.heading : dampAngle(camYaw, t.heading, follow, dt);

      const basePitch = t.kind === 'jet' ? 0.24 : t.kind === 'heli' ? 0.45 : 0.4;
      const pitch = THREE.MathUtils.clamp(basePitch + orbitPitch, 0.02, 1.2);
      const dist = (t.kind === 'jet' ? 22 : t.kind === 'heli' ? 20 : 12 + t.speed * 0.1) * t.scale * zoom;
      const yaw = camYaw + orbitYaw + Math.PI; // behind the vehicle

      if (first) focus.copy(t.position);
      else focus.lerp(t.position, 1 - Math.exp(-12 * dt));
      camera.position.set(
        focus.x + Math.sin(yaw) * Math.cos(pitch) * dist,
        focus.y + 1.4 + Math.sin(pitch) * dist,
        focus.z + Math.cos(yaw) * Math.cos(pitch) * dist
      );
      // never dip below the ground
      const floor = groundAt(camera.position.x, camera.position.z) + 1.2;
      if (camera.position.y < floor) camera.position.y = floor;

      look.set(focus.x + Math.sin(camYaw) * 2.5, focus.y + 1.2, focus.z + Math.cos(camYaw) * 2.5);
      camera.lookAt(look);
      first = false;
    },
  };
}
