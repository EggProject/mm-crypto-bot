import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import ts from "typescript";

const repositoryRoot = process.cwd();
const enginePath = "packages/backtest/src/engine.ts";

class EvidenceError extends Error {
  constructor(message, exitCode) {
    super(message);
    this.exitCode = exitCode;
  }
}

function fail(message, exitCode) {
  throw new EvidenceError(message, exitCode);
}

function parseArguments(arguments_) {
  const [selector, ...values] = arguments_;
  if (selector === undefined) {
    fail("Missing selector.", 64);
  }
  if (selector === "--baseline" || selector === "--current" || selector === "--validate") {
    if (values.length !== 1) {
      fail(`Selector ${selector} requires exactly one argument.`, 65);
    }
    return { selector, values };
  }
  if (selector === "--compare") {
    if (values.length !== 2) {
      fail("Selector --compare requires exactly two arguments.", 65);
    }
    return { selector, values };
  }
  fail(`Unsupported selector: ${selector}`, 66);
}

function readBaseline(commit) {
  const result = spawnSync("git", ["show", `${commit}:${enginePath}`], { encoding: "utf8" });
  if (result.status !== 0) {
    fail(`Cannot read baseline engine source for commit ${commit}.`, 67);
  }
  return { label: `${commit}:${enginePath}`, path: resolve(repositoryRoot, enginePath), text: result.stdout };
}

function readCurrent(path) {
  const absolutePath = resolve(repositoryRoot, path);
  const repositoryRelativePath = relative(repositoryRoot, absolutePath);
  if (
    repositoryRelativePath.startsWith("..") ||
    repositoryRelativePath === "" ||
    extname(absolutePath) !== ".ts" ||
    !existsSync(absolutePath)
  ) {
    fail(`Current TypeScript path is unavailable or outside the repository: ${path}.`, 68);
  }
  return { label: repositoryRelativePath, path: absolutePath, text: readFileSync(absolutePath, "utf8") };
}

function parseSource(source) {
  const parsed = ts.createSourceFile(
    source.path,
    source.text,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TS,
  );
  if (parsed.parseDiagnostics.length > 0) {
    fail(`TypeScript parse failure in ${source.label}.`, 69);
  }
  return parsed;
}

function hasExportModifier(statement) {
  return (ts.getCombinedModifierFlags(statement) & ts.ModifierFlags.Export) !== 0;
}

function declarationEntry(statement) {
  const genericArity = statement.typeParameters?.length ?? 0;
  if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
    return { kind: "value", name: statement.name.text, genericArity };
  }
  if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
    return { kind: "type", name: statement.name.text, genericArity };
  }
  if (ts.isClassDeclaration(statement) && statement.name !== undefined) {
    return { kind: "type+value", name: statement.name.text, genericArity };
  }
  if (ts.isEnumDeclaration(statement)) {
    return { kind: "type+value", name: statement.name.text, genericArity };
  }
  if (ts.isVariableStatement(statement)) {
    const declaration = statement.declarationList.declarations[0];
    if (
      statement.declarationList.declarations.length !== 1 ||
      declaration === undefined ||
      !ts.isIdentifier(declaration.name)
    ) {
      fail("Unsupported exported variable declaration.", 70);
    }
    return { kind: "value", name: declaration.name.text, genericArity };
  }
  fail("Unsupported exported declaration.", 70);
}

function resolveModulePath(sourcePath, moduleSpecifier) {
  if (!moduleSpecifier.startsWith(".")) {
    fail(`External re-export is unsupported in evidence scope: ${moduleSpecifier}.`, 70);
  }
  const sourceModulePath = resolve(dirname(sourcePath), moduleSpecifier);
  const typescriptModulePath = sourceModulePath.endsWith(".js")
    ? `${sourceModulePath.slice(0, -3)}.ts`
    : sourceModulePath;
  if (!existsSync(typescriptModulePath)) {
    fail(`Re-export target is unavailable: ${moduleSpecifier}.`, 68);
  }
  return typescriptModulePath;
}

function collectExports(source) {
  const parsed = parseSource(source);
  const entries = [];
  for (const statement of parsed.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.moduleSpecifier === undefined || !ts.isStringLiteral(statement.moduleSpecifier)) {
        fail("Export declarations must name a local module target.", 70);
      }
      if (statement.exportClause === undefined || !ts.isNamedExports(statement.exportClause)) {
        fail("Wildcard or namespace re-exports are unsupported in evidence scope.", 70);
      }
      const targetPath = resolveModulePath(parsed.fileName, statement.moduleSpecifier.text);
      const targetSource = { label: targetPath, path: targetPath, text: readFileSync(targetPath, "utf8") };
      const targetEntries = collectExports(targetSource);
      for (const specifier of statement.exportClause.elements) {
        const localName = (specifier.propertyName ?? specifier.name).text;
        const targetEntry = targetEntries.find((entry) => entry.name === localName);
        if (targetEntry === undefined) {
          fail(`Cannot resolve re-export ${localName} from ${statement.moduleSpecifier.text}.`, 70);
        }
        const isTypeOnly = statement.isTypeOnly || specifier.isTypeOnly;
        if (isTypeOnly && targetEntry.kind === "value") {
          fail(`Type-only re-export ${specifier.name.text} does not resolve to a type.`, 70);
        }
        if (!isTypeOnly && targetEntry.kind === "type") {
          fail(`Value re-export ${specifier.name.text} does not resolve to a value.`, 70);
        }
        entries.push({
          kind: isTypeOnly ? "type" : targetEntry.kind,
          name: specifier.name.text,
          genericArity: targetEntry.genericArity,
        });
      }
      continue;
    }
    if (hasExportModifier(statement)) {
      entries.push(declarationEntry(statement));
    }
  }
  const names = new Set();
  for (const entry of entries) {
    if (names.has(entry.name)) {
      fail(`Duplicate exported name: ${entry.name}.`, 70);
    }
    names.add(entry.name);
  }
  return entries.toSorted((left, right) => left.name.localeCompare(right.name));
}

function serialize(entries) {
  return `${entries.map((entry) => `${entry.kind}\t${entry.name}\t${entry.genericArity}`).join("\n")}\n`;
}

function main() {
  const { selector, values } = parseArguments(process.argv.slice(2));
  if (selector === "--baseline") {
    process.stdout.write(serialize(collectExports(readBaseline(values[0]))));
    return;
  }
  if (selector === "--current" || selector === "--validate") {
    process.stdout.write(serialize(collectExports(readCurrent(values[0]))));
    return;
  }
  const [commit, currentPath] = values;
  const baseline = serialize(collectExports(readBaseline(commit)));
  const current = serialize(collectExports(readCurrent(currentPath)));
  if (baseline !== current) {
    fail("Baseline and current engine export surfaces differ.", 71);
  }
  process.stdout.write(current);
}

try {
  main();
} catch (error) {
  if (error instanceof EvidenceError) {
    console.error(error.message);
    process.exit(error.exitCode);
  }
  console.error("Unexpected evidence helper failure.");
  process.exit(72);
}
