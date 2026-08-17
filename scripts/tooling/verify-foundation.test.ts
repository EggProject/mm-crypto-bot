import { expect, test } from "bun:test";

import {
  foundationVerificationGates,
  runFoundationVerification,
  type FoundationVerificationGate,
} from "./verify-foundation.ts";

test("foundation verification runs available gates in order", async () => {
  const calls: FoundationVerificationGate[] = [];

  await runFoundationVerification((gate) => {
    calls.push(gate);
    return Promise.resolve(0);
  });

  expect(calls).toEqual(foundationVerificationGates);
});

test("foundation verification fails fast and preserves the failing gate", async () => {
  const calls: FoundationVerificationGate[] = [];

  try {
    await runFoundationVerification((gate) => {
      calls.push(gate);
      return Promise.resolve(gate === "lint" ? 9 : 0);
    });
    throw new Error("Expected foundation verification failure");
  } catch (error: unknown) {
    expect(error).toHaveProperty("message", "Foundation verification gate failed (9): lint");
  }

  expect(calls).toEqual(["format:check", "lint"]);
});

test("foundation verification succeeds when every available gate succeeds", async () => {
  await runFoundationVerification(() => Promise.resolve(0));
});
