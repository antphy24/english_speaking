import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

// Short messages that slide in at the bottom and go away by themselves.
// Replaces browser alert() popups.
//   const toast = useToast();
//   toast.success('Saved to your record');
//   toast.error('Saving failed. Sign out, sign in again and press Save.', { duration: 0 });  // 0 = stays until closed

const ToastContext = createContext(null);

const TONES = {
  success: { Icon: CheckCircle2, icon: 'text-success' },
  error: { Icon: AlertCircle, icon: 'text-danger' },
  info: { Icon: Info, icon: 'text-brand-ink' },
};

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}

function ToastItem({ toast, onClose }) {
  const { Icon, icon } = TONES[toast.tone] || TONES.info;
  useEffect(() => {
    if (!toast.duration) return undefined;
    const t = setTimeout(() => onClose(toast.id), toast.duration);
    return () => clearTimeout(t);
  }, [toast, onClose]);

  return (
    <div
      role={toast.tone === 'error' ? 'alert' : 'status'}
      className="pointer-events-auto w-full sm:w-[380px] flex items-start gap-3 bg-surface text-ink border border-line rounded-xl shadow-pop px-4 py-3 animate-toast-in"
    >
      <Icon className={`w-5 h-5 mt-px shrink-0 ${icon}`} aria-hidden="true" />
      <p className="flex-1 text-sm leading-relaxed">{toast.message}</p>
      <button
        type="button"
        onClick={() => onClose(toast.id)}
        aria-label="Close message"
        className="-m-1.5 p-1.5 rounded-lg text-ink-subtle hover:text-ink hover:bg-surface-muted"
      >
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);

  const close = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const show = useCallback((tone, message, { duration = tone === 'error' ? 8000 : 4000 } = {}) => {
    const id = nextId.current++;
    setToasts((list) => [...list.slice(-2), { id, tone, message, duration }]); // at most 3 on screen
    return id;
  }, []);

  const api = React.useMemo(
    () => ({
      success: (msg, opts) => show('success', msg, opts),
      error: (msg, opts) => show('error', msg, opts),
      info: (msg, opts) => show('info', msg, opts),
      close,
    }),
    [show, close]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="fixed z-[60] inset-x-0 bottom-0 sm:inset-x-auto sm:right-6 sm:bottom-6 flex flex-col items-center sm:items-end gap-2 p-4 sm:p-0 pb-safe pointer-events-none"
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onClose={close} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export default ToastProvider;
