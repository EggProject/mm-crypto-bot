import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { MockExchangeFeed } from "@exchange-testing/mockFeed.js";

import { Bot } from "../../bot/bot.js";
import { DEFAULT_BOT_CONFIG } from "../../config/defaults.js";
import type { BotConfig } from "../../config/schema.js";
import { attachStateFeed, type StateFeedHandle } from "../../state-feed/index.js";
import type { StateFeedServerMessage } from "../../state-feed/protocol.js";
import { HeadlessBotLifecycle } from "./start-lifecycle.js";

interface Status {
  readonly state: string;
  readonly startedAt: number;
}

class ControlledOpenFeed extends MockExchangeFeed {
  private resolveOpen: (() => void) | null = null;
  private readonly openGate = new Promise<void>((resolve) => {
    this.resolveOpen = resolve;
  });
  private resolveOpenCalled: (() => void) | null = null;
  public readonly openCalled = new Promise<void>((resolve) => {
    this.resolveOpenCalled = resolve;
  });
  public closeCalls = 0;

  public constructor(private readonly failOpen = false) {
    super({ balances: [{ currency: "USDC", free: 10_000, total: 10_000 }] });
  }

  public override async open(): Promise<void> {
    this.resolveOpenCalled?.();
    await this.openGate;
    if (this.failOpen) throw new Error("controlled feed open failed");
    await super.open();
  }

  public override async close(): Promise<void> {
    this.closeCalls += 1;
    await super.close();
  }

  public releaseOpen(): void {
    this.resolveOpen?.();
    this.resolveOpen = null;
  }
}

function configFor(stateFile: string): BotConfig {
  return {
    ...DEFAULT_BOT_CONFIG,
    bot: { ...DEFAULT_BOT_CONFIG.bot, mode: "paper", state_file: stateFile, auto_start: false },
    exchange: { ...DEFAULT_BOT_CONFIG.exchange, id: "mock" },
    symbols: { enabled: ["BTC/USDC"] },
    strategies: {
      donchian_pivot_composition: { enabled: false },
      dydx_cex_carry: { enabled: false },
      cascade_fade: { enabled: false },
      funding_flip_kill_switch: { enabled: false },
      regime_detector: { enabled: false },
    },
    telemetry: { ...DEFAULT_BOT_CONFIG.telemetry, log_dir: `${stateFile}.logs` },
  };
}

async function readSnapshot(port: number): Promise<Status> {
  return await new Promise<Status>((resolve, reject) => {
    let buffer = "";
    const timeout = setTimeout(() => reject(new Error("state-feed snapshot timeout")), 1_000);
    void Bun.connect({
      hostname: "127.0.0.1",
      port,
      socket: {
        open: () => undefined,
        data: (socket, data) => {
          buffer += data.toString("utf-8");
          let newline = buffer.indexOf("\n");
          while (newline >= 0) {
            const line = buffer.slice(0, newline);
            buffer = buffer.slice(newline + 1);
            try {
              const message = JSON.parse(line) as StateFeedServerMessage;
              if (message.type === "snapshot") {
                clearTimeout(timeout);
                socket.end();
                resolve({
                  state: message.snapshot.botStatus.state,
                  startedAt: message.snapshot.botStatus.startedAt,
                });
                return;
              }
            } catch (err) {
              clearTimeout(timeout);
              reject(err);
              return;
            }
            newline = buffer.indexOf("\n");
          }
        },
        close: () => undefined,
        error: (_socket, error) => {
          clearTimeout(timeout);
          reject(error);
        },
      },
    }).catch((err: unknown) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

describe("headless startup lifecycle", () => {
  let directory = "";
  let handle: StateFeedHandle | null = null;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "mm-start-lifecycle-"));
  });

  afterEach(async () => {
    await handle?.close();
    handle = null;
    if (existsSync(directory)) rmSync(directory, { recursive: true, force: true });
  });

  async function setup(feed: ControlledOpenFeed): Promise<{ bot: Bot; lifecycle: HeadlessBotLifecycle; handle: StateFeedHandle }> {
    const bot = new Bot({ config: configFor(join(directory, "state.json")), feed });
    handle = await attachStateFeed(bot, { port: 0, hostname: "127.0.0.1", enabledSymbols: ["BTC/USDC"] });
    return { bot, lifecycle: new HeadlessBotLifecycle(bot, handle.publisher), handle };
  }

  it("binds the state-feed before initialization and publishes running only after ready", async () => {
    const feed = new ControlledOpenFeed();
    const { lifecycle, handle: attached } = await setup(feed);
    const ready = lifecycle.start();
    await feed.openCalled;

    // This TCP client proves availability while `feed.open()` is intentionally
    // blocked; no exchange/network dependency participates in this ordering.
    expect(await readSnapshot(attached.port)).toEqual({ state: "stopped", startedAt: 0 });

    feed.releaseOpen();
    await ready;
    const running = await readSnapshot(attached.port);
    expect(running.state).toBe("running");
    expect(running.startedAt).toBeGreaterThan(0);

    await lifecycle.stop();
    expect((await readSnapshot(attached.port)).state).toBe("stopped");
  });

  it("rolls back initialization failure without ever publishing running", async () => {
    const feed = new ControlledOpenFeed(true);
    const { lifecycle, handle: attached } = await setup(feed);
    const ready = lifecycle.start();
    await feed.openCalled;
    expect(await readSnapshot(attached.port)).toEqual({ state: "stopped", startedAt: 0 });

    feed.releaseOpen();
    await expect(ready).rejects.toThrow("controlled feed open failed");
    expect(attached.publisher.getBotStatus().state).toBe("stopped");
    expect(attached.publisher.getSnapshot().status.engineError).toContain("controlled feed open failed");
    expect(feed.closeCalls).toBeGreaterThan(0);
  });

  it("preserves auto_start=false semantics until an explicit lifecycle start", async () => {
    const feed = new ControlledOpenFeed();
    const { lifecycle, handle: attached } = await setup(feed);

    expect(await readSnapshot(attached.port)).toEqual({ state: "stopped", startedAt: 0 });
    expect(feed.closeCalls).toBe(0);
    await lifecycle.stop();
    expect(attached.publisher.getBotStatus().state).toBe("stopped");
  });

  it("stops idempotently and releases initialized resources", async () => {
    const feed = new ControlledOpenFeed();
    const { lifecycle, handle: attached } = await setup(feed);
    const ready = lifecycle.start();
    await feed.openCalled;
    feed.releaseOpen();
    await ready;

    await lifecycle.stop();
    await lifecycle.stop();
    expect(attached.publisher.getBotStatus().state).toBe("stopped");
    expect(feed.closeCalls).toBeGreaterThan(0);
  });

  it("shares one readiness promise and lets callers await the subsequent run-loop stop", async () => {
    const feed = new ControlledOpenFeed();
    const { lifecycle } = await setup(feed);
    const firstReady = lifecycle.start();
    const repeatedReady = lifecycle.start();
    expect(repeatedReady).toBe(firstReady);

    await feed.openCalled;
    feed.releaseOpen();
    await firstReady;

    const stopped = lifecycle.waitForStop();
    await lifecycle.stop();
    await stopped;
  });
});
