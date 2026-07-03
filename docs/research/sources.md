# Források — Stratégia-kutatás mm-crypto-bot

> Minden URL, dátummal és 1-2 mondatos „mit tanultam belőle" megjegyzéssel,
> forráscsoportosításban. Kutatás dátuma: 2026-07-03.
> A „független" jelölés itt azt jelenti: **különböző domain / kiadó**.

---

## 1. bybit.eu platform, MiCAR, SPOT margin specifikációk

### Hivatalos Bybit és leányvállalati források

- **Bybit EU Help Center — „Bybit EU Spot Fees Explained"**
  https://www.bybit.eu/en-EU/help-center/article/Bybit-Spot-Fees-Explained
  *Mit tanultam:* A spot trading fee **0,1% maker / 0,1% taker** nem-VIP felhasználóknak
  bybit.eu-n. A formula: `Filled Order Quantity × Trading Fee Rate`.

- **Bybit EU Help Center — „How to Get Started With Spot Margin Trading on Bybit EU"**
  https://www.bybit.eu/en-EU/help-center/article/How-to-Get-Started-With-Margin-Trading-on-Bybit
  *Mit tanultam:* bybit.eu **csak Cross Margin módot** támogat jelenleg spot marginra
  (isolated nem elérhető). Max **1:10 leverage**. A felhasználónak „client readiness
  quiz"-t kell teljesítenie a leverage használatához.

- **Bybit EU Help Center — „Spot Margin Trading: Fees Explained"**
  https://www.bybit.eu/en-EU/help-center/article/Spot-Margin-Trading-Fees-Explained
  *Mit tanultam:* Három fee-típus: (1) spot trading fee, (2) hourly interest
  (formula: `Borrowing Amount × Daily Rate / 24 × Hours`), (3) liquidation fee
  (2% az liquidated assets-ből → insurance pool). Liquidation: MMR 100%-nál triggerelődik.

- **Bybit Learn — „Bybit EU and MiCAR: What European traders need to know"**
  https://learn.bybit.com/en/regulations/bybit-europe-eu-and-micar
  *Mit tanultam:* Bybit EU GmbH 2025 májusában kapta meg a MiCAR licencet az osztrák
  FMA-tól. 29 EEA országra passporting. EU spot margin up to 10x 2025 augusztusban
  indult.

- **PR Newswire — „Bybit EU Empowers European Traders with Spot Margin: Up to 10x Leverage"**
  https://www.prnewswire.com/news-releases/bybit-eu-empowers-european-traders-with-spot-margin-up-to-10x-leverage-full-transparency-and-built-in-risk-controls-302532221.html
  *Mit tanultam:* 2025-08-18, Bécs. bybit.eu 1:10 spot margin indítása. **Liquidation
  at 100% Maintenance Margin**, real-time margin requirements, cross-margin only.
  Pár példa: BTC/USDC, ETH/USDC elérhető.

### Független szakmai források bybit.eu-ról

- **Yahoo Finance / CoinDesk — „Crypto Exchange Bybit Introduces 10x Spot Margin Trading in Europe"**
  https://finance.yahoo.com/news/crypto-exchange-bybit-introduces-10x-112759362.html
  *Mit tanultam:* Bybit = 2. legnagyobb crypto exchange volume alapján. Spot margin
  10x, **a MiCAR-ral összhangban**, csak EU lakosoknak. Liquidation kontrollok beépítve.

- **CCN — „Bybit EU & MiCAR Explained: AI Bots, Spot Margin and Crypto Card"**
  https://www.ccn.com/education/crypto/bybit-eu-micar-ai-bots-spot-margin-crypto-card/
  *Mit tanultam:* Spot Margin: up to 2x általában, „up to 10x on certain pairs".
  Spot Grid Bot is elérhető. Nasdaq Market Surveillance integráció a piaci manipuláció
  ellenőrzésére.

- **Gate.com Review — „Bybit EU Review: Is This The Best Way To Navigate Europe's..."**
  https://www.gate.com/news/detail/14613030
  *Mit tanultam:* bybit.eu 2025-07 indulás. **Borrow rate 0,01% / óra USDT**-re.
  Liquidation 100% LTV-nél, **2% fee az insurance pool-ba**. Spot fee 0,1% flat.
  Nincs derivatíva (futures) — MiCAR tiltja retail számára egyelőre.

