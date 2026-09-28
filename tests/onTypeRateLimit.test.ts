import { describe, expect, test } from "bun:test";
import { browserTimerDelayMs, onTypePreviewDelayMs } from "../src/preview/onTypeRateLimit";

describe("on-type preview rate limiting", () => {
  test("adds no delay when the optional limit is disabled", () => {
    expect(onTypePreviewDelayMs({
      debounceDelayMs: 300,
      nowMs: 10_000,
      lastPreviewStartedAtMs: 9_900,
      rateLimitSeconds: 0,
    })).toBe(300);
  });

  test("waits until both debounce and rate-limit boundaries have passed", () => {
    expect(onTypePreviewDelayMs({
      debounceDelayMs: 300,
      nowMs: 10_000,
      lastPreviewStartedAtMs: 9_000,
      rateLimitSeconds: 4,
    })).toBe(3_000);
    expect(onTypePreviewDelayMs({
      debounceDelayMs: 500,
      nowMs: 14_000,
      lastPreviewStartedAtMs: 9_000,
      rateLimitSeconds: 4,
    })).toBe(500);
  });

  test("chunks delays that exceed the browser timer maximum", () => {
    expect(browserTimerDelayMs(Number.MAX_SAFE_INTEGER)).toBe(2_147_483_647);
  });
});
