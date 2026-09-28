import {
  autocompletion,
  CompletionContext,
  snippetCompletion,
  Completion,
  startCompletion
} from "@codemirror/autocomplete";
import type { Text } from "@codemirror/state";
import type { TinymistLspClient } from "../compiler/lsp";
import type { LanguageProviderCapabilities } from "../languageSupport";
import { invoke } from "@tauri-apps/api/core";
import type { CompletionProviderSelection } from "./languageScopes";

type LspPosition = { line: number; character?: number };
type LspRange = { start: LspPosition; end: LspPosition };
type LspTextEdit = {
  newText?: string;
  range?: LspRange;
  insert?: LspRange;
  replace?: LspRange;
};
type LspEditRange = LspRange | { insert: LspRange; replace: LspRange };

type LspCompletionItem = {
  label: string;
  labelDetails?: { description?: string; detail?: string };
  detail?: string;
  documentation?: string | { value?: string };
  kind?: number;
  insertText?: string;
  textEdit?: LspTextEdit;
  insertTextFormat?: number;
  sortText?: string;
  additionalTextEdits?: LspTextEdit[];
};

type LspCompletionResponse = LspCompletionItem[] | {
  items?: LspCompletionItem[];
  itemDefaults?: {
    editRange?: LspEditRange;
    insertTextFormat?: number;
  };
} | null;

export type LanguageCompletionResponse = {
  provider: string;
  from: number;
  to: number;
  options: string[];
};

export type WorkspacePathEntry = {
  path: string;
  isDirectory: boolean;
};

export type TypstPathCompletionKind = "include" | "import" | "image" | "bibliography" | "data";

export type TypstPathCompletionContext = {
  from: number;
  typedPath: string;
  kind: TypstPathCompletionKind;
};

const IMAGE_PATH_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp", "avif", "pdf"]);

function pathExtension(path: string): string {
  const name = path.replace(/\/$/, "").split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function typstPathCompletionContext(
  lineText: string,
  cursorInLine: number,
  lineFrom = 0,
): TypstPathCompletionContext | null {
  const before = lineText.slice(0, Math.max(0, Math.min(cursorInLine, lineText.length)));
  const direct = /#(include|import)\s+(?:"([^"\r\n]*)|((?:\.{1,2}\/|\/)[^\s\])}]*))$/u.exec(before);
  if (direct) {
    const typedPath = direct[2] ?? direct[3] ?? "";
    return {
      from: lineFrom + cursorInLine - typedPath.length,
      typedPath,
      kind: direct[1] === "import" ? "import" : "include",
    };
  }
  const call = /#?(image|bibliography|read|csv|json|yaml|xml)\s*\(\s*"([^"\r\n]*)$/u.exec(before);
  if (!call) return null;
  const typedPath = call[2] ?? "";
  const kind: TypstPathCompletionKind = call[1] === "image"
    ? "image"
    : call[1] === "bibliography"
      ? "bibliography"
      : "data";
  return { from: lineFrom + cursorInLine - typedPath.length, typedPath, kind };
}

export function workspacePathMatchesKind(entry: WorkspacePathEntry, kind: TypstPathCompletionKind): boolean {
  if (entry.isDirectory) return true;
  const extension = pathExtension(entry.path);
  if (kind === "image") return IMAGE_PATH_EXTENSIONS.has(extension);
  if (kind === "import") return extension === "typ";
  if (kind === "include") return extension === "typ" || extension === "pdf";
  if (kind === "bibliography") return ["bib", "yaml", "yml"].includes(extension);
  return true;
}
export function languageCompletionRange(
  runFrom: number,
  runLength: number,
  completion: LanguageCompletionResponse | null
): { from: number; to: number } | null {
  if (!completion || completion.from < 0 || completion.from >= completion.to
    || completion.to !== runLength) return null;
  return { from: runFrom + completion.from, to: runFrom + completion.to };
}

export const languageCompletionValidFor = () => false;

// Keep a Tinymist or fallback Typst completion result alive while the user
// extends the same identifier. Without this, the asynchronous list opened by
// `#` is discarded on the very next character instead of being filtered.
// A dot changes the semantic completion context from a global Typst token to
// member access. Do not let the pre-dot result survive that transition, or
// CodeMirror will keep filtering the old global list (for example `#int`) for
// `#it.` instead of asking Tinymist for `it`'s fields.
export const typstCompletionValidFor = /^#?[\p{L}\p{M}\p{N}_-]*$/u;
export const typstMemberCompletionValidFor = /^[\p{L}\p{M}\p{N}_-]*$/u;

function completionInsertion(item: LspCompletionItem): string {
  return item.textEdit?.newText ?? item.insertText ?? item.label;
}

export function isNamedArgumentCompletion(item: LspCompletionItem): boolean {
  // Tinymist has reported function parameters as both fields and properties
  // across versions. Require both that semantic kind and inserted `name:`
  // syntax: global snippets such as `show: ...` also contain a colon, but are
  // not arguments of the function surrounding the caret.
  return (item.kind === 5 || item.kind === 10)
    && /^\s*[\p{L}_][\p{L}\p{N}_-]*\s*:/u.test(completionInsertion(item));
}

export function isDirectMemberCompletion(item: LspCompletionItem): boolean {
  // Tinymist also returns expression transformations in member completion,
  // such as wrapping a content value with `text`, `block`, or `align`. Those
  // are useful code actions, but they are not members of the receiver. Real
  // methods, element fields, dictionary keys, and module definitions edit
  // only the identifier after the dot.
  return item.kind !== 15
    && (!item.additionalTextEdits || item.additionalTextEdits.length === 0);
}

export function isEmptyTypstFunctionCallAt(
  lineText: string,
  cursor: number
): boolean {
  const boundedCursor = Math.max(0, Math.min(cursor, lineText.length));
  const before = lineText.slice(0, boundedCursor);
  const after = lineText.slice(boundedCursor);
  return /#(?:(?:set|show)\s+)?[\p{L}\p{M}\p{N}_.-]+\($/u.test(before)
    && after.startsWith(")");
}

export function isTypstRuleTargetAt(
  lineText: string,
  cursor: number
): boolean {
  const boundedCursor = Math.max(0, Math.min(cursor, lineText.length));
  return /#(?:set|show)\s+[\p{L}\p{M}\p{N}_.-]*$/u.test(
    lineText.slice(0, boundedCursor)
  );
}

