---
description: Research doctrine MANDATORY OVERRIDE (2026-07-05 14:16 Budapest) — phase-11.3+ structure built around it. Supersedes "general-purpose quant" defaults in Phase 1-11.2e. 5 parallel research tracks, multi-language (CJK + others, NOT Hungarian), depth ≥10 queries/angle.
---

# Phase 11.3 — Crypto-Native Microstructure Research (the doctrine-override plan)

**Trigger:** Phase 11.2e BasisTradePlugin envelope at 1:10 = +1.42%/mo ceiling, -20% from Phase 11.1d. User diagnosis (verbatim, translated):

> "the problem is you're going for general strategies that don't work on crypto. Don't search for general strategies. Dig up Asian forums and every other language (don't search in Hungarian!), launch 5 parallel research agents from different angles. They don't stop at the first or second hit, they keep going until they've really searched everything."

**The structural diagnosis:** every plugin we built in Phase 1-11.2e (carry, basis, directional MTF, vol-target, regime detector, kill-switch, Kelly sizing, funding timing, signal-center bus) is a **general-purpose quant strategy with crypto makeup**. The crypto-native alpha — microstructure, on-chain flow, perp-DEX mechanics, liquidation cascade, Asian-session patterns, CJK-language quant communities — is documented in sources we have not been reading.

## Doctrine (binding, must appear in every Todo going forward)

1. **Crypto-native ONLY.** No general-purpose quant (stat-arb on equities, mean-reversion on index futures, generic momentum, MA crossover, classic Kelly) UNLESS a crypto-native post-2020 source documents alpha.
2. **Multi-language mandatory.** zh, ja, ko, ru, vi, tr, es, pt, ar. **NEVER Hungarian**. Asian (CJK + SEA) priority. English is fallback, not primary.
3. **5 parallel research agents minimum.** Distinct angles. No overlap.
4. **Depth over surface.** ≥10-20 web_queries/angle. Read primary sources in original language.
5. **Termination = angle exhaustion.** Past first + second hit, into citations + cross-language verification (zh claim → en source).
6. **TodoWrite invariant.** Every Todo list MUST include a top-line: `research doctrine: crypto-native + multi-lang (NO Hungarian) + ≥5 parallel agents + ≥10 queries/angle`.

Saved to: `/Users/kiscsicska/.mavis/agents/mavis/memory/MEMORY.md` (top-of-file, supersedes "User research & decision-making style" entry).

---

## Phase 11.3 — 5 parallel research tracks

| Track | Angle | Languages | Output |
|-------|-------|-----------|--------|
| A | Asian session microstructure | ja + ko + zh + en | Alpha hypothesis + sources + 1:10 bybit.eu applicability |
| B | On-chain alpha (whale flow, liquidation hunt, perp-DEX MEV) | zh + en + ru | Alpha hypothesis + sources + on-chain data feeds required |
| C | Perp-DEX microstructure (Hyperliquid / gTrade / dYdX v4 / Vertex) | zh + en | Alpha hypothesis + sources + perp-DEX vs CEX execution notes |
| D | Funding-rate microstructures BEYOND carry (term structure, skew, OI dynamics, cross-X basis) | ko + zh + en | Alpha hypothesis + sources + backtest-able signal sketch |
| E | Order-flow / liquidation cascade (VPIN-OFI adapted, footprint, cascade detection) | zh + ja + en | Alpha hypothesis + sources + data-feed requirements |

**Each track producer instruction (uniform across tracks):**

```
You are TrackN: research the "ANGLE" angle for crypto-native edge.

CONSTRAINTS (binding — supersede default research style):

1. LANGUAGE: research in {langs} as PRIMARY. English fallback. NEVER Hungarian.
2. DEPTH: ≥15 web_queries. Don't stop at first hit, don't stop at second hit. Continue
   until the angle is exhausted — read top-20 results per query, follow citations,
   cross-check in ≥2 languages per empirical claim (zh claim → en source, or vice versa).
3. CRYPTO-NATIVE: NO general-purpose quant strategy (stat-arb equities, mean-reversion
   index futures, generic momentum, MA crossover, Bollinger, classic Kelly) unless a
   crypto-native post-2020 source documents alpha. Strategies pre-2020 on
   equities/FX/commodities → default-rejected.
4. PRIMARY SOURCES: exchange docs in original language, perp-funding methodology pages,
   official funding history pages, exchange blog posts, academic quant-finance papers
   (NOT "konzervatív régi forex kereskedők" sources — explicit user ban).
5. CITATION RIGOR: ≥2 independent sources per empirical claim, in ≥2 languages where
   possible.

OUTPUT (deliverable.md, ≥2500 words):

§1: ANGLE DEFINITION (1 paragraph, what we're researching)
§2: SOURCE INVENTORY (≥10 primary sources, URL + language + 1-line relevance)
§3: ALPHA HYPOTHESES (3-5 ranked, each: mechanism → backtest-able signal →
     data feed required → applicability to 1:10 bybit.eu → expected return character
     → risk character → decay susceptibility)
§4: ANTI-PATTERNS OBSERVED IN OUR PRIOR PHASES (which generic-quant strategies
     we tried in Phase 1-11.2e that the research demonstrates won't have crypto-edge)
§5: RECOMMENDED NEXT PHASE 11.4+ PLUGIN PROPOSALS (ranked, with same framework
     as §3, scoped for 1-track 1:10 bybit.eu implementation)
§6: SOURCE LANGUAGE DISTRIBUTION TABLE (count of sources per language —
     proof multi-language mandate was honored)
§7: REFERENCES (≥15 sources, mixed-language, mix of exchange-blog, academic,
     practitioner-Telegram-export, GitHub repo, conference paper)
```

