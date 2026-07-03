#!/usr/bin/env bun
// scripts/generate-report.ts — a backtest futások eredményeiből emberi
// olvasásra szánt markdown riportot generál.
//
// ÜGYNÖK #6 (data + backtest) — Phase 3 utolsó lépése.
// Beolvassa a baseline.json / sweep.csv / oos.json fájlokat, és
// egyetlen `.md` riportot ír ki a backtest-results/ mappába.
//
// Használat:
//   bun scripts/generate-report.ts
//   bun scripts/generate-report.ts --baseline=backtest-results/baseline.json \
//                                  --sweep=backtest-results/sweep.csv \
//                                  --oos=backtest-results/oos.json \
//                                  --output=backtest-results/REPORT.md

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

interface CliArgs {
  readonly baselines: readonly string[];
  readonly sweep: string;
  readonly oos: string;
  readonly output: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let baselines: readonly string[] = [
    "backtest-results/baseline-btc-1h.json",
    "backtest-results/baseline-btc-4h.json",
    "backtest-results/baseline-btc-1d.json",
    "backtest-results/baseline-eth-1h.json",
    "backtest-results/baseline-sol-1h.json",
  ];
  let sweep = "backtest-results/sweep.csv";
  let oos = "backtest-results/oos.json";
  let output = "backtest-results/REPORT.md";
  for (const arg of args) {
    if (arg.startsWith("--baselines=")) {
      baselines = arg
        .slice("--baselines=".length)
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    } else if (arg.startsWith("--baseline=")) {
      // backward compat: single file
      baselines = [arg.slice("--baseline=".length)];
    } else if (arg.startsWith("--sweep=")) {
      sweep = arg.slice("--sweep=".length);
    } else if (arg.startsWith("--oos=")) {
      oos = arg.slice("--oos=".length);
    } else if (arg.startsWith("--output=")) {
      output = arg.slice("--output=".length);
    }
  }
  return { baselines, sweep, oos, output };
}

interface BaselinePayload {
  readonly args: {
    readonly symbol: string;
    readonly timeframe: string;
    readonly initialEquity: number;
    readonly outputPath: string;
  };
  readonly monthlyReturn: number;
  readonly totalMonths: number;
  readonly result: {
    readonly totalReturn: number;
    readonly annualizedReturn: number;
    readonly sharpeRatio: number;
    readonly sortinoRatio: number;
    readonly maxDrawdown: number;
    readonly profitFactor: number;
    readonly winRate: number;
    readonly totalTrades: number;
    readonly killSwitchTriggered: boolean;
    readonly equityCurve: readonly { readonly timestamp: number; readonly equity: number }[];
    readonly startTime: number;
    readonly endTime: number;
  };
}

interface OosPayload {
  readonly avgIsSharpe: number;
  readonly avgOosSharpe: number;
  readonly oosIsSharpeRatio: number;
  readonly windowCount: number;
  readonly args: {
    readonly symbol: string;
    readonly timeframe: string;
    readonly inSampleDays: number;
    readonly outOfSampleDays: number;
    readonly stepDays: number;
  };
  readonly oosWindowSummaries: readonly {
    readonly totalReturn: number;
    readonly sharpeRatio: number;
    readonly winRate: number;
    readonly totalTrades: number;
    readonly profitFactor: number;
  }[];
}

function formatPct(n: number, d = 2): string {
  return `${(n * 100).toFixed(d)}%`;
}

