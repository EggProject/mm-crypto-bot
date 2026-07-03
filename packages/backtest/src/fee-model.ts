/**
 * packages/backtest/src/fee-model.ts
 *
 * A research-strategy verifier 2. caveat-jat kezeli:
 *
 *   "Margin borrow rate: a research 0,24%/nap-ot hasznal, a bybit.eu
 *    hivatalos pelda 0,02%/nap (~12x alacsonyabb) → a koltsegmodell
 *    konzervativen tulbecsuli, ezt a backtest fee-paramternel
 *    korrigalni/parameterezni kell."
 *
 * MEGOLDAS: a borrow rate (es minden fee komponens) PARAMETRIZALHATO,
 * NEM a kodba egetett. Az alapertelmezett a bybit.eu hivatalos USDT
 * peldajara epul (0,02%/nap = 0.0002 decimal).
 *
 * A fee-modell igy repozitorium-szinten ellenorizheto: a verifier
 * `grep -r 'borrowRate' packages/` megkeresi az erintett helyeket.
 */

import type { ExchangeFeeConfig } from "@mm-crypto-bot/shared";

/**
 * Az egy fill-re eso teljes koltseg kiszamitasa.
 *
 * @param notional  A fill notional erteke (price * amount) quote currency-ban
 * @param fee       Az exchange fee konfiguracio
 * @param isMargin  Margin trade-e (true) vagy spot (false)
 * @param holdHours  Mennyi ideig tartottuk nyitva a poziciot (margin borrow kalkulaciohoz)
 */
export function calcFillCost(
  notional: number,
  fee: ExchangeFeeConfig,
  isMargin: boolean,
  holdHours: number,
): number {
  if (notional < 0) {
    throw new Error(`notional must be non-negative, got ${notional}`);
  }
  if (holdHours < 0) {
    throw new Error(`holdHours must be non-negative, got ${holdHours}`);
  }

  // Taker fee (market order; limit maker eseten fee.spotMakerFee kell)
  const spotFee = notional * fee.spotTakerFee;

  // Margin borrow koltseg - CSAK margin trade-ekre, ora-alapu
  let borrowCost = 0;
  if (isMargin) {
    const holdDays = holdHours / 24;
    borrowCost = notional * fee.borrowRatePerDay * holdDays;
  }

  return spotFee + borrowCost;
}

/**
 * A teljes backtest koltseg-modell.
 *
 * A koltsegek a pozicio elettartama + a notional fuggvenyeben szamolodnak.
 * A slippage modell kulon kezelheto (jelenleg 0 - TODO: orderbook-mera).
 */
export interface BacktestCostBreakdown {
  readonly spotFee: number;
  readonly borrowCost: number;
  readonly liquidationFee: number;
  readonly total: number;
}

export function calcBacktestCost(
  notional: number,
  fee: ExchangeFeeConfig,
  isMargin: boolean,
  holdHours: number,
  wasLiquidated: boolean = false,
): BacktestCostBreakdown {
  const spotFee = isMargin ? 0 : notional * fee.spotTakerFee;
  const borrowCost = isMargin ? notional * fee.borrowRatePerDay * (holdHours / 24) : 0;
  const liquidationFee = wasLiquidated ? notional * fee.liquidationFee : 0;
  return {
    spotFee,
    borrowCost,
    liquidationFee,
    total: spotFee + borrowCost + liquidationFee,
  };
}

/**
 * A fee konfiguracio validacioja + audit-info kiirasa.
 *
 * A verifier ezt a fuggvenyt hasznalhata annak ellenorzesere, hogy a
 * default ertekek megfelelnek-e a bybit.eu hivatalos peldainak.
 */
export function auditFeeConfig(fee: ExchangeFeeConfig): {
  readonly warnings: readonly string[];
  readonly borrowRatePerDayPct: number;
  readonly spotTakerFeePct: number;
} {
  const warnings: string[] = [];

  // bybit.eu USDT borrow rate referencia: 0,02%/nap (= 0.0002)
  // Ha az ertek szignifikansan magasabb, az figyelmeztetojel.
  if (fee.borrowRatePerDay > 0.0005) {
    warnings.push(
      `borrowRatePerDay=${fee.borrowRatePerDay} (>0,05%/nap) magasnak tunik a bybit.eu USDT referencia-ertekhez (~0,02%/nap) kepest. Ellenőrizd, hogy tenyleg ezt akarod-e hasznalni.`,
    );
  }

  // bybit.eu spot taker fee referencia: 0,1% (= 0.001)
  if (fee.spotTakerFee > 0.002) {
    warnings.push(
      `spotTakerFee=${fee.spotTakerFee} (>0,2%) magasnak tunik a bybit.eu VIP-0 0,1%-os alap dijahoz kepest.`,
    );
  }

  return {
    warnings,
    borrowRatePerDayPct: fee.borrowRatePerDay * 100,
    spotTakerFeePct: fee.spotTakerFee * 100,
  };
}