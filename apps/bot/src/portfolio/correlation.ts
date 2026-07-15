/**
 * apps/bot/src/portfolio/correlation.ts
 *
 * Phase 37 Track 4 — `CorrelationMatrix` — a multi-strategy
 * portfolió görgető korreláció-mátrix.
 *
 * ===========================================================================
 * CÉL
 * ===========================================================================
 * A Phase 6-os multi-class ensemble strategy-k PÉLDÁUL a két
 * `dydx_cex_carry` változatot vagy a `dydx_cex_carry` + egy
 * funding-flip kitettséget erősen korrelálják (0.6-0.9) a közös
 * funding-rate faktor miatt. Ha a `RiskBudgetAllocator` nem tudja,
 * hogy mely stratégiák korrelálnak, akkor a súly × total_risk
 * allokáció túl nagy közös kitettséget eredményezhet.
 *
 * A `CorrelationMatrix` az UTOLSÓ N trade-return alapján görgetve
 * számítja a Pearson-korrelációt minden aktív stratégia-párra.
 * Alapértelmezetten N=30, ami egy kiegyensúlyozott trade-mennyiség
 * mellett (napi 1-3 carry trade × 1 hónap) elegendő a stabil
 * becsléshez.
 *
 * ===========================================================================
 * MATEMATIKA
 * ===========================================================================
 * Pearson:   r = sum((x_i - x̄) × (y_i - ȳ)) / sqrt(sum((x_i - x̄)²) × sum((y_i - ȳ)²))
 *
 * Edge case-ek:
 *   - Ha bármelyik stream hossza < 2 → korreláció undefined (0).
 *   - Ha bármelyik variancia 0 (minden return azonos) → undefined (0).
 *   - Ha Nincs közös időablak (a két stream nem osztozik traden) →
 *     a két stream hossza alapján igazítunk: a rövidebbik hosszával
 *     dolgozunk (a legrégebbi return-öket eldobjuk).
 *
 * ===========================================================================
 * THREAD-SAFETY
 * ===========================================================================
 * A `CorrelationMatrix` a Phase 33+ runtime-ban single-threaded
 * (a Node.js event loop). Nincs szükség lock-ra. A `recordFill` és
 * a `getCorrelation` egymás után hívódnak, és nincs köztes aszinkron
 * határ.
 */

import type { Logger } from "@mm-crypto-bot/shared";
import { createLogger } from "@mm-crypto-bot/shared";

// ============================================================================
// Public types
// ============================================================================

/**
 * `CorrelationMatrixOptions` — a mátrix konfigurációja.
 *
 * - `windowSize` — a görgető ablak mérete (trade-ek száma).
 *                   Default: 30. Min: 2, Max: 1000.
 * - `logger`     — opcionális structured logger.
 */
export interface CorrelationMatrixOptions {
  readonly windowSize?: number;
  readonly logger?: Logger;
}

/**
 * `Hard caps` — a `CorrelationMatrix` biztonsági határértékei.
 */
export const CORRELATION_HARD_CAPS = {
  /** A `windowSize` minimuma — 2 trade kell a korrelációhoz. */
  windowSizeMin: 2,
  /** A `windowSize` maximuma — 1000 trade felett a számítás lassú. */
  windowSizeMax: 1000,
} as const;

/**
 * `CorrelationSnapshot` — a mátrix pillanatképe.
 *
 * - `matrix`   — `Map<strategyA, Map<strategyB, correlation>>` —
 *                  a diagonális 1.0, a mátrix szimmetrikus.
 *                  Ha a két stratégia korrelációja undefined (nincs
 *                  elég adat), a cella HIÁNYZIK a belső Map-ből.
 * - `windowSize` — az aktuális ablakméret.
 * - `sampleCounts` — `Map<strategyId, number>` — hány return-t
 *                     láttunk eddig az adott stratégiához.
 */
export interface CorrelationSnapshot {
  readonly matrix: ReadonlyMap<string, ReadonlyMap<string, number>>;
  readonly windowSize: number;
  readonly sampleCounts: ReadonlyMap<string, number>;
}

