// One pooled point cloud for every effect: dust, smoke, exhaust, spray, sparks, confetti, leaves.
import * as THREE from 'three';
import { rand } from './utils';
import { wind } from './wind';

const vertex = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  uniform float uScale;
  varying float vAlpha;
  varying vec3 vColor;
  #include <fog_pars_vertex>
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = aSize * uScale / max(-mvPosition.z, 0.1);
    vAlpha = aAlpha;
    vColor = aColor;
    #include <fog_vertex>
  }
`;
const fragment = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  #include <fog_pars_fragment>
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.25, d) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor, a);
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export interface EmitOptions {
  count?: number;
  spread?: number; // position jitter (m)
  vel?: THREE.Vector3 | [number, number, number];
  velJitter?: number;
  size?: [number, number];
  life?: [number, number];
  color?: THREE.ColorRepresentation | THREE.ColorRepresentation[];
  gravity?: number; // m/s², positive = falls
  drag?: number;
  grow?: number; // size multiplier at end of life
  alpha?: number;
  windy?: number; // 0..1 how much wind pushes it
}

const MAX = 3000;

export function createParticles(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
  const pos = new Float32Array(MAX * 3);
  const vel = new Float32Array(MAX * 3);
  const col = new Float32Array(MAX * 3);
  const size = new Float32Array(MAX);
  const alpha = new Float32Array(MAX);
  const life = new Float32Array(MAX);
  const maxLife = new Float32Array(MAX);
  const baseSize = new Float32Array(MAX);
  const grow = new Float32Array(MAX);
  const gravity = new Float32Array(MAX);
  const drag = new Float32Array(MAX);
  const baseAlpha = new Float32Array(MAX);
  const windy = new Float32Array(MAX);
  let cursor = 0;

  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const sizeAttr = new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage);
  const alphaAttr = new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage);
  const colAttr = new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('aSize', sizeAttr);
  geo.setAttribute('aAlpha', alphaAttr);
  geo.setAttribute('aColor', colAttr);

  const material = new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uScale: { value: 300 } }]),
  });
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  points.renderOrder = 5;
  scene.add(points);

  const c = new THREE.Color();
  // world-size points: pixels = size * screenHeight / (2 * tan(fov/2) * depth); fov is 42°
  const resize = () => (material.uniforms.uScale.value = renderer.domElement.height / (2 * Math.tan((21 * Math.PI) / 180)));
  resize();
  window.addEventListener('resize', resize);

  function emit(at: THREE.Vector3, o: EmitOptions = {}) {
    const n = o.count ?? 1;
    const colors = Array.isArray(o.color) ? o.color : [o.color ?? 0xffffff];
    const v = o.vel instanceof THREE.Vector3 ? o.vel : new THREE.Vector3(...(o.vel ?? [0, 0, 0]));
    const vj = o.velJitter ?? 0;
    const sp = o.spread ?? 0;
    for (let k = 0; k < n; k++) {
      const i = cursor;
      cursor = (cursor + 1) % MAX;
      pos[i * 3] = at.x + (rand() - 0.5) * sp;
      pos[i * 3 + 1] = at.y + (rand() - 0.5) * sp * 0.5;
      pos[i * 3 + 2] = at.z + (rand() - 0.5) * sp;
      vel[i * 3] = v.x + (rand() - 0.5) * vj;
      vel[i * 3 + 1] = v.y + (rand() - 0.5) * vj;
      vel[i * 3 + 2] = v.z + (rand() - 0.5) * vj;
      const [s0, s1] = o.size ?? [0.4, 0.8];
      baseSize[i] = s0 + rand() * (s1 - s0);
      const [l0, l1] = o.life ?? [0.6, 1.2];
      maxLife[i] = life[i] = l0 + rand() * (l1 - l0);
      grow[i] = o.grow ?? 1;
      gravity[i] = o.gravity ?? 0;
      drag[i] = o.drag ?? 1;
      baseAlpha[i] = o.alpha ?? 0.8;
      windy[i] = o.windy ?? 0.3;
      c.set(colors[Math.floor(rand() * colors.length)]);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
  }

  function update(dt: number) {
    const wx = wind.dir.x * wind.strength * 6;
    const wz = wind.dir.y * wind.strength * 6;
    for (let i = 0; i < MAX; i++) {
      if (life[i] <= 0) {
        alpha[i] = 0;
        continue;
      }
      life[i] -= dt;
      const k = Math.exp(-drag[i] * dt);
      vel[i * 3] = vel[i * 3] * k + wx * windy[i] * dt;
      vel[i * 3 + 1] = vel[i * 3 + 1] * k - gravity[i] * dt;
      vel[i * 3 + 2] = vel[i * 3 + 2] * k + wz * windy[i] * dt;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      const t = 1 - Math.max(life[i], 0) / maxLife[i]; // 0 → 1 over life
      size[i] = baseSize[i] * (1 + (grow[i] - 1) * t);
      alpha[i] = baseAlpha[i] * Math.min(1, t * 8) * (1 - t);
    }
    posAttr.needsUpdate = sizeAttr.needsUpdate = alphaAttr.needsUpdate = colAttr.needsUpdate = true;
  }

  // ---- presets ----
  const v3 = new THREE.Vector3();
  return {
    emit,
    update,
    dust(at: THREE.Vector3, color: THREE.ColorRepresentation, amount: number) {
      emit(at, { count: amount, spread: 0.6, vel: [0, 1.2, 0], velJitter: 1.5, size: [0.5, 1], life: [0.6, 1.2], color, grow: 2.6, drag: 1.5, alpha: 0.45, windy: 0.6 });
    },
    smoke(at: THREE.Vector3) {
      emit(at, { count: 1, spread: 0.4, vel: [0, 1.5, 0], velJitter: 1, size: [0.8, 1.2], life: [0.8, 1.4], color: [0xffffff, 0xeeeeee], grow: 3, drag: 1.2, alpha: 0.4, windy: 0.8 });
    },
    exhaust(at: THREE.Vector3, back: THREE.Vector3, hot: number) {
      v3.copy(back).multiplyScalar(6);
      emit(at, { count: 1, spread: 0.3, vel: v3, velJitter: 1, size: [0.5, 0.9], life: [0.3, 0.6], color: hot > 0.5 ? [0xffb36b, 0xff7a2a] : [0xd8d0c8], grow: 2.5, drag: 2, alpha: 0.7, windy: 0.2 });
    },
    /** Big splash: a tall crown of droplets plus a low ring of mist. */
    splash(at: THREE.Vector3, strength = 1) {
      const s = Math.max(0.5, strength);
      emit(at, { count: Math.round(110 * s), spread: 2.2, vel: [0, 9 * s, 0], velJitter: 8 * s, size: [0.35, 0.8], life: [0.7, 1.4], color: [0xffffff, 0xd8f3f0, 0xbfeae6], gravity: 18, drag: 0.4, alpha: 0.95, windy: 0.1 });
      emit(at, { count: Math.round(40 * s), spread: 3, vel: [0, 1.2, 0], velJitter: 5 * s, size: [1.2, 2.2], life: [0.9, 1.6], color: [0xffffff, 0xe6f7f5], grow: 2.2, drag: 2.5, alpha: 0.5, windy: 0.4 });
    },
    /** Spray kicked up while driving through shallow water. */
    spray(at: THREE.Vector3, vel: { x: number; z: number }, strength: number) {
      emit(at, { count: Math.round(4 * strength) + 1, spread: 1.2, vel: [-vel.x * 0.15, 3.5 * strength, -vel.z * 0.15], velJitter: 2.5, size: [0.25, 0.55], life: [0.4, 0.8], color: [0xffffff, 0xd8f3f0], gravity: 14, drag: 0.8, alpha: 0.85, windy: 0.1 });
    },
    sparks(at: THREE.Vector3) {
      emit(at, { count: 40, spread: 0.6, vel: [0, 5, 0], velJitter: 10, size: [0.15, 0.35], life: [0.3, 0.8], color: [0xffd27a, 0xff9a3a, 0xffffff], gravity: 12, drag: 1, alpha: 1, windy: 0 });
      emit(at, { count: 20, spread: 1.5, vel: [0, 2, 0], velJitter: 3, size: [1.2, 2], life: [1, 2], color: [0x8d8590, 0x6f6875], grow: 2.5, drag: 1.5, alpha: 0.5, windy: 0.7 });
    },
    puff(at: THREE.Vector3, color: THREE.ColorRepresentation, strength: number) {
      const n = Math.round(10 + strength * 20);
      emit(at, { count: n, spread: 2.5, vel: [0, 0.8, 0], velJitter: 4 + strength * 3, size: [0.7, 1.3], life: [0.6, 1.1], color, grow: 2.2, drag: 3, alpha: 0.5, windy: 0.5 });
    },
    confetti(at: THREE.Vector3) {
      emit(at, { count: 160, spread: 3, vel: [0, 10, 0], velJitter: 9, size: [0.25, 0.45], life: [1.5, 2.8], color: [0xe8604c, 0xf2b134, 0x4fa88f, 0x7a4fd1, 0xfff7ec], gravity: 6, drag: 1.2, alpha: 1, windy: 0.6 });
    },
    sparkle(at: THREE.Vector3) {
      emit(at, { count: 28, spread: 6, vel: [0, 2, 0], velJitter: 2, size: [0.2, 0.4], life: [0.8, 1.6], color: [0xfff2b0, 0xffffff], gravity: -0.5, drag: 1, alpha: 1, windy: 0.2 });
    },
    /** Ambient leaves / pollen drifting around the camera target. */
    ambient(center: THREE.Vector3, dt: number) {
      if (rand() < dt * 12) {
        v3.set(center.x + (rand() - 0.5) * 60 - wind.dir.x * 20, center.y + 2 + rand() * 12, center.z + (rand() - 0.5) * 60 - wind.dir.y * 20);
        const leaf = rand() < 0.6;
        emit(v3, {
          count: 1,
          vel: [wind.dir.x * 3, -0.3, wind.dir.y * 3],
          velJitter: 1,
          size: leaf ? [0.18, 0.3] : [0.08, 0.14],
          life: [3, 6],
          color: leaf ? [0x8fb35e, 0xe6c25a, 0xd08a55] : [0xfff7ec],
          gravity: 0.15,
          drag: 0.3,
          alpha: 0.9,
          windy: 1,
        });
      }
    },
  };
}

export type Particles = ReturnType<typeof createParticles>;
