import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";

export type JsonObject = Record<string, unknown>;

export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

export async function writeText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

export function parseNamedArgs(argv: readonly string[]): Map<string, string> {
  const parsed = new Map<string, string>();
  for (const arg of argv) {
    if (!arg.startsWith("--")) throw new Error(`Ismeretlen pozicionális argumentum: ${arg}`);
    const equals = arg.indexOf("=");
    if (equals < 3) throw new Error(`Az argumentum --nev=ertek alakú legyen: ${arg}`);
    parsed.set(arg.slice(2, equals), arg.slice(equals + 1));
  }
  return parsed;
}

export function getArg(args: ReadonlyMap<string, string>, name: string, fallback: string): string {
  return args.get(name) ?? fallback;
}

export async function listJsonFiles(inputPath: string): Promise<readonly string[]> {
  const inputStat = await stat(inputPath);
  if (inputStat.isFile()) return extname(inputPath).toLowerCase() === ".json" ? [inputPath] : [];
  if (!inputStat.isDirectory()) return [];
  const entries = await readdir(inputPath, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry): Promise<readonly string[]> => {
      const path = resolve(inputPath, entry.name);
      if (entry.isDirectory()) return listJsonFiles(path);
      return entry.isFile() && extname(entry.name).toLowerCase() === ".json" ? [path] : [];
    }),
  );
  return nested.flat().sort();
}

export function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export const REPO_ROOT = resolve(import.meta.dir, "..", "..");
