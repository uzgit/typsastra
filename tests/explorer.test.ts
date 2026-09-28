import { describe, expect, test } from "bun:test";
import { inlineCreationPlacement, isHiddenWorkspaceEntry, sortFileNodes, topLevelExplorerSelections, workspaceParentDirectories, workspacePathSetContains, type FileNode } from "../src/components/explorer";
import { duplicateFileName, explorerKeyboardAction, isMainFileCandidate } from "../src/components/contextMenuController";

describe("workspace explorer", () => {
  test("sorts folders before files without mutating the source list", () => {
    const nodes: FileNode[] = [
      { name: "z.typ", path: "/z.typ", isDirectory: false },
      { name: "assets", path: "/assets", isDirectory: true },
      { name: "a.typ", path: "/a.typ", isDirectory: false }
    ];

    expect(sortFileNodes(nodes).map(node => node.name)).toEqual(["assets", "a.typ", "z.typ"]);
    expect(nodes.map(node => node.name)).toEqual(["z.typ", "assets", "a.typ"]);
  });

  test("maps standard explorer file-operation shortcuts", () => {
    const event = (key: string, modifiers: Partial<KeyboardEvent> = {}) => ({
      key,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      ...modifiers
    }) as KeyboardEvent;

    expect(explorerKeyboardAction(event("c", { ctrlKey: true }))).toBe("copy");
    expect(explorerKeyboardAction(event("V", { ctrlKey: true }))).toBe("paste");
    expect(explorerKeyboardAction(event("Delete"))).toBe("delete");
    expect(explorerKeyboardAction(event("F2"))).toBe("rename");
    expect(explorerKeyboardAction(event("c"))).toBeNull();
    expect(explorerKeyboardAction(event("Delete", { shiftKey: true }))).toBeNull();
    expect(explorerKeyboardAction(event("F2", { ctrlKey: true }))).toBeNull();
  });

  test("matches expanded Windows directories across slash styles", () => {
    const expanded = new Set(["C:/Research/chapters", "//server/share/figures", "/home/writer/book"]);
    expect(workspacePathSetContains(expanded, "C:\\Research\\chapters")).toBe(true);
    expect(workspacePathSetContains(expanded, "c:\\research\\CHAPTERS")).toBe(true);
    expect(workspacePathSetContains(expanded, "\\\\server\\share\\figures")).toBe(true);
    expect(workspacePathSetContains(expanded, "/home/writer/book")).toBe(true);
    expect(workspacePathSetContains(expanded, "/HOME/writer/book")).toBe(false);
    expect(workspacePathSetContains(expanded, "C:\\Research\\figures")).toBe(false);
  });

  test("derives reveal parents portably", () => {
    expect(workspaceParentDirectories("C:\\Research", "C:/Research/chapters/one/main.typ"))
      .toEqual(["C:/Research/chapters/one", "C:/Research/chapters"]);
    expect(workspaceParentDirectories("/home/writer/book", "/home/writer/book/chapters/main.typ"))
      .toEqual(["/home/writer/book/chapters"]);
    expect(workspaceParentDirectories("//server/share", "\\\\server\\share\\book\\main.typ"))
      .toEqual(["//server/share/book"]);
    expect(workspaceParentDirectories("/home/writer/book", "/outside/main.typ")).toEqual([]);
  });

  test("places inline creation beside files and inside directories", () => {
    expect(inlineCreationPlacement(false, 32)).toEqual({ nestUnderTarget: false, depth: 2 });
    expect(inlineCreationPlacement(true, 32)).toEqual({ nestUnderTarget: true, depth: 3 });
    expect(inlineCreationPlacement(false, 8)).toEqual({ nestUnderTarget: false, depth: 0 });
  });

  test("hides dot directories without hiding dot files", () => {
    expect(isHiddenWorkspaceEntry(".typsastra", true)).toBe(true);
    expect(isHiddenWorkspaceEntry(".typstella", true)).toBe(true);
    expect(isHiddenWorkspaceEntry(".vscode", true)).toBe(true);
    expect(isHiddenWorkspaceEntry(".nested-tools", true)).toBe(true);
    expect(isHiddenWorkspaceEntry(".gitignore", false)).toBe(false);
    expect(isHiddenWorkspaceEntry(".DS_Store", false)).toBe(false);
    expect(isHiddenWorkspaceEntry("assets", true)).toBe(false);
    expect(isHiddenWorkspaceEntry("chapter.typ", false)).toBe(false);
  });

  test("offers main-file actions only for Typst files", async () => {
    expect(isMainFileCandidate("C:\\Research\\MAIN.TYP")).toBe(true);
    expect(isMainFileCandidate("/research/notes.typ")).toBe(true);
    expect(isMainFileCandidate("/research/output.pdf")).toBe(false);
    expect(isMainFileCandidate("/research/notes.typ", true)).toBe(false);

    const source = await Bun.file(new URL("../src/components/contextMenuController.ts", import.meta.url)).text();
    expect(source).toContain("const mainAction = single ? this.mainFileItem() :");
    expect(source).toContain("this.explorerSelections().length");
  });

  test("gives explorer and tab targets precedence over text selected elsewhere", async () => {
    const source = await Bun.file(new URL("../src/components/contextMenuController.ts", import.meta.url)).text();
    const handler = source.indexOf("private async showForTarget");
    const explorerTarget = source.indexOf('target.closest<HTMLElement>(".explorer-item-target")', handler);
    const tabTarget = source.indexOf('target.closest<HTMLElement>(".editor-tab")', handler);
    const browserSelection = source.indexOf("const selection = window.getSelection()", handler);

    expect(handler).toBeGreaterThan(-1);
    expect(explorerTarget).toBeGreaterThan(handler);
    expect(tabTarget).toBeGreaterThan(explorerTarget);
    expect(browserSelection).toBeGreaterThan(tabTarget);
  });

  test("prunes descendants from multi-item filesystem operations", () => {
    expect(topLevelExplorerSelections([
      { path: "/project/chapters", isDirectory: true },
      { path: "/project/chapters/one.typ", isDirectory: false },
      { path: "/project/images/cover.png", isDirectory: false },
    ])).toEqual([
      { path: "/project/chapters", isDirectory: true },
      { path: "/project/images/cover.png", isDirectory: false },
    ]);
  });

  test("derives editable duplicate names without losing extensions", () => {
    expect(duplicateFileName("chapter.typ")).toBe("chapter copy.typ");
    expect(duplicateFileName("archive.tar.gz")).toBe("archive.tar copy.gz");
    expect(duplicateFileName("README")).toBe("README copy");
    expect(duplicateFileName(".gitignore")).toBe(".gitignore copy");
  });
});
