/**
 * packages/exchange/src/latency-monitor.ts
 *
 * Cross-exchange WS / REST latency measurement module — Phase 6 Track B.
 *
 * FELADAT: A spread-arbitrage deployment readiness assessment-hez (Phase 7+)
 * szükséges, hogy a jelenlegi CCXT Pro alapú WS infrastruktúra latency
 * karakterisztikáját mérjük. A cross-exchange arb sub-100ms kell, és
 * a publikus WS endpointok RTT-je, a message gap-ek, valamint a reconnect
 * idő együttesen határozzák meg, hogy a rendszer képes-e erre.
 *
 * MIT MÉRÜNK:
 *   1. RTT (round-trip-time) — REST `fetchTicker` request-response idő.
 *      A REST request-response a legegyszerűbb RTT-proxy, mert minden
 *      exchange-en működik publikus endpointon, és jól korrelál a WS
 *      üzenetek késleltetésével (mivel a TCP stack ugyanaz).
 *   2. Message gap — két consecutive orderbook update közötti idő.
 *      Ez a WS push-alapú feed tényleges frissítési gyakoriságát méri
 *      (binance: ~100-250ms, bybit: ~20-50ms, kucoin: ~100ms tipikusan).
 *   3. Reconnect time — forced disconnect után mennyi idő alatt jön
 *      az első új WS message. Ez a CCXT reconnect logikáját teszteli.
 *
 * Miért NEM `watchPing`-et használunk RTT-re: a CCXT Pro `watch*` API
 * nem egy dedikált WS ping — a CCXT a saját reconnect/exponential-backoff
 * logikáját kezeli, és a WS RTT-t nem a mi kódunk méri. A REST
 * `fetchTicker` egy standard request-response, és az RTT mérésére
 * alkalmas.
 *
 * Források a mérési módszertanhoz:
 *   - docs/research/phase6-arb-latency.md §3 (Methodology)
 *   - CCXT Pro docs: https://docs.ccxt.com/docs/pro-manual
 *   - Phase 5 REPORT §6.2 (a jelenlegi infra 100-300ms RTT sáv)
 */

import ccxt, { type Exchange as CcxtExchange } from "ccxt";
// A CCXT 4.5.x-ben a `ccxt[exchangeId]` a REST-only instance, míg a
// `ccxt.pro[exchangeId]` a WS-támogatással rendelkező instance. A
// `watchOrderBook` és `watchTicker` metódusok csak a pro verzión
// érhetők el — lásd docs/research/stack-findings.md §1.1.
const ccxtPro = (ccxt as unknown as { pro: typeof ccxt }).pro;

// === Támogatott exchange ID-k (CCXT canonical ID-k) ===

/**
 * A CCXT Pro által támogatott exchange ID-k, amelyeknek publikus WS
 * orderbook feedje van és elérhető az EU-ból (regionális korlátozás
 * nélkül). A Phase 6 Track B specifikáció (brief §1.2.2):
 *   - binance: világ legnagyobb CEX, ~$15B napi volume spot
 *   - bybit: 2. legnagyobb derivatív + erős spot
 *   - kucoin: altcoin-ok erős piaca, ~$1B napi volume spot
 *
 * A `bybiteu` a Phase 5 / Phase 6 M1.1 funding-carry-hez használatos,
 * de mivel a MiCAR scope miatt a Phase 6-ban ez a perem, a latency
 * backtest-ből kihagyjuk (külön benchmarkolandó, ha Phase 7+ EU scope).
 */
export type SupportedExchangeId = "binance" | "bybit" | "kucoin" | "bybiteu";

/** A támogatott exchange ID-k listája (iterációhoz / CLI validációhoz). */
export const SUPPORTED_EXCHANGE_IDS: readonly SupportedExchangeId[] = [
  "binance",
  "bybit",
  "kucoin",
  "bybiteu",
] as const;

