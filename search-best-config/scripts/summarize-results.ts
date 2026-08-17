import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { getArg, isObject, parseNamedArgs, REPO_ROOT, writeText } from "./common.js";
import { normalizeDocument, type NormalizedResult } from "./normalize-results.js";

const COLUMNS = [
  "runId",
  "status",
  "reason",
  "strategyId",
  "componentMask",
  "symbol",
  "split",
  "start",
  "end",
  "parameters",
  "dataInputs",
  "coverage",
  "extendedMetrics",
  "provenance",
  "totalReturnPct",
  "monthlyReturnPct",
  "annualizedReturnPct",
  "maxDrawdownPct",
  "sharpe",
  "sortino",
  "profitFactor",
  "winRatePct",
  "totalTrades",
  "killSwitchTriggered",
  "codeRevision",
  "rawOutput",
] as const;

type SummaryCell = string | number | boolean | null;

function flatten(row: NormalizedResult): Readonly<Record<(typeof COLUMNS)[number], SummaryCell>> {
  return {
    runId: row.runId,
    status: row.status,
    reason: row.reason,
    strategyId: row.strategyId,
    componentMask: row.componentMask,
    symbol: row.symbol,
    split: row.split.name,
    start: row.split.start,
    end: row.split.end,
    parameters: JSON.stringify(row.parameters),
    dataInputs: JSON.stringify(row.dataInputs),
    coverage: JSON.stringify(row.coverage),
    extendedMetrics: JSON.stringify(row.extendedMetrics),
    provenance: JSON.stringify(row.provenance),
    totalReturnPct: row.metrics.totalReturnPct,
    monthlyReturnPct: row.metrics.monthlyReturnPct,
    annualizedReturnPct: row.metrics.annualizedReturnPct,
    maxDrawdownPct: row.metrics.maxDrawdownPct,
    sharpe: row.metrics.sharpe,
    sortino: row.metrics.sortino,
    profitFactor: row.metrics.profitFactor,
    winRatePct: row.metrics.winRatePct,
    totalTrades: row.metrics.totalTrades,
    killSwitchTriggered: row.metrics.killSwitchTriggered,
    codeRevision: row.codeRevision,
    rawOutput: row.rawOutput,
  };
}

function text(value: SummaryCell): string {
  return value === null ? "" : String(value);
}

function csvCell(value: SummaryCell): string {
  const valueText = text(value);
  return /[",\n]/.test(valueText) ? `"${valueText.replaceAll('"', '""')}"` : valueText;
}

function markdownCell(value: SummaryCell): string {
  return text(value).replaceAll("|", "\\|").replaceAll("\n", "<br>");
}

export function resultsToCsv(rows: readonly NormalizedResult[]): string {
  const body = rows.map((row) => {
    const flat = flatten(row);
    return COLUMNS.map((column) => csvCell(flat[column])).join(",");
  });
  return `${COLUMNS.join(",")}\n${body.join("\n")}${body.length > 0 ? "\n" : ""}`;
}

export function resultsToMarkdown(rows: readonly NormalizedResult[]): string {
  const header = `| ${COLUMNS.join(" | ")} |`;
  const separator = `| ${COLUMNS.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => {
    const flat = flatten(row);
    return `| ${COLUMNS.map((column) => markdownCell(flat[column])).join(" | ")} |`;
  });
  return [
    "# Teljes backtest eredménytábla",
    "",
    `Sorok száma: ${rows.length}`,
    "",
    header,
    separator,
    ...body,
    "",
  ].join("\n");
}

export function parseNdjson(raw: string, inputName: string): readonly NormalizedResult[] {
  const rows: NormalizedResult[] = [];
  const lines = raw.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]?.trim() ?? "";
    if (line.length === 0) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (isObject(parsed) && parsed["schemaVersion"] === 1 && isObject(parsed["metrics"])) {
        rows.push(...normalizeDocument(parsed, `${inputName}#line-${index + 1}`));
      } else {
        rows.push(...normalizeDocument(parsed, `${inputName}#line-${index + 1}`));
      }
    } catch (error) {
      rows.push(
        ...normalizeDocument(
          {
            schemaVersion: 1,
            runId: `${inputName}-line-${index + 1}`,
            status: "FAILED_PARSE",
            reason: error instanceof Error ? error.message : String(error),
            strategyId: "unknown",
            metrics: {},
          },
          `${inputName}#line-${index + 1}`,
        ),
      );
    }
  }
  return rows;
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const args = parseNamedArgs(argv);
  const input = resolve(REPO_ROOT, getArg(args, "input", "search-best-config/results/normalized.ndjson"));
  const csv = resolve(REPO_ROOT, getArg(args, "csv", "search-best-config/results/all-results.csv"));
  const markdown = resolve(REPO_ROOT, getArg(args, "markdown", "search-best-config/results/all-results.md"));
  const rows = parseNdjson(await readFile(input, "utf8"), input);
  await Promise.all([writeText(csv, resultsToCsv(rows)), writeText(markdown, resultsToMarkdown(rows))]);
  console.log(`PASS: ${rows.length} sor; CSV=${csv}; Markdown=${markdown}`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
