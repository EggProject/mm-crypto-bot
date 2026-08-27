import { expect, it } from "bun:test";

import * as configCommandApi from "./config.js";

it("does not expose the obsolete edit-validation command API", () => {
  const obsoleteExportName = ["validate", "ConfigForEdit"].join("");

  expect(Object.hasOwn(configCommandApi, obsoleteExportName)).toBe(false);
});
