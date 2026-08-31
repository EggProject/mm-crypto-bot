import {
  assertAggregateEffectiveExposureLimit,
  type AggregateEffectiveExposureLimit,
} from "@mm-crypto-bot/core";
import type { ClientOrderId, ExchangeOrderId, Order, OrderRequest } from "@mm-crypto-bot/exchange";
import type { Logger } from "@mm-crypto-bot/logging";
import { z } from "zod";

import {
  OrderManagerError,
  type OrderIntent,
  type PaperOrderSimulationOutcome,
  type PositionSizeQuery,
  type ReduciblePosition,
} from "./order-manager.types.js";
import { stringifyUnknownError } from "./stringify-unknown-error.js";

export interface PlacementValidationOptions {
  readonly getPositionContext: () => PositionSizeQuery;
  readonly getReduciblePosition:
    | ((symbol: OrderIntent["symbol"], strategy: string | undefined) => ReduciblePosition | undefined)
    | undefined;
  readonly aggregateExposureLimit: AggregateEffectiveExposureLimit;
  readonly logger: Logger;
  readonly rejectOrder: () => void;
  readonly selectedSpotMarginLeverage?: OrderRequest["selectedSpotMarginLeverage"];
}

export interface ValidatedOrderIntent {
  readonly clientOrderId: ClientOrderId;
  readonly effectiveLeverage: number;
  readonly isReducing: boolean;
  readonly request: OrderRequest;
}

const PaperOrderSimulationOutcomeSchema = z.enum(["filled", "unfilled"]);

export function parsePaperOrderSimulationOutcome(value: unknown): PaperOrderSimulationOutcome {
  return PaperOrderSimulationOutcomeSchema.parse(value);
}

export function validateOrderIntent(
  intent: OrderIntent,
  clientOrderId: ClientOrderId,
  options: PlacementValidationOptions,
): ValidatedOrderIntent {
  const validatedLimitPrice = validateIntentFields(intent, options.aggregateExposureLimit);
  const effectiveLeverage = intent.leverage ?? 1;
  const context = options.getPositionContext();
  const notional = intent.amount * intent.referencePrice;
  const effectiveNotional = notional * effectiveLeverage;
  const existingNotional = context.positions.reduce(
    (accumulator, position) => accumulator + Math.abs(position.effectiveNotionalUsd),
    0,
  );
  const isReducing = intent.reduceOnly === true;
  validateReduceOnlyIntent(intent, context, options, isReducing);
  const totalNotional = isReducing ? existingNotional : existingNotional + effectiveNotional;

  try {
    assertAggregateEffectiveExposureLimit(totalNotional, context.equityUsd, options.aggregateExposureLimit);
  } catch (error) {
    options.rejectOrder();
    options.logger.error("order.leverage.rejected", {
      symbol: intent.symbol,
      amount: intent.amount,
      referencePrice: intent.referencePrice,
      notional,
      effectiveLeverage,
      effectiveNotional,
      existingNotional,
      totalNotional,
      equityUsd: context.equityUsd,
      maxAggregateEffectiveLeverage: options.aggregateExposureLimit.maxAggregateEffectiveLeverage,
      reason: stringifyUnknownError(error),
    });
    throw new OrderManagerError(
      `[order-manager] L2 leverage breach for ${intent.symbol}: ${stringifyUnknownError(error)}`,
      error,
    );
  }

  return {
    clientOrderId,
    effectiveLeverage,
    isReducing,
    request: buildOrderRequest(
      intent,
      clientOrderId,
      isReducing,
      validatedLimitPrice,
      options.selectedSpotMarginLeverage,
    ),
  };
}

export function createPaperOrder(
  intent: OrderIntent,
  clientOrderId: ClientOrderId,
  placementSequence: bigint,
  timestamp: number,
  outcome: PaperOrderSimulationOutcome,
): Order {
  const isFilled = outcome === "filled";
  return {
    clientOrderId,
    // The exchange identifier is an internal paper-mode boundary, not external input.
    exchangeId: `paper-${String(timestamp)}-${String(placementSequence)}` as ExchangeOrderId,
    symbol: intent.symbol,
    side: intent.signal.side,
    type: intent.type,
    amount: intent.amount,
    price: intent.referencePrice,
    status: isFilled ? "closed" : "canceled",
    filled: isFilled ? intent.amount : 0,
    average: isFilled ? intent.referencePrice : 0,
    submitTimestamp: timestamp,
    updateTimestamp: timestamp,
  };
}

