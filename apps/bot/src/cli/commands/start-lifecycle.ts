import type { Bot } from "../../bot/bot.js";
import type { LiveStatePublisher } from "../../state-feed/publisher.js";

/**
 * Coordinates the two different promises exposed by `Bot.start()`:
 * initialization finishes once, whereas its returned promise remains pending
 * for the lifetime of the market-data run loop. State-feed `running` is
 * consequently emitted only from Bot's explicit ready boundary.
 */
export class HeadlessBotLifecycle {
  private runPromise: Promise<void> | null = null;
  private readinessPromise: Promise<void> | null = null;
  private ready = false;

  public constructor(
    private readonly bot: Bot,
    private readonly publisher: LiveStatePublisher,
  ) {}

  /** Start the engine and resolve only after critical initialization succeeds. */
  public start(): Promise<void> {
    if (this.readinessPromise !== null) return this.readinessPromise;

    let resolveReady: (() => void) | null = null;
    let rejectReady: ((reason: unknown) => void) | null = null;
    this.readinessPromise = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });

    const unsubscribeReady = this.bot.onInitialized(() => {
      this.ready = true;
      this.publisher.setEngineError(null);
      this.publisher.markBotStarted();
      resolveReady?.();
    });
    this.runPromise = this.bot.start();
    void this.runPromise.then(
      () => {
        // A normal run-loop exit (signal, stop control, kill switch) must
        // publish stopped even though `Bot.start()` only resolves afterwards.
        this.publisher.markBotStopped();
        if (!this.ready) {
          rejectReady?.(new Error("[start] bot stopped before initialization completed"));
        }
      },
      (err: unknown) => {
        this.publisher.markBotStopped();
        const message = err instanceof Error ? err.message : String(err);
        this.publisher.setEngineError(message);
        rejectReady?.(err);
      },
    ).finally(() => {
      unsubscribeReady();
      this.runPromise = null;
      this.readinessPromise = null;
      this.ready = false;
    });
    return this.readinessPromise;
  }

  /** Wait for the long-lived run loop after `start()` has reached readiness. */
  public async waitForStop(): Promise<void> {
    const run = this.runPromise;
    if (run !== null) await run;
  }

  /** Idempotent graceful shutdown for both started and stopped modes. */
  public async stop(): Promise<void> {
    try {
      await this.bot.stop();
    } finally {
      this.publisher.markBotStopped();
    }
  }
}
