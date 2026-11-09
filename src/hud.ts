import { el } from './utils';
import type { LapState } from './track';

const fmt = (t: number | null) => {
  if (t === null) return '--:--.-';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
};

export function createHud() {
  const speed = el('hud-speed');
  const unit = el('hud-unit');
  const lap = el('hud-lap');
  const best = el('hud-best');
  const cp = el('hud-cp');
  const toast = el('toast');
  let toastTimer = 0;
  let lastPlace = '';

  return {
    update(kmh: number, lapState: LapState, flying: boolean, altitude: number) {
      speed.textContent = String(Math.round(kmh));
      unit.textContent = flying ? `km/h · ${Math.round(altitude)} m up` : 'km/h';
      lap.textContent = lapState.started ? fmt(lapState.lapTime) : 'Drive to the stadium';
      best.textContent = `Best ${fmt(lapState.best)}`;
      cp.textContent = lapState.started ? `Checkpoint ${lapState.next === 0 ? lapState.total : lapState.next}/${lapState.total}` : '';
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
