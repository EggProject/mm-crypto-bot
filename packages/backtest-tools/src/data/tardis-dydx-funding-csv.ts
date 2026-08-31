import { canonicalizeExternalDecimal } from "@mm-crypto-bot/numeric";

export interface TardisDerivativeTickerRow {
  readonly exchange: string;
  readonly symbol: string;
  readonly timestamp: string;
  readonly local_timestamp: string;
  readonly funding_timestamp: string;
  readonly funding_rate: string;
  readonly predicted_funding_rate: string;
  readonly open_interest: string;
  readonly last_price: string;
  readonly index_price: string;
  readonly mark_price: string;
}

const EXPECTED_HEADER = [
  "exchange",
  "symbol",
  "timestamp",
  "local_timestamp",
  "funding_timestamp",
  "funding_rate",
  "predicted_funding_rate",
  "open_interest",
  "last_price",
  "index_price",
  "mark_price",
] as const;

type DerivativeTickerColumns = readonly [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];

export class TardisCsvBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TardisCsvBoundaryError";
  }
}

function parseCsvLine(line: string): readonly string[] | undefined {
  const values: string[] = [""];
  let current = "";
  let isInQuotes = false;
  for (const character of line) {
    if (character === '"') isInQuotes = !isInQuotes;
    else if (character === "," && !isInQuotes) {
      values[values.length - 1] = current;
      values.push("");
      current = "";
    } else current += character;
  }
  if (isInQuotes) return undefined;
  values[values.length - 1] = current;
  return values;
}

function fail(message: string): never {
  throw new TardisCsvBoundaryError(message);
}

function requireCanonicalDecimal(value: string, field: string): void {
  try {
    if (canonicalizeExternalDecimal(value) !== value) fail(`Tardis selected-market row has invalid ${field}`);
  } catch (error: unknown) {
    if (error instanceof TardisCsvBoundaryError) throw error;
    fail(`Tardis selected-market row has invalid ${field}`);
  }
}

function requireTimestampInDay(value: string, requestedDate: Date | undefined): void {
  try {
    if (!/^(0|[1-9]\d*)$/u.test(value)) fail("Tardis selected-market row has invalid timestamp");
    const timestampUs = BigInt(value);
    if (timestampUs / 1000n > BigInt(Number.MAX_SAFE_INTEGER))
      fail("Tardis selected-market row has invalid timestamp");
    if (requestedDate === undefined) return;
    const startUs = BigInt(requestedDate.getTime()) * 1000n;
    const endUs = startUs + 86_400_000_000n;
    if (timestampUs < startUs || timestampUs >= endUs)
      fail("Tardis selected-market row is outside requested UTC day");
  } catch (error: unknown) {
    if (error instanceof TardisCsvBoundaryError) throw error;
    fail("Tardis selected-market row has invalid timestamp");
  }
}

function hasDerivativeTickerColumns(parts: readonly string[]): parts is DerivativeTickerColumns {
  return parts.length === EXPECTED_HEADER.length;
}

function validateSelectedRow(
  parts: readonly string[],
  requestedDate: Date | undefined,
): DerivativeTickerColumns {
  if (!hasDerivativeTickerColumns(parts))
    fail("Tardis selected-market row is incomplete selected-market row");
  requireTimestampInDay(parts[2], requestedDate);
  requireCanonicalDecimal(parts[5], "funding_rate");
  for (const [field, value] of [
    ["last_price", parts[8]],
    ["index_price", parts[9]],
    ["mark_price", parts[10]],
  ] as const) {
    if (value !== "") requireCanonicalDecimal(value, field);
  }
  return parts;
}

function rowFor(parts: DerivativeTickerColumns): TardisDerivativeTickerRow {
  return {
    exchange: parts[0],
    symbol: parts[1],
    timestamp: parts[2],
    local_timestamp: parts[3],
    funding_timestamp: parts[4],
    predicted_funding_rate: parts[6],
    funding_rate: parts[5],
    open_interest: parts[7],
    last_price: parts[8],
    index_price: parts[9],
    mark_price: parts[10],
  };
}

export function parseDerivativeTickerCsv(
  csv: string,
  selectedMarket?: string,
  requestedDate?: Date,
): { readonly header: readonly string[]; readonly rows: readonly TardisDerivativeTickerRow[] } {
  const lines = csv.split("\n");
  const header = parseCsvLine(csv.split("\n", 1).join(""));
  if (header === undefined) fail("Tardis CSV has an invalid header");
  if (header.join(",") !== EXPECTED_HEADER.join(",")) fail("Tardis CSV has an unexpected header");
  const rows: TardisDerivativeTickerRow[] = [];
  for (const line of lines.slice(1)) {
    if (line === "") continue;
    const parts = parseCsvLine(line);
    if (parts === undefined) fail("Tardis CSV row cannot identify its market");
    const market = parts[1];
    if (selectedMarket !== undefined && market === undefined)
      fail("Tardis CSV row cannot identify its market");
    if (selectedMarket !== undefined && market === selectedMarket) {
      rows.push(rowFor(validateSelectedRow(parts, requestedDate)));
      continue;
    }
    if (selectedMarket !== undefined) continue;
    if (!hasDerivativeTickerColumns(parts)) continue;
    rows.push(rowFor(parts));
  }
  return { header, rows };
}
