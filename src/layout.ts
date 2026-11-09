// One place to move things around. Everything (terrain, roads, rivers, map, zones) reads from here.
// Convention: north = -z (top of the map), east = +x.

export type PlaceId =
  | 'home' | 'city' | 'stadium' | 'beach' | 'studio' | 'jungle' | 'canyon' | 'airport'
  | 'village' | 'farm' | 'windfarm' | 'lake';

export interface Place {
  id: string;
  name: string;
  x: number;
  z: number;
  radius: number;
  /** If set, the terrain is flattened to this height inside the radius. */
  flat?: number;
}

/** World scale: every position below is multiplied by this (sizes of things are not). */
const S = 1.25;
const at = (x: number, z: number): [number, number] => [x * S, z * S];
const pts = (list: [number, number][]) => list.map(([x, z]) => at(x, z));
const place = (id: string, name: string, x: number, z: number, radius: number, flat?: number): Place => ({
  id, name, x: x * S, z: z * S, radius, flat,
});

export const WORLD_HALF = 500; // terrain covers -500..500 on x and z
export const GRID_STEP = 2; // terrain / heightfield resolution (m)
export const ISLAND_R = 412; // rough coastline radius (noise pushes it ±25)
export const WATER_Y = 0;

export const PLACES: Record<PlaceId, Place> = {
  home: place('home', 'Home', 0, 0, 26, 2),
  city: place('city', 'City', 26, -195, 66, 2),
  stadium: place('stadium', 'Stadium', 215, -26, 50, 2),
  beach: place('beach', 'Lighthouse Beach', 182, 195, 38, 1.1),
  studio: place('studio', 'Film Studio', -39, 231, 40, 2),
  jungle: place('jungle', 'Jungle', -156, 150, 105),
  canyon: place('canyon', 'Canyon', -247, 13, 85),
  airport: place('airport', 'Airport', -169, -169, 100, 2),
  village: place('village', 'Village', 115, 95, 38, 2),
  farm: place('farm', 'Farm', -100, -20, 46, 2),
  windfarm: place('windfarm', 'Wind Farm', 240, -150, 60),
  lake: place('lake', 'Lake', -45, -95, 22),
};

/** Flat stunt area inside the canyon. */
export const STUNT_PAD: Place = place('stunt', 'Stunt Park', -218, 58, 28, 2);

/** Crop fields at the farm, relative to its center: [dx, dz, halfWidth, halfDepth]. */
export const FARM_FIELDS: [number, number, number, number][] = (
  [
    [-18, -25, 14, 9],
    [18, -28, 12, 8],
    [-24, 24, 10, 12],
  ] as const
).map(([dx, dz, hx, hz]) => [PLACES.farm.x + dx, PLACES.farm.z + dz, hx, hz]);

/** Runway runs diagonally across the airport; `side` points away from the race track. */
export const RUNWAY = {
  x: PLACES.airport.x,
  z: PLACES.airport.z,
  dir: [Math.SQRT1_2, -Math.SQRT1_2] as const, // along the runway
  side: [-Math.SQRT1_2, -Math.SQRT1_2] as const, // perpendicular, away from the track
  length: 170,
  width: 22,
};

/** Runway-local (u along, v sideways) to world x/z. */
export function runwayPoint(u: number, v: number): [number, number] {
  return [
    RUNWAY.x + RUNWAY.dir[0] * u + RUNWAY.side[0] * v,
    RUNWAY.z + RUNWAY.dir[1] * u + RUNWAY.side[1] * v,
  ];
}

// ---------- Race track ----------
export const TRACK_HALF_WIDTH = 5.5;
/** Track start/finish is the sample closest to this point. */
export const TRACK_START: [number, number] = [PLACES.stadium.x, PLACES.stadium.z];
// Closed loop: stadium → city → airport → canyon → jungle → studio → beach → stadium
export const TRACK_POINTS: [number, number][] = pts([
  [215, 26], [215, -78], [169, -150], [97, -195], [26, -195], [-45, -195], [-78, -153], [-130, -98],
  [-195, -46], [-266, 6], [-260, 78], [-221, 140], [-156, 162], [-124, 214], [-72, 198], [26, 254],
  [104, 250], [169, 234], [247, 143], [254, 72],
]);

// ---------- Road network ----------
export interface RoadDef {
  id: string;
  from: string;
  to: string;
  points: [number, number][];
  halfWidth: number;
}

