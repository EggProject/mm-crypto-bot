// packages/tui/src/hooks/useBotState.ts — React hook a state-előfizetéshez
//
// Ez a hook a `BotStateProvider`-re subscribe-ol, és a React
// re-render mechanizmusán keresztül biztosítja, hogy a TUI a
// legfrissebb state-et mutassa. Az `useSyncExternalStore` React 18+
// hook-ot használjuk.
//
// Megjegyzés: a `useSyncExternalStore` harmadik argumentuma a
// `getServerSnapshot` — ezt kizárólag SSR / hydration során hívná
// a React (lásd React forráskód: `mountSyncExternalStore` /
// `updateSyncExternalStore` — `if (isHydrating)` ág). A TUI egy
// kliens-oldali CLI alkalmazás, sosem megy át hydration-ön, ezért
// a harmadik argumentum dead code lenne. A React `useSyncExternalStore`
// a harmadik argumentum hiányában is helyesen működik — a
// `getSnapshot`-ot használja mindkét esetben.

import { useSyncExternalStore } from "react";
import type { BotState } from "../types.js";
import type { BotStateProvider } from "../providers/BotStateProvider.js";

/**
 `useBotState` — a TUI fő state-hookja.
 Visszaadja a provider aktuális state-pillanatképét, és
 automatikusan újrarendereli a komponenst, amikor a state
 változik.
*/
export function useBotState(provider: BotStateProvider): BotState {
  return useSyncExternalStore(
    (onStoreChange) => provider.subscribe(onStoreChange),
    () => provider.getSnapshot(),
  );
}