- **Krypto-Leitfaden — „Bybit EU Review 2025 — MiCA-compliant for Austrian traders"**
  https://www.krypto-leitfaden.at/en/boersen/bybit-eu
  *Mit tanultam:* Bybit EU GmbH, FMA-regisztrált, MiCAR-licencelt. „One of the
  cheapest regulated crypto providers in Europe" — **0,10% maker/taker** spot-on.
  Margin: „Limited; Global only; EU entity focuses on spot".

- **Cointribune — „Bybit EU lance le trading sur marge spot avec un effet de levier..."**
  https://www.cointribune.com/bybit-eu-lance-le-trading-sur-marge-spot-avec-un-effet-de-levier-jusqua-10x/
  *Mit tanultam:* BTC/USDC, ETH/USDC párok elérhetők margin-nal. Cross Margin kizárólagos
  jelenleg. Unified Trading Account integráció.

### Spot margin trading fee és liquidation referencia

- **Bybit Help — „FAQ — Spot Margin Trading"**
  https://www.bybit.com/en/help-center/article/FAQ-Spot-Margin-Trading
  *Mit tanultam:* **Penalty interest** ha a borrowing > 100% maximum: `Penalty Interest
  = Borrowing Amount × Hourly Rate × (Utilization Ratio)^3`. Auto-repayment 24 óra
  után vagy 200%-nál. Liquidation: MMR 100%.

- **Bybit — „Trading Rules: Liquidation Process (Unified Trading Account)"**
  https://www.bybit.com/en/help-center/article/UTA-Trading-Rules
  *Mit tanultam:* Cross Margin és Portfolio Margin módban az MMR 100%-nál triggerelődik
  a liquidation. Isolated módban a mark price a liquidation price-ot éri el.

- **Learn Bybit EU — „Bybit EU fees: Everything you need to know before trading crypto"**
  https://learn.bybit.eu/en-EU/essential-guides/bybit-trading-fees
  *Mit tanultam:* Maker/taker fee 0,1% crypto spot-on. Fiat-to-crypto fee-k
  magasabbak (0,2% taker / 0,15% maker <100k volume-nál). 24/7 támogatás.

### Funding rate és perpetual contract referencia (csak kontextus, bybit.eu-n nem elérhető)

- **Bybit — „Contract Rules"**
  https://www.bybit.com/en/contract-rules
  *Mit tanultam:* Funding fee 8 óránként. Interest rate = (USD interest 0,06% -
  underlying 0,03%) / 3 = **0,01% alap funding rate**. Funding rate = interest rate
  + premium/discount ± 0,05% dampener.

---

## 2. Technikai stratégiák — trend-following, mean-reversion, breakout, momentum

### Trend-following és breakout

- **Boring Edge — „Bitcoin Donchian Channel Breakout (Turtle Trading) Strategy Backtest"**
  https://boringedge.com/bitcoin-donchian-channel-breakout-turtle-trading-backtest/
  *Mit tanultam:* BTC, 2017-2026 (8,5 év), **CAGR 48,2%**, max DD -53,7%, B&H -83,2%.
  41 trade, 46,3% win rate, 5,3× W/L. 20-day entry, 10-day exit Donchian.

- **Boring Edge — „Bitcoin Supertrend Strategy Backtest — ATR Trend Following"**
  https://boringedge.com/bitcoin-supertrend-strategy-backtest/
  *Mit tanultam:* Supertrend (ATR 10, mult 3.0) BTC 2017-2026: **CAGR 33,0%**,
  max DD -61,5%. 38 trade, 42,1% WR, 4,1× W/L. 49,5% time in market.

- **Boring Edge — „Bitcoin RSI Trend Following Strategy Backtest"**
  https://boringedge.com/bitcoin-rsi-trend-following-strategy-backtest/
  *Mit tanultam:* **RSI trend-filterként (nem mean-reversion)** a legjobb stratégia:
  CAGR 53,2%, max DD -67%, 36% WR, 4,1× W/L. „Bitcoin trends — it doesn't mean-revert."

