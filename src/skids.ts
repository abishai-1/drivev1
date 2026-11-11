// Skid marks: dark rubber streaks left behind sliding rear tyres. A fixed pool of flat quads, reused
// oldest-first, so they stay on the road for a while and then quietly get recycled.
import * as THREE from 'three';

const MAX = 900;
const SPACING = 0.45;

export function createSkids(scene: THREE.Scene) {
  const geo = new THREE.PlaneGeometry(0.34, SPACING + 0.08).rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x2a2230,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -6,
    polygonOffsetUnits: -12,
    fog: true,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, MAX);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  scene.add(mesh);

  let cursor = 0;
  const last: (THREE.Vector3 | null)[] = [null, null];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const UP = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);

  return {
    /** Call every frame with the rear tyre contact points; marks are laid only while `sliding`. */
    update(points: (THREE.Vector3 | null)[], sliding: boolean) {
      for (let w = 0; w < 2; w++) {
        const pt = points[w];
        if (!sliding || !pt) {
          last[w] = null;
          continue;
        }
        const prev = last[w];
        if (!prev) {
          last[w] = pt.clone();
          continue;
        }
        const d = Math.hypot(pt.x - prev.x, pt.z - prev.z);
        if (d < SPACING) continue;
        if (d > 3) {
          last[w]!.copy(pt); // teleport / jump: don't draw a long streak
          continue;
        }
        pos.set((pt.x + prev.x) / 2, (pt.y + prev.y) / 2 + 0.03, (pt.z + prev.z) / 2);
        q.setFromAxisAngle(UP, Math.atan2(pt.x - prev.x, pt.z - prev.z));
        mesh.setMatrixAt(cursor, m.compose(pos, q, one.set(1, 1, d / SPACING)));
        cursor = (cursor + 1) % MAX;
        mesh.count = Math.min(mesh.count + 1, MAX);
        mesh.instanceMatrix.needsUpdate = true;
        prev.copy(pt);
      }
    },
  };
}
