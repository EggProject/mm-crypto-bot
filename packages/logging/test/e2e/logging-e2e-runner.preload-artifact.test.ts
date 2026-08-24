import { describe, expect, it, vi } from "vitest";

import { LOGGING_E2E_CASE_IDS, runLoggingEndToEndSubprocesses } from "./logging-e2e-runner.ts";

const ARTIFACT_BUNDLE = "/tmp/private-artifact/bundle";
const CHILD_ENTRY = `${ARTIFACT_BUNDLE}/logging-e2e-child.js`;
const PRELOAD_ENTRY = `${ARTIFACT_BUNDLE}/logging-e2e-preload.js`;
const REPOSITORY_PRELOAD_SENTINEL = "/repository/logging-e2e-preload.ts";
const encoder = new TextEncoder();

function stream(contents: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(contents));
      controller.close();
    },
  });
}

function stderrFor(caseId: string): string {
  if (caseId === "public-schema-redaction") {
    return `${JSON.stringify({
      timestamp: "2026-08-24T00:00:00.000Z",
      component: "logging-e2e",
      runId: "run-e2e-1",
      correlationId: "correlation-e2e-1",
      level: "info",
      event: "logging.e2e.schema",
      fields: { token: "[REDACTED]" },
    })}\n`;
  }
  if (caseId === "public-critical-audit") {
    return `${JSON.stringify({
      timestamp: "2026-08-24T00:00:00.000Z",
      component: "logging-e2e",
      runId: "run-e2e-1",
      correlationId: "correlation-e2e-1",
      level: "error",
      event: "logging.e2e.critical.audit",
      fields: { audit: "preserved" },
    })}\n`;
  }
  if (caseId === "public-stderr-idle-lifecycle") {
    return `${JSON.stringify({
      timestamp: "2026-08-24T00:00:00.000Z",
      component: "logging-e2e",
      runId: "run-e2e-1",
      correlationId: "correlation-e2e-1",
      level: "info",
      event: "logging.e2e.stderr",
      fields: { key: "value" },
    })}\n`;
  }
  return "";
}

function options(
  events: string[],
  verifyExecutableArtifacts = (): void => {
    events.push("verify");
  },
) {
  return {
    childEntry: CHILD_ENTRY,
    preload: PRELOAD_ENTRY,
    rawDirectory: "/tmp/private-artifact/raw",
    rawDirectoryIdentity: { device: 1n, inode: 2n },
    environment: {},
    verifyExecutableArtifacts,
    spawn: (request: { readonly cmd: readonly string[] }) => {
      events.push(`spawn:${request.cmd.at(-1) ?? ""}`);
      return {
        exited: Promise.resolve(0),
        stderr: stream(stderrFor(request.cmd.at(-1) ?? "")),
        stdout: stream(""),
      };
    },
  };
}

describe("logging E2E runner private executable artifacts", () => {
  it("verifies private child and preload artifacts immediately before every spawn", async () => {
    const events: string[] = [];
    const results = await runLoggingEndToEndSubprocesses(options(events));

    expect(results.map((result) => result.caseId)).toEqual(LOGGING_E2E_CASE_IDS);
    expect(events).toHaveLength(LOGGING_E2E_CASE_IDS.length * 2);
    for (const [index, caseId] of LOGGING_E2E_CASE_IDS.entries()) {
      expect(events[index * 2]).toBe("verify");
      expect(events[index * 2 + 1]).toBe(`spawn:${caseId}`);
    }
  });

  it("uses only the artifact child and preload paths in every command", async () => {
    const commands: string[][] = [];
    const verificationEvents: string[] = [];
    const spawn = vi.fn((request: { readonly cmd: readonly string[] }) => {
      commands.push([...request.cmd]);
      return {
        exited: Promise.resolve(0),
        stderr: stream(stderrFor(request.cmd.at(-1) ?? "")),
        stdout: stream(""),
      };
    });

    await runLoggingEndToEndSubprocesses({
      ...options(verificationEvents, () => {
        verificationEvents.push("verify");
      }),
      spawn,
    });

    expect(commands).toHaveLength(LOGGING_E2E_CASE_IDS.length);
    for (const command of commands) {
      expect(command).toEqual(["bun", "--preload", PRELOAD_ENTRY, CHILD_ENTRY, expect.any(String)]);
      expect(command).not.toContain(REPOSITORY_PRELOAD_SENTINEL);
    }
  });

  it("does not spawn the failing or subsequent case when artifact verification fails", async () => {
    const events: string[] = [];
    let attempts = 0;

    await expect(
      runLoggingEndToEndSubprocesses(
        options(events, () => {
          attempts += 1;
          events.push(`verify:${String(attempts)}`);
          if (attempts === 2) throw new Error("artifact identity changed");
        }),
      ),
    ).rejects.toThrow("artifact identity changed");

    expect(events).toEqual([`verify:1`, `spawn:${LOGGING_E2E_CASE_IDS[0]}`, "verify:2"]);
  });
});
