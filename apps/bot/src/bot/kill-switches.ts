/**
 * apps/bot/src/bot/kill-switches.ts
 *
 * Phase 33 Track C — `KillSwitchRegistry` — a futó bot központi
 * vészleállító-regisztere.
 *
 * ===========================================================================
 * NÉGY KILL-SWITCH
 * ===========================================================================
 *   1) `MaxDrawdownKillSwitch` — a portfolió drawdown túllépi a
 *      `risk.max_drawdown_pct` küszöböt.
 *   2) `MaxPositionsKillSwitch` — a nyitott pozíciók száma túllépi a
 *      `risk.max_positions` küszöböt.
 *   3) `LatencyGateKillSwitch` — a `LatencyGate` (Phase 30) elutasítja
 *      a carry-t (magas round-trip latency).
 *   4) `PerStrategyKillSwitch` — wrapper a per-strategy kill-switch-ek
 *      köré (pl. a `DydxCexCarryStrategy` 4 beépített kill-switch-e).
 *
 * Az aggregát `evaluate()` metódus futtatja az összeset, és visszaadja
 * a `KillSwitchVerdict`-et. Ha bármelyik `engaged: true`, a registry
 * tüzel — a callback-ek (Bot által regisztrálva) bezárják a nyitott
 * pozíciókat, és leállítják a botot.
 *
 * ===========================================================================
 * TERVEZÉS — OPEN/CLOSED PRINCIPLE
 * ===========================================================================
 * A registry `KillSwitch` interfészen dolgozik, így új kapcsolókat
 * (pl. exchange-status, account-balance) a `Bot` könnyen hozzáadhat.
 * A jelenlegi 4 a Phase 33 scope plan-ből jön.
 */

import type { Symbol } from "@mm-crypto-bot/exchange";
import { requireLogger, type Logger } from "@mm-crypto-bot/logging";

import type { PositionManager } from "./position-manager.js";

// ============================================================================
// Public types
// ============================================================================

/**
 * `KillSwitch` — egy vészleállító absztrakt interfésze. Az
 * `evaluate()` minden `Bot.run()` ciklusban (vagy heartbeat) hívódik;
 * ha `engaged: true`, a registry tüzel.
 */
export interface KillSwitch {
  readonly id: string;
  readonly description: string;
  evaluate(): KillSwitchVerdict;
}

/**
 * `KillSwitchVerdict` — egy kapcsoló kiértékelésének eredménye.
 *
 * - `engaged` — ha `true`, a kapcsoló tüzel.
 * - `reason`  — emberi olvasásra szánt indoklás.
 * - `switchId` — a kapcsoló azonosítója (a registry többszörözi be).
 */
export interface KillSwitchVerdict {
  readonly switchId: string;
  readonly engaged: boolean;
  readonly reason: string;
}

/**
 * `KillSwitchSnapshot` — az aggregált állapot. A `Telemetry` kapja.
 */
export interface KillSwitchSnapshot {
  readonly engaged: boolean;
  readonly reasons: readonly string[];
  readonly verdicts: readonly KillSwitchVerdict[];
}

/**
 * `KillSwitchCallback` — a trigger callback. A `Bot` regisztrálja, és
 * a registry tüzeléskor hívja.
 */
export type KillSwitchCallback = (snapshot: KillSwitchSnapshot) => void | Promise<void>;

// ============================================================================
// Built-in kill-switch implementations
// ============================================================================

/**
 * `MaxDrawdownKillSwitch` — a drawdown küszöb túllépése.
 *
 * A `peakEquity` a futás során legmagasabb elért equity. A drawdown
 * `(peak - current) / peak`. Ha túllépi a `maxDrawdownPct`-t, a
 * kapcsoló tüzel.
 *
 * A peak-et kívülről kell frissíteni (a Bot.run ciklusban, equity
 * változáskor). A `setPeak()` hívás a `Bot`-é.
 */
export class MaxDrawdownKillSwitch implements KillSwitch {
  private currentEquity: number;
  private peakEquity: number;
  private readonly maxDrawdownPct: number;
  readonly id = "max-drawdown";
  readonly description: string;

  public constructor(options: { readonly maxDrawdownPct: number; readonly initialEquity: number }) {
    this.maxDrawdownPct = options.maxDrawdownPct;
    this.currentEquity = options.initialEquity;
    this.peakEquity = options.initialEquity;
    this.description = `Max drawdown ${(options.maxDrawdownPct * 100).toFixed(1)}%`;
  }