const C = PLACES.city;
const STREET_HW = 4;
const street = (id: string, a: [number, number], b: [number, number]): RoadDef => ({
  id, from: 'City', to: 'City', points: [a, b], halfWidth: STREET_HW,
});
// city street grid lines (relative to the city center; the city itself isn't scaled)
const CX = [-45, -15, 15, 45];
const CITY_EDGE = 56;
const cityPoint = (dx: number, dz: number): [number, number] => [C.x + dx, C.z + dz];
const lakeShore = at(-26, -80); // ~8 m back from the water's edge

export const ROADS: RoadDef[] = [
  { id: 'home-city', from: 'Home', to: 'City', halfWidth: 4.5, points: [at(0, -18), at(3, -60), at(8, -100), [C.x - 15, C.z + 90], cityPoint(-15, CITY_EDGE)] },
  { id: 'home-stadium', from: 'Home', to: 'Stadium', halfWidth: 4.5, points: pts([[18, 2], [80, -5], [140, -18], [188, -26]]) },
  { id: 'home-beach', from: 'Home', to: 'Lighthouse Beach', halfWidth: 4.5, points: pts([[14, 14], [60, 55], [115, 95], [150, 140], [170, 178]]) },
  { id: 'home-studio', from: 'Home', to: 'Film Studio', halfWidth: 4.5, points: pts([[-2, 22], [-8, 90], [-20, 160], [-35, 200]]) },
  { id: 'home-canyon', from: 'Home', to: 'Stunt Park', halfWidth: 4.5, points: pts([[-20, -2], [-60, -10], [-100, -20], [-150, 10], [-198, 48]]) },
  { id: 'farm-airport', from: 'Farm', to: 'Airport', halfWidth: 4, points: pts([[-100, -20], [-112, -70], [-128, -110], [-148, -146]]) },
  { id: 'city-windfarm', from: 'City', to: 'Wind Farm', halfWidth: 4, points: [cityPoint(CITY_EDGE, 15), ...pts([[130, -186], [190, -162], [232, -150]])] },
  { id: 'village-stadium', from: 'Village', to: 'Stadium', halfWidth: 4, points: [...pts([[130, 82], [175, 35]]), [PLACES.stadium.x, PLACES.stadium.z + 34]] },
  { id: 'city-airport', from: 'City', to: 'Airport', halfWidth: 4, points: [cityPoint(-CITY_EDGE, -15), ...pts([[-80, -205], [-128, -174]])] },
  { id: 'studio-jungle', from: 'Film Studio', to: 'Jungle Temple', halfWidth: 4, points: pts([[-72, 236], [-104, 210], [-128, 172], [-136, 140]]) },
  { id: 'lake-spur', from: 'Home', to: 'Lake', halfWidth: 3.5, points: [at(3, -60), at(-12, -72), lakeShore] },
  // city grid
  ...CX.map((dx, i) => street(`st-x${i}`, cityPoint(dx, Math.abs(dx) > 30 ? -40 : -CITY_EDGE), cityPoint(dx, Math.abs(dx) > 30 ? 40 : CITY_EDGE))),
  ...CX.map((dz, i) => street(`st-z${i}`, cityPoint(Math.abs(dz) > 30 ? -40 : -CITY_EDGE, dz), cityPoint(Math.abs(dz) > 30 ? 40 : CITY_EDGE, dz))),
];
export const CITY_STREETS = CX;

// ---------- Rivers & lakes ----------
export const RIVER_HALF_WIDTH = 7.5;
export const RIVERS: [number, number][][] = [
  // from the lake, east under the city road and the track, out to sea in the north-east
  pts([[-45, -95], [-10, -112], [40, -118], [100, -126], [150, -168], [180, -205], [210, -250], [245, -310], [285, -390]]),
  // down from the canyon hills, through the jungle, out to sea in the south
  pts([[-225, 95], [-200, 135], [-175, 185], [-140, 215], [-115, 255], [-105, 300], [-100, 390]]),
];
export const LAKES: { x: number; z: number; r: number }[] = [{ x: PLACES.lake.x, z: PLACES.lake.z, r: PLACES.lake.radius }];

export const HOME_SPAWN = { x: 0, z: 8, yaw: Math.PI }; // facing north, toward the ABISHAI wall
