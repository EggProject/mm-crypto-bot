// OhlcStream lifecycle, backfill, and trade-aggregation behavior.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";

import {
  DEFAULT_OHLC_STREAM_CONFIG,
  OhlcStream,
  type OhlcStreamBarEvent,
  type OhlcStreamErrorEvent,
} from "./ohlc-stream.js";
import { MockExchangeFeed } from "./testing/mock-feed.js";
import type { Ohlcv, Trade } from "./types.js";
import { asSymbol } from "./symbols.js";

const SYM = asSymbol("BTC/USDC");
const SYM2 = asSymbol("ETH/USDC");

function mkTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: "t-default",
    symbol: SYM,
    timestamp: 1_700_000_400_000,
    price: 100,
    amount: 1,
    takerSide: "buy",
    ...overrides,
  };
}

function pushTrade(feed: MockExchangeFeed, trade: Trade): void {
  feed.pushEvent({ kind: "trade", payload: trade });
}

function createTestEventEmitter(): EventEmitter {
  // eslint-disable-next-line unicorn/prefer-event-target -- OhlcStream's tested event contract is the Node EventEmitter API.
  return new EventEmitter();
}

describe("OhlcStream (default config)", () => {
  let feed: MockExchangeFeed;
  let emitter: EventEmitter;
  let stream: OhlcStream;

  beforeEach(() => {
    feed = new MockExchangeFeed();
    emitter = createTestEventEmitter();
    for (const tf of DEFAULT_OHLC_STREAM_CONFIG.timeframes) {
      feed.setOhlcv(SYM, tf, []);
    }
    stream = new OhlcStream(feed, emitter);
  });

  afterEach(async () => {
    await stream.stop();
  });

  it("a default config tartalmazza a 6 standard timeframe-öt", () => {
    expect(DEFAULT_OHLC_STREAM_CONFIG.timeframes).toEqual(["1m", "5m", "15m", "1h", "4h", "1d"]);
    expect(DEFAULT_OHLC_STREAM_CONFIG.bufferSize).toBe(1000);
  });

  it("isRunning false a start előtt, true után, false a stop után", async () => {
    expect(stream.isRunning()).toBe(false);
    await stream.start();
    expect(stream.isRunning()).toBe(true);
    await stream.stop();
    expect(stream.isRunning()).toBe(false);
  });

  it("start() idempotens: második hívás nem csinál semmit", async () => {
    await stream.start();
    await stream.start();
    expect(stream.isRunning()).toBe(true);
  });

  it("stop() akkor is biztonságos, ha még nem fut", async () => {
    await stream.stop();
    expect(stream.isRunning()).toBe(false);
  });

  it("start() feliratkozik a trade stream-re minden symbol-ra", async () => {
    feed.setOhlcv(SYM2, "1m", []);
    const customStream = new OhlcStream(feed, emitter, {
      timeframes: ["1m"],
      bufferSize: 10,
      symbols: [SYM, SYM2],
    });
    await customStream.start();
    pushTrade(feed, mkTrade({ symbol: SYM, timestamp: 1_700_000_400_000, price: 100, amount: 1 }));
    pushTrade(feed, mkTrade({ symbol: SYM2, timestamp: 1_700_000_400_000, price: 50, amount: 2 }));
    pushTrade(feed, mkTrade({ symbol: SYM, timestamp: 1_700_000_460_000, price: 110, amount: 1 }));
    pushTrade(feed, mkTrade({ symbol: SYM2, timestamp: 1_700_000_460_000, price: 55, amount: 1 }));
    expect(customStream.bufferSizeOf(SYM, "1m")).toBe(1);
    expect(customStream.bufferSizeOf(SYM2, "1m")).toBe(1);
    await customStream.stop();
  });

  it("ingest(): trade → aktív bar minden timeframe-re, nincs completed bar amíg nincs rollover", () => {
    stream.ingest(mkTrade({ timestamp: 1_700_000_400_000, price: 100, amount: 1 }));
    expect(stream.bufferSizeOf(SYM, "1m")).toBe(0);
    expect(stream.bufferSizeOf(SYM, "5m")).toBe(0);
    expect(stream.bufferSizeOf(SYM, "1h")).toBe(0);
    stream.ingest(mkTrade({ timestamp: 1_700_000_400_000 + 60_000, price: 110, amount: 1 }));
    expect(stream.bufferSizeOf(SYM, "1m")).toBe(1);
    expect(stream.bufferSizeOf(SYM, "5m")).toBe(0);
    expect(stream.bufferSizeOf(SYM, "1h")).toBe(0);
    const bar1m = stream.lastBar(SYM, "1m");
    expect(bar1m).toBeDefined();
    expect(bar1m?.tradeCount).toBe(1);
    expect(bar1m?.open).toBe(100);
    expect(bar1m?.close).toBe(100);
  });

  it("azonos bucketen belüli trade-ek ugyanazt a bar-t töltik (high/low/close frissül)", () => {
    const t0 = 1_700_000_400_000; // 1m grid
    stream.ingest(mkTrade({ timestamp: t0, price: 100, amount: 1 }));
    stream.ingest(mkTrade({ timestamp: t0 + 5000, price: 110, amount: 2, takerSide: "sell" }));
    stream.ingest(mkTrade({ timestamp: t0 + 30_000, price: 95, amount: 1, takerSide: "sell" }));
    expect(stream.bufferSizeOf(SYM, "1m")).toBe(0);
    stream.ingest(mkTrade({ timestamp: t0 + 60_000, price: 105, amount: 1 }));
    const completed = stream.lastBar(SYM, "1m");
    expect(completed?.open).toBe(100);
    expect(completed?.high).toBe(110);
    expect(completed?.low).toBe(95);
    expect(completed?.close).toBe(95);
    expect(completed?.volume).toBe(4); // 1 + 2 + 1
    expect(completed?.tradeCount).toBe(3);
  });

  it("bucket rollover: az új trade új bar-t nyit, a régi bezárul", () => {
    const t0 = 1_700_000_400_000;
    stream.ingest(mkTrade({ timestamp: t0, price: 100, amount: 1 }));
    stream.ingest(mkTrade({ timestamp: t0 + 60_000, price: 110, amount: 1 }));
    stream.ingest(mkTrade({ timestamp: t0 + 120_000, price: 120, amount: 1 }));
    expect(stream.bufferSizeOf(SYM, "1m")).toBe(2);
    const bars = stream.getBars(SYM, "1m");
    expect(bars).toHaveLength(2);
    expect(bars[0]?.open).toBe(100);
    expect(bars[0]?.close).toBe(100);
    expect(bars[0]?.high).toBe(100);
    expect(bars[1]?.open).toBe(110);
    expect(bars[1]?.close).toBe(110);
  });

  it("bar eventet bocsát ki minden bar lezáráskor", () => {
    const seen: OhlcStreamBarEvent[] = [];
    emitter.on("bar", (event: OhlcStreamBarEvent) => {
      seen.push(event);
    });
    stream.ingest(mkTrade({ timestamp: 1_700_000_400_000, price: 100, amount: 1 }));
    stream.ingest(mkTrade({ timestamp: 1_700_000_400_000 + 60_000, price: 110, amount: 1 }));
    expect(seen.length).toBe(1);
    expect(seen[0]?.bar.open).toBe(100);
  });

  it("getBars(symbol, tf) üres tömböt ad, ha a symbol nem a config-ban van", () => {
    expect(stream.getBars(asSymbol("NOPE/USDT"), "1m")).toEqual([]);
  });

  it("getBars(symbol, tf, since) szűri a timestamp-eket", () => {
    const t0 = 1_700_000_400_000;
    stream.ingest(mkTrade({ timestamp: t0, price: 100, amount: 1 }));
    stream.ingest(mkTrade({ timestamp: t0 + 60_000, price: 110, amount: 1 }));
    stream.ingest(mkTrade({ timestamp: t0 + 120_000, price: 120, amount: 1 }));
    const all = stream.getBars(SYM, "1m");
    expect(all).toHaveLength(2);
    expect(all[0]?.timestamp).toBe(t0);
    expect(all[1]?.timestamp).toBe(t0 + 60_000);
    const afterFirst = stream.getBars(SYM, "1m", t0 + 60_001);
    expect(afterFirst).toHaveLength(0);
    const atSecond = stream.getBars(SYM, "1m", t0 + 60_000);
    expect(atSecond).toHaveLength(1);
    expect(atSecond[0]?.timestamp).toBe(t0 + 60_000);
  });

  it("lastBar undefined, ha nincs lezárt bar", () => {
    expect(stream.lastBar(SYM, "1m")).toBeUndefined();
  });

  it("bufferSizeOf 0, ha a (symbol, tf) páros nem a config-ban van", () => {
    expect(stream.bufferSizeOf(asSymbol("NOPE/USDT"), "1m")).toBe(0);
  });

  it("a push valóban ring-el: a buffer mérete a capacity-ig nő, utána nem", () => {
    const small = new OhlcStream(feed, createTestEventEmitter(), {
      timeframes: ["1m"],
      bufferSize: 3,
      symbols: [SYM],
    });
    const t0 = 1_700_000_400_000;
    for (let index = 0; index < 10; index++) {
      small.ingest(mkTrade({ timestamp: t0 + index * 60_000, price: 100 + index, amount: 1 }));
    }
    expect(small.bufferSizeOf(SYM, "1m")).toBe(3);
    const bars = small.getBars(SYM, "1m");
    expect(bars).toHaveLength(3);
    expect(bars[0]?.open).toBe(106);
    expect(bars[2]?.open).toBe(108);
  });

  it("a subscribeTrades-en átjövő trade-ek is összegyűlnek", async () => {
    await stream.start();
    pushTrade(feed, mkTrade({ timestamp: 1_700_000_400_000, price: 100, amount: 1 }));
    pushTrade(feed, mkTrade({ timestamp: 1_700_000_400_000 + 60_000, price: 110, amount: 1 }));
    expect(stream.bufferSizeOf(SYM, "1m")).toBe(1);
  });

  it("a nem-trade FeedEvent típusokat a handleTrade figyelmen kívül hagyja", async () => {
    await stream.start();
    feed.pushEvent({ kind: "ticker", payload: {} as never });
    feed.pushEvent({ kind: "orderbook", payload: {} as never });
    expect(stream.bufferSizeOf(SYM, "1m")).toBe(0);
  });

  it("stop() törli az active bar-okat és újrainicializálja a ring buffereket", async () => {
    await stream.start();
    stream.ingest(mkTrade({ timestamp: 1_700_000_400_000, price: 100, amount: 1 }));
    stream.ingest(mkTrade({ timestamp: 1_700_000_400_000 + 60_000, price: 110, amount: 1 }));
    expect(stream.bufferSizeOf(SYM, "1m")).toBe(1);
    await stream.stop();
    expect(stream.bufferSizeOf(SYM, "1m")).toBe(0);
    expect(stream.lastBar(SYM, "1m")).toBeUndefined();
  });

  it("ha az unsubscribe hibát dob, error eventet bocsát ki és a többit is leiratkozza", async () => {
    await stream.start();
    // Egy mock hibás feed, ami minden unsubscribe-re hibát dob.
    let unsubCalls = 0;
    const failingFeed = new MockExchangeFeed();
    await failingFeed.open();
    await failingFeed.subscribeTrades(SYM, () => {
      // The subscription only establishes fixture state for the unsubscribe failure path.
    });
    const origUnsub = failingFeed.unsubscribe.bind(failingFeed);
    failingFeed.unsubscribe = async (id) => {
      unsubCalls += 1;
      if (unsubCalls === 1) throw new Error("simulated unsubscribe error");
      return origUnsub(id);
    };
    const streamWithFail = new OhlcStream(failingFeed, emitter, {
      timeframes: ["1m"],
      bufferSize: 10,
      symbols: [SYM],
    });
    await streamWithFail.start();
    const errors: OhlcStreamErrorEvent[] = [];
    emitter.on("error", (event: OhlcStreamErrorEvent) => {
      errors.push(event);
    });
    await streamWithFail.stop();
    expect(errors.length).toBe(1);
    expect(errors[0]?.error.message).toContain("simulated unsubscribe error");
    expect(unsubCalls).toBe(1);
  });
});

