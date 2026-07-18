/**
 * apps/web/src/lib/indicator-bridge.ts
 *
 * Phase 55-5: pure conversion library for indicator data flowing
 * from the state-feed `INDICATOR` WS messages into the dashboard's
 * chart cards.
 *
 * Mirrors the structure of `lib/ohlc-bridge.ts` (bars) and
 * `lib/subscription.ts` (chart subscription keys):
 *   - `chartIndicatorKey(strategy, timeframe)` — the canonical
 *     `strategy|timeframe` key, matching the convention used by
 *     `chartKeyToString` in `subscription.ts`. The
 *     `INDICATOR` WS message carries `strategy` and `timeframe`
 *     but NOT `symbol` (the indicator is computed per-symbol
 *     server-side and broadcast per-(strategy, timeframe) pair;
 *     the dashboard merges across symbols by keying on
 *     `(strategy, timeframe)`).
 *   - `extractIndicatorFromMessage(msg)` — validate the
 *     `INDICATOR` WS message shape and return a typed
 *     `IndicatorMessage` if valid, else `null`. Loosely typed
 *     at the boundary (the WS message has `series: object` per
 *     the protocol); the type-guard narrows.
 *   - `mergeIndicatorsByKey(prev, msg)` — append/overwrite a
 *     single INDICATOR message into the existing indicators map.
 *     New messages for the same key REPLACE the previous entry
 *     (the state-feed retransmits on every update; the latest
 *     wins).
 *
 * NO React imports, NO DOM access, NO I/O. Every function is
 * pure, deterministic, and null-safe. Unit-testable in
 * isolation with bun:test.
 */

// ============================================================================
// Public types
// ============================================================================

/** The INDICATOR WS message shape (loose; the ws-client.ts
 *  `ServerMessage` union types it as `series: object`). */
export interface IndicatorMessage {
  readonly type: "indicator";
  readonly ts: number;
  readonly strategy: string;
  readonly timeframe: string;
  readonly indicator: string;
  readonly series: object;
}

/**
 * `IndicatorEntry` — a single indicator's data, keyed by
 * `(strategy, timeframe)`. The `series` field is the loose
 * `IndicatorSeries` shape — the per-indicator `validateXxxSeries`
 * is the type-guard for the inner structure (e.g. `upper` /
 * `middle` / `lower` for donchian, `dydx` / `cex` / `spread`
 * for funding, `events` for cascade).
 *
 * The `name` field is the registry key (e.g. `"donchian"`,
 * `"funding"`, `"cascade"`, `"signals"`). The `strategy` and
 * `timeframe` fields are kept on the entry so the chart card
 * can compose the unique `RenderedIndicator.name` without
 * re-passing them.
 */
export interface IndicatorEntry {
  readonly name: string;
  readonly strategy: string;
  readonly timeframe: string;
  readonly series: object;
  /** Last update timestamp (ms). Forwards from the INDICATOR
   *  message's `ts` field; useful for stale-detection in
 *  future phases. */
  readonly ts: number;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * `chartIndicatorKey` — compose the canonical key for an
 * indicator entry.
 *
 * Format: `${strategy}|${timeframe}` (mirrors the `chartKeyToString`
 * convention in `lib/subscription.ts`). The `|` separator is
 * safe — strategy names (e.g. `donchian_pivot_composition`) and
 * timeframes (e.g. `1h`, `4h`) never contain it.
 */
export function chartIndicatorKey(strategy: string, timeframe: string): string {
  return `${strategy}|${timeframe}`;
}

/**
 * `extractIndicatorFromMessage` — type-guard + structural
 * validation for a single INDICATOR WS message.
 *
 * Returns a typed `IndicatorEntry` if the message has the
 * required fields (all strings + an object series), else `null`.
 *
 * **Why defensive:** the ws-client `ServerMessage` union types
 * `series: object` and the strategy/timeframe/indicator/ts
 * fields as `string`/`number`, but a malformed server-side
 * message could send a non-object series or a non-string
 * indicator name. The dashboard's `App.tsx` subscribes to
 * `onIndicator`; passing the message straight into React
 * state without validation would risk a render crash.
 *
 * **Null-safe:** an invalid message returns `null` (never
 * throws). The caller logs a warning and skips the entry.
 */
export function extractIndicatorFromMessage(msg: unknown): IndicatorEntry | null {
  if (typeof msg !== "object" || msg === null) return null;
  const m = msg as Record<string, unknown>;
  if (m.type !== "indicator") return null;
  if (typeof m.strategy !== "string" || m.strategy === "") return null;
  if (typeof m.timeframe !== "string" || m.timeframe === "") return null;
  if (typeof m.indicator !== "string" || m.indicator === "") return null;
  if (typeof m.ts !== "number") return null;
  if (typeof m.series !== "object" || m.series === null) return null;
  return {
    name: m.indicator,
    strategy: m.strategy,
    timeframe: m.timeframe,
    series: m.series,
    ts: m.ts,
  };
}

/**
 * `mergeIndicatorsByKey` — apply ONE INDICATOR message to the
 * existing indicators map.
 *
 * Semantics:
 *   - If the extracted entry is `null` (invalid message) →
 *     return the previous map unchanged.
 *   - Compute the key from the entry's `(strategy, timeframe)`.
 *   - Upsert: replace the entry at the key (or add a new one).
 *   - The returned object is a fresh object (no mutation of
 *     the input); React's setState picks up the identity
 *     change and triggers a re-render.
 *
 * **Why upsert and not append:** the state-feed retransmits
 * the same indicator on every update; the latest values win
 * (per the comment in the state-feed strategy code — the
 * "incremental indicator update" pattern). The dashboard
 * always shows the freshest indicator state.
 */
export function mergeIndicatorsByKey(
  prev: Readonly<Record<string, IndicatorEntry>>,
  msg: unknown,
): Readonly<Record<string, IndicatorEntry>> {
  const entry = extractIndicatorFromMessage(msg);
  if (entry === null) return prev;
  const key = chartIndicatorKey(entry.strategy, entry.timeframe);
  return { ...prev, [key]: entry };
}
