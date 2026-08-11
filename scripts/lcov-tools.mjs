#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

function fail(message) { throw new Error(`lcov-tools: ${message}`); }
function number(value, context) {
  if (!/^[0-9]+$/.test(value)) fail(`malformed ${context}: ${value}`);
  return Number(value);
}
function parse(path) {
  const records = [];
  let current = null;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (raw === "" || raw === "TN:") continue;
    if (raw.startsWith("SF:")) {
      if (current !== null) fail(`${path}: SF before end_of_record`);
      const sf = raw.slice(3); if (!sf) fail(`${path}: empty SF`);
      current = { sf, da: new Map(), lf: null, lh: null, other: [] };
    } else if (raw === "end_of_record") {
      if (current === null) fail(`${path}: end_of_record without SF`);
      records.push(current); current = null;
    } else if (current === null) fail(`${path}: record data before SF`);
    else if (raw.startsWith("DA:")) {
      const [line, hits] = raw.slice(3).split(",");
      current.da.set(number(line, "DA line"), number(hits, "DA hits"));
    } else if (raw.startsWith("LF:")) current.lf = number(raw.slice(3), "LF");
    else if (raw.startsWith("LH:")) current.lh = number(raw.slice(3), "LH");
    else current.other.push(raw);
  }
  if (current !== null) fail(`${path}: missing end_of_record`);
  if (records.length === 0) fail(`${path}: no records`);
  return records;
}
function merge(output, inputs) {
  if (inputs.length === 0) fail("merge needs at least one input");
  const merged = new Map();
  for (const input of inputs) for (const record of parse(input)) {
    const existing = merged.get(record.sf) ?? { sf: record.sf, da: new Map(), lf: 0, lh: 0, other: new Set() };
    for (const [line, hits] of record.da) existing.da.set(line, (existing.da.get(line) ?? 0) + hits);
    existing.lf += record.lf ?? 0; existing.lh += record.lh ?? 0;
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
    lines.push("end_of_record");
  }
  mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, `${lines.join("\n")}\n`);
}
function summary(path) {
  let lf = 0, lh = 0;
  for (const record of parse(path)) { lf += record.da.size > 0 ? record.da.size : record.lf ?? 0; lh += record.da.size > 0 ? [...record.da.values()].filter((hits) => hits > 0).length : record.lh ?? 0; }
  console.log(`lines.......: ${lf === 0 ? "0.0" : ((lh * 100) / lf).toFixed(1)}% (${lh} of ${lf} lines)`);
}
const [command, ...args] = process.argv.slice(2);
if (command === "merge") merge(args[0] ?? fail("missing output"), args.slice(1));
else if (command === "summary" && args.length === 1) summary(args[0]);
else fail("usage: lcov-tools.mjs merge OUTPUT INPUT... | summary INPUT");
