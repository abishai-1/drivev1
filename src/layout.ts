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

export const WORLD_HALF = 400; // terrain covers -400..400 on x and z
export const GRID_STEP = 2; // terrain / heightfield resolution (m)
export const ISLAND_R = 330; // rough coastline radius (noise pushes it ±30)
export const WATER_Y = 0;

export const PLACES: Record<PlaceId, Place> = {
  home: { id: 'home', name: 'Home', x: 0, z: 0, radius: 24, flat: 2 },
  city: { id: 'city', name: 'City', x: 26, z: -195, radius: 66, flat: 2 },
  stadium: { id: 'stadium', name: 'Stadium', x: 215, z: -26, radius: 50, flat: 2 },
  beach: { id: 'beach', name: 'Lighthouse Beach', x: 182, z: 195, radius: 36, flat: 1.1 },
  studio: { id: 'studio', name: 'Film Studio', x: -39, z: 231, radius: 40, flat: 2 },
  jungle: { id: 'jungle', name: 'Jungle', x: -156, z: 150, radius: 90 },
  canyon: { id: 'canyon', name: 'Canyon', x: -247, z: 13, radius: 75 },
  airport: { id: 'airport', name: 'Airport', x: -169, z: -169, radius: 100, flat: 2 },
  village: { id: 'village', name: 'Village', x: 115, z: 95, radius: 36, flat: 2 },
  farm: { id: 'farm', name: 'Farm', x: -100, z: -20, radius: 44, flat: 2 },
  windfarm: { id: 'windfarm', name: 'Wind Farm', x: 240, z: -150, radius: 50 },
  lake: { id: 'lake', name: 'Lake', x: -45, z: -95, radius: 20 },
};

/** Flat stunt area inside the canyon. */
export const STUNT_PAD: Place = { id: 'stunt', name: 'Stunt Park', x: -218, z: 58, radius: 28, flat: 2 };

/** Crop fields at the farm: [centerX, centerZ, halfWidth, halfDepth]. */
export const FARM_FIELDS: [number, number, number, number][] = [
  [-118, -45, 14, 9],
  [-82, -48, 12, 8],
  [-124, 4, 10, 12],
];

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
export const TRACK_POINTS: [number, number][] = [
  [215, 26], [215, -78], [169, -150], [97, -195], [26, -195], [-45, -195], [-78, -153], [-130, -98],
  [-195, -46], [-266, 6], [-260, 78], [-221, 140], [-156, 162], [-124, 214], [-72, 198], [26, 254],
  [104, 250], [169, 234], [247, 143], [254, 72],
];

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

export const ROADS: RoadDef[] = [
  { id: 'home-city', from: 'Home', to: 'City', halfWidth: 4.5, points: [[0, -18], [3, -60], [8, -100], [11, -142]] },
  { id: 'home-stadium', from: 'Home', to: 'Stadium', halfWidth: 4.5, points: [[18, 2], [80, -5], [140, -18], [188, -26]] },
  { id: 'home-beach', from: 'Home', to: 'Lighthouse Beach', halfWidth: 4.5, points: [[14, 14], [60, 55], [115, 95], [150, 140], [170, 178]] },
  { id: 'home-studio', from: 'Home', to: 'Film Studio', halfWidth: 4.5, points: [[-2, 22], [-8, 90], [-20, 160], [-35, 200]] },
  { id: 'home-canyon', from: 'Home', to: 'Stunt Park', halfWidth: 4.5, points: [[-20, -2], [-60, -10], [-100, -20], [-150, 10], [-195, 45]] },
  { id: 'farm-airport', from: 'Farm', to: 'Airport', halfWidth: 4, points: [[-100, -20], [-112, -70], [-128, -110], [-145, -140]] },
  { id: 'city-windfarm', from: 'City', to: 'Wind Farm', halfWidth: 4, points: [[81, -180], [130, -186], [190, -162], [232, -150]] },
  { id: 'village-stadium', from: 'Village', to: 'Stadium', halfWidth: 4, points: [[130, 82], [175, 35], [205, 8]] },
  // city grid
  street('st-x1', [C.x - 15, C.z - 56], [C.x - 15, C.z + 56]),
  street('st-x2', [C.x + 15, C.z - 56], [C.x + 15, C.z + 56]),
  street('st-x3', [C.x - 45, C.z - 40], [C.x - 45, C.z + 40]),
  street('st-x4', [C.x + 45, C.z - 40], [C.x + 45, C.z + 40]),
  street('st-z1', [C.x - 56, C.z - 15], [C.x + 56, C.z - 15]),
  street('st-z2', [C.x - 56, C.z + 15], [C.x + 56, C.z + 15]),
  street('st-z3', [C.x - 40, C.z - 45], [C.x + 40, C.z - 45]),
  street('st-z4', [C.x - 40, C.z + 45], [C.x + 40, C.z + 45]),
];

// ---------- Rivers & lakes ----------
export const RIVER_HALF_WIDTH = 7;
export const RIVERS: [number, number][][] = [
  // from the lake, east under the city road and the track, out to sea in the north-east
  [[-45, -95], [-10, -112], [40, -118], [100, -126], [150, -168], [180, -205], [210, -250], [245, -310], [270, -370]],
  // down from the canyon hills, through the jungle, out to sea in the south
  [[-225, 95], [-200, 135], [-175, 185], [-140, 215], [-115, 255], [-105, 300], [-100, 370]],
];
export const LAKES: { x: number; z: number; r: number }[] = [{ x: PLACES.lake.x, z: PLACES.lake.z, r: PLACES.lake.radius }];

export const HOME_SPAWN = { x: 0, z: 6, yaw: Math.PI }; // facing north
