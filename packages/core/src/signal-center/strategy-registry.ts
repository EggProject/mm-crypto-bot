// packages/core/src/signal-center/strategy-registry.ts — Phase 10G Track A
//
// Multi-strategy registry + plugin interface for the Signal Center.
//
// Why a registry?
// ---------------
// Phase 1-9 composed strategies as nested wrapper chains in monolithic
// ensembles (V1 → V2 → V3 → V4). Each new strategy = surgery on the
// ensemble file, breaking existing tests. With the signal-center
// architecture, NEW plugins should drop in WITHOUT modifying the central
// runner — only the registry. That's the whole point of a plugin
// architecture.
//
// References on plugin/extension architectures (≥3 independent sources):
//   - Erich Gamma et al. "Design Patterns: Elements of Reusable
//     Object-Oriented Software" (1994) — Registry / Singleton pattern,
//     the OO-canonical way to centralize pluggable component lookup.
//   - Martin Fowler "Plugin" pattern (Patterns of Enterprise Application
//     Architecture, 2002) — explicit plugin interface, runtime
//     registration, lifecycle hooks.
//   - Trading system literature: QuantConnect Lean Engine, Zipline,
//     backtrader, NautilusTrader all use a plugin registry for strategy
//     drop-in. The pattern is industry-standard in quant infra.
//
// 1:10 leverage MANDATE (hard guardrail):
//   - Plugin metadata `maxLeverage` MUST be ≤ 10. Plugins declaring
//     `maxLeverage > 10` are rejected at `register()` time.
//   - Rationale: the 1:10 mandate is project-wide. Plugin authors
//     MUST declare their leverage expectation upfront; the registry
//     enforces it at boot so a misconfigured plugin can't slip into
//     production.
//   - See memory mm-crypto-bot-project.md §"1:10 leverage MANDATORY"
//     for the user-directive context.

import type { SignalBus } from "./signal-bus.js";
import {
  type AggregatedConfigError,
  type Bar,
  type ConfigError,
  type PluginState,
  type Result,
  err,
  ok,
} from "./types.js";

// ---------------------------------------------------------------------------
// Edge class — categorizes plugin by alpha source.
// ---------------------------------------------------------------------------

/**
 * `EdgeClass` — discrete categorization of plugin alpha source.
 *
 *   - `directional` — produces DirectionSignals (long/short views).
 *     Examples: DonchianMTF, MeanReversionBB, OptionsVol delta hedge.
 *   - `carry` — produces CarrySignals (funding-rate regime).
 *     Examples: CarryBaseline, FundingTiming, FundingFlipKillSwitch.
 *   - `sizing` — produces SizingSignals (kelly, vol-target).
 *     Examples: AdaptiveKelly, VolTargeted, HybridSizer.
 *   - `risk` — produces RiskSignals (VaR, correlation penalty).
 *     Examples: PortfolioRiskEngine (Phase 10G Track B).
 *   - `mixed` — emits multiple signal kinds.
 *     Examples: CarryBaselinePlugin emits BOTH CarrySignal and
 *     SizingSignal; a multi-edge plugin belongs here.
 *
 * Why this categorization matters: Phase 10G.2+ drop-ins register
 * by edge class so the portfolio risk engine can subscribe to all
 * `risk` plugins for cross-strategy monitoring without enumerating
 * names.
 */
export type EdgeClass = "directional" | "carry" | "sizing" | "risk" | "factor" | "mixed";

// ---------------------------------------------------------------------------
// StrategyPluginMetadata — describes a plugin's static characteristics.
// ---------------------------------------------------------------------------

/**
 * `StrategyPluginMetadata` — static descriptor returned by every
 * plugin's `metadata` getter. The registry uses this for:
 *
 *   - `register()` validation (maxLeverage ≤ 10, name uniqueness).
 *   - `list()` API (telemetry dashboard shows registered plugins).
 *   - Boot-time `validateAll()` (cross-plugin dependency checks in
 *     later phases — Phase 10G.3+).
 *   - Telemetry / attribution (which edge class contributed which
 *     PnL).
 */
