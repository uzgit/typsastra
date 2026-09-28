import { describe, expect, test } from "bun:test";
import { Text } from "@codemirror/state";
import {
  applyTextForHashPrefix,
  allowsLanguageWordCompletionOnLine,
  completionEditOffsets,
  completedEmptyCallCaret,
  contextualCompletionEditOffsets,
  displayLabelForHashPrefix,
  fontCompletionValueStart,
  isEmptyTypstFunctionCallAt,
  isDirectMemberCompletion,
  isNamedArgumentCompletion,
  isTypstMemberAccessAt,
  isTypstRuleTargetAt,
  languageCompletionRange,
  languageCompletionValidFor,
  liveTypstMemberCompletionEditOffsets,
  lspCompletionEditOffsets,
  normalizeCallableCompletionSnippet,
  preferContextualArgumentCompletions,
  quotedCompletionEditOffsets,
  typstPathCompletionContext,
  workspacePathMatchesKind,
  typstMemberCompletionValidFor,
  typstCompletionValidFor
} from "../src/editor/autocomplete";

describe("language word completion context", () => {
  test("mounts editor tooltips above preview overlays", async () => {
    const source = await Bun.file(new URL("../src/editor/extensions.ts", import.meta.url)).text();
    const css = await Bun.file(new URL("../src/style.css", import.meta.url)).text();

    expect(source).toContain("tooltips({ parent: document.body })");
    expect(css).toContain(".cm-tooltip {");
    expect(css).toContain("z-index: 12000 !important");
  });

  test("allows prose and content-block text", () => {
    expect(allowsLanguageWordCompletionOnLine("This paragraph has sch", 19)).toBe(true);
    expect(allowsLanguageWordCompletionOnLine('#figure(image("photo.png"))[The capt', 33)).toBe(true);
  });

  test("blocks Typst syntax and code strings", () => {
    expect(allowsLanguageWordCompletionOnLine('#include "stories/rabbit', 19)).toBe(false);
    expect(allowsLanguageWordCompletionOnLine('#import "templates/chapt', 19)).toBe(false);
    expect(allowsLanguageWordCompletionOnLine('#set text(font: "Fira', 18)).toBe(false);
    expect(allowsLanguageWordCompletionOnLine("#set p", 5)).toBe(false);
    expect(allowsLanguageWordCompletionOnLine("#show h", 6)).toBe(false);
    expect(allowsLanguageWordCompletionOnLine("#let previewRoot = tr", 5)).toBe(false);
  });

  test("continues to Typst LSP completion when syntax rejects a language word", async () => {
    const source = await Bun.file(new URL("../src/editor/autocomplete.ts", import.meta.url)).text();
    expect(source).not.toContain(
      "if (!allowsLanguageWordCompletionOnLine(line.text, match.word.from - line.from)) return null;"
    );
    expect(source).toContain(
      "if (allowsLanguageWordCompletionOnLine(line.text, match.word.from - line.from)) {"
    );
  });
});

