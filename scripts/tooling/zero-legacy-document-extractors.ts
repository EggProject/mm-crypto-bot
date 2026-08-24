export type ZeroLegacyDocumentSignal = "current-doc-reference" | "served-asset";

export interface ZeroLegacyDocumentTarget {
  readonly signal: ZeroLegacyDocumentSignal;
  readonly start: number;
  readonly target: string;
}

function freezeTargets(targets: readonly ZeroLegacyDocumentTarget[]): readonly ZeroLegacyDocumentTarget[] {
  return Object.freeze(targets.map((target) => Object.freeze({ ...target })));
}

export function extractMarkdownDocumentTargets(sourceText: string): readonly ZeroLegacyDocumentTarget[] {
  const targets: ZeroLegacyDocumentTarget[] = [];
  const expression = /!?\[[^\]]*\]\(\s*(?:<[^>]+>|[^\s)]+)[^)]*\)/gu;
  for (const match of sourceText.matchAll(expression)) {
    const fullMatch = match[0];
    const destination = fullMatch.slice(fullMatch.indexOf("(") + 1, -1).trim();
    const target = destination.startsWith("<")
      ? destination.slice(1, destination.indexOf(">"))
      : destination.slice(0, Math.max(0, destination.search(/\s/u)) || destination.length);
    targets.push({
      signal: fullMatch.startsWith("!") ? "served-asset" : "current-doc-reference",
      start: match.index,
      target,
    });
  }
  return freezeTargets(targets);
}

export function extractHtmlDocumentTargets(sourceText: string): readonly ZeroLegacyDocumentTarget[] {
  const targets: ZeroLegacyDocumentTarget[] = [];
  const expression = /\b(?:src|href)\s*=\s*(?:"[^"]+"|'[^']+')/giu;
  for (const match of sourceText.matchAll(expression)) {
    const fullMatch = match[0];
    const quoteIndex = Math.max(fullMatch.indexOf('"'), fullMatch.indexOf("'"));
    targets.push({ signal: "served-asset", start: match.index, target: fullMatch.slice(quoteIndex + 1, -1) });
  }
  return freezeTargets(targets);
}