  /**
   * `updateEquity` — frissíti a current equity-t. A peak automatikusan
   * követi, ha a current túllépi.
   */
  public updateEquity(equity: number): void {
    this.currentEquity = equity;
    if (equity > this.peakEquity) {
      this.peakEquity = equity;
    }
  }

  public evaluate(): KillSwitchVerdict {
    if (this.peakEquity <= 0) {
      return { switchId: this.id, engaged: false, reason: "no peak yet" };
    }
    const dd = (this.peakEquity - this.currentEquity) / this.peakEquity;
    const isEngaged = dd >= this.maxDrawdownPct;
    return {
      switchId: this.id,
      engaged: isEngaged,
      reason: isEngaged
        ? `drawdown ${(dd * 100).toFixed(2)}% ≥ max ${(this.maxDrawdownPct * 100).toFixed(1)}%`
        : `drawdown ${(dd * 100).toFixed(2)}% < max ${(this.maxDrawdownPct * 100).toFixed(1)}%`,
    };
  }
}

/**
 * `MaxPositionsKillSwitch` — a nyitott pozíciók száma túllépi a cap-et.
 *
 * Defensive: a PositionManager saját maga is dob, ha túllépik
 * (`maxPositions` enforcement az `openPosition`-ben). Ez a kapcsoló
 * csak OBSERVER, és a Bot.run ciklusban figyelmeztet, ha a cap közeleg.
 *
 * Phase 70 fix: a `engaged` feltétel `current > max` (STRICT túllépés),
 * nem `current >= max` (cap-elérés). A 3 pozíció 3-as cap-en NEM
 * trigger; a 4 pozíció 3-as cap-en AZ. A Phase 69 óta a
 * `paper-backtest-verified.toml` `min_consensus = 1`-gyel fut, ami
 * miatt a Donchian stratégia azonnal megnyit 1-1 pozíciót mindhárom
 * symbolra (BTC/ETH/SOL) — a cap elérése NEM hiba, a túllépés AZ.
 */
export class MaxPositionsKillSwitch implements KillSwitch {
  private readonly positionManager: PositionManager;
  private readonly softCapFraction: number;
  readonly id = "max-positions";
  readonly description: string;

  public constructor(options: {
    readonly positionManager: PositionManager;
    readonly softCapFraction?: number;
  }) {
    this.positionManager = options.positionManager;
    this.softCapFraction = options.softCapFraction ?? 0.9;
    this.description = `Max positions ${String(this.positionManager.getMaxPositions())}`;
  }

  public evaluate(): KillSwitchVerdict {
    const current = this.positionManager.getPositionCount();
    const max = this.positionManager.getMaxPositions();
    // Phase 70 fix: use STRICT `>` (exceeds) instead of `>=` (hits).
    //
    // The Hungarian doc-string (`túllépi` = exceeds) and the class
    // semantics are "kill-switch fires when the count EXCEEDS the cap".
    // The old `>=` fired when the count EQUALLED the cap — but a bot
    // at-the-cap (e.g. 1 position per enabled symbol, max = 3) is a
    // LEGITIMATE state, not a kill-switch trigger.
    //
    // The Phase 69 regression: PR #188 introduced
    // `paper-backtest-verified.toml` with `min_consensus = 1`, which
    // lets the Donchian strategy fire on every M15 candle. Within a
    // few seconds the strategy opens 1 position per enabled symbol
    // (BTC/ETH/SOL = 3 positions, max = 3). The old `>=` immediately
    // fired the kill-switch and the bot could not start. The fix is
    // one operator: the kill-switch only fires when the cap is
    // EXCEEDED (e.g. the Phase 68 state-restore restored 4 positions
    // into a config with `max_positions = 3` — THAT should trip the
    // kill-switch; 3 positions at a cap of 3 should NOT).
    //
    // The `PositionManager.openPosition()` already throws on the cap
    // (defense-in-depth), so this kill-switch is only OBSERVER: it
    // catches the case where positions leaked in via `restorePosition`
    // (which bypasses the cap check by design — see the Phase 68
    // `restorePosition` doc-block).
    const isEngaged = current > max;
    const isWarning = current >= Math.floor(max * this.softCapFraction);
    return {
      switchId: this.id,
      engaged: isEngaged,
      reason: isEngaged
        ? `positions ${String(current)} > max ${String(max)}`
        : isWarning
          ? `positions ${String(current)} approaching max ${String(max)}`
          : `positions ${String(current)} < max ${String(max)}`,
    };
  }
}

