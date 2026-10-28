import React from 'react';

/**
 * HreFSpeak mark (three sound bars) with optional wordmark.
 *   <Logo />            mark + name
 *   <Logo size="lg" />  bigger, for sign-in pages
 *   <Logo markOnly />
 */
const SIZES = {
  sm: { box: 'w-8 h-8 rounded-[9px] gap-[3px]', bar: 'w-[3px]', bars: ['h-[9px]', 'h-4', 'h-3'], text: 'text-base' },
  md: { box: 'w-9 h-9 rounded-[10px] gap-[3px]', bar: 'w-[3px]', bars: ['h-2.5', 'h-[18px]', 'h-[13px]'], text: 'text-lg' },
  lg: { box: 'w-[52px] h-[52px] rounded-[14px] gap-1', bar: 'w-1', bars: ['h-3.5', 'h-[26px]', 'h-[19px]'], text: 'text-2xl' },
};

export function Logo({ size = 'md', markOnly = false, className = '' }) {
  const s = SIZES[size] || SIZES.md;
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <span className={`bg-brand flex items-center justify-center shrink-0 ${s.box}`} aria-hidden="true">
        {s.bars.map((h, i) => (
          <span key={i} className={`${s.bar} ${h} rounded-sm bg-white`} />
        ))}
      </span>
      {markOnly ? (
        <span className="sr-only">HreFSpeak</span>
      ) : (
        <span className={`${s.text} font-bold tracking-tight text-ink`}>HreFSpeak</span>
      )}
    </span>
  );
}

export default Logo;
