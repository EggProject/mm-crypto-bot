import { describe, expect, it } from "bun:test";

import {
  CcxtPackageProvenanceError,
  resolveCcxtPackageVersion,
  type CcxtPackageProvenanceDependencies,
} from "./ccxt-package-provenance.js";

const resolvedCcxtModule = "file:///workspace/node_modules/ccxt/js/ccxt.js";
const activeManifest = '{"dependencies":{"ccxt":"4.5.75"}}';

if (typeof Bun === "undefined") {
  Object.defineProperty(globalThis, "Bun", {
    configurable: true,
    value: {
      file: (filePath: string) => ({
        text: () =>
          Promise.resolve(
            filePath.endsWith("/packages/backtest-tools/package.json")
              ? activeManifest
              : '{"name":"ccxt","version":"4.5.75"}',
          ),
      }),
    },
  });
}

function dependenciesWith(
  packageJsonText: string,
  expectedManifestText = activeManifest,
): CcxtPackageProvenanceDependencies {
  return {
    resolveSpecifier: () => resolvedCcxtModule,
    readExpectedManifestText: () => Promise.resolve(expectedManifestText),
    readInstalledPackageText: () => Promise.resolve(packageJsonText),
  };
}

async function expectProvenanceFailure(
  packageJsonText: string,
  message: string,
  expectedManifestText = activeManifest,
): Promise<void> {
  let received: unknown;
  try {
    await resolveCcxtPackageVersion(dependenciesWith(packageJsonText, expectedManifestText));
  } catch (error: unknown) {
    received = error;
  }
  expect(received).toBeInstanceOf(CcxtPackageProvenanceError);
  if (!(received instanceof CcxtPackageProvenanceError)) {
    throw new Error("Expected CCXT package provenance validation to fail");
  }
  expect(received.message).toBe(message);
}

async function expectDependencyFailure(
  dependencies: CcxtPackageProvenanceDependencies,
  message: string,
): Promise<void> {
  let received: unknown;
  try {
    await resolveCcxtPackageVersion(dependencies);
  } catch (error: unknown) {
    received = error;
  }
  expect(received).toBeInstanceOf(CcxtPackageProvenanceError);
  if (!(received instanceof CcxtPackageProvenanceError)) {
    throw new Error("Expected CCXT package provenance validation to fail");
  }
  expect(received.message).toBe(message);
}

describe("resolveCcxtPackageVersion", () => {
  it("reads the resolved installed CCXT package metadata", async () => {
    expect(await resolveCcxtPackageVersion()).toBe("4.5.75");
  });

  it("accepts matching canonical prerelease and build metadata", async () => {
    const version = "4.5.75-alpha.1+build.01";
    expect(
      await resolveCcxtPackageVersion(
        dependenciesWith(`{"name":"ccxt","version":"${version}"}`, `{"dependencies":{"ccxt":"${version}"}}`),
      ),
    ).toBe(version);
  });

  it("fails closed when the resolved package metadata is malformed", async () => {
    await expectProvenanceFailure("not-json", "Resolved CCXT package metadata is not valid JSON");
  });

  it("fails closed when resolved package metadata identifies a different package", async () => {
    await expectProvenanceFailure(
      '{"name":"other","version":"4.5.75"}',
      "Resolved package metadata does not identify CCXT",
    );
  });

  it("fails closed when resolved CCXT metadata has an invalid version", async () => {
    await expectProvenanceFailure(
      '{"name":"ccxt","version":"4.5"}',
      "Resolved CCXT package metadata has an invalid version",
    );
  });

  it("fails closed when installed CCXT metadata differs from the active exact pin", async () => {
    await expectProvenanceFailure(
      '{"name":"ccxt","version":"4.5.74"}',
      "Resolved CCXT package version does not match active dependency: expected 4.5.75, received 4.5.74",
    );
  });

  it("fails closed when the active manifest omits CCXT", async () => {
    await expectProvenanceFailure(
      '{"name":"ccxt","version":"4.5.75"}',
      "Active CCXT dependency manifest is missing ccxt",
      '{"dependencies":{}}',
    );
  });

  it("fails closed when the active manifest is malformed", async () => {
    await expectProvenanceFailure(
      '{"name":"ccxt","version":"4.5.75"}',
      "Active CCXT dependency manifest is not valid JSON",
      "not-json",
    );
  });

  it("fails closed when the active manifest uses a CCXT version range", async () => {
    await expectProvenanceFailure(
      '{"name":"ccxt","version":"4.5.75"}',
      "Active CCXT dependency must be an exact canonical version",
      '{"dependencies":{"ccxt":"^4.5.75"}}',
    );
  });

  it("fails closed when the active manifest cannot be read", async () => {
    await expectDependencyFailure(
      {
        resolveSpecifier: () => resolvedCcxtModule,
        readExpectedManifestText: () => Promise.reject(new Error("missing manifest")),
        readInstalledPackageText: () => Promise.resolve('{"name":"ccxt","version":"4.5.75"}'),
      },
      "Unable to read active CCXT dependency manifest",
    );
  });

  it("fails closed when resolved package metadata cannot be read", async () => {
    await expectDependencyFailure(
      {
        resolveSpecifier: () => resolvedCcxtModule,
        readExpectedManifestText: () => Promise.resolve(activeManifest),
        readInstalledPackageText: () => Promise.reject(new Error("missing package")),
      },
      "Unable to read resolved CCXT package metadata",
    );
  });

  it("fails closed when CCXT does not resolve to a local file artifact", async () => {
    await expectDependencyFailure(
      {
        resolveSpecifier: () => "data:text/javascript,export%20default%20{}",
        readExpectedManifestText: () => Promise.resolve(activeManifest),
        readInstalledPackageText: () => Promise.resolve('{"name":"ccxt","version":"4.5.75"}'),
      },
      "Resolved CCXT module is not a local file artifact",
    );
  });

  it("fails closed for structurally invalid installed package metadata", async () => {
    await expectProvenanceFailure("[]", "Resolved package metadata does not identify CCXT");
    await expectProvenanceFailure('{"name":"ccxt"}', "Resolved package metadata does not identify CCXT");
  });

  it("fails closed for structurally invalid active dependency manifests", async () => {
    await expectProvenanceFailure(
      '{"name":"ccxt","version":"4.5.75"}',
      "Active CCXT dependency manifest is missing ccxt",
      "[]",
    );
    await expectProvenanceFailure(
      '{"name":"ccxt","version":"4.5.75"}',
      "Active CCXT dependency manifest is missing ccxt",
      '{"dependencies":"ccxt"}',
    );
  });

  it("fails closed for invalid semantic-version prerelease and build identifiers", async () => {
    const invalidVersions = ["4.5.75-01", "4.5.75-alpha..1", "4.5.75-alpha_1", "04.5.75"];
    for (const version of invalidVersions) {
      await expectProvenanceFailure(
        `{"name":"ccxt","version":"${version}"}`,
        "Resolved CCXT package metadata has an invalid version",
      );
    }
    await expectProvenanceFailure(
      '{"name":"ccxt","version":"4.5.75"}',
      "Active CCXT dependency must be an exact canonical version",
      '{"dependencies":{"ccxt":"4.5.75+build_1"}}',
    );
  });
});
