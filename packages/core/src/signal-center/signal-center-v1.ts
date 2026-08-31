import type { Bar, Signal } from "./types.js";
import { isCarry, isRisk, isSizing } from "./types.js";
import { type StrategyPlugin, type StrategyRegistry, createStrategyRegistry } from "./strategy-registry.js";
import { type SignalBus, createSignalBus } from "./signal-bus.js";
import { assertAggregateEffectiveExposureLimit } from "../risk/leverage-invariant.js";
import {
  PortfolioRiskEngine,
  type RiskSnapshot,
  type SizingSignal as RiskEngineSizingSignal,
  type RiskSignal as RiskEngineRiskSignal,
} from "../risk/portfolio-risk-engine.js";
import {
  StrategyTelemetry,
  type TelemetrySnapshot,
  type TradeRecord,
  type KillSwitchEvent,
} from "../telemetry/strategy-telemetry.js";
import { createSignalCenterV1Config, type SignalCenterV1Config } from "./signal-center-v1-config.js";
import {
  emitAggregateEffectiveExposureLimitBreachIfNeeded,
  toRiskEngineSignal,
} from "./signal-center-v1-lifecycle.js";

export {
  DEFAULT_SIGNAL_CENTER_V1_BASELINE,
  DEFAULT_SIGNAL_CENTER_V1_CONFIG,
  type SignalCenterV1Config,
} from "./signal-center-v1-config.js";
export { toRiskEngineSignal } from "./signal-center-v1-lifecycle.js";

// ---------------------------------------------------------------------------
// SignalCenterV1 — main composition class
// ---------------------------------------------------------------------------

/**
 * `SignalCenterV1` — single entrypoint for the Signal Center stack.
 *
 * Lifecycle:
 *   1. **Construct**: `new SignalCenterV1({ config })`. Validates config
 *      (Layer 1 of 3-layer defense). Initializes bus, registry, risk
 *      engine, telemetry.
 *   2. **Register**: `sc.registerPlugin(plugin)`. The plugin is added to
 *      the registry (which enforces maxAggregateEffectiveLeverage ≤ 10 per plugin).
 *   3. **Start**: `sc.start()`. Validates ALL plugins' configs
 *      (`registry.validateAll()`). Runs `assertAggregateEffectiveExposureLimit` on
 *      the risk engine's initial notional state at boot (Layer 2 of
 *      3-layer defense). Wires plugins to the bus.
 *   4. **Drive**: `sc.onBar(bar)` once per bar. Dispatches to plugins,
 *      collects signals via the bus, runs risk engine, updates
 *      telemetry, runs `leverageInvariantGuard` (Layer 3 of 3-layer
 *      defense).
 *   5. **Snapshot**: `sc.getTelemetrySnapshot()` and
 *      `sc.getPortfolioRisk()` for monitoring / dashboards.
 *   6. **Kill**: `sc.killPlugin(name)` mid-flight to disable a plugin
 *      (latching kill-switch via telemetry).
 *   7. **Reset**: `sc.reset()` between backtest re-runs.
 *
 * Architecture parity target: Phase 9 V4 multi-class ensemble envelope
 * (+4.95%/month AVG). The Phase 10G Track C baseline has only the
 * CarryBaselinePlugin enabled — the empirical envelope is the PURE-CARRY
 * portion (~+2.2%/month). Phase 11+ drop-ins should approach V4's
 * envelope as more plugins register.
 */
export class SignalCenterV1 {
  /**
   * Whether `start()` has been called. Until then, `onBar` is a no-op.
   */
  private _started = false;
  /**
   * Total bars processed for diagnostics.
   */
  private _barCount = 0;
  /**
   * Total signals submitted to the risk engine.
   */
  private _signalsSubmitted = 0;
  /**
   * Total bus emissions after dispatch.
   */
  private _busEmissions = 0;

  readonly config: SignalCenterV1Config;
  readonly bus: SignalBus;
  readonly registry: StrategyRegistry;
  readonly riskEngine: PortfolioRiskEngine;
  readonly telemetry: StrategyTelemetry;

