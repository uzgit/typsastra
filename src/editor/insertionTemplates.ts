export type InsertionTemplate = {
  id: string;
  name: string;
  body: string;
  enabled: boolean;
  builtin?: boolean;
};

export type InsertionTemplateOverride = {
  name?: string;
  body?: string;
  enabled?: boolean;
};

export type InsertionTemplateLayer = {
  order: string[];
  disabled: string[];
  overrides: Record<string, InsertionTemplateOverride>;
  custom: InsertionTemplate[];
};

export const emptyInsertionTemplateLayer = (): InsertionTemplateLayer => ({
  order: [], disabled: [], overrides: {}, custom: []
});

export const builtinInsertionTemplates: readonly InsertionTemplate[] = [
  {
    id: "table", name: "Table", enabled: true, builtin: true,
    body: `#table(
  columns: 3,
  // rows: auto,
  // align: left,
  // inset: 5pt,
  // fill: none,
  // stroke: 1pt,
  table.header([Header 1], [Header 2], [Header 3]),
  [{{select:Cell 1}}], [Cell 2], [Cell 3],
)`
  },
  {
    id: "figure", name: "Figure", enabled: true, builtin: true,
    body: `#figure(
  image("{{filePath}}", width: auto),
  // placement: auto,
  // scope: "column",
  // numbering: "1",
  // outlined: true,
  caption: [{{select:TEMPLATE}}],
) <figure:{{fileLabel}}>`
  },
  {
    id: "raw-code", name: "Raw code", enabled: true, builtin: true,
    body: "```typ\n{{select:code}}\n```"
  },
  {
    id: "quote", name: "Quote", enabled: true, builtin: true,
    body: `#quote(
  block: true,
  // quotes: true,
  // attribution: [Author],
)[
  {{select:Quote}}
]`
  },
  {
    id: "grid", name: "Grid", enabled: true, builtin: true,
    body: `#grid(
  columns: 2,
  // rows: auto,
  // gutter: 1em,
  // align: left,
  // inset: 0pt,
  // fill: none,
  // stroke: none,
  [{{select:First}}], [Second],
)`
  },
  {
    id: "columns", name: "Columns", enabled: true, builtin: true,
    body: `#columns(
  2,
  // gutter: 1em,
)[
  {{select:Content}}
]`
  },
  {
    id: "equation", name: "Equation", enabled: true, builtin: true,
    body: `#figure(
  $ {{select:x = y}} $,
  // numbering: "(1)",
  // supplement: [Equation],
  // alt: [Equation description],
)`
  },
  {
    id: "bibliography", name: "Bibliography", enabled: true, builtin: true,
    body: `#bibliography(
  "{{select:refs.bib}}",
  // title: [Bibliography],
  // style: "ieee",
  // full: false,
)`
  },
  {
    id: "outline", name: "Outline", enabled: true, builtin: true,
    body: `#outline(
  // title: [Contents],
  // target: heading,
  // depth: auto,
  // indent: auto,
){{cursor}}`
  },
  {
    id: "page-break", name: "Page break", enabled: true, builtin: true,
    body: `#pagebreak(
  // weak: false,
  // to: "odd",
){{cursor}}`
  },
  { id: "footnote", name: "Footnote", enabled: true, builtin: true, body: "#footnote[{{select:Note}}]" },
  { id: "label", name: "Label", enabled: true, builtin: true, body: "<{{select:label}}>" },
  { id: "reference", name: "Reference", enabled: true, builtin: true, body: "@{{select:label}}" }
] as const;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function safeId(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) ? value : null;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap(item => safeId(item) ?? []))];
}

export function normalizeInsertionTemplateLayer(value: unknown): InsertionTemplateLayer {
  const source = record(value);
  const overrides = Object.fromEntries(Object.entries(record(source.overrides)).flatMap(([id, item]) => {
    if (!safeId(id)) return [];
    const candidate = record(item);
    const normalized: InsertionTemplateOverride = {};
    if (typeof candidate.name === "string" && candidate.name.trim()) normalized.name = candidate.name.trim().slice(0, 100);
    if (typeof candidate.body === "string") normalized.body = candidate.body.slice(0, 100_000);
    if (typeof candidate.enabled === "boolean") normalized.enabled = candidate.enabled;
    return [[id, normalized]];
  }));
  const custom = Array.isArray(source.custom) ? source.custom.flatMap(item => {
    const candidate = record(item);
    const id = safeId(candidate.id);
    const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
    if (!id || !name || typeof candidate.body !== "string") return [];
    return [{ id, name: name.slice(0, 100), body: candidate.body.slice(0, 100_000), enabled: candidate.enabled !== false }];
  }) : [];
  return { order: stringList(source.order), disabled: stringList(source.disabled), overrides, custom };
}