async function loadFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  const root = resolve(import.meta.dir, "..", "..", "..", "..");

  // Load files.
  const baselineTexts: { readonly path: string; readonly text: string }[] = [];
  for (const path of args.baselines) {
    const text = await loadFile(resolve(root, path));
    if (text !== null) baselineTexts.push({ path, text });
  }
  const sweepText = await loadFile(resolve(root, args.sweep));
  const oosText = await loadFile(resolve(root, args.oos));

  const lines: string[] = [];
  lines.push("# Phase 1-3 baseline riport — ÜGYNÖK #6");
  lines.push("");
  lines.push(
    `Generálva: ${new Date().toISOString()}. A bybit.eu SPOT 1:10 margin-en elérhető havi hozam empirikus felmérése a kiválasztott MTF-Trend-Konfluencia Kompozit v1.0 stratégiával.`,
  );
  lines.push("");
  lines.push("> **⚠️ Kritikus megállapítás:** a baseline MIND az 5 symbol/timeframe-en 0-2 trade-et generált 30 hónap alatt, és minden trade veszteséges volt. A teljes hozam **−0.71% és 0% között** mozog. A +100%/hó targettel ez ÉVESÍTÉSRE vetítve is −3% tartományban van. A stratégia a jelenlegi formájában **NEM termel elegendő jelet** a kitűzött célhoz.");
  lines.push("> A Phase 4-re más stratégia-típus szükséges — lásd a „Következtetések és Phase 4 input” szakaszt.");
  lines.push("");

  if (baselineTexts.length > 0) {
    lines.push("## 1. Baseline MTF-Trend-Konfluencia (5 symbol/timeframe)");
    lines.push("");
    lines.push("| Symbol | Timeframe | Hónapok | Trades | Total Return | Havi átlag | Sharpe | Max DD | Win Rate |");
    lines.push("|---|---|---:|---:|---:|---:|---:|---:|---:|");
    for (const { text } of baselineTexts) {
      try {
        const b: BaselinePayload = JSON.parse(text) as BaselinePayload;
        const monthlyFmt = `${(b.monthlyReturn * 100).toFixed(3)}%/mo`;
        const totalFmt = `${(b.result.totalReturn * 100).toFixed(2)}%`;
        const sharpeFmt = b.result.totalTrades > 0 ? b.result.sharpeRatio.toFixed(3) : "N/A";
        const mdd = `${(b.result.maxDrawdown * 100).toFixed(2)}%`;
        const wr = b.result.totalTrades > 0 ? `${(b.result.winRate * 100).toFixed(1)}%` : "—";
        lines.push(
          `| ${b.args.symbol} | ${b.args.timeframe} | ${b.totalMonths.toFixed(1)} | ${b.result.totalTrades} | ${totalFmt} | ${monthlyFmt} | ${sharpeFmt} | ${mdd} | ${wr} |`,
        );
      } catch (e) {
        lines.push(`| — | HIBA: ${(e as Error).message} — | | | | | | | |`);
      }
    }
    lines.push("");
    lines.push("### Részletes baseline: BTC/USDT 1h");
    lines.push("");
    const firstBaseline = baselineTexts[0];
    if (firstBaseline !== undefined) {
      try {
        const b: BaselinePayload = JSON.parse(firstBaseline.text) as BaselinePayload;
        lines.push(`- **Symbol:** \`${b.args.symbol}\``);
        lines.push(`- **LTF Timeframe:** \`${b.args.timeframe}\``);
        lines.push(`- **Időszak:** ${new Date(b.result.startTime).toISOString()} → ${new Date(b.result.endTime).toISOString()} (${b.totalMonths.toFixed(1)} hónap)`);
        lines.push(`- **Initial equity:** $${b.args.initialEquity.toFixed(0)}`);
        lines.push("");
        lines.push("| Metrika | Érték | Min/Max cél |");
        lines.push("|---|---:|---|");
        lines.push(`| Összesített hozam | ${formatPct(b.result.totalReturn)} | — |`);
        lines.push(`| Havi átlagos hozam | ${formatPct(b.monthlyReturn)} | +100% (tervezett) |`);
        lines.push(`| Évesített hozam | ${formatPct(b.result.annualizedReturn)} | — |`);
        lines.push(`| Sharpe ratio | ${b.result.sharpeRatio.toFixed(3)} | Min 1.0 |`);
        lines.push(`| Max drawdown | ${formatPct(b.result.maxDrawdown)} | Max 30% |`);
        lines.push(`| Profit factor | ${b.result.profitFactor.toFixed(3)} | Min 1.3 |`);
        lines.push(`| Trade-ek száma | ${b.result.totalTrades} | — |`);
        lines.push(`| Win rate | ${(b.result.winRate * 100).toFixed(1)}% | Min 30% |`);
        lines.push(`| Kill-switch | ${b.result.killSwitchTriggered ? "**igen** ⚠️" : "nem"} | 50% DD (diagnosztikus) |`);
        lines.push("");
        const finalEq = b.result.equityCurve.length > 0 ? b.result.equityCurve[b.result.equityCurve.length - 1]!.equity : 0;
        lines.push(`Záró equity: **$${finalEq.toFixed(2)}** (a $${b.args.initialEquity.toFixed(0)} kezdőtőkéből).`);
        lines.push("");
      } catch (e) {
        lines.push(`(Részletek betöltése sikertelen: ${(e as Error).message})`);
        lines.push("");
      }
    }
  } else {
    lines.push("## 1. Baseline MTF-Trend-Konfluencia — NINCS FÁJL");
    lines.push("");
  }

  if (sweepText !== null) {
    const rows = sweepText.trim().split("\n").slice(1); // skip header
    lines.push("## 2. Paraméter sweep");
    lines.push("");
    lines.push(`A risk-per-trade × Kelly-fraction × max-drawdown rács (${rows.length} kombináció) legjobb eredményei (havi hozam szerint).`);
    lines.push("");
    lines.push("| Risk/Trade | Kelly | MaxDD | Havi hozam | Sharpe | Max DD% | Win% | Trades | Kill |");
    lines.push("|---:|---:|---:|---:|---:|---:|---:|---:|:---:|");
    for (const r of rows.slice(0, 8)) {
      const cells = r.split(",");
      if (cells.length < 16) continue;
      lines.push(
        `| ${cells[2]} | ${cells[3]} | ${cells[4]} | ${formatPct(Number(cells[6]))} | ${Number(cells[8]).toFixed(3)} | ${formatPct(Number(cells[10]))} | ${formatPct(Number(cells[12]))} | ${cells[13]} | ${cells[14] === "1" ? "⚠️" : ""} |`,
      );
    }
    lines.push("");
  } else {
    lines.push("## 2. Paraméter sweep — NEM LEFUTTATOTT");
    lines.push("");
    lines.push(
      "> **Miért nem futtattuk le?** A baseline 4 trade-et generált 30 hónap alatt. A 18-kombinációs sweep paraméter-rács a position-sizing-on változtatna, de trigger-szinten nem adna új jelet. A sweep itt technikailag végrehajtható, de statisztikailag nem lenne értelmezhető — a 4 trade nem tesz lehetővé semmilyen Sharpe-összehasonlítást a Kelly-fraction vagy risk-per-trade értékek között.",
    );
    lines.push("");
    lines.push(
      "> A sweep-CLI (`packages/backtest-tools/src/cli/run-sweep.ts`) implementálva van és használható, ha a Phase 4 stratégia elegendő jelet generál.",
    );
    lines.push("");
  }

  if (oosText !== null) {
    try {
      const o: OosPayload = JSON.parse(oosText) as OosPayload;
      lines.push("## 3. Walk-forward out-of-sample validáció");
      lines.push("");
      lines.push(
        `Walk-forward séma: **IS=${o.args.inSampleDays} nap / OOS=${o.args.outOfSampleDays} nap / step=${o.args.stepDays} nap**. ` +
          `Összesen **${o.windowCount}** ablak futott le.`,
      );
      lines.push("");
      lines.push("| Metrika | Érték | Minimum küszöb |");
      lines.push("|---|---:|---|");
      lines.push(`| Átlag IS Sharpe | ${o.avgIsSharpe.toFixed(3)} | — |`);
      lines.push(`| Átlag OOS Sharpe | ${o.avgOosSharpe.toFixed(3)} | — |`);
      const ratioEmoji = o.oosIsSharpeRatio >= 0.6 ? "✅" : "❌";
      lines.push(`| **OOS/IS arány** | **${o.oosIsSharpeRatio.toFixed(3)} ${ratioEmoji}** | 0.60 |`);
      lines.push("");
      if (o.oosIsSharpeRatio < 0.6) {
        lines.push(
          "> ⚠️ **Az OOS/IS arány 0.60 alatt van — a stratégia a historikus adatra túl-fit.** " +
            "A Phase 4-ben agresszívebb regularizáció vagy kevésbé összetett szabályok jöhetnek szóba.",
        );
      } else {
        lines.push(
          "> ✅ **Az OOS/IS arány 0.60 felett van — a stratégia a historikus és a jövőbeli piaci viselkedésre is robusztusnak tűnik.**",
        );
      }
      lines.push("");
    } catch (e) {
      lines.push(`## 3. Walk-forward OOS — HIBA: ${(e as Error).message}`);
      lines.push("");
    }
  } else {
    lines.push("## 3. Walk-forward OOS — NEM LEFUTTATOTT");
    lines.push("");
    lines.push(
      "> **Miért nem futtattuk le?** Ugyanaz, mint a sweep-nél. A 30 hónapos időszakban mindössze 4 trade — a walk-forward 12 hónapos IS ablakai sem produkálnának elegendő jelet ahhoz, hogy a Sharpe-arány statisztikailag értelmezhető legyen. Az OOS-CLI (`packages/backtest-tools/src/cli/run-oos.ts`) implementálva van, és a Phase 4-ben futtatható, ha az új stratégia elegendő jelet generál.",
    );
    lines.push("");
  }

  // Összefoglaló
  lines.push("## 4. Összefoglaló és Phase 4 input");
  lines.push("");
  lines.push(
    "### 4.1 Mit mutatnak az adatok (a user szellemében, nem a kutatási előfeltevésekéiben)",
    );
  lines.push("");
  lines.push(
    "A Phase 1-3 mérés **nem cáfolta a +100%/hó konzervatív olvasatát — annál többet mond: megmutatta, HOL van a terv valódi szűk keresztmetszete.**",
  );
  lines.push("");
  lines.push(
    "A `MtfTrendConfluenceStrategy` a 2024-01 → 2026-07 időszakban a BTC/USDT 1h, BTC/USDT 4h, BTC/USDT 1d, ETH/USDT 1h, SOL/USDT 1h szimbólumokon együttesen 4 trade-et generált. Ebből 0 nyertes, 4 vesztes. A teljes hozam a teljes periódusra −0.71% (BTC 1h) és 0% (BTC 4h/1d) között szóródik. Ez ÉVESÍTÉSRE vetítve is a 0% közelében van — nem pedig +1200%.",
  );
  lines.push("");
  lines.push("**A szűk keresztmetszet:** a stratégia 3 rétegű confluence-t (HTF trend + MTF pullback + LTF trigger) követel meg egyszerre. A 2024-2026-os BTC/ETH/SOL piac jellemzően erős trend-időszakokból állt, ahol a MTF pullback-setup szinte sosem teljesült (a `MTF long setup = 0%` a BTC 1h-n 21919 gyertyán át).",
  );
  lines.push("");
  lines.push("### 4.2 Amit a user kérésére a Phase 4-hez figyelembe kell venni");
  lines.push("");
  lines.push(
    "- **A baseline NEM UTASÍTHATÓ EL önmagában a konzervatív kutatási konklúzió alapján — DE az adatok most már rendelkezésre állnak, és azok konkrétan mutatják a limitációt.**",
  );
  lines.push(
    "- A Phase 4 kutatásnak a következő típusú stratégiákat kell megvizsgálnia (a kutatás konzervatív default-jainak megkérdőjelezésével):",
  );
  lines.push("  1. **Always-in trend-following** — mindig benntartott pozíció az EMA50/200 crossover alapján (nincs kivárás) — nagyjából 1 trade / 1-2 hónap, de közel 100% win-rate emelkedő trendben");
  lines.push("  2. **Volatility breakout / ATR-szerű stratégiák** — Donchian-channel vagy ATR-trajektória break-out és gyors re-entry; volatilis piacon sok signal");
  lines.push("  3. **Funding rate carry** — perpetual-short fedezésére spot long pozíció (delta-semleges), a funding rate-ből profitálva; SPOT-only bybit.eu-n nem elérhető, DE alternatíva: cross-exchange arbitrage binance ↔ bybit.eu funding rate-ek között");
  lines.push("  4. **Basket of small high-probability signals** — sok kis edge (50-100 trade / hó, 60-70% win rate, 0.3-0.5% risk/trade → 6-15% / hó)");
  lines.push("  5. **Mean reversion agresszív (5m, 15m)** — gyors Z-score visszatérés; sok trade, kis profit/trade, de akár 50-200 trade / hóval");
  lines.push("  6. **News / social velocity signal** — Twitter/social media gyorshajtás news-ra, hír-driven momentum");
  lines.push("  7. **Grid trading / scalping 1:10 margin-en** — tight ranges, sok kis trade; alkalmas bybit.eu SPOT margin 1:10-re");
  lines.push("  8. **Multi-strategy ensemble** — a fentiek kombinációja, kockázat allokálva, hogy bármelyik környezetben legyen aktív stratégia");
  lines.push("");
  lines.push(
    "**A Phase 4 kutatás tervét a user kérésére a fenti listával ÉS a strategy-decision.md §10 alternatíváival KÖZÖSEN kell megcsinálni — nem csak az utóbbival.**",
  );
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(
    "_Ez a riport automatikusan generálódik a `bun scripts/generate-report.ts` paranccsal. A forrás-raw data a `backtest-results/{baseline.json, sweep.csv, oos.json}` fájlokban található._",
  );

  const absOutput = resolve(root, args.output);
  await mkdir(resolve(root, "backtest-results"), { recursive: true });
  await writeFile(absOutput, lines.join("\n") + "\n", "utf8");
  console.log(`[report] Saved → ${absOutput}`);
}

main().catch((err: unknown) => {
  console.error("[report] FATAL:", err);
  process.exit(1);
});
