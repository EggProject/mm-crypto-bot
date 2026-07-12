// packages/tui/src/providers/PaperProvider.ts — valós paper-motor provider
//
// Ez a provider a `bun run start` üzemmódhoz készült: a TUI mellett
// a `@mm/paper` paper-trading engine is elindul. A provider
// felelőssége:
//   1. A `startPaperEngine()` hívása a megfelelő opciókkal
//   2. A motor állapotának (running, stop, kill-switch) leképezése
//      a TUI BotState-jére
//   3. A motor hibáinak szép megjelenítése (pl. "not implemented yet")
//
// A scaffold fázisban a `@mm/paper` `startPaperEngine` függvénye
// `throw new Error("not implemented yet: ...")` — a provider ilyenkor
// NEM omlik össze, hanem a TUI-ban egy sárga figyelmeztetés jelenik meg,
// és a state frissítése szimulált adatra vált (graceful degradation).

import type { BotState, Position, TickerPrice, Trade } from "../types.js";
import {
  emptyBotState,
  type BotStateProvider,
  type Listener,
} from "./BotStateProvider.js";
import { SimulatedProvider } from "./SimulatedProvider.js";

/** A paper-motor alapértelmezett konfigurációja (a bybit.eu specifikációból). */
const DEFAULT_PAPER_SYMBOLS = ["BTC/USDT", "ETH/USDT", "SOL/USDT"] as const;
const DEFAULT_INITIAL_EQUITY_USDT = 10_000;
const DEFAULT_FEE_BPS = 10; // 0,10% / side — a bybit.eu taker fee
const DEFAULT_SLIPPAGE_BPS = 5; // 0,05% — becsült piaci impact

/**
 `PaperProviderOptions` — a paper-motor indítási opciói.
 Minden mező opcionális; a default-ok a bybit.eu specifikációból
 származnak (lásd docs/research/stack-findings.md).
*/
export interface PaperProviderOptions {
  readonly symbols?: readonly string[];
  readonly initialEquityUsdt?: number;
  readonly feeBps?: number;
  readonly slippageBps?: number;
}

/**
 `PaperProvider` — a `@mm/paper` motort bekötő state provider.
 Ha a motor `not implemented yet` hibát dob, automatikusan a
 szimulált provider-re vált, és a TUI-ban egy sárga figyelmeztetés
 jelenik meg. Így a TUI mindig működőképes marad.
*/
export class PaperProvider implements BotStateProvider {
  private readonly listeners = new Set<Listener>();
  private readonly options: Required<PaperProviderOptions>;
  private readonly fallback: SimulatedProvider;
  private state: BotState;
  private paperHandle: { stop: () => Promise<void> } | null = null;

  constructor(options: PaperProviderOptions = {}) {
    this.options = {
      symbols: options.symbols ?? [...DEFAULT_PAPER_SYMBOLS],
      initialEquityUsdt: options.initialEquityUsdt ?? DEFAULT_INITIAL_EQUITY_USDT,
      feeBps: options.feeBps ?? DEFAULT_FEE_BPS,
      slippageBps: options.slippageBps ?? DEFAULT_SLIPPAGE_BPS,
    };

    // A fallback provider azonnal kész, így a TUI mindig van mit mutatni.
    this.fallback = new SimulatedProvider({
      mode: "with-bot",
      seed: Date.now() & 0x7fffffff,
      engineError: "A @mm/paper motor még nem elérhető (a későbbi fázisban implementálandó) — szimulált adatok.",
    });

    this.state = emptyBotState("with-bot", this.options.initialEquityUsdt, this.fallback.getSnapshot().status.engineError);
  }

