import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { historyField, isolateHistory } from "@codemirror/commands";

export type EditorUndoHistory = unknown;

export function captureEditorUndoHistory(state: EditorState): EditorUndoHistory | undefined {
  return state.field(historyField, false);
}

export function createTabEditorState(options: {
  doc: string;
  anchor: number;
  head: number;
  extensions: Extension;
  undoHistory?: EditorUndoHistory;
}): EditorState {
  const docLength = options.doc.length;
  const anchor = Math.max(0, Math.min(options.anchor, docLength));
  const head = Math.max(0, Math.min(options.head, docLength));
  return EditorState.create({
    doc: options.doc,
    selection: EditorSelection.single(anchor, head),
    extensions: [
      options.extensions,
      options.undoHistory === undefined
        ? []
        : historyField.init(() => options.undoHistory),
    ],
  });
}

/**
 * Replace a document with a revision read from disk without discarding the
 * editor's existing undo/redo stacks. Isolating both sides makes every
 * external revision a distinct history step, even when file-watcher events
 * arrive close together.
 */
export function externalEditorTextUpdate(state: EditorState, doc: string) {
  const selection = state.selection.main;
  return state.update({
    changes: { from: 0, to: state.doc.length, insert: doc },
    selection: EditorSelection.single(
      Math.min(selection.anchor, doc.length),
      Math.min(selection.head, doc.length),
    ),
    annotations: isolateHistory.of("full"),
    userEvent: "input.external",
  });
}
