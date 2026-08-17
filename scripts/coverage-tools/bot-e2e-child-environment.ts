/* eslint-disable security/detect-object-injection -- environment keys are filtered by the closed override allowlist and credential predicate */

const ALLOWED_OVERRIDE_KEYS = new Set([
  "MM_BOT_E2E_CASE_ID",
  "MM_BOT_E2E_COVERAGE_PRELOAD",
  "MM_BOT_E2E_COVERAGE_RAW_DIR",
  "MM_BOT_E2E_ENTRY",
  "MM_BOT_E2E_ENTRY_KIND",
  "MM_BOT_E2E_START_MODULE",
]);

const CREDENTIAL_MARKERS = new Set([
  "APIKEY",
  "APISECRET",
  "CREDENTIAL",
  "CREDENTIALS",
  "KEY",
  "PASSWORD",
  "PASSPHRASE",
  "SECRET",
  "TOKEN",
]);

export function isExchangeCredentialEnvironmentKey(key: string): boolean {
  const normalized = key.toUpperCase();
  if (
    !normalized.startsWith("BYBIT_")
    && !normalized.startsWith("CCXT_")
    && !normalized.startsWith("EXCHANGE_")
  ) {
    return false;
  }
  return normalized.split("_").some((part) => CREDENTIAL_MARKERS.has(part));
}

export function dropBotE2eCredentialsFromProcessEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): readonly string[] {
  const removed: string[] = [];
  for (const key of Object.keys(environment)) {
    if (!isExchangeCredentialEnvironmentKey(key)) continue;
    Reflect.deleteProperty(environment, key);
    removed.push(key);
  }
  return removed.sort();
}

export function buildBotE2eChildEnvironment(
  inherited: Readonly<NodeJS.ProcessEnv>,
  overrides: Readonly<Record<string, string | undefined>> = {},
): Readonly<Record<string, string>> {
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(inherited)) {
    if (value !== undefined && !isExchangeCredentialEnvironmentKey(key)) {
      environment[key] = value;
    }
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (!ALLOWED_OVERRIDE_KEYS.has(key)) {
      throw new Error(`bot E2E child environment override is not allowed: ${key}`);
    }
    if (value === undefined) Reflect.deleteProperty(environment, key);
    else environment[key] = value;
  }
  return environment;
}
