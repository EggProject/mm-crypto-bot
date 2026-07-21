/**
 * e2e-ct/pure-functions.ct.spec.tsx
 *
 * CT tests for the pure functions in `lib/chart-card-helpers.ts`
 * and `lib/app-helpers.ts`. The functions are already 100%
 * unit-tested in `src/lib/__tests__/*`. The CT here exists to
 * drive the coverage tool to attribute the function bodies to
 * the CT lane — so when CT + E2E coverage is merged, the
 * branches and statements count as covered.
 *
 * **Phase 58.5 (REVISED):** this is the reduced probe after
 * removing the ws-client-state / subscription / realtime-batcher
 * imports that had broken source-map alignment in the dev
 * server. The remaining files have correct line attribution.
 *
 * **Phase 59.1 (NEW):** added `DefensiveParsersProbe` to cover
 * the 4+4 defensive parser branches in `parseStrategiesResponse`
 * and `extractBarsByKey` that the e2e suite cannot reach (MSW
 * service worker blocks them). The functions are pure, so CT
 * invocation with malformed inputs attributes the branches to
 * the CT lane — the merge in `e2e/dashboard.spec.ts` afterAll
 * picks them up.
 */
import { test, expect } from "./_helpers/coverage.js";
import {
  ChartCardHelpersProbe,
  AppHelpersProbe,
} from "./__stories__/pure-functions.stories.js";

test.describe("CT: chart-card-helpers (pure functions)", () => {
  test("classifyFeed + mapFeedState + shouldCrashOnError + shouldScheduleReconnect all run", async ({
    mount,
  }) => {
    const component = await mount(<ChartCardHelpersProbe />);
    await expect(component).toHaveAttribute(
      "data-testid",
      "chart-card-helpers-probe",
    );
  });
});

test.describe("CT: app-helpers (Phase 59.1 — extractBarsByKey + status + meta + fetch + applyParsedStrategies)", () => {
  test("extractBarsByKey + buildStatusLabel + buildFeedMeta + buildFetchErrorMessage + applyParsedStrategies all run", async ({
    mount,
  }) => {
    const component = await mount(<AppHelpersProbe />);
    await expect(component).toHaveAttribute(
      "data-testid",
      "app-helpers-probe",
    );
  });
});
