// Shared wind: one set of uniforms drives grass, trees, streaks, clouds, turbines and sound.
import * as THREE from 'three';
import { WORLD_HALF } from './layout';
import { rand } from './utils';

export const windUniforms = {
  uTime: { value: 0 },
  /** xy = horizontal direction (x, z), z = strength 0..1 */
  uWind: { value: new THREE.Vector3(1, 0.3, 0.5) },
};

export const wind = {
  dir: new THREE.Vector2(1, 0.3).normalize(),
  strength: 0.5,
  update(t: number) {
    // slowly wandering direction + gusts
    const a = 0.3 + Math.sin(t * 0.03) * 0.8;
    this.dir.set(Math.cos(a), Math.sin(a));
    this.strength = 0.45 + 0.3 * Math.sin(t * 0.21) * Math.sin(t * 0.13 + 1) + 0.15 * Math.max(0, Math.sin(t * 0.9));
    windUniforms.uTime.value = t;
    windUniforms.uWind.value.set(this.dir.x, this.dir.y, this.strength);
  },
};

/**
 * Patch a standard material so instanced meshes sway in the wind (top moves, base stays).
 * `amp` scales the bend; geometry should have its base near local y = `baseY`.
 */
export function windify<T extends THREE.Material>(material: T, amp = 0.15, baseY = -1): T {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.uniforms.uWind = windUniforms.uWind;
    shader.vertexShader =
      'uniform float uTime;\nuniform vec3 uWind;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 wPos = vec3(instanceMatrix[3]);
        #else
          vec3 wPos = vec3(modelMatrix[3]);
        #endif
        float wPhase = uTime * 1.6 + wPos.x * 0.13 + wPos.z * 0.11;
        float wSway = (sin(wPhase) * 0.6 + sin(wPhase * 2.3 + 1.7) * 0.25 + 0.5) * uWind.z;
        float wBend = max(position.y - (${baseY.toFixed(2)}), 0.0);
        transformed.x += uWind.x * wSway * wBend * ${amp.toFixed(3)};
        transformed.z += uWind.y * wSway * wBend * ${amp.toFixed(3)};`
      );
  };
  material.customProgramCacheKey = () => `wind-${amp}-${baseY}`;
  return material;
}

/** Thin white streaks that blow past the camera. */
export function createWindStreaks(scene: THREE.Scene, count = 40) {
  const geo = new THREE.PlaneGeometry(1, 0.06);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.frustumCulled = false;
  scene.add(mesh);
  const items = Array.from({ length: count }, () => ({ p: new THREE.Vector3(), life: 0, max: 1, len: 1 }));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();

  return (center: THREE.Vector3, dt: number) => {
    const speed = 10 + wind.strength * 22;
    const yaw = Math.atan2(-wind.dir.y, wind.dir.x); // plane's local x along the wind
    q.setFromEuler(new THREE.Euler(0, yaw, 0));
    items.forEach((it, i) => {
      it.life -= dt;
      if (it.life <= 0) {
        it.max = it.life = 0.8 + rand() * 1.4;
        it.len = 2 + rand() * 5;
        it.p.set(center.x + (rand() - 0.5) * 70, center.y + 1 + rand() * 10, center.z + (rand() - 0.5) * 70);
      }
      it.p.x += wind.dir.x * speed * dt;
      it.p.z += wind.dir.y * speed * dt;
      // fade by shrinking (tinting would darken toward black, not transparent)
      const fade = Math.sin((1 - it.life / it.max) * Math.PI) * Math.min(1, wind.strength * 1.4);
      s.set(it.len * fade + 0.001, fade + 0.001, 1);
      m.compose(it.p, q, s);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
}

/** Low-poly clouds that drift with the wind and wrap around the world. */
export function createClouds(scene: THREE.Scene, count = 26) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true, transparent: true, opacity: 0.92 });
  const puff = new THREE.IcosahedronGeometry(1, 0);
  const clouds = Array.from({ length: count }, () => {
    const g = new THREE.Group();
    const n = 3 + Math.floor(rand() * 4);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(puff, mat);
      const s = 6 + rand() * 9;
      m.scale.set(s * 1.4, s * 0.8, s);
      m.position.set((i - n / 2) * 9 + rand() * 4, rand() * 4, rand() * 8);
      g.add(m);
    }
    g.position.set((rand() * 2 - 1) * WORLD_HALF * 1.3, 95 + rand() * 50, (rand() * 2 - 1) * WORLD_HALF * 1.3);
    g.rotation.y = rand() * Math.PI;
    scene.add(g);
    return g;
  });
  const span = WORLD_HALF * 1.3;
  return (dt: number) => {
    for (const c of clouds) {
      c.position.x += wind.dir.x * (2 + wind.strength * 5) * dt;
      c.position.z += wind.dir.y * (2 + wind.strength * 5) * dt;
      if (c.position.x > span) c.position.x -= span * 2;
      if (c.position.x < -span) c.position.x += span * 2;
      if (c.position.z > span) c.position.z -= span * 2;
      if (c.position.z < -span) c.position.z += span * 2;
    }
  };
}
