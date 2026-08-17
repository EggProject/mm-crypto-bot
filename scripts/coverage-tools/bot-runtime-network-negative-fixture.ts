import http from "node:http";

const forbiddenKeys = [
  "BYBIT_API_KEY",
  "BYBIT_API_SECRET",
  "BYBIT_EU_ACCESS_TOKEN",
  "CCXT_PASSWORD",
  "EXCHANGE_PASSPHRASE",
];

for (const key of forbiddenKeys) {
  if (Reflect.get(process.env, key) !== undefined) {
    throw new Error(`credential environment leaked into negative child: ${key}`);
  }
}
console.error("[bot-e2e-network-negative] credential environment absent before fixture evaluation");

const attempts: readonly { readonly boundary: string; readonly invoke: () => unknown }[] = [
  {
    boundary: "global.fetch",
    invoke: () => { void globalThis.fetch("https://network-attempt.invalid"); },
  },
  {
    boundary: "node:http.request",
    invoke: () => http.request("http://network-attempt.invalid"),
  },
  {
    boundary: "Bun.connect",
    invoke: () => Bun.connect({
      hostname: "network-attempt.invalid",
      port: 443,
      socket: { data: () => undefined },
    }),
  },
];

for (const attempt of attempts) {
  let blocked = false;
  try {
    attempt.invoke();
  } catch {
    blocked = true;
  }
  if (!blocked) throw new Error(`network boundary was not blocked: ${attempt.boundary}`);
}
