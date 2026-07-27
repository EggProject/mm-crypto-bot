# Live trading

A bot **alapértelmezetten paper módban** fut (mock feed, nincs valódi pénz). A live módba váltás operator workflow-t igényel (config + bybit.eu API key + paper-test időszak + manuális promote). A teljes 5 lépéses workflow: [`apps/bot/README.md` §7](../apps/bot/README.md#7-live-testing-workflow-manual).

A `BYBIT_API_KEY` / `BYBIT_API_SECRET` env var-ok a `.env` fájlból töltődnek (`.env.example` a séma). A bot `mode = "live"` esetén figyelmeztet, ha a key hiányzik.
