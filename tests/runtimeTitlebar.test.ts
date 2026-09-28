import { describe, expect, test } from "bun:test";
import { resolveRuntimeTitlebar } from "../src/platform/runtimeTitlebar";

describe("runtime titlebar selection", () => {
  test("uses native traffic lights on macOS", () => {
    expect(resolveRuntimeTitlebar({ platform: "MacIntel" })).toEqual({
      mode: "native-macos",
      simulated: false,
    });
  });

  test("enables the macOS layout simulation only in development", () => {
    expect(resolveRuntimeTitlebar({
      platform: "Win32",
      search: "?test-platform=macos-titlebar",
      dev: true,
    })).toEqual({
      mode: "native-macos",
      simulated: true,
    });
  });

  test("does not allow the simulation flag in production", () => {
    expect(resolveRuntimeTitlebar({
      platform: "Win32",
      search: "?test-platform=macos-titlebar",
      dev: false,
    })).toEqual({
      mode: "custom",
      simulated: false,
    });
  });

  test("uses one native drag mechanism across the complete custom titlebar", async () => {
    const markup = await Bun.file(new URL("../index.html", import.meta.url)).text();
    const controller = await Bun.file(new URL("../src/appController.ts", import.meta.url)).text();
    expect(markup).toContain('class="titlebar-left" data-tauri-drag-region');
    expect(markup).toContain('class="titlebar-center" data-tauri-drag-region');
    expect(markup).toContain('class="titlebar-right" data-tauri-drag-region');
    expect(controller).not.toContain("appWindow.startDragging()");
  });
});
