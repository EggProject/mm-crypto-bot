// packages/tui/src/hooks/index.ts — hook barrel export
export { useBotState } from "./useBotState.js";
// Phase 36 Track C1 — TUI settings panel TOML persistence hook.
export { useConfigStore } from "./useConfigStore.js";
export type {
  ConfigStoreError,
  UseConfigStoreOptions,
  UseConfigStoreResult,
} from "./useConfigStore.js";
// Phase 41 — terminal size hook for responsive grid layout.
export {
  useTerminalSize,
  resolveLayoutMode,
  resolveTerminalSize,
  readStdoutSize,
  createResizeHandler,
  BREAKPOINTS,
} from "./useTerminalSize.js";
export type { LayoutMode, TerminalSize } from "./useTerminalSize.js";
