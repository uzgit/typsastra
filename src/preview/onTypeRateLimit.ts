const MAX_BROWSER_TIMER_DELAY_MS = 2_147_483_647;

export function onTypePreviewDelayMs(options: {
  debounceDelayMs: number;
  nowMs: number;
  lastPreviewStartedAtMs: number;
  rateLimitSeconds: number;
}): number {
  const debounceDelayMs = Math.max(0, options.debounceDelayMs);
  if (options.rateLimitSeconds <= 0 || !Number.isFinite(options.lastPreviewStartedAtMs)) {
    return debounceDelayMs;
  }
  const nextAllowedAtMs = options.lastPreviewStartedAtMs + options.rateLimitSeconds * 1_000;
  return Math.max(debounceDelayMs, nextAllowedAtMs - options.nowMs, 0);
}

export function browserTimerDelayMs(delayMs: number): number {
  return Math.min(MAX_BROWSER_TIMER_DELAY_MS, Math.max(0, delayMs));
}
