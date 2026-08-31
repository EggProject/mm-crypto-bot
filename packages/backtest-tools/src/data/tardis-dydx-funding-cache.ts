import { createHash, randomUUID } from "node:crypto";
import {
  mkdir as createCacheDirectory,
  readFile as readCacheFile,
  rename as replaceCacheFile,
  writeFile as writeCacheFile,
} from "node:fs/promises";
import path from "node:path";

export interface TardisCacheFileSystem {
  readonly read: (filePath: string) => Promise<Uint8Array | undefined>;
  readonly writeAtomically: (filePath: string, contents: Uint8Array) => Promise<void>;
}

export interface TardisCacheIdentity {
  readonly date: string;
  readonly market: string;
  readonly url: string;
}

export interface TardisCacheReceipt extends TardisCacheIdentity {
  readonly byteLength: number;
  readonly cacheWriteUtc: string;
  readonly provider: "tardis.dev";
  readonly schema: "tardis-dydx-cache@2";
  readonly sha256: string;
}

interface VerifiedTardisCache {
  readonly contents: Uint8Array;
  readonly receipt: TardisCacheReceipt;
}

const TARDIS_PROVIDER = "tardis.dev" as const;
const TARDIS_CACHE_SCHEMA = "tardis-dydx-cache@2" as const;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && Object(value) === value && !Array.isArray(value);
}

function isNotFound(error: unknown): boolean {
  return isRecord(error) && error["code"] === "ENOENT";
}

function sha256(contents: Uint8Array): string {
  return createHash("sha256").update(contents).digest("hex");
}

function validateCacheWriteUtc(value: string): void {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) ||
    new Date(value).toISOString() !== value
  )
    throw new Error("Tardis cache receipt has invalid cacheWriteUtc");
}

function receiptFor(
  contents: Uint8Array,
  identity: TardisCacheIdentity,
  cacheWriteUtc: string,
): TardisCacheReceipt {
  validateCacheWriteUtc(cacheWriteUtc);
  return Object.freeze({
    schema: TARDIS_CACHE_SCHEMA,
    provider: TARDIS_PROVIDER,
    date: identity.date,
    market: identity.market,
    url: identity.url,
    byteLength: contents.byteLength,
    sha256: sha256(contents),
    cacheWriteUtc,
  });
}

function validateManifest(
  value: unknown,
  contents: Uint8Array,
  identity: TardisCacheIdentity,
): TardisCacheReceipt {
  if (!isRecord(value)) throw new Error("Tardis cache manifest is invalid");
  const allowed = new Set([
    "schema",
    "provider",
    "date",
    "market",
    "url",
    "byteLength",
    "sha256",
    "cacheWriteUtc",
  ]);
  if (Object.keys(value).length !== allowed.size || Object.keys(value).some((key) => !allowed.has(key)))
    throw new Error("Tardis cache manifest is invalid");
  const cacheWriteUtc = value["cacheWriteUtc"];
  if (
    typeof cacheWriteUtc !== "string" ||
    value["schema"] !== TARDIS_CACHE_SCHEMA ||
    value["provider"] !== TARDIS_PROVIDER ||
    value["date"] !== identity.date ||
    value["market"] !== identity.market ||
    value["url"] !== identity.url ||
    value["byteLength"] !== contents.byteLength ||
    typeof value["sha256"] !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value["sha256"]) ||
    value["sha256"] !== sha256(contents)
  )
    throw new Error("Tardis cache manifest does not verify cache content");
  try {
    return receiptFor(contents, identity, cacheWriteUtc);
  } catch {
    throw new Error("Tardis cache manifest does not verify cache content");
  }
}

export const nodeTardisCacheFileSystem: TardisCacheFileSystem = Object.freeze({
  read: async (filePath: string) => {
    try {
      return new Uint8Array(await readCacheFile(filePath));
    } catch (error: unknown) {
      if (isNotFound(error)) return;
      throw error;
    }
  },
  writeAtomically: async (filePath: string, contents: Uint8Array) => {
    await createCacheDirectory(path.dirname(filePath), { recursive: true });
    const temporaryPath = path.join(
      path.dirname(filePath),
      `.${path.basename(filePath)}.${randomUUID()}.tmp`,
    );
    await writeCacheFile(temporaryPath, contents);
    await replaceCacheFile(temporaryPath, filePath);
  },
});

export function tardisCacheManifestPath(cachePath: string): string {
  return `${cachePath}.manifest.json`;
}

export async function readVerifiedTardisCache(
  filesystem: TardisCacheFileSystem,
  cachePath: string,
  identity: TardisCacheIdentity,
): Promise<Uint8Array | undefined> {
  const verified = await readVerifiedTardisCacheReceipt(filesystem, cachePath, identity);
  return verified?.contents;
}

export async function readVerifiedTardisCacheReceipt(
  filesystem: TardisCacheFileSystem,
  cachePath: string,
  identity: TardisCacheIdentity,
): Promise<VerifiedTardisCache | undefined> {
  const [contents, manifestContents] = await Promise.all([
    filesystem.read(cachePath),
    filesystem.read(tardisCacheManifestPath(cachePath)),
  ]);
  if (contents === undefined && manifestContents === undefined) return undefined;
  if (contents === undefined || manifestContents === undefined)
    throw new Error("Tardis cache is missing its manifest or content");
  let manifest: unknown;
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestContents));
  } catch {
    throw new Error("Tardis cache manifest is invalid");
  }
  const receipt = validateManifest(manifest, contents, identity);
  return Object.freeze({ contents, receipt });
}

export async function writeVerifiedTardisCache(
  filesystem: TardisCacheFileSystem,
  cachePath: string,
  contents: Uint8Array,
  identity: TardisCacheIdentity,
  cacheWriteUtc: string,
): Promise<TardisCacheReceipt> {
  const receipt = receiptFor(contents, identity, cacheWriteUtc);
  const manifest = new TextEncoder().encode(JSON.stringify(receipt));
  await filesystem.writeAtomically(cachePath, contents);
  await filesystem.writeAtomically(tardisCacheManifestPath(cachePath), manifest);
  return receipt;
}
