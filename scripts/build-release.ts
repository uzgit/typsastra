import { chmod, copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

const RELEASE_ARTIFACT_SUFFIXES = [
  ".AppImage",
  ".deb",
  ".rpm",
  ".dmg",
  ".msi",
  ".exe",
] as const;

export function isReleaseArtifact(path: string): boolean {
  return RELEASE_ARTIFACT_SUFFIXES.some(suffix => path.endsWith(suffix));
}

export function flatReleaseDestination(projectRoot: string, sourcePath: string): string {
  return join(resolve(projectRoot, "Release"), basename(sourcePath));
}

export function requestedBundleSuffixes(args: readonly string[]): readonly string[] | null {
  const inline = args.find(argument => argument.startsWith("--bundles="));
  const flagIndex = args.indexOf("--bundles");
  const value = inline?.slice("--bundles=".length)
    ?? (flagIndex >= 0 ? args[flagIndex + 1] : undefined);
  if (!value) return null;
  const suffixByBundle: Record<string, string> = {
    appimage: ".AppImage",
    deb: ".deb",
    rpm: ".rpm",
    dmg: ".dmg",
    msi: ".msi",
    nsis: ".exe",
  };
  const suffixes = value
    .split(",")
    .map(bundle => suffixByBundle[bundle.trim().toLowerCase()])
    .filter((suffix): suffix is string => !!suffix);
  return suffixes.length > 0 ? suffixes : null;
}

export function releaseBuildEnvironment(
  projectRoot: string,
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const remaps = [
    `--remap-path-prefix=${resolve(projectRoot)}=.`,
    ...[environment.CARGO_HOME, environment.HOME, environment.USERPROFILE]
      .filter((path, index, paths): path is string => !!path && paths.indexOf(path) === index)
      .map(path => `--remap-path-prefix=${resolve(path)}=~`),
  ];
  return {
    ...environment,
    RUSTFLAGS: [environment.RUSTFLAGS, ...remaps].filter(Boolean).join(" "),
  };
}

async function walkFiles(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true }).catch(error => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  const nested = await Promise.all(entries.map(entry => {
    const entryPath = join(path, entry.name);
    return entry.isDirectory() ? walkFiles(entryPath) : [entryPath];
  }));
  return nested.flat();
}

export async function collectReleaseArtifacts(
  projectRoot: string,
  requestedSuffixes: readonly string[] | null = null,
): Promise<string[]> {
  const root = resolve(projectRoot);
  const releaseDirectory = resolve(root, "Release");
  if (dirname(releaseDirectory) !== root || basename(releaseDirectory) !== "Release") {
    throw new Error(`Refusing to replace unexpected release path: ${releaseDirectory}`);
  }

  const bundleDirectory = join(root, "src-tauri", "target", "release", "bundle");
  const sources = (await walkFiles(bundleDirectory)).filter(path =>
    isReleaseArtifact(path)
    && (requestedSuffixes === null || requestedSuffixes.some(suffix => path.endsWith(suffix)))
  );
  if (sources.length === 0) {
    throw new Error(`No packaged release artifacts were found below ${bundleDirectory}`);
  }

  const destinations = new Set<string>();
  for (const source of sources) {
    const destination = flatReleaseDestination(root, source);
    if (destinations.has(destination)) {
      throw new Error(`Multiple release artifacts share the filename ${basename(destination)}`);
    }
    destinations.add(destination);
  }

  await rm(releaseDirectory, { recursive: true, force: true });
  await mkdir(releaseDirectory, { recursive: true });
  for (const source of sources) {
    const destination = flatReleaseDestination(root, source);
    await copyFile(source, destination);
    const sourceMode = (await stat(source)).mode;
    await chmod(destination, sourceMode & 0o777);
  }

  const entries = await readdir(releaseDirectory, { withFileTypes: true });
  if (entries.some(entry => entry.isDirectory())) {
    throw new Error("Release output must not contain subdirectories.");
  }
  return entries.map(entry => join(releaseDirectory, entry.name)).sort();
}

async function main(): Promise<void> {
  const projectRoot = process.cwd();
  const args = Bun.argv.slice(2);
  const collectOnlyIndex = args.indexOf("--collect-only");
  const collectOnly = collectOnlyIndex >= 0;
  if (collectOnly) args.splice(collectOnlyIndex, 1);

  if (!collectOnly) {
    const build = Bun.spawn([process.execPath, "run", "tauri", "build", ...args], {
      cwd: projectRoot,
      env: releaseBuildEnvironment(projectRoot),
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    const exitCode = await build.exited;
    if (exitCode !== 0) process.exit(exitCode);
  }

  const artifacts = await collectReleaseArtifacts(projectRoot, requestedBundleSuffixes(args));
  for (const artifact of artifacts) {
    console.log(artifact);
  }
}

if (import.meta.main) {
  await main();
}
