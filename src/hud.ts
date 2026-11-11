import { el } from './utils';
import type { LapState } from './track';

const fmt = (t: number | null) => {
  if (t === null) return '--:--.-';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
};

/** A timed run that isn't the lap race (the canyon stunt run). */
export interface RunState {
  active: boolean;
  name: string;
  time: number;
  best: number | null;
  next: number;
  total: number;
}

export function createHud() {
  const speed = el('hud-speed');
  const unit = el('hud-unit');
  const race = el('hud-race');
  const lap = el('hud-lap');
  const best = el('hud-best');
  const cp = el('hud-cp');
  const stops = el('hud-stops');
  const gems = el('hud-gems');
  const boostFx = el('boost-fx');
  const toast = el('toast');
  let toastTimer = 0;
  let lastPlace = '';

  return {
    update(kmh: number, lapState: LapState, flying: boolean, altitude: number, run?: RunState) {
      speed.textContent = String(Math.round(kmh));
      unit.textContent = flying ? `km/h · ${Math.round(altitude)} m up` : 'km/h';
      // the race rows only appear while a lap or a stunt run is on
      if (run?.active) {
        race.dataset.on = '';
        lap.textContent = `${run.name} ${fmt(run.time)}`;
        best.textContent = `Best ${fmt(run.best)}`;
        cp.textContent = `Gate ${run.next}/${run.total}`;
      } else if (lapState.started) {
        race.dataset.on = '';
        lap.textContent = `Lap ${fmt(lapState.lapTime)}`;
        best.textContent = `Best ${fmt(lapState.best)}`;
        cp.textContent = `Checkpoint ${lapState.next === 0 ? lapState.total : lapState.next}/${lapState.total}`;
      } else delete race.dataset.on;
    },
    progress(visited: number, totalStops: number, found: number, totalGems: number) {
      stops.textContent = `📍 ${visited}/${totalStops}`;
      gems.textContent = `💎 ${found}/${totalGems}`;
    },
    boost(on: boolean) {
      boostFx.classList.toggle('opacity-0', !on);
    },
    /** Big centered message (place names, lap times). */
    toast(text: string, ms = 2200) {
      toast.textContent = text;
      toast.classList.remove('opacity-0', '-translate-y-4');
      window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => toast.classList.add('opacity-0', '-translate-y-4'), ms);
    },
    place(name: string | null) {
      if (!name || name === lastPlace) return;
      lastPlace = name;
      this.toast(name);
    },
    fmt,
  };
}
