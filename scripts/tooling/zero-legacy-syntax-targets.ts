import type { ZeroLegacySignal } from "./zero-legacy-contract.ts";
import type {
  ZeroLegacySyntaxExtractorOptions,
  ZeroLegacySyntaxLocatedTarget,
} from "./zero-legacy-shell-yaml-extractors.ts";

export type ZeroLegacySyntaxTargetExtractor = (
  sourceText: string,
  options: ZeroLegacySyntaxExtractorOptions,
) => readonly ZeroLegacySyntaxLocatedTarget[];

export type ZeroLegacySyntaxTargetAppender = (
  signal: ZeroLegacySignal,
  target: ZeroLegacySyntaxLocatedTarget,
) => void;

export function appendZeroLegacySyntaxEntries(
  sourceText: string,
  error: ZeroLegacySyntaxExtractorOptions["error"],
  extractor: ZeroLegacySyntaxTargetExtractor,
  appendTarget: ZeroLegacySyntaxTargetAppender,
): void {
  const targets = extractor(sourceText, { error });
  for (const target of targets) {
    appendTarget(target.signal, target);
  }
}
