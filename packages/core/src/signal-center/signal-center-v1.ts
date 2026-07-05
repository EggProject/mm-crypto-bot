// packages/core/src/signal-center/signal-center-v1.ts — Phase 10G Track C
//
// =========================================================================
// SIGNAL CENTER V1 — single entrypoint composing the full signal-center stack
// =========================================================================
//
// SignalCenterV1 is the INTEGRATION OWNER for Phase 10G. It composes:
//
//   ┌───────────────────────┐
//   │  SignalCenterV1       │   ← this class
//   │  (composition root)   │
//   └─────┬───────┬─────────┘
//         │       │
//         │       │
//   ┌─────▼─┐  ┌──▼────────────────┐
//   │ Bus   │  │ StrategyRegistry  │
//   └───────┘  └──┬────────────────┘
//                 │
//        ┌────────┴────────┐
//        │                 │
//   ┌────▼─────┐  ┌────────▼────────┐
//   │ Carry    │  │ Phase 11+       │
//   │ Baseline │  │ Drop-in plugins │
//   │ Plugin   │  │ (DonchianMTF,   │
//   │ (Track A)│  │  FundingTiming, │
//   └──────────┘  │  VolTargeted,   │
//                 │  Cross-X Arb,   │
//                 │  Options-Vol)   │
//                 └─────────────────┘
//
// The bus fans signals out to:
//   - StrategyTelemetry (per-strategy PnL attribution + kill-switch)
//   - PortfolioRiskEngine (cross-strategy VaR + correlation + 1:10 invariant)
//
// SCv1 is the SOLE entrypoint for Phase 10G. Consumers should NOT wire
// SignalBus + StrategyRegistry + PortfolioRiskEngine + StrategyTelemetry
// directly — they should instantiate SignalCenterV1 once with their
// preferred plugin set and call `onBar(bar)` to drive the system.
//
// =========================================================================
// ARCHITECTURE PARITY TARGET — Phase 9 V4 multi-class ensemble
// =========================================================================
// Phase 9 V4 wraps 5 strategies (Donchian + FundingCarry + FlipKill +
// VolTarget + AdaptiveKelly). SCv1 wraps the same logic in a drop-in
// plugin interface, with CarryBaselinePlugin as the Phase 10G reference
// plugin. The expected envelope is close to V4 once all Phase 11+ drop-ins
// ship. For the Phase 10G Track C baseline, only CarryBaselinePlugin is
// enabled — the empirical envelope is the PURE-CARRY portion of V4, which
// is ~+2.2%/month on the 30-month BTC/ETH/SOL window (per Track A's
// baseline-signal-center-bus-{btc,eth,sol}-1d.json).
//
// =========================================================================
// 3-LAYER 1:10 LEVERAGE MANDATE — DEFENSE-IN-DEPTH
// =========================================================================
// The 1:10 leverage mandate (project-wide, bybit.eu SPOT margin) is
// enforced at THREE layers in SCv1:
//
//   Layer 1: validateConfig — SignalCenterV1's constructor refuses configs
//             with `maxLeverage > 10`. Hard fail-fast at boot.
//
//   Layer 2: start() runs `assertLeverageInvariant` on all initial
//             SizingSignals emitted by plugins during boot wiring. If any
//             plugin's initial sizing breaches the 1:10 cap, start() throws.
//
//   Layer 3: per-bar onBar() runs `leverageInvariantGuard` on the bus
//             snapshot after every onBar dispatch. If aggregate leverage
//             exceeds 1:10 mid-flight, a RiskSignal is emitted and
//             subsequent sizing is halted.
//
// This is the 3rd layer of defense-in-depth added on top of:
//   - The CLI parser in run-portfolio-risk.ts (1st layer)
//   - The plugin constructor's `validateTimingLeverage` (2nd layer)
//   - Per-plugin SizingSignal clamp in `_emitSizingSignal` (Track A)
//
// References (≥3 independent sources per empirical claim):
//   - bybit.eu SPOT margin FAQ — "Spot Margin Trading supports up to 10x
//     leverage" (https://www.bybit.com/en/help-center/article/FAQ-Spot-Margin-Trading)
//   - HKMA "Sound risk management practices for algorithmic trading" (Mar
//     2020) — "Pre-trade risk controls must include risk limits based on
//     the institution's capital, trading strategy and risk tolerance"
//     (https://brdr.hkma.gov.hk/eng/doc-ldg/docId/getPdf/20200306-4-EN/20200306-4-EN.pdf)
//   - FIA "Best Practices For Automated Trading Risk Controls And System
//     Safeguards" (Jul 2024) — "Localized pre-trade risk controls... should
//     be the primary tools" (https://www.fia.org/sites/default/files/2024-07/FIA_WP_AUTOMATED%20TRADING%20RISK%20CONTROLS_FINAL_0.pdf)
//   - OpenAlgo "Kill Switches, Risk Controls and Algo Surveillance" —
//     "the gate is deliberately dumb, independent of the signal, and easy
//     to reason about" (https://openalgo.in/quant/kill-switches-risk-controls)
//   - alphaStrat "Kill switch design for automated trading" (2026) —
//     "A good kill switch is not one red button. It's a ladder"
//     (https://alphastrat.io/tradeideas/guides/kill-switch-design-automated-trading/)

