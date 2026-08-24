import { extractStaticCommandTokens } from "./zero-legacy-command-parser.ts";

export interface ZeroLegacySyntaxLocatedTarget {
  readonly signal: ZeroLegacySyntaxSignal;
  readonly start: number;
  readonly target: string;
}

export type ZeroLegacySyntaxSignal = "command" | "config-reference";

export interface ZeroLegacySyntaxExtractorOptions {
  readonly error: (message: string) => never;
}

const yamlCommandKeys = new Set(["run", "uses", "command", "commands", "script", "scripts"]);
const yamlPathKeys = new Set(["config", "path", "paths", "file", "files"]);
const shellControlWords = new Set(["do", "done", "then", "else", "fi", "esac", "{", "}"]);
const shellControlPrefixes = /^(?:if|for|while|until|case|function)\b/u;
const shellControlTerminators = /(?:then|do|in|\{|\)\))\s*$/u;
const dynamicShellBuiltins = new Set(["cd", "echo", "exit", "kill", "local", "wait"]);

interface LeadingShellAssignment {
  readonly isDynamic: boolean;
  readonly end: number;
  readonly start: number;
}

function hasShellConditionPrefix(fragment: string): boolean {
  const withoutNegation = fragment.startsWith("!") ? fragment.slice(1).trimStart() : fragment;
  return (
    withoutNegation.startsWith("[[") || withoutNegation.startsWith("[") || withoutNegation.startsWith("(")
  );
}

function lineStart(lines: readonly string[], lineIndex: number): number {
  let start = 0;
  for (const line of lines.slice(0, lineIndex)) {
    start += line.length + 1;
  }
  return start;
}

function stripShellComment(line: string): string {
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < line.length; index += 1) {
    const character = line.charAt(index);
    if (character === "'" || character === '"') {
      quote = quote === undefined ? character : quote === character ? undefined : quote;
    } else if (
      character === "#" &&
      quote === undefined &&
      (index === 0 || /\s/u.test(line.charAt(index - 1)))
    ) {
      return line.slice(0, index);
    }
  }
  return line;
}

function isHarmlessShellControlFragment(fragment: string): boolean {
  const trimmed = fragment.trim();
  if (shellControlWords.has(trimmed)) {
    return true;
  }
  if (hasShellConditionPrefix(trimmed)) {
    return /(?:\]\]|\]|\))\s*$/u.test(trimmed);
  }
  return shellControlPrefixes.test(trimmed) && shellControlTerminators.test(trimmed);
}

function isHarmlessDynamicShellBuiltin(fragment: string): boolean {
  const trimmed = fragment.trim();
  const firstSpace = trimmed.indexOf(" ");
  const command = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
  return (
    dynamicShellBuiltins.has(command) &&
    trimmed.includes("$") &&
    !trimmed.includes("$REPO_ROOT/") &&
    !/[;&|]/u.test(trimmed)
  );
}

function isShellTokenBoundary(character: string): boolean {
  return (
    character.length === 0 ||
    /\s/u.test(character) ||
    character === ";" ||
    character === "|" ||
    character === "&"
  );
}

function commandSubstitutionReadEnd(
  fragment: string,
  start: number,
  options: ZeroLegacySyntaxExtractorOptions,
): number {
  const targetStart = start + 3;
  const end = fragment.indexOf(")", targetStart);
  if (end === -1) {
    options.error("unterminated shell command-substitution read");
  }
  const target = fragment.slice(targetStart, end);
  if (!/^[A-Za-z0-9_./-]+$/u.test(target)) {
    options.error("unsupported shell command-substitution read target");
  }
  return end + 1;
}

function leadingCommandSubstitutionReadEnd(
  fragment: string,
  options: ZeroLegacySyntaxExtractorOptions,
): number | undefined {
  let start = 0;
  while (start < fragment.length && /\s/u.test(fragment.charAt(start))) {
    start += 1;
  }
  return fragment.startsWith("$(<", start) ? commandSubstitutionReadEnd(fragment, start, options) : undefined;
}

