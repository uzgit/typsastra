const DROPPABLE_IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp", "avif",
]);

export type DroppedFileKind = "image" | "document";

function droppedExtension(path: string): string {
  const name = path.replace(/\\/g, "/").split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function droppedFileKind(path: string): DroppedFileKind | null {
  const extension = droppedExtension(path);
  if (DROPPABLE_IMAGE_EXTENSIONS.has(extension)) return "image";
  return extension === "pdf" ? "document" : null;
}

export function escapeTypstPath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
}

export function typstDroppedFileInsertion(path: string, kind: DroppedFileKind): string {
  const escaped = escapeTypstPath(path);
  return kind === "image"
    ? `#image("${escaped}")`
    : `#include "${escaped}"`;
}

export function typstDroppedFilesInsertion(
  files: readonly { referencePath: string; kind: DroppedFileKind }[],
): string {
  return files.map(file => typstDroppedFileInsertion(file.referencePath, file.kind)).join("\n");
}
