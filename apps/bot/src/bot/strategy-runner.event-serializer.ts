import type { Symbol as ExchangeSymbol } from "@mm-crypto-bot/exchange";

export type SymbolEventOperation = () => Promise<void>;

export class StrategyRunnerEventSerializer {
  private readonly workBySymbol: Map<ExchangeSymbol, Promise<void>>;

  public constructor(workBySymbol: Map<ExchangeSymbol, Promise<void>>) {
    this.workBySymbol = workBySymbol;
  }

  private async runAfter(previous: Promise<void>, operation: SymbolEventOperation): Promise<void> {
    try {
      await previous;
    } catch {
      // A prior rejection must not block the next queued operation.
    }
    await operation();
  }

  public async enqueue(symbol: ExchangeSymbol, operation: SymbolEventOperation): Promise<void> {
    const previous = this.workBySymbol.get(symbol) ?? Promise.resolve();
    const work = this.runAfter(previous, operation);
    this.workBySymbol.set(symbol, work);
    try {
      await work;
    } finally {
      if (this.workBySymbol.get(symbol) === work) this.workBySymbol.delete(symbol);
    }
  }
}
