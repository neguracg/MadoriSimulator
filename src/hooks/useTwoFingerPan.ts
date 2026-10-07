// @owns タッチ2本指でのキャンバスのスクロール（1本指は図面の操作に使うので、スクロールは2本指で行う）
import { useEffect, useState, type RefObject } from 'react';

/**
 * Two fingers touching `scrollerRef` scroll it: the content follows the middle point between them. One finger belongs to
 * the canvas (draw, drag, handles). When the second finger lands, the returned `panning` flag turns true so the canvas drops
 * the gesture the first finger had begun, and while two or more fingers touch, no touch event reaches the canvas (the
 * capture phase stops it first): the second finger must not start a gesture of its own. Mouse and pen are not affected.
 */
export function useTwoFingerPan(scrollerRef: RefObject<HTMLElement>): boolean {
  const [panning, setPanning] = useState(false);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const touches = new Map<number, { x: number; y: number }>();
    let active = false;
    let last = { x: 0, y: 0 };

    const middle = () => {
      let x = 0;
      let y = 0;
      for (const t of touches.values()) {
        x += t.x;
        y += t.y;
      }
      return { x: x / touches.size, y: y / touches.size };
    };
    const reset = () => {
      touches.clear();
      if (active) {
        active = false;
        setPanning(false);
      }
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size < 2) return; // the first finger is the canvas's
      e.stopPropagation();
      last = middle();
      if (!active) {
        active = true;
        setPanning(true);
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!touches.has(e.pointerId)) return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!active) return;
      e.stopPropagation();
      const m = middle();
      el.scrollLeft -= m.x - last.x;
      el.scrollTop -= m.y - last.y;
      last = m;
    };
    const onEnd = (e: PointerEvent) => {
      if (!touches.delete(e.pointerId) || !active) return;
      e.stopPropagation();
      if (touches.size < 2) {
        active = false;
        setPanning(false);
      } else {
        last = middle();
      }
    };

    el.addEventListener('pointerdown', onDown, true);
    el.addEventListener('pointermove', onMove, true);
    // the end of a touch is heard on the window, so a finger that leaves the area is still counted
    window.addEventListener('pointerup', onEnd, true);
    window.addEventListener('pointercancel', onEnd, true);
    window.addEventListener('blur', reset); // a touch that ended while the page could not hear it must not stay counted
    return () => {
      el.removeEventListener('pointerdown', onDown, true);
      el.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onEnd, true);
      window.removeEventListener('pointercancel', onEnd, true);
      window.removeEventListener('blur', reset);
      reset();
    };
  }, [scrollerRef]);

  return panning;
}
