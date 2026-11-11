// The "soft toon" look: banded toon shading, ink outlines, and see-through objects between the camera and
// the car. Everything that uses `mat()` (utils.ts) or goes through `instanced()` / `shadowed()` gets it.
import * as THREE from 'three';

export const INK = 0x3b2a3f;

/** Shared uniforms, updated once per frame by main.ts. */
export const lookUniforms = {
  uCamPos: { value: new THREE.Vector3() },
  uFadeTarget: { value: new THREE.Vector3() },
  /** Outline width as a fraction of view depth (≈ constant on-screen thickness). */
  uOutline: { value: 0.0032 },
};

/** Three soft tones: shade, mid, lit. */
export const toonRamp = (() => {
  const tex = new THREE.DataTexture(new Uint8Array([120, 190, 255]), 3, 1, THREE.RedFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
})();

type Shader = THREE.WebGLProgramParametersWithUniforms;

/** Chain a shader patch onto a material without clobbering earlier patches (wind, fade, outline…). */
export function patchMaterial<T extends THREE.Material>(m: T, key: string, fn: (s: Shader) => void): T {
  const prev = m.onBeforeCompile;
  const keys = [...((m.userData.patchKeys as string[] | undefined) ?? []), key];
  m.userData.patchKeys = keys;
  m.onBeforeCompile = (s, r) => {
    prev.call(m, s, r);
    fn(s);
  };
  m.customProgramCacheKey = () => keys.join('|');
  return m;
}

/**
 * Dithered see-through: fragments in a tube between the camera and the car are discarded in a fine
 * screen-space pattern, so trees, palms and buildings never hide the car.
 */
export function addOcclusionFade<T extends THREE.Material>(m: T, hard = false): T {
  return patchMaterial(m, hard ? 'fade-hard' : 'fade', (s) => {
    s.uniforms.uCamPos = lookUniforms.uCamPos;
    s.uniforms.uFadeTarget = lookUniforms.uFadeTarget;
    s.vertexShader = s.vertexShader
      .replace('void main() {', 'varying vec3 vFadeW;\nvoid main() {')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 fadeW = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          fadeW = instanceMatrix * fadeW;
        #endif
        vFadeW = (modelMatrix * fadeW).xyz;`
      );
    s.fragmentShader = s.fragmentShader.replace(
      'void main() {',
      `uniform vec3 uCamPos;
      uniform vec3 uFadeTarget;
      varying vec3 vFadeW;
      void main() {
        {
          vec3 seg = uFadeTarget - uCamPos;
          float len = max(length(seg), 0.001);
          float tt = dot(vFadeW - uCamPos, seg) / (len * len);
          float d = length(vFadeW - (uCamPos + seg * clamp(tt, 0.0, 1.0)));
          float fade = smoothstep(4.6, 2.2, d) * smoothstep(0.02, 0.12, tt) * step(tt, 1.0 - 1.2 / len);
          float n = fract(52.9829189 * fract(dot(floor(gl_FragCoord.xy), vec2(0.06711056, 0.00583715))));
          ${hard
            ? // outline hulls: gone anywhere inside the tube (their far side sits right next to the car)
              'if (smoothstep(9.0, 7.0, d) * smoothstep(0.02, 0.12, tt) * step(tt, 1.0 + 8.0 / len) > 0.05) discard;'
            : 'if (n < fade * 0.88) discard;'}
        }`
    );
  });
}

/** Toon material that never fades (the vehicle you drive). */
export function toonSolid(color: number) {
  const m = new THREE.MeshToonMaterial({ color, gradientMap: toonRamp });
  m.userData.solid = true; // its outline doesn't fade either
  return m;
}

/** The default material for everything solid: toon-shaded, outlined, fades out of the way. */
export function toon(color: number) {
  return addOcclusionFade(new THREE.MeshToonMaterial({ color, gradientMap: toonRamp }));
}

const outlineCache = new Map<string, THREE.MeshBasicMaterial>();

/** Back-face hull pushed out along the direction from the object's center: an inked silhouette. */
/** `baked`: merged static geometry carries its outline direction in an `aOutDir` attribute (batch.ts). */
export function outlineMaterial(source?: THREE.Material, baked = false): THREE.MeshBasicMaterial {
  // a vertex animation on the source (wind sway, crowd bounce) is copied so the outline moves with it
  const motion = source?.userData.motion as { key: string; apply: (m: THREE.Material) => void } | undefined;
  const solid = !!source?.userData.solid;
  const key = (motion ? motion.key : 'plain') + (solid ? '/solid' : '') + (baked ? '/baked' : '');
  const cached = outlineCache.get(key);
  if (cached) return cached;
  const m = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide, fog: true });
  if (motion) motion.apply(m);
  if (!solid) addOcclusionFade(m, true); // outlines vanish entirely where things go see-through (before the outline patch: same shader chunk)
  patchMaterial(m, baked ? 'outline-baked' : 'outline', (s) => {
    s.uniforms.uOutline = lookUniforms.uOutline;
    s.vertexShader = s.vertexShader
      .replace('void main() {', (baked ? 'attribute vec3 aOutDir;\n' : '') + 'uniform float uOutline;\nvoid main() {')
      .replace(
        '#include <project_vertex>',
        `vec4 mvPosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
          mat3 oM = mat3(modelViewMatrix) * mat3(instanceMatrix);
        #else
          mat3 oM = mat3(modelViewMatrix);
        #endif
        mvPosition = modelViewMatrix * mvPosition;
        vec3 oDir = normalize(oM * ${baked ? 'aOutDir' : 'normalize(position + vec3(0.0001, 0.0002, 0.0003))'});
        mvPosition.xyz += oDir * uOutline * clamp(-mvPosition.z, 2.0, 70.0);
        gl_Position = projectionMatrix * mvPosition;`
      );
  });
  outlineCache.set(key, m);
  return m;
}

// Outlines further than this are invisible in the fog anyway: skip drawing them.
const OUTLINE_RANGE = 200;
const hulls: THREE.Object3D[] = [];
/** Register an outline hull for distance culling. */
export function trackHull(o: THREE.Object3D) {
  hulls.push(o);
}
const _c = new THREE.Vector3();
const _s = new THREE.Sphere();
export function cullOutlines(camera: THREE.Vector3) {
  for (const h of hulls) {
    const mesh = h as THREE.Mesh;
    // instanced hulls and merged hulls (parented to the scene) use their bounding sphere
    const inst = mesh as THREE.InstancedMesh;
    const bs = inst.isInstancedMesh ? inst.boundingSphere : mesh.parent?.type === 'Scene' ? mesh.geometry.boundingSphere : null;
    if (!bs) {
      if (mesh.parent) h.visible = mesh.parent.getWorldPosition(_c).distanceTo(camera) < OUTLINE_RANGE;
      continue;
    }
    _s.copy(bs);
    h.visible = _s.center.distanceTo(camera) - _s.radius < OUTLINE_RANGE;
  }
}

/** Give a single mesh an ink outline (a child hull sharing its geometry). */
export function outline<T extends THREE.Mesh>(mesh: T): T {
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  if (material.transparent || mesh.userData.noOutline) return mesh;
  const hull = new THREE.Mesh(mesh.geometry, outlineMaterial(material));
  hull.castShadow = hull.receiveShadow = false;
  hull.userData.isOutline = true;
  hull.raycast = () => {};
  mesh.add(hull);
  trackHull(hull);
  return mesh;
}