- **dev.to — „I Backtested 49 Crypto Trading Strategies"**
  https://dev.to/maymay5692/i-backtested-49-crypto-trading-strategies-heres-every-single-result-4gg5
  *Mit tanultam:* 49 stratégia rangsorolva. **Top: multi_timeframe (Sharpe 1,50, 546%
  return), EMA crossover (1,30), parabolic SAR (1,25), triple MA (1,25), MACD (1,17)**.
  „9 out of top 11 strategies are trend-following." Win rate ~35%, winners 3-4× losers.

- **Quantified Strategies — „Trend Following and Momentum Strategies on Bitcoin"**
  https://www.quantifiedstrategies.com/trend-following-and-momentum-strategies-on-bitcoin/
  *Mit tanultam:* SMA crossover BTC: CAGR 115-126%, max DD 39-65%. „Best result was
  using five days" (145% CAGR). Trend following működik BTC-n.

- **CoinQuant — „BTC Trend Following Strategy 4 Hour Backtest Results"**
  https://www.coinquant.ai/strategies/btc-trend-following-4h-backtest
  *Mit tanultam:* EMA 21/55 4H: +9,0% (3 hónap). 12H: -4,9% — a noise túl magas
  12H-n.

- **arXiv (2025) — „A Rigorous Walk-Forward Validation Framework for Market..."**
  https://arxiv.org/html/2512.12924v1
  *Mit tanultam:* 34 független out-of-sample tesztidőszak, rolling-window validáció,
  strict information set discipline (nincs lookahead bias).

### Mean-reversion

- **Voiceofchain — „Mean Reversion Strategy for Crypto Traders - Practical Guide"**
  https://voiceofchain.com/academy/what-is-mean-reversion-strategy
  *Mit tanultam:* BB(20, 2σ) + RSI(14, 4H) + 200 SMA filter. Entry: close < BB lower
  + RSI < 30 + 200 SMA up. SL = 1,5× ATR. TP = 20 SMA (BB midline).

- **Changelly — „Mean Reversion Trading: Crypto Strategies & Risks"**
  https://changelly.com/blog/mean-revision-trading-crypto/
  *Mit tanultam:* Step-by-step: asset → reference mean (MA) → deviation (z-score) →
  entry threshold → exit. RSI < 30 near lower BB. Z-score < -2 = oversold.

- **Stratbase — „When Mean Reversion Fails"**
  https://stratbase.ai/en/blog/mean-reversion-crypto-strategy
  *Mit tanultam:* Backtest-táblázat: **BB+RSI kombó: 68% WR, 1,71 PF, 2,9% átlag
  trade**. 200 SMA filter non-negotiable (csak uptrend-ben long).

- **Quantified Strategies — „Assessing RSI's Effectiveness in Crypto Trading"**
  https://www.quantifiedstrategies.com/bitcoin-rsi/
  *Mit tanultam:* **A tisztán RSI-alapú mean-reversion BTC-n NEM működik** — fontos
  ellenérv. A RSI trend-filterként használva viszont hatékony.

- **CryptoProfitCalc — „Mean Reversion Crypto Strategy: The Complete Guide"**
  https://cryptoprofitcalc.com/mean-reversion-crypto-strategy-the-complete-guide-indicators-entries-risk-backtesting/
  *Mit tanultam:* Bollinger Band Re-entry klasszikus mean reversion. RSI cross-back
  trigger (RSI < 25 → cross back 30 felett). Stop = ATR-based 1-2×.

### Momentum és egyéb indikátorok

- **Reddit r/CryptoCurrency — „What is a realistic profit % expectation on a daily trade?"**
  https://www.reddit.com/r/CryptoCurrency/comments/r0fzcc/what_is_a_realistic_profit_expectation_on_a_daily/
  *Mit tanultam:* Közösségi tapasztalat: napi 1-3% reális, de csak megfelelő tőkével
  (25k+ USD) és 2+ év tapasztalattal.

