/// <reference lib="es2023.array" />

import dgram from "node:dgram";
import http from "node:http";
import http2 from "node:http2";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

export class OutboundNetworkAttemptError extends Error {
  public constructor(public readonly boundary: string) {
    super(`outbound network attempt blocked at ${boundary}`);
    this.name = "OutboundNetworkAttemptError";
  }
}

interface InstalledBoundary {
  readonly target: object;
  readonly property: PropertyKey;
  readonly descriptor: PropertyDescriptor;
  readonly label: string;
}

export interface OutboundNetworkGuard {
  readonly attempts: readonly string[];
  readonly installedBoundaries: readonly string[];
  assertNoAttempts(): void;
  restore(): void;
}

interface InstalledGuardState {
  readonly schemaVersion: 1;
  readonly guard: OutboundNetworkGuard;
}

const GUARD_STATE_SYMBOL = Symbol.for("mm-crypto-bot.coverage.outbound-network-guard");
const NETWORK_ATTEMPT_EXIT_CODE = 86;

interface BoundarySpecification {
  readonly target: object;
  readonly property: PropertyKey;
  readonly label: string;
  readonly required: boolean;
}

function boundarySpecifications(): readonly BoundarySpecification[] {
  const specifications: BoundarySpecification[] = [
    { target: globalThis, property: "fetch", label: "global.fetch", required: true },
    { target: globalThis, property: "WebSocket", label: "global.WebSocket", required: false },
    { target: http, property: "request", label: "node:http.request", required: true },
    { target: http, property: "get", label: "node:http.get", required: true },
    { target: https, property: "request", label: "node:https.request", required: true },
    { target: https, property: "get", label: "node:https.get", required: true },
    { target: http2, property: "connect", label: "node:http2.connect", required: true },
    { target: net, property: "connect", label: "node:net.connect", required: true },
    { target: net, property: "createConnection", label: "node:net.createConnection", required: true },
    { target: tls, property: "connect", label: "node:tls.connect", required: true },
    { target: dgram, property: "createSocket", label: "node:dgram.createSocket", required: true },
  ];
  if (typeof Bun === "object") {
    specifications.push(
      { target: Bun, property: "connect", label: "Bun.connect", required: true },
      { target: Bun, property: "udpSocket", label: "Bun.udpSocket", required: false },
    );
  }
  return specifications;
}

function isOutboundNetworkGuard(value: unknown): value is OutboundNetworkGuard {
  return (
    value !== null &&
    typeof value === "object" &&
    Array.isArray(Reflect.get(value, "attempts")) &&
    Array.isArray(Reflect.get(value, "installedBoundaries")) &&
    typeof Reflect.get(value, "assertNoAttempts") === "function" &&
    typeof Reflect.get(value, "restore") === "function"
  );
}

function installedGuardState(): InstalledGuardState | undefined {
  const value: unknown = Object.getOwnPropertyDescriptor(globalThis, GUARD_STATE_SYMBOL)?.value as unknown;
  if (value === undefined) return undefined;
  const guard: unknown =
    value === null || typeof value !== "object" ? undefined : (Reflect.get(value, "guard") as unknown);
  if (
    value === null ||
    typeof value !== "object" ||
    Reflect.get(value, "schemaVersion") !== 1 ||
    !isOutboundNetworkGuard(guard)
  ) {
    throw new Error("outbound network guard global state is malformed");
  }
  return { schemaVersion: 1, guard };
}

function restoreInstalledBoundaries(installed: readonly InstalledBoundary[]): void {
  for (const boundary of installed.toReversed()) {
    Object.defineProperty(boundary.target, boundary.property, boundary.descriptor);
  }
}

export function getInstalledOutboundNetworkGuard(): OutboundNetworkGuard {
  const state = installedGuardState();
  if (state === undefined) {
    throw new Error("outbound network guard was not installed by the bot E2E preload");
  }
  return state.guard;
}

export function installOutboundNetworkGuard(): OutboundNetworkGuard {
  const existing = installedGuardState();
  if (existing !== undefined) return existing.guard;

  const attempts: string[] = [];
  const installed: InstalledBoundary[] = [];
  let isRestored = false;

  try {
    for (const specification of boundarySpecifications()) {
      const descriptor = Object.getOwnPropertyDescriptor(specification.target, specification.property);
      if (descriptor === undefined || typeof descriptor.value !== "function") {
        if (specification.required)
          throw new Error(`network boundary is unavailable: ${specification.label}`);
        continue;
      }
      const blocker = function outboundNetworkBoundaryBlocker(): never {
        attempts.push(specification.label);
        if (process.exitCode === undefined || process.exitCode === 0) {
          process.exitCode = NETWORK_ATTEMPT_EXIT_CODE;
        }
        void process.stderr.write(
          `[bot-e2e-network-guard] blocked outbound attempt: ${specification.label}\n`,
        );
        throw new OutboundNetworkAttemptError(specification.label);
      };
      Object.defineProperty(specification.target, specification.property, {
        ...descriptor,
        value: blocker,
      });
      installed.push({ ...specification, descriptor });
    }
  } catch (error: unknown) {
    restoreInstalledBoundaries(installed);
    throw error;
  }

  const guard: OutboundNetworkGuard = {
    get attempts(): readonly string[] {
      return [...attempts];
    },
    get installedBoundaries(): readonly string[] {
      return installed.map(({ label }) => label);
    },
    assertNoAttempts(): void {
      if (attempts.length > 0) {
        throw new Error(`bot E2E child attempted outbound network access: ${attempts.join(", ")}`);
      }
    },
    restore(): void {
      if (isRestored) return;
      isRestored = true;
      restoreInstalledBoundaries(installed);
      const state = installedGuardState();
      if (state?.guard === guard) Reflect.deleteProperty(globalThis, GUARD_STATE_SYMBOL);
    },
  };
  Object.defineProperty(globalThis, GUARD_STATE_SYMBOL, {
    configurable: true,
    enumerable: false,
    writable: false,
    value: { schemaVersion: 1, guard } satisfies InstalledGuardState,
  });
  return guard;
}
