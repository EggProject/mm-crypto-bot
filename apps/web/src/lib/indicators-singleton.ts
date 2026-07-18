/**
 * apps/web/src/lib/indicators-singleton.ts
 *
 * Phase 55-5: the module-level `IndicatorRegistry` singleton.
 *
 * The dashboard needs ONE IndicatorRegistry instance shared
 * across all chart cards. The registry is bootstrapped at
 * module-load time with the four canonical indicators
 * (donchian, funding, cascade, signals) so the chart card
 * can look up the right renderer by name without each
 * component re-importing every indicator file.
 *
 * **Why a singleton and not a per-component registry:**
 *   - The four indicator renderers are stateless pure
 *     functions; the registry is the only piece of state
 *     (`Map<name, IndicatorRenderer>`).
 *   - Re-registering on every render is wasteful (the
 *     renderers are module-level constants, not closures
 *     that capture per-card state).
 *   - Tests can swap the singleton via the test-friendly
 *     `setIndicatorRegistry()` setter (e.g. to register a
 *     custom test renderer that asserts on the input).
 *
 * **Why not export the bare `IndicatorRegistry` class
 * directly:** the chart card should not need to know which
 * indicators exist; it only needs `get(name)` to look up
 * the renderer. The singleton hides the registration list
 * behind a stable API.
 *
 * **Forward-compat:** a future phase may want to add
 * lazy registration (only register the indicators the
 * dashboard actually subscribes to, to keep the
 * `lightweight-charts` import surface small). For now
 * the eager registration is fine — all four renderers
 * are already imported in the bun unit tests anyway.
 */

import { IndicatorRegistry } from "../indicators/registry.js";
import {
  DONCHIAN_INDICATOR_NAME,
  renderDonchian,
} from "../indicators/donchian.js";
import { FUNDING_INDICATOR_NAME, renderFunding } from "../indicators/funding.js";
import {
  CASCADE_INDICATOR_NAME,
  renderCascade,
} from "../indicators/cascade.js";
import { SIGNALS_INDICATOR_NAME, renderSignals } from "../indicators/signals.js";

/**
 * The shared indicator registry, populated with the four
 * canonical renderers. Lazily constructed on first access
 * (the function call is the lazy-init gate) so test code
 * that imports the module without ever calling
 * `getIndicatorRegistry()` does not pay the registration cost.
 */
let _registry: IndicatorRegistry | null = null;

/**
 * `getIndicatorRegistry` — return the shared registry.
 *
 * The first call constructs the registry and registers the
 * four renderers. Subsequent calls return the same instance.
 * The chart card calls this on every render; the cost is
 * one pointer check + one branch per call.
 */
export function getIndicatorRegistry(): IndicatorRegistry {
  if (_registry === null) {
    const r = new IndicatorRegistry();
    r.register(DONCHIAN_INDICATOR_NAME, renderDonchian);
    r.register(FUNDING_INDICATOR_NAME, renderFunding);
    r.register(CASCADE_INDICATOR_NAME, renderCascade);
    r.register(SIGNALS_INDICATOR_NAME, renderSignals);
    _registry = r;
  }
  return _registry;
}

/**
 * `setIndicatorRegistry` — test-only: replace the singleton
 * with a custom registry. Returns the previous registry so
 * the caller can restore it in an `afterEach`.
 *
 * **Why a setter and not a per-call `registry` prop:** the
 * chart card's component tree is fixed (the registry is
 * fetched at render-time, not passed in); a test that wants
 * to inject a custom registry would otherwise have to wrap
 * every ChartCard in a context provider. The setter is the
 * minimum-friction injection point.
 */
export function setIndicatorRegistry(r: IndicatorRegistry | null): IndicatorRegistry | null {
  const prev = _registry;
  _registry = r;
  return prev;
}
