/**
 * apps/bot/src/bot/telemetry.ts
 *
 * Phase 33 Track C — `Telemetry` — a futó bot strukturált loggolója
 * és metrika-emittere.
 *
 * ===========================================================================
 * KÉT RÉSZ
 * ===========================================================================
 *   1) `Logger` — injected structured runtime logger,
 *      ugyanaz a JSON-formátum, ugyanaz a log-szint szűrés. A bot
 *      mindenütt ezt használja.
 *   2) `MetricsEmitter` — periodikus metrika-emitálás (a config
 *      `telemetry.metrics_interval_sec` alapján, alap: 60s):
 *      - Total equity, daily P&L, current drawdown
 *      - Open positions count
 *      - Orders placed/filled/cancelled counts
 *      - Kill-switch state
 *
 * Metrics are emitted through the injected structured logger.
 */

import { requireLogger, type Logger } from "@mm-crypto-bot/logging";

// ============================================================================
// Public types
// ============================================================================

/**
 * `TelemetrySnapshot` — a metrikák pillanatképe. A `Bot` tölti fel
 * minden metrika-emit előtt.
 */
export interface TelemetrySnapshot {
  readonly equityUsd: number;
  readonly initialEquityUsd: number;
  readonly realizedPnlUsd: number;
  readonly unrealizedPnlUsd: number;
  readonly drawdownPct: number;
  readonly openPositions: number;
  readonly maxPositions: number;
  readonly counters: {
    readonly placed: number;
    readonly filled: number;
    readonly cancelled: number;
    readonly rejected: number;
  };
  readonly killSwitchEngaged: boolean;
  readonly killSwitchReasons: readonly string[];
  readonly uptime: number;
  readonly uptimeHuman: string;
  readonly activeStrategies: readonly string[];
}

/**
 * `TelemetryOptions` — a Telemetry konfigurációja.
 *
 * - `metricsIntervalSec` — a metrika-emitálás periódusa (alap: 60s).
 * - `snapshotProvider`   — a snapshot-szolgáltató callback.
 * - `logger`             — injected structured logger.
 */
export interface TelemetryOptions {
  readonly metricsIntervalSec?: number;
  readonly snapshotProvider: () => TelemetrySnapshot;
  readonly logger?: Logger;
}

// ============================================================================
// Telemetry class
// ============================================================================

/**
 * `Telemetry` — a bot telemetriai központja. Egyszerre `Logger`
 * (strukturált loggolás) és `MetricsEmitter` (periodikus metrikák).
 *
 * A `start()` elindítja a metrika-emitáló interval-t; a `stop()`
 * leállítja. A `setEngaged()` a kill-switch registry-ből jön, és
 * a metrika-snapshot-ot gazdagítja.
 */
export class Telemetry {
  private readonly metricsIntervalSec: number;
  private readonly snapshotProvider: () => TelemetrySnapshot;
  private readonly logger: Logger;
  private metricsTimer: ReturnType<typeof setInterval> | undefined;
  private engaged = false;
  private engagedReasons: string[] = [];

  public constructor(options: TelemetryOptions) {
    this.metricsIntervalSec = options.metricsIntervalSec ?? 60;
    this.snapshotProvider = options.snapshotProvider;
    this.logger = requireLogger(options.logger, "telemetry");
  }

  /**
   * `start` — elindítja a metrika-emitáló interval-t.
   */
  public start(): void {
    if (this.metricsTimer !== undefined) return;
    this.metricsTimer = setInterval(() => {
      this.emitMetrics();
    }, this.metricsIntervalSec * 1000);
    this.logger.info("telemetry.metrics.started", {
      metricsIntervalSec: this.metricsIntervalSec,
    });
  }

  /**
   * `stop` — leállítja a metrika-emitáló interval-t. A `Bot.stop()`
   * hívja a graceful shutdown során.
   */
  public stop(): void {
    if (this.metricsTimer === undefined) return;
    clearInterval(this.metricsTimer);
    this.metricsTimer = undefined;
    this.logger.info("telemetry.metrics.stopped");
  }

  /**
   * `setEngaged` — a kill-switch registry állapotát közli a Telemetry-vel.
   */
  public setEngaged(isEngaged: boolean, reasons: readonly string[] = []): void {
    this.engaged = isEngaged;
    this.engagedReasons = [...reasons];
  }

  /**
   * `getLogger` — a strukturált logger accessor. A `Bot` ezt adja
   * tovább a többi komponensnek.
   */
  public getLogger(): Logger {
    return this.logger;
  }

  /**
   * `emitMetrics` — egyetlen metrika-emit. A `start()` által beállított
   * interval automatikusan hívja, de a wire-up probe-ban közvetlenül
   * is hívható.
   */
  public emitMetrics(): void {
    const baseSnapshot = this.snapshotProvider();
    const enriched: TelemetrySnapshot = {
      ...baseSnapshot,
      killSwitchEngaged: this.engaged,
      killSwitchReasons: this.engagedReasons,
    };
    this.logger.info("telemetry.metrics.observed", {
      activeStrategies: enriched.activeStrategies,
      counters: { ...enriched.counters },
      drawdownPct: enriched.drawdownPct,
      equityUsd: enriched.equityUsd,
      initialEquityUsd: enriched.initialEquityUsd,
      killSwitchEngaged: enriched.killSwitchEngaged,
      killSwitchReasons: enriched.killSwitchReasons,
      maxPositions: enriched.maxPositions,
      openPositions: enriched.openPositions,
      realizedPnlUsd: enriched.realizedPnlUsd,
      unrealizedPnlUsd: enriched.unrealizedPnlUsd,
      uptime: enriched.uptime,
      uptimeHuman: enriched.uptimeHuman,
    });
  }
}

// ============================================================================
// Helper utilities
// ============================================================================

/**
 * `formatUptime` — emberi olvasásra szánt uptime string (pl. "2h 15m").
 */
export function formatUptime(ms: number): string {
  if (ms < 0) return "0s";
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  if (hours > 0) {
    return `${String(hours)}h ${String(minutes)}m`;
  }
  const seconds = totalSec % 60;
  if (minutes > 0) {
    return `${String(minutes)}m ${String(seconds)}s`;
  }
  return `${String(seconds)}s`;
}

/**
 * `computeDrawdownPct` — a current drawdown számítása (0..1).
 * drawdown = (peak - current) / peak.
 */
export function computeDrawdownPct(equity: number, _initialEquity: number, peakEquity: number): number {
  if (peakEquity <= 0) return 0;
  const drawdown = (peakEquity - equity) / peakEquity;
  return Math.max(0, drawdown);
}