describe("OhlcStream (egyedi config — 1 symbol, 1 timeframe)", () => {
  it("a konstruktor megőrzi a részleges config-ot", () => {
    const feed = new MockExchangeFeed();
    const s = new OhlcStream(feed, createTestEventEmitter(), {
      timeframes: ["1m"],
      bufferSize: 5,
      symbols: [SYM],
    });
    expect(s.config.timeframes).toEqual(["1m"]);
    expect(s.config.bufferSize).toBe(5);
    expect(s.config.symbols).toEqual([SYM]);
  });
});

describe("OhlcStream — C4 fix: REST backfill on start()", () => {
  it("start() a subscribeTrades ELŐTT feltölti a ring buffer-t a REST history-val", async () => {
    // A C4 fix lényege: a ring buffer NEM üres a start() után. A
    // strategy (ohlc-trend 200-as EMA) azonnal kap history-t, nem
    // kell 8 napot várni az első signalig.
    const feed = new MockExchangeFeed();
    const emitter = createTestEventEmitter();
    // Explicit history-t állítunk be, hogy az ellenőrzés determinisztikus legyen.
    const t0 = 1_700_000_000_000; // UTC 2023-11-14 22:13:20 (1m grid-en)
    const history: Ohlcv[] = [];
    for (let index = 0; index < 5; index++) {
      const ts = t0 + index * 60_000; // 5 db 1m bar
      history.push([ts, 100 + index, 105 + index, 95 + index, 102 + index, 10 + index]);
    }
    feed.setOhlcv(SYM, "1m", history);
    feed.setOhlcv(SYM, "5m", history); // más timeframe-ökre is
    feed.setOhlcv(SYM, "15m", history);
    feed.setOhlcv(SYM, "1h", history);
    feed.setOhlcv(SYM, "4h", history);
    feed.setOhlcv(SYM, "1d", history);

    const stream = new OhlcStream(feed, emitter, {
      timeframes: ["1m", "5m", "15m", "1h", "4h", "1d"],
      bufferSize: 200,
      symbols: [SYM],
    });
    // A start() előtt a buffer üres.
    expect(stream.bufferSizeOf(SYM, "1m")).toBe(0);
    await stream.start();
    // A start() UTÁN minden timeframe-re pontosan 5 backfilled bar van.
    expect(stream.bufferSizeOf(SYM, "1m")).toBe(5);
    expect(stream.bufferSizeOf(SYM, "5m")).toBe(5);
    expect(stream.bufferSizeOf(SYM, "15m")).toBe(5);
    expect(stream.bufferSizeOf(SYM, "1h")).toBe(5);
    expect(stream.bufferSizeOf(SYM, "4h")).toBe(5);
    expect(stream.bufferSizeOf(SYM, "1d")).toBe(5);
    // Az OHLCV mezők helyesen másolódtak át OhlcBar-ra.
    const bar1m = stream.getBars(SYM, "1m");
    expect(bar1m[0]?.open).toBe(100);
    expect(bar1m[0]?.high).toBe(105);
    expect(bar1m[0]?.low).toBe(95);
    expect(bar1m[0]?.close).toBe(102);
    expect(bar1m[0]?.volume).toBe(10);
    // A backfillből nem tudjuk a tradeCount-ot → 0.
    expect(bar1m[0]?.tradeCount).toBe(0);
    await stream.stop();
  });

  it("start() a limit=200 history-t kéri le a feed-től (strategy slowEma period)", async () => {
    // A C4 fix a strategy `slowEma=200` periódusával egyező backfillt
    // végez. Ellenőrizzük, hogy a feed a megfelelő `limit` értéket
    // kapja.
    const feed = new MockExchangeFeed();
    const emitter = createTestEventEmitter();
    let observedLimit: number | undefined;
    const origFetch = feed.fetchOHLCV.bind(feed);
    feed.fetchOHLCV = async (symbol, timeframe, since, limit) => {
      observedLimit = limit;
      return origFetch(symbol, timeframe, since, limit);
    };
    const stream = new OhlcStream(feed, emitter, {
      timeframes: ["1m"],
      bufferSize: 200,
      symbols: [SYM],
    });
    await stream.start();
    expect(observedLimit).toBe(200);
    await stream.stop();
  });

  it("backfill() segédmetódus közvetlenül is hívható (test + backtest path)", async () => {
    // A backfill() publikus, hogy a backtest fixture és a tesztek
    // közvetlenül is használhassák a history seed-elésre.
    const feed = new MockExchangeFeed();
    await feed.open();
    const emitter = createTestEventEmitter();
    const t0 = 1_700_000_000_000;
    feed.setOhlcv(SYM, "1h", [
      [t0, 100, 110, 90, 105, 50],
      [t0 + 3_600_000, 105, 115, 100, 110, 60],
    ]);
    const stream = new OhlcStream(feed, emitter, {
      timeframes: ["1h"],
      bufferSize: 200,
      symbols: [SYM],
    });
    await stream.backfill(SYM, "1h", 200);
    expect(stream.bufferSizeOf(SYM, "1h")).toBe(2);
    expect(stream.getBars(SYM, "1h")[0]?.close).toBe(105);
    expect(stream.getBars(SYM, "1h")[1]?.close).toBe(110);
  });

  it("ha a feed üres history-t ad vissza, a buffer üres marad (graceful degradation)", async () => {
    // A REST endpoint átmenetileg elérhetetlen lehet, vagy új
    // symbol-on 0 history van. A C4 fix NEM throw-ol — a start()
    // sikeres, és a trade-ek szépen aggregálódnak a 0-ról induló
    // bufferbe.
    const feed = new MockExchangeFeed();
    const emitter = createTestEventEmitter();
    feed.setOhlcv(SYM, "1m", []);
    const stream = new OhlcStream(feed, emitter, {
      timeframes: ["1m"],
      bufferSize: 200,
      symbols: [SYM],
    });
    await stream.start();
    expect(stream.bufferSizeOf(SYM, "1m")).toBe(0);
    // Az első trade az aktív bar-t seed-eli, és a backfill utáni
    // 0. completed bar-ról indulunk tovább.
    stream.ingest(mkTrade({ timestamp: 1_700_000_400_000, price: 100, amount: 1 }));
    expect(stream.bufferSizeOf(SYM, "1m")).toBe(0);
    await stream.stop();
  });
});

