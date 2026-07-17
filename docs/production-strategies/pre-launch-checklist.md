# mm-crypto-bot — Pre-launch checklist (LIVE deployment)

> **Phase 37 Track 5** — the one-pager you tick through before
> flipping `bot.mode = "live"`.
>
> Use this for ANY live deployment. The Tokyo co-loc profile is the
> recommended target (matches the `run-bot/config/live-tokyo.toml`
> template); the home-broadband profile is paper-mode-only and is
> flagged inline.

---

## 0. Five-second summary

```text
□ Section 1 — Profile:    Tokyo co-loc?  Home broadband (paper-only)?
□ Section 2 — Config:     live-tokyo.toml loaded?  Compliance flags set?
□ Section 3 — Secrets:    BYBIT_API_KEY + BYBIT_API_SECRET in env?
□ Section 4 — Risk:       1:10 leverage, 15% DD, 1% per-trade, max 3 pos?
□ Section 5 — Kill-swtch: dry-run prints "WOULD TRIGGER" only on real breach?
□ Section 6 — Latency:    p99 hop-4 under budget?  TLS resumption works?
□ Section 7 — Smoke:      paper 24h clean?  live-tokyo.toml parses?
□ Section 8 — Flip:       mode = "live" in the config?  Backup taken?
```

When **all 8 sections** are checked, you may flip the `mode`.

---

## 1. Deployment profile

Pick **ONE**:

- [ ] **Profile A — Tokyo co-location** (Equinix TY11, same DC as
      Bybit matching engine). This is the Phase 37 Track 5 target.
      Reference: `run-bot/config/live-tokyo.toml`.

- [ ] **Profile B — Home broadband** (Budapest / SE-Europe residential).
      ⛔ **PAPER MODE ONLY.** Latency budget is ~30× worse than
      Profile A (92 ms p50 hop-4 vs 1 ms; see
      `docs/production-strategies/latency-budget.md` §4).
      If you are in `mode = "live"` and ticked this row, you have a
      **BLOCKING ISSUE** — stop and switch to Profile A or revert to
      `mode = "paper"`.

Profile A is checked?  → continue to §2.
Profile B is checked? → skip to §9 (paper-only path).

---

## 2. Config — `live-tokyo.toml`

- [ ] `run-bot/config/live-tokyo.toml` is the base. The user copy
      lives at `~/.mm-bot/live-tokyo.toml` (NEVER commit secrets to
      the repo).

- [ ] `[bot].mode` is **still `"paper"`** in the template — you
      flip it to `"live"` AFTER this checklist. The `mode = "live"`
      row in the actual file is the FINAL step, after everything
      else is verified.

- [ ] `[exchange].endpoint = "https://api.bybit.jp"` is set
      (NOT the bybit.eu default).

- [ ] `[exchange].ws_endpoint = "wss://stream.bybit.jp"` is set.

- [ ] `[exchange].timeout_ms = 5000` (lowered from 10 000 default).

- [ ] `[exchange].rate_limit_ms = 80` (lowered from 100 default).

- [ ] `[exchange].slippage_pct = 0.03` (lowered from 0.05 default).

- [ ] `[exchange].fee_tier = "vip"` (bybit.jp VIP tier).

- [ ] `[compliance].jurisdiction = "JP"`.

- [ ] `[compliance].jp_msb_registered` matches the user's actual
      JP FSA registration status. **DEFAULT IS `false`** — this is
      an explicit OFF-flag, not a default-on.

      ⛔ If the user does NOT have a JP FSA MSB registration and
      is still running `mode = "live"` in JP, they are operating
      OUTSIDE the regulatory framework. The bot does NOT enforce
      this — the user accepts ALL regulatory risk.

Validate: `mm-bot config validate --config=~/.mm-bot/live-tokyo.toml`
should print `OK`. If it prints `FAILED`, the config has a
Zod-rejected field; fix and re-run.

---

## 3. Secrets — env vars

- [ ] `BYBIT_API_KEY` is set in the env (NOT in the TOML, NOT in
      the git history). The bot reads it from `process.env` at
      `createExchangeClient` time.

- [ ] `BYBIT_API_SECRET` is set in the env (same rule).

