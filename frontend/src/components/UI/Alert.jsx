import React from 'react';
import { Info, CheckCircle2, AlertTriangle, AlertCircle, X } from 'lucide-react';

const TONES = {
  info: { box: 'bg-brand-tint text-ink', icon: 'text-brand-ink', Icon: Info },
  success: { box: 'bg-success-tint text-ink', icon: 'text-success', Icon: CheckCircle2 },
  warning: { box: 'bg-warning-tint text-ink', icon: 'text-warning', Icon: AlertTriangle },
  error: { box: 'bg-danger-tint text-ink', icon: 'text-danger', Icon: AlertCircle },
};

/**
 * Inline message inside a page or form.
 *   <Alert tone="error">Wrong password.</Alert>
 *   <Alert tone="info" title="How it works">Read the paragraph aloud...</Alert>
 */
export function Alert({ tone = 'info', title, children, onClose, action, className = '' }) {
  const t = TONES[tone] || TONES.info;
  const Icon = t.Icon;
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-3 rounded-xl px-4 py-3 text-sm leading-relaxed ${t.box} ${className}`}
    >
      <Icon className={`w-5 h-5 mt-px shrink-0 ${t.icon}`} aria-hidden="true" />
      <div className="flex-1 min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? 'mt-0.5 text-ink-muted' : ''}>{children}</div>}
        {action && <div className="mt-2">{action}</div>}
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss"
          className="-m-1.5 p-1.5 rounded-lg text-ink-subtle hover:text-ink hover:bg-black/5 dark:hover:bg-white/5"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export default Alert;
