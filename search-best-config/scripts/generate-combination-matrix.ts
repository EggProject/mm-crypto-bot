import { extname, resolve } from "node:path";

import { getArg, parseNamedArgs, REPO_ROOT, writeText } from "./common.js";

export const PRODUCTION_COMPONENTS = [
  "donchian_pivot_composition",
  "dydx_cex_carry",
  "cascade_fade",
  "funding_flip_kill_switch",
  "regime_detector",
] as const;

export type ProductionComponent = (typeof PRODUCTION_COMPONENTS)[number];

export type CombinationStatus =
  | "SUPPORTED_REAL_DATA"
  | "BLOCKED_MISSING_DATA"
  | "UNSUPPORTED_DATA"
  | "FUNCTIONAL_REPLAY_ONLY"
  | "UNSUPPORTED_SIGNAL_REPLAY"
  | "UNSUPPORTED_JOINT_RUNNER";

export interface CombinationRow {
  readonly mask: string;
  readonly enabled: readonly ProductionComponent[];
  readonly donchian_pivot_composition: boolean;
  readonly dydx_cex_carry: boolean;
  readonly cascade_fade: boolean;
  readonly funding_flip_kill_switch: boolean;
  readonly regime_detector: boolean;
  readonly status: CombinationStatus;
  readonly reason: string;
  readonly validSymbols: readonly string[];
  readonly invalidSymbols: readonly string[];
}

const ALL_PRODUCTION_SYMBOLS = ["BTC/USDT", "ETH/USDT", "SOL/USDT"] as const;

function classify(
  enabled: readonly ProductionComponent[],
): Pick<CombinationRow, "status" | "reason" | "validSymbols" | "invalidSymbols"> {
  if (enabled.includes("cascade_fade")) {
    return {
      status: "UNSUPPORTED_DATA",
      reason: "Nincs valódi historikus liquidation/OI/funding/ELR cascade tape.",
      validSymbols: [],
      invalidSymbols: [],
    };
  }
  const exact = enabled.join("+");
  if (exact === "donchian_pivot_composition+regime_detector") {
    return {
      status: "SUPPORTED_REAL_DATA",
      reason: "A validált DPC+Regime overlay runner valós OHLCV-n BTC/ETH/SOL szimbólumon elérhető.",
      validSymbols: ALL_PRODUCTION_SYMBOLS,
      invalidSymbols: [],
    };
  }
  if (
    exact === "donchian_pivot_composition+funding_flip_kill_switch" ||
    exact === "donchian_pivot_composition+funding_flip_kill_switch+regime_detector"
  ) {
    return {
      status: "SUPPORTED_REAL_DATA",
      reason:
        "A validált DPC overlay runner valós OHLCV+funding adaton SOL/USDT-re elérhető; BTC/ETH explicit INVALID_MASK, nem no-op.",
      validSymbols: ["SOL/USDT"],
      invalidSymbols: ["BTC/USDT", "ETH/USDT"],
    };
  }
  if (enabled.length > 1) {
    return {
      status: "UNSUPPORTED_JOINT_RUNNER",
      reason: "Nincs közös, időrendhelyes production portfólió- és SignalBus-replay runner.",
      validSymbols: [],
      invalidSymbols: [],
    };
  }
  switch (enabled[0]) {
    case "donchian_pivot_composition":
      return {
        status: "SUPPORTED_REAL_DATA",
        reason: "Valós, hash-ellenőrzött Binance OHLCV runner elérhető.",
        validSymbols: ALL_PRODUCTION_SYMBOLS,
        invalidSymbols: [],
      };
    case "dydx_cex_carry":
      return {
        status: "BLOCKED_MISSING_DATA",
        reason: "A teljes dYdX órás funding dataset/cache hiányzik.",
        validSymbols: [],
        invalidSymbols: [],
      };
    case "funding_flip_kill_switch":
      return {
        status: "FUNCTIONAL_REPLAY_ONLY",
        reason: "A SOL plugin döntése replayelhető, de önálló PnL és DD nem értelmezhető.",
        validSymbols: ["SOL/USDT"],
        invalidSymbols: ["BTC/USDT", "ETH/USDT"],
      };
    case "regime_detector":
      return {
        status: "UNSUPPORTED_SIGNAL_REPLAY",
        reason: "Nincs archivált Direction/Carry/Sizing SignalBus stream.",
        validSymbols: [],
        invalidSymbols: [],
      };
    case "cascade_fade":
      throw new Error("A Cascade státuszát a korábbi ág kezeli");
    case undefined:
      throw new Error("Üres production kombináció nem megengedett");
  }
  throw new Error(`Ismeretlen production komponens: ${String(enabled[0])}`);
}

export function generateCombinationMatrix(): readonly CombinationRow[] {
  const rows: CombinationRow[] = [];
  for (let numericMask = 1; numericMask < 2 ** PRODUCTION_COMPONENTS.length; numericMask++) {
    const mask = numericMask.toString(2).padStart(PRODUCTION_COMPONENTS.length, "0");
    const enabled = PRODUCTION_COMPONENTS.filter((_, index) => mask[index] === "1");
    const classification = classify(enabled);
    rows.push({
      mask,
      enabled,
      donchian_pivot_composition: enabled.includes("donchian_pivot_composition"),
      dydx_cex_carry: enabled.includes("dydx_cex_carry"),
      cascade_fade: enabled.includes("cascade_fade"),
      funding_flip_kill_switch: enabled.includes("funding_flip_kill_switch"),
      regime_detector: enabled.includes("regime_detector"),
      ...classification,
    });
  }
  return rows;
}

function csvCell(value: string | boolean): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function matrixToCsv(rows: readonly CombinationRow[]): string {
  const headers = [
    "mask",
    ...PRODUCTION_COMPONENTS,
    "enabled",
    "status",
    "valid_symbols",
    "invalid_symbols",
    "reason",
  ];
  const body = rows.map((row) =>
    [
      row.mask,
      ...PRODUCTION_COMPONENTS.map((component) => row[component]),
      row.enabled.join("+"),
      row.status,
      row.validSymbols.join("+"),
      row.invalidSymbols.join("+"),
      row.reason,
    ]
      .map(csvCell)
      .join(","),
  );
  return `${headers.join(",")}\n${body.join("\n")}\n`;
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const args = parseNamedArgs(argv);
  const output = resolve(
    REPO_ROOT,
    getArg(args, "output", "search-best-config/results/combination-matrix.csv"),
  );
  const rows = generateCombinationMatrix();
  const content =
    extname(output).toLowerCase() === ".json"
      ? `${JSON.stringify({ schemaVersion: 1, components: PRODUCTION_COMPONENTS, rows }, null, 2)}\n`
      : matrixToCsv(rows);
  await writeText(output, content);
  console.log(`PASS: ${rows.length} nem üres production kombináció → ${output}`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