// ============================================================================
// CorrelationMatrix class
// ============================================================================

/**
 * `CorrelationMatrix` — a multi-strategy görgető korreláció-mátrix.
 *
 * Minden stratégia return-stream-jét egy-egy körkörös buffer tárolja
 * (`windowSize` hosszúságú). A `recordFill(strategyId, returnPct)` hívás
 * a buffer végéhez fűzi az új return-t, és ha a buffer megtelt,
 * a legrégebbi return-t eldobja.
 *
 * A `getCorrelation(a, b)` a két stream utolsó `min(|a|, |b|)` elemére
 * számol Pearson-korrelációt. Ha bármelyik stream rövidebb mint 2,
 * vagy valamelyik varianciája 0, a korreláció 0 (nincs elég adat).
 */
export class CorrelationMatrix {
  private readonly windowSize: number;
  private readonly logger: Logger;
  // Körkörös buffer minden stratégiához. A `Map<strategyId, number[]>`
  // tárolja a return-öket; ha a tömb hossza > windowSize, az első
  // elemet eldobjuk (FIFO). Egyszerűsített körkörös buffer: a
  // `shift()` O(n) művelet, de N≤1000 és ritka hívás, így OK.
  private readonly streams = new Map<string, number[]>();

  public constructor(opts: CorrelationMatrixOptions = {}) {
    const windowSize = opts.windowSize ?? 30;
    if (
      !Number.isInteger(windowSize) ||
      windowSize < CORRELATION_HARD_CAPS.windowSizeMin ||
      windowSize > CORRELATION_HARD_CAPS.windowSizeMax
    ) {
      throw new RangeError(
        `[correlation] windowSize must be an integer in [${String(CORRELATION_HARD_CAPS.windowSizeMin)}..${String(CORRELATION_HARD_CAPS.windowSizeMax)}], got ${String(windowSize)}`,
      );
    }
    this.windowSize = windowSize;
    this.logger = opts.logger ?? createLogger("info");
  }

  /**
   * `getWindowSize` — a görgető ablak mérete.
   */
  public getWindowSize(): number {
    return this.windowSize;
  }

  /**
   * `getStrategyCount` — hány stratégia return-stream-jét tároljuk.
   */
  public getStrategyCount(): number {
    return this.streams.size;
  }

  /**
   * `getSampleCount` — egy adott stratégia return-stream-jének hossza
   * (0 ha nincs rögzített return).
   */
  public getSampleCount(strategyId: string): number {
    return this.streams.get(strategyId)?.length ?? 0;
  }

  /**
   * `recordFill` — egy új trade return rögzítése egy adott stratégiához.
   *
   * A `returnPct` a trade P&L-je SZÁZALÉKBAN (pl. 0.02 = +2%, -0.01 = -1%).
   * A metódus a stream végéhez fűzi, és ha az túllépi a `windowSize`-t,
   * a legrégebbi elemet eldobja.
   *
   * Edge case: a `returnPct` legyen véges szám — ha NaN vagy Infinity,
   * a metódus eldobja és WARN-ol (nem szennyezi a statisztikát).
   */
  public recordFill(strategyId: string, returnPct: number): void {
    if (!Number.isFinite(returnPct)) {
      this.logger.warn("[correlation] ignoring non-finite return", {
        strategyId,
        returnPct,
      });
      return;
    }
    let stream = this.streams.get(strategyId);
    if (stream === undefined) {
      stream = [];
      this.streams.set(strategyId, stream);
    }
    stream.push(returnPct);
    if (stream.length > this.windowSize) {
      stream.shift();
    }
  }

  /**
   * `forgetStrategy` — egy stratégia return-stream-jének törlése.
   * Akkor hívandó, amikor a stratégia kikapcsol, vagy a `mm-bot
   * strategies` parancsban törli a felhasználó.
   */
  public forgetStrategy(strategyId: string): void {
    this.streams.delete(strategyId);
  }

  /**
   * `reset` — az összes return-stream törlése. Akkor hívandó, amikor
   * a user `mm-bot reset-correlations` parancsot ad ki (debuggoláshoz).
   */
  public reset(): void {
    this.streams.clear();
  }

