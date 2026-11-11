// Gradient sky dome with stars, a day/night cycle, and things that glow after dark (lamps, windows,
// floodlights). Press T to fast-forward to night or back to day.
import * as THREE from 'three';

/** 0 = full day, 1 = full night. Read by anything that reacts to the time of day. */
export const env = { night: 0, dusk: 0 };
/** Multiplier for custom-shaded things (grass, water) so they dim and cool down with the light. */
export const nightTint = { value: new THREE.Color(1, 1, 1) };

// ---------- glowing materials & halos ----------
interface Glow {
  m: THREE.MeshStandardMaterial;
  day: THREE.Color;
  night: THREE.Color;
  dayI: number;
  nightI: number;
}
const glows: Glow[] = [];
/** Register a material whose emissive brightens at night. */
export function glow(m: THREE.MeshStandardMaterial, nightColor: number, dayI: number, nightI: number) {
  glows.push({ m, day: m.emissive.clone(), night: new THREE.Color(nightColor), dayI, nightI });
  return m;
}

const halos: { p: THREE.Vector3; size: number; color: THREE.Color }[] = [];
/** A soft round light halo that fades in at night (street lamps, floodlights, windows…). */
export function addHalo(x: number, y: number, z: number, size = 4, color = 0xffd98a) {
  halos.push({ p: new THREE.Vector3(x, y, z), size, color: new THREE.Color(color) });
}

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * p;
    gl_Position.z = gl_Position.w * 0.9999; // always just inside the far plane
  }
`;
const skyFragment = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uNight;
  uniform float uTime;
  varying vec3 vDir;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main() {
    vec3 d = normalize(vDir);
    float up = clamp(d.y, 0.0, 1.0);
    vec3 col = mix(uHorizon, uTop, pow(up, 0.55));
    // soft sun / moon disc and glow
    float s = max(dot(d, normalize(uSunDir)), 0.0);
    col += uSunColor * (pow(s, 900.0) * 1.2 + pow(s, 12.0) * 0.18);
    // stars: round, scattered, gently twinkling; only at night and above the horizon
    if (uNight > 0.01 && d.y > 0.0) {
      vec2 uv = vec2(atan(d.z, d.x) * 38.0, asin(d.y) * 38.0);
      vec2 cell = floor(uv);
      float r = hash(cell);
      if (r > 0.86) {
        vec2 o = vec2(hash(cell + 3.1), hash(cell + 7.7)) * 0.6 + 0.2;
        float dist = length(fract(uv) - o);
        float size = 0.05 + 0.08 * hash(cell + 1.3);
        float star = smoothstep(size, 0.0, dist);
        float tw = 0.65 + 0.35 * sin(uTime * (1.0 + r * 3.0) + r * 50.0);
        col += vec3(1.0, 0.96, 0.88) * star * tw * uNight * smoothstep(0.0, 0.2, d.y);
      }
    }
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

const haloVertex = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  uniform float uScale;
  varying vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uScale / max(-mv.z, 0.1);
    vColor = aColor;
  }
`;
const haloFragment = /* glsl */ `
  uniform float uNight;
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = pow(max(1.0 - d, 0.0), 2.2) * uNight;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor * a, a);
  }
`;

// palettes: day, sunset, night
const P = {
  top: [0x8fcfe6, 0x6a78c0, 0x0c1534],
  horizon: [0xf6d7b0, 0xf39b6d, 0x2b3768],
  sun: [0xffffff, 0xffb07a, 0xa9b9ff],
  sunI: [2.2, 1.5, 0.35],
  hemiSky: [0xfff1dd, 0xffc7a0, 0x6b7cc4],
  hemiGround: [0xc98d6b, 0xa8705a, 0x2a2540],
  hemiI: [1.5, 1.2, 0.6],
};

