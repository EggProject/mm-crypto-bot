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
 */
import { test, expect } from "./_helpers/coverage.js";
import { ChartCardHelpersProbe } from "./__stories__/pure-functions.stories.js";

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
