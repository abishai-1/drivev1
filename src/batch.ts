// Static batching: after the island is built, every mesh that never moves is baked into one merged mesh
// per material per 160 m cell. Hundreds of draw calls (and their outlines) become a few dozen.
// Meshes that animate are found automatically: the per-frame updaters are run a few times and anything
// whose transform changed is left alone.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { outlineMaterial, trackHull } from './look';

const CELL = 160;

export function mergeStatic(scene: THREE.Scene, updaters: ((t: number, dt: number) => void)[], keep: THREE.Object3D[]) {
  scene.updateMatrixWorld(true);
  const skip = new Set<THREE.Object3D>();
  for (const k of keep) k.traverse((o) => skip.add(o));

  const candidates: THREE.Mesh[] = [];
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || m.userData.isOutline || skip.has(m) || !m.visible) return;
    if (m.userData.noMerge || Array.isArray(m.material)) return;
    const mat = m.material as THREE.Material;
    if (mat.transparent || (mat as THREE.ShaderMaterial).isShaderMaterial || mat.userData.motion) return;
    const g = m.geometry;
    if (g.morphAttributes.position || !g.attributes.normal) return;
    candidates.push(m);
  });

  // anything an updater moves (rotors, beams, trophies…) must stay a separate object
  const before = candidates.map((m) => m.matrixWorld.clone());
  for (const t of [0.37, 2.9, 7.3]) for (const u of updaters) u(t, 1 / 60);
  scene.updateMatrixWorld(true);
  const stable = candidates.filter((m, i) => m.matrixWorld.equals(before[i]));

  interface Group {
    material: THREE.Material;
    cast: boolean;
    receive: boolean;
    outline: boolean;
    geos: THREE.BufferGeometry[];
  }
  const groups = new Map<string, Group>();
  const rot = new THREE.Matrix3();
  const dir = new THREE.Vector3();
  const center = new THREE.Vector3();
  // mat() makes a new material per call: group by what a material looks like, not by identity
  const looks = new Map<string, THREE.Material>();
  const lookOf = (mat: THREE.Material) => {
    const a = mat as THREE.MeshStandardMaterial;
    const sig = [mat.type, a.color?.getHex(), a.emissive?.getHex(), a.emissiveIntensity, a.map?.uuid, a.roughness, a.metalness, mat.vertexColors, mat.side, a.flatShading, (mat.userData.patchKeys as string[] | undefined)?.join(','), mat.userData.solid].join('|');
    let shared = looks.get(sig);
    if (!shared) looks.set(sig, (shared = mat));
    return shared;
  };

  for (const m of stable) {
    const material = lookOf(m.material as THREE.Material);
    const hasUv = !!(material as THREE.MeshStandardMaterial).map;
    const hasColor = !!material.vertexColors;
    const outlined = m.children.some((c) => c.userData.isOutline);
    m.getWorldPosition(center);
    const key = [material.uuid, Math.floor(center.x / CELL), Math.floor(center.z / CELL), m.castShadow, m.receiveShadow, outlined, hasUv, hasColor].join('/');

    let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    g.clearGroups();
    for (const name of Object.keys(g.attributes)) {
      if (name === 'position' || name === 'normal' || (name === 'uv' && hasUv) || (name === 'color' && hasColor)) continue;
      g.deleteAttribute(name);
    }
    // outline direction per vertex: away from the object's own center, in world space
    const pos = g.attributes.position;
    const out = new Float32Array(pos.count * 3);
    rot.setFromMatrix4(m.matrixWorld);
    for (let i = 0; i < pos.count; i++) {
      dir.set(pos.getX(i) + 1e-4, pos.getY(i) + 2e-4, pos.getZ(i) + 3e-4).normalize().applyMatrix3(rot).normalize();
      out.set([dir.x, dir.y, dir.z], i * 3);
    }
    g.setAttribute('aOutDir', new THREE.BufferAttribute(out, 3));
    g.applyMatrix4(m.matrixWorld);
    g = g as THREE.BufferGeometry;

    let group = groups.get(key);
    if (!group) {
      group = { material, cast: m.castShadow, receive: m.receiveShadow, outline: outlined, geos: [] };
      groups.set(key, group);
    }
    group.geos.push(g);
    m.removeFromParent();
  }

  let made = 0;
  for (const group of groups.values()) {
    const merged = mergeGeometries(group.geos, false);
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, group.material);
    mesh.castShadow = group.cast;
    mesh.receiveShadow = group.receive;
    mesh.matrixAutoUpdate = false;
    scene.add(mesh);
    if (group.outline) {
      const hull = new THREE.Mesh(merged, outlineMaterial(group.material, true));
      hull.matrixAutoUpdate = false;
      hull.userData.isOutline = true;
      scene.add(hull);
      trackHull(hull);
    }
    made++;
    group.geos.forEach((g) => g.dispose());
  }
  return { merged: stable.length, into: made };
}