/**
 * `isSupportedExchangeId` — futásidejű típus-szűkítő.
 */
export function isSupportedExchangeId(s: string): s is SupportedExchangeId {
  return (SUPPORTED_EXCHANGE_IDS as readonly string[]).includes(s);
}

// === Latency sample típusok ===

/**
 * `RttSample` — egy REST request-response RTT mérés eredménye.
 *
 * `method`:
 *   - `"rest"`: REST endpoint round-trip (a jelenlegi implementáció)
 *   - `"ws-ping"`: jövőbeli natív WS ping (ha CCXT Pro expose-olja)
 *
 * `rttMs` — a request indítása és a response beérkezése közötti idő.
 */
export interface RttSample {
  readonly exchangeId: SupportedExchangeId;
  readonly timestamp: number;
  readonly rttMs: number;
  readonly method: "rest" | "ws-ping";
  readonly success: boolean;
}

/**
 * `MessageGapSample` — két consecutive WS üzenet között eltelt idő.
 *
 * `gapMs` — az előző WS message timestamp-je és az aktuális message
 * timestamp-je közötti delta. Az első üzenethez nincs előző, ezért
 * `previousTimestamp` undefined.
 */
export interface MessageGapSample {
  readonly exchangeId: SupportedExchangeId;
  readonly timestamp: number;
  readonly gapMs: number;
  readonly previousTimestamp: number | undefined;
}

/**
 * `ReconnectSample` — egy forced disconnect és az első új WS message
 * közötti idő.
 *
 * `reconnectMs` — a `disconnectAt` és az első új message timestamp-je
 * közötti delta.
 */
export interface ReconnectSample {
  readonly exchangeId: SupportedExchangeId;
  readonly timestamp: number;
  readonly reconnectMs: number;
  readonly disconnectAt: number;
}

/**
 * `LatencySample` — discriminated union a három minta-típusra.
 */
export type LatencySample = RttSample | MessageGapSample | ReconnectSample;

// === Aggregált statisztikák ===

/**
 * `LatencyStats` — aggregált statisztikák egy exchange-re.
 *
 * A `count` mezők az adott kategóriába eső mintaszámot adják. Ha egy
 * exchange nem produkált reconnect-et a mérés során, a `reconnectCount`
 * 0 és a reconnect statisztikák `NaN` (a percentile `NaN` propagációját
 * a kalkuláció során kezeljük).
 */
export interface LatencyStats {
  readonly exchangeId: SupportedExchangeId;
  readonly rttCount: number;
  readonly rttMinMs: number;
  readonly rttMaxMs: number;
  readonly rttMedianMs: number;
  readonly rttP95Ms: number;
  readonly rttP99Ms: number;
  readonly rttSuccessRate: number;
  readonly gapCount: number;
  readonly gapMinMs: number;
  readonly gapMaxMs: number;
  readonly gapMedianMs: number;
  readonly gapP95Ms: number;
  readonly gapP99Ms: number;
  readonly reconnectCount: number;
  readonly reconnectMinMs: number;
  readonly reconnectMaxMs: number;
  readonly reconnectMedianMs: number;
  readonly reconnectP95Ms: number;
}

// === Statisztikai helper függvények ===