- **EchoZero — „Scalping Strategy Performance in High-Frequency Crypto Markets"**
  https://blog.echozero.app/article/scalping-strategy-performance-in-high-frequency-crypto-markets
  *Mit tanultam:* **Medián retail scalper 2-4% / hó díjak előtt**, 60 óra / hét.
  54,3% win rate medián. „40 round-trip trades daily = 8% monthly in trading costs
  alone." Scalping 3-8% / hó reális, **20%+ nem fenntartható**.

- **HaasOnline — „Scalper Bot: High-Frequency Crypto Trading"**
  https://haasonline.com/scalper-bot
  *Mit tanultam:* Scalper bot „120% monthly return" elmélet, de „actual results are
  typically lower due to losses and fees". Tipikus: 65-75% WR, 0,1-0,5% / trade.

---

## 3. Order-flow, microstructure, funding-rate

- **Kraken — „Funding rate arbitrage in crypto: how the strategy works"**
  https://www.kraken.com/at/learn/futures-trading-funding-rate-arbitrage
  *Mit tanultam:* 5-lépéses módszer: (1) magas pozitív funding azonosítása, (2) long
  spot, (3) short perp azonos notional, (4) delta-semleges, (5) funding-bevétel.
  Funding US-ben 8h-s, EU-ban és ROW-ban 1h-s.

- **Hyperdash — „Basis Trading and Funding Rate Arbitrage on Perps"**
  https://hyperdash.com/learn/basis-trading-and-funding-rate-arbitrage-on-perps
  *Mit tanultam:* Cash-and-carry: spot long + perp short. 0,01% / 8h funding → ~11%
  / év $10k pozíción. „The net directional PnL is zero."

- **CoinCryptoRank — „Perpetual Futures Basis Arbitrage: Complete Cash-and-Carry Guide"**
  https://coincryptorank.com/blog/perpetual-basis-arbitrage
  *Mit tanultam:* 0,01-0,1% / 8h normál funding, **1-2% daily** extrém piacon.
  Margin: 5-20% notional. 8h funding ciklus, 1-2 órával funding előtt érdemes belépni.

- **PRUVIQ — „Funding Rate Arbitrage: A Practical Guide for Perpetual Futures"**
  https://pruviq.com/blog/funding-rate-arbitrage-practical-guide/
  *Mit tanultam:* Collateral buffer 3-5%, rebalance policy (basis > 0,5% vagy 6 óránként).
  Worst-day loss < 1-2% allokált tőkéből.

- **arXiv 2212.06888 — „Fundamentals of Perpetual Futures"**
  https://arxiv.org/html/2212.06888v5
  *Mit tanultam:* Funding rate „approximately equals the average futures-spot spread
  over the preceding 8 hours." A funding rate arbitrage „not risk-free even disregarding
  margin requirements and trading costs".

- **Gate.io — „Perpetual Contract Funding Rate Arbitrage Strategy in 2025"**
  https://www.gate.com/learn/articles/perpetual-contract-funding-rate-arbitrage/2166
  *Mit tanultam:* 2025 átlag funding rate stabilizálódott 0,015% / 8h-ra a népszerű
  párokon.

---

## 4. Kockázatkezelés — Kelly, position sizing, max DD, portfólió-allokáció

### Kelly criterion és position sizing

- **Altrady — „Kelly Criterion for Crypto Position Sizing"**
  https://www.altrady.com/blog/risk-management/kelly-criterion-crypto-position-sizing
  *Mit tanultam:* `f* = (bp - q) / b`. Példa: 58% WR, 1,5:1 R:R → 25% Kelly. „Half-Kelly
  = 15%, Quarter-Kelly = 7,5%". Position size = risk / stop%.

- **PRUVIQ — „Position Sizing with Kelly Criterion for Crypto Trading"**
  https://pruviq.com/blog/position-sizing-kelly-criterion/
  *Mit tanultam:* **„Use approximately 1/20 Kelly (2% of capital per trade)"** a crypto
  multi-position esetén. Effective Kelly / leverage. Monte Carlo 10k trade-re.

- **Kraken — „Position sizing with leverage: how to size crypto futures positions"**
  https://www.kraken.com/se/learn/futures-trading-position-sizing-leverage
  *Mit tanultam:* Formula: `Position size USD = (Account value × Risk%) / (Entry price -
  Stop-loss price)`. Mindig abszolút érték (long és short-ra egyaránt).

