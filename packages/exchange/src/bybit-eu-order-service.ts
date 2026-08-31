import { canonicalizeExternalDecimal, SelectedLeverage } from "@mm-crypto-bot/numeric";

import type { BybitEuClient } from "./bybit-eu-client.js";
import { makeClientOrderId } from "./client-order-id.js";
import { CcxtBybitEuSpotMarginClient } from "./bybit-eu-spot-margin-client.js";
import { normalizeOrder } from "./bybit-eu-normalizers.js";
import type { RawMarketPayload } from "./bybit-eu-raw-payloads.js";
import { ExchangeFeedError } from "./feed.js";
import { symbolOf } from "./symbols.js";
import {
  SpotMarginAuthorizer,
  type SpotMarginAuthorizationClient,
  type SpotMarginClock,
} from "./spot-margin-authorization.js";
import type {
  ClientOrderId,
  Order,
  OrderRequest,
  OrderStatus,
  SpotMarginOrderIntent,
  Symbol,
} from "./types.js";

interface ClientOrderMetadata {
  readonly spotOrderFilter: "Order" | "StopOrder" | undefined;
  readonly terminalAt: number | undefined;
}

type ValidatedOrderPrimitives = Readonly<{
  readonly clientOrderId: ClientOrderId;
  readonly symbol: Symbol;
  readonly side: "buy" | "sell";
  readonly type: "market" | "limit";
  readonly amount: number;
  readonly price: number | undefined;
  readonly selectedSpotMarginLeverage: SelectedLeverage;
  readonly spotMarginOrderIntent: SpotMarginOrderIntent;
  readonly spotMarginRequiredCapacity: string | undefined;
}> &
  ValidatedProtectiveOrder;

type ValidatedProtectiveOrder =
  | Readonly<{ protectiveKind: undefined; triggerPrice: number | undefined }>
  | Readonly<{ protectiveKind: "stop_loss" | "take_profit"; triggerPrice: number }>;

export interface SpotMarginAuthorizationOptions {
  readonly maximumAgeMs: number;
  readonly clock: SpotMarginClock;
  readonly client?: SpotMarginAuthorizationClient;
}

const CLIENT_ORDER_METADATA_LIMIT = 5000;
const CLIENT_ORDER_TERMINAL_TTL_MS = 60 * 60 * 1000;
const SPOT_MARGIN_ORDER_INTENTS = new Set<string>(["risk_increasing", "risk_reducing"]);
const PROTECTIVE_ORDER_KINDS = new Set<string>(["stop_loss", "take_profit"]);

export class BybitEuOrderService {
  private readonly metadata = new Map<ClientOrderId, ClientOrderMetadata>();
  private readonly metadataNowUtcMs: () => number;
  private readonly spotMarginAuthorizer: SpotMarginAuthorizer | undefined;
  private readonly spotMarginAuthorizationMaximumAgeMs: number | undefined;

  constructor(
    private readonly client: BybitEuClient,
    authorization: SpotMarginAuthorizationOptions | undefined,
  ) {
    this.metadataNowUtcMs = authorization === undefined ? Date.now : () => authorization.clock.nowUtcMs();
    if (authorization === undefined) {
      return;
    }

    this.spotMarginAuthorizer = new SpotMarginAuthorizer(
      authorization.client ?? new CcxtBybitEuSpotMarginClient(client),
      authorization.clock,
    );
    this.spotMarginAuthorizationMaximumAgeMs = authorization.maximumAgeMs;
  }

  private async authorizeSpotMarginOrder(
    selectedLeverage: SelectedLeverage,
    symbol: Symbol,
    side: "buy" | "sell",
    intent: SpotMarginOrderIntent,
    requiredCapacity: string | undefined,
    bybitSymbol: string,
  ): Promise<void> {
    if (this.spotMarginAuthorizer === undefined || this.spotMarginAuthorizationMaximumAgeMs === undefined) {
      throw new ExchangeFeedError(
        "Bybit EU Spot Margin authorization is required before every spot order",
        undefined,
      );
    }
    try {
      const evidence = await this.spotMarginAuthorizer.authorize({
        selectedLeverage,
        symbol,
        bybitSymbol,
        side,
        intent,
        requiredCapacity,
      });
      this.spotMarginAuthorizer.assertFresh(evidence, this.spotMarginAuthorizationMaximumAgeMs);
    } catch (error) {
      throw new ExchangeFeedError("Bybit EU Spot Margin order authorization failed", error);
    }
  }

  private approvedSpotMarketSymbol(symbol: Symbol): string {
    let market: RawMarketPayload;
    try {
      market = this.client.market(symbol);
    } catch (error) {
      throw new ExchangeFeedError("Bybit EU market is not an approved Spot Margin market", error);
    }
    if (market.spot !== true || typeof market.id !== "string" || market.id.length === 0) {
      throw new ExchangeFeedError("Bybit EU market is not an approved Spot Margin market", undefined);
    }
    return market.id;
  }