export interface StrategyPluginMetadata {
  /** Unique plugin name. Convention: kebab-case (e.g., "carry-baseline"). */
  readonly name: string;
  /** Semantic version (e.g., "1.0.0"). */
  readonly version: string;
  /** Edge class — see EdgeClass. */
  readonly edgeClass: EdgeClass;
  /**
   * Minimum capital (USD) the plugin needs to operate. Plugins below
   * the user's available capital are filtered out at boot.
   */
  readonly capitalRequirement: number;
  /**
   * Maximum leverage the plugin uses. MUST be ≤ 10 (the project-wide
   * 1:10 mandate). The registry rejects any plugin with maxLeverage > 10.
   *
   * For baseline-only strategies (1× no leverage), set to 1.
   * For 1:10 leveraged strategies, set to 10.
   */
  readonly maxLeverage: number;
  /**
   * Free-form description for the dashboard / logs. Default 1 line.
   */
  readonly description?: string;
  /**
   * Optional list of plugin names this plugin depends on (e.g.,
   * HybridSizer depends on AdaptiveKelly + VolTargeted). Cross-plugin
   * dependency checks run at boot via `validateAll()`. Empty array
   * by default.
   */
  readonly dependencies?: readonly string[];
}

// ---------------------------------------------------------------------------
// StrategyPlugin — the drop-in plugin interface.
// ---------------------------------------------------------------------------

/**
 * `StrategyPlugin` — the contract every strategy plugin MUST satisfy.
 *
 * Lifecycle:
 *   1. **Construction** — `new CarryBaselinePlugin({ config })`. Plugin
 *      validates its own config in the constructor (throws on invalid).
 *   2. **Validation** — `plugin.validateConfig(plugin)` returns
 *      `Result<void, ConfigError>`. The registry calls this at boot
 *      for ALL plugins and aggregates errors. Plugins MAY throw in
 *      the constructor (defensive); `validateConfig` is the
 *      non-throwing alternative.
 *   3. **Wire** — `plugin.subscribe(bus)`. The plugin registers its
 *      SignalBus subscribers (handlers). Called by `wireAll()`.
 *   4. **Per-bar** — `plugin.onBar(bar, state)`. The central runner
 *      (Phase 10G Track C) calls this once per bar. The plugin may
 *      emit signals via `bus.emit(signal)` (captured from
 *      `subscribe()` closure) and may read its own `state`.
 *   5. **Reset** — `plugin.reset()` clears mutable state between
 *      backtest runs.
 *   6. **Unregister** — `registry.unregister(name)` removes the plugin
 *      mid-flight (live-mode kill-switch). The plugin should clean up
 *      any bus subscriptions in a `dispose()` step.
 */
export interface StrategyPlugin {
  /** Static plugin descriptor. */
  readonly metadata: StrategyPluginMetadata;
  /**
   * `subscribe` — wire SignalBus handlers. Called by
   * `StrategyRegistry.wireAll(bus)`. Implementations typically:
   *
   *   ```ts
   *   subscribe(bus: SignalBus): void {
   *     this._unsubCarry = bus.subscribe("carry", (s) => {
   *       if (isCarry(s)) this._onCarrySignal(s);
   *     });
   *   }
   *   ```
   *
   * The plugin is responsible for storing UnsubscribeFn handles if
   * it needs to clean up on `dispose()` / `unregister()`.
   */
  subscribe(bus: SignalBus): void;
  /**
   * `onBar` — main update, called once per bar by the central runner.
   *
   *   - `bar`: the current OHLCV bar (timestamp + OHLCV).
   *   - `state`: mutable per-plugin state container. The plugin
   *     narrows to its own concrete state type internally (via
   *     `as PluginState` then cast back to its own type).
   *
   * The plugin MAY emit signals via `bus.emit(...)` (captured in
   * `subscribe`). It MUST NOT throw on benign inputs (missing data,
   * zero-vol period) — defensive programming.
   */
  onBar(bar: Bar, state: PluginState): void;
  /**
   * `validateConfig` — non-throwing config validation. Returns
   * `ok(undefined)` on success, `err({ pluginName, field, message })`
   * on failure. The registry aggregates errors via
   * `validateAll()`.
   *
   * Plugins SHOULD also throw in the constructor for hard errors
   * (e.g., invalid leverage), but `validateConfig` is for the
   * boot-time audit trail.
   */
  validateConfig(config: unknown): Result<void, ConfigError>;
  /**
   * `reset` — clear mutable state. Called between backtest re-runs.
   */
  reset(): void;
  /**
   * `dispose` (OPTIONAL) — release SignalBus subscriptions and any
   * other resources. Called by `StrategyRegistry.unregister()`. If
   * omitted, the plugin's subscriptions leak until the bus itself
   * is GC'd.
   */
  dispose?(): void;
}

