import { asSymbol } from "@mm-crypto-bot/exchange";
import type { ExchangePosition, MarketMeta, Symbol as ExchangeSymbol } from "@mm-crypto-bot/exchange";
import type { Logger } from "@mm-crypto-bot/logging";

import type { OrderManager } from "../bot/order-manager.js";
import type { PositionManager, PositionSnapshot } from "../bot/position-manager.js";
import { managedErrorMessage, type PortfolioCloseLifecycle } from "./portfolio-close-lifecycle.js";

export interface PortfolioCloseAllReport {
  readonly closed: readonly string[];
  readonly unresolved: readonly string[];
  readonly cancelledOrders: readonly string[];
}

export interface PortfolioCloseCoordinatorOptions {
  readonly closeLifecycle: PortfolioCloseLifecycle;
  readonly configuredSymbols: readonly string[];
  readonly logger: Logger;
  readonly orderManager: OrderManager;
  readonly positionManager: PositionManager;
  readonly requireAuthoritativeEmergencyState: boolean;
}

export class PortfolioCloseCoordinator {
  private readonly closeLifecycle: PortfolioCloseLifecycle;
  private readonly configuredSymbols: readonly string[];
  private readonly logger: Logger;
  private readonly orderManager: OrderManager;
  private readonly positionManager: PositionManager;
  private readonly requireAuthoritativeEmergencyState: boolean;
  private closeAllExecuted = false;
  private closeAllInFlight = false;
  private closeAllPromise: Promise<PortfolioCloseAllReport> | undefined;

  public constructor(options: PortfolioCloseCoordinatorOptions) {
    this.closeLifecycle = options.closeLifecycle;
    this.configuredSymbols = options.configuredSymbols;
    this.logger = options.logger;
    this.orderManager = options.orderManager;
    this.positionManager = options.positionManager;
    this.requireAuthoritativeEmergencyState = options.requireAuthoritativeEmergencyState;
  }

  public didExecuteCloseAll(): boolean {
    return this.closeAllExecuted;
  }

  public async awaitIfTripped(isTripped: boolean): Promise<void> {
    if (isTripped && this.closeAllPromise !== undefined) await this.closeAllPromise;
  }

  public reset(): void {
    this.closeAllInFlight = false;
    this.closeAllExecuted = false;
  }