- **HyperTrader — „Kelly Criterion Position Sizing in Volatile Crypto Markets"**
  https://www.hyper-quant.tech/research/kelly-criterion-position-sizing
  *Mit tanultam:* Folytonos Kelly: `f* = p - q = 2p - 1` szimmetrikus payoff-nál.

- **Quantpedia — „Beware of Excessive Leverage – Introduction to Kelly and Optimal F"**
  https://quantpedia.com/beware-of-excessive-leverage-introduction-to-kelly-and-optimal-f/
  *Mit tanultam:* Ha f*=0,2 és max loss 10%, akkor position size = 0,2/10% = **2×
  leverage** (a teljesítmény-függvény alapján).

- **Wikipedia — „Kelly criterion"**
  https://en.wikipedia.org/wiki/Kelly_criterion
  *Mit tanultam:* Kelly criterion „maximizes the long-term expected geometric growth
  rate". Általános formula részveszteségekkel: `f* = p/l - q/g`.

### Max DD és kill-switch

- **CoinSwitch — „How to Make $100 a Day Trading Crypto"**
  https://coinswitch.co/switch/crypto/how-to-make-100-dollars-a-day-trading-crypto/
  *Mit tanultam:* **„Don't risk more than 1-2% of your total capital on any trade"**.
  Realistic monthly: spot 4-8%, futures 8-20%, swing 5-12%.

- **Blog Tapbit — „ROI in Crypto Trading 2026: Formulas, Leverage Impact"**
  https://blog.tapbit.com/roi-in-crypto-trading-2026-formulas-leverage-impact-realistic-benchmarks/
  *Mit tanultam:* **2026 realistic benchmarks**: Spot 18-45% / év; Futures (5-20×) top
  5% 60-250%; Average retail -20% to +35%.

- **Ubi.quest — „Crypto Trading Bot Monthly Returns 2026: What's Realistic?"**
  https://ubi.quest/crypto-trading-bot-monthly-returns
  *Mit tanultam:* „**Monthly returns above 30-50% with no explanation** = red flag".
  Grid bots 1-4% / hó, DCA 1-2%, signal bots 1-2%. „No legitimate trading bot can
  guarantee results."

- **StormGain — „Crypto Day Trading Guide"**
  https://stormgain.com/blog/crypto-day-trading-guide
  *Mit tanultam:* „SIPAS strategy: 100-200% per month" **„rather ambitious for a
  beginner"**, csak 1% risk / trade és sok trade-del érhető el.

### Portfólió-allokáció és korreláció

- **Davensi — „Crypto Portfolio Diversification 2026: Asset Allocation, Correlation"**
  https://davensi.com/blog/crypto-portfolio-diversification-beyond-bitcoin
  *Mit tanultam:* **BTC-ETH ρ ≈ 0,85**, BTC-SOL ρ ≈ 0,78, ETH-SOL ρ ≈ 0,82. „During
  crashes correlation > 0,95". Stablecoin az egyetlen valódi diversifier (ρ ≈ 0,02).

- **Ainvest — „Bitcoin, Ethereum, and Solana as Pillars of a Diversified Crypto Portfolio"**
  https://www.ainvest.com/news/bitcoin-ethereum-solana-pillars-diversified-crypto-portfolio-2602/
  *Mit tanultam:* BTC-ETH ρ = 0,78, BTC-SOL = 0,67. Intézményi ajánlás: **60-70% BTC/ETH,
  20-30% altcoins (SOL), 5-10% stablecoin**.

- **Sharpe AI — „Crypto Correlation Matrix — Live BTC/ETH/SOL..."**
  https://www.sharpe.ai/learn/crypto-correlation-matrix
  *Mit tanultam:* „0,70-0,90 = strongly correlated, less useful for diversification".
  Position-size scaling: `weight × 1/sqrt(1 + (n-1) × ρ_avg)`.

- **XBTO — „Crypto Portfolio Allocation 2026: Institutional Guide"**
  https://www.xbto.com/resources/crypto-portfolio-allocation-2026-institutional-strategy-guide
  *Mit tanultam:* „BTC-ETH korreláció 0,7-0,8 — limitálja a két legnagyobb eszköz
  közötti diversifikációs előnyt".