describe("LSP autocomplete edits", () => {
  test("keeps hash-triggered completion active while typing an identifier", () => {
    expect(typstCompletionValidFor.test("#")).toBe(true);
    expect(typstCompletionValidFor.test("#i")).toBe(true);
    expect(typstCompletionValidFor.test("#image")).toBe(true);
    expect(typstCompletionValidFor.test("#my-function")).toBe(true);
    expect(typstCompletionValidFor.test("#module")).toBe(true);
    expect(typstCompletionValidFor.test("#module.member")).toBe(false);
    expect(typstCompletionValidFor.test("#រូបភាព")).toBe(true);
    expect(typstCompletionValidFor.test("#image(")).toBe(false);
    expect(typstCompletionValidFor.test("#image ")).toBe(false);
  });

  test("attaches the Typst validity range to LSP and fallback results", async () => {
    const source = await Bun.file(new URL("../src/editor/autocomplete.ts", import.meta.url)).text();
    expect(source).toContain("validFor: typstCompletionValidFor");
    expect(source).toContain(": typstCompletionValidFor");
  });

  test("restarts an explicitly dismissed completion at the same token", async () => {
    const source = await Bun.file(new URL("../src/editor/extensions.ts", import.meta.url)).text();
    expect(source).toContain('event.ctrlKey && !event.altKey && !event.metaKey && event.code === "Space"');
    expect(source).toContain("view.dispatch({ selection: view.state.selection })");
    expect(source).toContain("queueMicrotask(() => startCompletion(view))");
  });

  test("keeps only Tinymist's contextual function arguments after a global fallback", () => {
    const items = [
      { label: "align", kind: 3, sortText: "008", insertText: "align" },
      { label: "array", kind: 9, sortText: "013", insertText: "array" },
      {
        label: "alt",
        kind: 5,
        sortText: "000",
        insertTextFormat: 2,
        textEdit: { newText: "alt: ${1:}", range: undefined }
      },
      {
        label: "fit",
        kind: 5,
        sortText: "001",
        insertTextFormat: 2,
        textEdit: { newText: "fit: ${1:}", range: undefined }
      },
      {
        label: "width",
        kind: 5,
        sortText: "007",
        insertTextFormat: 2,
        textEdit: { newText: "width: ${1:}", range: undefined }
      }
    ];

    expect(preferContextualArgumentCompletions(items).map(item => item.label))
      .toEqual(["alt", "fit", "width"]);
  });

  test("does not treat colon-bearing global snippets as function arguments", () => {
    const items = [
      {
        label: "show rule (everything)",
        kind: 15,
        textEdit: { newText: "show: ${1:}", range: undefined }
      },
      {
        label: "fill",
        kind: 5,
        textEdit: { newText: "fill: ${1:}", range: undefined }
      },
      {
        label: "width",
        kind: 10,
        textEdit: { newText: "width: ${1:}", range: undefined }
      }
    ];

    expect(preferContextualArgumentCompletions(items)).toEqual(items);
    const source = items.filter(isNamedArgumentCompletion);
    expect(source.map(item => item.label)).toEqual(["fill", "width"]);
  });

  test("does not suppress a normal completion list on an unrelated sort restart", () => {
    const items = [
      { label: "alpha", kind: 3, sortText: "100" },
      { label: "beta", kind: 3, sortText: "000" }
    ];

    expect(preferContextualArgumentCompletions(items)).toEqual(items);
  });

  test("preserves Tinymist ranking metadata on snippet completions", async () => {
    const source = await Bun.file(new URL("../src/editor/autocomplete.ts", import.meta.url)).text();
    expect(source).toMatch(
      /snippetCompletion\(callableSnippet\.template,\s*\{[\s\S]*?sortText:\s*item\.sortText[\s\S]*?\}\)/
    );
  });

  test("keeps a font completion range active across spaces", () => {
    const doc = Text.of(['#set text(font: "Khmer OS")']);
    expect(fontCompletionValueStart(doc, 22)).toBe(17);
    expect(fontCompletionValueStart(doc, 25)).toBe(17);
  });

  test("replaces the full quoted font value for a multi-word completion", () => {
    const doc = Text.of(['#set text(font: "Khmer")']);
    const offsets = lspCompletionEditOffsets(
      doc,
      {
        newText: '"Khmer OS Siemreap"',
        range: {
          start: { line: 0, character: 16 },
          end: { line: 0, character: 23 }
        }
      },
      (_text, character) => character
    );

    expect(offsets).toEqual({ from: 16, to: 23 });
    const completed = doc.sliceString(0, offsets!.from)
      + '"Khmer OS Siemreap"'
      + doc.sliceString(offsets!.to);
    expect(completed)
      .toBe('#set text(font: "Khmer OS Siemreap")');
  });

  test("uses the replace range from an LSP insert-replace edit", () => {
    const doc = Text.of(['#set text(font: "Khmer")']);
    const offsets = lspCompletionEditOffsets(
      doc,
      {
        newText: '"Khmer OS"',
        insert: {
          start: { line: 0, character: 17 },
          end: { line: 0, character: 22 }
        },
        replace: {
          start: { line: 0, character: 16 },
          end: { line: 0, character: 23 }
        }
      },
      (_text, character) => character
    );

    expect(offsets).toEqual({ from: 16, to: 23 });
  });

  test("replaces an existing quoted value when the server omits an edit range", () => {
    const closed = Text.of(['#set text(font: "Khmer OS")']);
    expect(quotedCompletionEditOffsets(closed, 25, '"Khmer OS Siemreap"'))
      .toEqual({ from: 16, to: 26 });

    const unfinished = Text.of(['#set text(font: "Khmer OS']);
    expect(quotedCompletionEditOffsets(unfinished, unfinished.length, '"Khmer OS Siemreap"'))
      .toEqual({ from: 16, to: unfinished.length });
  });

  test("preserves the opening quote when Tinymist only supplies a closing quote", () => {
    const doc = Text.of(['#set text(font: "Khmer OS")']);
    const beforeClosingQuote = quotedCompletionEditOffsets(doc, 25, 'Khmer OS Bokor"');
    const afterClosingQuote = quotedCompletionEditOffsets(doc, 26, 'Khmer OS Bokor"');

    expect(beforeClosingQuote).toEqual({ from: 17, to: 26 });
    expect(afterClosingQuote).toEqual({ from: 17, to: 26 });
    const completed = doc.sliceString(0, beforeClosingQuote!.from)
      + 'Khmer OS Bokor"'
      + doc.sliceString(beforeClosingQuote!.to);
    expect(completed).toBe('#set text(font: "Khmer OS Bokor")');
  });

  test("replaces the full font value even when Tinymist targets only the current token", () => {
    const doc = Text.of(['#set text(font: "Khmer OS")']);
    const edit = completionEditOffsets(
      doc,
      25,
      'Khmer OS Bokor"',
      {
        newText: 'Khmer OS Bokor"',
        range: {
          start: { line: 0, character: 23 },
          end: { line: 0, character: 25 }
        }
      },
      (_text, character) => character
    );

    expect(edit).toEqual({ from: 17, to: 26 });
    const completed = doc.sliceString(0, edit!.from)
      + 'Khmer OS Bokor"'
      + doc.sliceString(edit!.to);
    expect(completed).toBe('#set text(font: "Khmer OS Bokor")');
  });

  test("does not prepend an extra hash when Tinymist supplies the edit range", () => {
    expect(displayLabelForHashPrefix("set", "keyword", true)).toBe("#set");
    expect(applyTextForHashPrefix("set", "keyword", true, false)).toBe("#set");
    expect(applyTextForHashPrefix("set", "keyword", true, true)).toBe("set");
  });

  test("replaces the complete local hash token instead of appending to it", () => {
    const doc = Text.of(["#pag"]);
    const replacement = contextualCompletionEditOffsets(
      doc,
      4,
      "#page()",
      {
        newText: "#page()",
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 }
        }
      },
      (_text, character) => character,
      0,
      4,
      true
    );

    expect(replacement).toEqual({ from: 0, to: 4 });
    expect(
      doc.sliceString(0, replacement.from)
      + "#page()"
      + doc.sliceString(replacement.to)
    ).toBe("#page()");
  });

  test("replaces the complete set-rule target instead of retaining a stale suffix", () => {
    const doc = Text.of(["#set page"]);
    const replacement = contextualCompletionEditOffsets(
      doc,
      9,
      "page()",
      {
        newText: "page()",
        range: {
          start: { line: 0, character: 5 },
          end: { line: 0, character: 7 }
        }
      },
      (_text, character) => character,
      5,
      9,
      true
    );

    expect(replacement).toEqual({ from: 5, to: 9 });
    expect(
      doc.sliceString(0, replacement.from)
      + "page()"
      + doc.sliceString(replacement.to)
    ).toBe("#set page()");
  });

  test("places the caret inside an accepted empty function call", () => {
    expect(normalizeCallableCompletionSnippet("#page()${1:}", 3, undefined))
      .toEqual({ template: "#page(${})", opensArguments: true });
    expect(normalizeCallableCompletionSnippet("#figure", 3, undefined))
      .toEqual({ template: "#figure(${})", opensArguments: true });
    expect(normalizeCallableCompletionSnippet("#circle(${1:})", 3, undefined))
      .toEqual({ template: "#circle(${1:})", opensArguments: true });
    expect(normalizeCallableCompletionSnippet("#page(width: 10cm)", 3, undefined))
      .toEqual({ template: "#page(width: 10cm)", opensArguments: false });
    expect(completedEmptyCallCaret("#page()", "#page")).toBe(6);
    expect(completedEmptyCallCaret("before #align() after", "#align")).toBe(14);
  });

  test("recognizes an empty manually typed function argument context", () => {
    expect(isEmptyTypstFunctionCallAt("#page()", 6)).toBe(true);
    expect(isEmptyTypstFunctionCallAt("Text #page() after", 11)).toBe(true);
    expect(isEmptyTypstFunctionCallAt("#set align()", 11)).toBe(true);
    expect(isEmptyTypstFunctionCallAt("#show heading()", 14)).toBe(true);
    expect(isEmptyTypstFunctionCallAt("#page()", 7)).toBe(false);
    expect(isEmptyTypstFunctionCallAt("#page(width: 10cm)", 6)).toBe(false);
  });

  test("keeps set and show target completion separate from argument filtering", () => {
    expect(isTypstRuleTargetAt("#set ", 5)).toBe(true);
    expect(isTypstRuleTargetAt("#set p", 6)).toBe(true);
    expect(isTypstRuleTargetAt("#set page", 9)).toBe(true);
    expect(isTypstRuleTargetAt("#show h", 7)).toBe(true);
    expect(isTypstRuleTargetAt("#set page(", 10)).toBe(false);
    expect(isTypstRuleTargetAt("#show heading:", 14)).toBe(false);
  });

  test("recognizes member completion on hash expressions", () => {
    expect(isTypstMemberAccessAt('#"hello".le', 11)).toBe(true);
    expect(isTypstMemberAccessAt("#value.fi", 9)).toBe(true);
    expect(isTypstMemberAccessAt("#items.at(0).fi", 15)).toBe(true);
    expect(isTypstMemberAccessAt("#(1 + 2).fi", 11)).toBe(true);
    expect(isTypstMemberAccessAt("example.fi", 10)).toBe(false);
    expect(isTypstMemberAccessAt("See #tag and example.fi", 23)).toBe(false);
    expect(typstMemberCompletionValidFor.test("")).toBe(true);
    expect(typstMemberCompletionValidFor.test("le")).toBe(true);
    expect(typstMemberCompletionValidFor.test(".le")).toBe(false);
  });

  test("keeps direct members and removes Tinymist expression transformations", () => {
    expect(isDirectMemberCompletion({ label: "fields", kind: 3 })).toBe(true);
    expect(isDirectMemberCompletion({ label: "depth", kind: 6 })).toBe(true);
    expect(isDirectMemberCompletion({ label: "project-key", kind: 10 })).toBe(true);
    expect(isDirectMemberCompletion({
      label: "align",
      kind: 15,
      additionalTextEdits: [{ newText: "align(" }]
    })).toBe(false);
    expect(isDirectMemberCompletion({
      label: "block",
      kind: 3,
      additionalTextEdits: [{ newText: "block(" }]
    })).toBe(false);
  });

  test("replaces the live member suffix after completion opened on the dot", () => {
    const doc = Text.of(['#"hello".le']);
    const replacement = liveTypstMemberCompletionEditOffsets(doc, doc.length);
    expect(replacement).toEqual({ from: 9, to: 11 });
    expect(
      doc.sliceString(0, replacement!.from)
      + "len()"
      + doc.sliceString(replacement!.to)
    ).toBe('#"hello".len()');

    const bareDot = Text.of(['#"hello".']);
    expect(liveTypstMemberCompletionEditOffsets(bareDot, bareDot.length))
      .toEqual({ from: 9, to: 9 });
  });

  test("activates named argument completion after accepting an empty function call", async () => {
    const source = await Bun.file(new URL("../src/editor/autocomplete.ts", import.meta.url)).text();
    expect(source).toContain("memberItems.filter(isNamedArgumentCompletion)");
    expect(source).toContain("isEmptyFunctionCall");
    expect(source).toContain("? null");
    expect(source).toContain("startCompletion(view)");
  });
});

