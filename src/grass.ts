// Wind-blown grass and flowers around the player. A fixed set of blades lives in a square tile that
// wraps around the camera target; each blade reads height, density and color from baked textures.
import * as THREE from 'three';
import { WORLD_HALF } from './layout';
import type { Terrain } from './terrain';
import { rand } from './utils';
import { windUniforms } from './wind';
import { nightTint } from './sky';

const vertex = /* glsl */ `
  uniform float uTime;
  uniform vec3 uWind;
  uniform vec3 uCenter;
  uniform vec4 uPusher; // xz = vehicle position, z = radius, w = strength
  uniform float uTile;
  uniform float uHalf;
  uniform float uN;
  uniform sampler2D uData;
  uniform sampler2D uColor;
  attribute vec4 aOffset; // xy = position in tile, z,w = randoms
  varying vec3 vColor;
  #include <fog_pars_vertex>

  vec4 dataAt(vec2 xz) {
    vec2 g = (xz + uHalf) / (2.0 * uHalf) * (uN - 1.0);
    vec2 i = floor(g);
    vec2 f = g - i;
    float t = 1.0 / uN;
    vec2 b = (i + 0.5) * t;
    vec4 a = texture2D(uData, b);
    vec4 c = texture2D(uData, b + vec2(t, 0.0));
    vec4 d = texture2D(uData, b + vec2(0.0, t));
    vec4 e = texture2D(uData, b + vec2(t, t));
    return mix(mix(a, c, f.x), mix(d, e, f.x), f.y);
  }

  void main() {
    vec2 p = aOffset.xy + floor((uCenter.xz - aOffset.xy) / uTile + 0.5) * uTile;
    vec4 d = dataAt(p);
    float dist = length(p - uCenter.xz);
    float fade = 1.0 - smoothstep(uTile * 0.3, uTile * 0.5, dist);
    float rnd = aOffset.z;
    float keep = step(rnd, d.g) * fade;
    float flower = step(aOffset.w, 0.03);
    float hgt = (0.4 + fract(rnd * 7.31) * 0.6) * (0.55 + d.g * 0.6) * keep * (1.0 + flower * 0.5);

    float ang = aOffset.w * 232.0;
    vec2 across = vec2(cos(ang), sin(ang)) * position.x * (0.075 + flower * 0.05);
    float bend = position.y * position.y;

    float phase = uTime * 2.2 + p.x * 0.18 + p.y * 0.15;
    float gust = (sin(phase) * 0.5 + 0.5) * 0.7 + sin(phase * 2.7) * 0.15;
    vec2 sway = uWind.xy * bend * (0.15 + gust * 0.7) * uWind.z * hgt;

    // pushed aside by the vehicle
    vec2 away = p - uPusher.xy;
    float pd = length(away);
    float push = (1.0 - smoothstep(0.0, uPusher.z, pd)) * uPusher.w;
    sway += (pd > 0.001 ? away / pd : vec2(0.0)) * push * bend * hgt * 0.9;

    vec3 world = vec3(p.x + across.x + sway.x, d.r + position.y * hgt * (1.0 - push * 0.5), p.y + across.y + sway.y);

    vec3 ground = texture2D(uColor, (p + uHalf) / (2.0 * uHalf)).rgb;
    vec3 tip = ground * 1.45 + vec3(0.04, 0.06, 0.0);
    vColor = mix(ground * 0.7, tip, position.y);
    vColor *= 1.0 - push * 0.35; // fake contact shadow under the vehicle
    if (flower > 0.5 && position.y > 0.6) {
      float k = fract(rnd * 13.7);
      vColor = k > 0.66 ? vec3(1.0, 0.75, 0.18) : k > 0.33 ? vec3(0.95, 0.35, 0.45) : vec3(1.0, 0.97, 0.9);
    }

    vec4 mvPosition = viewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uTint;
  varying vec3 vColor;
  #include <fog_pars_fragment>
  void main() {
    gl_FragColor = vec4(vColor * uTint, 1.0);
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export function createGrass(scene: THREE.Scene, terrain: Terrain, count: number, tile = 64) {
  const blade = new THREE.BufferGeometry();
  // 5-vertex tapered blade: x = across (-1..1), y = up (0..1)
  blade.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, -0.65, 0.5, 0, 0.65, 0.5, 0, 0, 1, 0], 3));
  blade.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4]);

  const geo = new THREE.InstancedBufferGeometry();
  geo.index = blade.index;
  geo.setAttribute('position', blade.getAttribute('position'));
  const offsets = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) offsets.set([rand() * tile, rand() * tile, rand(), rand()], i * 4);
  geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 4));
  geo.instanceCount = count;

  const material = new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    side: THREE.DoubleSide,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uCenter: { value: new THREE.Vector3() },
        uPusher: { value: new THREE.Vector4(0, 0, 2.6, 0) },
        uTile: { value: tile },
        uHalf: { value: WORLD_HALF },
        uN: { value: terrain.n },
        uData: { value: null },
        uColor: { value: null },
      },
    ]),
  });
  // assign after merge (merge clones values); share the live wind uniforms
  material.uniforms.uData.value = terrain.dataTexture;
  material.uniforms.uColor.value = terrain.colorTexture;
  material.uniforms.uTime = windUniforms.uTime;
  material.uniforms.uWind = windUniforms.uWind;
  material.uniforms.uTint = nightTint;

  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false; // blades are positioned in the shader
  scene.add(mesh);

  return (center: THREE.Vector3, pusher: THREE.Vector3, pushing: boolean) => {
    material.uniforms.uCenter.value.copy(center);
    const u = material.uniforms.uPusher.value as THREE.Vector4;
    u.set(pusher.x, pusher.z, 2.6, pushing ? 1 : 0);
  };
}
