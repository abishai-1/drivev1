// Road surfaces, junctions, bridges, signposts and street lamps for the whole network.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { C } from './palette';
import { PLACES } from './layout';
import { ROAD_SINK, type Path } from './paths';
import { decalMat, ribbon, stripeTexture } from './track';
import { type Ctx, canvasTexture, clearOfRoad, instanced, mat, shadowed, staticBox, trs } from './utils';

export function buildRoads(ctx: Ctx) {
  const { scene, net } = ctx;

  const roadTex = stripeTexture((g, w, h) => {
    g.fillStyle = '#625d67';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#f2b134';
    g.fillRect(w / 2 - 1.5, 0, 3, h * 0.55); // dashed yellow center line
    g.fillStyle = '#e9dccb';
    g.fillRect(2, 0, 2, h);
    g.fillRect(w - 4, 0, 2, h);
  });
  const streetTex = stripeTexture((g, w, h) => {
    g.fillStyle = '#5b5660';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#e9dccb';
    g.fillRect(2, 0, 2, h);
    g.fillRect(w - 4, 0, 2, h);
  });
  const roadMat = decalMat(roadTex, 2);
  const streetMat = decalMat(streetTex, 2);
  const sidewalkMat = decalMat(stripeTexture((g, w, h) => {
    g.fillStyle = '#d8c9b4';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#c4b49d';
    g.fillRect(0, 0, w, 3);
  }), 2);

  for (const road of net.roads) {
    if (road.kind === 'track') continue;
    const hw = road.halfWidth;
    const surface = new THREE.Mesh(ribbon(road, -hw, hw, 0.07, 8), road.kind === 'street' ? streetMat : roadMat);
    surface.receiveShadow = true;
    scene.add(surface);
    if (road.kind === 'street') {
      for (const side of [-1, 1]) {
        const a = side * hw;
        const b = side * (hw + 1.8);
        const walk = new THREE.Mesh(ribbon(road, Math.min(a, b), Math.max(a, b), 0.12, 4), sidewalkMat);
        walk.receiveShadow = true;
        scene.add(walk);
      }
    }
  }

  buildJunctions(ctx);
  for (const road of net.roads) buildBridges(ctx, road);
  buildSignposts(ctx);
  buildLamps(ctx);
}

/** Asphalt patches where roads meet, covering the overlapping edge lines. */
function buildJunctions(ctx: Ctx) {
  const { net, scene } = ctx;
  const found: { x: number; z: number; y: number; r: number }[] = [];
  for (const a of net.roads) {
    for (let i = 0; i < a.points.length; i += 2) {
      const p = a.points[i];
      for (const b of net.roads) {
        if (b === a) continue;
        // quick reject using b's bounds is unnecessary at this size; scan b's samples near p via the index
        const hit = net.roadIndex.nearest(p.x, p.z);
        if (hit.path !== b && hit.path !== a) continue;
        const q = b.points.reduce((best, s) => ((s.x - p.x) ** 2 + (s.z - p.z) ** 2 < (best.x - p.x) ** 2 + (best.z - p.z) ** 2 ? s : best), b.points[0]);
        const d = Math.hypot(q.x - p.x, q.z - p.z);
        if (d > Math.min(a.halfWidth, b.halfWidth)) continue;
        if (found.some((f) => Math.hypot(f.x - p.x, f.z - p.z) < 10)) continue;
        found.push({ x: (p.x + q.x) / 2, z: (p.z + q.z) / 2, y: Math.max(p.y, q.y), r: Math.max(a.halfWidth, b.halfWidth) + 1.2 });
      }
    }
  }
  const disk = new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2);
  const m = new THREE.MeshStandardMaterial({ color: 0x5b5660, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -10 }); // matches the street asphalt
  instanced(scene, disk, m, found.map((f) => trs(f.x, f.y + 0.11 - ROAD_SINK, f.z, 0, f.r, 1, f.r)), undefined, false);
}

