export interface ZeroLegacyLocatedToken {
  readonly start: number;
  readonly target: string;
}

export interface ZeroLegacyCommandParserOptions {
  readonly allowRepositoryRootVariable: boolean;
  readonly error: (message: string) => never;
}

interface ParsedToken {
  readonly start: number;
  readonly text: string;
}

const whitespace = /\s/u;
const shellOperators = new Set([";", "|", "&"]);

function isAssignment(token: string): boolean {
  const equalsIndex = token.indexOf("=");
  return equalsIndex > 0 && /^[A-Za-z_][A-Za-z0-9_]*$/u.test(token.slice(0, equalsIndex));
}

function assignmentTarget(token: ParsedToken): ZeroLegacyLocatedToken | undefined {
  const equalsIndex = token.text.indexOf("=");
  const hasConfigName = ["--config", "--path", "--file"].some((name) => token.text.startsWith(`${name}=`));
  if (!hasConfigName && !isAssignment(token.text)) {
    return undefined;
  }
  const target = token.text.slice(equalsIndex + 1);
  return target.length === 0 ? undefined : { start: token.start + equalsIndex + 1, target };
}

function isRedirection(token: string): boolean {
  let index = 0;
  while (index < token.length && token.charAt(index) >= "0" && token.charAt(index) <= "9") {
    index += 1;
  }
  const operator = token.slice(index, index + 2);
  return (
    operator === ">>" ||
    operator === "<<" ||
    operator === ">&" ||
    operator === "<&" ||
    token.charAt(index) === ">" ||
    token.charAt(index) === "<"
  );
}

function removeRepoRoot(token: string, options: ZeroLegacyCommandParserOptions): string {
  if (!token.includes("$")) {
    return token;
  }
  const repoRootIndex = token.indexOf("$REPO_ROOT/");
  if (
    repoRootIndex !== -1 &&
    options.allowRepositoryRootVariable &&
    token.lastIndexOf("$") === repoRootIndex
  ) {
    return token.slice(repoRootIndex + "$REPO_ROOT/".length);
  }
  options.error("dynamic command value is unsupported");
}

interface ReadTokenResult {
  readonly nextIndex: number;
  readonly token?: ParsedToken;
}

function readShellToken(
  sourceText: string,
  index: number,
  absoluteStart: number,
  options: ZeroLegacyCommandParserOptions,
): ReadTokenResult {
  const start = index;
  const firstCharacter = sourceText.charAt(index);
  if (shellOperators.has(firstCharacter)) {
    return { nextIndex: index + 1, token: { start: absoluteStart + start, text: firstCharacter } };
  }
  let text = "";
  let quote: "'" | '"' | undefined;
  let nextIndex = index;
  while (nextIndex < sourceText.length) {
    const character = sourceText.charAt(nextIndex);
    if (quote === undefined && (whitespace.test(character) || shellOperators.has(character))) {
      return {
        nextIndex,
        ...(text.length > 0 && {
          token: { start: absoluteStart + start, text: removeRepoRoot(text, options) },
        }),
      };
    }
    if (character === "`" || (character === "\\" && quote !== "'")) {
      options.error("dynamic or escaped command syntax is unsupported");
    }
    if (character === "'" || character === '"') {
      quote = quote === undefined ? character : quote === character ? undefined : quote;
    } else {
      text += character;
    }
    nextIndex += 1;
  }
  if (quote !== undefined) {
    options.error("unterminated command quote");
  }
  return {
    nextIndex,
    ...(text.length > 0 && { token: { start: absoluteStart + start, text: removeRepoRoot(text, options) } }),
  };
}

function parseShellTokens(
  sourceText: string,
  absoluteStart: number,
  options: ZeroLegacyCommandParserOptions,
): readonly ParsedToken[] {
  const tokens: ParsedToken[] = [];
  let index = 0;
  while (index < sourceText.length) {
    while (index < sourceText.length && whitespace.test(sourceText.charAt(index))) {
      index += 1;
    }
    if (index === sourceText.length) {
      break;
    }
    const result = readShellToken(sourceText, index, absoluteStart, options);
    if (result.token !== undefined) {
      tokens.push(result.token);
    }
    index = result.nextIndex;
  }
  return Object.freeze(tokens.map((token) => Object.freeze({ ...token })));
}

export function extractStaticCommandTokens(
  sourceText: string,
  absoluteStart: number,
  options: ZeroLegacyCommandParserOptions,
): readonly ZeroLegacyLocatedToken[] {
  const tokens = parseShellTokens(sourceText, absoluteStart, options);
  const targets: ZeroLegacyLocatedToken[] = [];
  let isCommandPosition = true;
  let isEchoCommand = false;
  let isExpectingRedirectionTarget = false;
  for (const token of tokens) {
    if (shellOperators.has(token.text)) {
      isCommandPosition = true;
      isEchoCommand = false;
      isExpectingRedirectionTarget = false;
      continue;
    }
    if (isRedirection(token.text)) {
      isExpectingRedirectionTarget = true;
      continue;
    }
    const configuredTarget = assignmentTarget(token);
    if (configuredTarget !== undefined) {
      targets.push(configuredTarget);
      if (isCommandPosition) {
        continue;
      }
    }
    if (isExpectingRedirectionTarget) {
      targets.push({ start: token.start, target: token.text });
      isExpectingRedirectionTarget = false;
      continue;
    }
    if (isCommandPosition) {
      isEchoCommand = token.text === "echo" || token.text === "printf";
      isCommandPosition = false;
      targets.push({ start: token.start, target: token.text });
      continue;
    }
    if (!isEchoCommand) {
      targets.push({ start: token.start, target: token.text });
    }
  }
  return Object.freeze(targets.map((target) => Object.freeze({ ...target })));
}
