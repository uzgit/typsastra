import { describe, expect, test } from "bun:test";
import { cloneDefaultAppSettings, defaultAppSettings, normalizeAppSettings, normalizeProjectRelativeDirectory } from "../src/settings";

describe("application settings", () => {
  test("fills missing values from defaults", () => {
    const settings = normalizeAppSettings({ appearance: { theme: "nord" } });

    expect(settings.appearance.theme).toBe("nord");
    expect(settings.appearance.sidebarZoomPercent).toBe(100);
    expect(settings.appearance.logZoomPercent).toBe(100);
    expect(settings.appearance.fileViewerZoomPercent).toBeNull();
    expect(settings.developerMode).toBe(false);
    expect(settings.developerLogs).toEqual(defaultAppSettings.developerLogs);
    expect(settings.editor.codeFont).toBe("Fira Mono");
    expect(settings.editor.unicodeFont).toBe("auto");
    expect(settings.editor.unicodeFonts).toEqual({});
    expect(settings.editor.wordWrap).toBe(defaultAppSettings.editor.wordWrap);
    expect(settings.editor.spellcheck).toBe(true);
    expect(settings.editor.wordCompletion).toBe(true);
    expect(settings.editor.keepMainFilePreview).toBe(true);
    expect(settings.editor.projectPathCompletion).toBe(true);
    expect(settings.editor.fileDropImport).toBe(true);
    expect(settings.editor.fileDropImageDirectory).toBe("");
    expect(settings.editor.fileDropDocumentDirectory).toBe("");
    expect(settings.editor.showZws).toBe(true);
    expect(settings.editor.userDictionary).toEqual([]);
    expect(settings.editor.ignoredWords).toEqual([]);
    expect(settings.editor.formatOnSave).toBe(false);
    expect(settings.preview.renderMode).toBe("on-save");
    expect(settings.preview.quality).toBe("balanced");
    expect(settings.preview.syncDebounceMs).toBe(defaultAppSettings.preview.syncDebounceMs);
    expect(settings.preview.onTypeRateLimitSeconds).toBe(0);
    expect(settings.preview.forwardSyncTimeoutMs).toBe(5000);
    expect(settings.preview.khmerRenderPreparation).toBe(false);
    expect(settings.compatibility.disableWebkitDmabufRenderer).toBe(false);
    expect(settings.fonts.privateDirectories).toEqual([]);
    expect(settings.toolchain.tinymistVersion).toBeNull();
  });

  test("rejects unsupported enums and clamps numeric values", () => {
    const settings = normalizeAppSettings({
      developerMode: true,
      appearance: { theme: "unknown", editorFontSize: 80, editorLineHeight: 0.5, sidebarZoomPercent: 500, logZoomPercent: 1, fileViewerZoomPercent: 999 },
      editor: { tabSize: 3, codeFont: "MiSans Latin", unicodeFont: "unknown-font" },
      preview: {
        renderMode: "sometimes",
        quality: "ultra",
        syncDebounceMs: 1,
        onTypeRateLimitSeconds: -1,
        forwardSyncTimeoutMs: 50000,
        highlightDurationMs: 50000
      },
      toolchain: { tinymistVersion: "0.15.1-rc.1" }
    });

    expect(settings.appearance.theme).toBe("default");
    expect(settings.developerMode).toBe(true);
    expect(settings.appearance.editorFontSize).toBe(32);
    expect(settings.appearance.editorLineHeight).toBe(1.2);
    expect(settings.appearance.sidebarZoomPercent).toBe(200);
    expect(settings.appearance.logZoomPercent).toBe(75);
    expect(settings.appearance.fileViewerZoomPercent).toBe(400);
    expect(settings.editor.tabSize).toBe(2);
    expect(settings.editor.codeFont).toBe("Fira Mono");
    expect(settings.editor.unicodeFont).toBe("unknown-font");
    expect(settings.editor.formatOnSave).toBe(false);
    expect(settings.preview.syncDebounceMs).toBe(50);
    expect(settings.preview.onTypeRateLimitSeconds).toBe(0);
    expect(settings.preview.forwardSyncTimeoutMs).toBe(30000);
    expect(settings.preview.highlightDurationMs).toBe(10000);
    expect(settings.preview.renderMode).toBe("on-save");
    expect(settings.preview.quality).toBe("balanced");
    expect(settings.toolchain.tinymistVersion).toBeNull();
  });

  test("keeps a selected stable Tinymist version", () => {
    expect(normalizeAppSettings({ toolchain: { tinymistVersion: "0.15.2" } }).toolchain.tinymistVersion).toBe("0.15.2");
  });

  test("migrates the former Typst version selection", () => {
    expect(normalizeAppSettings({ toolchain: { typstVersion: "0.14.2" } }).toolchain.tinymistVersion).toBe("0.14.2");
  });

  test("keeps Typsastra green light and dark theme selections", () => {
    expect(normalizeAppSettings({ appearance: { theme: "typsastraLight" } }).appearance.theme).toBe("typsastraLight");
    expect(normalizeAppSettings({ appearance: { theme: "typsastraDark" } }).appearance.theme).toBe("typsastraDark");
  });

  test("keeps independent per-script editor fallbacks", () => {
    const settings = normalizeAppSettings({ editor: {
      unicodeFont: "auto",
      unicodeFonts: { "mi-sans-khmer": "Noto Sans Khmer", "mi-sans-lao": "none" }
    } });
    expect(settings.editor.unicodeFonts).toEqual({
      "mi-sans-khmer": "Noto Sans Khmer",
      "mi-sans-lao": "none"
    });
  });

  test("keeps developer log category selections independently", () => {
    const settings = normalizeAppSettings({
      developerMode: true,
      developerLogs: {
        preview: false,
        inverseSync: true,
        forwardSync: false,
        performance: false,
        memory: true,
        lsp: false,
        spellcheck: false,
        general: true
      }
    });

    expect(settings.developerLogs).toEqual({
      preview: false,
      inverseSync: true,
      forwardSync: false,
      performance: false,
      memory: true,
      lsp: false,
      spellcheck: false,
      general: true
    });
  });

  test("returns independent default objects", () => {
    const first = cloneDefaultAppSettings();
    const second = cloneDefaultAppSettings();
    first.editor.wordWrap = false;
    first.developerMode = true;
    first.developerLogs.memory = false;

    expect(second.editor.wordWrap).toBe(true);
    expect(second.developerMode).toBe(false);
    expect(second.developerLogs.memory).toBe(true);
  });

  test("preserves supported preview render and quality modes", () => {
    expect(normalizeAppSettings({ preview: { renderMode: "on-save" } }).preview.renderMode).toBe("on-save");
    expect(normalizeAppSettings({ preview: { renderMode: "on-type" } }).preview.renderMode).toBe("on-type");
    expect(normalizeAppSettings({ preview: { quality: "memory-saver" } }).preview.quality).toBe("memory-saver");
    expect(normalizeAppSettings({ preview: { quality: "balanced" } }).preview.quality).toBe("balanced");
    expect(normalizeAppSettings({ preview: { quality: "maximum" } }).preview.quality).toBe("maximum");
  });

  test("keeps an optional positive integer on-type preview rate limit", () => {
    expect(normalizeAppSettings({ preview: { onTypeRateLimitSeconds: 7 } }).preview.onTypeRateLimitSeconds).toBe(7);
    expect(normalizeAppSettings({ preview: { onTypeRateLimitSeconds: 1.6 } }).preview.onTypeRateLimitSeconds).toBe(2);
    expect(normalizeAppSettings({ preview: { onTypeRateLimitSeconds: 0 } }).preview.onTypeRateLimitSeconds).toBe(0);
  });

  test("wires the on-type preview rate limit into Settings", async () => {
    const html = await Bun.file(new URL("../index.html", import.meta.url)).text();
    const controller = await Bun.file(new URL("../src/settingsController.ts", import.meta.url)).text();
    expect(html).toContain('id="settings-on-type-rate-limit"');
    expect(html).toContain('placeholder="None"');
    expect(controller).toContain('onChange("settings-on-type-rate-limit"');
    expect(controller).toContain('preview.onTypeRateLimitSeconds === 0 ? ""');
  });

  test("wires all preview quality options into Settings", async () => {
    const html = await Bun.file(new URL("../index.html", import.meta.url)).text();
    const controller = await Bun.file(new URL("../src/settingsController.ts", import.meta.url)).text();
    expect(html).toContain('id="settings-preview-quality"');
    expect(html).toContain('<option value="memory-saver">Memory saver</option>');
    expect(html).toContain('<option value="balanced">Balanced</option>');
    expect(html).toContain('<option value="maximum">Maximum clarity</option>');
    expect(controller).toContain('onChange("settings-preview-quality"');
    expect(controller).toContain('setValue("settings-preview-quality", preview.quality)');
  });

  test("keeps the Linux WebKit DMA-BUF compatibility override", () => {
    expect(normalizeAppSettings({
      compatibility: { disableWebkitDmabufRenderer: true }
    }).compatibility.disableWebkitDmabufRenderer).toBe(true);
  });

  test("normalizes global private font directories without duplicating paths", () => {
    const settings = normalizeAppSettings({
      fonts: {
        privateDirectories: [
          " C:\\Fonts\\Research ",
          "c:\\fonts\\research\\",
          "/home/author/fonts",
          "",
          42
        ]
      }
    });

    expect(settings.fonts.privateDirectories).toEqual([
      "C:\\Fonts\\Research",
      "/home/author/fonts"
    ]);
  });

  test("normalizes and deduplicates personal dictionary words", () => {
    const settings = normalizeAppSettings({
      editor: { wordCompletion: false, userDictionary: [" សាលា ", "សាលា", "", 42] }
    });
    expect(settings.editor.wordCompletion).toBe(false);
    expect(settings.editor.userDictionary).toEqual(["សាលា"]);
  });

  test("normalizes and deduplicates ignored words", () => {
    const settings = normalizeAppSettings({
      editor: { ignoredWords: [" ខ្មេ ", "ខ្មេ", "", 42] }
    });
    expect(settings.editor.ignoredWords).toEqual(["ខ្មេ"]);
  });
  test("normalizes project-relative drop destinations", () => {
    expect(normalizeProjectRelativeDirectory(" ./assets\\images/ ")).toBe("assets/images");
    expect(normalizeProjectRelativeDirectory("documents/pdfs")).toBe("documents/pdfs");
    expect(normalizeProjectRelativeDirectory("../outside")).toBe("");
    expect(normalizeProjectRelativeDirectory("/absolute/path")).toBe("");
    expect(normalizeAppSettings({ editor: {
      keepMainFilePreview: false,
      projectPathCompletion: false,
      fileDropImport: false,
      fileDropImageDirectory: "assets/images",
      fileDropDocumentDirectory: "../outside"
    } }).editor).toMatchObject({
      keepMainFilePreview: false,
      projectPathCompletion: false,
      fileDropImport: false,
      fileDropImageDirectory: "assets/images",
      fileDropDocumentDirectory: ""
    });
  });
});
