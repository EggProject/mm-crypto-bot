import { runZeroLegacyScannerCli } from "./zero-legacy-scanner.ts";

const result = await runZeroLegacyScannerCli(process.argv.slice(2));
process.exitCode = result.exitCode;