export function isTypstMemberAccessAt(
  lineText: string,
  cursor: number
): boolean {
  const boundedCursor = Math.max(0, Math.min(cursor, lineText.length));
  const before = lineText.slice(0, boundedCursor);
  const memberSuffix = /(?:\.[\p{L}\p{M}\p{N}_-]*)+$/u.exec(before);
  if (!memberSuffix || memberSuffix.index === undefined) return false;

  const hash = before.lastIndexOf("#", memberSuffix.index);
  if (hash < 0) return false;
  const receiver = before.slice(hash + 1, memberSuffix.index);

  // Keep ordinary markup such as `See example.com` out of implicit Typst
  // completion. These forms are expressions that can own fields or methods.
  return /^(?:"(?:\\.|[^"\\])*"|\d+(?:\.\d+)?|[\p{L}_][\p{L}\p{M}\p{N}_-]*|\([^()\r\n]*\)|\[[^\]\r\n]*\])(?:\([^()\r\n]*\))?(?:\.[\p{L}_][\p{L}\p{M}\p{N}_-]*(?:\([^()\r\n]*\))?)*$/u.test(receiver);
}

export function liveTypstMemberCompletionEditOffsets(
  doc: Text,
  cursorPosition: number
): { from: number; to: number } | null {
  const line = doc.lineAt(cursorPosition);
  const cursor = cursorPosition - line.from;
  if (!isTypstMemberAccessAt(line.text, cursor)) return null;
  const suffix = /[\p{L}\p{M}\p{N}_-]*$/u.exec(line.text.slice(0, cursor));
  if (!suffix || suffix.index === undefined) return null;
  return { from: line.from + suffix.index, to: cursorPosition };
}

export function normalizeCallableCompletionSnippet(
  insertion: string,
  kind: number | undefined,
  detail: string | undefined
): { template: string; opensArguments: boolean } {
  const callable = kind === 2
    || kind === 3
    || kind === 4
    || /^\s*\([^)]*\)\s*=>/s.test(detail ?? "");
  if (!callable) return { template: insertion, opensArguments: false };

  // Tinymist's `page` completion is `page()${1:}`, which deliberately puts
  // the cursor after the call. Move that empty stop into the parentheses.
  const trailingStop = /\(\)\$\{\d+:\}(\s*)$/.exec(insertion);
  if (trailingStop && trailingStop.index !== undefined) {
    return {
      template: `${insertion.slice(0, trailingStop.index)}(\${})${trailingStop[1]}`,
      opensArguments: true
    };
  }

  // Some callable entries, notably the primary `figure` item, contain only
  // the function name. Give them the same editable call shape.
  if (/^#?[\p{L}\p{M}\p{N}_.-]+$/u.test(insertion)) {
    return { template: `${insertion}(\${})`, opensArguments: true };
  }

  // Preserve Tinymist's richer snippets, while recognizing an existing empty
  // first argument such as `circle(${1:})`.
  return {
    template: insertion,
    opensArguments: /\(\$\{\d*:\}\)/.test(insertion)
      || /\(\$\{\}\)/.test(insertion)
  };
}

