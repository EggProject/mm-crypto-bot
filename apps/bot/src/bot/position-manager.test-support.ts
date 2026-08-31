import { asSymbol, type Symbol as ExchangeSymbol } from "@mm-crypto-bot/exchange";

import { RecordingLogger } from "@logging-testing";
import { PositionManager as RuntimePositionManager } from "./position-manager.js";
import { RiskManager as RuntimeRiskManager } from "../risk/risk-manager.js";

export class PositionManager extends RuntimePositionManager {
  public constructor(...arguments_: ConstructorParameters<typeof RuntimePositionManager>) {
    const [options] = arguments_;
    super({ ...options, logger: new RecordingLogger() });
  }
}

export class RiskManager extends RuntimeRiskManager {
  public constructor(...arguments_: ConstructorParameters<typeof RuntimeRiskManager>) {
    const [options] = arguments_;
    super({ ...options, logger: new RecordingLogger() });
  }
}

export function makeSymbol(): ExchangeSymbol {
  return asSymbol("BTC/USDC");
}
