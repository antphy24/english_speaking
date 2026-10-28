import React from 'react';
import useSwipeRow from '../../hooks/useSwipeRow';

/**
 * List of choices (paragraphs, questions, motions...).
 * Phones: a row of cards you swipe sideways. Laptops: a vertical list.
 *   <PickerList title="Questions" items={[{ id, title, meta }]} selectedId={id} onSelect={(item) => ...} />
 */
export function PickerList({ title, items = [], selectedId, onSelect, disabled = false, className = '' }) {
  const swipeRef = useSwipeRow();
  return (
    <section aria-label={title} className={`md:w-64 lg:w-72 shrink-0 min-w-0 space-y-2.5 ${className}`}>
      <h2 className="text-sm font-semibold text-ink-muted">
        {title}
        {items.length > 1 && <span className="md:hidden font-normal text-ink-subtle"> · swipe for more</span>}
      </h2>
      <div ref={swipeRef} className="no-scrollbar flex md:flex-col gap-2.5 overflow-x-auto md:overflow-visible -mx-4 px-4 md:mx-0 md:px-0 pb-1 md:pb-0">
        {items.map((item) => {
          const active = item.id === selectedId;
          return (
            <button
              key={item.id}
              type="button"
              disabled={disabled}
              onClick={() => onSelect?.(item)}
              aria-pressed={active}
              className={`shrink-0 md:w-full text-left px-4 py-3.5 rounded-xl border transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-ring disabled:opacity-50 disabled:cursor-not-allowed ${
                items.length > 1 ? 'w-[72%]' : 'w-full'
              } ${active ? 'bg-brand-tint border-brand ring-1 ring-inset ring-brand' : 'bg-surface border-line hover:border-line-strong'}`}
            >
              <span className={`block text-[15px] font-semibold line-clamp-2 ${active ? 'text-brand-ink' : 'text-ink'}`}>{item.title}</span>
              {item.meta && <span className="block text-[13px] text-ink-subtle mt-1 line-clamp-1">{item.meta}</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export default PickerList;
