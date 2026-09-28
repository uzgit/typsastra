import { describe, expect, test } from "bun:test";
import { normalizeWorkspaceRecovery } from "../src/workspace/workspaceRecoveryStore";

describe("workspace crash recovery", () => {
  test("keeps safe, unique relative text buffers and clamps selections", () => {
    expect(normalizeWorkspaceRecovery({
      schemaVersion: 99,
      updatedAtMs: 123,
      tabs: [
        { path: "notes/main.typ", content: "hello", selectionAnchor: -4, selectionHead: 99 },
        { path: "notes/main.typ", content: "duplicate", selectionAnchor: 0, selectionHead: 0 },
        { path: "../secret", content: "unsafe", selectionAnchor: 0, selectionHead: 0 },
        { path: "/absolute.typ", content: "unsafe", selectionAnchor: 0, selectionHead: 0 },
      ],
    })).toEqual({
      schemaVersion: 1,
      updatedAtMs: 123,
      tabs: [{
        path: "notes/main.typ",
        content: "hello",
        selectionAnchor: 0,
        selectionHead: 5,
      }],
    });
  });

  test("treats malformed recovery data as empty", () => {
    expect(normalizeWorkspaceRecovery(null)).toEqual({
      schemaVersion: 1,
      updatedAtMs: 0,
      tabs: [],
    });
  });
});
