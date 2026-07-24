/**
 * apps/web/src/lib/__tests__/bot-status.test.ts
 *
 * Phase 69: unit tests for the pure helpers extracted from
 * App.tsx + ControlBar.tsx into `lib/bot-status.ts`.
 *
 * Each helper has 100% line + branch coverage from this file.
 * The e2e suite (69-bot-status.spec.ts) drives the React flow
 * through the same branches via the App + ControlBar components.
 *
 * Branch coverage intent:
 *   - `extractBotStatus`: 6 shapes (null, primitive, non-object, missing
 *     botStatus, invalid state, valid)
 *   - `formatUptime`: 6 duration ranges (never-started, <60s, <1h, <24h,
 *     >=24h, negative delta)
 *   - `formatLastUpdate`: 7 duration ranges (never-updated, <2s, <60s,
 *     <60m (1m vs Nm), <24h (1h vs Nh), >=24h (1d vs Nd))
 *   - `computeControlBarAvailability`: 3 states + 1 null fallback = 4
 *   - `buildStatusBannerText`: 2 cases (null botStatus, present)
 */

import { describe, expect, it } from "bun:test";

import {
  buildStatusBannerText,
  computeControlBarAvailability,
  extractBotStatus,
  formatLastUpdate,
  formatUptime,
} from "../bot-status.js";

// =============================================================================
// extractBotStatus
// =============================================================================

describe("extractBotStatus", () => {
  it("returns null when the snapshot is null", () => {
    expect(extractBotStatus(null)).toBeNull();
  });

  it("returns null when the snapshot is a primitive", () => {
    expect(extractBotStatus("hello")).toBeNull();
    expect(extractBotStatus(42)).toBeNull();
    expect(extractBotStatus(true)).toBeNull();
  });

  it("returns null when the snapshot is a non-object (array)", () => {
    expect(extractBotStatus([1, 2, 3])).toBeNull();
  });

  it("returns null when the snapshot has no botStatus field", () => {
    expect(extractBotStatus({ foo: "bar" })).toBeNull();
  });

  it("returns null when botStatus is not an object", () => {
    expect(extractBotStatus({ botStatus: "string" })).toBeNull();
    expect(extractBotStatus({ botStatus: 42 })).toBeNull();
    expect(extractBotStatus({ botStatus: null })).toBeNull();
  });

  it("returns null when the state field is not one of the 3 valid values", () => {
    expect(
      extractBotStatus({
        botStatus: {
          state: "exploded",
          startedAt: 0,
          lastUpdate: 0,
          activeStrategyCount: 0,
        },
      }),
    ).toBeNull();
    expect(
      extractBotStatus({
        botStatus: { state: 42, startedAt: 0, lastUpdate: 0, activeStrategyCount: 0 },
      }),
    ).toBeNull();
  });

  it("returns null when the numeric fields are not numbers", () => {
    expect(
      extractBotStatus({
        botStatus: {
          state: "running",
          startedAt: "1700000000000",
          lastUpdate: 0,
          activeStrategyCount: 0,
        },
      }),
    ).toBeNull();
    expect(
      extractBotStatus({
        botStatus: {
          state: "running",
          startedAt: 0,
          lastUpdate: "0",
          activeStrategyCount: 0,
        },
      }),
    ).toBeNull();
    expect(
      extractBotStatus({
        botStatus: {
          state: "running",
          startedAt: 0,
          lastUpdate: 0,
          activeStrategyCount: "1",
        },
      }),
    ).toBeNull();
  });

  it("returns the parsed BotStatus for a valid 'running' snapshot", () => {
    const result = extractBotStatus({
      botStatus: {
        state: "running",
        startedAt: 1_700_000_000_000,
        lastUpdate: 1_700_000_060_000,
        activeStrategyCount: 3,
      },
    });
    expect(result).toEqual({
      state: "running",
      startedAt: 1_700_000_000_000,
      lastUpdate: 1_700_000_060_000,
      activeStrategyCount: 3,
    });
  });

  it("returns the parsed BotStatus for a valid 'paused' snapshot", () => {
    const result = extractBotStatus({
      botStatus: {
        state: "paused",
        startedAt: 0,
        lastUpdate: 1_700_000_060_000,
        activeStrategyCount: 0,
      },
    });
    expect(result).toEqual({
      state: "paused",
      startedAt: 0,
      lastUpdate: 1_700_000_060_000,
      activeStrategyCount: 0,
    });
  });

  it("returns the parsed BotStatus for a valid 'stopped' snapshot", () => {
    const result = extractBotStatus({
      botStatus: {
        state: "stopped",
        startedAt: 0,
        lastUpdate: 0,
        activeStrategyCount: 0,
      },
    });
    expect(result).toEqual({
      state: "stopped",
      startedAt: 0,
      lastUpdate: 0,
      activeStrategyCount: 0,
    });
  });
});