**Each track verifier instruction (uniform across tracks):**

```
You are TrackN-verifier for the research output at
`reports/phase11-3-track-N/report.md`.

CHECKS (binding):

1. LANGUAGE MIX: read deliverable.md §6 source-language table. Confirm ≥3 languages
   represented (Chinese/Japanese/Korean/Russian/etc). FAIL if Hungarian appears
   anywhere. PASS only if primary source set is genuinely multi-language.

2. DEPTH CHECK: count <query> tags in producer's execution log. Must be ≥15 queries.
   Read top-5 producer-cited sources, verify they actually say what producer claims
   (no citation laundering). FAIL if any cited claim cannot be cross-checked in the
   cited source.

3. CRYPTO-NATIVE CHECK: read §4 anti-patterns list. Producer must identify at least
   3 generic-quant strategies we tried in Phase 1-11.2e that this research shows
   won't have crypto-edge. FAIL if §4 is empty or hand-waves.

4. ALPHA HYPOTHESIS FEASIBILITY: read §3 alpha hypotheses. Each must include
   "applicability to 1:10 bybit.eu" verdict (MATCHES mandate, REQUIRES CAPITAL SCALE,
   REQUIRES TOKYO CO-LOC, OUTSIDE SCOPE). At least 1 hypothesis must be MATCHES
   mandate (so Phase 11.4+ has a buildable path).

5. SOURCE INDEPENDENCE: ≥2 independent sources per §3 empirical claim. Count languages.
   If all sources are English-only-translated, FAIL.

VERDICT: PASS only if all 5 checks pass. Otherwise FAIL with explicit gap list.
```

---

## Phase 11.3 expected envelope (research-only, no code yet)

**Realistic outcome targets:**
- 5 angle reports, each ~2500 words, ≥15 queries deep, multi-language
- 3-5 ranked crypto-native alpha hypotheses per angle = **15-25 total alpha candidates**
- Each candidate: 1:10 bybit.eu applicability verdict
- ≥1 candidate per angle marked MATCHES mandate → Phase 11.4+ scope plan

**NOT expecting:**
- Direct code/plugin (Phase 11.3 is research-only, Phase 11.4+ builds)
- +%/month envelope number (research output, not backtest)

**Time / cost budget:**
- Plan runtime: 4h hard cap (verifier-driven gate will close earlier if PASS)
- Per-track runtime budget: 90min producer + 30min verifier = 2h/track ceiling
- Total LLM cost estimate: 5 producers × 90min + 5 verifiers × 30min (acceptable for first crypto-native deep dive)

---

## Open decisions needed BEFORE launch

1. **Languages per track** — defaults above (A: ja+ko+zh+en, B: zh+en+ru, C: zh+en, D: ko+zh+en, E: zh+ja+en). User may revise.
2. **Depth floor** — defaults to ≥15 queries/track. User may push to ≥20.
3. **Hungarian ban** — explicit. Verify in verifier checklist.
4. **Report language** — research outputs in ENGLISH (per user profile, empirical sections). INTRO/CONCLUSION may be Hungarian narrative.
5. **Output path** — `reports/phase11-3-{track-a,b,c,d,e}/report.md` (5 reports) + `reports/phase11-3-consolidated.md` (orchestrator-side synthesis after verifier PASS).

## Why Phase 11.3 NOT Phase 12 (which is in scope plan)

`phase12-scope-plan.md` covers HFT market-making + Tokyo co-loc + options-vol — **OUTSIDE retail envelope, requires ≥$500k capital + regulatory review**. Phase 12 is parked behind capital/regulatory decisions.

Phase 11.3 is **STILL retail-viable, 1:10 bybit.eu scope**. It is a research phase within Phase 11 cascade, not a Phase 12 launch.

## Next-step contract

- Phase 11.3 launches as 5-track team plan (`plan_11_3_research.yaml` to be written).
- Cron `phase11-3-monitor` at 5min cadence, 8h TTL.
- On cycle close: orchestrator produces `reports/phase11-3-consolidated.md` ranking all 5 angles' alpha candidates by 1:10 bybit.eu applicability. User reviews + picks Phase 11.4+ plugin scope.
