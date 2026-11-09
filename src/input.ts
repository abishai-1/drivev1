export type Control = 'forward' | 'back' | 'left' | 'right' | 'up' | 'down' | 'jump' | 'handbrake' | 'boost';
export type Keys = Record<Control, boolean>;

const keyMap: Record<string, Control> = {
  KeyW: 'forward',
  KeyS: 'back',
  KeyA: 'left',
  KeyD: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Space: 'jump',
  ControlLeft: 'handbrake',
  ControlRight: 'handbrake',
  ShiftLeft: 'boost',
  ShiftRight: 'boost',
};

const CONTROLS: readonly Control[] = ['forward', 'back', 'left', 'right', 'up', 'down', 'jump', 'handbrake', 'boost'];
const isControl = (k: string | undefined): k is Control => CONTROLS.includes(k as Control);

export interface InputActions {
  reset(): void;
  toggleMap(): void;
  toggleGarage(): void;
}

export function setupInput(actions: InputActions): Keys {
  const keys = Object.fromEntries(CONTROLS.map((c) => [c, false])) as Keys;

  window.addEventListener('keydown', (e) => {
    const k = keyMap[e.code];
    if (k) {
      keys[k] = true;
      e.preventDefault();
    }
    if (e.repeat) return;
    if (e.code === 'KeyR') actions.reset();
    if (e.code === 'KeyM') actions.toggleMap();
    if (e.code === 'KeyV') actions.toggleGarage();
  });
  window.addEventListener('keyup', (e) => {
    const k = keyMap[e.code];
    if (k) keys[k] = false;
  });
  // releasing keys when the tab loses focus avoids a stuck accelerator
  window.addEventListener('blur', () => CONTROLS.forEach((c) => (keys[c] = false)));

  document.querySelectorAll<HTMLButtonElement>('#touch button').forEach((btn) => {
    const k = btn.dataset.key;
    if (k === 'map') {
      btn.addEventListener('click', () => actions.toggleMap());
      return;
    }
    if (!isControl(k)) return;
    btn.addEventListener('pointerdown', () => (keys[k] = true));
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel'] as const) {
      btn.addEventListener(ev, () => (keys[k] = false));
    }
  });

  return keys;
}
