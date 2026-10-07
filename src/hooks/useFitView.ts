// @owns 「全体」ボタンの動作（内容全体が見える拡大率を選び、その位置までスクロールする）
import { useLayoutEffect, useState, type RefObject } from 'react';
import type { FloorData } from '../types';
import { contentBox, fitZoom, scrollToBox } from '../utils/viewFit';

/**
 * `fit()`: pick the zoom at which everything on the floor fits the scrolled area, then scroll to it. The scroll waits
 * for the new zoom to be on screen (the canvas has its new size only after the render), hence the layout effect.
 * An empty floor goes back to 100% at the top left.
 */
export function useFitView(
  scrollerRef: RefObject<HTMLElement>,
  floor: FloorData,
  cellMm: number,
  zoom: number,
  setZoom: (z: number) => void,
): () => void {
  const [tick, setTick] = useState(0);

  const fit = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const box = contentBox(floor, cellMm);
    setZoom(box ? fitZoom(box, el.clientWidth, el.clientHeight) : 1);
    setTick((n) => n + 1);
  };

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    const svg = el?.querySelector('svg.canvas');
    if (tick === 0 || !el || !svg) return;
    const box = contentBox(floor, cellMm);
    // where the drawing starts inside the scrolled area (its padding), whatever the scroll position is now
    const origin = {
      x: svg.getBoundingClientRect().left - el.getBoundingClientRect().left + el.scrollLeft,
      y: svg.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop,
    };
    const to = box ? scrollToBox(box, zoom, { w: el.clientWidth, h: el.clientHeight }, origin) : { left: 0, top: 0 };
    el.scrollLeft = to.left;
    el.scrollTop = to.top;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  return fit;
}