export function completedEmptyCallCaret(
  text: string,
  completionLabel: string,
  searchFrom = 0
): number | null {
  const name = completionLabel
    .replace(/^#/, "")
    .match(/^[\p{L}\p{M}\p{N}_-]+/u)?.[0];
  if (!name) return null;
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const boundedFrom = Math.max(0, Math.min(searchFrom, text.length));
  const match = new RegExp(`#?${escapedName}\\(\\)`, "u").exec(text.slice(boundedFrom));
  return match && match.index !== undefined
    ? boundedFrom + match.index + match[0].length - 1
    : null;
}

/**
 * Tinymist may return global symbols first and append the relevant named
 * arguments after them when explicit completion follows argument whitespace.
 * The appended argument segment restarts sortText at the highest priority.
 * Keep only that segment so globals cannot become the active suggestions.
 */
export function preferContextualArgumentCompletions(
  items: LspCompletionItem[]
): LspCompletionItem[] {
  let contextualStart = -1;
  for (let index = 1; index < items.length; index++) {
    const previous = items[index - 1].sortText;
    const current = items[index].sortText;
    if (previous !== undefined && current !== undefined && current.localeCompare(previous) < 0) {
      contextualStart = index;
    }
  }
  if (contextualStart <= 0) return items;
  const contextual = items.slice(contextualStart);
  return contextual.length > 0 && contextual.every(isNamedArgumentCompletion)
    ? contextual
    : items;
}

function textEditFromDefault(range: LspEditRange | undefined, newText: string): LspTextEdit | undefined {
  if (!range) return undefined;
  if ("start" in range) return { newText, range };
  return { newText, insert: range.insert, replace: range.replace };
}

export function lspCompletionEditOffsets(
  doc: Text,
  textEdit: LspTextEdit | undefined,
  characterOffset: (text: string, character: number) => number
): { from: number; to: number } | null {
  const range = textEdit?.range ?? textEdit?.replace ?? textEdit?.insert;
  if (!range) return null;
  const offset = (position: LspPosition): number => {
    const line = doc.line(Math.max(1, Math.min(position.line + 1, doc.lines)));
    return line.from + characterOffset(line.text, position.character ?? 0);
  };
  const from = offset(range.start);
  const to = offset(range.end);
  return from <= to ? { from, to } : null;
}

function isEscaped(text: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor--) slashes++;
  return slashes % 2 === 1;
}

export function fontCompletionValueStart(doc: Text, cursorPosition: number): number | null {
  const line = doc.lineAt(cursorPosition);
  const cursor = cursorPosition - line.from;
  const quotes: number[] = [];
  for (let index = 0; index < cursor; index++) {
    if (line.text[index] === '"' && !isEscaped(line.text, index)) quotes.push(index);
  }
  if (quotes.length % 2 === 0) return null;
  const openingQuote = quotes[quotes.length - 1];
  return /\bfont\s*:\s*$/.test(line.text.slice(0, openingQuote))
    ? line.from + openingQuote + 1
    : null;
}

export function quotedCompletionEditOffsets(
  doc: Text,
  cursorPosition: number,
  insertion: string
): { from: number; to: number } | null {
  const line = doc.lineAt(cursorPosition);
  const cursor = cursorPosition - line.from;
  const quotes: number[] = [];
  for (let index = 0; index < cursor; index++) {
    if (line.text[index] === '"' && !isEscaped(line.text, index)) quotes.push(index);
  }
  let closing = -1;
  let opening = -1;
  if (quotes.length % 2 === 1) {
    opening = quotes[quotes.length - 1];
    for (let index = cursor; index < line.text.length; index++) {
      if (line.text[index] === '"' && !isEscaped(line.text, index)) {
        closing = index;
        break;
      }
    }
  } else if (quotes.length >= 2 && quotes[quotes.length - 1] === cursor - 1) {
    opening = quotes[quotes.length - 2];
    closing = quotes[quotes.length - 1];
  }
  if (opening < 0) return null;
  const replacesOpeningQuote = insertion.startsWith('"');
  const replacesClosingQuote = insertion.endsWith('"');
  return {
    from: line.from + opening + (replacesOpeningQuote ? 0 : 1),
    to: closing >= 0
      ? line.from + closing + (replacesClosingQuote ? 1 : 0)
      : cursorPosition
  };
}

