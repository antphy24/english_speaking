import React, { useEffect, useRef, useState } from 'react';
import { Save, Plus, Trash2, Image as ImageIcon, Upload, AlertTriangle } from 'lucide-react';
import { researchRequest } from '../../utils/researchApi';
import { supabaseTeacher } from '../../utils/supabaseClient';

const input = 'w-full min-h-[40px] bg-surface border border-line-strong rounded-[10px] px-3 py-2 text-sm text-ink placeholder:text-ink-subtle outline-none focus:border-brand focus:ring-4 focus:ring-brand-ring';

function nextId(prefix, existing) {
  let n = existing.length + 1;
  while (existing.includes(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
}

/** Edit one test: consent text, questions, timings and pictures. */
export default function TestEditor({ test, hasAttempts, onSaved, setError, setSuccess }) {
  const [title, setTitle] = useState(test.title);
  const [content, setContent] = useState(test.content);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(null);
  const [dirty, setDirty] = useState(false);
  const fileRefs = useRef({});

  useEffect(() => {
    setTitle(test.title);
    setContent(test.content);
    setDirty(false);
  }, [test.id, test.content, test.title]);

  const update = (fn) => {
    setContent((c) => {
      const copy = JSON.parse(JSON.stringify(c));
      fn(copy);
      return copy;
    });
    setDirty(true);
  };

  const allItemIds = content.parts.flatMap((p) => p.items.map((i) => i.id));
  const totalSeconds = content.parts.reduce((s, p) => s + p.items.reduce((t, i) => t + Number(i.speak_seconds || 0) + Number(i.prep_seconds || 0), 0), 0);

  const save = async () => {
    setSaving(true);
    try {
      const strip = JSON.parse(JSON.stringify(content));
      strip.parts.forEach((p) => { delete p.image_url; });
      await researchRequest(supabaseTeacher, `/tests/${test.id}`, { method: 'PUT', body: { title, content: strip } });
      setDirty(false);
      setSuccess?.('Test saved.');
      onSaved?.();
    } catch (e) {
      setError?.(e.message);
    } finally {
      setSaving(false);
    }
  };

  const uploadImage = async (partId, file, remove = false) => {
    if (dirty) {
      setError?.('Save your changes first, then change the picture.');
      return;
    }
    setUploading(partId);
    try {
      const form = new FormData();
      form.append('part_id', partId);
      if (remove) form.append('remove', 'true');
      if (file) form.append('file', file);
      await researchRequest(supabaseTeacher, `/tests/${test.id}/image`, { method: 'POST', body: form, retries: 1 });
      setSuccess?.(remove ? 'Picture removed.' : 'Picture uploaded.');
      onSaved?.();
    } catch (e) {
      setError?.(e.message);
    } finally {
      setUploading(null);
    }
  };

  return (
    <div className="space-y-4">
      {hasAttempts && (
        <div className="p-3 rounded-xl bg-warning-tint border border-warning/30 text-xs text-warning flex gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Students have already taken this test. Changing questions now means they did not all take the same test.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="md:col-span-2 text-xs text-ink-muted space-y-1">
          <span>Test title (students see this)</span>
          <input className={input} value={title} onChange={(e) => { setTitle(e.target.value); setDirty(true); }} />
        </label>
        <label className="text-xs text-ink-muted space-y-1">
          <span>Times a student may hear a question again</span>
          <select className={input} value={content.max_repeats ?? 1}
                  onChange={(e) => update((c) => { c.max_repeats = Number(e.target.value); })}>
            {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>

      <label className="block text-xs text-ink-muted space-y-1">
        <span>Consent text (shown before the test; the student must agree to start)</span>
        <textarea className={`${input} min-h-[160px]`} value={content.consent_text}
                  onChange={(e) => update((c) => { c.consent_text = e.target.value; })} />
      </label>
      <label className="block text-xs text-ink-muted space-y-1">
        <span>Instructions read to the student before Part 1</span>
        <textarea className={input} rows={2} value={content.intro}
                  onChange={(e) => update((c) => { c.intro = e.target.value; })} />
      </label>

      {content.parts.map((part, pIdx) => (
        <div key={part.id} className="bg-surface border border-line rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <input className={`${input} font-bold`} value={part.title}
                   onChange={(e) => update((c) => { c.parts[pIdx].title = e.target.value; })} />
            {content.parts.length > 1 && (
              <button title="Remove part" onClick={() => update((c) => { c.parts.splice(pIdx, 1); })}
                      className="p-2 rounded-xl bg-surface border border-line text-ink-subtle hover:text-danger">
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
          <input className={input} placeholder="Instructions for this part" value={part.instructions || ''}
                 onChange={(e) => update((c) => { c.parts[pIdx].instructions = e.target.value; })} />

          <div className="flex flex-col sm:flex-row gap-3 items-start">
            {part.image_url ? (
              <img src={part.image_url} alt="" className="w-full sm:w-48 h-32 object-cover rounded-xl border border-line" />
            ) : (
              <div className="w-full sm:w-48 h-32 rounded-xl border border-dashed border-line flex flex-col items-center justify-center text-xs text-ink-subtle text-center px-2">
                <ImageIcon className="w-5 h-5 mb-1" /> No picture
              </div>
            )}
            <div className="flex-1 space-y-2 w-full">
              <input className={input} placeholder="Note about the picture (only for you)" value={part.image_note || ''}
                     onChange={(e) => update((c) => { c.parts[pIdx].image_note = e.target.value; })} />
              <div className="flex gap-2">
                <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                       ref={(el) => { fileRefs.current[part.id] = el; }}
                       onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadImage(part.id, f); }} />
                <button onClick={() => fileRefs.current[part.id]?.click()} disabled={uploading === part.id}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface border border-line text-xs text-ink-muted hover:border-brand">
                  <Upload className="w-3.5 h-3.5" /> {uploading === part.id ? 'Uploading...' : (part.image_path ? 'Replace picture' : 'Add picture')}
                </button>
                {part.image_path && (
                  <button onClick={() => uploadImage(part.id, null, true)} disabled={uploading === part.id}
                          className="px-3 py-2 rounded-xl bg-surface border border-line text-xs text-ink-muted hover:text-danger">
                    Remove
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            {part.items.map((item, iIdx) => (
              <div key={item.id} className="bg-surface border border-line rounded-xl p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <span className="text-xs tabular-nums text-ink-subtle mt-2.5 w-10 shrink-0">{item.id}</span>
                  <textarea className={input} rows={2} value={item.prompt}
                            onChange={(e) => update((c) => { c.parts[pIdx].items[iIdx].prompt = e.target.value; })} />
                  {part.items.length > 1 && (
                    <button title="Remove question" onClick={() => update((c) => { c.parts[pIdx].items.splice(iIdx, 1); })}
                            className="p-2 text-ink-subtle hover:text-danger"><Trash2 className="w-4 h-4" /></button>
                  )}
                </div>
                <div className="flex flex-wrap gap-3 pl-12 text-xs text-ink-muted">
                  <label className="flex items-center gap-1.5">Thinking time
                    <input type="number" min={0} max={120} className="w-16 bg-surface border border-line-strong rounded-lg px-2 py-1 text-ink"
                           value={item.prep_seconds || 0}
                           onChange={(e) => update((c) => { c.parts[pIdx].items[iIdx].prep_seconds = Number(e.target.value); })} />s
                  </label>
                  <label className="flex items-center gap-1.5">Answer time
                    <input type="number" min={10} max={300} className="w-16 bg-surface border border-line-strong rounded-lg px-2 py-1 text-ink"
                           value={item.speak_seconds}
                           onChange={(e) => update((c) => { c.parts[pIdx].items[iIdx].speak_seconds = Number(e.target.value); })} />s
                  </label>
                </div>
              </div>
            ))}
            <button onClick={() => update((c) => { c.parts[pIdx].items.push({ id: nextId(`${part.id}q`, allItemIds), prompt: '', speak_seconds: 30, prep_seconds: 0 }); })}
                    className="flex items-center gap-1.5 text-xs text-brand-ink hover:text-brand-ink">
              <Plus className="w-3.5 h-3.5" /> Add question
            </button>
          </div>
        </div>
      ))}

      <button onClick={() => update((c) => { const id = nextId('p', c.parts.map((p) => p.id)); c.parts.push({ id, title: `Part ${c.parts.length + 1}`, instructions: '', image_path: null, image_note: '', items: [{ id: `${id}q1`, prompt: '', speak_seconds: 30, prep_seconds: 0 }] }); })}
              className="flex items-center gap-1.5 text-xs text-brand-ink hover:text-brand-ink">
        <Plus className="w-3.5 h-3.5" /> Add part
      </button>

      <div className="sticky bottom-0 -mx-1 px-1 py-3 bg-surface flex items-center justify-between gap-3 border-t border-line">
        <span className="text-xs text-ink-muted">
          {allItemIds.length} questions · max {Math.round(totalSeconds / 6) / 10} min of thinking + speaking
        </span>
        <button onClick={save} disabled={saving || !dirty}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand hover:bg-brand-hover disabled:opacity-40 text-white text-xs font-bold">
          <Save className="w-4 h-4" /> {saving ? 'Saving...' : dirty ? 'Save test' : 'Saved'}
        </button>
      </div>
    </div>
  );
}