/**
 * Physics props (bricks, crates, pins…) drawn as one InstancedMesh per kind instead of one mesh each.
 * Returns a sync function that copies awake bodies into their instance matrices.
 */
export function instanceDynamic(scene: THREE.Scene, dynamic: { mesh: THREE.Object3D; body: import('cannon-es').Body }[]) {
  const groups = new Map<string, { geo: THREE.BufferGeometry; material: THREE.Material; items: { body: import('cannon-es').Body; scale: THREE.Vector3 }[]; outline: boolean }>();
  const rest: typeof dynamic = [];
  for (const d of dynamic) {
    const m = d.mesh as THREE.Mesh;
    const ok = m.isMesh && !Array.isArray(m.material) && m.children.every((c) => c.userData.isOutline);
    if (!ok) {
      rest.push(d);
      continue;
    }
    const mat = m.material as THREE.MeshToonMaterial;
    // same shape + same look → same instanced mesh (builders often make a new geometry per prop)
    const geoSig = m.geometry.type + JSON.stringify((m.geometry as THREE.BoxGeometry).parameters ?? m.geometry.uuid);
    const key = [geoSig, mat.type, mat.color?.getHex(), (mat.userData.patchKeys as string[] | undefined)?.join(',')].join('|');
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { geo: m.geometry, material: mat, items: [], outline: m.children.length > 0 }));
    g.items.push({ body: d.body, scale: m.scale.clone() });
  }
  const sets: { mesh: THREE.InstancedMesh; items: { body: import('cannon-es').Body; scale: THREE.Vector3 }[] }[] = [];
  for (const g of groups.values()) {
    if (g.items.length < 3) {
      // not worth it: keep them as plain meshes
      for (const d of dynamic) if (g.items.some((it) => it.body === d.body)) rest.push(d);
      continue;
    }
    const mesh = new THREE.InstancedMesh(g.geo, g.material, g.items.length);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false; // bricks can fly anywhere
    scene.add(mesh);
    if (g.outline) {
      const hull = new THREE.InstancedMesh(g.geo, outlineMaterial(g.material), g.items.length);
      hull.instanceMatrix = mesh.instanceMatrix;
      hull.frustumCulled = false;
      scene.add(hull);
    }
    for (const d of dynamic) if (g.items.some((it) => it.body === d.body)) d.mesh.removeFromParent();
    sets.push({ mesh, items: g.items });
  }
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const m4 = new THREE.Matrix4();
  const sync = (force = false) => {
    for (const s of sets) {
      let dirty = false;
      s.items.forEach((it, i) => {
        if (!force && it.body.sleepState === 2) return; // sleeping: matrix is already right
        const b = it.body;
        const bp = force ? b.position : b.interpolatedPosition;
        const bq = force ? b.quaternion : b.interpolatedQuaternion;
        p.set(bp.x, bp.y, bp.z);
        q.set(bq.x, bq.y, bq.z, bq.w);
        s.mesh.setMatrixAt(i, m4.compose(p, q, it.scale));
        dirty = true;
      });
      if (dirty) s.mesh.instanceMatrix.needsUpdate = true;
    }
  };
  sync(true);
  return { rest, sync };
}
