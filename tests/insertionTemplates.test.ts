import { describe, expect, test } from "bun:test";
import {
  builtinInsertionTemplates,
  insertRenderedTemplate,
  normalizeInsertionTemplateLayer,
  renderInsertionTemplate,
  resolveInsertionTemplates,
  templateWarnings,
} from "../src/editor/insertionTemplates";
import { structuredDropDocumentEdit } from "../src/editor/structuredDrop";

describe("insertion templates", () => {
  test("layers overrides, disables, orders, and custom templates", () => {
    const global = normalizeInsertionTemplateLayer({
      order: ["figure", "table"],
      disabled: ["table"],
      overrides: { figure: { name: "Smart figure" } },
      custom: [{ id: "custom:note", name: "Note", body: "#note[{{select:text}}]", enabled: true }]
    });
    const project = normalizeInsertionTemplateLayer({ overrides: { figure: { name: "Project figure" } } });
    const resolved = resolveInsertionTemplates(global, project);
    expect(resolved[0].id).toBe("figure");
    expect(resolved[0].name).toBe("Project figure");
    expect(resolved.find(template => template.id === "table")?.enabled).toBe(false);
    expect(resolved.some(template => template.id === "custom:note")).toBe(true);
  });

  test("missing Figure placeholders are warnings, not rendering errors", () => {
    const template = { id: "figure", name: "Figure", body: "#figure[{{select:Caption}}]", enabled: true };
    expect(templateWarnings(template)).toHaveLength(2);
    expect(renderInsertionTemplate(template, { filePath: "./image.png", fileLabel: "image" }).text).toBe("#figure[Caption]");
  });

  test("moves package imports to the prologue and preserves an existing package version", () => {
    const template = { id: "custom:pkg", name: "Package", enabled: true, body: '#import "@preview/cetz:0.3.0": canvas\n#canvas({{select:body}})' };
    const rendered = renderInsertionTemplate(template);
    const existing = '#import "@preview/cetz:0.2.2": canvas\n\nHello';
    const edit = insertRenderedTemplate(existing, existing.length, existing.length, rendered);
    expect(edit.text.match(/@preview\/cetz/g)).toHaveLength(1);
    expect(edit.text).toContain("0.2.2");
    expect(edit.text).toContain("#canvas(body)");
  });

  test("structured multi-file drops use the shared Figure template and select the first caption", () => {
    const figure = builtinInsertionTemplates.find(template => template.id === "figure")!;
    const edit = structuredDropDocumentEdit("Intro\n", 6, figure, [
      { referencePath: "./images/one_2026_08_02.png", finalStem: "one_2026_08_02" },
      { referencePath: "./documents/two_2026_08_02.pdf", finalStem: "two_2026_08_02" }
    ]);
    expect(edit.text).toContain('image("./images/one_2026_08_02.png", width: auto)');
    expect(edit.text).toContain('image("./documents/two_2026_08_02.pdf", width: auto)');
    expect(edit.text.slice(edit.selectionFrom, edit.selectionTo)).toBe("TEMPLATE");
    expect(edit.text).toContain("\n\n#figure(");
  });
  test("uses compact icon-only toolbar buttons and a full-width template body editor", async () => {
    const toolbar = await Bun.file(new URL("../src/editor/toolbarController.ts", import.meta.url)).text();
    const styles = await Bun.file(new URL("../src/style.css", import.meta.url)).text();
    const markup = await Bun.file(new URL("../index.html", import.meta.url)).text();
    expect(toolbar).toContain('button.append(this.templateIcon(template.id))');
    expect(toolbar).toContain('createAppIcon(icons[id] ?? "plus", { size: 14');
    expect(toolbar).not.toContain("label.textContent = template.name");
    expect(styles).toContain(".template-strip-button { width: 32px; min-width: 32px;");
    expect(styles).toContain(".template-strip-icon { width: 14px; height: 14px;");
    expect(markup).not.toContain("toolbar-figure-drop-toggle");
    expect(markup).not.toContain("Figure drops");
    expect(styles).toContain(".settings-template-library .settings-field:has(#settings-template-body) { display: block; width: 100%; }");
    expect(styles).toContain("#settings-template-body { display: block; box-sizing: border-box; width: 100%;");
  });
});
