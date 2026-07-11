/**
 * apps/bot/src/bot/telemetry.ts
 *
 * Phase 33 Track C — `Telemetry` — a futó bot strukturált loggolója
 * és metrika-emittere.
 *
 * ===========================================================================
 * KÉT RÉSZ
 * ===========================================================================
 *   1) `Logger` — a `@mm-crypto-bot/shared` `createLogger` wrapprer-e,
 *      ugyanaz a JSON-formátum, ugyanaz a log-szint szűrés. A bot
 *      mindenütt ezt használja.
 *   2) `MetricsEmitter` — periodikus metrika-emitálás (a config
 *      `telemetry.metrics_interval_sec` alapján, alap: 60s):
 *      - Total equity, daily P&L, current drawdown
 *      - Open positions count
 *      - Orders placed/filled/cancelled counts
 *      - Kill-switch state
 *
 * A metrikák JSON formátumban a `telemetry.log_dir/bot-{date}.log`
 * fájlba íródnak — daily rotáció.
 */

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import type { Logger } from "@mm-crypto-bot/shared";
import { createLogger } from "@mm-crypto-bot/shared";

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
 * - `logDir`            — a log-fájlok könyvtára (default: `logs/bot`).
 * - `metricsIntervalSec` — a metrika-emitálás periódusa (alap: 60s).
 * - `snapshotProvider`   — a snapshot-szolgáltató callback.
 * - `logger`             — opcionális structured logger.
 */
export interface TelemetryOptions {
  readonly logDir?: string;
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
  private readonly logDir: string;
  private readonly metricsIntervalSec: number;
  private readonly snapshotProvider: () => TelemetrySnapshot;
  private readonly logger: Logger;
  private metricsTimer: ReturnType<typeof setInterval> | null = null;
  private engaged = false;
  private engagedReasons: string[] = [];

  public constructor(opts: TelemetryOptions) {
    this.logDir = opts.logDir ?? "logs/bot";
    this.metricsIntervalSec = opts.metricsIntervalSec ?? 60;
    this.snapshotProvider = opts.snapshotProvider;
    this.logger = opts.logger ?? createLogger("info");
  }

  /**
   * `start` — elindítja a metrika-emitáló interval-t.
   */
  public start(): void {
    if (this.metricsTimer !== null) return;
    try {
      if (!existsSync(this.logDir)) {
        mkdirSync(this.logDir, { recursive: true });
      }
    } catch (err) {
      this.logger.error("[telemetry] failed to create log directory", {
        logDir: this.logDir,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    this.metricsTimer = setInterval(() => {
      this.emitMetrics();
    }, this.metricsIntervalSec * 1000);
    this.logger.info("[telemetry] metrics emitter started", {
      logDir: this.logDir,
      metricsIntervalSec: this.metricsIntervalSec,
    });
  }

  /**
   * `stop` — leállítja a metrika-emitáló interval-t. A `Bot.stop()`
 * hívja a graceful shutdown során.
   */
  public stop(): void {
    if (this.metricsTimer !== null) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
      this.logger.info("[telemetry] metrics emitter stopped");
    }
  }

  /**
   * `setEngaged` — a kill-switch registry állapotát közli a Telemetry-vel.
   */
  public setEngaged(engaged: boolean, reasons: readonly string[] = []): void {
    this.engaged = engaged;
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
    const date = new Date().toISOString().slice(0, 10);
    const filePath = join(this.logDir, `bot-${date}.log`);
    // Ensure log directory exists — emitMetrics() can be called before
    // start() (e.g. in unit tests, or before the interval fires).
    if (!existsSync(this.logDir)) {
      try {
        mkdirSync(this.logDir, { recursive: true });
      } catch (err) {
        this.logger.error("[telemetry] failed to create log directory", {
          logDir: this.logDir,
          error: err instanceof Error ? err.message : String(err),
        });
        return;
      }
    }
    const line = JSON.stringify({ ts: new Date().toISOString(), kind: "metrics", ...enriched });
    try {
      appendFileSync(filePath, line + "\n", "utf8");
    } catch (err) {
      this.logger.error("[telemetry] failed to write metrics", {
        filePath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    this.logger.info("[telemetry] metrics", enriched as unknown as Record<string, unknown>);
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
  const seconds = totalSec % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

/**
 * `computeDrawdownPct` — a current drawdown számítása (0..1).
 * drawdown = (peak - current) / peak.
 */
export function computeDrawdownPct(equity: number, _initialEquity: number, peakEquity: number): number {
  if (peakEquity <= 0) return 0;
  const dd = (peakEquity - equity) / peakEquity;
  return dd < 0 ? 0 : dd;
}
