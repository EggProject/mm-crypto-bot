// packages/tui/src/index.ts — a `@mm/tui` csomag programozott belépési pontja
//
// Ez a fájl a csomag `main` és `exports` mezőjében hivatkozott
// belépési pont. A fogyasztók (pl. `@mm/bot`) így érik el a TUI-t:
//
//   import { App, renderTui, SimulatedProvider, PaperProvider } from "@mm/tui";
//
// Az `index.tsx` a CLI bináris belépési pontja (a `bun run tui`
// script indítja); ez a fájl a library API-t adja.

export { App } from "./App.js";
export { renderTui } from "./render.js";
export { SimulatedProvider } from "./providers/SimulatedProvider.js";
export type { SimulatedProviderOptions } from "./providers/SimulatedProvider.js";
export { PaperProvider } from "./providers/PaperProvider.js";
export type { PaperProviderOptions } from "./providers/PaperProvider.js";
export type { BotStateProvider, Listener } from "./providers/BotStateProvider.js";

export type {
  BotState,
  KillSwitchState,
  Position,
  ProviderStatus,
  Side,
  Statistics,
  TickerPrice,
  Trade,
} from "./types.js";

export {
  colorForValue,
  formatDuration,
  formatPct,
  formatPrice,
  formatTimestamp,
  formatUsdt,
} from "./utils/format.js";