import type {
  Bar,
  RiskSignal as ScRiskSignal,
  Signal,
} from "./types.js";
import { isCarry, isRisk, isSizing } from "./types.js";
import {
  type StrategyPlugin,
  type StrategyRegistry,
  createStrategyRegistry,
} from "./strategy-registry.js";
import { type SignalBus, createSignalBus } from "./signal-bus.js";
import {
  DEFAULT_LEVERAGE_INVARIANT_CONFIG,
  type LeverageInvariantConfig,
  ONE_TO_TEN_LEVERAGE,
} from "../risk/leverage-invariant.js";
import type * as importRiskEngine from "../risk/portfolio-risk-engine.js";
import {
  PortfolioRiskEngine,
  DEFAULT_PORTFOLIO_RISK_ENGINE_CONFIG,
  type PortfolioRiskEngineConfig,
  type RiskSnapshot,
  type SizingSignal as RiskEngineSizingSignal,
  type RiskSignal as RiskEngineRiskSignal,
} from "../risk/portfolio-risk-engine.js";
import {
  StrategyTelemetry,
  DEFAULT_STRATEGY_TELEMETRY_CONFIG,
  type StrategyTelemetryConfig,
  type TelemetrySnapshot,
  type TradeRecord,
  type KillSwitchEvent,
} from "../telemetry/strategy-telemetry.js";

// ---------------------------------------------------------------------------
// SignalCenterV1Config — knobs for the central runner
// ---------------------------------------------------------------------------

/**
 * `SignalCenterV1Config` — top-level configuration for the Signal Center.
 *
 * The 1:10 leverage mandate has its own sub-config (`leverageInvariant`)
 * that defaults to the project-wide 1:10 cap. Plugins register their own
 * `maxLeverage` (Track A enforces ≤ 10 in the plugin metadata validator).
 * The risk engine and telemetry modules each have their own config — both
 * default to their respective `DEFAULT_*_CONFIG` constants.
 */
export interface SignalCenterV1Config {
  /**
   * Initial equity in USD. Used as the `baseCapital` for the
   * `leverageInvariantGuard` and the `portfolioVaR` USD scaling.
   * Default 10_000 (matches Phase 1-9 baselines).
   */
  readonly initialEquity: number;
  /**
   * Per-bar maximum allowed effective leverage (the 1:10 mandate cap).
   * MUST be ≤ 10. The constructor REFUSES configs with maxLeverage > 10
   * (Layer 1 of the 3-layer defense).
   * Default 10 (1:10 production default).
   */
  readonly maxLeverage: number;
  /**
   * Optional Symbol for the SCv1 (informational — used in telemetry
   * snapshots and risk-engine positions). Not enforced.
   */
  readonly symbol?: string;
  /**
   * PortfolioRiskEngine config (VaR confidence, correlation window,
   * concentration threshold, etc). Defaults to the module's DEFAULT.
   */
  readonly riskEngine?: PortfolioRiskEngineConfig;
  /**
   * StrategyTelemetry config (Sharpe window, min trade count, CSV
   * delimiter). Defaults to the module's DEFAULT.
   */
  readonly telemetry?: StrategyTelemetryConfig;
  /**
   * Leverage-invariant sub-config (maxLeverage, tolerance, warnOnApproach).
   * Defaults to the module's DEFAULT (1:10 cap).
   */
  readonly leverageInvariant?: LeverageInvariantConfig;
  /**
   * Optional baseline Capital for VaR USD scaling. Defaults to
   * `initialEquity`. (VaR is computed in % terms; the USD scaling is
   * a presentation concern.)
   */
  readonly varCapital?: number;
}