  constructor(config: Partial<SignalCenterV1Config> = {}) {
    const merged = createSignalCenterV1Config(config);
    this.config = merged;
    this.bus = createSignalBus({
      mode: "backtest",
      ...(merged.symbol !== undefined && { scopeSymbol: merged.symbol }),
    });
    this.registry = createStrategyRegistry();
    this.riskEngine = new PortfolioRiskEngine({
      ...merged.riskEngine,
      leverageInvariant: merged.leverageInvariant,
    });
    this.telemetry = new StrategyTelemetry(merged.telemetry);
    this.bus.setSignalGate((signal) => {
      const sourcePlugin = signal.source.split(":", 1)[0];
      return sourcePlugin !== undefined && !this.telemetry.isPluginDisabled(sourcePlugin);
    });

    // Subscribe the central risk engine + telemetry to ALL bus signals.
    // The risk engine only cares about SizingSignals (which carry notional
    // info). The telemetry cares about all kinds for firstSeen/lastSeen
    // bookkeeping. We route based on `kind`.
    this.bus.subscribe("direction", (s: Signal) => {
      this.ingestSignal(s);
    });
    this.bus.subscribe("carry", (s: Signal) => {
      this.ingestSignal(s);
    });
    this.bus.subscribe("sizing", (s: Signal) => {
      this.ingestSignal(s);
    });
    this.bus.subscribe("risk", (s: Signal) => {
      this.ingestSignal(s);
    });
    this.bus.subscribe("factor", (s: Signal) => {
      this.ingestSignal(s);
    });
    this.bus.subscribe("funding-snapshot", (s: Signal) => {
      this.ingestSignal(s);
    });
  }

  private ingestSignal(signal: Signal): void {
    this._busEmissions += 1;
    const telemetrySignal = toRiskEngineSignal(
      signal,
      signal.symbol ?? this.config.symbol ?? "?",
      this.config.initialEquity,
    );
    this.telemetry.submitSignal(telemetrySignal);
    if (isSizing(signal)) {
      const riskSignal: RiskEngineSizingSignal = {
        kind: "sizing",
        source: signal.source,
        symbol: signal.symbol ?? this.config.symbol ?? "?",
        effectiveNotionalUsd: signal.notional,
        leverage: signal.notional > 0 ? signal.notional / this.config.initialEquity : 0,
        timestamp: signal.timestampMs ?? 0,
      };
      this.riskEngine.submitSignal(riskSignal);
      this._signalsSubmitted += 1;
    } else if (isCarry(signal)) {
      return;
    } else if (isRisk(signal)) {
      const riskSignal: RiskEngineRiskSignal = {
        kind: "risk",
        source: signal.source,
        drawdownLimit: signal.drawdownLimit,
        varDaily95: signal.varDaily95,
        reason: signal.reason ?? signal.source,
        timestamp: signal.timestampMs ?? 0,
        breach: signal.breach ?? false,
      };
      this.riskEngine.submitSignal(riskSignal);
      this._signalsSubmitted += 1;
    }
  }

  // -------------------------------------------------------------------------
  // Plugin management
  // -------------------------------------------------------------------------

  /**
   * `registerPlugin` — add a plugin to the registry. The registry enforces
   * `maxAggregateEffectiveLeverage ≤ 10` per plugin (Track A guardrail). Plugins that throw
   * in their constructor (e.g., `validateTimingLeverage` failure) are
   * surfaced here.
   */
  registerPlugin(plugin: StrategyPlugin): void {
    if (this._started) {
      throw new Error(
        `[SignalCenterV1] registerPlugin: cannot register after start(). ` +
          `Call registerPlugin() before start() so the bus wiring is stable.`,
      );
    }
    this.registry.register(plugin);
  }