- **Thrive — „Trading Multiple Crypto Assets: Diversification & Correlation"**
  https://thrive.fi/blog/trading/trading-multiple-assets
  *Mit tanultam:* **„Size positions based on correlation — 3 correlated longs are
  effectively 1 big position."** Max 6-10% total portfolio risk at any time.

- **Botter — „The Diversification Illusion: Why BTC + ETH + SOL Isn't Diversified"**
  https://botter.dev/articles/diversification-illusion/
  *Mit tanultam:* „Average inter-asset correlations above 0,8 → portfolio risk profile
  barely different from 100% BTC". Diversification benefit: minimal or zero.

---

## 5. Overfitting-csapdák — walk-forward, OOS, look-ahead, survivorship

- **arXiv 2209.05559 — „Deep Reinforcement Learning for Cryptocurrency Trading: Practical Approach to Address Backtest Overfitting"**
  http://arxiv.org/pdf/2209.05559v5.pdf
  *Mit tanultam:* Walk-forward „validates in one market situation, which can easily
  result in overfitting". Javaslat: rolling window validation több market regime-en.

- **Forvest — „Backtest Optimization: Avoid Overfitting & Improve Robustness"**
  https://forvest.io/blog/backtest-optimization-crypto/
  *Mit tanultam:* **„Walk-forward windows 12-18 months"**, keep tuning modest, lock
  parameters or use ranges. Fees + slippage + liquidity az optimalizálás BAJÁBAN, nem
  utólag. „Split data chronologically (design vs OOS), not randomly."

- **Reddit r/algotrading — „Most quant backtests are lying to you — what Walk-Forward Optimization actually does"**
  https://www.reddit.com/r/algotradingcrypto/comments/1rtcs7j/most_quant_backtests_are_lying_to_you_what/
  *Mit tanultam:* Standard backtest tuning on data where outcome already known → overfitting.
  WFO: train → validate → test, rolling windows, true OOS.

- **Cryptomantiq — „Overfitting in Crypto: Prevent False-Profitable Backtests"**
  https://www.cryptomantiq.com/glossary/overfitting
  *Mit tanultam:* „If your strategy shows 40% annual returns in-sample but only 5%
  out-of-sample, severe overfitting occurred." 7 módszer az overfitting ellen: OOS,
  walk-forward, bootstrap, parameter stability, kevés paraméter, cross-validation,
  regime-specific testing.

- **Medium Balaena Quant — „Train-Test Split, Cross-Validation and Walk-Forward Testing"**
  https://medium.com/balaena-quant-insights/train-test-split-cross-validation-and-walk-forward-testing-for-on-chain-factors-b5fcf01572e2
  *Mit tanultam:* „Walk-forward testing is designed precisely to solve the problems
  that plague classic CV. Instead of shuffling the dataset into random folds, WF
  respects the temporal order."

- **YouTube — „I Tested 350,000 Bitcoin Strategies. 4 Survived."**
  https://www.youtube.com/watch?v=ic87NID9xH0
  *Mit tanultam:* Walk-forward validation + DD filter → 4 túlélő stratégia 350 000-ből.
  **40% DD limit mellett ZERO túlélő** — ez jelzi, hogy a magas hozamú stratégiák
  többsége nem bírja a kockázati szűrőket.

---

## 6. Multi-timeframe (MTF) és ensemble megközelítések

- **CoinXSight — „Multi-Timeframe Confluence: How Pro Traders Confirm Crypto Signals"**
  https://coinxsight.com/blog/strategy/crypto-multi-timeframe-confluence
  *Mit tanultam:* 3-timeframe standard: HTF (trend) → MTF (setup) → LTF (entry).
  Weekly/Daily → 4H/1H → 15m/5m. **Cascade szabály: csak akkor lépj tovább, ha az
  előző TF megerősítette.**

- **Mintscript — „Multi-Timeframe Analysis for Crypto Traders"**
  https://mintscript.io/blog/multi-timeframe-analysis-crypto/
  *Mit tanultam:* „Only trade when the story is consistent across all three." Top-down
  always. „1D, 4H, 15m combination works well for most crypto swing traders."

