#!/usr/bin/env bun
import { runDydxVsCexFundingCarryCommand } from "./dydx-vs-cex-carry-data.js";

process.exitCode = await runDydxVsCexFundingCarryCommand(process.argv.slice(2));
