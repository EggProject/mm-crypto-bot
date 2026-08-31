import type {
  PreconditionConfig,
  PreconditionEntry,
  PreconditionId,
  PreconditionsState,
} from "./dydx-cex-carry-config.js";

export function evaluatePrecondition(
  id: PreconditionId,
  previous: PreconditionEntry,
  nowMs: number,
  input: { readonly kind: PreconditionId; readonly satisfied: boolean },
): PreconditionEntry {
  if (id !== input.kind) throw new Error(`Precondition id mismatch: ${id} vs ${input.kind}`);
  return {
    satisfied: input.satisfied,
    firstSatisfiedMs: input.satisfied
      ? previous.satisfied
        ? (previous.firstSatisfiedMs ?? nowMs)
        : nowMs
      : undefined,
    lastVerifiedMs: nowMs,
  };
}

export function allPreconditionsSatisfied(
  state: PreconditionsState,
  nowMs: number,
  config: PreconditionConfig,
): { readonly ok: boolean; readonly reasons: readonly string[] } {
  const reasons: string[] = [];
  for (const id of ["live-divergence", "chain-incident-clear", "no-recent-governance"] as const) {
    const entry = preconditionEntry(state, id);
    if (!entry.satisfied) {
      reasons.push(`${id} not satisfied`);
      continue;
    }
    if (entry.firstSatisfiedMs === undefined) {
      reasons.push(`${id} never observed satisfied`);
      continue;
    }
    const requiredMs = requiredMsFor(id, config);
    const elapsedMs = nowMs - entry.firstSatisfiedMs;
    if (elapsedMs < requiredMs) reasons.push(formatSustained(id, elapsedMs, requiredMs));
  }
  return { ok: reasons.length === 0, reasons };
}

export function newPreconditionsState(): PreconditionsState {
  return {
    "live-divergence": { satisfied: false, firstSatisfiedMs: undefined, lastVerifiedMs: undefined },
    "chain-incident-clear": { satisfied: false, firstSatisfiedMs: undefined, lastVerifiedMs: undefined },
    "no-recent-governance": { satisfied: false, firstSatisfiedMs: undefined, lastVerifiedMs: undefined },
  };
}

function requiredMsFor(id: PreconditionId, config: PreconditionConfig): number {
  switch (id) {
    case "live-divergence": {
      return config.liveDivergenceWindowDays * 24 * 60 * 60 * 1000;
    }
    case "chain-incident-clear": {
      return config.chainOperationalMinHours * 60 * 60 * 1000;
    }
    case "no-recent-governance": {
      return config.governanceQuietDays * 24 * 60 * 60 * 1000;
    }
  }
}

function formatSustained(id: PreconditionId, elapsedMs: number, requiredMs: number): string {
  if (id === "chain-incident-clear")
    return `${id} sustained ${String(Math.round(elapsedMs / (60 * 60 * 1000)))}h < ${String(Math.round(requiredMs / (60 * 60 * 1000)))}h`;
  return `${id} sustained ${String(Math.round(elapsedMs / (24 * 60 * 60 * 1000)))}d < ${String(Math.round(requiredMs / (24 * 60 * 60 * 1000)))}d`;
}

function preconditionEntry(state: PreconditionsState, id: PreconditionId): PreconditionEntry {
  switch (id) {
    case "live-divergence": {
      return state["live-divergence"];
    }
    case "chain-incident-clear": {
      return state["chain-incident-clear"];
    }
    case "no-recent-governance": {
      return state["no-recent-governance"];
    }
  }
}
