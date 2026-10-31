// Pure state machine behind Simulate / Pause / Resume / Prev / Next / Reset and the speed control.
// step -1 = off. 0..total-1 = the edge in focus. The web hook drives `tick` on a timer.
export const SPEEDS = [
  { id: 'slow', label: 'Slow', ms: 2400 },
  { id: 'normal', label: 'Normal', ms: 1200 },
  { id: 'fast', label: 'Fast', ms: 500 },
];
export const DEFAULT_SPEED = 'normal';
export const speedMs = (id) => (SPEEDS.find((s) => s.id === id) || SPEEDS[1]).ms;

export const initial = (total) => ({ total, step: -1, paused: false, speed: DEFAULT_SPEED });

export function reduce(s, action) {
  const last = s.total - 1;
  switch (action.type) {
    case 'simulate': { const total = action.total ?? s.total; return total < 1 ? s : { ...s, total, step: 0, paused: false }; }
    case 'tick':
      if (s.step < 0 || s.paused) return s;
      return s.step >= last ? { ...s, paused: true } : { ...s, step: s.step + 1 };
    case 'pause': return s.step < 0 ? s : { ...s, paused: true };
    case 'resume': return s.step < 0 ? s : { ...s, step: s.step >= last ? 0 : s.step, paused: false };
    case 'next': return s.step < 0 ? s : { ...s, step: Math.min(s.step + 1, last) };
    case 'prev': return s.step < 0 ? s : { ...s, step: Math.max(s.step - 1, 0) };
    case 'goto': return s.total < 1 ? s : { ...s, step: Math.max(0, Math.min(action.step, last)), paused: true };
    case 'speed': return SPEEDS.some((x) => x.id === action.speed) ? { ...s, speed: action.speed } : s;
    case 'stop': return { ...s, step: -1, paused: false };
    case 'total': return { ...initial(action.total), speed: s.speed };
    default: return s;
  }
}
