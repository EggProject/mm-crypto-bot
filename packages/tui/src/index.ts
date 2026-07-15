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
export type { AppProps } from "./App.js";
export { renderTui, renderTuiWithCallbacks } from "./render.js";
export { SimulatedProvider } from "./providers/SimulatedProvider.js";
export type { SimulatedProviderOptions } from "./providers/SimulatedProvider.js";
export { PaperProvider } from "./providers/PaperProvider.js";
export type { PaperProviderOptions } from "./providers/PaperProvider.js";
export type { BotStateProvider, Listener } from "./providers/BotStateProvider.js";

export type {
  BotState,
  FocusedPanel,
  HistorySortKey,
  KillSwitchState,
  Position,
  ProviderStatus,
  Side,
  Statistics,
  TickerEvent,
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

// Phase 36 Track C1 — a TUI settings panel persistence hook.
export {
  useConfigStore,
  parseToml,
  stringifyToml,
  writeFileAtomic,
  type ConfigStoreError,
  type UseConfigStoreOptions,
  type UseConfigStoreResult,
} from "./hooks/useConfigStore.js";
