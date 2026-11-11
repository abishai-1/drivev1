// Broadphase for a big world that's almost entirely static (trees, posts, walls, terrain).
// cannon's SAP broadphase sweeps all ~3000 bodies against each other every step (≈12 ms); here static bodies
// sit in a spatial hash built once, and only awake moving bodies look up what's near them.
import * as CANNON from 'cannon-es';

const CELL = 16;
const BIG = 64; // static bodies wider than this (terrain, long walls) are always checked

export class StaticHashBroadphase extends CANNON.Broadphase {
  private cells = new Map<number, CANNON.Body[]>();
  private big: CANNON.Body[] = [];
  private staticCount = -1;
  private stamp = 0;
  private seen = new WeakMap<CANNON.Body, number>();
  private moving: CANNON.Body[] = [];

  constructor(world: CANNON.World) {
    super();
    this.world = world;
    this.useBoundingBoxes = true;
  }

  private key(cx: number, cz: number) {
    return cx * 73856093 + cz;
  }

  private rebuild(world: CANNON.World) {
    this.cells.clear();
    this.big = [];
    let count = 0;
    for (const b of world.bodies) {
      if (b.type !== CANNON.Body.STATIC) continue;
      count++;
      if (b.aabbNeedsUpdate) b.updateAABB();
      const lo = b.aabb.lowerBound;
      const hi = b.aabb.upperBound;
      if (hi.x - lo.x > BIG || hi.z - lo.z > BIG) {
        this.big.push(b);
        continue;
      }
      for (let cx = Math.floor(lo.x / CELL); cx <= Math.floor(hi.x / CELL); cx++) {
        for (let cz = Math.floor(lo.z / CELL); cz <= Math.floor(hi.z / CELL); cz++) {
          const k = this.key(cx, cz);
          const list = this.cells.get(k);
          if (list) list.push(b);
          else this.cells.set(k, [b]);
        }
      }
    }
    this.staticCount = count;
  }

  private sync(world: CANNON.World) {
    let count = 0;
    this.moving.length = 0;
    for (const b of world.bodies) {
      if (b.type === CANNON.Body.STATIC) count++;
      else this.moving.push(b);
    }
    if (count !== this.staticCount) this.rebuild(world);
  }

  /** Static bodies whose AABB overlaps `aabb` (each once). */
  private eachStatic(aabb: CANNON.AABB, fn: (b: CANNON.Body) => void) {
    const s = ++this.stamp;
    for (const b of this.big) fn(b);
    const lo = aabb.lowerBound;
    const hi = aabb.upperBound;
    for (let cx = Math.floor(lo.x / CELL); cx <= Math.floor(hi.x / CELL); cx++) {
      for (let cz = Math.floor(lo.z / CELL); cz <= Math.floor(hi.z / CELL); cz++) {
        const list = this.cells.get(this.key(cx, cz));
        if (!list) continue;
        for (const b of list) {
          if (this.seen.get(b) === s) continue;
          this.seen.set(b, s);
          fn(b);
        }
      }
    }
  }

  collisionPairs(world: CANNON.World, p1: CANNON.Body[], p2: CANNON.Body[]) {
    this.sync(world);
    const awake = (b: CANNON.Body) => b.sleepState !== CANNON.Body.SLEEPING;
    for (let i = 0; i < this.moving.length; i++) {
      const a = this.moving[i];
      if (a.aabbNeedsUpdate) a.updateAABB();
      // moving vs moving (small list); each pair once
      for (let j = i + 1; j < this.moving.length; j++) {
        const b = this.moving[j];
        if (!awake(a) && !awake(b)) continue;
        if (this.needBroadphaseCollision(a, b)) this.intersectionTest(a, b, p1, p2);
      }
      if (!awake(a)) continue;
      this.eachStatic(a.aabb, (b) => {
        if (this.needBroadphaseCollision(a, b)) this.intersectionTest(a, b, p1, p2);
      });
    }
    // every pair is produced exactly once above, so no makePairsUnique (cannon's version also leaks its key list)
  }

  aabbQuery(world: CANNON.World, aabb: CANNON.AABB, result: CANNON.Body[] = []) {
    this.sync(world);
    this.eachStatic(aabb, (b) => {
      if (b.aabb.overlaps(aabb)) result.push(b);
    });
    for (const b of this.moving) {
      if (b.aabbNeedsUpdate) b.updateAABB();
      if (b.aabb.overlaps(aabb)) result.push(b);
    }
    return result;
  }
}
