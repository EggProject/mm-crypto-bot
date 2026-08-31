export { DEFAULT_CASCADE_FADE_CONFIG, PROVIDER_DIVERSITY_GROUPS } from "./cascade-fade-types.js";
export type {
  CascadeCrossSource,
  CascadeEntry,
  CascadeEvent,
  CascadeExit,
  CascadeFadeConfig,
  CascadeState,
  CascadeWindowInput,
  CrossConfirmationInput,
  CrossConfirmationProvider,
  ElrInput,
  FundingRateInput,
  OpenInterestInput,
  RiskSnapshotInput,
} from "./cascade-fade-types.js";
export { CascadeFadeDetector } from "./cascade-fade-detector.js";
export {
  CascadeFadeStrategy,
  replayCascadeEvent,
  simulateBybitEuPaperFill,
  syntheticBybitEuSlippageBps,
} from "./cascade-fade-paper.js";
export type { CascadeReplayObservation, CascadeReplayResult } from "./cascade-fade-paper.js";
