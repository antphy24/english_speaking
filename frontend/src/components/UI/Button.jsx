import React from 'react';
import { Loader2 } from 'lucide-react';

const VARIANTS = {
  primary: 'bg-brand text-white hover:bg-brand-hover',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-surface-muted',
  ghost: 'bg-transparent text-brand-ink hover:bg-brand-tint',
  subtle: 'bg-transparent text-ink-muted hover:bg-surface-muted hover:text-ink',
  danger: 'bg-danger-solid text-white hover:brightness-95',
  'danger-outline': 'bg-surface text-danger border border-line-strong hover:bg-danger-tint',
};

const SIZES = {
  sm: 'min-h-[36px] px-3 text-sm gap-1.5 rounded-lg',
  md: 'min-h-[44px] px-4 text-sm gap-2 rounded-[10px]',
  lg: 'min-h-[48px] px-5 text-base gap-2 rounded-[10px]',
};

const ICON_ONLY = {
  sm: 'w-9 h-9 rounded-lg',
  md: 'w-11 h-11 rounded-[10px]',
  lg: 'w-12 h-12 rounded-[10px]',
};

/**
 * The one button for the whole app.
 *   <Button>Save</Button>
 *   <Button variant="secondary" icon={RotateCcw}>Try again</Button>
 *   <Button variant="subtle" icon={LogOut} aria-label="Sign out" />   (icon only)
 *   <Button loading>Saving</Button>
 */
export const Button = React.forwardRef(function Button(
  {
    variant = 'primary',
    size = 'md',
    icon: Icon,
    iconRight: IconRight,
    loading = false,
    fullWidth = false,
    className = '',
    children,
    type = 'button',
    disabled,
    ...props
  },
  ref
) {
  const iconOnly = !children && (Icon || loading);
  const iconSize = size === 'lg' ? 'w-5 h-5' : 'w-[18px] h-[18px]';
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={[
        'inline-flex items-center justify-center font-semibold whitespace-nowrap select-none transition-colors',
        'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-ring',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        VARIANTS[variant] || VARIANTS.primary,
        iconOnly ? ICON_ONLY[size] : SIZES[size],
        fullWidth ? 'w-full' : '',
        className,
      ].join(' ')}
      {...props}
    >
      {loading ? (
        <Loader2 className={`${iconSize} animate-spin`} aria-hidden="true" />
      ) : (
        Icon && <Icon className={iconSize} aria-hidden="true" />
      )}
      {children}
      {IconRight && !loading && <IconRight className={iconSize} aria-hidden="true" />}
    </button>
  );
});

export default Button;
