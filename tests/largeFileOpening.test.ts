import { describe, expect, test } from "bun:test";
import {
  LARGE_PDF_FILE_BYTES,
  LARGE_TEXT_FILE_BYTES,
  LARGE_TEXT_FILE_LINES,
  formatFileSize,
  largeFileOpeningNotice,
  largeMainPreviewOpeningNotice,
} from "../src/workspace/largeFileOpening";

describe("large file opening notice", () => {
  test("notifies for large text and PDF files at independent thresholds", () => {
    expect(largeFileOpeningNotice("chapter.typ", LARGE_TEXT_FILE_BYTES)).toEqual({
      kind: "text",
      sizeBytes: LARGE_TEXT_FILE_BYTES,
    });
    expect(largeFileOpeningNotice("book.pdf", LARGE_PDF_FILE_BYTES)).toEqual({
      kind: "pdf",
      sizeBytes: LARGE_PDF_FILE_BYTES,
    });
    expect(largeFileOpeningNotice("chapter.typ", LARGE_TEXT_FILE_BYTES - 1)).toBeNull();
    expect(largeFileOpeningNotice("book.pdf", LARGE_PDF_FILE_BYTES - 1)).toBeNull();
  });

  test("also guards text files with many short lines", () => {
    expect(largeFileOpeningNotice("chapter.typ", 200 * 1024, LARGE_TEXT_FILE_LINES)).toEqual({
      kind: "text",
      sizeBytes: 200 * 1024,
      lineCount: LARGE_TEXT_FILE_LINES,
    });
  });

  test("does not classify binary images or unsupported files as large text", () => {
    expect(largeFileOpeningNotice("figure.png", LARGE_PDF_FILE_BYTES)).toBeNull();
    expect(largeFileOpeningNotice("archive.zip", LARGE_PDF_FILE_BYTES)).toBeNull();
  });

  test("describes a large Typst preview root separately from the opened chapter", () => {
    expect(largeMainPreviewOpeningNotice("book.typ", LARGE_TEXT_FILE_BYTES)).toEqual({
      kind: "main-preview",
      sizeBytes: LARGE_TEXT_FILE_BYTES,
      previewRootPath: "book.typ",
      previewSourceFiles: undefined,
    });
    expect(largeMainPreviewOpeningNotice(
      "book.typ",
      200 * 1024,
      LARGE_TEXT_FILE_LINES,
    )).toEqual({
      kind: "main-preview",
      sizeBytes: 200 * 1024,
      lineCount: LARGE_TEXT_FILE_LINES,
      previewRootPath: "book.typ",
      previewSourceFiles: undefined,
    });
    expect(largeMainPreviewOpeningNotice(
      "book.typ",
      LARGE_TEXT_FILE_BYTES,
      LARGE_TEXT_FILE_LINES,
      8,
    )?.previewSourceFiles).toBe(8);
    expect(largeMainPreviewOpeningNotice("book.typ", LARGE_TEXT_FILE_BYTES - 1)).toBeNull();
    expect(largeMainPreviewOpeningNotice("book.pdf", LARGE_PDF_FILE_BYTES)).toBeNull();
  });

  test("formats the size for the user-facing status", () => {
    expect(formatFileSize(768 * 1024)).toBe("768 KB");
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe("1.5 MB");
    expect(formatFileSize(100 * 1024 * 1024)).toBe("100 MB");
  });

  test("keeps standalone PDF confirmation in the central editor viewer", async () => {
    const controller = await Bun.file(new URL("../src/appController.ts", import.meta.url)).text();
    const confirmationStart = controller.indexOf("private showLargeFileConfirmation");
    const confirmationEnd = controller.indexOf("private async openFileExternally", confirmationStart);
    const confirmationSource = controller.slice(confirmationStart, confirmationEnd);

    expect(confirmationSource).toContain('if (notice.kind === "pdf")');
    expect(confirmationSource).toContain("this.prepareEditorFileViewer(path");
    expect(confirmationSource).toContain("this.blockedLargePdfPaths.add(filePathKey(path))");
    expect(confirmationSource).not.toContain("this.previewFrame.setConfirmationMessage({");
    expect(confirmationSource).not.toContain("this.invalidatePreviewWork(");
    expect(confirmationSource).toContain('"Open Large PDF"');
    expect(confirmationSource).toContain("this.blockedLargePdfPaths.delete(filePathKey(path))");
  });

  test("routes large Typst preview approval through the editor guard", async () => {
    const controller = await Bun.file(new URL("../src/appController.ts", import.meta.url)).text();
    const noticeStart = controller.indexOf("private async largeFileNoticeForTab");
    const noticeEnd = controller.indexOf("private activeCompilerPreviewMatchesRoot", noticeStart);
    const noticeSource = controller.slice(noticeStart, noticeEnd);
    expect(noticeSource).toContain("this.previewTargetForUnloadedTab(tab)");
    expect(noticeSource).toContain("this.largePreviewNoticeForRoot(target.rootPath)");

    const confirmationStart = controller.indexOf("private showLargeFileConfirmation");
    const confirmationEnd = controller.indexOf("private async openFileExternally", confirmationStart);
    const confirmationSource = controller.slice(confirmationStart, confirmationEnd);
    expect(confirmationSource).toContain("this.workspaceServicesDeferredForLargeFile = true");
    expect(confirmationSource).toContain("await this.approveLargePreviewForTab(tab, notice)");
    expect(confirmationSource).toContain('"Large Typst Document"');
    expect(confirmationSource).not.toContain('"Large Main Document Preview"');
    expect(confirmationSource).toContain("Open and Compile Preview");
    expect(confirmationSource).toContain("The compiler preview will start after you confirm opening the large Typst file.");

    const servicesStart = controller.indexOf("private async startWorkspaceServices");
    const servicesEnd = controller.indexOf("private async restoreActiveDocumentAfterTinymistRestart", servicesStart);
    const servicesSource = controller.slice(servicesStart, servicesEnd);
    expect(servicesSource).toContain("if (this.workspaceServicesDeferredForLargeFile) return");
  });
});
