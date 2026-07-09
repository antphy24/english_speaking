import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { AlertTriangle, Info, Trash2, LogOut, X } from 'lucide-react';

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
  danger: {
    icon: Trash2,
    iconBg: 'bg-rose-500/10',
    iconBorder: 'border-rose-500/20',
    iconColor: 'text-rose-400',
    confirmBg: 'bg-rose-600 hover:bg-rose-500',
    confirmShadow: 'shadow-rose-600/20',
    accentGlow: 'bg-rose-600/8',
  },
  warning: {
    icon: AlertTriangle,
    iconBg: 'bg-amber-500/10',
    iconBorder: 'border-amber-500/20',
    iconColor: 'text-amber-400',
    confirmBg: 'bg-amber-600 hover:bg-amber-500',
    confirmShadow: 'shadow-amber-600/20',
    accentGlow: 'bg-amber-600/8',
  },
  info: {
    icon: Info,
    iconBg: 'bg-indigo-500/10',
    iconBorder: 'border-indigo-500/20',
    iconColor: 'text-indigo-400',
    confirmBg: 'bg-indigo-600 hover:bg-indigo-500',
    confirmShadow: 'shadow-indigo-600/20',
    accentGlow: 'bg-indigo-600/8',
  },
  logout: {
    icon: LogOut,
    iconBg: 'bg-purple-500/10',
    iconBorder: 'border-purple-500/20',
    iconColor: 'text-purple-400',
    confirmBg: 'bg-purple-600 hover:bg-purple-500',
    confirmShadow: 'shadow-purple-600/20',
    accentGlow: 'bg-purple-600/8',
  },
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
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal card */}
      <div className="relative w-full max-w-md confirm-card">
        {/* Background glow */}
        <div className={`absolute -top-16 left-1/2 -translate-x-1/2 w-64 h-64 ${v.accentGlow} rounded-full blur-[80px] pointer-events-none`} />

        <div className="relative glass-panel rounded-2xl border border-slate-800/80 shadow-2xl overflow-hidden">
          {/* Close button */}
          <button
            onClick={onCancel}
            className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800/60 transition z-10 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="p-6 pt-8 space-y-5">
            {/* Icon */}
            <div className="flex justify-center">
              <div className={`w-14 h-14 ${v.iconBg} border ${v.iconBorder} rounded-2xl flex items-center justify-center ${v.iconColor}`}>
                <Icon className="w-7 h-7" />
              </div>
            </div>

            {/* Text */}
            <div className="text-center space-y-2">
              <h3 className="text-lg font-bold text-white tracking-tight">{title}</h3>
              {message && (
                <p className="text-sm text-slate-400 leading-relaxed px-2">{message}</p>
              )}
            </div>

            {/* Actions */}
            <div className="flex space-x-3 pt-1">
              <button
                onClick={onCancel}
                className="flex-1 py-2.5 bg-slate-900/80 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white rounded-xl text-sm font-bold transition-all active:scale-[0.98] cursor-pointer"
              >
                {cancelLabel}
              </button>
              <button
                onClick={onConfirm}
                autoFocus
                className={`flex-1 py-2.5 ${v.confirmBg} text-white rounded-xl text-sm font-bold shadow-lg ${v.confirmShadow} transition-all active:scale-[0.98] cursor-pointer`}
              >
                {confirmLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ConfirmModal;