function readLeadingShellAssignment(
  fragment: string,
  start: number,
  options: ZeroLegacySyntaxExtractorOptions,
): LeadingShellAssignment | undefined {
  let index = start;
  while (index < fragment.length && /\s/u.test(fragment.charAt(index))) {
    index += 1;
  }
  let tokenEnd = index;
  while (tokenEnd < fragment.length && !isShellTokenBoundary(fragment.charAt(tokenEnd))) {
    tokenEnd += 1;
  }
  const equalsIndex = fragment.indexOf("=", index);
  if (equalsIndex === -1 || equalsIndex >= tokenEnd) {
    return undefined;
  }
  const name = fragment.slice(index, equalsIndex);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) {
    options.error("invalid leading shell assignment grammar");
  }
  let quote: "'" | '"' | undefined;
  let isDynamic = false;
  index = equalsIndex + 1;
  while (index < fragment.length) {
    const character = fragment.charAt(index);
    if (character === "`" || (character === "\\" && quote !== "'")) {
      options.error("dynamic or escaped leading shell assignment syntax is unsupported");
    }
    if (character === "'" || character === '"') {
      quote = quote === undefined ? character : quote === character ? undefined : quote;
    } else if (character === "$") {
      isDynamic = true;
      if (fragment.charAt(index + 1) === "(") {
        if (!fragment.startsWith("$(<", index)) {
          options.error("unsupported shell command-substitution grammar");
        }
        index = commandSubstitutionReadEnd(fragment, index, options);
        continue;
      }
    } else if (quote === undefined && isShellTokenBoundary(character)) {
      break;
    }
    index += 1;
  }
  if (quote !== undefined) {
    options.error("unterminated leading shell assignment quote");
  }
  return { isDynamic, end: index, start };
}

function leadingShellAssignments(
  fragment: string,
  options: ZeroLegacySyntaxExtractorOptions,
): readonly LeadingShellAssignment[] {
  const assignments: LeadingShellAssignment[] = [];
  let index = 0;
  for (;;) {
    const assignment = readLeadingShellAssignment(fragment, index, options);
    if (assignment === undefined) {
      break;
    }
    assignments.push(assignment);
    index = assignment.end;
  }
  return Object.freeze(assignments.map((assignment) => Object.freeze({ ...assignment })));
}

function commandSyntaxTargets(
  sourceText: string,
  start: number,
  options: ZeroLegacySyntaxExtractorOptions,
): readonly ZeroLegacySyntaxLocatedTarget[] {
  return extractStaticCommandTokens(sourceText, start, {
    allowRepositoryRootVariable: true,
    error: options.error,
  }).map((target) => ({ signal: "command", ...target }));
}

function shellFragmentTargets(
  fragment: string,
  start: number,
  options: ZeroLegacySyntaxExtractorOptions,
): readonly ZeroLegacySyntaxLocatedTarget[] {
  const substitutionReadEnd = leadingCommandSubstitutionReadEnd(fragment, options);
  if (substitutionReadEnd !== undefined) {
    if (!isShellTokenBoundary(fragment.charAt(substitutionReadEnd))) {
      options.error("shell command-substitution read requires a command boundary");
    }
    return fragment.slice(substitutionReadEnd).trim().length === 0
      ? Object.freeze([])
      : shellFragmentTargets(fragment.slice(substitutionReadEnd), start + substitutionReadEnd, options);
  }
  if (isHarmlessShellControlFragment(fragment)) {
    return Object.freeze([]);
  }
  if (isHarmlessDynamicShellBuiltin(fragment)) {
    return Object.freeze([]);
  }
  if (shellControlPrefixes.test(fragment.trimStart()) || hasShellConditionPrefix(fragment.trimStart())) {
    options.error("shell control fragment with a possible command tail is unsupported");
  }
  const assignments = leadingShellAssignments(fragment, options);
  if (assignments.length === 0) {
    const values = commandSyntaxTargets(fragment, start, options);
    const first = values[0]?.target;
    if (first !== undefined && shellControlWords.has(first)) {
      options.error("shell control fragment with a command tail is unsupported");
    }
    return values;
  }
  const commandStart = assignments.at(-1)?.end;
  if (commandStart === undefined || fragment.slice(commandStart).trim().length === 0) {
    return Object.freeze([]);
  }
  if (assignments.every((assignment) => !assignment.isDynamic)) {
    return commandSyntaxTargets(fragment, start, options);
  }
  const values: ZeroLegacySyntaxLocatedTarget[] = [];
  for (const assignment of assignments) {
    if (!assignment.isDynamic) {
      values.push(
        ...commandSyntaxTargets(
          fragment.slice(assignment.start, assignment.end),
          start + assignment.start,
          options,
        ),
      );
    }
  }
  values.push(...commandSyntaxTargets(fragment.slice(commandStart), start + commandStart, options));
  return Object.freeze(values);
}

export function extractShellSyntaxTargets(
  sourceText: string,
  options: ZeroLegacySyntaxExtractorOptions,
): readonly ZeroLegacySyntaxLocatedTarget[] {
  const targets: ZeroLegacySyntaxLocatedTarget[] = [];
  const lines = sourceText.split("\n");
  for (const [lineIndex, rawLine] of lines.entries()) {
    const sourceLine = stripShellComment(rawLine);
    if (sourceLine.trim().length === 0 || sourceLine.trimStart().startsWith("#")) {
      continue;
    }
    const lineTargets = shellFragmentTargets(sourceLine, lineStart(lines, lineIndex), options);
    for (const target of lineTargets) {
      targets.push(target);
    }
  }
  return Object.freeze(targets.map((target) => Object.freeze({ ...target })));
}

