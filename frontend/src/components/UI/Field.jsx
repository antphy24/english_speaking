import React, { useId } from 'react';

const CONTROL =
  'w-full min-h-[44px] px-3.5 bg-surface border border-line-strong rounded-[10px] text-ink text-[15px] ' +
  'placeholder:text-ink-subtle transition-shadow ' +
  'focus:outline-none focus:border-brand focus:ring-4 focus:ring-brand-ring ' +
  'disabled:bg-surface-muted disabled:text-ink-subtle disabled:cursor-not-allowed';

const INVALID = 'border-danger focus:border-danger focus:ring-danger-tint';

/**
 * Label + control + hint/error, wired up for screen readers.
 *   <Field label="Class code" hint="Ask your teacher if you don't know it.">
 *     <Input value={code} onChange={...} />
 *   </Field>
 * The child control gets its id and aria attributes automatically.
 */
export function Field({ label, hint, error, children, className = '', optional = false }) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  const control = React.isValidElement(children)
    ? React.cloneElement(children, {
        id: children.props.id || id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
        invalid: error ? true : undefined,
      })
    : children;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label && (
        <label htmlFor={children?.props?.id || id} className="text-sm font-semibold text-ink">
          {label}
          {optional && <span className="font-normal text-ink-subtle"> (optional)</span>}
        </label>
      )}
      {control}
      {error && (
        <p id={errorId} className="text-[13px] text-danger">
          {error}
        </p>
      )}
      {hint && !error && (
        <p id={hintId} className="text-[13px] text-ink-subtle">
          {hint}
        </p>
      )}
    </div>
  );
}

export const Input = React.forwardRef(function Input({ className = '', invalid, ...props }, ref) {
  return <input ref={ref} className={`${CONTROL} ${invalid ? INVALID : ''} ${className}`} {...props} />;
});

export const Select = React.forwardRef(function Select({ className = '', invalid, children, ...props }, ref) {
  return (
    <select ref={ref} className={`${CONTROL} pr-9 cursor-pointer ${invalid ? INVALID : ''} ${className}`} {...props}>
      {children}
    </select>
  );
});

export const Textarea = React.forwardRef(function Textarea({ className = '', invalid, rows = 4, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={`${CONTROL} py-2.5 leading-relaxed resize-y ${invalid ? INVALID : ''} ${className}`}
      {...props}
    />
  );
});

export default Field;
