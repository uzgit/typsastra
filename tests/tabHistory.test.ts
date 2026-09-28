import { describe, expect, test } from "bun:test";
import { history, redo, undo } from "@codemirror/commands";
import {
  captureEditorUndoHistory,
  createTabEditorState,
  externalEditorTextUpdate,
  type EditorUndoHistory,
} from "../src/editor/tabHistory";

function edit(
  doc: string,
  insert: string,
  undoHistory?: EditorUndoHistory,
) {
  let state = createTabEditorState({
    doc,
    anchor: doc.length,
    head: doc.length,
    extensions: history(),
    undoHistory,
  });
  state = state.update({
    changes: { from: state.doc.length, insert },
    userEvent: "input.type",
  }).state;
  return state;
}

function undoState(state: ReturnType<typeof edit>) {
  let current = state;
  const applied = undo({
    state: current,
    dispatch: transaction => {
      current = transaction.state;
    },
  });
  return { applied, state: current };
}

function redoState(state: ReturnType<typeof edit>) {
  let current = state;
  const applied = redo({
    state: current,
    dispatch: transaction => {
      current = transaction.state;
    },
  });
  return { applied, state: current };
}

describe("per-tab editor history", () => {
  test("restores undo independently after switching between documents", () => {
    const first = edit("first", " A");
    const second = edit("second", " B");

    const restoredFirst = createTabEditorState({
      doc: first.doc.toString(),
      anchor: first.selection.main.anchor,
      head: first.selection.main.head,
      extensions: history(),
      undoHistory: captureEditorUndoHistory(first),
    });
    const firstUndo = undoState(restoredFirst);
    expect(firstUndo.applied).toBe(true);
    expect(firstUndo.state.doc.toString()).toBe("first");

    const restoredSecond = createTabEditorState({
      doc: second.doc.toString(),
      anchor: second.selection.main.anchor,
      head: second.selection.main.head,
      extensions: history(),
      undoHistory: captureEditorUndoHistory(second),
    });
    const secondUndo = undoState(restoredSecond);
    expect(secondUndo.applied).toBe(true);
    expect(secondUndo.state.doc.toString()).toBe("second");
  });

  test("starts with an empty undo stack when no history was captured", () => {
    const state = createTabEditorState({
      doc: "untouched",
      anchor: 0,
      head: 0,
      extensions: history(),
    });
    expect(undoState(state).applied).toBe(false);
  });

  test("stores an external disk revision as an isolated undo and redo step", () => {
    const edited = edit("saved", " local");
    const externallyUpdated = externalEditorTextUpdate(edited, "external").state;

    const restoredLocal = undoState(externallyUpdated);
    expect(restoredLocal.applied).toBe(true);
    expect(restoredLocal.state.doc.toString()).toBe("saved local");

    const restoredExternal = redoState(restoredLocal.state);
    expect(restoredExternal.applied).toBe(true);
    expect(restoredExternal.state.doc.toString()).toBe("external");

    const restoredSaved = undoState(undoState(restoredExternal.state).state);
    expect(restoredSaved.applied).toBe(true);
    expect(restoredSaved.state.doc.toString()).toBe("saved");
  });

  test("the workspace captures and restores history at tab boundaries", async () => {
    const source = await Bun.file(new URL("../src/appController.ts", import.meta.url)).text();
    const persist = source.indexOf("private persistActiveTabState");
    const capture = source.indexOf(
      "tab.undoHistory = captureEditorUndoHistory(this.editorInstance.state)",
      persist,
    );
    const activation = source.indexOf("private async activateEditorTab");
    const restore = source.indexOf("this.editorInstance.setState(createTabEditorState({", activation);
    const restoredHistory = source.indexOf("undoHistory: tab.undoHistory", restore);

    expect(capture).toBeGreaterThan(persist);
    expect(restore).toBeGreaterThan(activation);
    expect(restoredHistory).toBeGreaterThan(restore);
    expect(source).not.toContain("Transaction.addToHistory.of(false)");
  });
});