export function fontCompletionEditOffsets(
  doc: Text,
  cursorPosition: number,
  insertion: string
): { from: number; to: number } | null {
  const edit = quotedCompletionEditOffsets(doc, cursorPosition, insertion);
  if (!edit) return null;
  const openingQuote = doc.sliceString(edit.from, edit.from + 1) === '"'
    ? edit.from
    : edit.from - 1;
  if (openingQuote < 0 || doc.sliceString(openingQuote, openingQuote + 1) !== '"') return null;
  const line = doc.lineAt(openingQuote);
  const beforeQuote = doc.sliceString(line.from, openingQuote);
  return /\bfont\s*:\s*$/.test(beforeQuote) ? edit : null;
}

export function completionEditOffsets(
  doc: Text,
  cursorPosition: number,
  insertion: string,
  textEdit: LspTextEdit | undefined,
  characterOffset: (text: string, character: number) => number
): { from: number; to: number } | null {
  return fontCompletionEditOffsets(doc, cursorPosition, insertion)
    ?? lspCompletionEditOffsets(doc, textEdit, characterOffset)
    ?? quotedCompletionEditOffsets(doc, cursorPosition, insertion);
}

export function contextualCompletionEditOffsets(
  doc: Text,
  cursorPosition: number,
  insertion: string,
  textEdit: LspTextEdit | undefined,
  characterOffset: (text: string, character: number) => number,
  localFrom: number,
  localTo: number,
  preferLocalTokenRange: boolean
): { from: number; to: number } {
  // CodeMirror already tracks the complete live identifier for both
  // `#identifier` and rule targets such as `#set identifier`. Tinymist can
  // return an insertion-only or stale partial edit after an asynchronous
  // refresh, which would otherwise produce `#page()pag` or `#set page()ge`.
  // Keep the server's inserted text, but replace the authoritative local
  // token range. Quoted/font completions opt out because they intentionally
  // replace a wider value range.
  if (preferLocalTokenRange) return { from: localFrom, to: localTo };
  return completionEditOffsets(
    doc,
    cursorPosition,
    insertion,
    textEdit,
    characterOffset
  ) ?? { from: localFrom, to: localTo };
}

export function displayLabelForHashPrefix(label: string, type: string, isHashPrefix: boolean | undefined): string {
  return isHashPrefix
    && !label.startsWith('#')
    && (type === 'function' || type === 'keyword' || type === 'module' || type === 'variable')
    ? `#${label}`
    : label;
}

export function applyTextForHashPrefix(apply: string, type: string, isHashPrefix: boolean | undefined, hasServerEdit: boolean): string {
  if (
    isHashPrefix
    && !hasServerEdit
    && !apply.startsWith('#')
    && (type === 'function' || type === 'keyword' || type === 'module' || type === 'variable')
  ) {
    return `#${apply}`;
  }
  return apply;
}