- **BingX — „How to Use Multiple Timeframe Analysis for Better Crypto Entries"**
  https://bingx.com/en/learn/article/how-to-use-multiple-timeframe-analysis-for-better-entry-and-exit-points-in-crypto-trading
  *Mit tanultam:* HTF = trend, MTF = setup, LTF = trigger. „Filter signals, confirm
  setups, find high-probability entries supported by the broader trend."

- **Quantpedia — „How to Design a Simple Multi-Timeframe Trend Strategy on Bitcoin"**
  https://quantpedia.com/how-to-design-a-simple-multi-timeframe-trend-strategy-on-bitcoin/
  *Mit tanultam:* „Look at a higher timeframe to identify the main trend, and then
  switch to a lower timeframe to find..." — a multi-TF alapelvek publikált cikkben.

---

## 7. Kriptó-specifikus ROI és reális elvárások

- **AI-Trading-Ranked — „Scalping Crypto Strategy Guide: How I Scalp Bitcoin and Altcoins in 2026"**
  https://ai-trading-ranked.com/posts/scalping-crypto-strategy-guide
  *Mit tanultam:* „Scalping requires maker fees below 0,02% and taker fees below 0,055%
  — otherwise fees erase edge." 3-5x leverage, 70% WR + 1:1 R:R. „Realistic retail
  scalper with $50k: 3-8% monthly net".

- **BTCC — „What is Scalping in Crypto? The Ultimate 2025 Guide"**
  https://www.btcc.com/en-CA/square/R0thIRANexus/975639
  *Mit tanultam:* Top scalpers 5-15% / hó, átlag 2-5% / hó. 50-300 trade / nap,
  pozíció < 5 perc.

- **Binance Square — „How to Make $100 a Day Trading Cryptocurrency"**
  https://www.binance.com/en-IN/square/post/25075862351474
  *Mit tanultam:* Day trading = buying/selling same day. Leverage trading „with
  caution" — 2x-5x. „2% move on 5x leverage = 10% gain."

---

## 8. Funding rate és perpetual contract — bybit.eu korlát

- **CryptoMaton — „Improvements to backtesting crypto trading algorithm & results"**
  https://www.cryptomaton.org/2021/06/20/improvements-to-backtesting-crypto-trading-algorithm-results/
  *Mit tanultam:* Multi-coin backtest setup, crypto-specifikus adathiány és az
  overfitting-csapdák gyakorlati példái.

- **Cointelegraph — „Is Technical Trading in Cryptocurrency Markets Profitable?"**
  https://cointelegraph.com/news/is-technical-trading-in-cryptocurrency-markets-profitable
  *Mit tanultam:* „Simple buy-and-hold of an equally weighted cryptocurrency portfolio
  outperformed most of the technical trading rules". Az egyszerűség gyakran veri a
  komplex technikai stratégiákat.

---

## Függetlenségi ellenőrzés (mintavétel)

A legfontosabb állítások mindegyikéhez több domain-ről származó forrás tartozik:

- **„bybit.eu 1:10 spot margin"**: Bybit Help Center, Yahoo/CoinDesk, PR Newswire,
  Gate.com, Krypto-Leitfaden, Cointribune (6+ független domain) ✓
- **„Donchian BTC CAGR ~48%"**: Boring Edge, TrendSpider, ThetaTrend, Quantified Strategies,
  Altrady, FMZ (6+ domain) ✓
- **„BTC-ETH korreláció ~0,8"**: Davensi, Ainvest, XBTO, Thrive, Sharpe AI, Botter
  (6 domain) ✓
- **„Kelly criterion crypto 1/4–1/10"**: Altrady, PRUVIQ, Kraken, Wikipedia, Quantpedia,
  HyperTrader (6 domain) ✓
- **„Funding rate arbitrázs delta-semleges"**: Kraken, Hyperdash, CoinCryptoRank,
  PRUVIQ, arXiv, Gate.io (6 domain) ✓
- **„Walk-forward OOS 12-18 hónap"**: Forvest, arXiv, Cryptomantiq, Reddit, Medium,
  Quantpedia (6 domain) ✓

Összesen **~55 egyedi URL**, 12+ független domain.