interface ParsedYamlMapping {
  readonly key: string;
  readonly value?: string;
}

function parseYamlMapping(content: string): ParsedYamlMapping | undefined {
  const colonIndex = content.indexOf(":");
  if (colonIndex === -1) {
    return undefined;
  }
  const key = content.slice(0, colonIndex);
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/u.test(key)) {
    return undefined;
  }
  const remainder = content.slice(colonIndex + 1);
  return remainder.length === 0
    ? { key }
    : remainder.startsWith(" ")
      ? { key, value: remainder.trimStart() }
      : undefined;
}

function yamlIndentation(line: string, options: ZeroLegacySyntaxExtractorOptions): number {
  if (line.includes("\t")) {
    options.error("tab-indented YAML is unsupported");
  }
  return line.length - line.trimStart().length;
}

function yamlScalar(value: string, options: ZeroLegacySyntaxExtractorOptions): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    options.error("empty YAML command or path value is ambiguous");
  }
  if (trimmed === "|" || trimmed === ">") {
    options.error("YAML block scalar command or path values are unsupported");
  }
  if (trimmed.startsWith("[") || trimmed.endsWith("]")) {
    options.error("flow-style YAML sequences are unsupported");
  }
  if (trimmed.startsWith("{") || trimmed.includes("${{") || trimmed.includes("&") || trimmed.includes("*")) {
    options.error("dynamic YAML value is unsupported");
  }
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith("'") || trimmed.startsWith('"')) {
    options.error("unterminated YAML quote");
  }
  return trimmed;
}

function yamlEntryTargets(
  key: string,
  value: string,
  start: number,
  options: ZeroLegacySyntaxExtractorOptions,
): readonly ZeroLegacySyntaxLocatedTarget[] {
  const scalar = yamlScalar(value, options);
  if (yamlCommandKeys.has(key)) {
    return extractStaticCommandTokens(scalar, start, {
      allowRepositoryRootVariable: false,
      error: options.error,
    }).map((target) => ({ signal: "command", ...target }));
  }
  return Object.freeze([{ signal: "config-reference", start, target: scalar }]);
}

export function extractYamlSyntaxTargets(
  sourceText: string,
  options: ZeroLegacySyntaxExtractorOptions,
): readonly ZeroLegacySyntaxLocatedTarget[] {
  const targets: ZeroLegacySyntaxLocatedTarget[] = [];
  const activeKeys: { indent: number; key: string }[] = [];
  const lines = sourceText.split("\n");
  for (const [lineIndex, rawLine] of lines.entries()) {
    if (rawLine.trim().length === 0 || rawLine.trimStart().startsWith("#")) {
      continue;
    }
    const indent = yamlIndentation(rawLine, options);
    const content = rawLine.trimStart();
    const isMappingSequence = content.startsWith("- ");
    const mappingContent = isMappingSequence ? content.slice(2) : content;
    let retainedActiveKeyCount = 0;
    for (const [index, activeKey] of activeKeys.entries()) {
      if (activeKey.indent < indent) {
        retainedActiveKeyCount = index + 1;
      }
    }
    activeKeys.splice(retainedActiveKeyCount);
    const sequence = content.startsWith("- ") ? content.slice(2) : undefined;
    const mapping = parseYamlMapping(mappingContent);
    const parentKey = activeKeys.at(-1)?.key;
    const start = lineStart(lines, lineIndex) + indent;
    if (
      sequence !== undefined &&
      parentKey !== undefined &&
      (yamlCommandKeys.has(parentKey) || yamlPathKeys.has(parentKey))
    ) {
      targets.push(...yamlEntryTargets(parentKey, sequence, start + 2, options));
      continue;
    }
    if (mapping === undefined) {
      if (parentKey !== undefined && (yamlCommandKeys.has(parentKey) || yamlPathKeys.has(parentKey))) {
        options.error("unsupported YAML command or path grammar");
      }
      continue;
    }
    const { key, value } = mapping;
    if (value === undefined) {
      activeKeys.push({ indent, key });
      continue;
    }
    if (yamlCommandKeys.has(key) || yamlPathKeys.has(key)) {
      targets.push(...yamlEntryTargets(key, value, start + content.indexOf(value), options));
    }
  }
  return Object.freeze(targets.map((target) => Object.freeze({ ...target })));
}