/** Decks, railings and colliders wherever a road crosses water. */
function buildBridges(ctx: Ctx, road: Path) {
  const { points, tangents, bridge, halfWidth: hw } = road;
  const deck: THREE.Matrix4[] = [];
  const rails: THREE.Matrix4[] = [];
  const posts: THREE.Matrix4[] = [];
  const n = points.length;
  const at = (i: number) => bridge[road.closed ? (i + n) % n : i] ?? false;
  for (let i = 0; i < n; i++) {
    // decks run 2 samples past each end onto solid ground, so there's no pothole where the bank drops away
    const onSpan = bridge[i];
    if (!onSpan && !at(i - 1) && !at(i - 2) && !at(i + 1) && !at(i + 2)) continue;
    const p = points[i];
    const t = tangents[i];
    const yaw = Math.atan2(t.x, t.z);
    // tilt each slab to the road's slope, otherwise a sloping deck becomes a staircase that trips the wheels
    const a = points[Math.max(i - 1, 0)];
    const b = points[Math.min(i + 1, points.length - 1)];
    const pitch = Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z));
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-pitch, yaw, 0, 'YXZ'));
    deck.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y - ROAD_SINK - 0.3, p.z), q, new THREE.Vector3(hw * 2 + 1, 0.6, 2.6)));
    // physics: thin slab under the road surface (the terrain is carved away below)
    const body = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(hw + 0.5, 0.3, 1.3)) });
    body.position.set(p.x, p.y - ROAD_SINK - 0.3, p.z);
    body.quaternion.set(q.x, q.y, q.z, q.w);
    ctx.world.addBody(body);
    if (!onSpan) continue;
    for (const side of [-1, 1]) {
      const x = p.x - t.z * side * (hw + 0.7);
      const z = p.z + t.x * side * (hw + 0.7);
      rails.push(trs(x, p.y + 0.9, z, yaw, 0.25, 0.25, 2.3));
      if (i % 2 === 0) posts.push(trs(x, p.y + 0.45, z, yaw, 0.3, 0.9, 0.3));
      if (i % 3 === 0) staticBox(ctx, x, p.y + 0.6, z, 0.15, 0.6, 1.2, yaw);
    }
    // pillars down to the riverbed
    if (i % 6 === 0) posts.push(trs(p.x, p.y - 3, p.z, yaw, 1.2, 5.4, 1.2));
  }
  if (!deck.length) return;
  const box = new THREE.BoxGeometry(1, 1, 1);
  instanced(ctx.scene, box, mat(0xb08a6a), deck);
  instanced(ctx.scene, box, mat(C.cream), rails);
  instanced(ctx.scene, box, mat(0x9a7b63), posts);
}

/** Wooden signposts at both ends of every country road, pointing to the other end. */
function buildSignposts(ctx: Ctx) {
  for (const road of ctx.net.roads) {
    if (road.kind !== 'road') continue;
    const ends: [number, number, string][] = [
      [4, 1, road.to],
      [road.points.length - 5, -1, road.from],
    ];
    for (const [i, dir, name] of ends) {
      const t = road.tangents[i];
      // try the right side, then the left, a bit further along if needed; never stand in another road
      let spot: [number, number] | null = null;
      for (const shift of [0, 3, 6]) {
        const j = Math.min(Math.max(i + dir * shift, 0), road.points.length - 1);
        const q = road.points[j];
        const u = road.tangents[j];
        for (const side of [1, -1]) {
          const sx = q.x - u.z * side * (road.halfWidth + 2.2);
          const sz = q.z + u.x * side * (road.halfWidth + 2.2);
          if (!spot && clearOfRoad(ctx, sx, sz, 0.8)) spot = [sx, sz];
        }
      }
      if (!spot) continue;
      const [x, z] = spot;
      const y = ctx.terrain.sample(x, z);
      const post = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.25, 3, 0.25), mat(0x8a5a44)));
      post.position.set(x, y + 1.5, z);
      const tex = canvasTexture(256, 64, (g) => {
        g.fillStyle = '#fff7ec';
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(226, 0);
        g.lineTo(256, 32);
        g.lineTo(226, 64);
        g.lineTo(0, 64);
        g.fill();
        g.fillStyle = '#3b2a3f';
        g.font = 'bold 30px system-ui, sans-serif';
        g.textBaseline = 'middle';
        g.fillText(name, 12, 34, 205);
      });
      const board = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.65), new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, transparent: true }));
      board.position.set(x, y + 2.6, z);
      // face across the road; arrow points along the road toward `name`
      board.rotation.y = Math.atan2(t.x * dir, t.z * dir) - Math.PI / 2;
      ctx.scene.add(post, board);
      staticBox(ctx, x, y + 1.5, z, 0.15, 1.5, 0.15);
    }
  }
}

/** Street lamps along roads near settlements. */
function buildLamps(ctx: Ctx) {
  const towns = [PLACES.home, PLACES.city, PLACES.village, PLACES.farm, PLACES.stadium];
  const poles: THREE.Matrix4[] = [];
  const heads: THREE.Matrix4[] = [];
  for (const road of ctx.net.roads) {
    for (let i = 0; i < road.points.length; i += 11) {
      const p = road.points[i];
      if (road.bridge[i]) continue;
      if (!towns.some((tw) => Math.hypot(p.x - tw.x, p.z - tw.z) < tw.radius + 35)) continue;
      const t = road.tangents[i];
      const side = (i / 11) % 2 ? 1 : -1;
      const x = p.x - t.z * side * (road.halfWidth + 1.6);
      const z = p.z + t.x * side * (road.halfWidth + 1.6);
      if (ctx.net.roadIndex.nearest(x, z, true).dist < 0.8) continue; // don't plant lamps in a crossing road
      const y = ctx.terrain.sample(x, z);
      poles.push(trs(x, y + 2.6, z, 0, 0.16, 5.2, 0.16));
      heads.push(trs(x, y + 5.3, z, 0, 0.75, 0.35, 0.75));
      staticBox(ctx, x, y + 2.6, z, 0.12, 2.6, 0.12);
    }
  }
  const box = new THREE.BoxGeometry(1, 1, 1);
  instanced(ctx.scene, box, mat(C.carDark), poles);
  instanced(ctx.scene, box, new THREE.MeshStandardMaterial({ color: 0xfff2b0, emissive: 0xffe27a, emissiveIntensity: 0.9 }), heads, undefined, false);
}
