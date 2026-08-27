import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { nodeCommandStateFilePort } from "./command-state-file.js";

describe("node command state-file port", () => {
  it("reports absence and reads a present UTF-8 state file", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "mm-command-state-file-"));
    const stateFile = path.join(directory, "state.json");
    try {
      expect(nodeCommandStateFilePort.exists(stateFile)).toBe(false);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- The path is a child of this test's fresh mkdtemp root.
      writeFileSync(stateFile, '{"version":1}', "utf8");
      expect(nodeCommandStateFilePort.exists(stateFile)).toBe(true);
      expect(nodeCommandStateFilePort.readText(stateFile)).toBe('{"version":1}');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
