export const themeNames = [
  "default",
  "typsastraLight",
  "typsastraDark",
  "githubLight",
  "githubDark",
  "oneDark",
  "dracula",
  "material",
  "materialLight",
  "nord"
] as const;

export type ThemeName = typeof themeNames[number];
export type PreviewRenderMode = "on-type" | "on-save";
export type { PreviewQualityMode };
export type DeveloperLogCategory =
  | "preview"
  | "inverseSync"
  | "forwardSync"
  | "performance"
  | "memory"
  | "lsp"
  | "spellcheck"
  | "general";

export type DeveloperLogSettings = Record<DeveloperLogCategory, boolean>;
export type TerminologyEntry = { term: string; exactCase: boolean };
export type LanguageTerminologyEntry = TerminologyEntry & { languageFamily: string };
export type ScopedIgnoredWord = { term: string; scope: "global" | "project" | "languageFamily"; languageFamily?: string };

export type AppSettings = {
  version: 2;
  developerMode: boolean;
  developerLogs: DeveloperLogSettings;
  appearance: {
    theme: ThemeName;
    editorFontSize: number;
    editorLineHeight: number;
    sidebarZoomPercent: number;
    logZoomPercent: number;
    fileViewerZoomPercent: number | null;
  };
  editor: {
    codeFont: CodeEditorFontId;
    unicodeFont: UnicodeFontPreference;
    unicodeFonts: Record<string, UnicodeFontPreference>;
    wordWrap: boolean;
    tabSize: 2 | 4 | 8;
    lineNumbers: boolean;
    highlightActiveLine: boolean;
    autoCloseBrackets: boolean;
    indentationGuides: boolean;
    spellcheck: boolean;
    wordCompletion: boolean;
    keepMainFilePreview: boolean;
    projectPathCompletion: boolean;
    fileDropImport: boolean;
    fileDropCreateFigures: boolean;
    fileDropImageDirectory: string;
    fileDropDocumentDirectory: string;
    insertionTemplates: import("./editor/insertionTemplates").InsertionTemplateLayer;
    showZws: boolean;
    userDictionary: string[];
    ignoredWords: string[];
    globalTerminology: TerminologyEntry[];
    languageTerminology: LanguageTerminologyEntry[];
    scopedIgnoredWords: ScopedIgnoredWord[];
    formatOnSave: boolean;
  };
  preview: {
    renderMode: PreviewRenderMode;
    quality: PreviewQualityMode;
    cursorSync: boolean;
    syncDebounceMs: number;
    onTypeRateLimitSeconds: number;
    forwardSyncTimeoutMs: number;
    highlightDurationMs: number;
    khmerRenderPreparation: boolean;
  };
  compatibility: {
    disableWebkitDmabufRenderer: boolean;
  };
  fonts: {
    privateDirectories: string[];
  };
  toolchain: {
    tinymistVersion: string | null;
  };
};