function applyLayer(base: InsertionTemplate[], layerValue: unknown): InsertionTemplate[] {
  const layer = normalizeInsertionTemplateLayer(layerValue);
  const map = new Map(base.map(item => [item.id, { ...item }]));
  for (const custom of layer.custom) map.set(custom.id, { ...custom, builtin: false });
  for (const [id, override] of Object.entries(layer.overrides)) {
    const template = map.get(id);
    if (template) map.set(id, { ...template, ...override });
  }
  for (const id of layer.disabled) {
    const template = map.get(id);
    if (template) template.enabled = false;
  }
  const ordered: InsertionTemplate[] = [];
  for (const id of layer.order) {
    const template = map.get(id);
    if (template) { ordered.push(template); map.delete(id); }
  }
  ordered.push(...map.values());
  return ordered;
}

export function resolveInsertionTemplates(globalLayer: unknown, projectLayer?: unknown): InsertionTemplate[] {
  return applyLayer(applyLayer(builtinInsertionTemplates.map(item => ({ ...item })), globalLayer), projectLayer);
}

export function templateWarnings(template: InsertionTemplate): string[] {
  if (template.id !== "figure") return [];
  const warnings: string[] = [];
  if (!template.body.includes("{{filePath}}")) warnings.push("Figure template does not contain {{filePath}}; dropped files may be copied without being referenced.");
  if (!template.body.includes("{{fileLabel}}")) warnings.push("Figure template does not contain {{fileLabel}}; generated figures may not have a unique label.");
  return warnings;
}

type RenderVariables = { filePath?: string; fileLabel?: string; selection?: string };
export type RenderedTemplate = { text: string; selectionFrom: number; selectionTo: number; imports: string[]; warnings: string[] };

const importLine = /^#import\s+"(@(?:preview|local)\/[A-Za-z0-9_.-]+:[^"\s]+)"[^\r\n]*$/;

function packageIdentity(specifier: string): string {
  const separator = specifier.lastIndexOf(":");
  return separator < 0 ? specifier : specifier.slice(0, separator);
}

export function renderInsertionTemplate(template: InsertionTemplate, variables: RenderVariables = {}): RenderedTemplate {
  const imports: string[] = [];
  const bodyLines: string[] = [];
  let inRawBlock = false;
  for (const line of template.body.split(/\r?\n/)) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("```")) {
      inRawBlock = !inRawBlock;
      bodyLines.push(line);
      continue;
    }
    const match = line.match(importLine);
    if (!inRawBlock && match) imports.push(line);
    else bodyLines.push(line);
  }
  const bodyWithoutImports = bodyLines.join("\n").replace(/^\n+/, "");
  let text = bodyWithoutImports
    .split("{{filePath}}").join(variables.filePath ?? "")
    .split("{{fileLabel}}").join(variables.fileLabel ?? "");
  let selectionFrom = -1;
  let selectionTo = -1;
  let targetUsed = false;
  text = text.replace(/\{\{select:([\s\S]*?)\}\}/g, (_match: string, placeholder: string, offset: number) => {
    const value = variables.selection || placeholder;
    if (!targetUsed) {
      selectionFrom = offset;
      selectionTo = offset + value.length;
      targetUsed = true;
    }
    return value;
  });
  text = text.replace(/\{\{cursor\}\}/g, (_match: string, offset: number) => {
    if (!targetUsed) {
      selectionFrom = selectionTo = offset;
      targetUsed = true;
    }
    return "";
  });
  if (!targetUsed) selectionFrom = selectionTo = text.length;
  return { text, selectionFrom, selectionTo, imports, warnings: templateWarnings(template) };
}

export type TemplateDocumentEdit = { text: string; selectionFrom: number; selectionTo: number };

export function insertRenderedTemplate(
  documentText: string,
  from: number,
  to: number,
  rendered: RenderedTemplate
): TemplateDocumentEdit {
  const existingIdentities = new Set<string>();
  for (const line of documentText.split(/\r?\n/)) {
    const match = line.match(importLine);
    if (match) existingIdentities.add(packageIdentity(match[1]));
  }
  const missing = [...new Map(rendered.imports.flatMap(line => {
    const match = line.match(importLine);
    return match && !existingIdentities.has(packageIdentity(match[1])) ? [[packageIdentity(match[1]), line] as const] : [];
  })).values()].sort((left, right) => left.localeCompare(right));
  const prefix = missing.length ? `${missing.join("\n")}\n\n` : "";
  const insertion = rendered.text;
  return {
    text: `${prefix}${documentText.slice(0, from)}${insertion}${documentText.slice(to)}`,
    selectionFrom: prefix.length + from + rendered.selectionFrom,
    selectionTo: prefix.length + from + rendered.selectionTo
  };
}

export function newCustomTemplateId(): string {
  const value = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return `custom:${value}`;
}
