// Exploration progress: gems hidden around the island, and which portfolio stops you've visited.
// Saved in localStorage so progress survives a reload.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PLACES, runwayPoint } from './layout';
import { type Ctx } from './utils';
import { outline } from './look';
import { glow } from './sky';

const KEY = 'drivefolio.progress';

interface Saved {
  gems: number[];
  stops: string[];
}
function load(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Saved>;
    return { gems: Array.isArray(raw.gems) ? raw.gems : [], stops: Array.isArray(raw.stops) ? raw.stops : [] };
  } catch {
    return { gems: [], stops: [] };
  }
}
function save(s: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* progress just won't persist */
  }
}

/** Where the gems hide: [x, z, height above whatever is there]. The last one is for pilots. */
function spots(): [number, number, number][] {
  const P = PLACES;
  const [rx, rz] = runwayPoint(78, 0);
  return [
    [P.home.x - 14, P.home.z + 12, 1.6],
    [P.city.x + 15, P.city.z + 2, 1.6],
    [P.stadium.x + 12, P.stadium.z - 16, 1.6],
    [P.beach.x + 12, P.beach.z + 8, 1.6],
    [P.studio.x + 14, P.studio.z - 12, 1.6],
    [P.jungle.x + 15, P.jungle.z - 20, 2.2],
    [P.canyon.x - 10, P.canyon.z - 30, 2.2],
    [rx, rz, 1.6],
    [P.village.x, P.village.z + 6, 1.6],
    [P.farm.x + 12, P.farm.z + 4, 1.6],
    [P.windfarm.x, P.windfarm.z, 2],
    [P.lake.x, P.lake.z, 42],
  ];
}

export function createProgress(ctx: Ctx, stopTitles: string[]) {
  const saved = load();
  const ray = new CANNON.RaycastResult();
  const from = new CANNON.Vec3();
  const to = new CANNON.Vec3();
  /** Top of whatever stands at (x, z): ground, or a roof / temple step if there's one. */
  const surface = (x: number, z: number) => {
    const g = ctx.terrain.sample(x, z);
    from.set(x, g + 60, z);
    to.set(x, g - 1, z);
    ray.reset();
    ctx.world.raycastClosest(from, to, { skipBackfaces: true }, ray);
    return ray.hasHit ? Math.max(g, ray.hitPointWorld.y) : g;
  };

  const geo = new THREE.OctahedronGeometry(0.9, 0);
  const material = glow(new THREE.MeshStandardMaterial({ color: 0x59c3e8, emissive: 0x2a7fa8, emissiveIntensity: 0.6, roughness: 0.25, flatShading: true }), 0x6fe0ff, 0.6, 1.4);
  const gems = spots().map(([x, z, lift], i) => {
    let y = ctx.terrain.sample(x, z) + lift;
    if (lift < 10) {
      // sit on low things (steps, platforms) but nudge sideways off anything tall (buildings)
      let top = surface(x, z);
      for (let k = 0; k < 12 && top - ctx.terrain.sample(x, z) > 3; k++) {
        const a = k * 2.4;
        x += Math.cos(a) * 4;
        z += Math.sin(a) * 4;
        top = surface(x, z);
      }
      y = top + lift;
    }
    const mesh = outline(new THREE.Mesh(geo, material));
    mesh.castShadow = true;
    mesh.position.set(x, y, z);
    mesh.visible = !saved.gems.includes(i);
    ctx.scene.add(mesh);
    return { i, mesh, base: y };
  });

  ctx.updaters.push((t) => {
    for (const g of gems) {
      if (!g.mesh.visible) continue;
      g.mesh.rotation.y = t * 1.6 + g.i;
      g.mesh.position.y = g.base + Math.sin(t * 2 + g.i) * 0.25;
    }
  });

  return {
    get found() {
      return saved.gems.length;
    },
    totalGems: gems.length,
    get visited() {
      return saved.stops.length;
    },
    totalStops: stopTitles.length,
    /** Uncollected gem positions, for the map. */
    remaining: () => gems.filter((g) => g.mesh.visible).map((g) => g.mesh.position),
    /** Collect any gem you're touching; returns its world position (for effects) or null. */
    update(at: THREE.Vector3): THREE.Vector3 | null {
      for (const g of gems) {
        if (!g.mesh.visible || g.mesh.position.distanceTo(at) > 3) continue;
        g.mesh.visible = false;
        saved.gems.push(g.i);
        save(saved);
        return g.mesh.position;
      }
      return null;
    },
    /** Mark a portfolio stop as visited; true the first time. */
    visit(title: string) {
      if (saved.stops.includes(title)) return false;
      saved.stops.push(title);
      save(saved);
      return true;
    },
  };
}
