export type Control = 'forward' | 'back' | 'left' | 'right' | 'brake' | 'boost';
export type Keys = Record<Control, boolean>;

const keyMap: Record<string, Control> = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'brake',
  ShiftLeft: 'boost',
  ShiftRight: 'boost',
};

const isControl = (k: string | undefined): k is Control =>
  k === 'forward' || k === 'back' || k === 'left' || k === 'right' || k === 'brake' || k === 'boost';

export function setupInput(onReset: () => void): Keys {
  const keys: Keys = { forward: false, back: false, left: false, right: false, brake: false, boost: false };

  window.addEventListener('keydown', (e) => {
    const k = keyMap[e.code];
    if (k) {
      keys[k] = true;
      e.preventDefault();
    }
    if (e.code === 'KeyR') onReset();
  });
  window.addEventListener('keyup', (e) => {
    const k = keyMap[e.code];
    if (k) keys[k] = false;
  });

  document.querySelectorAll<HTMLButtonElement>('#touch button').forEach((btn) => {
    const k = btn.dataset.key;
    if (!isControl(k)) return;
    btn.addEventListener('pointerdown', () => (keys[k] = true));
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel'] as const) {
      btn.addEventListener(ev, () => (keys[k] = false));
    }
  });

  return keys;
}
