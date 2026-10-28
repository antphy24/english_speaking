import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { AlertTriangle, Info, Trash2, LogOut, X } from 'lucide-react';
import { Button } from './Button';

// --- Context ---
const ConfirmContext = createContext(null);

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within a ConfirmProvider');
  return ctx;
}

// --- Provider ---
export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null); // { title, message, confirmLabel, cancelLabel, variant, resolve }

  const confirm = useCallback(({
    title = 'Are you sure?',
    message = '',
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    variant = 'danger', // 'danger' | 'warning' | 'info'
  } = {}) => {
    return new Promise((resolve) => {
      setState({ title, message, confirmLabel, cancelLabel, variant, resolve });
    });
  }, []);

  const handleClose = useCallback((result) => {
    if (state?.resolve) state.resolve(result);
    setState(null);
  }, [state]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <ConfirmModal
          {...state}
          onConfirm={() => handleClose(true)}
          onCancel={() => handleClose(false)}
        />
      )}
    </ConfirmContext.Provider>
  );
}

// --- Variant configs ---
const VARIANTS = {
  danger: { icon: Trash2, iconBox: 'bg-danger-tint text-danger', confirm: 'danger' },
  warning: { icon: AlertTriangle, iconBox: 'bg-warning-tint text-warning', confirm: 'primary' },
  info: { icon: Info, iconBox: 'bg-brand-tint text-brand-ink', confirm: 'primary' },
  logout: { icon: LogOut, iconBox: 'bg-surface-muted text-ink-muted', confirm: 'primary' },
};

// --- Modal Component ---
function ConfirmModal({ title, message, confirmLabel, cancelLabel, variant, onConfirm, onCancel }) {
  const v = VARIANTS[variant] || VARIANTS.danger;
  const Icon = v.icon;

  // Close on Escape key
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 confirm-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
      <div className="absolute inset-0 bg-[rgb(16_24_40/0.5)] pointer-events-none" />

      <div className="relative w-full max-w-sm confirm-card bg-surface text-ink border border-line rounded-2xl shadow-pop p-6">
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close"
          className="absolute top-3 right-3 w-9 h-9 flex items-center justify-center rounded-lg text-ink-subtle hover:text-ink hover:bg-surface-muted"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>

        <div className={`w-11 h-11 rounded-full flex items-center justify-center ${v.iconBox}`}>
          <Icon className="w-5 h-5" aria-hidden="true" />
        </div>

        <h3 id="confirm-title" className="mt-4 text-lg font-bold">{title}</h3>
        {message && <p className="mt-1.5 text-sm text-ink-muted leading-relaxed">{message}</p>}

        <div className="mt-6 grid grid-cols-2 gap-3">
          <Button variant="secondary" onClick={onCancel}>{cancelLabel}</Button>
          <Button variant={v.confirm} onClick={onConfirm} autoFocus>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmModal;