// =============================================================================
// formatUptime
// =============================================================================

describe("formatUptime", () => {
  it("returns '—' when startedAt is 0 (never started)", () => {
    expect(formatUptime(0, 1_700_000_000_000)).toBe("—");
  });

  it("returns '—' when startedAt is negative (defensive)", () => {
    expect(formatUptime(-1, 1_700_000_000_000)).toBe("—");
  });

  it("formats sub-minute uptime as seconds", () => {
    expect(formatUptime(1_700_000_000_000, 1_700_000_000_000)).toBe("0s");
    expect(formatUptime(1_700_000_000_000, 1_700_000_047_000)).toBe("47s");
  });

  it("formats sub-hour uptime as 'Xm Ys'", () => {
    expect(formatUptime(1_700_000_000_000, 1_700_000_060_000)).toBe("1m 0s");
    expect(formatUptime(1_700_000_000_000, 1_700_000_827_000)).toBe("13m 47s");
  });

  it("formats sub-day uptime as 'Xh Ym'", () => {
    expect(formatUptime(1_700_000_000_000, 1_700_000_000_000 + 3_600_000)).toBe("1h 0m");
    expect(
      formatUptime(
        1_700_000_000_000,
        1_700_000_000_000 + 2 * 3_600_000 + 13 * 60_000,
      ),
    ).toBe("2h 13m");
  });

  it("formats multi-day uptime as 'Xd Yh'", () => {
    expect(formatUptime(1_700_000_000_000, 1_700_000_000_000 + 24 * 3_600_000)).toBe("1d 0h");
    expect(
      formatUptime(
        1_700_000_000_000,
        1_700_000_000_000 + 3 * 24 * 3_600_000 + 4 * 3_600_000,
      ),
    ).toBe("3d 4h");
  });

  it("clamps negative deltas to 0 seconds", () => {
    // Clock skew: `now < startedAt` (impossible in practice but
    // defensive). The helper clamps the delta to 0 to avoid
    // showing "-1s" or similar nonsense.
    expect(formatUptime(1_700_000_000_000, 1_699_999_999_000)).toBe("0s");
  });
});

// =============================================================================
// formatLastUpdate
// =============================================================================