export function createDayNight(opts: {
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  fog: THREE.Fog;
  renderer: THREE.WebGLRenderer;
}) {
  const { scene, sun, hemi, fog, renderer } = opts;
  const uniforms = {
    uTop: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0.5, 0.6, 0.3) },
    uSunColor: { value: new THREE.Color() },
    uNight: { value: 0 },
    uTime: { value: 0 },
  };
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(600, 32, 16),
    new THREE.ShaderMaterial({ vertexShader: skyVertex, fragmentShader: skyFragment, uniforms, side: THREE.BackSide, depthWrite: false, fog: false })
  );
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  scene.add(dome);
  scene.background = null;

  // halos (built lazily on the first update, after every place has registered its lamps)
  let haloMat: THREE.ShaderMaterial | null = null;
  function buildHalos() {
    const pos = new Float32Array(halos.length * 3);
    const size = new Float32Array(halos.length);
    const color = new Float32Array(halos.length * 3);
    halos.forEach((h, i) => {
      pos.set([h.p.x, h.p.y, h.p.z], i * 3);
      size[i] = h.size;
      color.set([h.color.r, h.color.g, h.color.b], i * 3);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
    haloMat = new THREE.ShaderMaterial({
      vertexShader: haloVertex,
      fragmentShader: haloFragment,
      uniforms: { uNight: { value: 0 }, uScale: { value: 800 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geo, haloMat);
    points.frustumCulled = false;
    points.renderOrder = 6;
    scene.add(points);
  }

  const CYCLE = 600; // seconds for a full day
  let phase = 0.2; // 0 sunrise, 0.25 noon, 0.5 sunset, 0.75 midnight
  let target: number | null = null;
  const c = new THREE.Color();
  const mix3 = (list: number[], day: number, dusk: number, out: THREE.Color) =>
    out.set(list[0]).lerp(c.set(list[1]), dusk).lerp(c.set(list[2]), 1 - day);
  const mixN = (list: number[], day: number, dusk: number) => (list[0] * (1 - dusk) + list[1] * dusk) * day + list[2] * (1 - day);

  return {
    /** Jump toward night if it's day, toward noon if it's night. */
    toggle() {
      target = env.night > 0.5 ? 0.25 : 0.75;
    },
    get isNight() {
      return env.night > 0.5;
    },
    update(dt: number, t: number, camera: THREE.Camera) {
      if (!haloMat) buildHalos();
      if (target !== null) {
        const ahead = (((target - phase) % 1) + 1) % 1;
        const step = Math.min(ahead, dt * 0.12);
        phase = (phase + step) % 1;
        if (ahead < 0.002) target = null;
      } else phase = (phase + dt / CYCLE) % 1;

      const elev = Math.sin(phase * Math.PI * 2) + 0.25; // a bit more day than night
      const day = THREE.MathUtils.smoothstep(elev, -0.2, 0.3);
      const dusk = THREE.MathUtils.clamp(1 - Math.abs(elev - 0.05) / 0.35, 0, 1) * day;
      env.night = 1 - day;
      env.dusk = dusk;

      mix3(P.top, day, dusk, uniforms.uTop.value);
      mix3(P.horizon, day, dusk, uniforms.uHorizon.value);
      mix3(P.sun, day, dusk, uniforms.uSunColor.value);
      uniforms.uNight.value = env.night;
      uniforms.uTime.value = t;
      // the sun (or moon) sits in the sky roughly where the shadows come from
      const a = phase * Math.PI * 2;
      uniforms.uSunDir.value.set(Math.cos(a) * 0.8, Math.max(Math.sin(a), 0.08) * (day > 0.5 ? 1 : 0.6) + 0.1, 0.35).normalize();
      if (env.night > 0.5) uniforms.uSunDir.value.set(-0.4, 0.55, -0.3).normalize(); // moon

      fog.color.copy(uniforms.uHorizon.value);
      mix3(P.sun, day, dusk, sun.color);
      sun.intensity = mixN(P.sunI, day, dusk);
      mix3(P.hemiSky, day, dusk, hemi.color);
      mix3(P.hemiGround, day, dusk, hemi.groundColor);
      hemi.intensity = mixN(P.hemiI, day, dusk);
      renderer.toneMappingExposure = 1 - env.night * 0.1;
      nightTint.value.setRGB(1, 1, 1).lerp(c.set(0xffc9a8), dusk * 0.35).lerp(c.setRGB(0.3, 0.36, 0.58), env.night);

      for (const g of glows) {
        g.m.emissive.copy(g.day).lerp(g.night, env.night);
        g.m.emissiveIntensity = g.dayI + (g.nightI - g.dayI) * env.night;
      }
      if (haloMat) {
        haloMat.uniforms.uNight.value = THREE.MathUtils.smoothstep(env.night, 0.35, 0.9);
        haloMat.uniforms.uScale.value = renderer.domElement.height / (2 * Math.tan((21 * Math.PI) / 180));
      }
      dome.position.copy(camera.position);
    },
  };
}
