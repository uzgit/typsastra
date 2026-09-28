import { describe, expect, test } from "bun:test";
import { basename, dirname, resolve } from "node:path";
import {
  flatReleaseDestination,
  isReleaseArtifact,
  releaseBuildEnvironment,
  requestedBundleSuffixes,
} from "../scripts/build-release";

describe("release artifact collection", () => {
  test("recognizes packaged installers and executables", () => {
    for (const name of ["Typsastra.AppImage", "typsastra.deb", "typsastra.rpm", "typsastra.dmg", "setup.msi", "setup.exe"]) {
      expect(isReleaseArtifact(name)).toBe(true);
    }
    expect(isReleaseArtifact("metadata.json")).toBe(false);
  });

  test("always flattens output directly into repository Release", () => {
    const root = resolve("/tmp/typsastra-test-root");
    const destination = flatReleaseDestination(root, "/deep/bundle/appimage/Typsastra.AppImage");
    expect(dirname(destination)).toBe(resolve(root, "Release"));
    expect(basename(destination)).toBe("Typsastra.AppImage");
  });

  test("collects only explicitly requested bundle formats", () => {
    expect(requestedBundleSuffixes(["--bundles", "appimage"])).toEqual([".AppImage"]);
    expect(requestedBundleSuffixes(["--bundles=deb,rpm"])).toEqual([".deb", ".rpm"]);
    expect(requestedBundleSuffixes([])).toBeNull();
  });

  test("remaps private build paths out of Rust release binaries", () => {
    const root = resolve("/private/build/typsastra");
    expect(releaseBuildEnvironment(root, {
      HOME: "/private/builder",
      RUSTFLAGS: "-Ctarget-cpu=x86-64",
    }).RUSTFLAGS).toBe([
      "-Ctarget-cpu=x86-64",
      `--remap-path-prefix=${root}=.`,
      "--remap-path-prefix=/private/builder=~",
    ].join(" "));
  });
});
