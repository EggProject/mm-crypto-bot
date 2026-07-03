// packages/tui/src/providers/index.ts — a provider-ek barrel exportja
//
// A TUI-ból a provider-ek így érhetők el:
//   import { SimulatedProvider, PaperProvider } from "@mm/tui/providers";
//
// Az `index.ts` a csomag fő belépési pontja, és ez a fájl a belső
// provider-modulok újra-exportja.

export { SimulatedProvider } from "./SimulatedProvider.js";
export type { SimulatedProviderOptions } from "./SimulatedProvider.js";

export { PaperProvider } from "./PaperProvider.js";
export type { PaperProviderOptions } from "./PaperProvider.js";

export type {
  BotStateProvider,
  Listener,
} from "./BotStateProvider.js";
export {
  emptyBotState,
  emptyStatistics,
  emptyStatus,
} from "./BotStateProvider.js";
