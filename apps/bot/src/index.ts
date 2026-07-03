// apps/bot/src/index.ts — `@mm/bot` belépési pont (futtatható bináris)
//
// FELADAT: A `@mm/bot` a teljes mm-crypto-bot rendszer belépési pontja.
// Felelőssége:
//   1. Konfiguráció betöltése (@mm/shared/config)
//   2. Logger létrehozása (@mm/shared/logger)
//   3. Exchange client példányosítása (@mm/exchange)
//   4. Stratégia-motor indítása (@mm/core)
//   5. Paper / live engine indítása (@mm/paper)
//   6. TUI mount (opcionális) — @mm/tui
//   7. Graceful shutdown (SIGINT / SIGTERM)
//
// A scaffold fázisban csak az indítási logika van itt: argumentum-parser,
// config betöltés, és a fenti modulok "not implemented yet" hibájának
// szép megjelenítése. A tényleges indítás a későbbi fázisokban.

import { loadConfig } from "@mm/shared/config";
import { createLogger } from "@mm/shared/logger";

const log = createLogger("info");

function parseArgs(argv: readonly string[]): { mode: "paper" | "live"; tui: boolean } {
  const mode: "paper" | "live" = argv.includes("--live") ? "live" : "paper";
  const tui: boolean = argv.includes("--no-tui") ? false : true;
  return { mode, tui };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const { mode, tui } = parseArgs(argv);

  const cfg = loadConfig();
  log.info("bot indítása", { mode, tui, env: cfg.env });

  if (mode === "live") {
    log.warn("LIVE mód — valódi pénzmozgás. Ellenőrizd az API kulcsokat és a kockázati limiteket!");
  }

  // A későbbi fázisokban:
  //   const exchange = createExchangeClient({ ... });
  //   const strategy = createStrategy();
  //   const handle = await startPaperEngine({ symbols: [...], initialEquityUsdt: 10_000, feeBps: 10, slippageBps: 5 });
  //   if (tui) render(<App />); else handle idle await;
  //   process.on("SIGINT", async () => { await handle.stop(); process.exit(0); });
  log.error("not implemented yet: a teljes bot indítás a későbbi fázisban implementálandó", {
    nextSteps: "@mm/exchange + @mm/core + @mm/paper bekötése",
  });
}

main().catch((err: unknown) => {
  log.error("végzetes hiba a bot indítása közben", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
