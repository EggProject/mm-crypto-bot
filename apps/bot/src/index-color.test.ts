import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { fileURLToPath } from "node:url";

class ExitIntercept extends Error {
  public constructor(public readonly code: string | number | null | undefined) {
    super(`intercepted process.exit(${String(code)})`);
  }
}

const originalArgv = [...process.argv];
const originalNoColor = process.env["NO_COLOR"];

afterEach(() => {
  process.argv = [...originalArgv];
  if (originalNoColor === undefined) delete process.env["NO_COLOR"];
  else process.env["NO_COLOR"] = originalNoColor;
});

describe("bot CLI forced-color entry", () => {
  it("forces color before public help dispatch", async () => {
    if (typeof Bun.version === "string") {
      const child = Bun.spawn({
        cmd: [process.execPath, fileURLToPath(new URL("index.ts", import.meta.url)), "help", "--color"],
        env: { ...process.env, NO_COLOR: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
      expect(exitCode).toBe(1);
      expect(stderr).toContain("Usage:");
      return;
    }
    process.env["NO_COLOR"] = "1";
    process.argv = [...originalArgv.slice(0, 2), "help", "--color"];
    const exitSpy = spyOn(process, "exit").mockImplementation((code) => {
      throw new ExitIntercept(code);
    });
    const errorSpy = spyOn(console, "error").mockImplementation(() => {
      // Suppress expected CLI diagnostics while asserting the exit path.
    });
    try {
      await import("./index.js");
      throw new Error("CLI entry returned without terminating the process");
    } catch (error: unknown) {
      if (!(error instanceof ExitIntercept)) throw error;
      expect(error.code).toBe(1);
    } finally {
      errorSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });
});
