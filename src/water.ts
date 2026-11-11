import * as THREE from 'three';
import { C } from './palette';
import { WORLD_HALF, WATER_Y } from './layout';
import type { Terrain } from './terrain';

const vertex = /* glsl */ `
  uniform float uTime;
  varying vec3 vWorld;
  #include <fog_pars_vertex>
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    wp.y += sin(wp.x * 0.06 + uTime * 1.2) * 0.12 + cos(wp.z * 0.05 + uTime * 0.9) * 0.12;
    vWorld = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragment = /* glsl */ `
  uniform float uTime;
  uniform float uHalf;
  uniform sampler2D uShore;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uFoam;
  varying vec3 vWorld;
  #include <fog_pars_fragment>
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  void main() {
    vec2 uv = (vWorld.xz + uHalf) / (2.0 * uHalf);
    float h = -8.0;
    if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) h = texture2D(uShore, uv).r * 10.0 - 8.0;

    vec3 col = mix(uShallow, uDeep, smoothstep(0.0, 6.0, -h));
    float shore = smoothstep(-1.8, 0.2, h);
    float bands = 0.5 + 0.5 * sin(h * 6.0 - uTime * 2.0);
    float foam = shore * smoothstep(0.6, 0.95, bands) + smoothstep(-0.35, 0.15, h);
    // sun glints: random cells, each a soft streak along the swell that twinkles on its own clock
    // (no regular grid), faded out with distance so far water doesn't shimmer into noise
    float glint = 0.0;
    for (int l = 0; l < 2; l++) {
      float fl = float(l);
      vec2 p = vWorld.xz * vec2(0.45, 0.9) * (1.0 + fl * 0.7) + vec2(uTime * (0.25 + fl * 0.15), fl * 17.0);
      vec2 cell = floor(p);
      vec2 f = fract(p) - 0.5;
      float r = hash(cell + fl * 31.0);
      vec2 o = vec2(hash(cell + 7.0), hash(cell + 13.0)) - 0.5;
      float d = length((f - o * 0.6) * vec2(1.0, 2.6));
      float tw = pow(max(sin(uTime * (1.5 + r * 2.5) + r * 40.0), 0.0), 6.0);
      glint += step(0.72, r) * smoothstep(0.22, 0.0, d) * tw;
    }
    float far = smoothstep(140.0, 40.0, distance(cameraPosition.xz, vWorld.xz));
    col += glint * far * 0.35 * (1.0 - shore);
    col = mix(col, uFoam, clamp(foam, 0.0, 1.0) * 0.85);

    gl_FragColor = vec4(col, 0.92);
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

interface Splash {
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  age: number;
}

export function createWater(scene: THREE.Scene, terrain: Terrain) {
  // shore texture: terrain height baked into a texture so the shader knows the depth
  const { n, heights } = terrain;
  const data = new Uint8Array(n * n * 4);
  for (let k = 0; k < n * n; k++) {
    const v = Math.round(Math.min(Math.max((heights[k] + 8) / 10, 0), 1) * 255);
    data.set([v, v, v, 255], k * 4);
  }
  const shore = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  shore.magFilter = shore.minFilter = THREE.LinearFilter;
  shore.needsUpdate = true;

  const material = new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uHalf: { value: WORLD_HALF },
        uShore: { value: null },
        uDeep: { value: new THREE.Color(C.waterDeep) },
        uShallow: { value: new THREE.Color(C.waterShallow) },
        uFoam: { value: new THREE.Color(C.foam) },
      },
    ]),
  });
  material.uniforms.uShore.value = shore; // set after merge (merge clones textures)

  const water = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400, 240, 240).rotateX(-Math.PI / 2), material);
  water.position.y = WATER_Y;
  water.renderOrder = 3;
  scene.add(water);

  const splashes: Splash[] = [];
  const ringGeo = new THREE.RingGeometry(0.8, 1.2, 32).rotateX(-Math.PI / 2);

  return {
    splash(x: number, z: number) {
      for (let k = 0; k < 3; k++) {
        const mesh = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: C.foam, transparent: true }));
        mesh.position.set(x, WATER_Y + 0.2, z);
        scene.add(mesh);
        splashes.push({ mesh, age: -k * 0.15 });
      }
    },
    update(t: number, dt: number) {
      material.uniforms.uTime.value = t;
      for (let i = splashes.length - 1; i >= 0; i--) {
        const s = splashes[i];
        s.age += dt;
        const a = Math.max(s.age, 0);
        s.mesh.scale.setScalar(1 + a * 9);
        s.mesh.material.opacity = Math.max(0, 1 - a / 1.2);
        if (a > 1.2) {
          scene.remove(s.mesh);
          s.mesh.material.dispose();
          splashes.splice(i, 1);
        }
      }
    },
  };
}
