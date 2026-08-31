# Live trading is currently unavailable

The current repository does not authorize live activation, capital deployment,
credential configuration, or real exchange orders. The supported runtime mode
is the built-in paper/emulated mode, which may use public Bybit EU market data
through the WebSocket-first adapter feed.

Live capability remains hard-blocked before credentials, client construction,
or network activity. This file is a safety boundary, not an operator workflow.

Any future reconsideration must first have fresh evidence for all of the
following blockers:

- independent technical and process reviews;
- complete relevant coverage and validation evidence;
- CCXT dependency-integrity evidence;
- verified Bybit EU account, pair, and borrow eligibility; and
- exact fixed 10x selected-leverage and launch-baseline safeguards.

Passing some of these blockers is not permission to activate live trading. A
separate reviewed decision and implementation would be required.
