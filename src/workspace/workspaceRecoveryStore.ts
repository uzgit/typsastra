import { invoke } from "@tauri-apps/api/core";
import { safeRelativeWorkspacePath } from "./workspaceStateStore";

export type WorkspaceRecoveryTab = {
  path: string;
  content: string;
  selectionAnchor: number;
  selectionHead: number;
};

export type WorkspaceRecovery = {
  schemaVersion: 1;
  updatedAtMs: number;
  tabs: WorkspaceRecoveryTab[];
};

export function normalizeWorkspaceRecovery(value: unknown): WorkspaceRecovery {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const seen = new Set<string>();
  const tabs = Array.isArray(record.tabs)
    ? record.tabs.slice(0, 512).flatMap(item => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const tab = item as Record<string, unknown>;
        const path = safeRelativeWorkspacePath(tab.path);
        if (!path || seen.has(path) || typeof tab.content !== "string") return [];
        seen.add(path);
        const selectionAnchor = boundedOffset(tab.selectionAnchor, tab.content.length);
        const selectionHead = boundedOffset(tab.selectionHead, tab.content.length);
        return [{ path, content: tab.content, selectionAnchor, selectionHead }];
      })
    : [];
  return {
    schemaVersion: 1,
    updatedAtMs: typeof record.updatedAtMs === "number" && Number.isFinite(record.updatedAtMs)
      ? Math.max(0, record.updatedAtMs)
      : 0,
    tabs,
  };
}

export class WorkspaceRecoveryStore {
  private pending: { workspacePath: string; recovery: WorkspaceRecovery } | null = null;
  private drainPromise: Promise<void> | null = null;

  public async load(workspacePath: string): Promise<WorkspaceRecovery> {
    const value = await invoke<unknown | null>("load_workspace_recovery", {
      workspaceRootPath: workspacePath,
    });
    return normalizeWorkspaceRecovery(value);
  }

  public save(workspacePath: string, recovery: WorkspaceRecovery): Promise<void> {
    this.pending = { workspacePath, recovery };
    this.drainPromise ??= this.drain();
    return this.drainPromise;
  }

  public flush(): Promise<void> {
    return this.drainPromise ?? Promise.resolve();
  }

  private async drain(): Promise<void> {
    try {
      while (this.pending) {
        const next = this.pending;
        this.pending = null;
        await invoke("save_workspace_recovery", {
          workspaceRootPath: next.workspacePath,
          recovery: next.recovery,
        });
      }
    } finally {
      this.drainPromise = null;
      if (this.pending) this.drainPromise = this.drain();
    }
  }
}

function boundedOffset(value: unknown, length: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(Math.round(value), length))
    : 0;
}
