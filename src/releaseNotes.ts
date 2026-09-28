export type ReleaseSummary = {
  version: string;
  title: string;
  highlights: readonly string[];
  detailsUrl: string;
};

const releaseSummaries: Record<string, ReleaseSummary> = {
  "0.6.2": {
    version: "0.6.2",
    title: "Safer project editing and configurable previews",
    highlights: [
      "External file revisions are accepted into editor history, while dirty buffers are recovered after an interrupted session.",
      "On-type preview updates can be rate-limited, and preview canvas quality can be tuned for memory use or maximum clarity.",
      "Project path completion, structured file drops, insertion templates, and moved-reference updates streamline multi-file work.",
      "Image and PDF viewing, Draft Preview dependency handling, and workspace file operations are more robust."
    ],
    detailsUrl: "https://github.com/Sovichea/typsastra/releases/tag/v0.6.2"
  },
  "0.6.1": {
    version: "0.6.1",
    title: "Lower-memory PDF loading",
    highlights: [
      "Progressive PDF range loading avoids transferring an entire large PDF into the WebView before preview can begin.",
      "Large release-build previews use substantially less peak memory while retaining responsive settled-page rendering.",
      "Immutable preview generations prevent Windows file-lock failures when switching between Normal and Draft modes.",
      "Typsastra v0.6.1 otherwise retains the complete v0.6.0 feature set and project compatibility."
    ],
    detailsUrl: "https://github.com/Sovichea/typsastra/releases/tag/v0.6.1"
  },
  "0.6.0": {
    version: "0.6.0",
    title: "Draft Preview and private font workflows",
    highlights: [
      "Draft Preview replaces supported images with layout-preserving placeholders and cached hover thumbnails for responsive image-heavy authoring.",
      "Private local font directories make uninstalled fonts available to typography, diagnostics, preview, source mapping, and PDF export without copying fonts into projects.",
      "Preview navigation retains scroll position, exposes clickable links, and recovers source synchronization more reliably across cache and workspace changes.",
      "Contextual completion, persistent compiler diagnostics, safer project guardrails, and refined editor interaction improve everyday document work."
    ],
    detailsUrl: "https://github.com/Sovichea/typsastra/releases/tag/v0.6.0"
  },
  "0.5.3": {
    version: "0.5.3",
    title: "Reliable previews and safer image-heavy workflows",
    highlights: [
      "File-backed PDF transport and cache-confined artifacts reduce preview memory pressure and protect workspace files.",
      "Source synchronization now recovers more reliably after external edits, cache migration, and system resume.",
      "Large direct PDFs require confirmation and remain visually and behaviorally distinct from live Typst previews.",
      "Image-heavy documents receive non-blocking, navigable optimization guidance without changing source assets."
    ],
    detailsUrl: "https://github.com/Sovichea/typsastra/releases/tag/v0.5.3"
  },
  "0.5.2": {
    version: "0.5.2",
    title: "Responsive previews and safer editing workflows",
    highlights: [
      "Debounced PDF render-on-type is available again for responsive short-document editing.",
      "Contextual quotation editing, clearer wrapped indentation, and Khmer caret fixes improve everyday authoring.",
      "Save As, file duplication, dependency-aware preview guards, and lifecycle fixes make projects safer to manage.",
      "Updates can be staged until restart, while WebView storage monitoring surfaces unusual profile growth."
    ],
    detailsUrl: "https://github.com/Sovichea/typsastra/releases/tag/v0.5.2"
  },
  "0.5.1": {
    version: "0.5.1",
    title: "Examples, multilingual tools, and safer typography",
    highlights: [
      "A versioned, guided examples workspace with task-oriented tutorials.",
      "Script-specific font assignments with drag ordering, Unicode coverage, and independent fine scaling.",
      "Deterministic document-script spellcheck and word completion.",
      "A private global scaled-font cache that is reused across projects and never exported."
    ],
    detailsUrl: "https://github.com/Sovichea/typsastra/releases/tag/v0.5.1"
  }
};

export function releaseSummaryForVersion(version: string): ReleaseSummary | null {
  return releaseSummaries[version] ?? null;
}

export function shouldShowReleaseSummary(version: string, lastSeenVersion: string | null): boolean {
  return releaseSummaryForVersion(version) !== null && lastSeenVersion !== version;
}