export const defaultAppSettings: AppSettings = {
  version: 2,
  developerMode: false,
  developerLogs: {
    preview: true,
    inverseSync: true,
    forwardSync: true,
    performance: true,
    memory: true,
    lsp: true,
    spellcheck: true,
    general: true
  },
  appearance: {
    theme: "default",
    editorFontSize: 14,
    editorLineHeight: 1.7,
    sidebarZoomPercent: 100,
    logZoomPercent: 100,
    fileViewerZoomPercent: null
  },
  editor: {
    codeFont: "Fira Mono",
    unicodeFont: "auto",
    unicodeFonts: {},
    wordWrap: true,
    tabSize: 2,
    lineNumbers: true,
    highlightActiveLine: true,
    autoCloseBrackets: true,
    indentationGuides: true,
    spellcheck: true,
    wordCompletion: true,
    keepMainFilePreview: true,
    projectPathCompletion: true,
    fileDropImport: true,
    fileDropCreateFigures: false,
    fileDropImageDirectory: "",
    fileDropDocumentDirectory: "",
    insertionTemplates: { order: [], disabled: [], overrides: {}, custom: [] },
    showZws: true,
    userDictionary: [],
    ignoredWords: [],
    globalTerminology: [],
    languageTerminology: [],
    scopedIgnoredWords: [],
    formatOnSave: false
  },
  preview: {
    renderMode: "on-save",
    quality: "balanced",
    // TODO: Re-enable in prerelease v0.9.0 after improving performance and timeout reliability
    // cursorSync: true,
    cursorSync: false,
    syncDebounceMs: 500,
    onTypeRateLimitSeconds: 0,
    forwardSyncTimeoutMs: 5000,
    highlightDurationMs: 2200,
    khmerRenderPreparation: false
  },
  compatibility: {
    disableWebkitDmabufRenderer: false
  },
  fonts: {
    privateDirectories: []
  },
  toolchain: {
    tinymistVersion: null
  }
};

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function optionalPositiveInteger(value: unknown, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.round(value), Math.floor(Number.MAX_SAFE_INTEGER / 1_000));
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function previewRenderMode(value: unknown): PreviewRenderMode {
  return value === "on-type" ? "on-type" : "on-save";
}

function terminologyEntries(value: unknown, limit = 2_000): TerminologyEntry[] {
  if (!Array.isArray(value)) return [];
  const entries = new Map<string, TerminologyEntry>();
  for (const item of value.slice(0, limit)) {
    const record = objectValue(item);
    const term = typeof record.term === "string" ? record.term.trim() : "";
    if (!term || term.length > 128 || /[\r\n\0]/.test(term)) continue;
    const exactCase = record.exactCase !== false;
    entries.set(`${exactCase ? "exact" : "fold"}:${term}`, { term, exactCase });
  }
  return [...entries.values()];
}

function languageTerminologyEntries(value: unknown): LanguageTerminologyEntry[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 2_000).flatMap((item) => {
    const record = objectValue(item);
    const term = terminologyEntries([record], 1)[0];
    const languageFamily = typeof record.languageFamily === "string"
      && /^[a-z]{2,3}$/i.test(record.languageFamily)
      ? record.languageFamily.toLowerCase()
      : null;
    return term && languageFamily ? [{ ...term, languageFamily }] : [];
  });
}

function scopedIgnoredEntries(value: unknown): ScopedIgnoredWord[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 2_000).flatMap((item) => {
    const record = objectValue(item);
    const term = typeof record.term === "string" ? record.term.trim() : "";
    const scope = record.scope;
    if (!term || term.length > 128 || /[\r\n\0]/.test(term)
      || (scope !== "global" && scope !== "project" && scope !== "languageFamily")) return [];
    const languageFamily = scope === "languageFamily" && typeof record.languageFamily === "string"
      && /^[a-z]{2,3}$/i.test(record.languageFamily)
      ? record.languageFamily.toLowerCase()
      : undefined;
    if (scope === "languageFamily" && !languageFamily) return [];
    return [{ term, scope, languageFamily }];
  });
}

function unicodeFontPreferences(value: unknown): Record<string, UnicodeFontPreference> {
  const preferences = objectValue(value);
  return Object.fromEntries(Object.entries(preferences)
    .filter(([id]) => /^[a-z0-9-]+$/.test(id))
    .map(([id, preference]) => [id, normalizeUnicodeFontPreference(preference)]));
}

function privateFontDirectories(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const directories: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const path = item.trim();
    if (!path || path.length > 32_768 || /[\r\n\0]/.test(path)) continue;
    const key = path.replace(/[\\/]+$/, "").toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    directories.push(path);
  }
  return directories.slice(0, 32);
}

export function normalizeProjectRelativeDirectory(value: unknown): string {
  if (typeof value !== "string") return "";
  const normalized = value.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (!normalized) return "";
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) return "";
  const components = normalized.split("/").filter(component => component.length > 0 && component !== ".");
  if (components.some(component => component === ".." || component.includes("\0"))) return "";
  return components.join("/");
}