export const typstSnippets = [
  // Document structure
  snippetCompletion("#set document(title: \"${title}\")\n", { label: "#document", detail: "Document Properties" }),
  snippetCompletion("#set page(margin: ${margin}, paper: \"${paper}\")\n", { label: "#page", detail: "Page setup" }),
  snippetCompletion("#set text(font: \"${font}\", size: ${11pt})\n", { label: "#text", detail: "Text Properties" }),
  snippetCompletion("#set heading(numbering: \"${1.}\")\n", { label: "#heading setup", detail: "Heading Numbering" }),
  snippetCompletion(
    "#block[\n  #set par(\n    justification-limits: (\n      spacing: (min: ${85%}, max: ${115%}),\n      tracking: (min: ${-0.8pt}, max: ${0pt}),\n    ),\n  )\n  ${content}\n]",
    { label: "#par justification limits", detail: "Scoped paragraph justification" }
  ),
  
  // Elements
  snippetCompletion("#align(${center})[\n  ${content}\n]\n", { label: "#align", detail: "Align content" }),
  snippetCompletion("#import \"${pkg}\": *\n", { label: "#import", detail: "Import package" }),
  snippetCompletion("= ${heading}\n", { label: "= Heading 1", detail: "Level 1 Heading" }),
  snippetCompletion("== ${heading}\n", { label: "== Heading 2", detail: "Level 2 Heading" }),
  snippetCompletion("#figure(\n  image(\"${path}\", width: ${80%}),\n  caption: [${caption}],\n)\n", { label: "#figure", detail: "Image Figure" }),
  snippetCompletion("#table(\n  columns: (${columns}),\n  align: ${center},\n  [${A}], [${B}],\n)\n", { label: "#table", detail: "Table" }),
  snippetCompletion("#grid(\n  columns: (${columns}),\n  gutter: ${1em},\n  [${cell 1}], [${cell 2}],\n)\n", { label: "#grid", detail: "Grid layout" }),
  
  // Math & Code
  snippetCompletion("$ ${math} $\n", { label: "math inline", detail: "Inline Math" }),
  snippetCompletion("$ ${math} $\n", { label: "$", detail: "Inline Math" }),
  snippetCompletion("$ \n  ${math} \n$\n", { label: "math block", detail: "Math Block" }),
  snippetCompletion("```${lang}\n${code}\n```\n", { label: "```", detail: "Code Block" }),
  
  // Typography
  snippetCompletion("*${bold}*", { label: "*bold*", detail: "Bold text" }),
  snippetCompletion("_${italic}_", { label: "_italic_", detail: "Italic text" }),
  snippetCompletion("#strong[${bold}]", { label: "#strong", detail: "Strong text" }),
  snippetCompletion("#emph[${italic}]", { label: "#emph", detail: "Emphasized text" }),
  
  // Math common
  snippetCompletion("frac(${num}, ${den})", { label: "frac", detail: "Fraction" }),
  snippetCompletion("sum_(${i=1})^(${n})", { label: "sum", detail: "Summation" }),
  snippetCompletion("integral_(${a})^(${b})", { label: "integral", detail: "Integral" }),
];

export function typstCompletions(context: CompletionContext) {
  const word = context.matchBefore(/[\p{L}\p{M}\p{N}_#=.-]+/u);
  if (!word) {
    if (context.explicit) {
      return {
        from: context.pos,
        options: typstSnippets,
        validFor: typstCompletionValidFor
      };
    }
    return null;
  }
  return {
    from: word.from,
    options: typstSnippets,
    validFor: typstCompletionValidFor
  };
}

export function allowsLanguageWordCompletionOnLine(lineText: string, wordFrom: number): boolean {
  const beforeWord = lineText.slice(0, Math.max(0, Math.min(wordFrom, lineText.length)));
  if (isInsideTypstCodeString(lineText, wordFrom)) return false;
  const lastHash = beforeWord.lastIndexOf("#");
  if (lastHash === -1) return true;
  const lastOpenContent = beforeWord.lastIndexOf("[");
  const lastCloseContent = beforeWord.lastIndexOf("]");
  return Math.max(lastOpenContent, lastCloseContent) > lastHash;
}

function isInsideTypstCodeString(lineText: string, position: number): boolean {
  const before = lineText.slice(0, Math.max(0, Math.min(position, lineText.length)));
  const quotes: number[] = [];
  for (let index = 0; index < before.length; index++) {
    if (before[index] === '"' && !isEscaped(before, index)) quotes.push(index);
  }
  if (quotes.length % 2 === 0) return false;
  const openQuote = quotes[quotes.length - 1];
  if (before.slice(0, openQuote).includes("#")) return true;
  const after = lineText.slice(position);
  const closeQuote = firstUnescapedQuote(after);
  if (closeQuote === null) return false;
  const afterClose = after.slice(closeQuote + 1).trimStart();
  return /^[),:\]]/.test(afterClose);
}

function firstUnescapedQuote(text: string): number | null {
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '"' && !isEscaped(text, index)) return index;
  }
  return null;
}

function getCmCompletionType(kind?: number): string {
  switch (kind) {
    case 1: return "text";
    case 2: return "method";
    case 3: return "function";
    case 4: return "constructor";
    case 5: return "field";
    case 6: return "variable";
    case 7: return "class";
    case 8: return "interface";
    case 9: return "module";
    case 10: return "property";
    case 14: return "keyword";
    default: return "variable";
  }
}

export type ProviderCapabilities = LanguageProviderCapabilities;

