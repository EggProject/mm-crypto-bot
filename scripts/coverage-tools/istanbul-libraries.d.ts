declare module "istanbul-lib-coverage" {
  export interface CoverageMetricData {
    readonly total: number;
    readonly covered: number;
    readonly skipped: number;
    readonly pct: number | "Unknown";
  }

  export interface CoverageSummaryData {
    readonly statements: CoverageMetricData;
    readonly branches: CoverageMetricData;
    readonly functions: CoverageMetricData;
    readonly lines: CoverageMetricData;
    readonly branchesTrue?: CoverageMetricData;
  }

  interface CoverageSummary {
    toJSON(): CoverageSummaryData;
  }

  interface FileCoverage {
    toSummary(): CoverageSummary;
  }

  interface CoverageMap {
    merge(coverage: Readonly<Record<string, unknown>>): void;
    files(): string[];
    getCoverageSummary(): CoverageSummary;
    fileCoverageFor(path: string): FileCoverage;
  }

  const coveragePackage: {
    createCoverageMap(initialCoverage: Readonly<Record<string, unknown>>): CoverageMap;
  };
  export default coveragePackage;
}

declare module "istanbul-lib-instrument" {
  interface Instrumenter {
    instrumentSync(source: string, filename: string): string;
  }

  interface InstrumenterOptions {
    readonly esModules: boolean;
    readonly produceSourceMap: boolean;
    readonly parserPlugins: readonly string[];
  }

  const instrumentPackage: {
    createInstrumenter(options: InstrumenterOptions): Instrumenter;
  };
  export default instrumentPackage;
}