export function normalizeAppSettings(value: unknown): AppSettings {
  const root = objectValue(value);
  const appearance = objectValue(root.appearance);
  const editor = objectValue(root.editor);
  const preview = objectValue(root.preview);
  const compatibility = objectValue(root.compatibility);
  const fonts = objectValue(root.fonts);
  const developerLogs = objectValue(root.developerLogs);
  const toolchain = objectValue(root.toolchain);
  const theme = themeNames.includes(appearance.theme as ThemeName)
    ? appearance.theme as ThemeName
    : defaultAppSettings.appearance.theme;
  const tabSize = [2, 4, 8].includes(editor.tabSize as number)
    ? editor.tabSize as 2 | 4 | 8
    : defaultAppSettings.editor.tabSize;

  return {
    version: 2,
    developerMode: booleanValue(root.developerMode, defaultAppSettings.developerMode),
    developerLogs: {
      preview: booleanValue(developerLogs.preview, defaultAppSettings.developerLogs.preview),
      inverseSync: booleanValue(developerLogs.inverseSync, defaultAppSettings.developerLogs.inverseSync),
      forwardSync: booleanValue(developerLogs.forwardSync, defaultAppSettings.developerLogs.forwardSync),
      performance: booleanValue(developerLogs.performance, defaultAppSettings.developerLogs.performance),
      memory: booleanValue(developerLogs.memory, defaultAppSettings.developerLogs.memory),
      lsp: booleanValue(developerLogs.lsp, defaultAppSettings.developerLogs.lsp),
      spellcheck: booleanValue(developerLogs.spellcheck, defaultAppSettings.developerLogs.spellcheck),
      general: booleanValue(developerLogs.general, defaultAppSettings.developerLogs.general)
    },
    appearance: {
      theme,
      editorFontSize: boundedNumber(appearance.editorFontSize, defaultAppSettings.appearance.editorFontSize, 10, 32),
      editorLineHeight: boundedNumber(appearance.editorLineHeight, defaultAppSettings.appearance.editorLineHeight, 1.2, 2.4),
      sidebarZoomPercent: Math.round(boundedNumber(appearance.sidebarZoomPercent, defaultAppSettings.appearance.sidebarZoomPercent, 75, 200)),
      logZoomPercent: Math.round(boundedNumber(appearance.logZoomPercent, defaultAppSettings.appearance.logZoomPercent, 75, 200)),
      fileViewerZoomPercent: appearance.fileViewerZoomPercent === null || appearance.fileViewerZoomPercent === undefined
        ? null
        : Math.round(boundedNumber(appearance.fileViewerZoomPercent, 100, 10, 400))
    },
    editor: {
      codeFont: normalizeCodeEditorFont(editor.codeFont),
      unicodeFont: normalizeUnicodeFontPreference(editor.unicodeFont),
      unicodeFonts: unicodeFontPreferences(editor.unicodeFonts),
      wordWrap: booleanValue(editor.wordWrap, defaultAppSettings.editor.wordWrap),
      tabSize,
      lineNumbers: booleanValue(editor.lineNumbers, defaultAppSettings.editor.lineNumbers),
      highlightActiveLine: booleanValue(editor.highlightActiveLine, defaultAppSettings.editor.highlightActiveLine),
      autoCloseBrackets: booleanValue(editor.autoCloseBrackets, defaultAppSettings.editor.autoCloseBrackets),
      indentationGuides: booleanValue(editor.indentationGuides, defaultAppSettings.editor.indentationGuides),
      spellcheck: booleanValue(editor.spellcheck, defaultAppSettings.editor.spellcheck),
      wordCompletion: booleanValue(editor.wordCompletion, defaultAppSettings.editor.wordCompletion),
      keepMainFilePreview: booleanValue(editor.keepMainFilePreview, defaultAppSettings.editor.keepMainFilePreview),
      projectPathCompletion: booleanValue(editor.projectPathCompletion, defaultAppSettings.editor.projectPathCompletion),
      fileDropImport: booleanValue(editor.fileDropImport, defaultAppSettings.editor.fileDropImport),
      fileDropCreateFigures: booleanValue(editor.fileDropCreateFigures, defaultAppSettings.editor.fileDropCreateFigures),
      fileDropImageDirectory: normalizeProjectRelativeDirectory(editor.fileDropImageDirectory),
      fileDropDocumentDirectory: normalizeProjectRelativeDirectory(editor.fileDropDocumentDirectory),
      insertionTemplates: normalizeInsertionTemplateLayer(editor.insertionTemplates),
      showZws: booleanValue(editor.showZws, defaultAppSettings.editor.showZws),
      userDictionary: Array.isArray(editor.userDictionary)
        ? [...new Set(editor.userDictionary.filter((word): word is string => typeof word === "string" && word.trim().length > 0).map(word => word.trim()))].sort()
        : [],
      ignoredWords: Array.isArray(editor.ignoredWords)
        ? [...new Set(editor.ignoredWords.filter((word): word is string => typeof word === "string" && word.trim().length > 0).map(word => word.trim()))].sort()
        : [],
      globalTerminology: terminologyEntries(editor.globalTerminology),
      languageTerminology: languageTerminologyEntries(editor.languageTerminology),
      scopedIgnoredWords: scopedIgnoredEntries(editor.scopedIgnoredWords),
      formatOnSave: booleanValue(editor.formatOnSave, defaultAppSettings.editor.formatOnSave)
    },
    preview: {
      renderMode: previewRenderMode(preview.renderMode),
      quality: normalizePreviewQualityMode(preview.quality),
      cursorSync: booleanValue(preview.cursorSync, defaultAppSettings.preview.cursorSync),
      syncDebounceMs: Math.round(boundedNumber(preview.syncDebounceMs, defaultAppSettings.preview.syncDebounceMs, 50, 2000)),
      onTypeRateLimitSeconds: optionalPositiveInteger(
        preview.onTypeRateLimitSeconds,
        defaultAppSettings.preview.onTypeRateLimitSeconds
      ),
      forwardSyncTimeoutMs: Math.round(boundedNumber(
        preview.forwardSyncTimeoutMs,
        defaultAppSettings.preview.forwardSyncTimeoutMs,
        1000,
        30000
      )),
      highlightDurationMs: Math.round(boundedNumber(preview.highlightDurationMs, defaultAppSettings.preview.highlightDurationMs, 500, 10000)),
      khmerRenderPreparation: booleanValue(preview.khmerRenderPreparation, defaultAppSettings.preview.khmerRenderPreparation)
    },
    compatibility: {
      disableWebkitDmabufRenderer: booleanValue(
        compatibility.disableWebkitDmabufRenderer,
        defaultAppSettings.compatibility.disableWebkitDmabufRenderer
      )
    },
    fonts: {
      privateDirectories: privateFontDirectories(fonts.privateDirectories)
    },
    toolchain: {
      tinymistVersion: typeof toolchain.tinymistVersion === "string" && /^\d+\.\d+\.\d+$/.test(toolchain.tinymistVersion)
        ? toolchain.tinymistVersion
        : typeof toolchain.typstVersion === "string" && /^\d+\.\d+\.\d+$/.test(toolchain.typstVersion)
          ? toolchain.typstVersion
        : null
    }
  };
}

export function cloneDefaultAppSettings(): AppSettings {
  return normalizeAppSettings(defaultAppSettings);
}
import {
  normalizeCodeEditorFont,
  normalizeUnicodeFontPreference,
  type CodeEditorFontId,
  type UnicodeFontPreference
} from "./editor/fontCatalog";
import { normalizeInsertionTemplateLayer } from "./editor/insertionTemplates";
import {
  normalizePreviewQualityMode,
  type PreviewQualityMode
} from "./preview/renderQuality";
