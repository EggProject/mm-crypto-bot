import { assembleRelease } from "./release-assembler";
import { assembleReleaseSetCandidate } from "./release-set-assembler";
import {
  publishReleaseSet,
  type ReleaseSetPublicationDependencies,
  type ReleasePublicationOutcome,
} from "./release-set-publication";
import { verifyPrivateReleaseCandidate } from "./release-private-candidate-reproducibility";
import { smokeVerifiedRelease } from "./release-smoke";
import type { ReleaseDependencies } from "./release-ports";
import type { ReleaseSetInput } from "./release-set-contract";

export async function assertReproducibleReleaseSet(input: {
  readonly releaseDependencies: ReleaseDependencies;
  readonly publicationDependencies: ReleaseSetPublicationDependencies;
  readonly publicationRoot: string;
}): Promise<ReleasePublicationOutcome> {
  const snapshots: ReleaseSetInput[] = [];
  for (const app of ["bot", "config-search"] as const) {
    const first = await assembleRelease(input.releaseDependencies, app);
    let second: Awaited<ReturnType<typeof assembleRelease>> | undefined;
    try {
      const one = await verifyPrivateReleaseCandidate(input.releaseDependencies, first.candidate);
      if (one.manifest.schema !== "mm-crypto-bot.release-manifest/v2")
        throw new Error("release-set reproducibility mismatch");
      second = await assembleRelease(input.releaseDependencies, app);
      const two = await verifyPrivateReleaseCandidate(input.releaseDependencies, second.candidate);
      if (!isSameBytes(one.zipBytes, two.zipBytes) || !isSameBytes(one.sidecarBytes, two.sidecarBytes))
        throw new Error("release-set reproducibility mismatch");
      await smokeVerifiedRelease(input.releaseDependencies, first.candidate);
      await smokeVerifiedRelease(input.releaseDependencies, second.candidate);
      snapshots.push({
        application: app,
        innerManifest: one.manifest,
        sidecarBytes: new Uint8Array(one.sidecarBytes),
        zipBytes: new Uint8Array(one.zipBytes),
      });
    } finally {
      await input.releaseDependencies.fileSystem.removePrivateDirectory({ path: first.candidate.directory });
      if (second !== undefined)
        await input.releaseDependencies.fileSystem.removePrivateDirectory({
          path: second.candidate.directory,
        });
    }
  }
  const candidate = await assembleReleaseSetCandidate(input.releaseDependencies, snapshots);
  return publishReleaseSet(
    {
      candidate,
      privateRoot: input.releaseDependencies.temporaryRoot,
      publicationRoot: input.publicationRoot,
    },
    input.publicationDependencies,
  );
}
function isSameBytes(first: Uint8Array, second: Uint8Array): boolean {
  return first.length === second.length && first.every((value, index) => value === second.at(index));
}
