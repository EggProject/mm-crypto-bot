/**
 * apps/bot/src/config/defaults.ts
 *
 * A `BotConfig` default-értékei — a `BotConfigSchema`-ból Zod `.parse({})`
 * segítségével kinyerve. Ez biztosítja, hogy a defaultok MINDIG
 * konzisztensek legyenek a sémával (single source of truth).
 *
 * A `loader.ts` ezt használja alapnak, és a felhasználó által megadott
 * TOML-ből jövő értékekkel merge-eli (file overrides defaults).
 */

import type { BotConfig } from "./schema.js";
import { BotConfigSchema } from "./schema.js";

/**
 * `DEFAULT_BOT_CONFIG` — a teljes bot-config Zod-validált default-értéke.
 *
 * A `BotConfigSchema.parse({})` minden szekció `.default({})` mezőjét
 * feloldja — így a visszatérési érték az összes szekció minden mezőjét
 * tartalmazza a sémában deklarált defaultokkal.
 *
 * FONTOS: NE módosítsd kézzel — a default a séma része. Ha új mezőt
 * vezetsz be, frissítsd a `BotConfigSchema`-t és a default értéke
 * automatikusan követi.
 */
export const DEFAULT_BOT_CONFIG: BotConfig = BotConfigSchema.parse({});
