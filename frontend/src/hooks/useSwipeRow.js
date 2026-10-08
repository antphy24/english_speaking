import { useCallback, useRef } from 'react';

// Rows that swipe sideways on a phone (mode tabs, paragraph picker...) have no visible way
// to move with a mouse. This makes them work on a laptop too: turn the mouse wheel over the
// row, or click and drag it. Touch screens keep their normal swipe.
function attach(el) {
  const canScroll = () => el.scrollWidth > el.clientWidth + 1;

  const onWheel = (e) => {
    if (!canScroll() || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return; // trackpads already scroll sideways
    const before = el.scrollLeft;
    el.scrollLeft += e.deltaY;
    if (el.scrollLeft !== before) e.preventDefault(); // at either end, let the page scroll as usual
  };

  let startX = 0;
  let startScroll = 0;
  let pressed = false;
  let dragged = false;

  const swallowClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const onMove = (e) => {
    if (!pressed) return;
    const dx = e.clientX - startX;
    if (!dragged && Math.abs(dx) > 5) {
      dragged = true;
      el.style.userSelect = 'none';
      el.style.cursor = 'grabbing';
    }
    if (dragged) el.scrollLeft = startScroll - dx;
  };

  const onUp = () => {
    if (!pressed) return;
    pressed = false;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    el.style.userSelect = '';
    el.style.cursor = '';
    if (dragged) {
      // The release after a drag must not count as a click on the item under the cursor
      el.addEventListener('click', swallowClick, { capture: true, once: true });
      setTimeout(() => el.removeEventListener('click', swallowClick, { capture: true }), 0);
    }
  };

  const onDown = (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || !canScroll()) return;
    pressed = true;
    dragged = false;
    startX = e.clientX;
    startScroll = el.scrollLeft;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('pointerdown', onDown);
  return () => {
    el.removeEventListener('wheel', onWheel);
    el.removeEventListener('pointerdown', onDown);
    onUp();
  };
}

/** Returns a `ref` for a sideways-scrolling row. */
export function useSwipeRow() {
  const cleanupRef = useRef(null);
  return useCallback((el) => {
    if (cleanupRef.current) cleanupRef.current();
    cleanupRef.current = el ? attach(el) : null;
  }, []);
}
export default useSwipeRow;