describe("segmented language completion", () => {
  test("refreshes bounded native results after every typed character", () => {
    expect(languageCompletionValidFor()).toBe(false);
  });

  test("replaces only the final word in an unspaced run", () => {
    expect(languageCompletionRange(10, 12, {
      provider: "khmer-segmenter",
      from: 7,
      to: 12,
      options: ["word"]
    })).toEqual({ from: 17, to: 22 });
  });

  test("rejects a response for a stale run length", () => {
    expect(languageCompletionRange(0, 13, {
      provider: "khmer-segmenter",
      from: 7,
      to: 12,
      options: ["word"]
    })).toBeNull();
  });
});
describe("project path completion", () => {
  test("recognizes quoted and in-progress include paths", () => {
    const unquoted = "#include ./";
    expect(typstPathCompletionContext(unquoted, unquoted.length)).toEqual({
      from: "#include ".length,
      typedPath: "./",
      kind: "include"
    });
    const quoted = '#include "./front_matter/';
    expect(typstPathCompletionContext(quoted, quoted.length)?.typedPath).toBe("./front_matter/");
  });

  test("recognizes image and data-loading strings", () => {
    const image = '#image("./assets/';
    expect(typstPathCompletionContext(image, image.length)?.kind).toBe("image");
    const csv = '#csv("./data/';
    expect(typstPathCompletionContext(csv, csv.length)?.kind).toBe("data");
  });

  test("filters files by Typst expression kind while retaining directories", () => {
    const title = { path: "./front_matter/title_page.typ", isDirectory: false };
    const image = { path: "./images/cover.png", isDirectory: false };
    const directory = { path: "./images/", isDirectory: true };
    expect(workspacePathMatchesKind(title, "include")).toBe(true);
    expect(workspacePathMatchesKind(image, "include")).toBe(false);
    expect(workspacePathMatchesKind(image, "image")).toBe(true);
    expect(workspacePathMatchesKind(directory, "import")).toBe(true);
  });

  test("lets Tab accept an open completion before indentation", async () => {
    const source = await Bun.file(new URL("../src/editor/extensions.ts", import.meta.url)).text();
    expect(source.indexOf('event.key === "Tab"')).toBeLessThan(source.indexOf('event.key === "Enter"'));
    expect(source).toContain("handled = acceptCompletion(view)");
  });
});