  public async runCloseAll(): Promise<PortfolioCloseAllReport> {
    let positions: readonly PositionSnapshot[] = this.positionManager.getPositions();
    const localPositionById = new Map(positions.map((position) => [position.id, position]));
    const pendingCloseOrderIds = this.closeLifecycle.getPendingCloseOrderIds();
    const cancelled = await this.orderManager.cancelTrackedOrders(pendingCloseOrderIds);
    const cancelledOrders = cancelled
      .filter((item) => item.error === undefined)
      .map((item) => item.clientOrderId);
    const cancellationFailures = cancelled
      .filter((item) => item.error !== undefined)
      .map((item) => `cancel ${item.clientOrderId}: ${String(item.error)}`);
    const venueOnlyResults: { readonly label: string; readonly closed: boolean }[] = [];
    const localJournalKeys = new Map<string, string>();
    let isAuthoritativeFlatConfirmed =
      !this.requireAuthoritativeEmergencyState || this.orderManager.isPaperMode();
    if (this.requireAuthoritativeEmergencyState && !this.orderManager.isPaperMode()) {
      const symbols = [
        ...new Set([
          ...positions.map((position) => position.symbol),
          ...this.configuredSymbols.map((symbol) => asSymbol(symbol)),
        ]),
      ];
      const marketMeta = new Map<ExchangeSymbol, MarketMeta>();
      for (const symbol of symbols) {
        try {
          marketMeta.set(symbol, await this.orderManager.getMarketMeta(symbol));
        } catch (error) {
          cancellationFailures.push(`market metadata ${symbol}: ${managedErrorMessage(error)}`);
        }
      }

      let exchangePositions: readonly ExchangePosition[] | undefined;
      try {
        exchangePositions = await this.orderManager.getAuthoritativePositions(symbols);
      } catch (error) {
        this.logger.warn("portfolio.position.reconciliation.unavailable", {
          error: managedErrorMessage(error),
        });
      }

      let balances: ReadonlyMap<string, number> | undefined;
      try {
        const authoritativeBalances = await this.orderManager.getAuthoritativeBalances();
        balances = new Map(authoritativeBalances.map((balance) => [balance.currency, balance.total]));
      } catch (error) {
        cancellationFailures.push(`authoritative balances: ${managedErrorMessage(error)}`);
      }

      const derivativeLocalIds = new Map<string, string[]>();
      const spotLocalIds = new Map<ExchangeSymbol, string[]>();
      for (const local of positions) {
        const meta = marketMeta.get(local.symbol);
        if (meta?.isSpot === true) {
          if (local.side !== "long") {
            this.positionManager.reconcileVenueAbsent(local.id);
            cancellationFailures.push(`invalid local spot short removed: ${local.symbol}`);
            continue;
          }
          if (balances === undefined) {
            cancellationFailures.push(`spot inventory unavailable: ${local.symbol}`);
          } else if ((balances.get(meta.base) ?? 0) <= 0) {
            this.positionManager.reconcileVenueAbsent(local.id);
            this.logger.error("portfolio.position.spot.stale.removed", {
              strategy: local.strategy,
              symbol: local.symbol,
            });
          } else {
            const ids = spotLocalIds.get(local.symbol) ?? [];
            ids.push(local.id);
            spotLocalIds.set(local.symbol, ids);
          }
          continue;
        }

        if (exchangePositions === undefined) {
          cancellationFailures.push(`derivative position unavailable: ${local.symbol}`);
          continue;
        }
        const remote = exchangePositions.find(
          (candidate) =>
            candidate.symbol === local.symbol && candidate.side === local.side && candidate.quantity > 0,
        );
        if (remote === undefined) {
          // Do not submit a local-only close: it could create fresh venue exposure.
          this.positionManager.reconcileVenueAbsent(local.id);
          this.logger.error("portfolio.position.derivative.stale.removed", {
            strategy: local.strategy,
            symbol: local.symbol,
            side: local.side,
          });
          continue;
        }
        const key = this.closeLifecycle.derivativeCloseKey(remote.symbol, remote.side);
        const ids = derivativeLocalIds.get(key) ?? [];
        ids.push(local.id);
        derivativeLocalIds.set(key, ids);
      }
      // In authoritative mode every venue exposure is closed exactly once.
      // Local strategy positions are merely attribution targets for fill
      // bookkeeping; they never create an additional venue order.
      positions = [];

      if (exchangePositions !== undefined) {
        for (const remote of exchangePositions) {
          const key = this.closeLifecycle.derivativeCloseKey(remote.symbol, remote.side);
          const localIds = derivativeLocalIds.get(key) ?? [];
          const isClosed = await this.closeLifecycle.placeVenueOnlyClose(remote, localIds);
          const [localPositionId] = localIds;
          const attributed =
            localPositionId === undefined ? undefined : localPositionById.get(localPositionId);
          venueOnlyResults.push({
            label:
              attributed === undefined
                ? `venue/${remote.symbol}/${remote.side}`
                : `${attributed.strategy}/${remote.symbol}/${remote.side}`,
            closed: isClosed,
          });
        }
      }
      if (balances !== undefined) {
        for (const [symbol, meta] of marketMeta) {
          if (meta.isSpot !== true) continue;
          const venueQuantity = this.closeLifecycle.roundSpotQuantity(balances.get(meta.base) ?? 0, meta);
          if (!this.closeLifecycle.isTradableSpotQuantity(venueQuantity, meta, undefined)) continue;
          const localIds = spotLocalIds.get(symbol) ?? [];
          const isClosed = await this.closeLifecycle.placeVenueOnlySpotClose(
            symbol,
            venueQuantity,
            meta,
            localIds,
          );
          const [localPositionId] = localIds;
          const attributed =
            localPositionId === undefined ? undefined : localPositionById.get(localPositionId);
          venueOnlyResults.push({
            label:
              attributed === undefined
                ? `venue/${symbol}/spot`
                : `${attributed.strategy}/${symbol}/${attributed.side}`,
            closed: isClosed,
          });
        }
      }

      // Create/cancel responses are acknowledgements, not proof that venue
      // exposure is gone.  A close-all latch is therefore allowed only after
      // a fresh authoritative snapshot observes both derivatives and spot
      // inventory as flat, in addition to the local journal being empty.
      const verification = await this.closeLifecycle.verifyAuthoritativeFlat(symbols, marketMeta);
      isAuthoritativeFlatConfirmed = verification.flat;
      cancellationFailures.push(...verification.failures);
      if (!verification.flat && verification.failures.length === 0) {
        cancellationFailures.push("authoritative venue exposure remains open");
      }
    }
    this.logger.critical("portfolio.closeall.started", {
      openPositions: positions.length,
      perStrategy: positions.map((p) => ({
        strategy: p.strategy,
        symbol: p.symbol,
        side: p.side,
        quantity: p.quantity,
        notionalUsd: p.notionalUsd,
      })),
    });
    const results = await Promise.all(
      positions.map(async (pos) => ({
        pos,
        closed: await this.closeLifecycle.placeCloseOrder(
          pos,
          undefined,
          "portfolio-stop-close",
          localJournalKeys.get(pos.id),
        ),
      })),
    );
    const unresolved = results.filter((result) => !result.closed);
    // A close acknowledgement is not completion.  Keep the latch clear when
    // any position remains, so a subsequent emergency evaluation may retry.
    this.closeAllExecuted =
      cancellationFailures.length === 0 &&
      unresolved.length === 0 &&
      venueOnlyResults.every((result) => result.closed) &&
      isAuthoritativeFlatConfirmed &&
      this.positionManager.getPositions().length === 0 &&
      this.closeLifecycle.getPendingCloseCount() === 0;
    if (unresolved.length > 0 || !this.closeAllExecuted) {
      this.logger.error("portfolio.closeall.incomplete", {
        unresolved: unresolved.map(({ pos }) => ({
          strategy: pos.strategy,
          symbol: pos.symbol,
          side: pos.side,
        })),
      });
      return {
        closed: results
          .filter((result) => result.closed)
          .map((result) => `${result.pos.strategy}/${result.pos.symbol}`),
        unresolved: [
          ...cancellationFailures,
          ...unresolved.map((result) => `${result.pos.strategy}/${result.pos.symbol}/${result.pos.side}`),
          ...venueOnlyResults.filter((result) => !result.closed).map((result) => result.label),
        ],
        cancelledOrders,
      };
    }
    this.logger.info("portfolio.closeall.completed", {
      closedPositions: positions.length,
    });
    return {
      closed: [
        ...results.map((result) => `${result.pos.strategy}/${result.pos.symbol}`),
        ...venueOnlyResults.filter((result) => result.closed).map((result) => result.label),
      ],
      unresolved: cancellationFailures,
      cancelledOrders,
    };
  }

  public async executeCloseAll(): Promise<PortfolioCloseAllReport> {
    if (this.closeAllInFlight && this.closeAllPromise !== undefined) {
      // A second emergency caller (e.g. registry + PortfolioStop) must await
      // the existing attempt; returning early would let Bot.stop tear down the
      // feed while the first close/cancel requests are still running.
      return this.closeAllPromise;
    }
    if (this.closeAllExecuted) {
      return { closed: [], unresolved: [], cancelledOrders: [] };
    }
    this.closeAllInFlight = true;
    this.closeAllPromise = this.runCloseAll();
    try {
      return await this.closeAllPromise;
    } finally {
      this.closeAllInFlight = false;
    }
  }

  /**
   * `runCloseAll` — a tényleges close-all implementáció. A `closeAllPromise`
   * mezőbe kerül, hogy a tesztek / a `recordEquityAndSettle` tudjon
   * rá várakozni.
   */
}
