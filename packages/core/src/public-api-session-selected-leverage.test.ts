import { expect, test } from "bun:test";

import {
  assertSelectedLeverageUnchanged,
  freezeSelectedLeverage,
  type FrozenSelectedLeverage,
} from "./index.js";
import { SelectedLeverage } from "@mm-crypto-bot/numeric";

test("exports the session selected leverage API from the core root barrel", () => {
  const frozen: FrozenSelectedLeverage = freezeSelectedLeverage(SelectedLeverage.parse("2.5"));

  expect(() => {
    assertSelectedLeverageUnchanged(frozen, SelectedLeverage.parse("2.5"));
  }).not.toThrow();
});
