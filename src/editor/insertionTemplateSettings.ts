import {
  emptyInsertionTemplateLayer,
  newCustomTemplateId,
  normalizeInsertionTemplateLayer,
  resolveInsertionTemplates,
  templateWarnings,
  type InsertionTemplate,
  type InsertionTemplateLayer
} from "./insertionTemplates";

type Dependencies = {
  getGlobal: () => InsertionTemplateLayer;
  setGlobal: (layer: InsertionTemplateLayer) => void;
  getProject: () => InsertionTemplateLayer | null;
  setProject: (layer: InsertionTemplateLayer) => void;
};

export class InsertionTemplateSettingsController {
  private selectedId = "figure";
  private initialized = false;

  constructor(private readonly dependencies: Dependencies) {}

  public initialize(): void {
    if (this.initialized) return;
    this.initialized = true;
    const scope = this.element<HTMLSelectElement>("settings-template-scope");
    scope?.addEventListener("change", () => this.render());
    this.element("settings-template-list")?.addEventListener("click", event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-template-id]");
      if (!button) return;
      this.selectedId = button.dataset.templateId ?? this.selectedId;
      this.render();
    });
    this.element<HTMLInputElement>("settings-template-name")?.addEventListener("change", event => {
      this.editSelected({ name: (event.currentTarget as HTMLInputElement).value.trim() || "Template" });
    });
    this.element<HTMLTextAreaElement>("settings-template-body")?.addEventListener("change", event => {
      this.editSelected({ body: (event.currentTarget as HTMLTextAreaElement).value });
    });
    this.element<HTMLInputElement>("settings-template-enabled")?.addEventListener("change", event => {
      this.editSelected({ enabled: (event.currentTarget as HTMLInputElement).checked });
    });
    this.element("settings-template-add")?.addEventListener("click", () => this.add());
    this.element("settings-template-delete")?.addEventListener("click", () => this.remove());
    this.element("settings-template-reset-entry")?.addEventListener("click", () => this.resetEntry());
    this.element("settings-template-reset-scope")?.addEventListener("click", () => this.saveLayer(emptyInsertionTemplateLayer()));
    this.element("settings-template-up")?.addEventListener("click", () => this.move(-1));
    this.element("settings-template-down")?.addEventListener("click", () => this.move(1));
    this.render();
  }

  public render(): void {
    const scope = this.scope();
    const projectAvailable = this.dependencies.getProject() !== null;
    const scopeControl = this.element<HTMLSelectElement>("settings-template-scope");
    if (scopeControl) {
      scopeControl.querySelector<HTMLOptionElement>('option[value="project"]')!.disabled = !projectAvailable;
      if (!projectAvailable && scopeControl.value === "project") scopeControl.value = "global";
    }
    const templates = this.resolved();
    if (!templates.some(template => template.id === this.selectedId)) this.selectedId = templates[0]?.id ?? "";
    const list = this.element("settings-template-list");
    if (list) {
      list.replaceChildren(...templates.map(template => {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.templateId = template.id;
        button.classList.toggle("active", template.id === this.selectedId);
        button.textContent = `${template.enabled ? "✓" : "○"} ${template.name}`;
        return button;
      }));
    }
    const selected = templates.find(template => template.id === this.selectedId);
    const name = this.element<HTMLInputElement>("settings-template-name");
    const body = this.element<HTMLTextAreaElement>("settings-template-body");
    const enabled = this.element<HTMLInputElement>("settings-template-enabled");
    if (name) { name.value = selected?.name ?? ""; name.disabled = !selected; }
    if (body) { body.value = selected?.body ?? ""; body.disabled = !selected; }
    if (enabled) { enabled.checked = selected?.enabled ?? false; enabled.disabled = !selected; }
    const layer = this.layer();
    const custom = layer.custom.some(template => template.id === selected?.id);
    const remove = this.element<HTMLButtonElement>("settings-template-delete");
    if (remove) remove.disabled = !custom;
    const warning = this.element("settings-template-warning");
    if (warning) {
      const warnings = selected ? templateWarnings(selected) : [];
      const targetCount = selected ? (selected.body.match(/\{\{(?:select:[\s\S]*?|cursor)\}\}/g) ?? []).length : 0;
      if (targetCount > 1) warnings.push("Only the first select/cursor target will be used.");
      warning.textContent = warnings.join("\n");
    }
    this.element<HTMLElement>("settings-template-list")?.setAttribute("data-scope", scope);
  }

  private scope(): "global" | "project" {
    return this.element<HTMLSelectElement>("settings-template-scope")?.value === "project" && this.dependencies.getProject()
      ? "project" : "global";
  }

  private layer(): InsertionTemplateLayer {
    return normalizeInsertionTemplateLayer(this.scope() === "project" ? this.dependencies.getProject() : this.dependencies.getGlobal());
  }

  private resolved(): InsertionTemplate[] {
    const global = this.dependencies.getGlobal();
    return this.scope() === "project"
      ? resolveInsertionTemplates(global, this.dependencies.getProject())
      : resolveInsertionTemplates(global);
  }

  private saveLayer(layer: InsertionTemplateLayer): void {
    if (this.scope() === "project") this.dependencies.setProject(normalizeInsertionTemplateLayer(layer));
    else this.dependencies.setGlobal(normalizeInsertionTemplateLayer(layer));
    this.render();
  }

  private editSelected(update: { name?: string; body?: string; enabled?: boolean }): void {
    if (!this.selectedId) return;
    const layer = this.layer();
    const custom = layer.custom.find(template => template.id === this.selectedId);
    if (custom) Object.assign(custom, update);
    else layer.overrides[this.selectedId] = { ...(layer.overrides[this.selectedId] ?? {}), ...update };
    layer.disabled = layer.disabled.filter(id => id !== this.selectedId);
    this.saveLayer(layer);
  }

  private add(): void {
    const layer = this.layer();
    const custom: InsertionTemplate = { id: newCustomTemplateId(), name: "Custom template", body: "{{select:Content}}", enabled: true };
    layer.custom.push(custom);
    layer.order = [...this.resolved().map(template => template.id), custom.id];
    this.selectedId = custom.id;
    this.saveLayer(layer);
  }

  private remove(): void {
    const layer = this.layer();
    if (!layer.custom.some(template => template.id === this.selectedId)) return;
    layer.custom = layer.custom.filter(template => template.id !== this.selectedId);
    layer.order = layer.order.filter(id => id !== this.selectedId);
    delete layer.overrides[this.selectedId];
    this.selectedId = "figure";
    this.saveLayer(layer);
  }

  private resetEntry(): void {
    const layer = this.layer();
    if (layer.custom.some(template => template.id === this.selectedId)) {
      this.remove();
      return;
    }
    delete layer.overrides[this.selectedId];
    layer.disabled = layer.disabled.filter(id => id !== this.selectedId);
    layer.order = layer.order.filter(id => id !== this.selectedId);
    this.saveLayer(layer);
  }

  private move(direction: -1 | 1): void {
    const layer = this.layer();
    const order = this.resolved().map(template => template.id);
    const index = order.indexOf(this.selectedId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    layer.order = order;
    this.saveLayer(layer);
  }

  private element<T extends HTMLElement = HTMLElement>(id: string): T | null {
    return document.getElementById(id) as T | null;
  }
}
