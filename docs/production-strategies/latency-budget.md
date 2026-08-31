# Paper-mode latency budget

## Safety boundary

This document is a measurement and design reference for the current paper
mode only. It does not authorize capital deployment, live activation, account
configuration, or credential use. The paper template may receive public Bybit
EU market data; order execution remains emulated.

Any future live capability remains unavailable until its independent safety,
coverage, dependency-integrity, and review gates have fresh passing evidence.
The planning values below are not evidence that those gates pass.

## Current transport design

Public market data is WebSocket-first where the `bybiteu` adapter supports it.
The current order path is REST `ccxt.createOrder()`, and authoritative order
and account reconciliation also uses REST exchange records. WebSocket
order/action submission is future work, not a current transport path.

The adapter owns fixed official Bybit EU service selection. Sandbox/testnet and
manual REST or WebSocket endpoint overrides are unsupported.

## Planning budget

The following are paper-mode planning targets, expressed in milliseconds. They
are not measured exchange-service facts and must not be used to infer a host,
network route, fill time, or execution quality.

| Hop | Paper-mode path                       | Planning p50 | Planning p95 | Planning p99 |
| --- | ------------------------------------- | -----------: | -----------: | -----------: |
| 1   | Public market-data update to strategy |          0.1 |          0.3 |            1 |
| 2   | Strategy decision to risk evaluation  |          0.2 |          0.5 |            1 |
| 3   | Risk evaluation to emulated order     |          0.5 |            1 |            2 |
| 4   | Emulated order lifecycle processing   |            1 |            3 |            8 |
| 5   | Emulated fill processing              |            1 |            3 |            6 |
| 6   | State persistence                     |          0.5 |            1 |            3 |

The total median planning budget is approximately 3.3 ms; the summed p99
planning budget is approximately 21 ms. These are budgeting aids only, not
release criteria.

## Measurement record

For a paper-mode experiment, record the following in structured, redacted
telemetry:

- public feed freshness, reconnect count, and message sequencing;
- strategy and risk evaluation durations;
- emulated order lifecycle duration; and
- state-persistence latency and failed writes.

Treat a missing, stale, or out-of-sequence feed as a paper-mode test failure.
Do not work around it with an endpoint override. Fix or diagnose the adapter,
network, TLS, DNS, or local runtime condition within the supported fixed-service
boundary.

## Future work boundary

Any WebSocket order/action implementation requires a separately designed,
tested, and independently reviewed change. This document neither specifies nor
approves that work.
