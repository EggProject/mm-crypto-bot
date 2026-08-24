import { describe, expect, it, vi } from "vitest";

const invocation = vi.hoisted(() => {
  const completion = Promise.withResolvers<undefined>();

  return { completion, run: vi.fn(() => completion.promise) };
});

vi.mock("./run-logging-e2e-coverage.ts", () => ({
  runLoggingEndToEndCoverageMain: invocation.run,
}));

describe("logging E2E coverage CLI", () => {
  it("invokes the main lifecycle once and awaits its successful completion", async () => {
    let hasImported = false;
    const importing = (async () => {
      await import("./run-logging-e2e-coverage-cli.ts");
      hasImported = true;
    })();

    await vi.waitFor(() => {
      expect(invocation.run).toHaveBeenCalledExactlyOnceWith();
    });
    expect(hasImported).toBe(false);

    invocation.completion.resolve(undefined);
    await importing;

    expect(hasImported).toBe(true);
  });
});