/**
 * `LatencyGateKillSwitch` — a Phase 30 `LatencyGate` wrapprer-e.
 *
 * A `LatencyGate.isCarryAllowed()` hamisat ad, ha a cross-venue
 * round-trip latency túllépi a threshold-ot. Ha a bot bármelyik
 * pillanatban elutasítja a carry-t, a kapcsoló tüzel.
 *
 * Ha a `gate` a `DEFAULT_LATENCY_GATE_DISABLED` sentinel (paper-trade
 * esetén), a kapcsoló soha nem tüzel.
 */
export class LatencyGateKillSwitch implements KillSwitch {
  private readonly gate: { isCarryAllowed(): boolean; readonly arbThresholdMs: number };
  private readonly enabled: boolean;
  readonly id = "latency-gate";
  readonly description: string;

  public constructor(options: {
    readonly gate: { isCarryAllowed(): boolean; readonly arbThresholdMs: number };
    readonly enabled?: boolean;
  }) {
    this.gate = options.gate;
    this.enabled = options.enabled ?? options.gate.arbThresholdMs !== Infinity;
    this.description = `Latency gate ${this.enabled ? `> ${String(options.gate.arbThresholdMs)}ms` : "disabled"}`;
  }

  public evaluate(): KillSwitchVerdict {
    if (!this.enabled) {
      return { switchId: this.id, engaged: false, reason: "latency gate disabled" };
    }
    const isAllowed = this.gate.isCarryAllowed();
    return {
      switchId: this.id,
      engaged: !isAllowed,
      reason: isAllowed
        ? "latency within threshold"
        : `latency exceeds ${String(this.gate.arbThresholdMs)}ms threshold`,
    };
  }
}

/**
 * `PerStrategyKillSwitch` — wrapper tetszőleges stratégia-szintű
 * kill-switch fölé. A `Strategy` interfészben nincs egységes
 * kill-switch hook, de a DydxCexCarryStrategy pl. 4-et is tartalmaz
 * (evaluateKillSwitches). Ez a wrapper a `DydxCexCarryState`
 * `killSwitchVerdicts` mezőjét olvassa.
 *
 * Az általánosítás kedvéért egy `predikátumot` fogadunk, ami
 * `true`-t ad, ha a strategy-nél tüzelni kell.
 */
export class PerStrategyKillSwitch implements KillSwitch {
  private readonly engagedFn: () => boolean;
  private readonly reasonFn: () => string;
  readonly id: string;
  readonly description: string;

  public constructor(options: {
    readonly id: string;
    readonly description: string;
    readonly engaged: () => boolean;
    readonly reason?: () => string;
  }) {
    this.id = options.id;
    this.description = options.description;
    this.engagedFn = options.engaged;
    this.reasonFn = options.reason ?? ((): string => `${options.id} engaged`);
  }

  public evaluate(): KillSwitchVerdict {
    const isEngaged = this.engagedFn();
    return {
      switchId: this.id,
      engaged: isEngaged,
      reason: isEngaged ? this.reasonFn() : `${this.id} clear`,
    };
  }
}

// ============================================================================
// KillSwitchRegistry
// ============================================================================

/**
 * `KillSwitchRegistryOptions` — a registry konfigurációja.
 */
export interface KillSwitchRegistryOptions {
  readonly switches: readonly KillSwitch[];
  readonly logger: Logger;
}

/**
 * `KillSwitchRegistry` — központi registry. A `Bot` indítja el, és
 * minden run-ciklusban (vagy heartbeat) hívja az `evaluate()`-t.
 *
 * Ha bármelyik kapcsoló `engaged: true`, a registry hívja a trigger
 * callback-eket (Bot által regisztrálva). A Bot ilyenkor bezárja a
 * nyitott pozíciókat, és leállítja a run-loopot.
 */
export class KillSwitchRegistry {
  private readonly switches: readonly KillSwitch[];
  private readonly logger: Logger;
  private readonly callbacks: KillSwitchCallback[] = [];
  private lastSnapshot: KillSwitchSnapshot = { engaged: false, reasons: [], verdicts: [] };
  private firedOnce = false;

  public constructor(options: KillSwitchRegistryOptions) {
    this.switches = options.switches;
    this.logger = requireLogger(options.logger, "kill-switches");
  }

