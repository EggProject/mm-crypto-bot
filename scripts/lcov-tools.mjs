#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function fail(message) {
  throw new Error(`lcov-tools: ${message}`);
}
function number(value, context) {
  if (!/^[0-9]+$/.test(value)) fail(`malformed ${context}: ${value}`);
  return Number(value);
}
function counter(value, context) {
  if (!/^[0-9]+$/.test(value)) fail(`malformed ${context}: ${value}`);
  return BigInt(value);
}
function splitFields(value, count, context) {
  const fields = value.split(",");
  if (fields.length !== count || fields.includes("")) fail(`malformed ${context}: ${value}`);
  return fields;
}
function functionKey(line, end, name) {
  return `${line}\u{0}${end ?? ""}\u{0}${name}`;
}
function branchKey(line, block, branch) {
  return `${line}\u{0}${block}\u{0}${branch}`;
}
function combineTaken(current, next) {
  if (current === "-") return next;
  if (next === "-") return current;
  return current + next;
}
function legacyFunctionDefinition(value, context) {
  const fields = value.split(",");
  if (fields.length < 2 || fields[0] === "") fail(`malformed ${context}: ${value}`);
  const line = number(fields[0], "FN line");
  const end = fields.length > 2 && /^[0-9]+$/.test(fields[1]) ? number(fields[1], "FN end") : undefined;
  const name = fields.slice(end === undefined ? 1 : 2).join(",");
  if (name === "") fail(`malformed ${context}: ${value}`);
  return { line, end, name };
}
function newFunctionDefinition(value, context) {
  const fields = value.split(",");
  if ((fields.length !== 2 && fields.length !== 3) || fields.includes(""))
    fail(`malformed ${context}: ${value}`);
  return {
    index: number(fields[0], "FNL index"),
    line: number(fields[1], "FNL line"),
    end: fields.length === 3 ? number(fields[2], "FNL end") : undefined,
  };
}
function functionAlias(value, context) {
  const fields = value.split(",");
  if (fields.length < 3 || fields[0] === "" || fields[1] === "") fail(`malformed ${context}: ${value}`);
  const name = fields.slice(2).join(",");
  if (name === "") fail(`malformed ${context}: ${value}`);
  return { index: number(fields[0], "FNA index"), hits: counter(fields[1], "FNA hits"), name };
}
function branchDefinition(value, context) {
  const lastDelimiter = value.lastIndexOf(",");
  if (lastDelimiter === -1) fail(`malformed ${context}: ${value}`);
  const taken = value.slice(lastDelimiter + 1);
  const fields = value.slice(0, Math.max(0, lastDelimiter)).split(",");
  if (fields.length < 3 || fields[0] === "" || fields[1] === "") fail(`malformed ${context}: ${value}`);
  const branch = fields.slice(2).join(",");
  if (branch === "" || taken === "") fail(`malformed ${context}: ${value}`);
  return {
    line: number(fields[0], "BRDA line"),
    block: fields[1],
    branch,
    taken: taken === "-" ? "-" : counter(taken, "BRDA taken"),
  };
}
function newFunctionKey(definition) {
  return `${definition.line}\u{0}${definition.end ?? ""}`;
}
function packageDirectory(tracefile) {
  const tracefileDirectory = path.dirname(path.resolve(tracefile));
  let candidate = tracefileDirectory;
  while (true) {
    // The CLI tracefile path determines which package owns a relative SF entry.
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- The inspected path is derived from the tracefile argument.
    if (existsSync(path.join(candidate, "package.json"))) return candidate;
    const parent = path.dirname(candidate);
    if (parent === candidate) return tracefileDirectory;
    candidate = parent;
  }
}
function canonicalSourceFile(sourceFile, tracefile) {
  return path.isAbsolute(sourceFile) ? sourceFile : path.resolve(packageDirectory(tracefile), sourceFile);
}
function parse(path) {
  const records = [];
  let current = null;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (raw === "" || raw === "TN:") continue;
    if (raw.startsWith("SF:")) {
      if (current !== null) fail(`${path}: SF before end_of_record`);
      const sourceFile = raw.slice(3);
      if (!sourceFile) fail(`${path}: empty SF`);
      const sf = canonicalSourceFile(sourceFile, path);
      current = {
        sf,
        da: new Map(),
        lf: null,
        lh: null,
        legacyFunctions: new Map(),
        legacyFunctionNames: new Map(),
        newFunctions: new Map(),
        newFunctionIndexes: new Map(),
        branches: new Map(),
        other: [],
      };
    } else if (raw === "end_of_record") {
      if (current === null) fail(`${path}: end_of_record without SF`);
      records.push(current);
      current = null;
    } else if (current === null) fail(`${path}: record data before SF`);
    else if (raw.startsWith("DA:")) {
      const [line, hits] = splitFields(raw.slice(3), 2, "DA");
      current.da.set(number(line, "DA line"), number(hits, "DA hits"));
    } else if (raw.startsWith("LF:")) current.lf = number(raw.slice(3), "LF");
    else if (raw.startsWith("LH:")) current.lh = number(raw.slice(3), "LH");
    else if (raw.startsWith("FN:")) {
      if (current.newFunctions.size > 0) fail(`${path}: mixed legacy and LCOV 2.2 function data`);
      const definition = legacyFunctionDefinition(raw.slice(3), "FN");
      const key = functionKey(definition.line, definition.end, definition.name);
      const named = current.legacyFunctionNames.get(definition.name);
      if (named !== undefined && named !== key) fail(`${path}: ambiguous FN definition: ${raw}`);
      current.legacyFunctions.set(key, { ...definition, hits: 0n });
      current.legacyFunctionNames.set(definition.name, key);
    } else if (raw.startsWith("FNDA:")) {
      if (current.newFunctions.size > 0) fail(`${path}: FNDA is invalid with LCOV 2.2 function data`);
      const fields = raw.slice(5).split(",");
      if (fields.length < 2 || fields[0] === "") fail(`${path}: malformed FNDA: ${raw.slice(5)}`);
      const name = fields.slice(1).join(",");
      if (name === "") fail(`${path}: malformed FNDA: ${raw.slice(5)}`);
      const key = current.legacyFunctionNames.get(name);
      if (key === undefined) fail(`${path}: FNDA without matching FN: ${raw}`);
      const definition = current.legacyFunctions.get(key);
      if (definition === undefined) fail(`${path}: missing FN definition: ${raw}`);
      definition.hits += counter(fields[0], "FNDA hits");
    } else if (raw.startsWith("FNL:")) {
      if (current.legacyFunctions.size > 0) fail(`${path}: mixed legacy and LCOV 2.2 function data`);
      const definition = newFunctionDefinition(raw.slice(4), "FNL");
      if (current.newFunctionIndexes.has(definition.index)) fail(`${path}: duplicate FNL index: ${raw}`);
      const key = newFunctionKey(definition);
      const group = current.newFunctions.get(key) ?? { ...definition, aliases: new Map() };
      current.newFunctions.set(key, group);
      current.newFunctionIndexes.set(definition.index, group);
    } else if (raw.startsWith("FNA:")) {
      if (current.legacyFunctions.size > 0) fail(`${path}: FNA is invalid with legacy function data`);
      const alias = functionAlias(raw.slice(4), "FNA");
      const group = current.newFunctionIndexes.get(alias.index);
      if (group === undefined) fail(`${path}: FNA without matching FNL: ${raw}`);
      group.aliases.set(alias.name, (group.aliases.get(alias.name) ?? 0n) + alias.hits);
    } else if (raw.startsWith("FNF:") || raw.startsWith("FNH:")) number(raw.slice(4), raw.slice(0, 3));
    else if (raw.startsWith("BRDA:")) {
      const branch = branchDefinition(raw.slice(5), "BRDA");
      const key = branchKey(branch.line, branch.block, branch.branch);
      const existing = current.branches.get(key);
      current.branches.set(key, {
        ...branch,
        taken: existing === undefined ? branch.taken : combineTaken(existing.taken, branch.taken),
      });
    } else if (raw.startsWith("BRF:") || raw.startsWith("BRH:")) number(raw.slice(4), raw.slice(0, 3));
    else current.other.push(raw);
  }
  if (current !== null) fail(`${path}: missing end_of_record`);
  if (records.length === 0) fail(`${path}: no records`);
  return records;
}
function merge(output, inputs) {
  if (inputs.length === 0) fail("merge needs at least one input");
  const merged = new Map();
  for (const input of inputs)
    for (const record of parse(input)) {
      const existing = merged.get(record.sf) ?? {
        sf: record.sf,
        da: new Map(),
        lf: 0,
        lh: 0,
        legacyFunctions: new Map(),
        legacyFunctionNames: new Map(),
        newFunctions: new Map(),
        branches: new Map(),
        other: new Set(),
      };
      for (const [line, hits] of record.da) existing.da.set(line, (existing.da.get(line) ?? 0) + hits);
      existing.lf += record.lf ?? 0;
      existing.lh += record.lh ?? 0;
      if (record.legacyFunctions.size > 0 && existing.newFunctions.size > 0)
        fail(`${record.sf}: mixed legacy and LCOV 2.2 function data`);
      if (record.newFunctions.size > 0 && existing.legacyFunctions.size > 0)
        fail(`${record.sf}: mixed legacy and LCOV 2.2 function data`);
      for (const definition of record.legacyFunctions.values()) {
        const key = functionKey(definition.line, definition.end, definition.name);
        const named = existing.legacyFunctionNames.get(definition.name);
        if (named !== undefined && named !== key)
          fail(`${record.sf}: ambiguous FN definition: ${definition.line},${definition.name}`);
        const prior = existing.legacyFunctions.get(key);
        if (prior === undefined) {
          existing.legacyFunctions.set(key, { ...definition });
          existing.legacyFunctionNames.set(definition.name, key);
        } else prior.hits += definition.hits;
      }
      for (const group of record.newFunctions.values()) {
        const key = newFunctionKey(group);
        const previousGroup = existing.newFunctions.get(key);
        const mergedGroup = previousGroup ?? { ...group, aliases: new Map() };
        for (const [name, hits] of group.aliases)
          mergedGroup.aliases.set(name, (mergedGroup.aliases.get(name) ?? 0n) + hits);
        existing.newFunctions.set(key, mergedGroup);
      }
      for (const branch of record.branches.values()) {
        const key = branchKey(branch.line, branch.block, branch.branch);
        const prior = existing.branches.get(key);
        existing.branches.set(
          key,
          prior === undefined ? { ...branch } : { ...prior, taken: combineTaken(prior.taken, branch.taken) },
        );
      }
      for (const value of record.other) existing.other.add(value);
      merged.set(record.sf, existing);
    }
  const lines = ["TN:"];
  for (const record of [...merged.values()].sort((a, b) => a.sf.localeCompare(b.sf))) {
    lines.push(`SF:${record.sf}`);
    for (const value of [...record.other].sort()) lines.push(value);
    if (record.da.size > 0) {
      for (const [line, hits] of [...record.da].sort((a, b) => a[0] - b[0])) lines.push(`DA:${line},${hits}`);
      lines.push(`LF:${record.da.size}`, `LH:${[...record.da.values()].filter((hits) => hits > 0).length}`);
    } else lines.push(`LF:${record.lf}`, `LH:${record.lh}`);
    if (record.legacyFunctions.size > 0) {
      const functions = record.legacyFunctions
        .values()
        .toArray()
        .toSorted((a, b) => a.line - b.line || (a.end ?? -1) - (b.end ?? -1) || a.name.localeCompare(b.name));
      for (const definition of functions)
        lines.push(
          `FN:${definition.line}${definition.end === undefined ? "" : `,${definition.end}`},${definition.name}`,
        );
      for (const definition of functions) lines.push(`FNDA:${definition.hits},${definition.name}`);
      lines.push(
        `FNF:${functions.length}`,
        `FNH:${functions.filter((definition) => definition.hits > 0n).length}`,
      );
    }
    if (record.newFunctions.size > 0) {
      const groups = record.newFunctions
        .values()
        .toArray()
        .toSorted((a, b) => a.line - b.line || (a.end ?? -1) - (b.end ?? -1));
      const groupEntries = groups.entries().toArray();
      for (const [index, group] of groupEntries) {
        const leader = index + 1;
        lines.push(`FNL:${leader},${group.line}${group.end === undefined ? "" : `,${group.end}`}`);
        const aliases = group.aliases
          .entries()
          .toArray()
          .toSorted((a, b) => a[0].localeCompare(b[0]));
        for (const [name, hits] of aliases) lines.push(`FNA:${leader},${hits},${name}`);
      }
      lines.push(
        `FNF:${groups.length}`,
        `FNH:${groups.filter((group) => group.aliases.values().some((hits) => hits > 0n)).length}`,
      );
    }
    if (record.branches.size > 0) {
      const branches = record.branches
        .values()
        .toArray()
        .toSorted(
          (a, b) => a.line - b.line || a.block.localeCompare(b.block) || a.branch.localeCompare(b.branch),
        );
      for (const branch of branches)
        lines.push(`BRDA:${branch.line},${branch.block},${branch.branch},${branch.taken}`);
      lines.push(
        `BRF:${branches.length}`,
        `BRH:${branches.filter((branch) => branch.taken !== "-" && branch.taken > 0n).length}`,
      );
    }
    lines.push("end_of_record");
  }
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, `${lines.join("\n")}\n`);
}
function summary(path) {
  let lf = 0,
    lh = 0;
  for (const record of parse(path)) {
    lf += record.da.size > 0 ? record.da.size : (record.lf ?? 0);
    lh += record.da.size > 0 ? [...record.da.values()].filter((hits) => hits > 0).length : (record.lh ?? 0);
  }
  console.log(`lines.......: ${lf === 0 ? "0.0" : ((lh * 100) / lf).toFixed(1)}% (${lh} of ${lf} lines)`);
}
const [command, ...args] = process.argv.slice(2);
if (command === "merge") merge(args[0] ?? fail("missing output"), args.slice(1));
else if (command === "summary" && args.length === 1) summary(args[0]);
else fail("usage: lcov-tools.mjs merge OUTPUT INPUT... | summary INPUT");