  /**
   * `getCorrelation` — két stratégia görgető Pearson-korrelációja.
   *
   * Visszatérés: a korreláció [-1..1]-ben. Ha nincs elég adat
   * (bármelyik stream hossza < 2, vagy valamelyik varianciája 0),
   * a visszatérés 0 — így a `RiskBudgetAllocator` nem alkalmaz
   * penalty-t bizonytalan adatokra.
   */
  public getCorrelation(strategyA: string, strategyB: string): number {
    if (strategyA === strategyB) {
      return 1;
    }
    const streamA = this.streams.get(strategyA);
    const streamB = this.streams.get(strategyB);
    if (streamA === undefined || streamB === undefined) {
      return 0;
    }
    const n = Math.min(streamA.length, streamB.length);
    if (n < 2) {
      return 0;
    }
    // A két stream utolsó `n` eleme — azonos időszak.
    const xs = streamA.slice(streamA.length - n);
    const ys = streamB.slice(streamB.length - n);
    return this.pearson(xs, ys);
  }

  /**
   * `getMatrix` — a teljes korreláció-mátrix (snapshot).
   *
   * A diagonális 1.0. A mátrix szimmetrikus. Ha egy cella undefined
   * lenne (ritka, mert a `getCorrelation` mindig 0-t ad vissza
   * bizonytalan adatokra), a `getCorrelation` hívója 0-t kap.
   *
   * A `getMatrix` CSAK azokat a stratégiákat tartalmazza, amelyeknek
   * van legalább 1 return-je. A `PortfolioManager` a `computeBudgets`
   * előtt szinkronizálja a `CorrelationMatrix` stream-jeit az aktív
   * stratégia-listával.
   */
  public getMatrix(): CorrelationSnapshot {
    const matrix = new Map<string, Map<string, number>>();
    const sampleCounts = new Map<string, number>();
    const strategyIds = [...this.streams.keys()];
    for (const id of strategyIds) {
      sampleCounts.set(id, this.streams.get(id)?.length ?? 0);
    }
    for (const a of strategyIds) {
      const row = new Map<string, number>();
      for (const b of strategyIds) {
        row.set(b, this.getCorrelation(a, b));
      }
      matrix.set(a, row);
    }
    return { matrix, windowSize: this.windowSize, sampleCounts };
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  /**
   * `pearson` — Pearson-korreláció két azonos hosszúságú tömb között.
   *
   * Edge case-ek:
   *   - n < 2            → 0 (nincs elég adat)
   *   - varianciaA vagy  → 0 (a képlet undefined; konstans stream
   *     varianciaB = 0      nem korrelál semmivel)
   *   - numerikus instabilitás (pl. NaN a lebegőpontos hibák miatt) → 0
   */
  private pearson(xs: readonly number[], ys: readonly number[]): number {
    const n = xs.length;
    if (n < 2 || n !== ys.length) {
      return 0;
    }
    let sumX = 0;
    let sumY = 0;
    for (let i = 0; i < n; i++) {
      sumX += xs[i] ?? 0;
      sumY += ys[i] ?? 0;
    }
    const meanX = sumX / n;
    const meanY = sumY / n;
    let cov = 0;
    let varX = 0;
    let varY = 0;
    for (let i = 0; i < n; i++) {
      const dx = (xs[i] ?? 0) - meanX;
      const dy = (ys[i] ?? 0) - meanY;
      cov += dx * dy;
      varX += dx * dx;
      varY += dy * dy;
    }
    if (varX <= 0 || varY <= 0) {
      return 0;
    }
    const denom = Math.sqrt(varX * varY);
    if (denom <= 0) {
      return 0;
    }
    const r = cov / denom;
    if (!Number.isFinite(r)) {
      return 0;
    }
    // Clamp [-1, 1] — numerikus instabilitás esetén 1.0000001-et
    // kaphatunk, amit a downstream penalty-számítás torzíthatna.
    return Math.max(-1, Math.min(1, r));
  }
}
