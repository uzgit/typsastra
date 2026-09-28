import { relativeFilePath, remapFilePath } from "../platform/paths";

const PATH_FUNCTIONS = new Set([
  "image",
  "bibliography",
  "read",
  "csv",
  "json",
  "yaml",
  "xml",
]);

type DelimiterFrame = {
  closing: ")" | "]" | "}";
  functionName: string | null;
  argumentIndex: number;
};

export type MovedPathReferenceEdit = {
  from: number;
  to: number;
  previousPath: string;
  nextPath: string;
};

export type MovedPathReferenceUpdate = {
  text: string;
  edits: MovedPathReferenceEdit[];
};

export type WorkspacePathMove = {
  oldPath: string;
  newPath: string;
};

function normalizedPath(path: string): string {
  const value = path.replace(/\\/g, "/");
  const drive = /^([A-Za-z]:)(?:\/|$)/.exec(value)?.[1] ?? "";
  const absolute = value.startsWith("/") || Boolean(drive);
  const body = drive ? value.slice(drive.length).replace(/^\/+/, "") : value.replace(/^\/+/, "");
  const parts: string[] = [];
  for (const part of body.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length > 0 && parts[parts.length - 1] !== "..") parts.pop();
      else if (!absolute) parts.push(part);
    } else {
      parts.push(part);
    }
  }
  if (drive) return `${drive}/${parts.join("/")}`.replace(/\/$/, "");
  if (absolute) return `/${parts.join("/")}`;
  return parts.join("/") || ".";
}

function pathDirectory(path: string): string {
  const normalized = normalizedPath(path);
  const index = normalized.lastIndexOf("/");
  if (index < 0) return ".";
  if (index === 0) return "/";
  return normalized.slice(0, index);
}

function joinPath(base: string, path: string): string {
  return normalizedPath(`${base.replace(/\/$/, "")}/${path}`);
}

function pathRootAndParts(path: string): { root: string; parts: string[] } {
  const normalized = normalizedPath(path);
  const drive = /^([A-Za-z]:)\/(.*)$/u.exec(normalized);
  if (drive) return { root: drive[1].toLowerCase(), parts: drive[2].split("/").filter(Boolean) };
  return {
    root: normalized.startsWith("/") ? "/" : "",
    parts: normalized.replace(/^\/+/, "").split("/").filter(Boolean),
  };
}

function relativePath(fromDirectory: string, targetPath: string): string | null {
  const from = pathRootAndParts(fromDirectory);
  const target = pathRootAndParts(targetPath);
  if (from.root !== target.root) return null;
  const caseInsensitive = /^[a-z]:$/u.test(from.root);
  let common = 0;
  while (common < from.parts.length && common < target.parts.length) {
    const left = caseInsensitive ? from.parts[common].toLowerCase() : from.parts[common];
    const right = caseInsensitive ? target.parts[common].toLowerCase() : target.parts[common];
    if (left !== right) break;
    common += 1;
  }
  return [
    ...Array.from({ length: from.parts.length - common }, () => ".."),
    ...target.parts.slice(common),
  ].join("/") || ".";
}

function decodeTypstPath(value: string): string | null {
  let decoded = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character !== "\\") {
      decoded += character;
      continue;
    }
    const escaped = value[index + 1];
    if (escaped !== "\\" && escaped !== '"') return null;
    decoded += escaped;
    index += 1;
  }
  return decoded;
}