/**
 * `percentile` — kiszámítja egy számsorozat adott percentilisét
 * (nearest-rank módszerrel). Üres tömb esetén `NaN`-t ad vissza.
 *
 * A nearest-rank módszer egyszerű és robosztus: az indexet
 * `Math.ceil(p/100 * n) - 1`-re kerekítjük, és a rendezett tömb
 * ezen indexű elemét vesszük. Ez jobban kezeli a kis mintaszámokat
 * (pl. 10 minta, p95 → a legnagyobb érték), mint a lineáris interpoláció.
 *
 * Forrás: NIST/SEMATECH e-handbook, §1.3.3.6 (Percentile).
 */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  if (p <= 0) return Math.min(...values);
  if (p >= 100) return Math.max(...values);
  const sorted = [...values].sort((a, b) => a - b);
  // A nearest-rank formula: ceil(p/100 * n). 1-indexed.
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  // A 0-indexelt tömbben a `rank - 1`-edik elem.
  const index = Math.min(sorted.length - 1, rank - 1);
  // Az `index` garantáltan a tömb határain belül van (0..length-1), de a
  // `noUncheckedIndexedAccess` miatt a TypeScript `number | undefined`-et
  // ad vissza. A `?? NaN` fallback csak akkor aktív, ha a tömb üres —
  // de a függvény tetején már szűrünk erre, szóval ez a sor mindig
  // definiált értéket ad vissza.
  // eslint-disable-next-line security/detect-object-injection -- index derived from numeric rank + length
  return sorted[index] ?? Number.NaN;
}

/**
 * `median` — a számsorozat mediánja (p50). Üres tömb esetén `NaN`.
 */
export function median(values: readonly number[]): number {
  return percentile(values, 50);
}

/**
 * `aggregateStats` — aggregált statisztikák egy exchange összes sample-jából.
 * A sample-okat típus szerint szétválogatja, és mindegyikre kiszámolja
 * a percentiliseket.
 */
export function aggregateStats(
  exchangeId: SupportedExchangeId,
  samples: readonly LatencySample[],
): LatencyStats {
  const rttSamples = samples.filter((s): s is RttSample => "rttMs" in s);
  const gapSamples = samples.filter((s): s is MessageGapSample => "gapMs" in s);
  const reconnectSamples = samples.filter((s): s is ReconnectSample => "reconnectMs" in s);

  const rtts = rttSamples.map((s) => s.rttMs);
  const gaps = gapSamples.map((s) => s.gapMs);
  const reconnects = reconnectSamples.map((s) => s.reconnectMs);

  const successes = rttSamples.filter((s) => s.success).length;

  return {
    exchangeId,
    rttCount: rttSamples.length,
    rttMinMs: rtts.length > 0 ? Math.min(...rtts) : Number.NaN,
    rttMaxMs: rtts.length > 0 ? Math.max(...rtts) : Number.NaN,
    rttMedianMs: median(rtts),
    rttP95Ms: percentile(rtts, 95),
    rttP99Ms: percentile(rtts, 99),
    rttSuccessRate: rttSamples.length > 0 ? successes / rttSamples.length : Number.NaN,
    gapCount: gapSamples.length,
    gapMinMs: gaps.length > 0 ? Math.min(...gaps) : Number.NaN,
    gapMaxMs: gaps.length > 0 ? Math.max(...gaps) : Number.NaN,
    gapMedianMs: median(gaps),
    gapP95Ms: percentile(gaps, 95),
    gapP99Ms: percentile(gaps, 99),
    reconnectCount: reconnectSamples.length,
    reconnectMinMs: reconnects.length > 0 ? Math.min(...reconnects) : Number.NaN,
    reconnectMaxMs: reconnects.length > 0 ? Math.max(...reconnects) : Number.NaN,
    reconnectMedianMs: median(reconnects),
    reconnectP95Ms: percentile(reconnects, 95),
  };
}

// === LatencyMonitor konfiguráció ===

/**
 * `LatencyMonitorConfig` — egy `LatencyMonitor` instance konfigurációja.
 *
 * `exchangeIds`: a mérendő exchange-ek listája.
 * `symbol`: a figyelendő symbol (alap: "BTC/USDT" — a legnagyobb volume).
 * `durationMs`: a teljes mérési idő (alap: 30000 = 30 másodperc).
 * `rttIntervalMs`: két consecutive REST request közötti idő (alap: 500ms).
 * `wsMessageBudget`: max WS üzenet, amit fogadunk (alap: 1000 — memória-biztonság).
 * `measureReconnect`: reconnect időt mérjünk-e (alap: true). Ha true,
 *   a mérés közepén egyszer `close()` + `open()` ciklust hajtunk végre.
 * `forcedDisconnectAtMs`: a reconnect trigger ideje a duration-on belül
 *   (alap: durationMs * 0.5 — a mérés felénél).
 */
