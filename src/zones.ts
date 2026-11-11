import * as THREE from 'three';
import { C } from './palette';
import { PLACES } from './layout';
import { type Ctx, makeLabel } from './utils';
import { WORK_ZONE_OFFSET } from './places/city';
import { PODIUM_OFFSET } from './places/stadium';
import { LIGHTHOUSE_OFFSET } from './places/beach';
import { SCREEN_OFFSET } from './places/studio';
import { TOWER_AT } from './places/airport';

export interface ZoneContent {
  title: string;
  /** Ground position (x, z). */
  at: [number, number];
  /** Panel contents; plain HTML. */
  html: string;
}

export interface Zone extends ZoneContent {
  pos: THREE.Vector3;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  label: THREE.Sprite;
}

export const ZONE_R = 5;

const ext = (href: string, text: string) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
const near = (p: { x: number; z: number }, [dx, dz]: [number, number]): [number, number] => [p.x + dx, p.z + dz];

// ✏️ Edit these to change your portfolio content.
export const ZONE_CONTENT: ZoneContent[] = [
  {
    title: 'About me',
    at: near(PLACES.home, [-12, 6]),
    html: `<p>I'm <strong>Abishai Yelleti</strong>, a multidisciplinary creative technologist. I turn ideas into
           immersive digital experiences through cinematic 3D, motion graphics and code.</p>
           <p>Websites, brand identities, 3D environments, VFX. I believe design should be intentional and
           memorable, not just attractive.</p>
           <p><strong>Tools:</strong> Blender, Unreal Engine 5, After Effects, Figma, TypeScript, React,
           Next.js, Tailwind, GSAP, Python, Kotlin.</p>
           <p>Press <code>M</code> for the map and go explore the island.</p>`,
  },
  {
    title: 'Work',
    at: near(PLACES.city, WORK_ZONE_OFFSET),
    html: `<ul>
             <li>${ext('https://multioks.com/', 'Multioks')}: UI/UX and frontend for an on-demand home services
               platform (${ext('https://play.google.com/store/apps/details?id=com.multioks.customer', 'app')})</li>
             <li>${ext('https://www.ilish3dtechnologiesprivatelimited.com/', 'Ilish 3D Technologies')}: corporate website</li>
             <li>${ext('https://forgefounder.in', 'Forge Founder')}: Design Lead, branding and campaigns</li>
             <li><strong>Entrepreneur Cell</strong> and <strong>Quantum Club</strong>: Design Lead</li>
           </ul>
           <p>The tallest towers downtown are these projects.</p>`,
  },
  {
    title: 'Achievements',
    at: near(PLACES.stadium, [PODIUM_OFFSET[0] - 7, PODIUM_OFFSET[1] + 8]),
    html: `<ul>
             <li><strong>IEEE Xtreme 20.0</strong>: 1st in India, 51st globally</li>
             <li><strong>AWS Student Community Day Vizag 2026</strong>: hackathon 2nd place</li>
             <li><strong>IIT Bombay National Entrepreneurship Challenge</strong>: 44th of 4,000+ colleges</li>
             <li><strong>Smart India Hackathon 2026</strong>: qualified the internal round</li>
             <li><strong>Project Expo</strong>: 3rd prize</li>
             <li><strong>AISYWLC 2026</strong>, CHRIST University: delegate</li>
           </ul>`,
  },
  {
    title: 'Greyborn & 3D',
    at: near(PLACES.studio, [SCREEN_OFFSET[0], SCREEN_OFFSET[1] + 10]),
    html: `<p><strong>Greyborn</strong> is a feature film by Yesdas Production House, currently in production.
           I build its 3D environments, background worlds and animation in Blender.</p>
           <p>I also make 3D product visuals, motion graphics and VFX, and Unreal Engine 5 scenes.</p>`,
  },
  {
    title: 'Worldwide',
    at: [TOWER_AT[0] + 8, TOWER_AT[1] + 8],
    html: `<p>Open for <strong>freelance work worldwide</strong>: web experiences, 3D product visuals, motion
           graphics and VFX for brands and agencies.</p>
           <p>Grab the helicopter or the jet here (press <code>V</code>).</p>`,
  },
  {
    title: 'Contact',
    at: near(PLACES.beach, [LIGHTHOUSE_OFFSET[0] + 8, LIGHTHOUSE_OFFSET[1] - 4]),
    html: `<p>Got a project in mind? Let's talk.</p>
           <ul>
             <li><a href="mailto:abishaiyelleti1@gmail.com?subject=Project%20Inquiry">abishaiyelleti1@gmail.com</a></li>
             <li>${ext('https://github.com/abishai-1', 'GitHub')}</li>
             <li>${ext('https://www.linkedin.com/in/abishai-yelleti/', 'LinkedIn')}</li>
             <li>${ext('https://www.instagram.com/aio.yk', 'Instagram')}</li>
             <li>${ext('https://discord.gg/cmrfz2E6b', 'Discord')}</li>
             <li>${ext('https://www.aio.engineer/', 'aio.engineer')}</li>
           </ul>`,
  },
];

export function createZones({ scene, terrain }: Ctx): Zone[] {
  const decal = (color: number, opacity: number, offset: number) =>
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -offset,
      polygonOffsetUnits: -offset * 4,
    });

  return ZONE_CONTENT.map((content) => {
    const [x, z] = content.at;
    // rest the flat ring on the highest ground under it, so no part of it is buried
    let y = terrain.sample(x, z);
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      y = Math.max(y, terrain.sample(x + Math.cos(a) * ZONE_R, z + Math.sin(a) * ZONE_R));
    }
    const pos = new THREE.Vector3(x, y, z);

    const pad = new THREE.Mesh(new THREE.CircleGeometry(ZONE_R - 0.5, 48), decal(C.cream, 0.35, 3));
    pad.rotation.x = -Math.PI / 2;
    pad.position.copy(pos).setY(pos.y + 0.08);
    pad.renderOrder = 1;

    const ring = new THREE.Mesh(new THREE.RingGeometry(ZONE_R - 0.5, ZONE_R, 48), decal(C.cream, 0.8, 4));
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(pos).setY(pos.y + 0.1);
    ring.renderOrder = 2;

    const label = makeLabel(content.title);
    label.position.copy(pos).setY(pos.y + 4);

    scene.add(ring, pad, label);
    return { ...content, pos, ring, label };
  });
}

/** Animate zones and return the one the vehicle is in, if any. */
export function updateZones(zones: Zone[], at: THREE.Vector3, t: number): Zone | null {
  let inside: Zone | null = null;
  for (const z of zones) {
    const d = Math.hypot(at.x - z.pos.x, at.z - z.pos.z);
    const on = d < ZONE_R && Math.abs(at.y - z.pos.y) < 6;
    // the label hides when you're right at the zone (the panel takes over) and far away
    const lm = z.label.material;
    lm.opacity = THREE.MathUtils.smoothstep(d, ZONE_R + 6, ZONE_R + 30) * (1 - THREE.MathUtils.smoothstep(d, 140, 200));
    z.label.visible = lm.opacity > 0.01;
    if (on) inside = z;
    z.label.position.y = z.pos.y + 4 + Math.sin(t * 2 + z.pos.x) * 0.25;
    z.ring.material.opacity = on ? 1 : 0.7;
    z.ring.scale.setScalar(on ? 1 + Math.sin(t * 6) * 0.03 : 1);
  }
  return inside;
}
