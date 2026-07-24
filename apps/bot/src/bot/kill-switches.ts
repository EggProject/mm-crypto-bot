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
import type { Logger } from "@mm-crypto-bot/shared";
import { createLogger } from "@mm-crypto-bot/shared";

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
  readonly id = "max-drawdown";
  readonly description: string;

  private currentEquity: number;
  private peakEquity: number;
  private readonly maxDrawdownPct: number;

  public constructor(opts: { readonly maxDrawdownPct: number; readonly initialEquity: number }) {
    this.maxDrawdownPct = opts.maxDrawdownPct;
    this.currentEquity = opts.initialEquity;
    this.peakEquity = opts.initialEquity;
    this.description = `Max drawdown ${(opts.maxDrawdownPct * 100).toFixed(1)}%`;
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
    const engaged = dd >= this.maxDrawdownPct;
    return {
      switchId: this.id,
      engaged,
      reason: engaged
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
  readonly id = "max-positions";
  readonly description: string;
  private readonly positionManager: PositionManager;
  private readonly softCapFraction: number;

  public constructor(opts: {
    readonly positionManager: PositionManager;
    readonly softCapFraction?: number;
  }) {
    this.positionManager = opts.positionManager;
    this.softCapFraction = opts.softCapFraction ?? 0.9;
    this.description = `Max positions ${this.positionManager.getMaxPositions()}`;
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
    const engaged = current > max;
    const warning = current >= Math.floor(max * this.softCapFraction);
    return {
      switchId: this.id,
      engaged,
      reason: engaged
        ? `positions ${current} > max ${max}`
        : warning
          ? `positions ${current} approaching max ${max}`
          : `positions ${current} < max ${max}`,
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
  readonly id = "latency-gate";
  readonly description: string;
  private readonly gate: { isCarryAllowed(): boolean; readonly arbThresholdMs: number };
  private readonly enabled: boolean;

  public constructor(opts: {
    readonly gate: { isCarryAllowed(): boolean; readonly arbThresholdMs: number };
    readonly enabled?: boolean;
  }) {
    this.gate = opts.gate;
    this.enabled = opts.enabled ?? opts.gate.arbThresholdMs !== Number.POSITIVE_INFINITY;
    this.description = `Latency gate ${this.enabled ? `> ${String(opts.gate.arbThresholdMs)}ms` : "disabled"}`;
  }

  public evaluate(): KillSwitchVerdict {
    if (!this.enabled) {
      return { switchId: this.id, engaged: false, reason: "latency gate disabled" };
    }
    const allowed = this.gate.isCarryAllowed();
    return {
      switchId: this.id,
      engaged: !allowed,
      reason: allowed
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
  readonly id: string;
  readonly description: string;
  private readonly engagedFn: () => boolean;
  private readonly reasonFn: () => string;

  public constructor(opts: {
    readonly id: string;
    readonly description: string;
    readonly engaged: () => boolean;
    readonly reason?: () => string;
  }) {
    this.id = opts.id;
    this.description = opts.description;
    this.engagedFn = opts.engaged;
    this.reasonFn = opts.reason ?? ((): string => `${opts.id} engaged`);
  }

  public evaluate(): KillSwitchVerdict {
    const engaged = this.engagedFn();
    return {
      switchId: this.id,
      engaged,
      reason: engaged ? this.reasonFn() : `${this.id} clear`,
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
  readonly logger?: Logger;
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

  public constructor(opts: KillSwitchRegistryOptions) {
    this.switches = opts.switches;
    this.logger = opts.logger ?? createLogger("info");
  }

  /**
   * `onTrigger` — regisztrál egy callback-et, ami a registry tüzelésekor
   * hívódik. A `Bot` regisztrálja a pozíció-záró + leállító logikát.
   */
  public onTrigger(callback: KillSwitchCallback): void {
    this.callbacks.push(callback);
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
    const engaged = reasons.length > 0;
    const snapshot: KillSwitchSnapshot = { engaged, reasons, verdicts };
    this.lastSnapshot = snapshot;
    if (engaged && !this.firedOnce) {
      this.firedOnce = true;
      this.logger.error("[kill-switches] KILL-SWITCH TRIGGERED", {
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

  private async fireCallbacks(snapshot: KillSwitchSnapshot): Promise<void> {
    for (const cb of this.callbacks) {
      try {
        await cb(snapshot);
      } catch (err) {
        this.logger.error("[kill-switches] callback threw", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
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
export function createDefaultRegistry(opts: {
  readonly positionManager: PositionManager;
  readonly maxDrawdownPct: number;
  readonly maxPositions: number;
  readonly latencyGate?: { isCarryAllowed(): boolean; readonly arbThresholdMs: number };
  readonly perStrategyKillSwitches?: readonly KillSwitch[];
  readonly logger?: Logger;
}): KillSwitchRegistry {
  const switches: KillSwitch[] = [
    new MaxDrawdownKillSwitch({
      maxDrawdownPct: opts.maxDrawdownPct,
      initialEquity: opts.positionManager.getEquity(),
    }),
    new MaxPositionsKillSwitch({
      positionManager: opts.positionManager,
    }),
  ];
  if (opts.latencyGate !== undefined) {
    switches.push(new LatencyGateKillSwitch({ gate: opts.latencyGate }));
  }
  if (opts.perStrategyKillSwitches !== undefined) {
    switches.push(...opts.perStrategyKillSwitches);
  }
  return new KillSwitchRegistry({ switches, ...(opts.logger !== undefined ? { logger: opts.logger } : {}) });
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
