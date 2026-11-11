import * as THREE from 'three';
import { PLACES, STUNT_PAD, WORLD_HALF, WATER_Y } from './layout';
import { groundColor, type Terrain } from './terrain';
import type { TrackPath } from './track';
import type { Network } from './paths';
import type { Zone } from './zones';
import { el } from './utils';

const SIZE = 480; // base map resolution
const toPx = (v: number) => ((v + WORLD_HALF) / (WORLD_HALF * 2)) * SIZE;

export function createMap(terrain: Terrain, net: Network, track: TrackPath, zones: Zone[]) {
  const panel = el('map');
  const canvas = el<HTMLCanvasElement>('map-canvas');
  const dpr = Math.min(window.devicePixelRatio, 2);
  canvas.width = canvas.height = SIZE * dpr;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('2D canvas not supported');

  // ---- static base layer, drawn once ----
  const base = document.createElement('canvas');
  base.width = base.height = SIZE;
  const b = base.getContext('2d');
  if (!b) throw new Error('2D canvas not supported');
  const img = b.createImageData(SIZE, SIZE);
  const c = new THREE.Color();
  const deep = new THREE.Color(0x1f6f8b);
  const shallow = new THREE.Color(0x4fc6c0);
  const rgb = { r: 0, g: 0, b: 0 };
  const step = (WORLD_HALF * 2) / SIZE;
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      const x = -WORLD_HALF + (px + 0.5) * step;
      const z = -WORLD_HALF + (py + 0.5) * step; // north (-z) at the top
      const h = terrain.sample(x, z);
      if (h < WATER_Y) {
        c.copy(shallow).lerp(deep, Math.min(-h / 6, 1));
      } else {
        const dx = terrain.sample(x + 2, z) - terrain.sample(x - 2, z);
        const dz = terrain.sample(x, z + 2) - terrain.sample(x, z - 2);
        groundColor(x, z, h, Math.hypot(dx, dz) / 4, c);
        c.multiplyScalar(THREE.MathUtils.clamp(1 - (dx + dz) * 0.06, 0.7, 1.2)); // hill shading, light from NW
      }
      c.getRGB(rgb, THREE.SRGBColorSpace);
      const k = (px + py * SIZE) * 4;
      img.data[k] = rgb.r * 255;
      img.data[k + 1] = rgb.g * 255;
      img.data[k + 2] = rgb.b * 255;
      img.data[k + 3] = 255;
    }
  }
  b.putImageData(img, 0, 0);

  // rivers, roads, then the track on top
  b.lineJoin = b.lineCap = 'round';
  const line = (pts: THREE.Vector3[], closed: boolean) => {
    b.beginPath();
    pts.forEach((p, i) => (i ? b.lineTo(toPx(p.x), toPx(p.z)) : b.moveTo(toPx(p.x), toPx(p.z))));
    if (closed) b.closePath();
  };
  for (const r of net.rivers) {
    line(r.points, false);
    b.strokeStyle = '#4fc6c0';
    b.lineWidth = 3.5;
    b.stroke();
  }
  for (const r of net.roads) {
    if (r.kind === 'track') continue;
    line(r.points, false);
    b.strokeStyle = r.kind === 'street' ? 'rgba(255,247,236,0.7)' : '#d8c9b4';
    b.lineWidth = r.kind === 'street' ? 1.2 : 2;
    b.stroke();
  }
  const path = () => line(track.points, true);
  path();
  b.strokeStyle = '#3b2a3f';
  b.lineWidth = 5;
  b.stroke();
  path();
  b.strokeStyle = '#fff7ec';
  b.lineWidth = 2;
  b.stroke();

  // place labels
  b.font = 'bold 11px system-ui, sans-serif';
  b.textAlign = 'center';
  for (const p of [...Object.values(PLACES), STUNT_PAD]) {
    const x = toPx(p.x);
    const y = toPx(p.z);
    b.lineWidth = 3;
    b.strokeStyle = 'rgba(59,42,63,0.85)';
    b.strokeText(p.name, x, y);
    b.fillStyle = '#fff7ec';
    b.fillText(p.name, x, y);
  }

  // ---- live layer ----
  let open = false;
  let markers: () => { x: number; z: number; color: string }[] = () => [];
  const checkpoint = (i: number) => track.points[track.checkpoints[i]];

  function draw(x: number, z: number, heading: number, next: number, t: number) {
    g!.setTransform(dpr, 0, 0, dpr, 0, 0);
    g!.drawImage(base, 0, 0);

    // portfolio zones
    for (const zone of zones) {
      g!.beginPath();
      g!.arc(toPx(zone.pos.x), toPx(zone.pos.z), 4, 0, Math.PI * 2);
      g!.fillStyle = '#e8604c';
      g!.fill();
      g!.lineWidth = 1.5;
      g!.strokeStyle = '#fff7ec';
      g!.stroke();
    }

    // next checkpoint (pulsing)
    const cp = checkpoint(next);
    g!.beginPath();
    g!.arc(toPx(cp.x), toPx(cp.z), 6 + Math.sin(t * 5) * 2, 0, Math.PI * 2);
    g!.strokeStyle = '#f2b134';
    g!.lineWidth = 2.5;
    g!.stroke();

    // extra markers (gems, stunt run…): small diamonds
    for (const mk of markers()) {
      g!.save();
      g!.translate(toPx(mk.x), toPx(mk.z));
      g!.rotate(Math.PI / 4);
      g!.fillStyle = mk.color;
      g!.fillRect(-3, -3, 6, 6);
      g!.lineWidth = 1.2;
      g!.strokeStyle = '#fff7ec';
      g!.strokeRect(-3, -3, 6, 6);
      g!.restore();
    }

    // you: forward (sin h, cos h) in world → (dx, dy) on the map
    g!.save();
    g!.translate(toPx(x), toPx(z));
    g!.rotate(Math.atan2(Math.cos(heading), Math.sin(heading)));
    g!.beginPath();
    g!.moveTo(11, 0);
    g!.lineTo(-7, -7);
    g!.lineTo(-3, 0);
    g!.lineTo(-7, 7);
    g!.closePath();
    g!.fillStyle = '#e8604c';
    g!.fill();
    g!.lineWidth = 2;
    g!.strokeStyle = '#fff7ec';
    g!.stroke();
    g!.restore();
  }

  return {
    get open() {
      return open;
    },
    /** Provide extra live markers (called every draw). */
    setMarkers(fn: typeof markers) {
      markers = fn;
    },
    toggle(force?: boolean) {
      open = force ?? !open;
      panel.classList.toggle('translate-x-full', !open);
      panel.classList.toggle('translate-x-0', open);
    },
    /** Call every frame; only draws while open. */
    update(x: number, z: number, heading: number, next: number, t: number) {
      if (open) draw(x, z, heading, next, t);
    },
  };
}
