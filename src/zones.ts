import * as THREE from 'three';
import { C } from './palette';
import { type Ctx, makeLabel } from './utils';

export interface ZoneContent {
  title: string;
  /** Center on the ground (y is ignored). */
  pos: THREE.Vector3;
  /** Panel contents; plain HTML. */
  html: string;
}

export interface Zone extends ZoneContent {
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  label: THREE.Sprite;
}

export const ZONE_R = 5;

// ✏️ Edit these to fill in your own content.
export const ZONE_CONTENT: ZoneContent[] = [
  {
    title: 'About me',
    pos: new THREE.Vector3(-18, 0, 12),
    html: `<p>I'm a developer who likes building playful things for the web.</p>
           <p>Replace this text with your own story in <code>src/zones.ts</code>.</p>`,
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

export function createZones({ scene }: Ctx): Zone[] {
  return ZONE_CONTENT.map((content) => {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(ZONE_R - 0.5, ZONE_R, 48),
      new THREE.MeshBasicMaterial({ color: C.cream, transparent: true, opacity: 0.7 })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(content.pos).setY(0.03);

    const pad = new THREE.Mesh(
      new THREE.CircleGeometry(ZONE_R - 0.5, 48),
      new THREE.MeshBasicMaterial({ color: C.path, transparent: true, opacity: 0.6 })
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.copy(content.pos).setY(0.02);

    const label = makeLabel(content.title);
    label.position.copy(content.pos).setY(4);

    scene.add(ring, pad, label);
    return { ...content, ring, label };
  });
}

/** Animate zones and return the one the car is standing in, if any. */
export function updateZones(zones: Zone[], carPos: THREE.Vector3, t: number): Zone | null {
  let inside: Zone | null = null;
  for (const z of zones) {
    const on = Math.hypot(carPos.x - z.pos.x, carPos.z - z.pos.z) < ZONE_R;
    if (on) inside = z;
    z.label.position.y = 4 + Math.sin(t * 2 + z.pos.x) * 0.25;
    z.ring.material.opacity = on ? 1 : 0.6;
    z.ring.scale.setScalar(on ? 1 + Math.sin(t * 6) * 0.03 : 1);
  }
  return inside;
}
