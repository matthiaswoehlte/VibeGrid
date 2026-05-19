export interface DprSize {
  cssWidth: number;
  cssHeight: number;
  pxWidth: number;
  pxHeight: number;
  dpr: number;
}

/**
 * Attach a ResizeObserver to the canvas. On every resize, compute DPR-scaled
 * pixel dimensions and invoke onResize. The caller is responsible for assigning
 * canvas.width / canvas.height and calling ctx.scale(dpr, dpr).
 */
export function attachDprObserver(
  canvas: HTMLCanvasElement,
  onResize: (size: DprSize) => void
): () => void {
  const observer = new ResizeObserver((entries) => {
    const entry = entries[0];
    if (!entry) return;
    const cssWidth = entry.contentRect.width;
    const cssHeight = entry.contentRect.height;
    const dpr = window.devicePixelRatio || 1;
    onResize({
      cssWidth,
      cssHeight,
      pxWidth: Math.round(cssWidth * dpr),
      pxHeight: Math.round(cssHeight * dpr),
      dpr
    });
  });
  observer.observe(canvas);
  return () => observer.disconnect();
}