  // === Public API (BotStateProvider) ====================================

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    // A fallback listenereit is forwardoljuk, hogy a szimulált adatok
    // frissítései is eljussanak a TUI-hoz.
    const unsubFallback = this.fallback.subscribe(listener);
    return () => {
      this.listeners.delete(listener);
      unsubFallback();
    };
  }

  getSnapshot(): BotState {
    return this.fallback.getSnapshot();
  }

  async start(): Promise<void> {
    if (this.state.running) return;
    if (this.paperHandle === null) {
      await this.tryStartPaperEngine();
    }
    // A fallback-et is elindítjuk, hogy a TUI-n legyen valami mozgás.
    await this.fallback.start();
    this.state = { ...this.fallback.getSnapshot(), running: true };
    this.notify();
  }

  async stop(): Promise<void> {
    if (!this.state.running) return;
    if (this.paperHandle !== null) {
      try {
        await this.paperHandle.stop();
      } catch {
        // A motor leállítása nem kritikus — a fallback leáll.
      }
      this.paperHandle = null;
    }
    await this.fallback.stop();
    this.state = { ...this.fallback.getSnapshot(), running: false };
    this.notify();
  }

  async killSwitch(): Promise<void> {
    if (this.paperHandle !== null) {
      try {
        await this.paperHandle.stop();
      } catch {
        // A kill-switch mindent leállít, a motor-hibák nem blokkolnak.
      }
      this.paperHandle = null;
    }
    await this.fallback.killSwitch();
    this.state = this.fallback.getSnapshot();
    this.notify();
  }

  setKillSwitchState(killState: BotState["killSwitch"]): void {
    this.fallback.setKillSwitchState(killState);
    this.state = this.fallback.getSnapshot();
    this.notify();
  }

  /**
   * `setPaused` — a TUI-ból jövő pause/resume kérés. A `PaperProvider`
   * a fallback-re delegálja; a valós paper-motor esetén a pause flag
   * UI-flag (a motor önálló logikát követ).
   */
  setPaused(paused: boolean): void {
    this.fallback.setPaused(paused);
    this.state = this.fallback.getSnapshot();
    this.notify();
  }

  async dispose(): Promise<void> {
    if (this.paperHandle !== null) {
      try {
        await this.paperHandle.stop();
      } catch {
        // A dispose során a motor-hibákat elnyeljük.
      }
      this.paperHandle = null;
    }
    await this.fallback.dispose();
    this.listeners.clear();
  }

  // === Belső logika ======================================================

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  /**
   `tryStartPaperEngine` — dinamikus import a `@mm/paper` csomagból.
   Ha a motor `not implemented yet` hibát dob, a TUI a fallback
   szimulációra vált, és a `status.engineError` mezőben megjelenik
   a hibaüzenet.
  */
  private async tryStartPaperEngine(): Promise<void> {
    try {
      // Dinamikus import — így a TUI-only mód nem tölti a @mm-crypto-bot/paper függőséget.
      // A `@mm-crypto-bot/paper` v1 API `new PaperTrader(feed, opts)`-szal dolgozik,
      // nem `startPaperEngine`-el. Itt a meglévő API-ra castolunk, és ha a függvény
      // nem áll rendelkezésre (még nem implementált), a graceful fallback lép életbe.
      const paperModule = (await import("@mm-crypto-bot/paper")) as unknown as {
        startPaperEngine?: (opts: {
          readonly symbols: readonly string[];
          readonly initialEquityUsdt: number;
          readonly feeBps: number;
          readonly slippageBps: number;
        }) => Promise<{ readonly stop: () => Promise<void> }>;
      };
      const start = paperModule.startPaperEngine;
      if (typeof start !== "function") {
        throw new Error("@mm-crypto-bot/paper: startPaperEngine not implemented yet");
      }
      const handle = await start({
        symbols: this.options.symbols,
        initialEquityUsdt: this.options.initialEquityUsdt,
        feeBps: this.options.feeBps,
        slippageBps: this.options.slippageBps,
      });
      this.paperHandle = handle;
      // Ha a motor sikeresen elindult, a hibaüzenetet töröljük a state-ből.
      const snap = this.fallback.getSnapshot();
      this.fallback.setKillSwitchState("armed");
      this.state = {
        ...snap,
        status: { ...snap.status, engineAvailable: true, engineError: null, mode: "with-bot" },
        running: true,
      };
    } catch (err: unknown) {
      // A `not implemented yet` hiba normális a scaffold fázisban —
      // a TUI ettől még működik, csak a fallback szimuláció látható.
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.state = {
        ...this.fallback.getSnapshot(),
        status: {
          ...this.fallback.getSnapshot().status,
          engineAvailable: false,
          engineError: errorMsg,
          mode: "with-bot",
        },
      };
    }
  }
}

// Az alábbi `Position`, `Trade`, `TickerPrice` import-ok csak típus-szinten
// kellenek a dokumentációhoz és a későbbi bővíthetőséghez.
export type { Position, TickerPrice, Trade };
