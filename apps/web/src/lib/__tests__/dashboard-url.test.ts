import { describe, expect, it } from "bun:test";

import { dashboardApiUrl, dashboardWebSocketUrl } from "../dashboard-url.js";

describe("dashboard URL helpers", () => {
  it("uses the current HTTP origin and custom port for REST endpoints", () => {
    expect(
      dashboardApiUrl("/api/status", { protocol: "http:", host: "bot.example:9123" }, "/"),
    ).toBe("http://bot.example:9123/api/status");
  });

  it("maps HTTPS to WSS and preserves a configured deployment base path", () => {
    expect(
      dashboardWebSocketUrl("/ws", { protocol: "https:", host: "dashboard.example" }, "/bot/"),
    ).toBe("wss://dashboard.example/bot/ws");
  });
});