export interface LatencyMonitorConfig {
  readonly exchangeIds: readonly SupportedExchangeId[];
  readonly symbol?: string;
  readonly durationMs?: number;
  readonly rttIntervalMs?: number;
  readonly wsMessageBudget?: number;
  readonly measureReconnect?: boolean;
  readonly forcedDisconnectAtMs?: number;
}

/**
 * `LatencyMonitorResult` — a mérés végén visszaadott aggregált eredmény.
 *
 * A `samples` tömb az összes nyers sample-t tartalmazza típus szerint
 * (RttSample | MessageGapSample | ReconnectSample). A `statsByExchange`
 * a per-exchange aggregált statisztikákat adja.
 */
export interface LatencyMonitorResult {
  readonly config: Required<Omit<LatencyMonitorConfig, "exchangeIds">> & {
    readonly exchangeIds: readonly SupportedExchangeId[];
  };
  readonly startedAt: number;
  readonly endedAt: number;
  readonly statsByExchange: Readonly<Record<SupportedExchangeId, LatencyStats>>;
  readonly samples: readonly LatencySample[];
}

// === LatencyMonitor osztály ===

/**
 * `LatencyMonitor` — a CCXT Pro alapú WS/REST latency mintavételező.
 *
 * Egy `start()` hívás elindítja a mérést az összes konfigurált
 * exchange-re. A mérés párhuzamosan fut (Promise.all-al), hogy a
 * duration ne szummázódjon exchange-enként.
 *
 * Az exchange-eket a CCXT factory `new ccxt[exchangeId]({...})` hívással
 * hozzuk létre, az `enableRateLimit: true` flag-gel, hogy a mérés a
 * CCXt rate-limiterrel fusson (a valósághűbb latency-t jellemzi).
 */
export class LatencyMonitor {
  private readonly defaultConfig: Required<Omit<LatencyMonitorConfig, "exchangeIds">>;

  constructor() {
    this.defaultConfig = {
      symbol: "BTC/USDT",
      durationMs: 30_000,
      rttIntervalMs: 500,
      wsMessageBudget: 1000,
      measureReconnect: true,
      forcedDisconnectAtMs: 15_000,
    };
  }

  /**
   * `createExchange` — a CCXT factory egy exchange ID-re. Publikus, hogy
   * a CLI runner és a tesztek is használhassák.
   *
   * `setSandboxMode(true)` NEM hívódik — a valós publikus endpointot
   * mérjük (a sandbox-ok más latency-val rendelkeznek, és a Phase 6
   * M1.2 deployment readiness assessment a production-re vonatkozik).
   */
  createExchange(exchangeId: SupportedExchangeId): CcxtExchange {
    // A `ccxt.pro[exchangeId]` a CCXT 4.5.x Pro (WS-támogatással rendelkező)
    // instance. A sima `ccxt[exchangeId]` REST-only, és a `watch*` metódusok
    // nem elérhetők rajta. Lásd: docs/research/stack-findings.md §1.1.
    const factory = (ccxtPro as unknown as Record<string, new (opts: Record<string, unknown>) => CcxtExchange>)[exchangeId];
    if (factory === undefined) {
      throw new Error(`Ismeretlen exchange ID (pro): ${exchangeId}`);
    }
    return new factory({
      enableRateLimit: true,
      rateLimit: 100,
      // A bybit V5 API defaultType-ot kér, különben a futures endpointra
      // irányítja a kérést. A `spot` a Phase 6 M1.2 (cross-exchange spot
      // arb) scope-hoz illeszkedik.
      options: { defaultType: "spot" },
    });
  }

