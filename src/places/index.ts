import type { Ctx } from '../utils';
import { buildCountryside } from '../world';
import { buildRoads } from '../roads';
import { buildAirport } from './airport';
import { buildBeach } from './beach';
import { buildCanyon } from './canyon';
import { buildCity } from './city';
import { buildFarm } from './farm';
import { buildHome } from './home';
import { buildJungle } from './jungle';
import { buildStadium } from './stadium';
import { buildStudio } from './studio';
import { buildVillage } from './village';
import { buildLake, buildWindFarm } from './windfarm';

export function buildPlaces(ctx: Ctx) {
  buildRoads(ctx);
  buildHome(ctx);
  buildCity(ctx);
  buildStadium(ctx);
  buildBeach(ctx);
  buildStudio(ctx);
  buildJungle(ctx);
  buildCanyon(ctx);
  buildAirport(ctx);
  buildVillage(ctx);
  buildFarm(ctx);
  buildWindFarm(ctx);
  buildLake(ctx);
  buildCountryside(ctx);
}