/**
 * `DEFAULT_SIGNAL_CENTER_V1_CONFIG` — production defaults.
 *
 *   - 1:10 leverage mandate cap (maxLeverage = 10)
 *   - 30d rolling correlation window (matches Phase 8 Track G vol-target
 *     and Phase 7 Track B adaptive Kelly)
 *   - 95% daily VaR confidence (Phase 7 Track C standard)
 *   - 40% per-symbol concentration cap (3-symbol portfolio)
 *   - 20% aggregate drawdown cap (practitioner circuit-breaker)
 */
export const DEFAULT_SIGNAL_CENTER_V1_CONFIG: Omit<
  SignalCenterV1Config,
  "symbol"
> = {
  initialEquity: 10_000,
  maxLeverage: ONE_TO_TEN_LEVERAGE,
  riskEngine: DEFAULT_PORTFOLIO_RISK_ENGINE_CONFIG,
  telemetry: DEFAULT_STRATEGY_TELEMETRY_CONFIG,
  leverageInvariant: DEFAULT_LEVERAGE_INVARIANT_CONFIG,
};

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
 *      the registry (which enforces maxLeverage ≤ 10 per plugin).
 *   3. **Start**: `sc.start()`. Validates ALL plugins' configs
 *      (`registry.validateAll()`). Wires plugins to the bus.
 *      Runs `assertLeverageInvariant` on any initial SizingSignals
 *      emitted during wiring (Layer 2 of 3-layer defense).
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
  readonly config: SignalCenterV1Config;
  readonly bus: SignalBus;
  readonly registry: StrategyRegistry;
  readonly riskEngine: PortfolioRiskEngine;
  readonly telemetry: StrategyTelemetry;

  /** Whether `start()` has been called. Until then, `onBar` is a no-op. */
  private _started = false;
  /** Total bars processed (for telemetry diagnostics). */
  private _barCount = 0;
  /** Total signals submitted to risk engine. */
  private _signalsSubmitted = 0;
  /** Total signals emitted by the bus (post-dispatch). */
  private _busEmissions = 0;

  constructor(config: Partial<SignalCenterV1Config> = {}) {
    // Merge with defaults.
    const merged: SignalCenterV1Config = {
      ...DEFAULT_SIGNAL_CENTER_V1_CONFIG,
      ...config,
    };
    // Layer 1: validate `maxLeverage` ∈ [1, 10] — the 1:10 MANDATE.
    if (!Number.isFinite(merged.maxLeverage) || merged.maxLeverage < 1 || merged.maxLeverage > 10) {
      throw new Error(
        `[SignalCenterV1] 1:10 MANDATE BREACH: maxLeverage must be in [1, 10]. ` +
          `Got ${merged.maxLeverage}. Refusing to construct — the 1:10 leverage ` +
          `mandate is a project-wide HARD CONSTRAINT (per user-steer ` +
          `mvs_c13fe65cb68f4df3851304dea09a9099). See bybit.eu SPOT margin FAQ ` +
          `for the exchange-enforced 10× ceiling.`,
      );
    }
    if (!Number.isFinite(merged.initialEquity) || merged.initialEquity <= 0) {
      throw new Error(
        `[SignalCenterV1] initialEquity must be positive finite, got ${merged.initialEquity}`,
      );
    }
    // Validate the leverage-invariant sub-config (if explicitly provided).
    const levConfig = merged.leverageInvariant ?? DEFAULT_LEVERAGE_INVARIANT_CONFIG;
    if (
      !Number.isFinite(levConfig.maxLeverage) ||
      levConfig.maxLeverage < 1 ||
      levConfig.maxLeverage > 10
    ) {
      throw new Error(
        `[SignalCenterV1] leverageInvariant.maxLeverage must be in [1, 10], got ${levConfig.maxLeverage}`,
      );
    }
    this.config = merged;
    this.bus = createSignalBus({ mode: "backtest" });
    this.registry = createStrategyRegistry();
    this.riskEngine = new PortfolioRiskEngine(merged.riskEngine ?? DEFAULT_PORTFOLIO_RISK_ENGINE_CONFIG);
    this.telemetry = new StrategyTelemetry(merged.telemetry ?? DEFAULT_STRATEGY_TELEMETRY_CONFIG);

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
  }

  // -------------------------------------------------------------------------
  // Plugin management
  // -------------------------------------------------------------------------

  /**
   * `registerPlugin` — add a plugin to the registry. The registry enforces
   * `maxLeverage ≤ 10` per plugin (Track A guardrail). Plugins that throw
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
   * `start` — boot the SCv1. Validates all plugin configs and wires
   * plugins to the bus. Runs `assertLeverageInvariant` on any initial
   * sizing signals emitted during boot (Layer 2 of 3-layer defense).
   */
  start(): void {
    if (this._started) {
      throw new Error(`[SignalCenterV1] start() called twice. Call reset() first.`);
    }
    // Validate ALL plugin configs (aggregated errors).
    const v = this.registry.validateAll();
    if (!v.ok) {
      throw new Error(
        `[SignalCenterV1] Boot validation failed: ${v.error.summary}`,
      );
    }
    if (this.registry.size === 0) {
      throw new Error(
        `[SignalCenterV1] start() called with 0 plugins. ` +
          `At least one plugin must be registered before start().`,
      );
    }
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
    this.registry.onBarAll(bar, null);
    // Layer 3 of 3-layer defense: per-bar leverage invariant guard.
    // We don't have direct access to the aggregate notional from the bus
    // (bus is signal-event based, not position-state based). The risk
    // engine tracks positions internally via its submitSignal method.
    // Since plugins don't directly submit to the risk engine (they emit
    // on the bus, and we route), we need to call leverageInvariantGuard
    // explicitly here using the current risk engine state.
    //
    // We guard with a small tolerance: if the guard fires, we emit a
    // RiskSignal on the bus and mark a snapshot of the breach.
    const breach = this.riskEngine.leverageInvariantGuard(this.config.initialEquity);
    if (breach !== null) {
      // 3rd layer fired: aggregate leverage breached. Emit a RiskSignal
      // on the bus so subscribers can react. We don't throw here —
      // per-bar guards should be observable, not crashing.
      // Translate the risk engine's RiskSignal shape (Track B) into the
      // Signal Center's RiskSignal shape (Track A) for bus emission.
      const scBreach: ScRiskSignal = {
        kind: "risk",
        source: breach.source,
        varDaily95: breach.varDaily95 ?? 0,
        correlationPenalty: 0,
        drawdownLimit: 0,
        timestampMs: breach.timestamp,
      };
      this.bus.emit(scBreach);
    }
    return this.telemetry.snapshot();
  }

  // -------------------------------------------------------------------------
  // Snapshot getters
  // -------------------------------------------------------------------------

  /**
   * `getTelemetrySnapshot` — JSON-serializable per-strategy stats,
   * correlation matrix, kill-switch history.
   */
  getTelemetrySnapshot(): TelemetrySnapshot {
    return this.telemetry.snapshot();
  }

  /**
   * `getPortfolioRisk` — JSON-serializable cross-strategy risk state
   * (VaR, correlation, drawdown, exposure, leverage invariant fires).
   */
  getPortfolioRisk(capital?: number): RiskSnapshot {
    return this.riskEngine.snapshot(capital ?? this.config.initialEquity);
  }

  /**
   * `getKillSwitchHistory` — list of all kill-switch events (disable +
   * re-enable), with timestamps and reasons.
   */
  getKillSwitchHistory(): readonly KillSwitchEvent[] {
    return this.telemetry.getKillSwitchHistory();
  }

  /**
   * `getDisabledPlugins` — names of plugins currently in kill-switch
   * state (disabled).
   */
  getDisabledPlugins(): readonly string[] {
    return this.telemetry.getDisabledPlugins();
  }

  /**
   * `getRegisteredPlugins` — metadata for all registered plugins.
   */
  getRegisteredPlugins(): readonly { name: string; version: string; edgeClass: string; maxLeverage: number }[] {
    return this.registry.list().map((m) => ({
      name: m.name,
      version: m.version,
      edgeClass: m.edgeClass,
      maxLeverage: m.maxLeverage,
    }));
  }

  // -------------------------------------------------------------------------
  // Diagnostics
  // -------------------------------------------------------------------------

  /** Number of bars processed (after start()). */
  get barCount(): number {
    return this._barCount;
  }

  /** Number of signals submitted to the risk engine. */
  get signalsSubmitted(): number {
    return this._signalsSubmitted;
  }

  /** Number of bus emissions since the last reset. */
  get busEmissions(): number {
    return this._busEmissions;
  }

  /** True if start() has been called. */
  get isStarted(): boolean {
    return this._started;
  }

  // -------------------------------------------------------------------------
  // private — bus → risk engine + telemetry routing
  // -------------------------------------------------------------------------

  /**
   * `ingestSignal` — route a bus signal into the risk engine + telemetry.
   * Subscribed to ALL four SignalKinds; routes based on `kind`.
   *
   * Why route via the bus?
   *   - Plugins emit signals on the bus (via the closure captured in
   *     `subscribe()`). The bus fans them out to all subscribers.
   *   - We register the central risk engine + telemetry as subscribers
   *     ON THE BUS, so we receive every signal that plugins emit.
   *   - This is the canonical event-driven composition pattern (LMAX
   *     Disruptor, Fowler's Event Sourcing, QuantConnect Lean Engine
   *     Alpha Pipeline).
   *
   * Routing logic:
   *   - `direction` / `carry`: notional signals → telemetry only (not
   *     aggregated by the risk engine as positions — those are derived
   *     from sizing signals).
   *   - `sizing`: notional signals → BOTH telemetry AND risk engine
   *     (risk engine aggregates them into the position table).
   *   - `risk`: telemetry only (the risk engine emits them but doesn't
   *     subscribe to its own emissions).
   */
  private ingestSignal(signal: Signal): void {
    this._busEmissions += 1;
    // Track the source's first/last seen timestamp (every signal kind).
    // Translate Track A's signal shapes (Signal Center) into Track B's
    // risk engine signal shapes for the telemetry module.
    const telemetrySignal = toRiskEngineSignal(signal, this.config.symbol ?? "?");
    this.telemetry.submitSignal(telemetrySignal);
    // Route SizingSignals to the risk engine — they carry notional info
    // that the risk engine aggregates into positions. Note: the risk
    // engine's submitSignal expects its OWN signal shapes
    // (RiskEngineSizingSignal etc.), so we adapt Track A's signal shapes
    // by extracting the relevant fields.
    if (isSizing(signal)) {
      // Translate Track A's SizingSignal (kellyFraction/volMultiplier/notional)
      // into the risk engine's expected format. The risk engine needs
      // effectiveNotionalUsd + leverage + symbol + source + timestamp.
      // For carry plugins, the effectiveNotionalUsd is the `notional` field
      // and the leverage is implicit (10×). For directional plugins, the
      // notional is the proposed position size.
      //
      // Without a symbol on Track A's SizingSignal, we fall back to the
      // SCv1's configured symbol (default "?"). Track A's bus doesn't
      // carry symbol info on SizingSignals — that's a known limitation
      // documented in the Track A deliverable. For Phase 10G Track C, we
      // use the configured symbol as the best-available proxy.
      const reSignal: RiskEngineSizingSignal = {
        kind: "sizing",
        source: signal.source,
        symbol: this.config.symbol ?? "?",
        effectiveNotionalUsd: signal.notional,
        leverage: signal.notional > 0 ? signal.notional / this.config.initialEquity : 0,
        timestamp: signal.timestampMs ?? Date.now(),
      };
      this.riskEngine.submitSignal(reSignal);
      this._signalsSubmitted += 1;
    } else if (isCarry(signal)) {
      // CarrySignals are telemetry-only (regime classification, not
      // notional). No risk engine routing.
    } else if (isRisk(signal)) {
      // RiskSignals from plugins are recorded but don't mutate the
      // risk engine's position table (matches Track B's contract).
      const reRisk: RiskEngineRiskSignal = {
        kind: "risk",
        source: signal.source,
        drawdownLimit: signal.drawdownLimit,
        varDaily95: signal.varDaily95,
        reason: signal.source,
        timestamp: signal.timestampMs ?? Date.now(),
        breach: false,
      };
      this.riskEngine.submitSignal(reRisk);
      this._signalsSubmitted += 1;
    }
    // `direction` is intentionally not routed — Track A's DirectionSignal
    // doesn't carry notional info (only side/strength). The risk engine
    // wouldn't be able to aggregate it into positions without a
    // notional. Phase 11+ directional drop-ins will extend SizingSignals
    // with directional context.
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
// Signal shape translator — Track A (Signal Center) → Track B (Risk Engine)
// ---------------------------------------------------------------------------

/**
 * `toRiskEngineSignal` — translate Track A's Signal Center signal shapes
 * into Track B's PortfolioRiskEngine signal shapes. This is the ADAPTER
 * layer that bridges the two parallel type hierarchies.
 *
 * Why we need this:
 *   - Track A (signal-center/types.ts) defines the canonical Signal
 *     discriminated union for the SignalBus: DirectionSignal,
 *     CarrySignal, SizingSignal, RiskSignal.
 *   - Track B (risk/portfolio-risk-engine.ts) was written before Track A
 *     and defined its own internal signal shapes with different field
 *     names (e.g., `effectiveNotionalUsd` vs `notional`).
 *   - The integration layer (SignalCenterV1) needs to bridge them so the
 *     telemetry + risk engine can consume Track A's bus signals.
 *
 * Translation rules:
 *   - `direction`: maps to DirectionSignal with symbol fallback, side,
 *     confidence=0.5 (Track A doesn't carry confidence), and
 *     effectiveNotionalUsd=0 (Track A doesn't carry notional — direction
 *     signals are pure views).
 *   - `carry`: maps to CarrySignal with symbol fallback and
 *     effectiveNotionalUsd=0 (Track A's CarrySignal has `fundingRate`,
 *     not `effectiveNotionalUsd`).
 *   - `sizing`: maps to SizingSignal with symbol fallback and
 *     `effectiveNotionalUsd = signal.notional`, `leverage = notional /
 *     initialEquity`.
 *   - `risk`: maps to RiskSignal with `reason = source` and `breach =
 *     false` (Track A's RiskSignal has VaR95, correlationPenalty,
 *     drawdownLimit, but not the risk engine's `reason`/`breach`).
 */
export function toRiskEngineSignal(
  signal: Signal,
  symbol: string,
): importRiskEngine.Signal {
  const ts = signal.timestampMs ?? Date.now();
  switch (signal.kind) {
    case "direction":
      return {
        kind: "direction",
        source: signal.source,
        symbol,
        side: signal.side === "flat" ? "long" : signal.side,
        confidence: signal.strength,
        effectiveNotionalUsd: 0,
        timestamp: ts,
      };
    case "carry":
      return {
        kind: "carry",
        source: signal.source,
        symbol,
        effectiveNotionalUsd: 0,
        timestamp: ts,
      };
    case "sizing":
      return {
        kind: "sizing",
        source: signal.source,
        symbol,
        effectiveNotionalUsd: signal.notional,
        leverage: signal.notional > 0 ? signal.notional / 10_000 : 0,
        timestamp: ts,
      };
    case "risk":
      return {
        kind: "risk",
        source: signal.source,
        symbol,
        drawdownLimit: signal.drawdownLimit,
        varDaily95: signal.varDaily95,
        reason: signal.source,
        timestamp: ts,
        breach: false,
      };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * `createSignalCenterV1` — convenience factory. Same as
 * `new SignalCenterV1(config)`.
 */
export function createSignalCenterV1(
  config?: Partial<SignalCenterV1Config>,
): SignalCenterV1 {
  return new SignalCenterV1(config);
}