// Speaking/preparation times for Debate and Mattering. Each class can override them
// (teacher dashboard > Classes > "Debate & Mattering timers"); stored in
// classes.timer_settings as seconds, e.g. { debate: { prep: 900, speech: 435 }, mattering: {...} }.

export const TIMER_FIELDS = {
  debate: [
    { key: 'prep', label: 'Case building', hint: 'Preparation before the speech', default: 900, min: 60, max: 3600 },
    { key: 'speech', label: 'Speech', hint: 'Speaking time', default: 435, min: 60, max: 900 },
  ],
  mattering: [
    { key: 'breakdown', label: 'Breakdown', hint: 'Written notes', default: 300, min: 60, max: 1800 },
    { key: 'argument', label: 'Argument', hint: 'Spoken argument', default: 120, min: 30, max: 600 },
    { key: 'rebuttal_prep', label: 'Rebuttal prep', hint: 'Reading the other side', default: 60, min: 0, max: 300 },
    { key: 'rebuttal', label: 'Rebuttal', hint: 'Spoken rebuttal', default: 60, min: 30, max: 300 },
  ],
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Class settings (possibly missing or partial) -> complete, safe values in seconds. */
export function resolveTimers(raw) {
  const out = {};
  for (const [mode, fields] of Object.entries(TIMER_FIELDS)) {
    out[mode] = {};
    for (const f of fields) {
      const v = Number(raw?.[mode]?.[f.key]);
      out[mode][f.key] = Number.isFinite(v) ? clamp(Math.round(v), f.min, f.max) : f.default;
    }
  }
  return out;
}

export const DEFAULT_TIMERS = resolveTimers(null);

/** 435 -> "7:15", 120 -> "2 min", 90 -> "1:30" (for short descriptions). */
export function describeDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (s === 0) return `${m} min`;
  if (m === 0) return `${s} sec`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