export function createTypstAutocomplete(
  getClient: () => TinymistLspClient | undefined,
  getUri: () => string,
  flushLspSync: () => void | Promise<void>,
  languageWordCompletion = true,
  getProviders: () => ProviderCapabilities[] = () => [],
  getLanguageCompletionProvider?: (providers: ProviderCapabilities[]) => CompletionProviderSelection | null,
  getLanguageCompletionGeneration?: () => number,
  onLanguageCompletionPerformance?: (milliseconds: number) => void,
  onTypstCompletionTrace?: (message: string) => void,
  projectPathCompletion = false,
  getWorkspacePaths: () => Promise<WorkspacePathEntry[]> = async () => [],
) {
  return autocompletion({
    override: [
      async (context: CompletionContext) => {
        if (projectPathCompletion && !context.view?.composing && context.state.selection.ranges.length === 1) {
          const line = context.state.doc.lineAt(context.pos);
          const pathContext = typstPathCompletionContext(
            line.text,
            context.pos - line.from,
            line.from,
          );
          if (pathContext) {
            try {
              const documentIdentity = context.state.doc;
              const entries = await getWorkspacePaths();
              if (context.aborted
                || (context.view && (context.view.state.doc !== documentIdentity
                  || context.view.state.selection.main.head !== context.pos))) return null;
              const options = entries
                .filter(entry => workspacePathMatchesKind(entry, pathContext.kind))
                .slice(0, 2_000)
                .map(entry => ({
                  label: entry.path,
                  type: entry.isDirectory ? "folder" : "file",
                  detail: entry.isDirectory ? "Project directory" : "Project file",
                }));
              if (options.length > 0) {
                return {
                  from: pathContext.from,
                  options,
                  validFor: /^[^"\s\])}]*$/u,
                };
              }
            } catch (error) {
              console.warn("Project path completion error", error);
            }
          }
        }

        if (languageWordCompletion && !context.view?.composing && context.state.selection.ranges.length === 1) {
          const languageCompletionStartedAt = performance.now();
          const matches = getProviders()
            .filter(provider => provider.supportsCompletion === true)
            .map(provider => ({
              provider,
              word: context.matchBefore(new RegExp(provider.pattern + "$", "u")),
            }))
            .filter((match): match is { provider: ProviderCapabilities; word: NonNullable<typeof match.word> } =>
              match.word !== null
            );
          const selected = getLanguageCompletionProvider?.(matches.map(match => match.provider)) ?? null;
          const provider = selected?.provider ?? null;
          const match = provider ? matches.find(candidate => candidate.provider.id === provider.id) : null;
          if (selected && provider && match) {
            const line = context.state.doc.lineAt(context.pos);
            // A script provider can match a Typst identifier such as the `p`
            // in `#set p`. In that case, skip only language-word completion
            // and continue below to Tinymist's syntax completion source.
            if (allowsLanguageWordCompletionOnLine(line.text, match.word.from - line.from)) {
              try {
              const documentIdentity = context.state.doc;
              const inputGeneration = selected.generation;
              const completion = await invoke<LanguageCompletionResponse | null>("complete_language_word", {
                request: {
                  provider: provider.id,
                  text: match.word.text,
                  cursorUtf16: match.word.text.length,
                  limit: 10
                }
              });
              onLanguageCompletionPerformance?.(performance.now() - languageCompletionStartedAt);
              if (context.view && (context.view.state.doc !== documentIdentity
                || context.view.state.selection.main.head !== context.pos
                || context.view.composing)) return null;
              if (inputGeneration !== undefined && getLanguageCompletionGeneration?.() !== inputGeneration) return null;
              const replacement = languageCompletionRange(match.word.from, match.word.text.length, completion);
              if (completion && replacement && completion.options.length > 0) {
                return {
                  from: replacement.from,
                  options: completion.options.map(w => ({
                    label: w,
                    type: "text",
                    detail: `${completion.provider} · ${selected.languageTag} (document script)`
                  })),
                  // Results are deliberately bounded and ranked for the current
                  // segmented prefix, so every typed character must query again.
                  validFor: languageCompletionValidFor
                };
              }
              } catch (e) {
                console.warn(`${provider.id} autocomplete error`, e);
              }
            }
          }
        }

        const activeCompletionLine = context.state.doc.lineAt(context.pos);
        const completionColumn = context.pos - activeCompletionLine.from;
        const isMemberAccess = isTypstMemberAccessAt(
          activeCompletionLine.text,
          completionColumn
        );
        const fontValueFrom = fontCompletionValueStart(context.state.doc, context.pos);
        const traceRelevant = context.explicit
          || context.state.doc.lineAt(context.pos).text.includes("#");
        if (traceRelevant) {
          const line = context.state.doc.lineAt(context.pos);
          onTypstCompletionTrace?.(
            `Completion source entered: explicit=${context.explicit}; line=${line.number}; column=${context.pos - line.from}; text=${JSON.stringify(line.text)}.`
          );
        }
        if (!context.explicit) {
          const lineStr = activeCompletionLine.text;
          const col = completionColumn;
          const textBefore = lineStr.slice(0, col);
          const isEmptyFunctionCall = isEmptyTypstFunctionCallAt(lineStr, col);
          
          // Only trigger autocomplete implicitly on word characters or specific trigger characters (#, ., @, -)
          const lastChar = textBefore.slice(-1);
          if (!/[\w#\.@-]/.test(lastChar)
            && !(lastChar === " " && fontValueFrom !== null)
            && !isEmptyFunctionCall) {
            return null;
          }
          
          const isHashWord = /#[\w-]*$/.test(textBefore);
          const isSetShow = /^\s*#(?:set|show)\b/.test(textBefore);
          
          const docBefore = context.state.doc.sliceString(0, context.pos);
          const openBraces = (docBefore.match(/\{/g) || []).length;
          const closeBraces = (docBefore.match(/\}/g) || []).length;
          const inCodeBlock = openBraces > closeBraces;
          
          if (!isHashWord && !isSetShow && !isMemberAccess && !inCodeBlock && !isEmptyFunctionCall) {
            if (traceRelevant) {
              onTypstCompletionTrace?.(
                `Implicit completion rejected by syntax gate: hashWord=${isHashWord}; rule=${isSetShow}; member=${isMemberAccess}; codeBlock=${inCodeBlock}; emptyCall=${isEmptyFunctionCall}.`
              );
            }
            return null;
          }
        }

        const activeLine = activeCompletionLine;
        const isEmptyFunctionCall = isEmptyTypstFunctionCallAt(
          activeLine.text,
          context.pos - activeLine.from
        );
        const isRuleTarget = isTypstRuleTargetAt(
          activeLine.text,
          context.pos - activeLine.from
        );
        const fallbackCompletions = () => isEmptyFunctionCall || isMemberAccess
          ? null
          : typstCompletions(context);

        const client = getClient();
        const uri = getUri();
        if (!client || !uri) return fallbackCompletions();
        
        const doc = context.state.doc;
        const position = client.lspPositionFromEditorPosition(doc, context.pos);
        
        try {
          // Force flush any pending LSP document changes so the server completes
          // against the same text CodeMirror is showing.
          await flushLspSync();
          if (traceRelevant) {
            onTypstCompletionTrace?.(
              `Requesting Tinymist completion: uri=${uri}; line=${position.line}; character=${position.character ?? 0}; aborted=${context.aborted}.`
            );
          }

          const response = await client.request<LspCompletionResponse>("textDocument/completion", {
            textDocument: { uri },
            position,
            context: {
              triggerKind: 1
            }
          });
          
          if (!response) return fallbackCompletions();
          
          const responseItems = Array.isArray(response) ? response : response.items;
          const itemDefaults = Array.isArray(response) ? undefined : response.itemDefaults;
          if (traceRelevant) {
            onTypstCompletionTrace?.(
              `Tinymist completion returned: count=${responseItems?.length ?? 0}; aborted=${context.aborted}; labels=${JSON.stringify(responseItems?.slice(0, 8).map(item => item.label) ?? [])}.`
            );
          }
          if (!responseItems || responseItems.length === 0) return fallbackCompletions();
          const memberItems = isMemberAccess
            ? responseItems.filter(isDirectMemberCompletion)
            : responseItems;
          const items = isEmptyFunctionCall
            ? memberItems.filter(isNamedArgumentCompletion)
            : isRuleTarget
              ? memberItems
              : preferContextualArgumentCompletions(memberItems);
          if (items.length === 0) return null;
          
          // A member completion replaces only the identifier after the final
          // dot. Including the dot makes CodeMirror filter `len` against
          // `.le`, hiding every otherwise valid Tinymist result.
          const word = isMemberAccess
            ? context.matchBefore(/[\p{L}\p{M}\p{N}_-]*/u)
            : context.matchBefore(/#?[\p{L}\p{M}\p{N}_.-]*/u);
          const isHashPrefix = word?.text.startsWith('#');
          const preferLocalTokenRange = fontValueFrom === null
            && Boolean(word?.text);
          
          const options: Completion[] = items.map(item => {
            let label = item.label;
            let detail = item.labelDetails?.description ?? item.labelDetails?.detail ?? item.detail;
            let info = typeof item.documentation === 'string' ? item.documentation : item.documentation?.value;
            const type = getCmCompletionType(item.kind);
            
            // VS Code style: keep detail short, move long text to info
            if (detail && detail.length > 30 && detail.includes(' ')) {
                if (!info) info = detail;
                detail = undefined;
            }
            
            const defaultApply = item.insertText ?? label;
            const textEdit = item.textEdit ?? textEditFromDefault(itemDefaults?.editRange, defaultApply);
            const insertTextFormat = item.insertTextFormat ?? itemDefaults?.insertTextFormat;
            let apply = textEdit?.newText ?? defaultApply;
            
            label = displayLabelForHashPrefix(label, type, isHashPrefix);
            apply = applyTextForHashPrefix(
              apply,
              type,
              isHashPrefix,
              Boolean(textEdit) && !isHashPrefix
            );
            
            const callableSnippet = normalizeCallableCompletionSnippet(
              apply,
              item.kind,
              item.detail ?? item.labelDetails?.description
            );
            if (insertTextFormat === 2 || callableSnippet.opensArguments) {
              const completion = snippetCompletion(callableSnippet.template, {
                label,
                detail,
                info,
                type,
                sortText: item.sortText
              });
              const snippetApply = completion.apply;
              if (typeof snippetApply !== "function") return completion;
              const wrappedCompletion: Completion = {
                ...completion,
                apply(view, selected, from, to) {
                  const edit = (isMemberAccess
                    ? liveTypstMemberCompletionEditOffsets(
                      view.state.doc,
                      view.state.selection.main.head
                    )
                    : null) ?? contextualCompletionEditOffsets(
                    view.state.doc,
                    to,
                    apply,
                    textEdit,
                    (text, character) => client.stringOffsetFromLspCharacter(text, character),
                    from,
                    to,
                    preferLocalTokenRange
                  );
                  snippetApply(view, selected, edit.from, edit.to);
                  if (callableSnippet.opensArguments) {
                    const line = view.state.doc.lineAt(edit.from);
                    const caretInLine = completedEmptyCallCaret(
                      line.text,
                      label,
                      edit.from - line.from
                    );
                    if (caretInLine !== null) {
                      const anchor = line.from + caretInLine;
                      if (view.state.selection.main.anchor !== anchor) {
                        view.dispatch({ selection: { anchor } });
                      }
                      window.setTimeout(() => {
                        view.dispatch({ selection: view.state.selection });
                        startCompletion(view);
                      }, 50);
                    }
                  }
                }
              };
              return wrappedCompletion;
            }

            return {
              label,
              detail,
              info,
              type,
              sortText: item.sortText,
              apply(view, _selected, from, to) {
                const replacement = (isMemberAccess
                  ? liveTypstMemberCompletionEditOffsets(
                    view.state.doc,
                    view.state.selection.main.head
                  )
                  : null) ?? contextualCompletionEditOffsets(
                  view.state.doc,
                  to,
                  apply,
                  textEdit,
                  (text, character) => client.stringOffsetFromLspCharacter(text, character),
                  from,
                  to,
                  preferLocalTokenRange
                );
                view.dispatch({
                  changes: { from: replacement.from, to: replacement.to, insert: apply },
                  selection: { anchor: replacement.from + apply.length },
                  userEvent: "input.complete"
                });
              }
            };
          });
          
          const result = {
            from: fontValueFrom ?? word?.from ?? context.pos,
            options,
            validFor: fontValueFrom !== null
              ? /^[^"\r\n]*$/
              : isMemberAccess
                ? typstMemberCompletionValidFor
                : typstCompletionValidFor
          };
          if (traceRelevant) {
            onTypstCompletionTrace?.(
              `Installing completion result: from=${result.from}; cursor=${context.pos}; options=${options.length}; aborted=${context.aborted}.`
            );
          }
          return result;
          
        } catch (e) {
          console.warn("LSP completion error", e);
          if (traceRelevant) onTypstCompletionTrace?.(`Tinymist completion failed: ${String(e)}.`);
          return fallbackCompletions();
        }
      }
    ]
  });
}
