// Speaking/preparation times, in seconds.
//  * Q&A and Mattering: set per MATERIAL by the teacher (Materials tab), stored in
//    custom_materials.timer_settings, e.g. { think: 15, answer: 60 } for a Q&A set.
//    Built-in materials and materials without times use the defaults below.
//  * Debate: set per CLASS (Classes > "Debate timers"), stored in classes.timer_settings
//    as { debate: { prep: 900, speech: 435 } }.

export const TIMER_FIELDS = {
  qa: [
    { key: 'think', label: 'Thinking time', hint: 'Before each answer starts recording', default: 15, min: 5, max: 120 },
    { key: 'answer', label: 'Answer time', hint: 'Longest answer per question', default: 60, min: 15, max: 300 },
  ],
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

// Modes whose times belong to each material / to the whole class.
export const MATERIAL_TIMER_MODES = ['qa', 'mattering'];
export const CLASS_TIMER_MODES = ['debate'];

/** One mode's times (possibly missing or partial) -> complete, safe values in seconds. */
export function resolveModeTimers(mode, raw) {
  const out = {};
  for (const f of TIMER_FIELDS[mode] || []) {
    const v = Number(raw?.[f.key]);
    out[f.key] = Number.isFinite(v) ? clamp(Math.round(v), f.min, f.max) : f.default;
  }
  return out;
}

/** Times that equal the defaults are stored as null, so the material simply follows the defaults. */
export function compactModeTimers(mode, values) {
  const resolved = resolveModeTimers(mode, values);
  const isDefault = (TIMER_FIELDS[mode] || []).every((f) => resolved[f.key] === f.default);
  return isDefault ? null : resolved;
}

/** Short text for lists, e.g. "15 sec think · 1 min answer". */
export function summarizeModeTimers(mode, raw) {
  const t = resolveModeTimers(mode, raw);
  if (mode === 'qa') return `${describeDuration(t.think)} think · ${describeDuration(t.answer)} per answer`;
  if (mode === 'mattering') {
    return `${describeDuration(t.breakdown)} breakdown · ${describeDuration(t.argument)} argument · ${describeDuration(t.rebuttal)} rebuttal`;
  }
  return '';
}