describe("OhlcStream — C5 fix: out-of-order trade detection", () => {
  it("a késői trade (current bar-nál korábbi bucket) eldobódik, és a counter nő", () => {
    // 1. Aktív bar seed-elése t0-n.
    // 2. Rollover egy új bucketbe (t0+60s).
    // 3. KÉSŐ trade jön t0-30s timestamp-pel (a régi bucketbe tartozik).
    // A C5 fix ezt a trade-et eldobja, a counter 1-re nő, és a
    // ring buffer tartalma változatlan marad (1 completed bar).
    const t0 = 1_700_000_400_000; // 1m grid-en
    const stream = new OhlcStream(new MockExchangeFeed(), createTestEventEmitter(), {
      timeframes: ["1m"],
      bufferSize: 10,
      symbols: [SYM],
    });
    expect(stream.droppedLateTrades()).toBe(0);

    stream.ingest(mkTrade({ timestamp: t0, price: 100, amount: 1 }));
    stream.ingest(mkTrade({ timestamp: t0 + 60_000, price: 110, amount: 1 }));
    // 2 trade → 1 completed bar (az 1. lezárult, a 2. aktív).
    expect(stream.bufferSizeOf(SYM, "1m")).toBe(1);
    expect(stream.droppedLateTrades()).toBe(0);

    // Késői trade: bucketStart = t0-60_000 (a korábbi perc), ami < t0+60_000.
    stream.ingest(mkTrade({ timestamp: t0 - 30_000, price: 95, amount: 1 }));
    // A counter 1-re nőtt, a ring buffer VÁLTOZATLAN.
    expect(stream.droppedLateTrades()).toBe(1);
    expect(stream.bufferSizeOf(SYM, "1m")).toBe(1);
  });

  it("az aktív bar értékei nem korruptálódnak késői trade hatására", () => {
    // Specifikus regression teszt: a C5 fix előtt a késői trade
    // lezárta az aktív bart és seed-elt egy újat a múltban, így a
    // `lastBar.close` értéke a késői trade price-ára ugrott.
    // Most: a késői trade eldobódik, az aktív bar close értéke
    // változatlan.
    const t0 = 1_700_000_400_000;
    const stream = new OhlcStream(new MockExchangeFeed(), createTestEventEmitter(), {
      timeframes: ["1m"],
      bufferSize: 10,
      symbols: [SYM],
    });
    // Aktív bar seed-elése t0-n, close=100.
    stream.ingest(mkTrade({ timestamp: t0, price: 100, amount: 1 }));
    // Rollover t0+60s, új aktív bar close=110.
    stream.ingest(mkTrade({ timestamp: t0 + 60_000, price: 110, amount: 1 }));
    // Késői trade: t0-30s, price=999. Ha nem lenne C5 fix, az
    // aktív bar lezárulna (close=110), és a késői trade-ből új
    // bar seed-elődne (close=999) a `active` map-ben.
    stream.ingest(mkTrade({ timestamp: t0 - 30_000, price: 999, amount: 1 }));
    // Most: az aktív bar (a `lastBar` mivel nincs lezárt bar a t0+60s után)
    // HIBÁSAN nézi ki a ring buffer-ből — a teszt a bufferSizeOf-szal
    // és a droppedLateTrades counter-rel ellenőrzi a C5 fixet.
    expect(stream.droppedLateTrades()).toBe(1);
    // A ring bufferben 1 bar van (a t0-n lezárt), és NEM 2 (nem
    // zárt le egy második bart a késői trade).
    expect(stream.bufferSizeOf(SYM, "1m")).toBe(1);
    expect(stream.getBars(SYM, "1m")[0]?.close).toBe(100);
  });

  it("a dropped counter több késői trade-re is növekszik", () => {
    const t0 = 1_700_000_400_000;
    const stream = new OhlcStream(new MockExchangeFeed(), createTestEventEmitter(), {
      timeframes: ["1m"],
      bufferSize: 10,
      symbols: [SYM],
    });
    stream.ingest(mkTrade({ timestamp: t0, price: 100, amount: 1 }));
    stream.ingest(mkTrade({ timestamp: t0 + 60_000, price: 110, amount: 1 }));
    stream.ingest(mkTrade({ timestamp: t0 - 30_000, price: 90, amount: 1 }));
    stream.ingest(mkTrade({ timestamp: t0 - 90_000, price: 80, amount: 1 }));
    stream.ingest(mkTrade({ timestamp: t0 + 30_000, price: 105, amount: 1 })); // t0+30s, current=t0+60s → késői
    expect(stream.droppedLateTrades()).toBe(3);
  });

  it("a normál (in-order) trade-ek NEM növelik a dropped countert", () => {
    const t0 = 1_700_000_400_000;
    const stream = new OhlcStream(new MockExchangeFeed(), createTestEventEmitter(), {
      timeframes: ["1m"],
      bufferSize: 10,
      symbols: [SYM],
    });
    // 5 in-order trade: aktív bar seed + 4 rollover.
    for (let index = 0; index < 5; index++) {
      stream.ingest(mkTrade({ timestamp: t0 + index * 60_000, price: 100 + index, amount: 1 }));
    }
    expect(stream.droppedLateTrades()).toBe(0);
    expect(stream.bufferSizeOf(SYM, "1m")).toBe(4);
  });

  it("a késői trade warning logot ír a console-ra (diagnosztika)", () => {
    // A C5 fix console.warn-nel jelzi a késői trade-et, hogy a
    // üzemeltető lássa a normál üzemtől való eltérést.
    const t0 = 1_700_000_400_000;
    const stream = new OhlcStream(new MockExchangeFeed(), createTestEventEmitter(), {
      timeframes: ["1m"],
      bufferSize: 10,
      symbols: [SYM],
    });
    stream.ingest(mkTrade({ timestamp: t0, price: 100, amount: 1 }));
    stream.ingest(mkTrade({ timestamp: t0 + 60_000, price: 110, amount: 1 }));
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...arguments_: unknown[]) => {
      warnings.push(arguments_.map(String).join(" "));
    };
    try {
      stream.ingest(mkTrade({ timestamp: t0 - 30_000, price: 95, amount: 1 }));
    } finally {
      console.warn = origWarn;
    }
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("dropped late trade");
    expect(warnings[0]).toContain("BTC/USDC");
    expect(warnings[0]).toContain("1m");
  });
});
