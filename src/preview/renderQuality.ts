export const previewQualityModes = ["memory-saver", "balanced", "maximum"] as const;

export type PreviewQualityMode = typeof previewQualityModes[number];

export type PreviewQualityPolicy = {
  targetOutputScale: (displayScale: number) => number;
  maxCanvasPixels: number;
  maxResidentCanvasPixels: number;
};

export type PreviewPageRenderGeometry = {
  cssWidth: number;
  cssHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  renderScaleX: number;
  renderScaleY: number;
  outputScaleX: number;
  outputScaleY: number;
};

const MEMORY_SAVER_CANVAS_PIXELS = 2 ** 23;
const BALANCED_CANVAS_PIXELS = 2 ** 24;
const MAXIMUM_CANVAS_PIXELS = 2 ** 25;

export function normalizePreviewQualityMode(value: unknown): PreviewQualityMode {
  return previewQualityModes.includes(value as PreviewQualityMode)
    ? value as PreviewQualityMode
    : "balanced";
}

export function effectivePreviewDisplayScale(...candidates: unknown[]): number {
  const valid = candidates
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
  return Math.min(8, Math.max(1, ...valid));
}

export function previewQualityPolicy(mode: PreviewQualityMode): PreviewQualityPolicy {
  switch (mode) {
    case "memory-saver":
      return {
        targetOutputScale: displayScale => Math.min(displayScale, 2),
        maxCanvasPixels: MEMORY_SAVER_CANVAS_PIXELS,
        maxResidentCanvasPixels: 2 ** 25
      };
    case "maximum":
      return {
        targetOutputScale: displayScale => Math.min(displayScale * 1.5, 4),
        maxCanvasPixels: MAXIMUM_CANVAS_PIXELS,
        maxResidentCanvasPixels: 3 * MAXIMUM_CANVAS_PIXELS
      };
    default:
      return {
        targetOutputScale: displayScale => displayScale,
        maxCanvasPixels: BALANCED_CANVAS_PIXELS,
        maxResidentCanvasPixels: 2 ** 26
      };
  }
}

export function residentPreviewPagesToEvict(
  pages: readonly { pageNo: number; pixels: number; visible: boolean }[],
  focusPage: number,
  maxPageCount: number,
  maxResidentPixels: number
): number[] {
  let residentCount = pages.length;
  let residentPixels = pages.reduce((total, page) => total + page.pixels, 0);
  if (residentCount <= maxPageCount && residentPixels <= maxResidentPixels) return [];

  const evicted: number[] = [];
  const candidates = pages
    .filter(page => page.pageNo !== focusPage && !page.visible)
    .sort((left, right) => Math.abs(right.pageNo - focusPage) - Math.abs(left.pageNo - focusPage));
  for (const candidate of candidates) {
    if (residentCount <= maxPageCount && residentPixels <= maxResidentPixels) break;
    evicted.push(candidate.pageNo);
    residentCount -= 1;
    residentPixels -= candidate.pixels;
  }
  return evicted;
}

export function previewPageRenderGeometry(
  pageWidth: number,
  pageHeight: number,
  zoomPercent: number,
  displayScale: number,
  mode: PreviewQualityMode
): PreviewPageRenderGeometry {
  const rawCssWidth = Math.max(1, pageWidth * zoomPercent / 100);
  const rawCssHeight = Math.max(1, pageHeight * zoomPercent / 100);
  const policy = previewQualityPolicy(mode);
  const targetScale = policy.targetOutputScale(effectivePreviewDisplayScale(displayScale));
  const pixelLimitedScale = Math.sqrt(policy.maxCanvasPixels / (rawCssWidth * rawCssHeight));
  const requestedScale = Math.max(1 / 8, Math.min(targetScale, pixelLimitedScale));
  const [numerator, denominator] = approximateFraction(requestedScale);

  // Match PDF.js's output-scale rounding: make the CSS dimensions a multiple
  // of the scale denominator and the backing dimensions a multiple of the
  // numerator. The browser can then composite the canvas without resampling a
  // fractionally stretched bitmap.
  const cssWidth = positiveMultiple(rawCssWidth, denominator);
  const cssHeight = positiveMultiple(rawCssHeight, denominator);
  const canvasWidth = positiveMultiple(rawCssWidth * requestedScale, numerator);
  const canvasHeight = positiveMultiple(rawCssHeight * requestedScale, numerator);

  return {
    cssWidth,
    cssHeight,
    canvasWidth,
    canvasHeight,
    renderScaleX: canvasWidth / rawCssWidth,
    renderScaleY: canvasHeight / rawCssHeight,
    outputScaleX: canvasWidth / cssWidth,
    outputScaleY: canvasHeight / cssHeight
  };
}

function positiveMultiple(value: number, divisor: number): number {
  const rounded = Math.fround(value);
  const result = rounded - rounded % divisor;
  return Math.max(divisor, result);
}

// PDF.js uses a small continued-fraction approximation so common fractional
// display scales such as 1.25 and 1.5 map to exact backing-store ratios.
function approximateFraction(value: number): [number, number] {
  if (Math.floor(value) === value) return [value, 1];
  const inverse = 1 / value;
  const limit = 8;
  if (inverse > limit) return [1, limit];
  if (Math.floor(inverse) === inverse) return [1, inverse];

  const boundedValue = value > 1 ? inverse : value;
  let lowerNumerator = 0;
  let lowerDenominator = 1;
  let upperNumerator = 1;
  let upperDenominator = 1;
  while (true) {
    const numerator = lowerNumerator + upperNumerator;
    const denominator = lowerDenominator + upperDenominator;
    if (denominator > limit) break;
    if (boundedValue <= numerator / denominator) {
      upperNumerator = numerator;
      upperDenominator = denominator;
    } else {
      lowerNumerator = numerator;
      lowerDenominator = denominator;
    }
  }
  const useLower = boundedValue - lowerNumerator / lowerDenominator
    < upperNumerator / upperDenominator - boundedValue;
  const numerator = useLower ? lowerNumerator : upperNumerator;
  const denominator = useLower ? lowerDenominator : upperDenominator;
  return boundedValue === value
    ? [numerator, denominator]
    : [denominator, numerator];
}