  private async fireCallbacks(snapshot: KillSwitchSnapshot): Promise<void> {
    for (const callback of this.callbacks) {
      try {
        await callback(snapshot);
      } catch (error) {
        this.logger.error("risk.killswitch.callback.failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * `onTrigger` — regisztrál egy callback-et, ami a registry tüzelésekor
   * hívódik. A `Bot` regisztrálja a pozíció-záró + leállító logikát.
   */
  public onTrigger(callback: KillSwitchCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * Feed an equity observation to all drawdown switches.  The registry owns
   * the concrete switches, so this avoids callers depending on their order or
   * reaching into private state.
   */
  public updateEquity(equity: number): void {
    if (!Number.isFinite(equity) || equity < 0) {
      this.logger.warn("risk.killswitch.equity.invalid", { equity });
      return;
    }
    for (const sw of this.switches) {
      if (sw instanceof MaxDrawdownKillSwitch) {
        sw.updateEquity(equity);
      }
    }
  }

  /**
   * `evaluate` — kiértékeli az összes kapcsolót. Ha bármelyik tüzel,
   * a callback-ek hívódnak. A `firedOnce` biztosítja, hogy egy
   * tüzelés csak egyszer aktiválódjon (a Bot run-loopja a `stop()`
   * után kilép).
   */
  public evaluate(): KillSwitchSnapshot {
    const verdicts: KillSwitchVerdict[] = [];
    const reasons: string[] = [];
    for (const sw of this.switches) {
      const v = sw.evaluate();
      verdicts.push(v);
      if (v.engaged) {
        reasons.push(v.reason);
      }
    }
    const isEngaged = reasons.length > 0;
    const snapshot: KillSwitchSnapshot = { engaged: isEngaged, reasons, verdicts };
    this.lastSnapshot = snapshot;
    if (isEngaged && !this.firedOnce) {
      this.firedOnce = true;
      this.logger.critical("risk.killswitch.triggered", {
        reasons,
        verdicts,
      });
      // Fire callbacks asynchronously so we don't block the caller.
      void this.fireCallbacks(snapshot);
    }
    return snapshot;
  }

  /**
   * `getSnapshot` — az utolsó kiértékelés eredménye.
   */
  public getSnapshot(): KillSwitchSnapshot {
    return this.lastSnapshot;
  }

  /**
   * `reset` — a tüzelési flag-et nullázza. Akkor hívandó, amikor a
   * Bot újraindul (pl. egy error recovery után).
   */
  public reset(): void {
    this.firedOnce = false;
  }

  /**
   * `getSwitchIds` — a regisztrált kapcsolók azonosítói (diagnosztika).
   */
  public getSwitchIds(): readonly string[] {
    return this.switches.map((s) => s.id);
  }
}

// ============================================================================
// Convenience: build a default registry
// ============================================================================

/**
 * `createDefaultRegistry` — a Phase 33 scope plan-ből jövő 4
 * alap-kapcsoló egyszerű konstruktora. A `Bot` init()-ben hívja.
 *
 * A `latencyGate` opcionális — ha nincs megadva, a LatencyGateKillSwitch
 * nem kerül a registrybe.
 */
export function createDefaultRegistry(options: {
  readonly positionManager: PositionManager;
  readonly maxDrawdownPct: number;
  readonly maxPositions: number;
  readonly latencyGate?: { isCarryAllowed(): boolean; readonly arbThresholdMs: number };
  readonly perStrategyKillSwitches?: readonly KillSwitch[];
  readonly logger: Logger;
}): KillSwitchRegistry {
  const switches: KillSwitch[] = [
    new MaxDrawdownKillSwitch({
      maxDrawdownPct: options.maxDrawdownPct,
      initialEquity: options.positionManager.getEquity(),
    }),
    new MaxPositionsKillSwitch({
      positionManager: options.positionManager,
    }),
  ];
  if (options.latencyGate !== undefined) {
    switches.push(new LatencyGateKillSwitch({ gate: options.latencyGate }));
  }
  if (options.perStrategyKillSwitches !== undefined) {
    switches.push(...options.perStrategyKillSwitches);
  }
  return new KillSwitchRegistry({ switches, logger: options.logger });
}

/**
 * `rebrandSymbol` — helper a PositionSnapshot symbol-ök branded-re
 * konvertálásához (a StateStore plain stringként tárolja, de a
 * PositionManager branded `Symbol`-t vár).
 */
export function _rebrandSymbolString(_s: string): Symbol {
  // A position-manager `Symbol` típust vár. A kliens-oldali
  // konverzió a `asSymbol()` helperrel történik; itt csak a típus-
  // szintű witness-t biztosítjuk.
  return _s as unknown as Symbol;
}