function encodeTypstPath(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function stringEnd(text: string, start: number): number | null {
  for (let index = start + 1; index < text.length; index += 1) {
    if (text[index] === "\\") {
      index += 1;
    } else if (text[index] === '"') {
      return index;
    }
  }
  return null;
}

function functionBefore(text: string, openParen: number): string | null {
  const prefix = text.slice(Math.max(0, openParen - 80), openParen);
  return /#?([\p{L}\p{N}_-]+)\s*$/u.exec(prefix)?.[1] ?? null;
}

function directPathExpressionBefore(text: string, quote: number): boolean {
  const prefix = text.slice(Math.max(0, quote - 120), quote);
  return /#(?:include|import)\s*$/u.test(prefix);
}

function resolvedReferencePath(
  sourcePath: string,
  workspaceRoot: string,
  reference: string,
): string | null {
  if (!reference || reference.startsWith("@") || /^[A-Za-z][A-Za-z\d+.-]*:/u.test(reference)) {
    return null;
  }
  if (/^[A-Za-z]:[\\/]/u.test(reference) || reference.startsWith("//")) return null;
  return reference.startsWith("/")
    ? joinPath(workspaceRoot, reference.replace(/^\/+/, ""))
    : joinPath(pathDirectory(sourcePath), reference);
}

function replacementReferencePath(
  originalReference: string,
  sourcePath: string,
  targetPath: string,
  workspaceRoot: string,
): string | null {
  if (originalReference.startsWith("/")) {
    const workspaceRelative = relativeFilePath(normalizedPath(workspaceRoot), normalizedPath(targetPath));
    return workspaceRelative === null ? null : `/${workspaceRelative}`;
  }
  const relative = relativePath(pathDirectory(sourcePath), targetPath);
  if (relative === null) return null;
  if (relative.startsWith("..")) return relative;
  return originalReference.startsWith("./") ? `./${relative}` : relative;
}

/**
 * Rewrites only quoted paths used by Typst's path-bearing expressions.
 * All matching is lexical: arbitrary strings, comments, and named string
 * arguments such as image(..., alt: "...") are left untouched.
 */
export function updateMovedPathReferences(
  text: string,
  sourcePath: string,
  workspaceRoot: string,
  oldPathOrMoves: string | readonly WorkspacePathMove[],
  newPath?: string,
): MovedPathReferenceUpdate {
  const moves = (typeof oldPathOrMoves === "string"
    ? [{ oldPath: oldPathOrMoves, newPath: newPath ?? oldPathOrMoves }]
    : oldPathOrMoves
  ).map(move => ({
    oldPath: normalizedPath(move.oldPath),
    newPath: normalizedPath(move.newPath),
  })).sort((left, right) => right.oldPath.length - left.oldPath.length);
  const remap = (path: string): string => {
    const normalized = normalizedPath(path);
    const move = moves.find(candidate => relativeFilePath(candidate.oldPath, normalized) !== null);
    return move ? normalizedPath(remapFilePath(normalized, move.oldPath, move.newPath)) : normalized;
  };
  const normalizedSourcePath = normalizedPath(sourcePath);
  const movedSourcePath = remap(sourcePath);
  const sourceWasMoved = movedSourcePath !== normalizedSourcePath;
  const stack: DelimiterFrame[] = [];
  const edits: MovedPathReferenceEdit[] = [];

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "/" && text[index + 1] === "/") {
      const newline = text.indexOf("\n", index + 2);
      index = newline < 0 ? text.length : newline;
      continue;
    }
    if (text[index] === "/" && text[index + 1] === "*") {
      let depth = 1;
      index += 2;
      while (index < text.length && depth > 0) {
        if (text[index] === "/" && text[index + 1] === "*") {
          depth += 1;
          index += 2;
        } else if (text[index] === "*" && text[index + 1] === "/") {
          depth -= 1;
          index += 2;
        } else {
          index += 1;
        }
      }
      index -= 1;
      continue;
    }

    if (text[index] === '"') {
      const end = stringEnd(text, index);
      if (end === null) break;
      const nearestCall = [...stack].reverse().find(frame => frame.functionName !== null);
      const isDirectPath = directPathExpressionBefore(text, index);
      const isFirstPathArgument = nearestCall !== undefined
        && PATH_FUNCTIONS.has(nearestCall.functionName!)
        && nearestCall.argumentIndex === 0
        && stack.slice(stack.indexOf(nearestCall) + 1).every(frame => frame.functionName === null);
      if (isDirectPath || isFirstPathArgument) {
        const encodedPath = text.slice(index + 1, end);
        const reference = decodeTypstPath(encodedPath);
        const resolved = reference === null
          ? null
          : resolvedReferencePath(sourcePath, workspaceRoot, reference);
        if (reference !== null && resolved !== null && (sourceWasMoved || moves.some(move => relativeFilePath(move.oldPath, resolved) !== null))) {
          const movedTarget = remap(resolved);
          const replacement = replacementReferencePath(
            reference,
            movedSourcePath,
            movedTarget,
            workspaceRoot,
          );
          if (replacement !== null && replacement !== reference) {
            edits.push({
              from: index + 1,
              to: end,
              previousPath: reference,
              nextPath: replacement,
            });
          }
        }
      }
      index = end;
      continue;
    }

    const closing = text[index] === "(" ? ")"
      : text[index] === "[" ? "]"
        : text[index] === "{" ? "}" : null;
    if (closing) {
      stack.push({
        closing,
        functionName: text[index] === "(" ? functionBefore(text, index) : null,
        argumentIndex: 0,
      });
      continue;
    }
    if (text[index] === ",") {
      const frame = stack[stack.length - 1];
      if (frame && frame.functionName !== null) frame.argumentIndex += 1;
      continue;
    }
    if (text[index] === ")" || text[index] === "]" || text[index] === "}") {
      const matchingIndex = stack.map(frame => frame.closing).lastIndexOf(text[index] as ")" | "]" | "}");
      if (matchingIndex >= 0) stack.splice(matchingIndex);
    }
  }

  let updated = text;
  for (const edit of [...edits].sort((left, right) => right.from - left.from)) {
    updated = updated.slice(0, edit.from) + encodeTypstPath(edit.nextPath) + updated.slice(edit.to);
  }
  return { text: updated, edits };
}