// ---------------------------------------------------------------------------
// 1:10 leverage validator — hard guardrail for plugin metadata.
// ---------------------------------------------------------------------------

/**
 * `MAX_ALLOWED_PLUGIN_LEVERAGE` — hard ceiling for any plugin's
 * `metadata.maxLeverage` field. The 1:10 mandate is project-wide
 * (Phase 8 Track D onwards).
 */
export const MAX_ALLOWED_PLUGIN_LEVERAGE = 10;

/**
 * `validatePluginMetadata` — enforce the 1:10 leverage ceiling and
 * other metadata invariants. Returns `ok(undefined)` on pass,
 * `err(ConfigError)` on fail.
 *
 * Rules enforced:
 *   - `maxLeverage` ∈ [1, 10] (1× baseline, 10× 1:10 mandate ceiling).
 *   - `name` is non-empty kebab-case-ish (no whitespace, lowercase).
 *   - `version` is non-empty (semver recommended).
 *   - `edgeClass` is one of the valid literals.
 *   - `capitalRequirement` is non-negative.
 */
export function validatePluginMetadata(
  meta: StrategyPluginMetadata,
): Result<void, ConfigError> {
  if (!meta.name || meta.name.trim() === "") {
    return err({
      pluginName: meta.name.length > 0 ? meta.name : "<empty>",
      field: "name",
      message: "Plugin name must be non-empty",
    });
  }
  if (/\s/.test(meta.name)) {
    return err({
      pluginName: meta.name,
      field: "name",
      message: `Plugin name must not contain whitespace, got "${meta.name}"`,
    });
  }
  if (!meta.version || meta.version.trim() === "") {
    return err({
      pluginName: meta.name,
      field: "version",
      message: "Plugin version must be non-empty (semver recommended)",
    });
  }
  const validEdgeClasses: readonly EdgeClass[] = [
    "directional",
    "carry",
    "sizing",
    "risk",
    "factor",
    "mixed",
  ];
  if (!validEdgeClasses.includes(meta.edgeClass)) {
    return err({
      pluginName: meta.name,
      field: "edgeClass",
      message: `Invalid edgeClass "${meta.edgeClass}", expected one of ${validEdgeClasses.join(", ")}`,
      value: meta.edgeClass,
    });
  }
  if (!Number.isFinite(meta.capitalRequirement) || meta.capitalRequirement < 0) {
    return err({
      pluginName: meta.name,
      field: "capitalRequirement",
      message: `capitalRequirement must be a non-negative number, got ${meta.capitalRequirement}`,
      value: meta.capitalRequirement,
    });
  }
  if (
    !Number.isFinite(meta.maxLeverage) ||
    meta.maxLeverage < 1 ||
    meta.maxLeverage > MAX_ALLOWED_PLUGIN_LEVERAGE
  ) {
    return err({
      pluginName: meta.name,
      field: "maxLeverage",
      message:
        `[1:10 HARD GUARDRAIL] maxLeverage must be in [1, ${MAX_ALLOWED_PLUGIN_LEVERAGE}]. ` +
        `Got ${meta.maxLeverage}. Plugin refused: leverage > 1:10 mandate is a project-wide HARD CONSTRAINT.`,
      value: meta.maxLeverage,
    });
  }
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// StrategyRegistry — central plugin registry.
// ---------------------------------------------------------------------------

/**
 * `StrategyRegistry` — drop-in plugin registry. Holds an ordered list
 * of `StrategyPlugin` instances, validates them at boot, and wires
 * their SignalBus subscriptions.
 *
 * Usage:
 * ```ts
 * const registry = new StrategyRegistry();
 * registry.register(new CarryBaselinePlugin({ baseNotionalUsd: 10_000 }));
 * const v = registry.validateAll();
 * if (!v.ok) console.error("Boot errors:", v.error);
 * registry.wireAll(bus);
 * // Later: kill-switch
 * registry.unregister("carry-baseline");
 * ```
 */
export class StrategyRegistry {
  private readonly plugins: StrategyPlugin[] = [];
  private readonly logger: {
    error: (msg: string, ...args: unknown[]) => void;
  };

  constructor(opts?: {
    readonly logger?: {
      error: (msg: string, ...args: unknown[]) => void;
    };
  }) {
    // Alapértelmezetten NEM logolunk — a tesztekben ez a kívánt
    // viselkedés, és a production kódban a hívó adhat át saját
    // loggert (pl. a structured logger-t a shared package-ből).
    this.logger = opts?.logger ?? {
      error: (_msg: string, ..._args: unknown[]) => {
        /* no-op default logger */
      },
    };
  }

  // -------------------------------------------------------------------------
  // register / unregister / get / list
  // -------------------------------------------------------------------------

  /**
   * `register` — add a plugin to the registry. Throws on:
   *   - Duplicate name (a plugin with the same `metadata.name` already
   *     registered).
   *   - Invalid metadata (e.g., maxLeverage > 10).
   *
   * Plugins that fail `validatePluginMetadata` are rejected BEFORE
   * being added to the registry, so the registry's invariant
   * "every registered plugin has valid metadata" is always preserved.
   */
  register(plugin: StrategyPlugin): void {
    if (this.findIndexByName(plugin.metadata.name) !== -1) {
      throw new Error(
        `StrategyRegistry.register: duplicate plugin name "${plugin.metadata.name}". ` +
          `Use unregister() before re-registering.`,
      );
    }
    const v = validatePluginMetadata(plugin.metadata);
    if (!v.ok) {
      throw new Error(
        `StrategyRegistry.register: plugin "${plugin.metadata.name}" failed metadata validation: ${v.error.message}`,
      );
    }
    this.plugins.push(plugin);
  }

  /**
   * `unregister` — remove a plugin by name. Returns `true` if removed,
   * `false` if not found. If the plugin has a `dispose()` method, it
   * is called BEFORE removal so the plugin can release SignalBus
   * subscriptions and other resources.
   */
  unregister(name: string): boolean {
    const idx = this.findIndexByName(name);
    if (idx === -1) return false;
    const plugin = this.plugins[idx]!;
    if (plugin.dispose) {
      try {
        plugin.dispose();
      } catch (e: unknown) {
        // Swallow disposal errors — best-effort cleanup. The registry
        // still removes the plugin so the bus isn't permanently tied
        // to a misbehaving plugin.
        void e;
      }
    }
    this.plugins.splice(idx, 1);
    return true;
  }

  /**
   * `get` — fetch a plugin by name. Returns `undefined` if not found.
   */
  get(name: string): StrategyPlugin | undefined {
    const idx = this.findIndexByName(name);
    return idx === -1 ? undefined : this.plugins[idx]!;
  }

  /**
   * `list` — return metadata for all registered plugins. Defensive
   * copy — mutating the result does not affect the registry.
   */
  list(): readonly StrategyPluginMetadata[] {
    return this.plugins.map((p) => p.metadata);
  }

  /**
   * `size` — count of registered plugins.
   */
  get size(): number {
    return this.plugins.length;
  }

  // -------------------------------------------------------------------------
  // wireAll — connect all plugins to a SignalBus
  // -------------------------------------------------------------------------

  /**
   * `wireAll` — call `plugin.subscribe(bus)` on every registered
   * plugin, in registration order. Plugins store their UnsubscribeFn
   * handles internally (best practice) so they can clean up via
   * `dispose()` if they're later unregistered.
   *
   * If the same SignalBus is wired twice, plugins that don't dedupe
   * their subscriptions will register twice. Callers SHOULD wire once
   * per (registry, bus) tuple.
   */
  wireAll(bus: SignalBus): void {
    for (const plugin of this.plugins) {
      plugin.subscribe(bus);
    }
  }

  // -------------------------------------------------------------------------
  // validateAll — boot-time validation across all plugins
  // -------------------------------------------------------------------------

  /**
   * `validateAll` — call `plugin.validateConfig(providedConfig)` on
   * every registered plugin. Aggregates ALL errors (not first-fail)
   * so the user sees every problem in a single report.
   *
   * `providedConfig` is the config object passed to each plugin's
   * `validateConfig`. Typically the plugin's own construction
   * config. Returns `ok(undefined)` if all plugins pass, or
   * `err(AggregatedConfigError)` if any fail.
   */
  validateAll(providedConfig?: unknown): Result<void, AggregatedConfigError> {
    const errors: ConfigError[] = [];
    for (const plugin of this.plugins) {
      const r = plugin.validateConfig(providedConfig);
      if (!r.ok) errors.push(r.error);
    }
    if (errors.length === 0) return ok(undefined);
    const summary =
      `${errors.length} config error(s) across ${this.plugins.length} plugin(s): ` +
      errors.map((e) => `${e.pluginName}.${e.field}: ${e.message}`).join("; ");
    return err({ errors, summary });
  }

  // -------------------------------------------------------------------------
  // onBarAll — drive all plugins (called by central runner)
  // -------------------------------------------------------------------------

  /**
   * `onBarAll` — call `plugin.onBar(bar, state)` on every registered
   * plugin, in registration order. The `state` is a shared
   * `PluginState` container; each plugin casts to its own concrete
   * state type internally.
   *
   * Plugin errors are SWALLOWED (logged to the console) so a single
   * misbehaving plugin doesn't bring down the whole bus. This is the
   * production behavior — defensive isolation.
   */
  onBarAll(bar: Bar, state: PluginState): void {
    for (const plugin of this.plugins) {
      try {
        plugin.onBar(bar, state);
      } catch (e: unknown) {
        // Best-effort logging az opcionális logger-en keresztül
        // (alapértelmezetten no-op, így a tesztekben nincs zaj).
        this.logger.error(
          `[StrategyRegistry] Plugin "${plugin.metadata.name}" threw on onBar:`,
          e instanceof Error ? e.message : String(e),
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // resetAll — clear state across all plugins
  // -------------------------------------------------------------------------

  /**
   * `resetAll` — call `plugin.reset()` on every registered plugin.
   * Used between backtest re-runs.
   */
  resetAll(): void {
    for (const plugin of this.plugins) {
      try {
        plugin.reset();
      } catch (e: unknown) {
        this.logger.error(
          `[StrategyRegistry] Plugin "${plugin.metadata.name}" threw on reset:`,
          e instanceof Error ? e.message : String(e),
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // private
  // -------------------------------------------------------------------------

  private findIndexByName(name: string): number {
    return this.plugins.findIndex((p) => p.metadata.name === name);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * `createStrategyRegistry` — convenience factory. Same as
 * `new StrategyRegistry()`.
 */
export function createStrategyRegistry(): StrategyRegistry {
  return new StrategyRegistry();
}