function validateIntentFields(
  intent: OrderIntent,
  aggregateExposureLimit: AggregateEffectiveExposureLimit,
): number | undefined {
  if (!Number.isFinite(intent.amount) || intent.amount <= 0) {
    throw new OrderManagerError(
      `[order-manager] invalid amount=${String(intent.amount)} for ${intent.symbol}`,
      new Error("invalid amount"),
    );
  }
  if (!Number.isFinite(intent.referencePrice) || intent.referencePrice <= 0) {
    throw new OrderManagerError(
      `[order-manager] invalid referencePrice=${String(intent.referencePrice)} for ${intent.symbol}`,
      new Error("invalid price"),
    );
  }
  let validatedLimitPrice: number | undefined;
  if (intent.type === "limit") {
    const limitPrice = intent.limitPrice;
    if (limitPrice === undefined || !Number.isFinite(limitPrice) || limitPrice <= 0) {
      throw new OrderManagerError(
        `[order-manager] limit order requires positive limitPrice (got ${String(intent.limitPrice)})`,
        new Error("missing limit price"),
      );
    }
    validatedLimitPrice = limitPrice;
  }
  const triggerPrice = intent.triggerPrice;
  if (
    intent.protectiveKind !== undefined &&
    (triggerPrice === undefined || !Number.isFinite(triggerPrice) || triggerPrice <= 0)
  ) {
    throw new OrderManagerError(
      `[order-manager] ${intent.protectiveKind} requires a positive triggerPrice`,
      new Error("invalid trigger price"),
    );
  }
  const effectiveLeverage = intent.leverage ?? 1;
  if (
    !Number.isFinite(effectiveLeverage) ||
    effectiveLeverage <= 0 ||
    effectiveLeverage > aggregateExposureLimit.maxAggregateEffectiveLeverage
  ) {
    throw new OrderManagerError(
      `[order-manager] invalid effective leverage=${String(effectiveLeverage)} (global max=${String(aggregateExposureLimit.maxAggregateEffectiveLeverage)})`,
      new Error("invalid effective leverage"),
    );
  }
  return validatedLimitPrice;
}

function validateReduceOnlyIntent(
  intent: OrderIntent,
  context: PositionSizeQuery,
  options: PlacementValidationOptions,
  isReducing: boolean,
): void {
  if (!isReducing) return;
  const matchingExposure = context.positions
    .filter((position) => position.symbol === intent.symbol)
    .reduce((sum, position) => sum + position.effectiveNotionalUsd, 0);
  const isExpectedSell = matchingExposure > 0;
  const isSideMatchesExposure = isExpectedSell ? intent.signal.side === "sell" : intent.signal.side === "buy";
  const localPosition = options.getReduciblePosition?.(intent.symbol, intent.strategy);
  const isSideMatchesLocal =
    localPosition === undefined ||
    (localPosition.side === "long" ? intent.signal.side === "sell" : intent.signal.side === "buy");
  const isQuantityMatchesLocal =
    localPosition === undefined ||
    intent.amount <= localPosition.quantity + options.aggregateExposureLimit.tolerance;
  if (
    (localPosition !== undefined && (!isSideMatchesLocal || !isQuantityMatchesLocal)) ||
    (localPosition === undefined && matchingExposure !== 0 && !isSideMatchesExposure)
  ) {
    options.rejectOrder();
    throw new OrderManagerError(
      `[order-manager] invalid reduce-only close for ${intent.symbol}: side/quantity does not match open exposure`,
      new Error("invalid reduce-only close"),
    );
  }
}

function buildOrderRequest(
  intent: OrderIntent,
  clientOrderId: ClientOrderId,
  isReducing: boolean,
  validatedLimitPrice: number | undefined,
  selectedSpotMarginLeverage: OrderRequest["selectedSpotMarginLeverage"],
): OrderRequest {
  return {
    clientOrderId,
    symbol: intent.symbol,
    side: intent.signal.side,
    type: intent.type,
    amount: intent.amount,
    ...(validatedLimitPrice !== undefined && { price: validatedLimitPrice }),
    ...(selectedSpotMarginLeverage !== undefined && { selectedSpotMarginLeverage }),
    ...(isReducing && { reduceOnly: true }),
    ...(intent.protectiveKind !== undefined && {
      protectiveKind: intent.protectiveKind,
      triggerPrice: intent.triggerPrice,
    }),
  };
}
