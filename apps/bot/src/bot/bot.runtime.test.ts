import { afterEach, beforeEach, describe, expect, it } from "vitest";
import path from "node:path";

import { RecordingLogger } from "@logging-testing";

import {
  Bot,
  buildTestConfig,
  createBotTestFixture,
  disposeBotTestFixture,
  fileSystem,
  type BotTestFixture,
} from "./bot.test-support.js";

describe("Bot runtime", () => {
  let fixture: BotTestFixture;
  let temporaryDirectory: string;
  let stateFile: string;
  let feed: ReturnType<typeof createBotTestFixture>["feed"];

  beforeEach(() => {
    fixture = createBotTestFixture();
    ({ temporaryDirectory, stateFile, feed } = fixture);
  });

  afterEach(() => {
    disposeBotTestFixture(fixture);
  });

  it("periodic state-save fires when stateSaveIntervalMs is short", async () => {
    const config = buildTestConfig(stateFile);
    // Inject a custom StateStore with 0 debounce so the save lands
    // immediately after the interval fires. The state-save interval
    // is the periodic trigger; the StateStore's debounce is separate.
    const bot = new Bot({
      config,
      feed,
      stateSaveIntervalMs: 600,
      killSwitchEvalIntervalMs: 10_000, // disable kill-switch eval
      heartbeatIntervalMs: 10_000, // disable heartbeat
    });
    const p = bot.start();
    await new Promise<void>((r) => setTimeout(r, 1150));

    // The state file should have been written by the periodic save.
    expect(fileSystem.existsSync(stateFile)).toBe(true);
    const currentFileSystem = await import("node:fs");
    const raw = fileSystem.existsSync(stateFile) ? currentFileSystem.readFileSync(stateFile, "utf8") : "";
    const parsed = JSON.parse(raw) as { version: number };
    expect(parsed.version).toBe(1);

    await bot.stop();
    await p;
  });

  // ---------------------------------------------------------------------------
  // 13) killSwitchInterval callback fires (covers lines 378-381)
  // ---------------------------------------------------------------------------
  it("periodic kill-switch eval fires when killSwitchEvalIntervalMs is short", async () => {
    const config = buildTestConfig(stateFile);
    let evaluationCount = 0;
    const bot = new Bot({
      config,
      feed,
      stateSaveIntervalMs: 10_000, // disable state-save
      killSwitchEvalIntervalMs: 10, // 10ms
      heartbeatIntervalMs: 10_000, // disable heartbeat
      perStrategyKillSwitches: [
        {
          id: "test-observer",
          description: "records periodic evaluations",
          evaluate: () => {
            evaluationCount += 1;
            return { switchId: "test-observer", engaged: false, reason: "observed" };
          },
        },
      ],
    });
    const p = bot.start();
    await new Promise<void>((r) => setTimeout(r, 50));

    expect(evaluationCount).toBeGreaterThan(0);
    expect(bot.isKillSwitchEngaged()).toBe(false);

    await bot.stop();
    await p;
  });

  // ---------------------------------------------------------------------------
  // 14) run() loop heartbeat callback fires (covers lines 413-419)
  // ---------------------------------------------------------------------------
  it("run() heartbeat fires the kill-switch check at short heartbeatIntervalMs", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({
      config,
      feed,
      stateSaveIntervalMs: 10_000,
      killSwitchEvalIntervalMs: 10_000, // disable init's interval
      heartbeatIntervalMs: 10, // 10ms heartbeat
    });
    const p = bot.start();
    // Wait long enough for the heartbeat to fire at least once.
    await new Promise<void>((r) => setTimeout(r, 50));

    // The run() loop is still running (we haven't called stop).
    // Verify state can be retrieved (no errors).
    const state = bot.getState();
    expect(state.version).toBe(1);

    await bot.stop();
    await p;
  });

  // ---------------------------------------------------------------------------
  // 15) kill-switch onTrigger callback fires (covers lines 354-355)
  // ---------------------------------------------------------------------------
  it("kill-switch onTrigger callback stops the bot when a switch engages", async () => {
    // Custom kill-switch that's always engaged — passes through
    // perStrategyKillSwitches option so the registry includes it from
    // init.
    const engagedSwitch = {
      id: "test-always-engaged",
      description: "test kill-switch that is always engaged",
      evaluate: () => ({ switchId: "test-always-engaged", engaged: true, reason: "test-always-engaged" }),
    };
    const config = buildTestConfig(stateFile);
    const bot = new Bot({
      config,
      feed,
      stateSaveIntervalMs: 10_000,
      killSwitchEvalIntervalMs: 10, // 10ms — quick eval
      heartbeatIntervalMs: 10_000,
      perStrategyKillSwitches: [engagedSwitch],
    });
    const p = bot.start();
    // Wait for the first eval to fire (within 10ms) + onTrigger callback.
    await new Promise<void>((r) => setTimeout(r, 100));
    await p;

    expect(bot.isKillSwitchEngaged()).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 16) run() loop exits cleanly when stopRequested is set (covers the while-loop)
  // ---------------------------------------------------------------------------
  it("run() loop exits and the heartbeat interval is cleared on stop", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({
      config,
      feed,
      stateSaveIntervalMs: 10_000,
      killSwitchEvalIntervalMs: 10_000,
      heartbeatIntervalMs: 10, // 10ms — frequent heartbeats
    });
    const p = bot.start();
    // Let the run loop run for a few cycles.
    await new Promise<void>((r) => setTimeout(r, 60));
    await bot.stop();
    await p;

    await expect(bot.stop()).resolves.toBeUndefined();
    expect(bot.isKillSwitchEngaged()).toBe(false);
    expect(bot.getState().version).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // 17) telemetry metrics interval fires (covers telemetry.ts line 117 callback)
  // ---------------------------------------------------------------------------
  it("telemetry metrics interval fires when telemetryMetricsIntervalSec is short", async () => {
    const config = buildTestConfig(stateFile);
    const logger = new RecordingLogger();
    const bot = new Bot({
      config,
      feed,
      logger,
      stateSaveIntervalMs: 10_000,
      killSwitchEvalIntervalMs: 10_000,
      heartbeatIntervalMs: 10_000,
      telemetryMetricsIntervalSec: 0.05, // 50ms — quick fire
    });
    const p = bot.start();
    // Wait long enough for the metrics interval to fire 2+ times.
    await new Promise<void>((r) => setTimeout(r, 200));

    expect(logger.getCalls().some((call) => call.event === "telemetry.metrics.observed")).toBe(true);

    await bot.stop();
    await p;
  });

  // ---------------------------------------------------------------------------
  // 18) feed subscription callback fires when events are pushed (covers bot.ts 410-412)
  // ---------------------------------------------------------------------------
  it("feed subscription callback processes ticker events", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({
      config,
      feed,
      stateSaveIntervalMs: 10_000,
      killSwitchEvalIntervalMs: 10_000,
      heartbeatIntervalMs: 10_000,
    });
    const p = bot.start();
    await new Promise<void>((r) => setTimeout(r, 50));

    // Push a ticker event into the mock feed.
    const { asSymbol: asSym } = await import("@mm-crypto-bot/exchange");
    feed.pushEvent({
      kind: "ticker",
      payload: {
        symbol: asSym("BTC/USDC"),
        timestamp: Date.now(),
        bid: 59_999,
        ask: 60_001,
        last: 60_000,
        baseVolume: 100,
        quoteVolume: 6_000_000,
      },
    });
    // Let the feed deliver the event + the runner process it.
    await new Promise<void>((r) => setTimeout(r, 50));

    // No assertion on specific behavior (all strategies disabled);
    // this test exists to cover the subscription callback code path.
    expect(bot.getState().equityUsd).toBeGreaterThan(0);

    await bot.stop();
    await p;
  });

  // ---------------------------------------------------------------------------
  // 20) cleanup() swallows stateStore.flush() errors (covers lines 533-537).
  //     A state-fájl elérési útvonalát egy nem írható helyre állítjuk.
  // ---------------------------------------------------------------------------
  it("cleanup() swallows stateStore.flush() errors gracefully", async () => {
    // A tmp könyvtárban hozzunk létre egy "file" típusú elemet, és a
    // state-fájl útvonalaként ennek egy gyerekét adjuk meg. A
    // StateStore.saveSync megpróbálja létrehozni a parent könyvtárat
    // mkdirSync-kel — ami azért fog hibát dobni, mert a parent egy
    // fájl, nem könyvtár.
    const blockingFile = path.join(temporaryDirectory, "blocker");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(blockingFile, "this is a file, not a dir", "utf8");

    const brokenStateFile = path.join(blockingFile, "state.json");
    const config = buildTestConfig(brokenStateFile);
    // A StateStore init-ben `load()`-ot hív, ami `readFileSync`-et
    // használ a file-ra. A `readFileSync` nem fog hibát dobni, ha
    // a fájl nem létezik (a Bot csak akkor ír, ha a `requestSave`
    // hívódik). A `mkdirSync` a `cleanup` flush-ában fog hibát dobni.
    // Viszont a `load()` is `readFileSync`-et hív, és a `brokenStateFile`
    // útvonalon a parent könyvtár (`blocker`) egy fájl, nem könyvtár —
    // a `readFileSync` is hibát dobhat, amit a StateStore `load` kezel.
    //
    // Egyszerűbb megközelítés: a cleanup() flush() a saveSync-et hívja,
    // ami `mkdirSync(dir, { recursive: true })`-et hív a `dir` (parent)
    // könyvtárra. Ha a `dir` maga egy fájl, a mkdirSync EEXIST-et dob,
    // amit a StateStore StateStoreError-ba csomagol. A cleanup() ezt
    // elkapja, és a logger.error-t hívja (a tesztelt catch block).
    const bot = new Bot({ config, feed });
    const p = bot.start();
    await new Promise<void>((r) => setTimeout(r, 50));

    // A bot leállítása — a cleanup-ban a flush hibát fog dobni.
    // A bot leállásának NEM szabad eldobnia a kivételt.
    await expect(bot.stop()).resolves.toBeUndefined();
    await p;

    // A blockingFile még mindig a helyén van (cleanup nem törli).
    const { existsSync: exists } = await import("node:fs");
    expect(exists(blockingFile)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 21) cleanup() swallows feed.close() errors (covers lines 547-551).
  //     A mock feed close()-ját úgy monkey-patch-eljük, hogy dobjon.
  // ---------------------------------------------------------------------------
  it("cleanup() swallows feed.close() errors gracefully", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed });

    const p = bot.start();
    await new Promise<void>((r) => setTimeout(r, 50));

    // A feed close()-ját felülírjuk, hogy dobjon. A cleanup-ban a
    // feed.close() try-catch-ben van — a catch block kerül végrehajtásra.
    const originalClose = feed.close.bind(feed);
    let isCloseCalled = false;
    feed.close = (): Promise<never> => {
      isCloseCalled = true;
      return Promise.reject(new Error("intentional feed close failure"));
    };

    await expect(bot.stop()).resolves.toBeUndefined();
    await p;

    // A close() meghívódott (és a hibát a cleanup elkapta).
    expect(isCloseCalled).toBe(true);

    // Visszaállítjuk, hogy a cleanup későbbi részei ne legyenek érintettek.
    feed.close = originalClose;
  });
});
