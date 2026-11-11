import { VEHICLES } from './vehicles/presets';
import type { VehicleId } from './vehicles/types';
import { el } from './utils';

const bar = (label: string, n: number) => `
  <div class="flex items-center gap-2 text-xs">
    <span class="w-10 text-left opacity-70">${label}</span>
    <span class="flex gap-0.5">${Array.from({ length: 5 }, (_, i) => `<i class="block h-1.5 w-3 rounded-full ${i < n ? 'bg-coral' : 'bg-ink/15'}"></i>`).join('')}</span>
  </div>`;

/** Vehicle cards inside the intro/garage overlay. */
export function createSelector(initial: VehicleId, onChange: (id: VehicleId) => void) {
  const grid = el('vehicle-grid');
  let selected = initial;

  grid.innerHTML = VEHICLES.map(
    (v) => `
    <button type="button" data-id="${v.id}"
      class="vehicle-card grid cursor-pointer gap-1.5 rounded-2xl border-2 border-transparent bg-cream/80 p-3 text-left transition hover:-translate-y-0.5 hover:bg-cream aria-pressed:border-coral aria-pressed:bg-cream">
      <span class="text-3xl leading-none">${v.icon}</span>
      <span class="font-bold">${v.name}</span>
      <span class="text-xs leading-snug opacity-70">${v.blurb}</span>
      ${bar('Speed', v.stats.speed)}${bar(v.kind === 'air' ? 'Agility' : 'Grip', v.stats.grip)}${bar(v.kind === 'air' ? 'Air' : 'Jump', v.stats.jump)}
    </button>`
  ).join('');

  const render = () =>
    grid.querySelectorAll<HTMLButtonElement>('.vehicle-card').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === selected)));
  grid.addEventListener('click', (e) => {
    const card = (e.target as HTMLElement).closest<HTMLButtonElement>('.vehicle-card');
    const id = card?.dataset.id as VehicleId | undefined;
    if (!id) return;
    selected = id;
    render();
    onChange(id);
  });
  render();

  return {
    get selected() {
      return selected;
    },
    set(id: VehicleId) {
      selected = id;
      render();
    },
  };
}