describe("formatLastUpdate", () => {
  it("returns '—' when lastUpdate is 0 (no update yet)", () => {
    expect(formatLastUpdate(0, 1_700_000_000_000)).toBe("—");
  });

  it("returns '—' when lastUpdate is negative (defensive)", () => {
    expect(formatLastUpdate(-1, 1_700_000_000_000)).toBe("—");
  });

  it("returns 'just now' for deltas < 2s", () => {
    expect(formatLastUpdate(1_700_000_000_000, 1_700_000_000_000)).toBe("just now");
    expect(formatLastUpdate(1_700_000_000_000, 1_700_000_001_000)).toBe("just now");
  });

  it("returns 'X seconds ago' for deltas < 60s", () => {
    expect(formatLastUpdate(1_700_000_000_000, 1_700_000_047_000)).toBe("47 seconds ago");
    expect(formatLastUpdate(1_700_000_000_000, 1_700_000_059_000)).toBe("59 seconds ago");
  });

  it("returns '1 minute ago' (singular) for a 1-minute delta", () => {
    expect(formatLastUpdate(1_700_000_000_000, 1_700_000_060_000)).toBe("1 minute ago");
  });

  it("returns 'X minutes ago' (plural) for multi-minute deltas", () => {
    expect(formatLastUpdate(1_700_000_000_000, 1_700_000_120_000)).toBe("2 minutes ago");
    expect(formatLastUpdate(1_700_000_000_000, 1_700_003_540_000)).toBe("59 minutes ago");
  });

  it("returns '1 hour ago' (singular) for a 1-hour delta", () => {
    expect(formatLastUpdate(1_700_000_000_000, 1_700_003_600_000)).toBe("1 hour ago");
  });

  it("returns 'X hours ago' (plural) for multi-hour deltas", () => {
    expect(formatLastUpdate(1_700_000_000_000, 1_700_007_200_000)).toBe("2 hours ago");
  });

  it("returns '1 day ago' (singular) for a 1-day delta", () => {
    expect(
      formatLastUpdate(1_700_000_000_000, 1_700_000_000_000 + 24 * 3_600_000),
    ).toBe("1 day ago");
  });

  it("returns 'X days ago' (plural) for multi-day deltas", () => {
    expect(
      formatLastUpdate(1_700_000_000_000, 1_700_000_000_000 + 3 * 24 * 3_600_000),
    ).toBe("3 days ago");
  });
});

// =============================================================================
// computeControlBarAvailability
// =============================================================================

describe("computeControlBarAvailability", () => {
  it("returns the stopped-state default when botState is null", () => {
    expect(computeControlBarAvailability(null)).toEqual({
      start: true,
      stop: false,
      pause: false,
      resume: false,
      killSwitch: false,
    });
  });

  it("returns the stopped-state map when botState is 'stopped'", () => {
    expect(computeControlBarAvailability("stopped")).toEqual({
      start: true,
      stop: false,
      pause: false,
      resume: false,
      killSwitch: false,
    });
  });

  it("returns the running-state map when botState is 'running'", () => {
    expect(computeControlBarAvailability("running")).toEqual({
      start: false,
      stop: true,
      pause: true,
      resume: false,
      killSwitch: true,
    });
  });

  it("returns the paused-state map when botState is 'paused'", () => {
    expect(computeControlBarAvailability("paused")).toEqual({
      start: false,
      stop: false,
      pause: false,
      resume: true,
      killSwitch: true,
    });
  });
});

// =============================================================================
// buildStatusBannerText
// =============================================================================

describe("buildStatusBannerText", () => {
  it("returns the 'no status yet' fallback when botStatus is null", () => {
    expect(buildStatusBannerText(null, 1_700_000_000_000)).toBe(
      "Bot: stopped — no status yet",
    );
  });

  it("returns a formatted banner for a 'stopped' bot", () => {
    const banner = buildStatusBannerText(
      {
        state: "stopped",
        startedAt: 0,
        lastUpdate: 1_700_000_000_000,
        activeStrategyCount: 1,
      },
      1_700_000_000_000,
    );
    expect(banner).toContain("Bot: STOPPED");
    expect(banner).toContain("uptime —");
    expect(banner).toContain("just now");
    expect(banner).toContain("1 active strategies");
  });

  it("returns a formatted banner for a 'running' bot", () => {
    const banner = buildStatusBannerText(
      {
        state: "running",
        startedAt: 1_700_000_000_000,
        lastUpdate: 1_700_000_060_000,
        activeStrategyCount: 3,
      },
      1_700_000_000_000 + 2 * 3_600_000 + 13 * 60_000,
    );
    expect(banner).toContain("Bot: RUNNING");
    expect(banner).toContain("uptime 2h 13m");
    expect(banner).toContain("2 hours ago");
    expect(banner).toContain("3 active strategies");
  });

  it("returns a formatted banner for a 'paused' bot", () => {
    const banner = buildStatusBannerText(
      {
        state: "paused",
        startedAt: 1_700_000_000_000,
        lastUpdate: 1_700_000_000_000,
        activeStrategyCount: 0,
      },
      1_700_000_000_000 + 47_000,
    );
    expect(banner).toContain("Bot: PAUSED");
    expect(banner).toContain("uptime 47s");
    expect(banner).toContain("0 active strategies");
  });
});