  /**
   * `killPlugin` — disable a plugin via the telemetry module's
   * latching kill-switch. Subsequent signals from that plugin are
   * dropped by `submitSignal()` in StrategyTelemetry (it filters out
   * signals from disabled sources).
   *
   * The plugin is NOT unregistered from the registry — it remains wired
   * to the bus (so its onBar still runs), but its signals are dropped at
   * the telemetry layer. This matches the HKMA / FIA / OpenAlgo
   * practitioner guidance (L1 soft pause = "keep wiring, drop signals").
   *
   * Returns true if the plugin was newly disabled, false if it was
   * already disabled or not found.
   */
  killPlugin(name: string, reason = "manual kill-switch"): boolean {
    if (!this.registry.get(name)) return false;
    if (this.telemetry.isPluginDisabled(name)) return false;
    this.telemetry.disablePlugin(name, reason);
    return true;
  }

  /**
   * `enablePlugin` — re-enable a previously killed plugin. Manual
   * reset only (no auto-reset — matches the OpenAlgo kill-switch
   * latching principle).
   */
  enablePlugin(name: string, reason = "manual reset"): boolean {
    if (!this.telemetry.isPluginDisabled(name)) return false;
    this.telemetry.enablePlugin(name, reason);
    return true;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * `start` — boot the SCv1. Validates all plugin configs, runs the
   * Layer-2 `assertAggregateEffectiveExposureLimit` on the risk engine's initial
   * notional state at boot, then wires plugins to the bus.
   */
  start(): void {
    if (this._started) {
      throw new Error(`[SignalCenterV1] start() called twice. Call reset() first.`);
    }
    // Validate ALL plugin configs (aggregated errors).
    const v = this.registry.validateAll();
    if (!v.ok) {
      throw new Error(`[SignalCenterV1] Boot validation failed: ${v.error.summary}`);
    }
    if (this.registry.size === 0) {
      throw new Error(
        `[SignalCenterV1] start() called with 0 plugins. ` +
          `At least one plugin must be registered before start().`,
      );
    }
    // Layer 2 of 3-layer defense: assert that the risk engine's initial
    // notional state at boot does not breach the aggregate effective-exposure cap. In
    // normal use the risk engine is empty at boot (totalNotionalUsd = 0),
    // so this is a defense-in-depth fail-fast: if a misuse pre-populated
    // positions (or a previous run left state), start() throws here
    // BEFORE any plugin is wired and BEFORE any onBar() can fire.
    const positions = this.riskEngine.getPositions();
    const totalNotionalUsd = positions.reduce((sum, p) => sum + Math.abs(p.effectiveNotionalUsd), 0);
    assertAggregateEffectiveExposureLimit(
      totalNotionalUsd,
      this.config.initialEquity,
      this.config.leverageInvariant,
    );
    // Wire all plugins to the bus.
    this.registry.wireAll(this.bus);
    this._started = true;
  }

  /**
   * `reset` — clear all state for a fresh backtest run. Calls
   * `registry.resetAll()` (per-plugin reset), `bus.clear()`,
   * `riskEngine.clear()`, and `telemetry.clear()`.
   */
  reset(): void {
    this.registry.disposeAll();
    this.registry.resetAll();
    this.bus.clear();
    this.riskEngine.clear();
    this.telemetry.clear();
    this._started = false;
    this._barCount = 0;
    this._signalsSubmitted = 0;
    this._busEmissions = 0;
  }

  // -------------------------------------------------------------------------
  // Per-bar dispatch
  // -------------------------------------------------------------------------

  /**
   * `onBar` — main per-bar update. Drives all plugins (via
   * `registry.onBarAll`), collects signals emitted by plugins on the bus
   * (the bus's subscribers route them through `ingestSignal` to the risk
   * engine and telemetry), and runs the per-bar `leverageInvariantGuard`
   * (Layer 3 of 3-layer defense).
   *
   * If `start()` has not been called, `onBar` is a SILENT no-op (defensive
   * — allows plugins to be registered lazily without crashing).
   *
   * Returns the per-bar telemetry snapshot for callers that want a
   * per-bar state vector.
   */
  onBar(bar: Bar): TelemetrySnapshot {
    if (!this._started) {
      // No-op before start(). Defensive — silent in backtest mode.
      return this.telemetry.snapshot();
    }
    this._barCount += 1;
    // Drive all plugins. They emit signals on the bus via their subscribe
    // closure. Errors are swallowed at the registry layer (defensive
    // isolation — one misbehaving plugin doesn't crash the whole stack).
    this.registry.onBarAll(bar, undefined);
    emitAggregateEffectiveExposureLimitBreachIfNeeded(this.riskEngine, this.config, this.bus);
    return this.telemetry.snapshot();
  }

  /**
   * Async causal variant required by plugins backed by async adapters.
   */
  async onBarAsync(bar: Bar): Promise<TelemetrySnapshot> {
    if (!this._started) return this.telemetry.snapshot();
    this._barCount += 1;
    await this.registry.onBarAllAsync(bar, undefined);
    emitAggregateEffectiveExposureLimitBreachIfNeeded(this.riskEngine, this.config, this.bus);
    return this.telemetry.snapshot();
  }

  /**
   * JSON-serializable per-strategy telemetry state.
   */
  getTelemetrySnapshot(): TelemetrySnapshot {
    return this.telemetry.snapshot();
  }

  /**
   * JSON-serializable cross-strategy risk state.
   */
  getPortfolioRisk(capital?: number): RiskSnapshot {
    return this.riskEngine.snapshot(capital ?? this.config.initialEquity);
  }

  /**
   * All recorded kill-switch events.
   */
  getKillSwitchHistory(): readonly KillSwitchEvent[] {
    return this.telemetry.getKillSwitchHistory();
  }

  /**
   * Names of currently disabled plugins.
   */
  getDisabledPlugins(): readonly string[] {
    return this.telemetry.getDisabledPlugins();
  }

  /**
   * True if start() has been called.
   */
  get isStarted(): boolean {
    return this._started;
  }

  /**
   * Number of bars processed after start.
   */
  get barCount(): number {
    return this._barCount;
  }

  /**
   * Number of signals submitted to the risk engine.
   */
  get signalsSubmitted(): number {
    return this._signalsSubmitted;
  }

  /**
   * Number of bus emissions since the last reset.
   */
  get busEmissions(): number {
    return this._busEmissions;
  }

  /**
   * Whether the named registered plugin is currently disabled.
   */
  isPluginKilled(name: string): boolean {
    return this.telemetry.isPluginDisabled(name);
  }

  /**
   * Metadata for all registered plugins.
   */
  getRegisteredPlugins(): readonly {
    name: string;
    version: string;
    edgeClass: string;
    maxAggregateEffectiveLeverage: number;
  }[] {
    return this.registry.list().map((metadata) => ({
      name: metadata.name,
      version: metadata.version,
      edgeClass: metadata.edgeClass,
      maxAggregateEffectiveLeverage: metadata.maxAggregateEffectiveLeverage,
    }));
  }

  // -------------------------------------------------------------------------
  // Test-only / introspection helpers
  // -------------------------------------------------------------------------

  /**
   * `recordTrade` — attribute a trade to a strategy source (for telemetry).
   * Test/backtest harness convenience — typically called by the central
   * runner when a trade fills.
   */
  recordTrade(trade: TradeRecord): void {
    this.telemetry.recordTrade(trade);
  }

  /**
   * `recordSourceReturn` — feed a daily return observation to the risk
   * engine. Test/backtest harness convenience.
   */
  recordSourceReturn(source: string, timestamp: number, returnPct: number): void {
    this.riskEngine.recordSourceReturn(source, timestamp, returnPct);
  }

  /**
   * `recordEquitySnapshot` — feed an equity snapshot to the risk engine
   * for drawdown tracking. Test/backtest harness convenience.
   */
  recordEquitySnapshot(timestamp: number, equityUsd: number): void {
    this.riskEngine.recordEquitySnapshot(timestamp, equityUsd);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * `createSignalCenterV1` — convenience factory. Same as
 * `new SignalCenterV1(config)`.
 */
export function createSignalCenterV1(config?: Partial<SignalCenterV1Config>): SignalCenterV1 {
  return new SignalCenterV1(config);
}
