export {
  buildClosures,
  isKillSwitchWouldTriggered as computeWouldTrigger,
  loadState,
  type SimulatedPositionClosure,
} from "./kill-switch-dry-run-state.js";
export {
  buildReport,
  formatJsonLogLines,
  formatTelegramAlert,
  printHumanReadable,
  printJson,
  type DryRunReport,
} from "./kill-switch-dry-run-report.js";
export { createKillSwitchDryRunCommand, killSwitchDryRunCommand } from "./kill-switch-dry-run-command.js";
