import React, { useEffect, useState } from 'react';
import { Clock, RotateCcw, Save, ChevronDown } from 'lucide-react';
import { TIMER_FIELDS, resolveTimers, describeDuration } from '../../utils/timerSettings';
import { MODE_LABELS } from '../../utils/modes';

const MODE_TITLES = { debate: MODE_LABELS.debate, mattering: MODE_LABELS.mattering };

const split = (seconds) => ({ m: String(Math.floor(seconds / 60)), s: String(seconds % 60).padStart(2, '0') });

/** Per-class timers for Debate and Mattering, shown in the Classes tab. */
export function TimerSettings({ selectedClass, handleUpdateClass }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);

  const saved = resolveTimers(selectedClass?.timer_settings);

  // Load the class's current times whenever another class is picked (or after saving)
  useEffect(() => {
    const next = {};
    for (const [mode, fields] of Object.entries(TIMER_FIELDS)) {
      for (const f of fields) next[`${mode}.${f.key}`] = split(saved[mode][f.key]);
    }
    setValues(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClass?.id, JSON.stringify(selectedClass?.timer_settings || null)]);

  const toSeconds = (mode, f) => {
    const v = values[`${mode}.${f.key}`];
    if (!v) return saved[mode][f.key];
    const total = (parseInt(v.m, 10) || 0) * 60 + (parseInt(v.s, 10) || 0);
    return Math.min(f.max, Math.max(f.min, total));
  };

  const setPart = (id, part, raw) => {
    const digits = raw.replace(/\D/g, '').slice(0, part === 'm' ? 2 : 2);
    setValues((prev) => ({ ...prev, [id]: { ...prev[id], [part]: digits } }));
  };

  const build = () => {
    const out = {};
    for (const [mode, fields] of Object.entries(TIMER_FIELDS)) {
      out[mode] = {};
      for (const f of fields) out[mode][f.key] = toSeconds(mode, f);
    }
    return out;
  };

  const save = async (settings) => {
    setSaving(true);
    try {
      await handleUpdateClass(selectedClass.id, { timer_settings: settings });
    } finally {
      setSaving(false);
    }
  };

  const isDefault = !selectedClass?.timer_settings;
  const summary = `Debate ${describeDuration(saved.debate.prep)} prep · ${describeDuration(saved.debate.speech)} speech — Mattering ${describeDuration(saved.mattering.breakdown)} / ${describeDuration(saved.mattering.argument)} / ${describeDuration(saved.mattering.rebuttal)}`;

  return (
    <div className="border border-line rounded-xl bg-surface-muted">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left cursor-pointer"
        aria-expanded={open}
      >
        <div className="flex items-start gap-3 min-w-0">
          <Clock className="w-4 h-4 text-brand-ink mt-0.5 shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-bold text-ink">
              Debate &amp; Mattering timers
              <span className={`ml-2 text-xs font-semibold px-1.5 py-0.5 rounded ${isDefault ? 'bg-surface-muted text-ink-muted' : 'bg-brand-tint text-brand-ink'}`}>
                {isDefault ? 'Default' : 'Custom'}
              </span>
            </div>
            <div className="text-xs text-ink-subtle truncate">{summary}</div>
          </div>
        </div>
        <ChevronDown className={`w-4 h-4 text-ink-muted shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-line pt-4">
          <p className="text-xs text-ink-muted leading-relaxed">
            Applies to every student in <strong className="text-ink">{selectedClass.class_name}</strong>. Students get the new times the next time they open the Debate or Mattering tab.
          </p>

          {Object.entries(TIMER_FIELDS).map(([mode, fields]) => (
            <div key={mode} className="space-y-2">
              <div className="text-xs font-bold text-ink-muted ">{MODE_TITLES[mode]}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {fields.map((f) => {
                  const id = `${mode}.${f.key}`;
                  const v = values[id] || split(f.default);
                  const secs = toSeconds(mode, f);
                  const raw = (parseInt(v.m, 10) || 0) * 60 + (parseInt(v.s, 10) || 0);
                  const adjusted = raw !== secs;
                  return (
                    <div key={id} className="bg-surface border border-line rounded-lg p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-ink">{f.label}</div>
                          <div className="text-xs text-ink-subtle">{f.hint}</div>
                        </div>
                        <div className="flex items-center gap-1 tabular-nums shrink-0">
                          <input
                            inputMode="numeric"
                            aria-label={`${MODE_TITLES[mode]} ${f.label} minutes`}
                            value={v.m}
                            onChange={(e) => setPart(id, 'm', e.target.value)}
                            className="w-11 px-1.5 py-1.5 bg-surface border border-line-strong rounded-md text-ink text-sm text-center focus:border-brand outline-none"
                          />
                          <span className="text-ink-subtle">:</span>
                          <input
                            inputMode="numeric"
                            aria-label={`${MODE_TITLES[mode]} ${f.label} seconds`}
                            value={v.s}
                            onChange={(e) => setPart(id, 's', e.target.value)}
                            onBlur={() => setValues((prev) => ({ ...prev, [id]: split(toSeconds(mode, f)) }))}
                            className="w-11 px-1.5 py-1.5 bg-surface border border-line-strong rounded-md text-ink text-sm text-center focus:border-brand outline-none"
                          />
                        </div>
                      </div>
                      <div className={`text-xs mt-1.5 ${adjusted ? 'text-warning' : 'text-ink-subtle'}`}>
                        {adjusted
                          ? `Will be saved as ${describeDuration(secs)} (allowed ${describeDuration(f.min)}–${describeDuration(f.max)})`
                          : `Default ${describeDuration(f.default)}`}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            {!isDefault && (
              <button
                type="button"
                disabled={saving}
                onClick={() => save(null)}
                className="flex items-center gap-1.5 px-3 py-2 bg-surface-muted hover:bg-line text-ink-muted rounded-lg text-xs font-semibold transition disabled:opacity-50 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Back to defaults</span>
              </button>
            )}
            <button
              type="button"
              disabled={saving}
              onClick={() => save(build())}
              className="flex items-center gap-1.5 px-4 py-2 bg-brand hover:bg-brand-hover text-white rounded-lg text-xs font-bold transition disabled:opacity-50 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? 'Saving…' : 'Save timers'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
export default TimerSettings;
