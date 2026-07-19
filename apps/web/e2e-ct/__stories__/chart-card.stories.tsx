/**
 * e2e-ct/__stories__/chart-card.stories.tsx
 *
 * Story files for the ChartCard component. The CT runner mounts
 * these via `mount(<Component />)` and exercises the component
 * branches that the e2e flow can't easily reach.
 */
import { ChartCard } from "../../src/components/ChartCard.js";

export function ChartCardProbe(): React.JSX.Element {
  return (
    <ChartCard
      strategy="donchian_pivot_composition"
      symbol="BTCUSDT"
      timeframe="1h"
      bars={[]}
      feedState="live"
      ranges={[{ id: "1h", label: "1H" }, { id: "4h", label: "4H" }]}
      activeRange="1h"
      onRangeChange={() => undefined}
    />
  );
}

export function ChartCardCrashed(): React.JSX.Element {
  return (
    <ChartCard
      strategy="donchian_pivot_composition"
      symbol="BTCUSDT"
      timeframe="1h"
      bars={[]}
      feedState="stale"
      feedMeta="fatal test crash"
      ranges={[{ id: "1h", label: "1H" }]}
      activeRange="1h"
      onRangeChange={() => undefined}
    />
  );
}

export function ChartCardNotLive(): React.JSX.Element {
  return (
    <ChartCard
      strategy="donchian_pivot_composition"
      symbol="BTCUSDT"
      timeframe="1h"
      bars={[]}
      feedState="paused"
      ranges={[{ id: "1h", label: "1H" }]}
      activeRange="1h"
      onRangeChange={() => undefined}
    />
  );
}