  /**
   * `measureExchange` — egy konkrét exchange mérése a megadott konfiggal.
   *
   * A mérés lépései (ha minden flag aktív):
   *   1. RTT mintavétel: `rttIntervalMs` időközönként REST request
   *      a `durationMs` végéig.
   *   2. WS message gap: parallel WS subscribe, minden message-nél
   *      gap-mintát veszünk.
   *   3. Reconnect (ha `measureReconnect` true): `forcedDisconnectAtMs`-nél
   *      `close()` + `open()`, és mérjük az első új message idejét.
   */
  async measureExchange(
    exchangeId: SupportedExchangeId,
    config: LatencyMonitorConfig,
  ): Promise<{ samples: LatencySample[]; stats: LatencyStats }> {
    const symbol = config.symbol ?? this.defaultConfig.symbol;
    const durationMs = config.durationMs ?? this.defaultConfig.durationMs;
    const rttIntervalMs = config.rttIntervalMs ?? this.defaultConfig.rttIntervalMs;
    const wsMessageBudget = config.wsMessageBudget ?? this.defaultConfig.wsMessageBudget;
    const measureReconnect = config.measureReconnect ?? this.defaultConfig.measureReconnect;
    const forcedDisconnectAtMs = config.forcedDisconnectAtMs ?? this.defaultConfig.forcedDisconnectAtMs;

    const samples: LatencySample[] = [];
    const exchange = this.createExchange(exchangeId);

    // === RTT mérés (REST request-response) ===
    const rttPromise = this.measureRtt(exchange, exchangeId, symbol, durationMs, rttIntervalMs).then(
      (rttSamples) => {
        samples.push(...rttSamples);
      },
    );

    // === Message gap mérés (WS subscribe) ===
    const gapPromise = this.measureMessageGap(
      exchange,
      exchangeId,
      symbol,
      durationMs,
      wsMessageBudget,
      measureReconnect ? forcedDisconnectAtMs : Number.POSITIVE_INFINITY,
    ).then((gapSamples) => {
      samples.push(...gapSamples);
    });

    await Promise.all([rttPromise, gapPromise]);

    const stats = aggregateStats(exchangeId, samples);
    return { samples, stats };
  }

  /**
   * `measureRtt` — REST request-response RTT mintavétel.
   *
   * Minden `rttIntervalMs` időközönként `fetchTicker(symbol)` hívást
   * indítunk, és mérjük a response beérkezéséig eltelt időt. Ha a
   * hívás sikertelen, a sample `success: false` flag-et kap, és a
   * `rttMs` az elapsed time (a hibás válaszok is torzítják a statisztikát,
   * ezért külön successRate-ot jelentünk).
   */
  private async measureRtt(
    exchange: CcxtExchange,
    exchangeId: SupportedExchangeId,
    symbol: string,
    durationMs: number,
    rttIntervalMs: number,
  ): Promise<RttSample[]> {
    const samples: RttSample[] = [];
    const startTime = Date.now();
    const endTime = startTime + durationMs;

    while (Date.now() < endTime) {
      const t0 = Date.now();
      // A `success` flag a try-catch mindkét ágában definiált: a try
      // siker esetén `true`, a catch hiba esetén `false`. Az explicit
      // `= false` inicializálás a flow-typed control-flow analysis
      // zaját csökkenti, noha a TS strict típusrendszer megköveteli.
      // eslint-disable-next-line no-useless-assignment -- try-catch branch coverage
      let success = false;
      try {
        await exchange.fetchTicker(symbol);
        success = true;
      } catch {
        success = false;
      }
      const elapsed = Date.now() - t0;
      samples.push({
        exchangeId,
        timestamp: t0,
        rttMs: elapsed,
        method: "rest",
        success,
      });
      // Várunk a következő RTT ciklusig (ha még van idő hátra).
      const nextRttAt = t0 + rttIntervalMs;
      const remaining = nextRttAt - Date.now();
      if (remaining > 0) {
        await sleep(Math.min(remaining, endTime - Date.now()));
      }
    }

    return samples;
  }

