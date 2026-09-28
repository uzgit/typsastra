import { describe, expect, test } from "bun:test";
import {
  effectivePreviewDisplayScale,
  normalizePreviewQualityMode,
  previewPageRenderGeometry,
  previewQualityPolicy,
  residentPreviewPagesToEvict
} from "../src/preview/renderQuality";

describe("PDF preview render quality", () => {
  test("normalizes persisted quality modes", () => {
    expect(normalizePreviewQualityMode("memory-saver")).toBe("memory-saver");
    expect(normalizePreviewQualityMode("balanced")).toBe("balanced");
    expect(normalizePreviewQualityMode("maximum")).toBe("maximum");
    expect(normalizePreviewQualityMode("unknown")).toBe("balanced");
  });

  test("uses the highest valid native or webview display scale", () => {
    expect(effectivePreviewDisplayScale(1, 1.5)).toBe(1.5);
    expect(effectivePreviewDisplayScale(2, 1.25)).toBe(2);
    expect(effectivePreviewDisplayScale(Number.NaN, 0, undefined)).toBe(1);
    expect(effectivePreviewDisplayScale(12)).toBe(8);
  });

  test("aligns backing and CSS dimensions without fractional stretching", () => {
    const oneX = previewPageRenderGeometry(595.28, 841.89, 91, 1, "balanced");
    expect(oneX.canvasWidth).toBe(oneX.cssWidth);
    expect(oneX.canvasHeight).toBe(oneX.cssHeight);
    expect(oneX.outputScaleX).toBe(1);
    expect(oneX.outputScaleY).toBe(1);

    const fractional = previewPageRenderGeometry(595.28, 841.89, 91, 1.5, "balanced");
    expect(fractional.canvasWidth / fractional.cssWidth).toBe(1.5);
    expect(fractional.canvasHeight / fractional.cssHeight).toBe(1.5);
  });

  test("enforces each mode's per-page pixel budget", () => {
    for (const mode of ["memory-saver", "balanced", "maximum"] as const) {
      const geometry = previewPageRenderGeometry(5_000, 5_000, 100, 4, mode);
      expect(geometry.canvasWidth * geometry.canvasHeight)
        .toBeLessThanOrEqual(previewQualityPolicy(mode).maxCanvasPixels);
    }
  });

  test("maximum clarity supersamples while memory saver retains the 2x cap", () => {
    expect(previewQualityPolicy("maximum").targetOutputScale(1)).toBe(1.5);
    expect(previewQualityPolicy("maximum").targetOutputScale(3)).toBe(4);
    expect(previewQualityPolicy("memory-saver").targetOutputScale(3)).toBe(2);
    expect(previewQualityPolicy("balanced").targetOutputScale(3)).toBe(3);
  });

  test("evicts distant hidden pages until count and pixel budgets are met", () => {
    const pages = Array.from({ length: 9 }, (_, index) => ({
      pageNo: index + 1,
      pixels: 10,
      visible: index + 1 === 5
    }));
    expect(residentPreviewPagesToEvict(pages, 5, 7, 70)).toEqual([1, 9]);

    const visibleOverBudget = [
      { pageNo: 1, pixels: 60, visible: true },
      { pageNo: 2, pixels: 60, visible: true }
    ];
    expect(residentPreviewPagesToEvict(visibleOverBudget, 1, 7, 50)).toEqual([]);
  });
});


describe("preview quality runtime wiring", () => {
  test("rerenders every PDF surface for quality and monitor-scale changes", async () => {
    const controller = await Bun.file(new URL("../src/appController.ts", import.meta.url)).text();
    const frame = await Bun.file(new URL("../src/preview/previewFrame.ts", import.meta.url)).text();

    expect(controller).toContain("currentWindow.onScaleChanged");
    expect(controller).toContain("this.previewFrame.setDisplayScaleFactor(nativeScale)");
    expect(controller).toContain("this.editorFilePreviewFrame.setDisplayScaleFactor(nativeScale)");
    expect(controller).toContain('listen<PreviewQualityMode>("preview-quality-update"');
    expect(controller).toContain('emit("preview-quality-update", this.settingsController.value.preview.quality)');
    expect(frame).toContain("this.layoutPageSlots({ preserveExistingPages: true })");
    expect(frame).toContain("transform: [geometry.renderScaleX, 0, 0, geometry.renderScaleY, 0, 0]");
    expect(frame).not.toContain("MAX_OUTPUT_SCALE");
  });
});