  private remember(
    clientOrderId: ClientOrderId,
    spotOrderFilter: "Order" | "StopOrder" | undefined,
    status: OrderStatus,
  ): void {
    const nowUtcMs = this.metadataNowUtcMs();
    const terminalAt = status === "open" ? undefined : nowUtcMs;
    this.metadata.delete(clientOrderId);
    this.metadata.set(clientOrderId, { spotOrderFilter, terminalAt });
    const cutoff = nowUtcMs - CLIENT_ORDER_TERMINAL_TTL_MS;
    for (const [identifier, value] of this.metadata) {
      if (value.terminalAt === undefined) continue;
      if (value.terminalAt < cutoff) this.metadata.delete(identifier);
    }
    while (this.metadata.size > CLIENT_ORDER_METADATA_LIMIT) {
      deleteOldestMetadata(this.metadata);
    }
  }

  async place(request: OrderRequest): Promise<Order> {
    const primitives = snapshotOrderRequest(request);
    const {
      clientOrderId,
      symbol,
      side,
      type,
      amount,
      price,
      selectedSpotMarginLeverage,
      spotMarginOrderIntent,
      spotMarginRequiredCapacity,
      protectiveKind,
      triggerPrice,
    } = primitives;
    if (type === "limit" && price === undefined) {
      throw new ExchangeFeedError(`Limit order requires a price: ${clientOrderId}`, undefined);
    }
    const bybitSymbol = this.approvedSpotMarketSymbol(symbol);
    const parameters: Record<string, unknown> = { orderLinkId: clientOrderId };
    await this.authorizeSpotMarginOrder(
      selectedSpotMarginLeverage,
      symbol,
      side,
      spotMarginOrderIntent,
      spotMarginRequiredCapacity,
      bybitSymbol,
    );
    parameters["isLeverage"] = 1;
    if (protectiveKind !== undefined) {
      addSpotConditionalParameters(parameters, { protectiveKind, triggerPrice });
    }
    const raw = await this.client.createOrder(symbol, type, side, amount, price, parameters);
    const order = normalizeOrder(raw, {
      clientOrderId,
      symbol,
      side,
      type,
      amount,
      ...(price !== undefined && { price }),
    });
    this.remember(clientOrderId, spotFilterOf(protectiveKind), order.status);
    return order;
  }

  async cancel(clientOrderId: ClientOrderId, symbol: Symbol): Promise<Order> {
    const canonicalClientOrderId = makeClientOrderId(clientOrderId);
    const metadata = this.metadata.get(canonicalClientOrderId);
    this.approvedSpotMarketSymbol(symbol);
    const parameters: Record<string, unknown> = {
      orderLinkId: canonicalClientOrderId,
      orderFilter: metadata?.spotOrderFilter ?? "Order",
    };
    const raw = await this.client.cancelOrder(undefined, symbol, parameters);
    const order = normalizeOrder(raw, undefined);
    this.remember(canonicalClientOrderId, parameterSpotFilter(parameters), order.status);
    return order;
  }

  async fetch(clientOrderId: ClientOrderId, symbol: Symbol): Promise<Order> {
    const canonicalClientOrderId = makeClientOrderId(clientOrderId);
    const metadata = this.metadata.get(canonicalClientOrderId);
    this.approvedSpotMarketSymbol(symbol);
    const parameters: Record<string, unknown> = {
      orderLinkId: canonicalClientOrderId,
      acknowledged: true,
      ...(metadata?.spotOrderFilter === "StopOrder" && { trigger: true }),
    };
    const raw = await this.client.fetchOrder(undefined, symbol, parameters);
    const order = normalizeOrder(raw, undefined);
    this.remember(canonicalClientOrderId, metadata?.spotOrderFilter, order.status);
    return order;
  }

  async fetchOpen(symbol: Symbol): Promise<readonly Order[]> {
    this.approvedSpotMarketSymbol(symbol);
    const orders = await this.client.fetchOpenOrders(symbol);
    return orders.map((order) => normalizeOrder(order, undefined));
  }
}

function deleteOldestMetadata(metadata: Map<ClientOrderId, ClientOrderMetadata>): void {
  for (const clientOrderId of metadata.keys()) {
    metadata.delete(clientOrderId);
    return;
  }
}

function snapshotOrderRequest(request: unknown): ValidatedOrderPrimitives {
  try {
    if (!isRecord(request)) throw new Error("Order request is not a record");
    const clientOrderId = makeClientOrderId(Reflect.get(request, "clientOrderId"));
    const symbol = requiredSymbol(Reflect.get(request, "symbol"));
    const side = requiredOrderSide(Reflect.get(request, "side"));
    const type = requiredOrderType(Reflect.get(request, "type"));
    const amount = requiredPositiveFiniteNumber(Reflect.get(request, "amount"), "Order amount");
    const price = optionalPositiveFiniteNumber(Reflect.get(request, "price"), "Order price");
    const selectedSpotMarginLeverage = requiredSelectedLeverage(
      Reflect.get(request, "selectedSpotMarginLeverage"),
    );
    const spotMarginOrderIntent = requiredOrderIntent(Reflect.get(request, "spotMarginOrderIntent"));
    const spotMarginRequiredCapacity = requiredRequestCapacity(
      spotMarginOrderIntent,
      Reflect.get(request, "spotMarginRequiredCapacity"),
    );
    const protective = validatedProtectiveOrder(
      optionalProtectiveKind(Reflect.get(request, "protectiveKind")),
      Reflect.get(request, "triggerPrice"),
    );
    return Object.freeze({
      clientOrderId,
      symbol,
      side,
      type,
      amount,
      price,
      selectedSpotMarginLeverage,
      spotMarginOrderIntent,
      spotMarginRequiredCapacity,
      ...protective,
    });
  } catch (error) {
    if (error instanceof ExchangeFeedError) throw error;
    throw new ExchangeFeedError("Bybit EU Spot Margin order request is malformed", error);
  }
}

