import * as THREE from 'three';
import * as CANNON from 'cannon-es';

/** Shared handles every builder needs. */
export interface Ctx {
  scene: THREE.Scene;
  world: CANNON.World;
  /** Mesh/body pairs synced every frame. */
  dynamic: { mesh: THREE.Object3D; body: CANNON.Body }[];
}

export function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id} in index.html`);
  return node as T;
}

export const mat = (color: number) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true });

export function shadowed<T extends THREE.Mesh>(mesh: T): T {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Copy a cannon position/rotation onto a three object (their vector types are not interchangeable). */
export function syncObject(obj: THREE.Object3D, pos: CANNON.Vec3, quat: CANNON.Quaternion) {
  obj.position.set(pos.x, pos.y, pos.z);
  obj.quaternion.set(quat.x, quat.y, quat.z, quat.w);
}

// Seeded random so the world layout is stable between reloads
let seed = 7;
export const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

export function makeLabel(text: string, color = '#e8604c'): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas not supported');
  ctx.fillStyle = '#fff7ec';
  ctx.beginPath();
  ctx.roundRect(8, 8, 496, 112, 56);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.font = 'bold 64px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 68);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  sprite.scale.set(6, 1.5, 1);
  return sprite;
}
