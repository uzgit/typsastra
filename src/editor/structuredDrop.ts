import {
  insertRenderedTemplate,
  renderInsertionTemplate,
  templateWarnings,
  type InsertionTemplate,
  type TemplateDocumentEdit
} from "./insertionTemplates";

export function structuredDropDocumentEdit(
  documentText: string,
  insertAt: number,
  figureTemplate: InsertionTemplate,
  files: readonly { referencePath: string; finalStem: string }[]
): TemplateDocumentEdit & { warnings: string[] } {
  const renderedFigures = files.map(file => renderInsertionTemplate(figureTemplate, {
    filePath: file.referencePath,
    fileLabel: file.finalStem
  }));
  const first = renderedFigures[0];
  const combined = {
    text: renderedFigures.map(item => item.text).join("\n\n"),
    selectionFrom: first?.selectionFrom ?? 0,
    selectionTo: first?.selectionTo ?? 0,
    imports: renderedFigures.flatMap(item => item.imports),
    warnings: templateWarnings(figureTemplate)
  };
  return { ...insertRenderedTemplate(documentText, insertAt, insertAt, combined), warnings: combined.warnings };
}
