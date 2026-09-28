import { describe, expect, test } from "bun:test";
import { updateMovedPathReferences } from "../src/editor/movedPathReferences";

describe("moved Typst path references", () => {
  test("updates include, import, image, bibliography, and data paths", () => {
    const source = [
      '#include "./front/title.typ"',
      '#import "./front/helpers.typ": helper',
      '#image("./images/cover.png", alt: "./images/cover.png")',
      '#bibliography(("./refs/main.bib", "./refs/extra.bib"), style: "apa")',
      '#let data = json("./data/people.json")',
    ].join("\n");

    const title = updateMovedPathReferences(
      source,
      "/project/main.typ",
      "/project",
      "/project/front/title.typ",
      "/project/front/title-page.typ",
    );
    expect(title.text).toContain('#include "./front/title-page.typ"');
    expect(title.edits).toHaveLength(1);

    const images = updateMovedPathReferences(
      source,
      "/project/main.typ",
      "/project",
      "/project/images",
      "/project/assets/images",
    );
    expect(images.text).toContain('#image("./assets/images/cover.png", alt: "./images/cover.png")');
    expect(images.edits).toHaveLength(1);

    const bibliography = updateMovedPathReferences(
      source,
      "/project/main.typ",
      "/project",
      "/project/refs",
      "/project/bibliography",
    );
    expect(bibliography.text).toContain('#bibliography(("./bibliography/main.bib", "./bibliography/extra.bib"), style: "apa")');
    expect(bibliography.edits).toHaveLength(2);

    const data = updateMovedPathReferences(
      source,
      "/project/main.typ",
      "/project",
      "/project/data/people.json",
      "/project/data/people-2026.json",
    );
    expect(data.text).toContain('json("./data/people-2026.json")');
    expect(data.edits).toHaveLength(1);
  });

  test("recalculates paths relative to nested referring documents", () => {
    const update = updateMovedPathReferences(
      '#image("../images/plot.png")',
      "/project/chapters/one.typ",
      "/project",
      "/project/images/plot.png",
      "/project/figures/plot.png",
    );
    expect(update.text).toBe('#image("../figures/plot.png")');
  });

  test("keeps references unchanged when source and target move together", () => {
    const update = updateMovedPathReferences(
      '#include "./two.typ"',
      "/project/chapters/one.typ",
      "/project",
      "/project/chapters",
      "/project/content",
    );
    expect(update.text).toBe('#include "./two.typ"');
    expect(update.edits).toHaveLength(0);
  });

  test("preserves project-root paths and ignores comments and unrelated strings", () => {
    const source = [
      '// #image("/images/cover.png")',
      '#let note = "/images/cover.png"',
      '#text("/images/cover.png")',
      '#image("/images/cover.png")',
    ].join("\n");
    const update = updateMovedPathReferences(
      source,
      "/project/main.typ",
      "/project",
      "/project/images/cover.png",
      "/project/assets/cover.png",
    );
    expect(update.text).toBe([
      '// #image("/images/cover.png")',
      '#let note = "/images/cover.png"',
      '#text("/images/cover.png")',
      '#image("/assets/cover.png")',
    ].join("\n"));
    expect(update.edits).toHaveLength(1);
  });

  test("supports Windows project paths while emitting Typst separators", () => {
    const update = updateMovedPathReferences(
      '#include "../front/title.typ"',
      "C:\\Project\\chapters\\one.typ",
      "C:\\Project",
      "C:\\Project\\front\\title.typ",
      "C:\\Project\\matter\\title.typ",
    );
    expect(update.text).toBe('#include "../matter/title.typ"');
  });

  test("updates multiple moved targets and a moved referring folder in one pass", () => {
    const update = updateMovedPathReferences(
      '#include "./two.typ"\n#image("../images/plot.png")',
      "/project/chapters/one.typ",
      "/project",
      [
        { oldPath: "/project/chapters", newPath: "/project/content" },
        { oldPath: "/project/images/plot.png", newPath: "/project/figures/plot.png" },
      ],
    );
    expect(update.text).toBe('#include "./two.typ"\n#image("../figures/plot.png")');
    expect(update.edits).toHaveLength(1);
  });

  test("wires reference offers into internal and externally detected moves", async () => {
    const controller = await Bun.file(new URL("../src/appController.ts", import.meta.url)).text();
    const backend = await Bun.file(new URL("../src-tauri/src/lib.rs", import.meta.url)).text();
    expect(controller).toContain('invoke<string[]>("list_workspace_typst_files"');
    expect(controller).toContain('title: "Update Moved File References?"');
    expect(controller).toContain('if (change.kind === "rename")');
    expect(controller).toContain("offerExternalMovedReferenceUpdates");
    expect(backend).toContain("workspace_files::list_workspace_typst_files");
  });
});