  /**
   * `measureMessageGap` — WS subscribe + message gap + reconnect tracking.
   *
   * A CCXT Pro `watchOrderBook` stateful iterátor, ami reconnect esetén
   * is folytatódik. A reconnect időt úgy mérjük, hogy a mérés felénél
   * `close()` + `open()` ciklust hajtunk végre, és az első új message
   * timestamp-jétől számítjuk a reconnect időt.
   */
  private async measureMessageGap(
    exchange: CcxtExchange,
    exchangeId: SupportedExchangeId,
    symbol: string,
    durationMs: number,
    wsMessageBudget: number,
    forcedDisconnectAtMs: number,
  ): Promise<LatencySample[]> {
    const samples: LatencySample[] = [];
    let lastMessageAt: number | undefined;
    let reconnectStartAt: number | undefined;
    let messagesSinceConnect = 0;

    const startTime = Date.now();
    const endTime = startTime + durationMs;

    // A WS loop addig fut, amíg a mérési idő el nem telik, VAGY amíg a
    // message budget-et el nem érjük.
    while (Date.now() < endTime && messagesSinceConnect < wsMessageBudget) {
      // A reconnect trigger a mérés felénél (vagy a forcedDisconnectAtMs-nél).
      // A `reconnectStartAt` egyszer triggerelődik (mert utána !== undefined).
      const shouldReconnect =
        reconnectStartAt === undefined &&
        forcedDisconnectAtMs !== Number.POSITIVE_INFINITY &&
        Date.now() - startTime >= forcedDisconnectAtMs;

      if (shouldReconnect) {
        reconnectStartAt = Date.now();
        try {
          await exchange.close();
        } catch {
          // A close() lehet, hogy már le van zárva — ez OK.
        }
        // Várunk egy kicsit, majd újrainicializáljuk az exchange-et.
        await sleep(200);
        // Újracsatlakozás: a CCXT belső state-jét frissítjük egy új
        // `loadMarkets` hívással, ami a WS-t is újraépíti.
        try {
          await exchange.loadMarkets();
        } catch {
          // Ha a loadMarkets is fail, a reconnect sample-t a timeout
          // alapján mérjük (a későbbi message-ig eltelt idő).
        }
        // A `continue` a reconnect ablak lezárása után azonnal a WS
        // loop tetejére ugrik, ahol az új `watchOrderBook` hívás
        // (lent) megpróbálja fogadni az első új message-et.
        continue;
      }

      try {
        // A CCXT Pro `watchOrderBook` a teljes orderbook-ot visszaadja,
        // nem csak a delta-t. Az első hívás blocking (új WS connection),
        // a továbbiak azonnal visszatérnek, ha van új message.
        //
        // Limit: bybit V5 spot csak `[1, 50, 200, 1000]`-et fogad el —
        // más értékkel `NotSupported` hibát dob. A `50` a legkisebb,
        // ami a top-of-book + néhány szint mélységet adja, és minden
        // exchange-en működik.
        await exchange.watchOrderBook(symbol, 50);
        const now = Date.now();
        messagesSinceConnect += 1;

        // Message gap tracking
        if (lastMessageAt !== undefined) {
          samples.push({
            exchangeId,
            timestamp: now,
            gapMs: now - lastMessageAt,
            previousTimestamp: lastMessageAt,
          });
        }
        lastMessageAt = now;

        // Reconnect sample, ha pont most jött az első message a reconnect után.
        if (reconnectStartAt !== undefined) {
          // Ellenőrizzük, hogy ez az első message a reconnect óta.
          const reconnectSamples = samples.filter(
            (s): s is ReconnectSample => "reconnectMs" in s,
          );
          if (reconnectSamples.length === 0) {
            samples.push({
              exchangeId,
              timestamp: now,
              reconnectMs: now - reconnectStartAt,
              disconnectAt: reconnectStartAt,
            });
          }
        }
      } catch {
        // WS hiba — a reconnect ciklus kezeli. Ha a loop itt elakad,
        // a duration timeout-ja leállítja.
        await sleep(50);
      }
    }

    // Cleanup: bezárjuk az exchange-et a mérés végén.
    try {
      await exchange.close();
    } catch {
      // Best-effort cleanup.
    }

    return samples;
  }

