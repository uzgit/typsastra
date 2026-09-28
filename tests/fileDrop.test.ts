import { describe, expect, test } from "bun:test";
import {
  droppedFileKind,
  escapeTypstPath,
  typstDroppedFileInsertion,
  typstDroppedFilesInsertion,
} from "../src/editor/fileDrop";

describe("editor file drop", () => {
  test("accepts supported images and PDF documents", () => {
    expect(droppedFileKind("cover.PNG")).toBe("image");
    expect(droppedFileKind("diagram.svg")).toBe("image");
    expect(droppedFileKind("appendix.pdf")).toBe("document");
    expect(droppedFileKind("notes.txt")).toBeNull();
  });

  test("builds the requested Typst image and include expressions", () => {
    expect(typstDroppedFileInsertion("./images/cover.png", "image"))
      .toBe('#image("./images/cover.png")');
    expect(typstDroppedFileInsertion("./documents/appendix.pdf", "document"))
      .toBe('#include "./documents/appendix.pdf"');
    expect(typstDroppedFilesInsertion([
      { referencePath: "./a.png", kind: "image" },
      { referencePath: "./b.pdf", kind: "document" },
    ])).toBe('#image("./a.png")\n#include "./b.pdf"');
  });

  test("normalizes separators and escapes quotes in Typst paths", () => {
    expect(escapeTypstPath('.\\images\\a"b.png')).toBe('./images/a\\"b.png');
    expect(escapeTypstPath("./images/a\nb.png")).toBe("./images/a\\nb.png");
  });
});