- [ ] The API key has **read + trade** permission, but **WITHOUT
      withdrawal** permission. A compromised key can trade but
      cannot drain the wallet. (Phase 14B §"API key hardening"
      user mandate.)

- [ ] The API key's IP whitelist includes the bot's host (the
      Tokyo VPS's static IP). Bybit supports IP whitelisting per
      key.

- [ ] `BUN_ENV` is **NOT** set to `"live"` in the env. The user
      flips the mode in the TOML (`bot.mode = "live"`), not in
      the env. Setting both is a footgun.

- [ ] `LOG_LEVEL=info` is acceptable; `LOG_LEVEL=debug` is fine
      for the first 24h of live trading but burns disk I/O.

Verify: `env | grep -E "^(BYBIT_|BUN_ENV|LOG_LEVEL)"` should
print only the 4 keys above (or fewer if you don't want all of
them).

---

## 4. Risk parameters

These are the Phase 14B user mandate values. Do **NOT** relax
them without re-reading `docs/research/phase14b-scope.md` and
the user mandate.

- [ ] `[risk].max_leverage = 10` (1:10 MANDATE — Zod enforces
      `≤ 10`, but you should still confirm you didn't typo it
      to 7 or 8 by accident).

- [ ] `[risk].max_drawdown_pct = 0.15` (15% DD kill-switch).

- [ ] `[risk].risk_per_trade = 0.01` (1% per trade).

- [ ] `[risk].max_positions = 3` (BTC/ETH/SOL — 1 each).

- [ ] `[risk].kelly_fraction = 0.25` (1/4-Kelly; default and
      Phase 14B user mandate).

- [ ] `[portfolio].total_risk_per_cycle_usd = 100` (Phase 37
      Track 4 portfolio coordination cap).

- [ ] `[portfolio].max_dd_pct = 0.10` (10% portfolio-DD
      circuit-breaker; per the Phase 31 audit envelope).

- [ ] `mm-bot strategies` shows the 5 strategies with
      `enabled = true` for donchian_pivot_composition,
      dydx_cex_carry, cascade_fade; `enabled = false` for
      funding_flip_kill_switch and regime_detector (unless you
      have a specific reason to flip them).

---

## 5. Kill-switch dry-run

This is the **NEW** Phase 37 Track 5 verification step.
Before this PR, there was no safe way to preview a kill-switch
trigger without actually triggering it.

- [ ] `mm-bot kill-switch-dry-run --config=~/.mm-bot/live-tokyo.toml`
      runs and exits 0. (If it exits 1, the state file is missing
      or the config is invalid — fix that first.)

- [ ] The output's verdict is `NO AUTO-TRIGGER` (green). If it
      says `WOULD TRIGGER` (red), the simulated kill-switch
      WOULD fire on the current state. Investigate WHY before
      flipping to live.

- [ ] The "Would-be closures" table matches what you expect
      (e.g. if you have 0 positions, the table is empty).

- [ ] The "Telegram alert preview" looks like the message you
      want to receive on your phone at 3 AM. If the format is
      not what your on-call rotation expects, fix the
      `formatTelegramAlert` helper in
      `apps/bot/src/cli/commands/kill-switch-dry-run.ts` and
      re-run.

- [ ] The "JSON log lines" preview contains the structured
      fields you want in your log aggregator (Datadog, Splunk,
      Loki, etc.).

- [ ] Repeat the dry-run in `--json` mode and pipe the output
      into your alerting pipeline (optional but recommended
      for the first week of live trading):
      `mm-bot kill-switch-dry-run --json --config=... | jq .`

---

## 6. Latency budget verification

Reference: `docs/production-strategies/latency-budget.md` §3.

- [ ] **Network RTT to exchange** is within budget:
      `ping -c 100 api.bybit.jp` → p50 < 5 ms (Profile A, TY11),
      p99 < 20 ms. Profile A only. Profile B blocks here.

- [ ] **TLS session resumption** works:
      `openssl s_client -reconnect -connect api.bybit.jp:443` →
      second connection's "Reused" line is `TLS session tick:
      ...` (i.e. NOT a fresh handshake).

- [ ] **WebSocket RTT** is sub-millisecond:
      `wscat -c wss://stream.bybit.jp -x 'ping'` should print
      a `pong` frame within 5 ms (Profile A) or 200 ms
      (Profile B).

- [ ] **No DNS resolver penalty**: `dig api.bybit.jp` resolves
      in < 50 ms. (Profile B may have a slow ISP DNS — switch
      to `1.1.1.1` or `8.8.8.8` in `/etc/resolv.conf`.)

- [ ] **The bot's first 100 order submissions** complete in
      under `[exchange].timeout_ms = 5000`. Watch the
      `mm-bot status` "placed" counter — if any order
      crosses the timeout, the pre-place check is too tight
      or the network is congested.

- [ ] **No GC pauses** on the bot host: run the bot for
      10 minutes under `bun --smol` or `node --max-old-space-size=...`
      and check `dmesg` / `journalctl` for OOM events. Profile A
      should have ZERO GC events; Profile B may have 1-2
      during the first 10 min (cold-start JIT warmup).

---

## 7. Smoke test

- [ ] **24 hours of paper-mode clean run** on the
      `live-tokyo.toml` config (NOT the default.toml). The
      `mm-bot status` counters should show non-zero
      `placed` + `filled` for each enabled strategy.

- [ ] **No kill-switch triggered** in the 24h paper run. If
      the kill-switch fired, the strategy or risk params are
      wrong — go back to §4.

- [ ] **No `rejected` orders** in the state file. A non-zero
      `counters.rejected` means an exchange-side rejection
      (e.g. min notional, leverage cap, IP block). Read
      `logs/bot/*.log` for the rejection reason.

- [ ] **The Tokyo config parses** on the actual bot host:
      `mm-bot config show --config=~/.mm-bot/live-tokyo.toml`
      should print all 7 sections (`bot`, `exchange`, `compliance`,
      `risk`, `symbols`, `strategies`, `telemetry`, `portfolio`).

- [ ] **The state file is writable** at the path in
      `[bot].state_file`. Run `touch $(mm-bot status | grep
      "State file" | awk '{print $3}')` and verify no permission
      error.

---

## 8. FLIP — `mode = "live"`

This is the **last** step. Do everything else first.

- [ ] **Backup the paper state file** before the flip:
      `cp data/bot-state.json data/bot-state.json.paper-backup.$(date +%Y%m%d)`

- [ ] **Backup the live-tokyo.toml** before editing it:
      `cp ~/.mm-bot/live-tokyo.toml ~/.mm-bot/live-tokyo.toml.$(date +%Y%m%d).bak`

- [ ] **Edit `~/.mm-bot/live-tokyo.toml`** and change
      `[bot].mode` from `"paper"` to `"live"`.

- [ ] **Restart the bot** (do NOT hot-flip; the running Bot
      has the old mode cached). `systemctl restart mm-bot` or
      re-run `mm-bot start --config=...`.

- [ ] **First 60 seconds**: Watch `mm-bot status`. The mode
      line should be **red** (live, real money) — this is the
      Phase 34 Track C color convention.

- [ ] **First 10 minutes**: Watch the `placed` / `filled`
      counters. At least ONE order should be submitted by each
      enabled strategy (or the strategy has no signal in the
      current market regime — that's also OK, just log it).

- [ ] **First hour**: Watch for the first kill-switch dry-run
      (if you wired it to a cron). The output should match
      step §5.

- [ ] **First day**: A human should check `mm-bot status` at
      least 4×. After 24h, the state file should have ≥ 10
      `closedTrades` and a non-zero `realizedPnlUsd` (either
      sign is OK — flat P&L after 24h is the worst case,
      and even that is fine for the first 24h).

- [ ] **Telegram alert channel** (if configured) received
      the bot's startup notification. The message should
      include the live mode, the config path, and the kill-
      switch state.

- [ ] **You have the operator's phone number on the Telegram
      alert channel** (i.e. YOU get paged, not just the bot
      itself).

If any of these checks FAIL after the flip, revert
`[bot].mode = "paper"` immediately and re-run from §7.

---

## 9. Paper-only quick path (Profile B)

If you are running **paper mode from home broadband** (the
common case during development / strategy-research):

- [ ] `[bot].mode = "paper"` — leave it as is. Do NOT flip
      to `live` until you've migrated to Profile A.

- [ ] `[exchange].endpoint` and `[exchange].ws_endpoint` may
      be left undefined (CCXT default bybit.eu) — paper mode
      doesn't care about the endpoint.

- [ ] `[compliance].jurisdiction = "EU"` is the default — you
      don't need to set JP. (The `compliance` block is purely
      informational; the bot does NOT enforce compliance
      checks in either mode.)

- [ ] The kill-switch dry-run is still useful in paper mode:
      run it once to see what the verdict would be when you
      do flip to live. The output is the same regardless of
      `mode`.

That's it for paper mode. You do not need §6 (latency) or
§8 (flip) — the bot is not placing real orders.

---

## 10. After the flip — ongoing monitoring

- [ ] **Daily**: Check `mm-bot status` once per day. The
      `realizedPnlUsd` should be tracked in a spreadsheet
      (or a Grafana dashboard if you have one).

- [ ] **Weekly**: Re-run `mm-bot kill-switch-dry-run` to
      verify the kill-switch verdict still matches the
      state. If the verdict changed unexpectedly, the
      strategy may have a latent bug.

- [ ] **Monthly**: Re-read
      `docs/production-strategies/latency-budget.md` and
      re-run the §6 latency checks. Bybit's routing can
      change, and your p99 may have drifted.

- [ ] **On every Bybit maintenance window** (announced via
      their status page): Stop the bot, wait for the
      window to close, then re-run the dry-run, then
      restart the bot.

- [ ] **On any unexpected loss > 1%**: Run
      `mm-bot kill-switch-dry-run` immediately. If the
      verdict is `WOULD TRIGGER`, the next loss is the
      kill-switch firing automatically; if the verdict is
      `NO AUTO-TRIGGER`, the loss came from a different
      path (e.g. a strategy bug) and needs investigation.

---

## 11. Roll-back procedure

If you need to revert from `live` to `paper`:

1. **Stop the bot**: `systemctl stop mm-bot` (or kill the
   TUI process).

2. **Edit the config**: change `[bot].mode = "paper"`.

3. **Restore the paper backup** (if the live trading
   corrupted the state file):
   `cp data/bot-state.json.paper-backup.<date> data/bot-state.json`.

4. **Restart in paper**: `mm-bot start --config=...`.

5. **Run the dry-run** to confirm the state is sane:
   `mm-bot kill-switch-dry-run --config=...`.

6. **Investigate WHY** you needed to roll back before
   re-attempting the live flip. The most common cause is a
   misconfigured `[risk].max_leverage` (set to 10 but the
   per-strategy `leverage` override is 20 — the schema
   blocks it at load time, but a hand-edited config could
   slip past).

---

## 12. References

- **Latency budget**:
  `docs/production-strategies/latency-budget.md` — the 6-hop
  breakdown, profile A vs B, and per-hop troubleshooting.
- **Tokyo config template**:
  `run-bot/config/live-tokyo.toml` — the immediately-runnable
  production config.
- **Tokyo config decisions** (with sources):
  `run-bot/config/live-tokyo.toml` — explains every
  Tokyo-override and cites the underlying docs. (The historical
  `apps/bot/config/live-tokyo.example.toml` was merged into the
  canonical template during Phase 52D.)
- **Kill-switch dry-run source**:
  `apps/bot/src/cli/commands/kill-switch-dry-run.ts` — the
  simulation logic; the `formatTelegramAlert` and
  `formatJsonLogLines` helpers are the source of truth for
  the alert format you receive on the phone.
- **Phase 14B risk mandate**:
  `docs/research/phase14b-scope.md` — the 1:10 leverage,
  15% DD, 1% per-trade, 1/4-Kelly parameters.
- **Phase 31 portfolio audit envelope**:
  `docs/audits/phase31-portfolio-audit.md` — the 10% portfolio
  DD circuit-breaker.
- **Phase 37 Track 4 portfolio coordination**:
  `[portfolio]` section in the config; RiskBudgetAllocator.

---

*Phase 37 Track 5 — last updated 2026-07-15. Pin a copy of
this checklist in your runbook before the first live flip.*