  /**
   * `start` — a fő belépési pont. Párhuzamosan méri az összes konfigurált
   * exchange-et, és aggregált eredményt ad vissza.
   */
  async start(config: LatencyMonitorConfig): Promise<LatencyMonitorResult> {
    const startedAt = Date.now();
    const exchangeIds = config.exchangeIds;
    const effectiveConfig = {
      symbol: config.symbol ?? this.defaultConfig.symbol,
      durationMs: config.durationMs ?? this.defaultConfig.durationMs,
      rttIntervalMs: config.rttIntervalMs ?? this.defaultConfig.rttIntervalMs,
      wsMessageBudget: config.wsMessageBudget ?? this.defaultConfig.wsMessageBudget,
      measureReconnect: config.measureReconnect ?? this.defaultConfig.measureReconnect,
      forcedDisconnectAtMs: config.forcedDisconnectAtMs ?? this.defaultConfig.forcedDisconnectAtMs,
    };

    const perExchangeResults = await Promise.all(
      exchangeIds.map(async (id) => {
        try {
          return await this.measureExchange(id, config);
        } catch {
          // Ha egy exchange teljes mérési ciklusa elszáll, üres stats-ot
          // adunk vissza (minden NaN lesz).
          const emptyStats: LatencyStats = {
            exchangeId: id,
            rttCount: 0,
            rttMinMs: Number.NaN,
            rttMaxMs: Number.NaN,
            rttMedianMs: Number.NaN,
            rttP95Ms: Number.NaN,
            rttP99Ms: Number.NaN,
            rttSuccessRate: Number.NaN,
            gapCount: 0,
            gapMinMs: Number.NaN,
            gapMaxMs: Number.NaN,
            gapMedianMs: Number.NaN,
            gapP95Ms: Number.NaN,
            gapP99Ms: Number.NaN,
            reconnectCount: 0,
            reconnectMinMs: Number.NaN,
            reconnectMaxMs: Number.NaN,
            reconnectMedianMs: Number.NaN,
            reconnectP95Ms: Number.NaN,
          };
          return { samples: [] as LatencySample[], stats: emptyStats };
        }
      }),
    );

    const statsByExchange: Record<SupportedExchangeId, LatencyStats> = {} as Record<
      SupportedExchangeId,
      LatencyStats
    >;
    const allSamples: LatencySample[] = [];
    for (let i = 0; i < exchangeIds.length; i += 1) {
      const id = exchangeIds[i];
      if (id === undefined) continue;
      const r = perExchangeResults[i];
      if (r === undefined) continue;
      // eslint-disable-next-line security/detect-object-injection -- id from enum-restricted config, validated by type
      statsByExchange[id] = r.stats;
      allSamples.push(...r.samples);
    }

    return {
      config: { ...effectiveConfig, exchangeIds },
      startedAt,
      endedAt: Date.now(),
      statsByExchange,
      samples: allSamples,
    };
  }
}

/**
 * `sleep` — Promise-alapú setTimeout. A reconnect / RTT ciklusok várakozásához.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * `round2` — 2 tizedesjegyre kerekítés (a JSON output readability-hez).
 * A `Number.toFixed(2)` string-et ad vissza, de nekünk number kell.
 */
export function round2(n: number): number {
  if (!Number.isFinite(n)) return n;
  return Math.round(n * 100) / 100;
}