function validatedProtectiveOrder(
  protectiveKind: "stop_loss" | "take_profit" | undefined,
  triggerPrice: unknown,
): ValidatedProtectiveOrder {
  const validatedTriggerPrice = optionalPositiveFiniteNumber(triggerPrice, "Protective trigger price");
  if (protectiveKind === undefined) return { protectiveKind, triggerPrice: validatedTriggerPrice };
  if (validatedTriggerPrice === undefined) {
    throw new ExchangeFeedError("Protective order requires triggerPrice", undefined);
  }
  return { protectiveKind, triggerPrice: validatedTriggerPrice };
}

function requiredRequestCapacity(intent: SpotMarginOrderIntent, capacity: unknown): string | undefined {
  if (intent === "risk_reducing" && capacity === undefined) return;
  if (typeof capacity !== "string" || !isCanonicalPositiveDecimal(capacity)) {
    throw new ExchangeFeedError("Bybit EU Spot Margin required capacity is missing or malformed", undefined);
  }
  return capacity;
}

function requiredSymbol(value: unknown): Symbol {
  if (typeof value !== "string")
    throw new ExchangeFeedError("Bybit EU Spot Margin symbol is malformed", undefined);
  return symbolOf(value);
}

function isCanonicalPositiveDecimal(value: unknown): boolean {
  try {
    const canonical = canonicalizeExternalDecimal(value);
    return canonical === value && canonical !== "0" && !canonical.startsWith("-");
  } catch {
    return false;
  }
}

function requiredOrderSide(value: unknown): "buy" | "sell" {
  if (value === "buy" || value === "sell") return value;
  throw new ExchangeFeedError("Bybit EU Spot Margin order side is malformed", undefined);
}

function requiredOrderType(value: unknown): "market" | "limit" {
  if (value === "market" || value === "limit") return value;
  throw new ExchangeFeedError("Bybit EU Spot Margin order type is malformed", undefined);
}

function requiredSelectedLeverage(value: unknown): SelectedLeverage {
  try {
    if (!(value instanceof SelectedLeverage)) {
      throw new TypeError("Selected leverage is not an authentic instance");
    }
    Reflect.get(SelectedLeverage.prototype, "canonical", value);
    return value;
  } catch (error) {
    throw new ExchangeFeedError(
      "Every live Bybit EU Spot Margin order requires an authentic selected leverage",
      error,
    );
  }
}

function requiredOrderIntent(value: unknown): SpotMarginOrderIntent {
  if (isSpotMarginOrderIntent(value)) return value;
  throw new ExchangeFeedError(
    "Every live Bybit EU Spot Margin order requires an explicit position-authority intent",
    undefined,
  );
}

function optionalProtectiveKind(value: unknown): "stop_loss" | "take_profit" | undefined {
  if (value === undefined) return undefined;
  if (isProtectiveOrderKind(value)) return value;
  throw new ExchangeFeedError("Protective order kind is malformed", undefined);
}

function isSpotMarginOrderIntent(value: unknown): value is SpotMarginOrderIntent {
  return typeof value === "string" && SPOT_MARGIN_ORDER_INTENTS.has(value);
}

function isProtectiveOrderKind(value: unknown): value is "stop_loss" | "take_profit" {
  return typeof value === "string" && PROTECTIVE_ORDER_KINDS.has(value);
}

function requiredPositiveFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new ExchangeFeedError(`${label} must be a positive finite number`, undefined);
  }
  return value;
}

function optionalPositiveFiniteNumber(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  return requiredPositiveFiniteNumber(value, label);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function addSpotConditionalParameters(
  parameters: Record<string, unknown>,
  request: Readonly<{
    protectiveKind: "stop_loss" | "take_profit";
    triggerPrice: number;
  }>,
): void {
  Object.assign(parameters, { triggerPrice: request.triggerPrice, orderFilter: "StopOrder" });
}

function spotFilterOf(protectiveKind: "stop_loss" | "take_profit" | undefined): "Order" | "StopOrder" {
  return protectiveKind === undefined ? "Order" : "StopOrder";
}

function parameterSpotFilter(parameters: Record<string, unknown>): "Order" | "StopOrder" {
  return parameters["orderFilter"] === "StopOrder" ? "StopOrder" : "Order";
}
