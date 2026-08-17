import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { fileURLToPath } from "node:url";

class ExitIntercept extends Error {
  public constructor(public readonly code: string | number | null | undefined) {
    super(`intercepted process.exit(${String(code)})`);
  }
}

const originalArgv = [...process.argv];
const originalNoColor = process.env["NO_COLOR"];

async function runCliEntry(args: readonly string[]): Promise<ExitIntercept> {
  process.argv = [...originalArgv.slice(0, 2), ...args];
  const originalExit = process.exit;
  const originalConsoleError = console.error;
  const exitSpy = spyOn(process, "exit").mockImplementation((code) => {
    throw new ExitIntercept(code);
  });
  const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
  try {
    await import("./index.js");
    throw new Error("CLI entry returned without terminating the process");
  } catch (error: unknown) {
    if (error instanceof ExitIntercept) return error;
    throw error;
  } finally {
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    console.error = originalConsoleError;
    process.exit = originalExit;
  }
}

afterEach(() => {
  process.argv = [...originalArgv];
  if (originalNoColor === undefined) delete process.env["NO_COLOR"];
  else process.env["NO_COLOR"] = originalNoColor;
});

describe("mm-bot public CLI entry", () => {
  it("dispatches help with default color policy", async () => {
    if (typeof Bun.version === "string") {
      const child = Bun.spawn({
        cmd: [process.execPath, fileURLToPath(new URL("./index.ts", import.meta.url)), "help"],
        stdout: "pipe",
        stderr: "pipe",
      });
      const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
      expect(exitCode).toBe(1);
      expect(stderr).toContain("Usage:");
      return;
    }
    expect((await runCliEntry(["help"])).code).toBe(1);
  });

});
