import type { BybitEuClient } from "./bybit-eu-client.js";
import {
  type SpotMarginAuthorizationClient,
  SpotMarginAuthorizationError,
} from "./spot-margin-authorization.js";

export class CcxtBybitEuSpotMarginClient implements SpotMarginAuthorizationClient {
  constructor(private readonly exchange: BybitEuClient) {}

  async getSpotMarginState(): Promise<unknown> {
    const endpoint = this.exchange.privateGetV5SpotMarginTradeState;
    if (endpoint === undefined) {
      throw new SpotMarginAuthorizationError(
        "CCXT bybiteu does not expose the required V5 Spot Margin state endpoint",
        undefined,
      );
    }
    return endpoint.call(this.exchange);
  }

  async setSpotMarginLeverage(input: Readonly<{ leverage: string }>): Promise<unknown> {
    const endpoint = this.exchange.privatePostV5SpotMarginTradeSetLeverage;
    if (endpoint === undefined) {
      throw new SpotMarginAuthorizationError(
        "CCXT bybiteu does not expose the required V5 Spot Margin leverage set endpoint",
        undefined,
      );
    }
    return endpoint.call(this.exchange, input);
  }

  async getBorrowQuota(
    input: Readonly<{
      category: "spot";
      symbol: string;
      side: "Buy" | "Sell";
    }>,
  ): Promise<unknown> {
    const endpoint = this.exchange.privateGetV5OrderSpotBorrowCheck;
    if (endpoint === undefined) {
      throw new SpotMarginAuthorizationError(
        "CCXT bybiteu does not expose the required V5 Spot Margin borrow endpoint",
        undefined,
      );
    }
    return endpoint.call(this.exchange, input);
  }
}
