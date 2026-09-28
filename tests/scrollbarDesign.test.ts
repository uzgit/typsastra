import { describe, expect, test } from "bun:test";

describe("cross-platform scrollbar design", () => {
  test("styles application scrollbars while preserving the hidden tab strip", async () => {
    const css = await Bun.file(new URL("../src/style.css", import.meta.url)).text();
    expect(css).toContain("--ui-scrollbar-thumb");
    expect(css).toContain("--ui-scrollbar-track: transparent");
    expect(css).toContain("*::-webkit-scrollbar");
    expect(css).toContain("border-radius: 0");
    expect(css).toContain("@supports not selector(::-webkit-scrollbar)");
    expect(css).toContain("scrollbar-color: var(--ui-scrollbar-thumb) var(--ui-scrollbar-track)");
    expect(css).toContain(".editor-tab-bar::-webkit-scrollbar");
    expect(css).toContain("scrollbar-width: none");
  });

  test("applies matching custom geometry inside the isolated PDF iframe", async () => {
    const source = await Bun.file(new URL("../src/preview/previewFrame.ts", import.meta.url)).text();
    expect(source).toMatch(/body::\-webkit-scrollbar\{width:\d+px;height:\d+px\}/);
    expect(source).not.toContain("*::-webkit-scrollbar");
    expect(source).toContain("@supports not selector(::-webkit-scrollbar)");
    expect(source).toContain("scrollbar-color:var(--scrollbar-thumb) var(--scrollbar-track)");
    expect(source).toContain("border-radius:0");
    expect(source).toContain('copy("--ui-accent-color", "--preview-ui-accent"');
    expect(source).toContain("var(--preview-ui-accent)");
  });

  test("distinguishes live preview from directly opened PDF surfaces", async () => {
    const source = await Bun.file(new URL("../src/preview/previewFrame.ts", import.meta.url)).text();
    const controller = await Bun.file(new URL("../src/appController.ts", import.meta.url)).text();
    expect(source).toContain('export type PreviewSurface = "live" | "pdf"');
    expect(source).toContain('iframeDoc.documentElement.dataset.previewSurface = surface');
    expect(source).toContain('copy("--ui-hover", "--preview-surface-bg", "#eeeeee")');
    expect(source).not.toContain(':root[data-preview-surface="pdf"]{--preview-surface-bg:');
    expect(source).toContain('background:var(--preview-surface-bg)');
    expect(controller).toContain('surface: PreviewSurface = isTypstDocumentPath(identity) ? "live" : "pdf"');
    expect(controller).toContain('this.previewFrame.loadPdfBytes(bytes, identity, sessionKey, surface)');
  });

  test("does not build an unused PDF text layer", async () => {
    const source = await Bun.file(new URL("../src/preview/previewFrame.ts", import.meta.url)).text();
    expect(source).not.toContain("renderTextLayer");
    expect(source).not.toContain('className = "textLayer"');
    expect(source).toContain("hydratePageDimensions");
  });

  test("uses immediate programmatic page jumps and reports the visible page", async () => {
    const source = await Bun.file(new URL("../src/preview/previewFrame.ts", import.meta.url)).text();
    expect(source).toContain('behavior: "auto"');
    expect(source).not.toContain('behavior: "smooth"');
    expect(source).toContain("finishInstantPageJump");
    expect(source).toContain("reportPageStatus");
  });

  test("restores the raw preview scroll offset across PDF recompilation", async () => {
    const source = await Bun.file(new URL("../src/preview/previewFrame.ts", import.meta.url)).text();
    const loadStart = source.indexOf("public async loadPdfBytes");
    const loadEnd = source.indexOf("private async pdfJs", loadStart);
    const loadPdf = source.slice(loadStart, loadEnd);
    expect(loadPdf).toContain(": this.captureScrollPosition()");
    expect(loadPdf).toContain("this.restoreScrollPosition(previousScrollTop)");
    expect(loadPdf).not.toContain("const previousScroll = this.captureScrollAnchor()");
    expect(source).toContain("const restoredTop = Math.min(Math.max(0, scrollTop), maximum)");
  });

  test("restores the workspace preview offset on the first PDF presentation", async () => {
    const source = await Bun.file(new URL("../src/preview/previewFrame.ts", import.meta.url)).text();
    const controller = await Bun.file(new URL("../src/appController.ts", import.meta.url)).text();
    expect(source).toContain("restoreWorkspaceScrollPosition(scrollTop: number)");
    expect(source).toContain("this.pendingRestoredScrollTop");
    expect(controller).toContain("this.previewFrame.restoreWorkspaceScrollPosition(state.previewScrollTop)");
    expect(controller).toContain("previewScrollTop: this.previewScrollTop");
  });

  test("provides an accessible floating control to return to the first page", async () => {
    const source = await Bun.file(new URL("../src/preview/previewFrame.ts", import.meta.url)).text();
    expect(source).toContain('id="preview-go-first"');
    expect(source).toContain('aria-label="Go to first page"');
    expect(source).toContain("this.jumpToPreviewOffset(0, 1)");
    expect(source).toContain("this.updateGoToFirstPageButton()");
    expect(source).toContain('target?.closest("#preview-go-first")');
  });

  test("reveals and distinguishes actionable preview links while Ctrl is held inside the preview", async () => {
    const source = await Bun.file(new URL("../src/preview/previewFrame.ts", import.meta.url)).text();
    expect(source).toContain('target.kind === "external"');
    expect(source).toContain('"external-link"');
    expect(source).toContain('"internal-reference"');
    expect(source).toContain(".preview-link-modifier .annotation-link.internal-reference");
    expect(source).toContain(".preview-link-modifier .annotation-link.external-link");
    expect(source).toContain("box-shadow:inset 3px 0");
    expect(source).toContain("outline:2px dashed");
    expect(source).toContain("this.previewPointerInside && modifierPressed");
    expect(source).toContain("this.previewPointerInside = false");
    expect(source).toContain("Math.min(rect[0], rect[2]) - 3");
    expect(source).toContain("Math.max(rect[0], rect[2]) + 3");
  });

  test("provides editable page navigation in the shared preview toolbar", async () => {
    const html = await Bun.file(new URL("../index.html", import.meta.url)).text();
    expect(html).toContain('id="preview-page-input"');
    expect(html).toContain('id="preview-page-count"');
    expect(html).toContain('role="spinbutton"');
  });

  test("preserves a compiled PDF behind non-Typst preview messages", async () => {
    const source = await Bun.file(new URL("../src/preview/previewFrame.ts", import.meta.url)).text();
    const controller = await Bun.file(new URL("../src/appController.ts", import.meta.url)).text();
    expect(source).toContain("setMessageOverlay(html: string)");
    expect(source).toContain("this.mountedSessionKey !== sessionKey");
    expect(source).toContain("this.clearMessageHost();");
    expect(controller).toContain("this.previewFrame.setMessageOverlay(");
    expect(controller).toContain("previewPresentationReused = this.previewFrame.activateSession(tab.previewSessionKey)");
  });
});
