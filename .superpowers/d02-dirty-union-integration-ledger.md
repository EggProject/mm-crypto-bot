# D-02 dirty-union integration ledger

## User authority

On 2026-08-27 the user directed the coordinator to resolve implementation details autonomously toward the approved final goal. The integration therefore preserves all later dirty work, merges the reviewed D-02 invariants into it, and uses the committed 49-path D-02 evidence inventory as the canonical scope. No product, trading, leverage, dependency-version, data, cost, or external-system decision is delegated to this task.

## Dispatch classification

- Task class: dirty-union materialization, semantic reconciliation, and validation.
- Mode: write, non-review.
- Source: `/home/eggp/projects/mm-crypto-bot` at `5a5c10bd12bef01ba756549fd61a93921438cb33` with a clean index and the current dirty worktree snapshot.
- Target: `/tmp/mm-dirty-union-d02-integration` at reviewed-chain base `762d629acb8f9685e75dd4d4738c82baebacdefc`.
- Ownership: mechanical materialization of the frozen current dirty status; semantic edits only to the 11 D-02 conflict paths identified by the read-only audit; scratch report/ledger only outside deliverable scope.
- Package scope: `apps/bot`, root coverage tooling, plus mechanically preserved dirty paths as test substrate.
- Domain risk: security/config-root boundary, public CLI, multi-scope integration and data integrity; no live trading or dependency-selection authority.
- Reasoning shape: non-local three-way semantic reconciliation with dependency-closure proof.
- External/mutable resources: local Git/filesystem/test subprocesses only; no network, exchange, hook, or external data action.
- Review role: non-review.
- Route: mandatory `terra_worker`, profile `gpt-5.6-terra` / high, workspace-write; effective model/effort not observable; no fallback.
- Required validation: frozen status inventory, byte-preservation proof outside semantic ownership, focused TDD, D-02 governed unit/E2E 100% S/B/F/L, relevant type/build/lint/format/scope/LOC/secret gates, zero unnecessary new file, then fresh independent TECH and PROCESS review.

Status: IN PROGRESS.

## Frozen materialization manifest

- Frozen UTC: 2026-08-27 (local execution; no network).
- Source HEAD: `5a5c10bd12bef01ba756549fd61a93921438cb33`; source index clean: `true`.
- Source status format: `git status --porcelain=v1 -z`; SHA-256: `d214e9023284e723652ac89bcbb92fb5502d94d68e21dde2c577faf9b688cd41`.
- Records: `301`; aggregate SHA-256 over `status<TAB>mode<TAB>sha256<TAB>path<LF>`: `0472c526300fc2167836158d3b9723aa3f094d33ab9929a97df19e9047b4c08a`.
- Allowed records only: working-tree ` M`, working-tree deletion ` D`, or untracked `??`; all entries were regular non-symlink files before copy.

| Status | Mode | SHA-256 | Path |
| --- | --- | --- | --- |
| ` M` | `664` | `74695a099da81352131fbdf590ec128ce5428f6eaf1d57290fad0f5c8b496c54` | `.gitignore` |
| ` M` | `664` | `137396a5a804410a1d907e9a0e16cedfc5fbaafcafc413207a67f580da76ffac` | `.superpowers/sdd/d10-live-activation-plan/task-report.md` |
| ` M` | `664` | `79fe5d6b16d04778a3bf61e0d23c1bb375776e81a6ce3942bce93952042d9541` | `apps/bot/package.json` |
| `??` | `664` | `95d4b74d11c231897247f990da7d148376f70285f838ad68e1a03f0637aaed40` | `apps/bot/src/bot/bot-exchange-initializer.ts` |
| `??` | `664` | `67bff54e7b88cd766956a34ce80bdf31c4571dc79aac979a4d8b8c3ae7643caf` | `apps/bot/src/bot/bot-public-boundaries.live-equity-persistence.test.ts` |
| `??` | `664` | `5618e3972a69cd5d53c4db7adf804c8f136cc087dce5cd6e12f77b7b2f66726e` | `apps/bot/src/bot/bot-public-boundaries.test-support.ts` |
| ` M` | `664` | `47b78ea5330f6b944c5681aa4c714ec2861d1bf13a1e75a6d517c0a50904ad3a` | `apps/bot/src/bot/bot-public-boundaries.test.ts` |
| `??` | `664` | `eca78c224d12b6cad3a5feafbd753ab95e72981801bc97decab18c4295e374c9` | `apps/bot/src/bot/bot-runtime-assembly.ts` |
| `??` | `664` | `e5f96c66d7cae334255c21d5cc9bbb64d985596b75921a5435bffa5e7f1b245b` | `apps/bot/src/bot/bot-runtime-controller.test.ts` |
| `??` | `664` | `6c40051108a377607021c4c8dddb73eb2be9a5666415a82e922b3e399f994237` | `apps/bot/src/bot/bot-runtime-controller.ts` |
| `??` | `664` | `be46ed6c04121ab75fe7c70b28fc0715e888389773796bb8c66d5e5b36c68e59` | `apps/bot/src/bot/bot.lifecycle.test.ts` |
| `??` | `664` | `49a5c76004eb68cd0a2c76fe5148cd6d38e87c7790fd5b9f805d1bd9cb908cec` | `apps/bot/src/bot/bot.persistence.test.ts` |
| `??` | `664` | `dfc269c1db3a800bbcac15a392400babcf092a60dd6f1e791a81ae1b81509e9d` | `apps/bot/src/bot/bot.runtime.test.ts` |
| `??` | `664` | `71f9efa3f1ae93b3457e7fb6ff9086764d65a2d467e3068184f5c5c62304678b` | `apps/bot/src/bot/bot.state.test.ts` |
| `??` | `664` | `a3eb1a1354318dac01f3203ebcd15a13d7c562c7e899a527887ef38b21c985f2` | `apps/bot/src/bot/bot.test-support.ts` |
| ` D` | `deleted` | `deleted` | `apps/bot/src/bot/bot.test.ts` |
| ` M` | `664` | `5bb4b1fd471cce8259d8b82cb2bc149b50097961f324bf41be4efac0214c3c52` | `apps/bot/src/bot/bot.ts` |
| `??` | `664` | `cabfc265a0b77c16a9e544a2d8c5ca39d168acdb5bb0e03cdebe293b34292fec` | `apps/bot/src/bot/kill-switches.coverage.test.ts` |
| ` M` | `664` | `2d3959e6eb5853c9607258e293bdb75134963107103b45ccfc95203a17f4c693` | `apps/bot/src/bot/kill-switches.test.ts` |
| ` M` | `664` | `d58bdd4a87091eb8b21df63ae65edb1199ce62dab223eefdfc9bf792d39fe28e` | `apps/bot/src/bot/kill-switches.ts` |
| `??` | `664` | `d57a13a6d3232d8858bb4ccd82e6ad11ffca087713d6b504b1f91170f25afa10` | `apps/bot/src/bot/order-lifecycle-controller.test.ts` |
| `??` | `664` | `c92141f8b7087e6ec48510e8ae828ba8bf4a52d81310c6730dc8bc7d83ab21be` | `apps/bot/src/bot/order-manager-lifecycle.ts` |
| `??` | `664` | `d3827f567e2ae87428dfa8e8ef736684f03ece800d5cf556e705069ca914ed40` | `apps/bot/src/bot/order-manager-placement.ts` |
| `??` | `664` | `2ba4f29552040767615045d59ce3946c83d8c47a92a7db21f26426987aa6b56d` | `apps/bot/src/bot/order-manager-retention.test.ts` |
| `??` | `664` | `7d9df45361ab7ba706f508dcc7475fadf87873d593e5a5ac57d355b18bd1133e` | `apps/bot/src/bot/order-manager.faults.test.ts` |
| `??` | `664` | `bc3adeb428f1d34da93da4f3a676159d93fe3f0cba5c5dd39682d98a1321cb7c` | `apps/bot/src/bot/order-manager.placement.test.ts` |
| `??` | `664` | `35de0fe9a3f69b2f4a462686f5f61033f89e3f6ef8499e2efdc414202392cb5a` | `apps/bot/src/bot/order-manager.test-support.ts` |
| ` M` | `664` | `a053e6a9e3cad29d29618b0ba9257e5312fcad47bccb0c3c4a7a3b569cc265f8` | `apps/bot/src/bot/order-manager.test.ts` |
| ` M` | `664` | `d75281d2014f40ceabf3e7186b29c63396d161b99975014477311cafc6cc709d` | `apps/bot/src/bot/order-manager.ts` |
| `??` | `664` | `a3a0535652230c31d7c1cb37434a5db5b12614737006a5cba8a7d98c1e0b0882` | `apps/bot/src/bot/order-manager.types.ts` |
| `??` | `664` | `241e46d6f20e18a4ab95278d009b809c4fe501b8066bf19442e552900fc768b1` | `apps/bot/src/bot/position-manager.calculations.ts` |
| `??` | `664` | `3c57d10a673d372313035f788a97a59c7d61207332cc69b0ae96399988ca0fee` | `apps/bot/src/bot/position-manager.restoration.ts` |
| `??` | `664` | `77f7a7f98b8396acac704280967169ff1c31ab664501ff0665d60eb81bdcd939` | `apps/bot/src/bot/position-manager.risk-monitor.ts` |
| `??` | `664` | `833b40dc57b902dde8812fd90597d221fde80167765dbfd51936513b0092472c` | `apps/bot/src/bot/position-manager.state-restoration.test.ts` |
| `??` | `664` | `7d64b948ffa978eaf8aebf52a6d6ed2e63d26387a13c0936eb1d2a760a3cd3ef` | `apps/bot/src/bot/position-manager.test-support.ts` |
| ` M` | `664` | `e1ff78e87915f9940bd7e1b4b84180b62f5ac311a941365614fa9dce7440b2d7` | `apps/bot/src/bot/position-manager.test.ts` |
| ` M` | `664` | `1eff434730e78b7146b9ade786d6fff9128011bc9cf5904579ddb239dccccee6` | `apps/bot/src/bot/position-manager.ts` |
| `??` | `664` | `0d748631cb58ac8a784f3ea5ba5a7ef99b1137cdbdb122d0bc4173b41b01af92` | `apps/bot/src/bot/position-manager.types.ts` |
| `??` | `664` | `ee9d2ceeaeeff167ce7755cb70673d5598da6f477f69f2ed4ce902b6cb77bc0a` | `apps/bot/src/bot/state-schema.ts` |
| ` M` | `664` | `26ff91a20732d75f4a50711aaec5afe5c8b220a056ec941c3a44365d48efd9a9` | `apps/bot/src/bot/state-store.test.ts` |
| ` M` | `664` | `f7eb4ada45bc3062a8cb62dd295c0fc062ae6b2cd583046b2a4358d86e8b7e40` | `apps/bot/src/bot/state-store.ts` |
| `??` | `664` | `0fbb850bb4b1e8298a695fafeb0658e9419d79555d5d497654b939c8bef72b01` | `apps/bot/src/bot/strategy-market-event-controller.boundary.test.ts` |
| `??` | `664` | `4d6600f30128042fc3dd5d12d450475669c881c381894928126eccb02f996707` | `apps/bot/src/bot/strategy-market-event-controller.scenarios.test.ts` |
| `??` | `664` | `a3efaa75d6e38aed743912fe3c906e47a20e54afc007ad1d21e3536ab3f659e2` | `apps/bot/src/bot/strategy-plugin-risk-controller.boundary.test.ts` |
| `??` | `664` | `3d301b8731ada22f5d8a120cb47f6a5dde526d01b96cc13ad8660640a94b0302` | `apps/bot/src/bot/strategy-plugin-risk-controller.trailing-boundary.test.ts` |
| `??` | `664` | `113b64a3b0cdde91b7e39492c9bace01aba28f0529bc1a25950b006bc3ea4e68` | `apps/bot/src/bot/strategy-runner-event-serializer.test.ts` |
| `??` | `664` | `9e3f312c8ae847e2bdd4fab6a4603bb7e78145f761166e915030ff1f4b093d2f` | `apps/bot/src/bot/strategy-runner-market-event-controller.ts` |
| `??` | `664` | `f3d5f5f26df586b88098fde47f63122d50dee642b77057b5c2f91c163298fff2` | `apps/bot/src/bot/strategy-runner-native-protection-controller.ts` |
| `??` | `664` | `fc9b259ea99d416fc6cd50db650cd49dbf43f3cc7079c0f0b07578b075995557` | `apps/bot/src/bot/strategy-runner-order-lifecycle-controller.boundary.test.ts` |
| `??` | `664` | `06e9fc9bed5b42e3e2f618a4250c60d36e0c1e10259b57c2396f799aa2c06230` | `apps/bot/src/bot/strategy-runner-order-lifecycle-controller.ts` |
| `??` | `664` | `6ff2bed502e28735bf256f882b14ee781b6804f880efef11e2aef8ff18faafc3` | `apps/bot/src/bot/strategy-runner-paper-protection-controller.ts` |
| `??` | `664` | `6c666ee3ae2ca3ce14bac285051cafd585f7ad098c6fb021be97960bcbbcd27f` | `apps/bot/src/bot/strategy-runner-plugin-risk-controller.ts` |
| `??` | `664` | `a349cbbeca549b015e485b5908de96b19adcd1736b51de2d02d488662a4990a9` | `apps/bot/src/bot/strategy-runner.controller.test-support.ts` |
| `??` | `664` | `56f027cee084b75675ad79242b52ef3132854a9a744165268cc3fd23a38f00a6` | `apps/bot/src/bot/strategy-runner.event-serializer.ts` |
| `??` | `664` | `60b4146439c16ef61071a492c927c5842ec73a2b31a788398d79375b6c80da89` | `apps/bot/src/bot/strategy-runner.exchange-feed.test-support.ts` |
| `??` | `664` | `4afbe3f4a238a62db4cd31d1fcc5e60187753a750ca5a43fa7df8943386ee00c` | `apps/bot/src/bot/strategy-runner.market-order-flow.test.ts` |
| `??` | `664` | `44be8d5b3fe6e52ebd1586bf700acfd570fb54b565b31ff118dd25f9e4f7465e` | `apps/bot/src/bot/strategy-runner.market-plugin-lifecycle.test.ts` |
| `??` | `664` | `aa5e30eac79586f5b76575ac0188b428f2747f774b0e16ab49d1dff6ca9081d7` | `apps/bot/src/bot/strategy-runner.native-paper-coverage.test.ts` |
| `??` | `664` | `27c36009ab6ebe6b34a6354bd429ff5d33fe56cfaef45610a54a04e4fff31dee` | `apps/bot/src/bot/strategy-runner.order-admission-reconciliation.test.ts` |
| `??` | `664` | `e2c4e6f8a1fadf1680215591211c7002dd9d11a76ac0bcd0704dcc3080cd85bf` | `apps/bot/src/bot/strategy-runner.plugin-emergency-close.test.ts` |
| `??` | `664` | `fae297f6b66f28554ac534bd606a912370e34162f9df158d14f84f7dfb0ca649` | `apps/bot/src/bot/strategy-runner.plugin-funding-lifecycle.test.ts` |
| `??` | `664` | `5d16b9fc5fc6123599e7b1161c660736c9ae19b2590416cfdf88c89cd5ffebc2` | `apps/bot/src/bot/strategy-runner.position-update.test.ts` |
| `??` | `664` | `ade6c5eb90ca8c004a3f774d230708a565a0a72f9e4b48514df5d95539b65723` | `apps/bot/src/bot/strategy-runner.protection-lifecycle.test.ts` |
| `??` | `664` | `23410c41c96fbd55d0903c6c58063b99a1b97912779650a2e08673434c24e8b4` | `apps/bot/src/bot/strategy-runner.risk-state.test.ts` |
| `??` | `664` | `3317d86e9f990ca0c3a0d32a42795c8fb09c506d2f7e0c4375f687e227b2e657` | `apps/bot/src/bot/strategy-runner.test-support.ts` |
| ` M` | `664` | `e82fdfc4f6fabc2b2ade4cfd2d41e6ad31e431f44f620f189c6b7a08a494e004` | `apps/bot/src/bot/strategy-runner.test.ts` |
| `??` | `664` | `1b0aa404168e38b779527330d8f4320f25ee4cece73b6d85b2c4c9cae5b3d25f` | `apps/bot/src/bot/strategy-runner.trailing-risk-close.test.ts` |
| ` M` | `664` | `af0affcbfd55a4cfb4e892e904d7ab896f71334836a0a638e7c956197f8c83f1` | `apps/bot/src/bot/strategy-runner.ts` |
| `??` | `664` | `9dafb9e01911b2197f154ea605317319d5b6dec6a6eeda32d18e9260480a503d` | `apps/bot/src/bot/strategy-runner.types.ts` |
| ` M` | `664` | `812d51438764321cdc18c7110d8451562502d59619788f0757950a5f68ff3d98` | `apps/bot/src/bot/telemetry.test.ts` |
| ` M` | `664` | `69ec48635c71fabd4ba3d950b4d32db73ba1562ba783e7854f9601f7d189ec7d` | `apps/bot/src/bot/telemetry.ts` |
| ` M` | `664` | `557c0eb7eed7dc9fef1c8a902a0fe5fac488a1cf4b2ce27318965f984c0cd1a8` | `apps/bot/src/bot/wire-up-probe.test.ts` |
| `??` | `664` | `e6941e0ea1c2926a3d22dc75cdb41728b8898279e1395d09a10f2e82cd0c0282` | `apps/bot/src/cli/cli-e2e-signal-string-failure.test.ts` |
| ` M` | `664` | `5777a5a96d46ebe04073d1d36138b2f488938e2b294432b665d80aee6ae8ba14` | `apps/bot/src/cli/cli-e2e.test.ts` |
| `??` | `664` | `59f7b846f8e139bbb7e96f2823a83df21f2a3ba6570e1b1ea8fbc45bdb8f7ac5` | `apps/bot/src/cli/commands/config-roundtrip.test.ts` |
| ` M` | `664` | `2722818403ef926c3071643c16d8901e2f3af81946bb1fdb4435d24d4e1dd7a6` | `apps/bot/src/cli/commands/config.test.ts` |
| ` M` | `664` | `5eabc77574c12a5bb8f102fd8011005ba35549087f91adda8e4e9e1b06973dd8` | `apps/bot/src/cli/commands/config.ts` |
| `??` | `664` | `97e1cee855197b7c18e4cc16ba3e616c0e261fc5c4c1b08d334fb1c0953c1553` | `apps/bot/src/cli/commands/kill-switch-command-options.ts` |
| `??` | `664` | `d0e1be3a086c8697ae9743a7d123e0595b700fee6b1a8a21242f6f771a8e1e41` | `apps/bot/src/cli/commands/kill-switch-dry-run.command.test.ts` |
| `??` | `664` | `ed77a1a569b9ade22f1bf560145e3cb94a28ce5a8d5a522d4be4f06a52fe6972` | `apps/bot/src/cli/commands/kill-switch-dry-run.output.test.ts` |
| `??` | `664` | `3973e7975e5393fba80952164abe5f75eef8425e8c8d7d9c67504a1584678d36` | `apps/bot/src/cli/commands/kill-switch-dry-run.simulation.test.ts` |
| `??` | `664` | `ea5f9772c9049fc66817c21f1eb220bf993bd6594e372fddccaea5237b6328e1` | `apps/bot/src/cli/commands/kill-switch-dry-run.state-loading.test.ts` |
| `??` | `664` | `da86737922c1887214ac91b3166407dce4fac9c7588af45711b2d322c771b398` | `apps/bot/src/cli/commands/kill-switch-dry-run.test-support.ts` |
| ` M` | `664` | `1931adca7f84f49c0a9a0998202eeb5a2a5a2207e3b1e5dbb665cb993fa35c2d` | `apps/bot/src/cli/commands/kill-switch-dry-run.test.ts` |
| ` M` | `664` | `fcff52f3b0ad722081ebdf2777386c3768662085f31a7bd6df6c702c0ee53fa3` | `apps/bot/src/cli/commands/kill-switch-dry-run.ts` |
| `??` | `664` | `d1e46ac74fdd49b88587a27ef337a8c5ceed487fcf7751ed9853941e13bcddb3` | `apps/bot/src/cli/commands/kill-switch-state-file.ts` |
| `??` | `664` | `e6e15c86084583a04bc66fbe7566646303b0c2b74237f5e16bfca5eb560f29e9` | `apps/bot/src/cli/commands/kill-switches.command.test.ts` |
| ` M` | `664` | `c0aaeba90baa6b885ae24303bb1de06e3c1378d67f2d1d560b260d571f6255d1` | `apps/bot/src/cli/commands/kill-switches.ts` |
| `??` | `664` | `f7ceb95bc63c037e3f869168113b57cefcc5aeacb813609fca54439c24526040` | `apps/bot/src/cli/commands/start-command.test-support.ts` |
| `??` | `664` | `06beb62a39786c84eb672a3733bef32ad1198ff606cb9bc322aa43f1e7f4f4d4` | `apps/bot/src/cli/commands/start-live-activation.test.ts` |
| ` M` | `664` | `e91e8fc2f4eff4a1693431d3fbdfc3b3fa709a7bd4ba24d046dd536e8f034737` | `apps/bot/src/cli/commands/start-log-routing.test.ts` |
| ` M` | `664` | `9c2a91623d0e4f5f120c2af55f14a44a3e9ff4cc46e630b9c6a2dee716da4c6e` | `apps/bot/src/cli/commands/start.ts` |
| ` M` | `664` | `432615e2908354b28522ac62110c2c70e9af0c2f5432ac8bfbb8590d26c13cfa` | `apps/bot/src/cli/router.test.ts` |
| `??` | `664` | `ea1e48e4fac7d401197eaaedfdcb70781ba2f7bb79991406479545aed5ee3440` | `apps/bot/src/config/config-exchange-boundary.test.ts` |
| ` D` | `deleted` | `deleted` | `apps/bot/src/config/config-exchange.test.ts` |
| `??` | `664` | `b7ce4026f81fafbf0c626e6c6648de6a4014a0792e93894e4f7dfef3d0cc18c8` | `apps/bot/src/config/config-test-fixtures.test-support.ts` |
| ` M` | `664` | `855fdb471dbdeba51377f7c7dc3281942f732a87d46192f990a8da523c69a3ff` | `apps/bot/src/config/config.test.ts` |
| ` M` | `664` | `20fcdb70a79c61267230169ba8fc5138ea6c945bcc9027334196bf18242c9771` | `apps/bot/src/config/loader-environment.test.ts` |
| ` M` | `664` | `94ec384ca0b8a029379750bd11419b91d3718bd10a3653071272f4602dcdae5e` | `apps/bot/src/config/loader.ts` |
| ` M` | `664` | `c7aaaa9a51a534a9e131ccba63431a3f37ba759113e1f41a040448f7c63f5788` | `apps/bot/src/config/schema.ts` |
| ` M` | `664` | `e9a6f0f0ac6977b60a6bff4de295d568aa0277e30d0ab88c05598eec47905127` | `apps/bot/src/config/store-live-confirm.test.ts` |
| ` M` | `664` | `07fa24de5d22759c0e3b96fddc39ef95c0512f50397d7e48f4b5e32617bd6af8` | `apps/bot/src/config/store-sections.test.ts` |
| `??` | `664` | `ef43c6eb56ab1045d97ffd7b0e2c299bd6424fbe58d6fc544338e336b87e968e` | `apps/bot/src/config/store-write-errors.test.ts` |
| ` M` | `664` | `fe3189448f45a7c292d6715c0f4bceddd52ba85ddab478c577e3f6faa6eed9dd` | `apps/bot/src/config/store.test.ts` |
| ` M` | `664` | `f3be67ee880f83c71760fb827a2ba90dc14a8079805cedf68f71a6eec1eb3d38` | `apps/bot/src/config/strategy-registry.test.ts` |
| ` M` | `664` | `356fba23760317fa87e9cbf63d7dbb18a486d6e30ecf4ac8e15f4ef258335fe3` | `apps/bot/src/portfolio/correlation.test.ts` |
| ` M` | `664` | `5a64f80c5407f13fb83f293151acca5510ecba0eb2111f05047c9c63833ce686` | `apps/bot/src/portfolio/correlation.ts` |
| `??` | `664` | `7c63fd13dc7c138a13e34fdd59a79298b46ffdf9afb9fff871cb411beba23dca` | `apps/bot/src/portfolio/portfolio-close-coordinator.ts` |
| `??` | `664` | `38861adcdc59ce8f40a45156065db3f972a3049983df4e58fa87d3d9caef0960` | `apps/bot/src/portfolio/portfolio-close-lifecycle.ts` |
| `??` | `664` | `48d3a37b1f723ea894786a445fa414e8b969cbd3ddf32ce99c8aab981a53b19c` | `apps/bot/src/portfolio/portfolio-manager.close-all-1.test.ts` |
| `??` | `664` | `e25b314c0093a37fae23aabb74982c0ddb7009355ab53358fd98acee983070b2` | `apps/bot/src/portfolio/portfolio-manager.close-all-2.test.ts` |
| `??` | `664` | `711cc97fa0d0c2c48f82be3a6dc7519b2bccc22b0c6c85fca0a9870dd23e21f8` | `apps/bot/src/portfolio/portfolio-manager.close-all-3.test.ts` |
| `??` | `664` | `0dfa5eb8d8a8a026bbadc04e49a6d3267c5981707e0a2a717696714ae9c02092` | `apps/bot/src/portfolio/portfolio-manager.equity-recording.test.ts` |
| `??` | `664` | `d684b14cc6b88eba46c0d22cd89090b2684f2d9b04ec95c8e7de44ca8cb88d7d` | `apps/bot/src/portfolio/portfolio-manager.fill-recording.test.ts` |
| `??` | `664` | `04165cfb5e1d01c3851736beeba56ae56fe27c1fc74a65ad0a9b50bfef1c9be3` | `apps/bot/src/portfolio/portfolio-manager.integration.test.ts` |
| `??` | `664` | `1104e6b058793eeecee97d4815148490d7a6d2c5ad849772a5482a0c829ffe94` | `apps/bot/src/portfolio/portfolio-manager.reset.test.ts` |
| `??` | `664` | `f8eef4d56d92c57edd577b3cfc0be0bca3c5999fcef8a96164bcb5a658720c65` | `apps/bot/src/portfolio/portfolio-manager.strategy-config.test.ts` |
| `??` | `664` | `9eb0051b282ab8730138d1e87be4bf2532a9eabd6c3de452e7bc8b08542ed17c` | `apps/bot/src/portfolio/portfolio-manager.test-support.ts` |
| ` M` | `664` | `1295abca72f41097962c163093e217b5d7d55dcd66f0427c2728c8e6a10c4572` | `apps/bot/src/portfolio/portfolio-manager.test.ts` |
| ` M` | `664` | `90e13b31d17dd01bf4e36060e4433ed368845da32abc000e64b352766b6c1fb9` | `apps/bot/src/portfolio/portfolio-manager.ts` |
| `??` | `664` | `576ed0270f2e301f65a09cd203ab9510dcc12f44cd3238ede8499d7931af5427` | `apps/bot/src/portfolio/portfolio-manager.wiring.test.ts` |
| ` M` | `664` | `cdefe62af0200899bc7ba4c588de66d77b9401c6da49a563619ebd2dac0d1b85` | `apps/bot/src/portfolio/portfolio-stop.test.ts` |
| ` M` | `664` | `c13d153ac12f11f8a30ff02862c06dcf1c07193a1e4da9588c6beff249a235cd` | `apps/bot/src/portfolio/portfolio-stop.ts` |
| ` M` | `664` | `cbec6ad8503f4dcde4683cd4c7b28ee4f95e3c63f349c741fe792c286b4f93f8` | `apps/bot/src/portfolio/risk-budget.test.ts` |
| ` M` | `664` | `60623be41bcaacd05faba7f9b98fe6d10a1e7909bd72bbe873c636d6a9b3eb39` | `apps/bot/src/portfolio/risk-budget.ts` |
| ` M` | `664` | `72a08702ba19a52faeda5162b53d15cdeba7c06b4a249b47a7a23b4e65704e47` | `apps/bot/src/risk/drawdown-scaler.test.ts` |
| ` M` | `664` | `06a2088ef22eceded0b345ecdd52222619aa3021fb6d7dd22f091aad3b8a1866` | `apps/bot/src/risk/drawdown-scaler.ts` |
| ` M` | `664` | `274180c20f67d80e75049268fd0d660e54e8fb5c4e79d980a12791c44e97c625` | `apps/bot/src/risk/kelly.test.ts` |
| ` M` | `664` | `676c166aff6103970aa51cd22b5fd916b84feafbd690c5e71b0ad9b0bfe76df7` | `apps/bot/src/risk/kelly.ts` |
| ` M` | `664` | `e0d1becc1084cd79951cf624ed39b7a48252c6abbd37985a97921ef4fc5c9609` | `apps/bot/src/risk/risk-integration.test.ts` |
| ` M` | `664` | `3c5c0edc91cfd20a82abd99cc9490b034f40d55aef53e10c3da8e4d86d553e7b` | `apps/bot/src/risk/risk-manager.test.ts` |
| ` M` | `664` | `1d79b7448f14f3984721baad463f41fa5b6a5d37688700e6af3a113a993453e2` | `apps/bot/src/risk/risk-manager.ts` |
| ` M` | `664` | `a1d59208089ab66dbe396add7d1e09a9769a147b81d06549bb3ea46a3629bceb` | `apps/bot/src/risk/trailing-stop.test.ts` |
| ` M` | `664` | `2744ae0fe5b40febfed3b48e43b7b13d818676084caa77093f88cbacfa3eee77` | `apps/bot/src/risk/trailing-stop.ts` |
| ` M` | `664` | `0d69dda716aeafee4fbb24dc0b6ce84da2b79e142de6074c91d912af98a0b8b2` | `apps/bot/test/e2e/runtime-driver/bot-cleanup-and-order-risk.ts` |
| ` M` | `664` | `83bfa4d5fdbb5a2e78689b5b8486fdc1ab8b64bdb3c6ad4d7f207459215cd217` | `apps/bot/test/e2e/runtime-driver/bot-lifecycle-factory.ts` |
| ` M` | `664` | `3c7564206242ede7886dc3ee505c4845cfc21bea279258fe0e97e55bba04325e` | `apps/bot/test/e2e/runtime-driver/bot-state-and-telemetry.ts` |
| ` M` | `664` | `b7bb8936cc4663444280fadca0f024d87c936789ec46c7803b848935d44ae31d` | `apps/bot/test/e2e/runtime-driver/bot-subscriptions.ts` |
| ` M` | `664` | `82691d5cbce62ceb12135da315aafe4bbfb867ebda46dbc549ad752afe5997d9` | `apps/bot/test/e2e/runtime-driver/cli-boundaries.ts` |
| ` M` | `664` | `ca8db9f31fb9903f7ff5a6f08852db94b36367aa78988c0e44dd98d614ddd163` | `apps/bot/test/e2e/runtime-driver/config-store.ts` |
| ` M` | `664` | `d57623e554445dde63c6ae8af9d51cd46f284628ccf25307692eb35db87aa056` | `apps/bot/test/e2e/runtime-driver/funding-source.ts` |
| `??` | `664` | `d4de47581bad7ed975df9d4254efece742ae50bd8a916911c5d700b0f1beb906` | `apps/bot/test/e2e/runtime-driver/kill-switch-commands.ts` |
| `??` | `664` | `98e25e31a07c9bb42e6990b1f5297f8d52d2a7d1fcd2a27c86b6446f1424bc98` | `apps/bot/test/e2e/runtime-driver/kill-switch-registry.ts` |
| ` M` | `664` | `1ffa586a1b31b252d68787d81c0d583c9938033550bd411e535b98df1201389d` | `apps/bot/test/e2e/runtime-driver/lifecycle-smoke.ts` |
| `??` | `664` | `f14bcd1b13d8d598c9d6d1a3e98cddff7f57ad9d03b4f05378191943da3809af` | `apps/bot/test/e2e/runtime-driver/native-protection-failsafe.ts` |
| `??` | `664` | `033e3fd9fd6a2ecee31fbee776c6f1d6494e11c5f513b16320f18ca6792baeb5` | `apps/bot/test/e2e/runtime-driver/native-protection-retry.ts` |
| `??` | `664` | `834b055f84800501791f5b0e323044040d294dc795870dc03c3622594ea5c420` | `apps/bot/test/e2e/runtime-driver/order-manager-boundaries.ts` |
| ` M` | `664` | `f3d6264fb0b34a8743009c2ae830385fdbbf86cf8a34af61f8c1ec2bb94d7003` | `apps/bot/test/e2e/runtime-driver/portfolio-manager-authoritative.ts` |
| ` M` | `664` | `3a24367c0e5d4e57373d2c281ff1ef19f4358d613a40855fdc42d8c4577aad0f` | `apps/bot/test/e2e/runtime-driver/portfolio-manager-lifecycle.ts` |
| ` M` | `664` | `4df6974d92393d15b67289503e3c2854fde21293bb39d2236936b87f1bf17a71` | `apps/bot/test/e2e/runtime-driver/portfolio-manager-paper.ts` |
| ` M` | `664` | `76d9d9a23ab81b9985c61d8ea755df28cb03c2e56a13f2a78e62760e3ff961e2` | `apps/bot/test/e2e/runtime-driver/portfolio-primitives.ts` |
| `??` | `664` | `065565ca637f31d1a82adc233aa6a5a387e15e1cb3da6b4d12b2b42055783209` | `apps/bot/test/e2e/runtime-driver/position-manager-boundaries.ts` |
| ` M` | `664` | `16db2b53582769928dd3be4ba68079ad79b73c588e4d74dbcbf29f7a752ecc9b` | `apps/bot/test/e2e/runtime-driver/risk-modules.ts` |
| ` M` | `664` | `4e059983fb24e5840ed6bedc673d340298666dffb3cf24eacb807a2e4db09cfa` | `apps/bot/test/e2e/runtime-driver/runtime-driver-core.ts` |
| ` M` | `664` | `16cab0bb45c641a63b999590b2318d46ad76f6d42ca8fd363c27a777a2745b38` | `apps/bot/test/e2e/runtime-driver/runtime-driver-portfolio-fixtures.ts` |
| ` M` | `664` | `f0a0e33db63067a6cf0ce21cbd1b31e32f9891214148cc81236f7d328e801aef` | `apps/bot/test/e2e/runtime-driver/runtime-driver.ts` |
| `??` | `664` | `65e81ab1f81334c8e8918801fceb954156a20d5c8b8ec2b68e882f8e7c8b669b` | `apps/bot/test/e2e/runtime-driver/state-store-boundaries.ts` |
| `??` | `664` | `3f169db0e610e7a762b7bd2c6f674c697f48bc8d8035084acef977e36b3738f7` | `apps/bot/test/e2e/runtime-driver/strategy-registry-boundaries.ts` |
| `??` | `664` | `1d114cbbb793def36bfe52aa5fc3bda88e1d1d06b3157808111777b040061c03` | `apps/bot/test/e2e/runtime-driver/strategy-runner-facade-coverage.ts` |
| `??` | `664` | `c3774631897f9ccd890769cd0cd45f7023332afcb75bfd3925bbbd653a2de279` | `apps/bot/test/e2e/runtime-driver/strategy-runner-market-lifecycle.ts` |
| `??` | `664` | `9a54a03823c7cf63b3210867b838c4f2cdfb1724ca7b3b2878311745f8d478af` | `apps/bot/test/e2e/runtime-driver/strategy-runner-order-flow.ts` |
| `??` | `664` | `0437f0543b19a9fc26a075fd2e3fc8f94f00382186b606ccfb8859e96e5b9f79` | `apps/bot/test/e2e/runtime-driver/strategy-runner-order-lifecycle-boundaries.ts` |
| `??` | `664` | `370f59f0a7d7825ff7f41bec7bf85780729c6bc8365273bb15993c042ba11363` | `apps/bot/test/e2e/runtime-driver/strategy-runner-plugin-risk-coverage-lifecycle.ts` |
| `??` | `664` | `b0b00967341ddec1a6f82b82b88f89bd0410b18dd9ec64b2787b5c73561d3f46` | `apps/bot/test/e2e/runtime-driver/strategy-runner-plugin-risk-coverage.ts` |
| `??` | `664` | `5e083f7ba5a5030755ad9baf8d90d4af93f4f5672433289bafc6fefb6ba5df95` | `apps/bot/test/e2e/runtime-driver/strategy-runner-plugin-risk.ts` |
| `??` | `664` | `8fefc6949a1b95efbc2f8c6dc0d64a23ef3234869c0f27da7166b6a525b4a999` | `apps/bot/test/e2e/runtime-driver/strategy-runner-protections.ts` |
| `??` | `664` | `997aa54a49c0403096cba53d27a645f36805b45627175f8be8cc7487289a3e00` | `apps/bot/test/e2e/runtime-driver/strategy-runner-risk-lifecycle.ts` |
| ` M` | `664` | `109a40f31b23defc3fee3cb86601969df0760477f790f76e55e004f61df2202c` | `apps/bot/test/vitest.setup.ts` |
| `??` | `664` | `5f8fe94f11960bcf89c4d16c72480705ffe171d56bcfc9df26813a1d5a84ff7a` | `apps/bot/tsconfig.build.json` |
| `??` | `664` | `0805c879c8192169436a6718217b78492ad4f9c36efeca7df6988e565bc07fae` | `apps/bot/tsconfig.e2e.json` |
| ` M` | `664` | `3cf6e482f48f72654818346b908cd7f8783f89c3ba2edbc80d26ed6600e8e4fe` | `apps/bot/tsconfig.json` |
| `??` | `664` | `294cce3516e24b8d528afa936f9f82f898519ffad6fab1f6b736042729ef0ae1` | `apps/bot/vitest.config-command.config.mjs` |
| ` M` | `664` | `5e8d77577076aeac34497bf6b207fd572672a4a8047e7316705241364cd9af2d` | `apps/bot/vitest.config.ts` |
| ` M` | `644` | `a0e18ad15a27fc2cbdbbe49f62c3875b5356e7203ece014398e7a4463cdbad48` | `bun.lock` |
| ` M` | `664` | `96e8830b5ced3853aa5a61c09b11bbb4eedfd857c128f88bb3e8d8c59212ef0d` | `deliverable.md` |
| ` M` | `664` | `14a83e02b181b156839fb4978bf243edc95105b36922af3e96d7d2a0b87915f2` | `docs/LIVE-TRADING.md` |
| ` M` | `664` | `83343c3c9b571fdc68a27b6be7ac4ad59b380b1b4fed0942b9227bff7135c1f8` | `docs/production-strategies/latency-budget.md` |
| ` M` | `664` | `d95d715078ce9f722ecbdce616b34acd361a6416998cc588f5f618bf95fec40a` | `docs/research/sources-stack.md` |
| ` M` | `664` | `bc75d2b630ba45895d084bf0504dcda9600b857f700ed18d2a0686a2f2ac0e5a` | `docs/research/stack-findings.md` |
| ` M` | `664` | `e63a76dbc3f28988bf561615126873d210950afff86c53ea1a0dc78fabc216c3` | `docs/research/tui-decision.md` |
| ` M` | `664` | `e8181b41959edc4fd71852eab97fb96388293372a3f3b4f530d0f22021513e12` | `docs/research/version-pins.md` |
| ` M` | `664` | `e68fd75dfddb653bc30bae91decbbc04089df268742f5adc6f401f8dbc360073` | `docs/STACK.md` |
| ` M` | `664` | `b8fa62c7c2e7e013164ec625a42a8c796a3807390291552a76ac7300945fc6ae` | `eslint.config.js` |
| ` M` | `664` | `75d7cd4cec8d72f5c9b7981966d8b6f95b3872ac0202d1cdbea3c49b410ee265` | `package.json` |
| ` M` | `664` | `1b1ca927f9e7d976ce821577bf29911044c3eb4980bec4b33ae232e2c7662444` | `packages/backtest-tools/package.json` |
| `??` | `664` | `354bd57b610799b96f31f61556ada29bdbd81033194ff42562a02ce4e16bef4b` | `packages/backtest-tools/src/cli/arb-latency-artifact-v2-consistency.test.ts` |
| `??` | `664` | `c0660453c43fb0f6396bbf83251f5d9857edce689eecfec528aa71a0cb2397b1` | `packages/backtest-tools/src/cli/arb-latency-artifact-v2-consistency.ts` |
| `??` | `664` | `fd4356a22f15b77524253108502f44fedd65c11de9e2c3681e7b50458ff64dcb` | `packages/backtest-tools/src/cli/arb-latency-artifact-v2-input-snapshot.test.ts` |
| `??` | `664` | `e02f38b04c16fc02204ccaacb2172603cdc4ddd4dc36d7e52d6f87bec0717696` | `packages/backtest-tools/src/cli/arb-latency-artifact-v2-input-snapshot.ts` |
| `??` | `664` | `11fe2f88a85eb929ca35f78b2c8c777834649b0def097850436223988df6eefb` | `packages/backtest-tools/src/cli/arb-latency-artifact-v2-market-snapshot.test.ts` |
| `??` | `664` | `bbd6396adcbdcb1893d5b138cf7f4461ff118566c6dd2d2df8a85b6e2554c238` | `packages/backtest-tools/src/cli/arb-latency-artifact-v2-market-snapshot.ts` |
| `??` | `664` | `96fa439279a3caeb3ae35db6072bb00d94ab1e2aac9cb80bc73ecae636ea6599` | `packages/backtest-tools/src/cli/arb-latency-artifact-v2-snapshot-primitives.test.ts` |
| `??` | `664` | `e6f6858f7b05c4ed944c9dc9945505abad4159ae24f3baab280108a2889fd060` | `packages/backtest-tools/src/cli/arb-latency-artifact-v2-snapshot-primitives.ts` |
| `??` | `664` | `d7a9c943673c8f37a4767704f8e0236eb65473848e548d7cf4e7a69db0805638` | `packages/backtest-tools/src/cli/arb-latency-artifact-v2-validation.test.ts` |
| `??` | `664` | `4aba5b7c71a1d20d51dd3914f83f2c8823028d347db12ce017c51c95bb572148` | `packages/backtest-tools/src/cli/arb-latency-artifact-v2-validation.ts` |
| `??` | `664` | `662e1a835540fb1f7fc953844db34c9f55f8940415aebeef82dd7b109211b383` | `packages/backtest-tools/src/cli/arb-latency-artifact-v2.test-support.ts` |
| `??` | `664` | `ed35c697b8e05307885a3f35629bc9c02dd35e59fd22be3e32db1e4ae619643b` | `packages/backtest-tools/src/cli/arb-latency-artifact-v2.test.ts` |
| `??` | `664` | `1bb16b43919244dfb9919f999490f32013731a711e544c52201ba8aeb6bcb064` | `packages/backtest-tools/src/cli/arb-latency-artifact-v2.ts` |
| `??` | `664` | `83509a929f2126cb0a1fb17ebc152f94ef53e3108165907e894b41819db24d25` | `packages/backtest-tools/src/cli/arb-latency-calculations.test.ts` |
| `??` | `664` | `40b4903d4fff2910fe13aca4a635913ec2c228f2dc472c71528ca4bd5106a673` | `packages/backtest-tools/src/cli/arb-latency-calculations.ts` |
| `??` | `664` | `0a1a40480dc22214b8ebe71a9aede35f2d98761a4b2396f2ee58c5c320e317d9` | `packages/backtest-tools/src/cli/arb-latency-cli-arguments.test.ts` |
| `??` | `664` | `55f9142dd6456efac38145829b7dbfe4c1946d1af3b0a7c1d99cb6ee0feb0dd6` | `packages/backtest-tools/src/cli/arb-latency-cli-arguments.ts` |
| `??` | `664` | `7d529c33ae8ca60744b2c8270e7a373067d270ed38f5b6aa635d8fdf3bb44181` | `packages/backtest-tools/src/cli/arb-latency-exact-boundary.test.ts` |
| `??` | `664` | `d64a18473fe0131d03c6d25168be008116836325f79ce7804a49b1adc0858ee4` | `packages/backtest-tools/src/cli/arb-latency-exact-boundary.ts` |
| `??` | `664` | `0728973970c7f46971aacc42ca50e0f8cb497be443c36d76a47cd8af3129119d` | `packages/backtest-tools/src/cli/arb-latency-exact-calculations.test.ts` |
| `??` | `664` | `360257e105ff557b56059548dbbd1e1f0b9ac66647ca73cc8e0b21a01dc55fd6` | `packages/backtest-tools/src/cli/arb-latency-exact-calculations.ts` |
| `??` | `664` | `32861bc3027c2c84ae4c297c3f4967340ac8f214938790d0e2d7e2465463e9b7` | `packages/backtest-tools/src/cli/arb-latency-exact-collector.test.ts` |
| `??` | `664` | `c89109662521ffff30af4b73f48e7f6f189737a4cdb5c89c44686e6b8631152d` | `packages/backtest-tools/src/cli/arb-latency-exact-collector.ts` |
| `??` | `664` | `eba05d6e00bb2c0d54f9a5530420259576361765fb3723b0a3919182e81f9ed0` | `packages/backtest-tools/src/cli/arb-latency-output-contract.test.ts` |
| `??` | `664` | `906830755bcddf343b9242083e6f1630a576b9d19550ce0d1a6077198920b5d9` | `packages/backtest-tools/src/cli/arb-latency-output-contract.ts` |
| `??` | `664` | `aea0e0eed96a73d6a6cb70af8ab0014b7dcf47922a3c593fe31932729a1d16b4` | `packages/backtest-tools/src/cli/arb-latency-secure-output-writer.failures.test.ts` |
| `??` | `664` | `a0e8918774ea1201bb9737bf4c3d37a8c91e7cbbdcfd0a7ae7150ddce16dfec3` | `packages/backtest-tools/src/cli/arb-latency-secure-output-writer.test-support.ts` |
| `??` | `664` | `8abf601f9313d954bc0f2f553da99fd422d9071cbeda99905de3626a2e745f50` | `packages/backtest-tools/src/cli/arb-latency-secure-output-writer.test.ts` |
| `??` | `664` | `f4a0730bfa5f03ce0516d677d3f3b83dd9ac67e669314ff336a8449a3164176a` | `packages/backtest-tools/src/cli/arb-latency-secure-output-writer.ts` |
| `??` | `664` | `f80bbaeeb2c37d959b39f07dad481e7135d84f2f6f235aca3595365c5848b863` | `packages/backtest-tools/src/cli/ccxt-package-provenance.test.ts` |
| `??` | `664` | `a2a0abaf0ab8f3dd02cd1820e5784d6341b146b80d125e086aad0a70cbb907c2` | `packages/backtest-tools/src/cli/ccxt-package-provenance.ts` |
| `??` | `664` | `6e1cff2496cca227170a82d1c9aa997c9e851e9e00205695ca250cddc5dfb263` | `packages/backtest-tools/src/cli/run-arb-latency.logging.test.ts` |
| ` M` | `664` | `b20ecac47dd062b46fe84f92e2a191d772a10075d64613ba44c07096d83c4d01` | `packages/backtest-tools/src/cli/run-arb-latency.ts` |
| `??` | `664` | `8d7fc37da6b69f1fc5a97760dbd806768af6c083ec62341db4764c04d3e52b6f` | `packages/backtest-tools/vitest.arb-latency-artifact-v2-input-snapshot.config.mjs` |
| `??` | `664` | `8bb0a2c05a754c3607b2f2b7ade22f0479129fc36b9b2b3b7812987b9f57fb3c` | `packages/backtest-tools/vitest.arb-latency-artifact-v2-market-snapshot.config.mjs` |
| `??` | `664` | `2474737fc24731aa489a085f8b8fc98510e5f3ee0e91e48cb177880068a142c1` | `packages/backtest-tools/vitest.arb-latency-artifact-v2-snapshot-primitives.config.mjs` |
| `??` | `664` | `7f6321136ed4566bf394e354086e1b09442daf950fd7fa096eccdc33985ac676` | `packages/backtest-tools/vitest.arb-latency-artifact-v2.config.mjs` |
| `??` | `664` | `18f3a8b66159ddff701994b20404ecc72eac5fb8484957709af09d3568531049` | `packages/backtest-tools/vitest.arb-latency-cli-arguments.config.mjs` |
| `??` | `664` | `a3b513cb3f539c48fdc83f90ae0ff0a9b934529e28fec7fcc51caf8ade358ea8` | `packages/backtest-tools/vitest.arb-latency-exact-boundary.config.mjs` |
| `??` | `664` | `e1a5f28e9a0ac1f769310de1a44e7128e835e6f68d9ee05a7f728bd452c85083` | `packages/backtest-tools/vitest.arb-latency-exact-collector.config.mjs` |
| `??` | `664` | `a23a5f5b9448e25432d46447f787b9a38d2ce582a356dba358376231fef02389` | `packages/backtest-tools/vitest.arb-latency-exact.config.mjs` |
| `??` | `664` | `e5b5de8dcc9bdb68948949c7161a3eeef6a27ed9dbe435a83985853e5af51444` | `packages/backtest-tools/vitest.arb-latency-output-contract.config.mjs` |
| `??` | `664` | `c971842085f7e9a812b2bc19638b62957686e5168d2fd84c0bcfd498c5bb6374` | `packages/backtest-tools/vitest.arb-latency-secure-output-writer.config.mjs` |
| `??` | `664` | `bb379759084c306385b861c7555578193f2d2f5a77768cdd6f64014dc28635f5` | `packages/backtest-tools/vitest.ccxt-provenance.config.mjs` |
| ` M` | `664` | `9c4fff38fe7b9d60557085af8a633a910194b8b7d5148ed7498f188471e4d939` | `packages/exchange/package.json` |
| ` M` | `664` | `be96a67039314db4b2984c578d088c5b66825385a76e5518b506e04741f7d59e` | `packages/exchange/src/__testing__/mockFeed.test.ts` |
| `??` | `664` | `f30ed900f84b94c893d7361af9fe387c1fcf43fa3ee22d94e4aa3d34aac56820` | `packages/exchange/src/bybit-eu-adapter.test-support.ts` |
| ` M` | `664` | `efee5dc5f9110604c3ccef284a6ff8664cd10a1ba82db13c5e0e1ee6a0645fa4` | `packages/exchange/src/bybit-eu-adapter.test.ts` |
| ` M` | `664` | `3e539021bf237fdd4e29c27a915cac1733856d57d1d75d171f9cdbe602b8748a` | `packages/exchange/src/bybit-eu-adapter.ts` |
| `??` | `664` | `bebf84b9cd23b66f17bf8481fbbef079beccb802a50a40745025c9b132c71cbc` | `packages/exchange/src/bybit-eu-client.ts` |
| `??` | `664` | `aeb36567041e355a08d506ba29e7c170a708127dc3addaf8c13e4fd46c69c1a5` | `packages/exchange/src/bybit-eu-feed.fetch.test.ts` |
| `??` | `664` | `78d0df0017d78ea09361c9d9150c8a727ab073f75472de3e1c50c5c459025a9a` | `packages/exchange/src/bybit-eu-feed.lifecycle.test.ts` |
| `??` | `664` | `981f1f9ce56347e9688b8440e6ed0c1302668d2ba3d02f385ec99d77c4f5a060` | `packages/exchange/src/bybit-eu-feed.orders.test.ts` |
| `??` | `664` | `68f88a1037bbe7c88339f109aaa327ee9353957c8aa9e01be7e2bbb67ebc31ca` | `packages/exchange/src/bybit-eu-feed.subscription-base.test.ts` |
| `??` | `664` | `fc586ce6355d349086c0c815d1126d6485a91007a62e94518c5bd1e97ead190e` | `packages/exchange/src/bybit-eu-feed.subscription-resilience.test.ts` |
| `??` | `664` | `e4e1744c9fe9a36e8d3b23ac0c1242de38782957ae122679edfb788d603e867e` | `packages/exchange/src/bybit-eu-feed.test-support.ts` |
| `??` | `664` | `151e884c73a61931a92ccc671ed51cbd3fcdedaea742551b99a21c14a42ca47a` | `packages/exchange/src/bybit-eu-feed.test.ts` |
| `??` | `664` | `625efccc19bca57ceb507fb1d0d545ccad293bfafece05a2ea2ae315801dfd82` | `packages/exchange/src/bybit-eu-feed.ts` |
| `??` | `664` | `56946a067c2cb8dbf9164b0a5503c4459b0a8e73036c12b27e122b3c38a5d4fe` | `packages/exchange/src/bybit-eu-normalizers.ts` |
| `??` | `664` | `ba51ca9a7c4b90cef97c07809677b957644c6947775e423a63e6e2f04f806289` | `packages/exchange/src/bybit-eu-order-service.ts` |
| `??` | `664` | `6e0258683577e825a842ac4ccf23c25a778e829ca141aa8b5308627438e25f74` | `packages/exchange/src/bybit-eu-raw-payloads.ts` |
| `??` | `664` | `d3d3326b09ade95f4819ffbd243a3780309ed6acb5a5713a61f9f3317b4eb8f9` | `packages/exchange/src/bybit-eu-spot-margin-client.ts` |
| `??` | `664` | `2a181c0b9fa8be086681600d9dc45cf0f5b537d1b9defabdf6424c23dc86e340` | `packages/exchange/src/bybit-eu-spot-margin-order.test.ts` |
| `??` | `664` | `6d224337e5a69e88bc31683a9dbeb0c077f8f00c5bcedb2c46be160371084305` | `packages/exchange/src/bybit-eu-subscription-manager.ts` |
| ` D` | `deleted` | `deleted` | `packages/exchange/src/bybitEuFeed.test.ts` |
| ` D` | `deleted` | `deleted` | `packages/exchange/src/bybitEuFeed.ts` |
| `??` | `664` | `a47e4af054622a5598e2db1ea098bcf23d05c7f2c0a7e591ec44155503fa3f2f` | `packages/exchange/src/client-order-id.ts` |
| ` M` | `664` | `5d26e0cc88c66e83427532637b587f16f258a77ec317e5ab78deef41d42a3c81` | `packages/exchange/src/factory.test.ts` |
| ` M` | `664` | `a360da523156c96b923fd8bc5d5e568c249c1b55b6493c06fd31f0aedf72b677` | `packages/exchange/src/factory.ts` |
| ` M` | `664` | `c2be41a9594b4382d7809a181bb5cc5e99aa4d43fec28a9a34fb76d735678371` | `packages/exchange/src/index.ts` |
| `??` | `664` | `5c30d865162d979a9a690fdec1ec387dd6b3ff5bce4277bdf7154f477da34744` | `packages/exchange/src/spot-margin-authorization.test.ts` |
| `??` | `664` | `3c1f8c994ddff96f0fa74f4b81fdf3ac1df12b3edf818551c6e7a04951ecffca` | `packages/exchange/src/spot-margin-authorization.ts` |
| ` M` | `664` | `a33f6f4421bbfe1153890781617c073ecd9cd6ee00c87885e4ddd1b72e0910fc` | `packages/exchange/src/symbols.test.ts` |
| ` M` | `664` | `295f239ddc37b95e88a68e63ba06c0d31aa695de521e55f3a25f3599d0c4237e` | `packages/exchange/src/types.ts` |
| `??` | `664` | `0f97fa7e578e05c26bfc1f754f970546c146e4dea7f8eb45b92cff80dedf70d3` | `packages/exchange/tests/bybit-eu-feed-normalizers.test.ts` |
| `??` | `664` | `b228f89d771b361fea0f5a9e96618e3de6c5131942d99efe209a6cad12b8cf7a` | `packages/exchange/tests/bybit-eu-feed-watch-lifecycle.test.ts` |
| `??` | `664` | `f8e57bf1990352b322f6d4b9607f7354c88df9340bf7afa6d7f348d6d3da0bd3` | `packages/exchange/tests/bybit-eu-feed-watch-operations.test.ts` |
| `??` | `664` | `c11c997dc41f05584148380b26707df442477cf4a085a6a5b48c74d11c7f7844` | `packages/exchange/tests/bybit-eu-feed-watch.test-support.ts` |
| ` D` | `deleted` | `deleted` | `packages/exchange/tests/bybitEuFeed-watch.test.ts` |
| ` D` | `deleted` | `deleted` | `packages/exchange/tests/bybitEuFeed.test.ts` |
| ` M` | `664` | `689061340f64cd95b7603213c345f2f63daecb199262bf8a29006b476fbc8cde` | `packages/exchange/tests/factory.test.ts` |
| ` M` | `664` | `bcd3b4b4cec9f00995391509291c5db3ebe6067bc982525c36920cc01192c788` | `packages/exchange/tests/mockFeed.test.ts` |
| `??` | `664` | `89a1d2a2cad5e0d77335a361b21ca7658e7b40162be738a1351d050581793656` | `packages/exchange/tsconfig.tests.json` |
| `??` | `664` | `af065345d39e784d585f9d15fca25f4cbfade3518016cbc08349a79aaedc71fa` | `packages/exchange/vitest.bybit-eu-adapter.config.mjs` |
| ` M` | `664` | `e8a085c08bc01fd217b2edee36eaa54376b9d3316178b3a888e34534b248d678` | `packages/shared/package.json` |
| ` M` | `664` | `f16a7df2d3125a6a3e90e361f08bee336997ccb461a53b20e56e6c11d61d023b` | `packages/shared/src/index.ts` |
| ` D` | `deleted` | `deleted` | `packages/shared/src/logger.test.ts` |
| ` D` | `deleted` | `deleted` | `packages/shared/src/logger.ts` |
| ` M` | `664` | `e0630acc1929f7d7ec712293d7f2eafdb29f31a520fa964b95ec7038090bbbbf` | `packages/shared/src/public-api.test.ts` |
| ` M` | `664` | `4efdd99e39ae8adbdb4799ea93113865e970590e07fe891131cb526288a6f326` | `plans/full-refactor/APPROVALS.md` |
| ` M` | `664` | `ea7b4f2140c60aa0ef25f73e8f807740e85f37ea91f04412ceaebf5016902d2b` | `plans/full-refactor/ARCHITECTURE.md` |
| ` M` | `664` | `7ecc40caa82bae59722aa946a23da1a200079ea00f3b0e77e8ae2000feb1efa5` | `plans/full-refactor/DECISIONS.md` |
| ` M` | `664` | `ee5173829e6e639bd361c55d7f7bf429dab1e2b25d9161e688090774ba28d025` | `plans/full-refactor/DEPENDENCIES.md` |
| `??` | `664` | `c55a0a82258ee4305c073dbe3032a9e8816eeffc8208080b78f6fd0d4beec660` | `plans/full-refactor/evidence/c4c-agy-market-controller-brief.xml` |
| `??` | `664` | `0decf698edfb710d180dce0d51213d60756cab26471b883da72bc730e45cfa88` | `plans/full-refactor/evidence/c4c-agy-market-controller-evaluation.md` |
| `??` | `664` | `c640ad61dcb8d6aeb492f383c2231cfd85293669dd7281d81d5c3b38de447d9b` | `plans/full-refactor/evidence/c4c-agy-market-controller-rework.xml` |
| `??` | `664` | `3adc59f328f8ee78af22b7183338047b3db8ff467b7e2adba235ae3263af5999` | `plans/full-refactor/evidence/c4c-command-ledger.md` |
| `??` | `664` | `9b746cc162e501948bc4b4be114bdec7ec1e861f1fdb1566c223ec643f02bcdb` | `plans/full-refactor/evidence/ccxt-4.5.75-upgrade-validation.md` |
| `??` | `664` | `af3a98026c7e38c4739745b34cd7153cb640d4c4b188833daa78e7dec90d4f95` | `plans/full-refactor/evidence/d07-config-cli-removal.md` |
| ` M` | `664` | `c086b2cb3222522640093c817cc3131045b9e8d6c85784f535f7f4af7682f8a0` | `plans/full-refactor/evidence/d07-zero-legacy-scanner-slice.md` |
| `??` | `664` | `706b7bb03a501722291528a7181fc9eeb0b651eb68ea3526cf2460ce10985145` | `plans/full-refactor/evidence/d10-bybiteu-connection-config-execution-2026-08-24.md` |
| ` M` | `664` | `d14977bff7f794e11f06c9d91325e30bb05021243f4539f0829751e856e537f6` | `plans/full-refactor/evidence/slice-b-over-500-files.tsv` |
| ` M` | `664` | `89651203cd3cb3fe30ba5abe18e6c78852c343b53c1dd3d6ff77e3ed8724188c` | `plans/full-refactor/evidence/slice-b-selected-files.txt` |
| ` M` | `664` | `01c879a622ca885b5848e85367821fc7a90193eb1c4877697f3735e2eddbf420` | `plans/full-refactor/EXECUTION-RECORD.md` |
| ` M` | `664` | `467b82979c206909e975cea3a031c6a652e8cd7240751dca4438b13425031ccb` | `plans/full-refactor/REVIEW-EVIDENCE.md` |
| ` M` | `664` | `a83c220b7ef9f70608b9e49d26737a9044ffa6cf1a58c9d5e54d2e365a55acee` | `plans/full-refactor/ROLLBACK.md` |
| ` M` | `664` | `ec0fd6b4a5b36a5120fd76307417382861ec3f2d8c1afcdcee587695f4f73ce3` | `plans/full-refactor/VALIDATION.md` |
| ` M` | `664` | `c217a22a362025df761e3a3279dd954abdc36976269bbb036d39521e63469bfb` | `run-bot/config/default.toml` |
| ` M` | `664` | `7ef2b01d7ba7712fbde2c378293074ea67df780fa2cdd88c1849262e27301196` | `run-bot/config/paper-backtest-verified.toml` |
| ` M` | `664` | `3d18193f637a4a5a88b94f489404c4ccb853083eb8209fef3ac6fe93f145a8d4` | `scripts/coverage-tools/bot-runtime-scope.json` |
| ` M` | `664` | `d9134b835b381c4ce32a66bcc9b94e31d23437070e7a031194250ea10f54e9f2` | `scripts/coverage-tools/bot-runtime-scope.test.ts` |
| ` M` | `664` | `32c7e2561371265920f51663f409360679413a8113345f8fd8d2caa9076a5ebc` | `scripts/coverage-tools/bot-runtime-scope.ts` |
| ` M` | `664` | `84518928526b88fdf99e39fbc7c1c2dce19708232e9c8fc48cbe91a66eb0fa4b` | `scripts/coverage-tools/build-bot-e2e.ts` |
| ` M` | `664` | `a0cbd941ccb8cf9479109f36d090be2573b4d7c53d99608446181779c7db6005` | `scripts/coverage-tools/run-bot-e2e-coverage.ts` |
| ` M` | `664` | `1d7b49b295ce6ccf1cf7dc9526047770439f2d90278f04f0b9f0306c68eb56f2` | `scripts/tooling/toolchain-contract.test.ts` |
| ` M` | `664` | `9a1bee4b3f14020c00fece05c9bb2ec5ded8120a26c69320d78a974303c1bfb0` | `turbo.json` |

## Materialization and reconciliation record

- Materialization was performed only after source HEAD, clean-index, NUL-status digest, per-path type/mode/SHA-256 manifest, and target base/index checks passed.
- Exact overlay result: 118 modified tracked files copied with bytes and modes preserved; 175 untracked regular files copied with bytes and modes preserved; 8 source deletions reproduced in the target. No rename, symlink, special file, index, or HEAD drift was accepted.
- Immediately after overlay, all 301 frozen source records matched the target byte-for-byte and by mode. Of the committed D-02 49 paths, the 38 not dirty in the source were proved byte-identical to `762d629`; the remaining 11 are the authorized semantic-conflict set.
- After the allowed semantic work began, a fresh source status digest remained `d214e9023284e723652ac89bcbb92fb5502d94d68e21dde2c577faf9b688cd41`; all 290 non-semantic overlay records still match that frozen source snapshot byte-for-byte and by mode.

## TDD and closure outcome

- RED was observed with `bun test apps/bot/src/cli/commands/config.test.ts apps/bot/src/cli/commands/start-log-routing.test.ts apps/bot/src/cli/commands/kill-switch-dry-run.test.ts apps/bot/src/cli/cli-e2e.test.ts`: the new root-admission tests failed exactly because the prior overlay loaded implicit defaults (config `0` rather than `2`, start `1` rather than `2`, dry-run `1` rather than `2`, CLI `0` rather than `2`). The pre-existing `strategies` E2E case also failed with the D-02 runtime-root diagnostic because it had no root fixture.
- The allowed production changes restore root resolution before config loading/state/bot/write in `config.ts`, `start.ts`, `kill-switches.ts`, and `kill-switch-dry-run.ts`; explicit nonempty config paths use `resolveConfigPath` and bypass the resolver. `config init` now receives the externally resolved template and still defaults only its output to `./mm-bot.toml`.
- BLOCKED: the focused GREEN candidate command exited 1 with 23 failing tests. Required semantic test changes exist outside the 11-path ownership and cannot be invented under this brief:
  - `apps/bot/src/cli/commands/start-log-routing-command.test.ts` expects implicit no-config loader/default behavior and must inject a valid external runtime-root resolution for its loader, lifecycle, and live-activation cases.
  - `apps/bot/src/cli/commands/kill-switch-dry-run.command.test.ts` expects its no-config loader-failure case to reach the loader; it now correctly returns exit 2 before state/config access.
  - `apps/bot/src/cli/commands/kill-switches.command.test.ts` expects no-config command execution and loader-failure handling without a runtime root; it now correctly returns exit 2.
- Additional in-scope test reconciliation is also required before a GREEN rerun: `cli-e2e.test.ts` needs an external runtime-root fixture for its `strategies` and `config init` success cases; `config.test.ts`, `start-log-routing.test.ts`, and `cli-boundaries.ts` contain later default-path expectations that must use an injected valid resolver or explicit config where the test intent is not missing-root failure. The latter files are within the authorized 11; the three files above are not.
- No coverage, typecheck, build, lint/format, LOC, secret, unused-file, or final equality claim was run because the transitive ownership blocker prevents a truthful GREEN gate. No source-worktree file, Git index, or commit was changed.

## Fix round 1 ownership expansion

The coordinator authorizes only these three existing test paths, because they directly assert the superseded implicit no-config behavior and are required consumers of the approved D-02 contract:

- `apps/bot/src/cli/commands/start-log-routing-command.test.ts`
- `apps/bot/src/cli/commands/kill-switch-dry-run.command.test.ts`
- `apps/bot/src/cli/commands/kill-switches.command.test.ts`

No new file or production scope is added. The same Terra route, authority boundaries, prohibitions, and validation gates apply. If further semantic ownership is required, stop with exact dependency evidence.

Fix round 1 result: BLOCKED after 166/171 focused tests PASS; five failures are confined to two newly identified stale D-02 base tests. The three authorized test migrations and all prior in-scope reconciliations are complete; frozen source/index proofs remain unchanged.

## Fix round 2 ownership expansion

The coordinator authorizes only these two existing test paths:

- `apps/bot/src/cli/commands/start-log-routing-lifecycle.test.ts`
- `apps/bot/src/cli/commands/read-only-command-config-coverage.test.ts`

The lifecycle test must follow the later structured-stderr contract and must not recreate obsolete `<state_file>.log` output. The read-only command fixtures must be reconciled to the current public command behavior with explicit valid configuration/output boundaries. No new file, production edit, compatibility path, or hidden fallback is authorized. The same route and gates apply.

Fix round 2 result: the two authorized files are GREEN (8/8, 38 assertions). The governed 24-file D-02 candidate is 211 PASS / 5 FAIL / 666 assertions; five failures are confined to two stale split E2E test files.

## Fix round 3 ownership expansion

The coordinator authorizes only:

- `apps/bot/src/cli/cli-e2e-signal.test.ts`
- `apps/bot/src/cli/cli-e2e-core.test.ts`

Migrate obsolete `<state>.log` assertions to the current structured-stderr behavior and update the stale validation text to the current `[start] START_CONFIG_INVALID` public diagnostic. Do not alter production behavior, recreate log-file compatibility, add files, or broaden scope. The same route and full gates apply.

Status: FIX ROUND 3 PENDING.

## Fix round 1 result

- Source freeze remains valid: source index clean and source NUL-status SHA-256 `d214e9023284e723652ac89bcbb92fb5502d94d68e21dde2c577faf9b688cd41` were rechecked before the round.
- Authorized test migrations completed without production-scope expansion:
  - `kill-switch-dry-run.command.test.ts` now gives its loader-error case an explicit config path, preserving that test's loader boundary rather than bypassing runtime-root admission.
  - `kill-switches.command.test.ts` now uses an explicit default-template path for normal behavior and an explicit synthetic path for the mocked loader error.
  - `start-log-routing-command.test.ts` now asserts the later dirty structured-logger behavior (no state-file log artifact and stable sanitized start codes) instead of the superseded file-redirection output.
- In-scope reconciliation completed for `config.test.ts`, `start-log-routing.test.ts`, `cli-e2e.test.ts`, `cli-boundaries.ts`, and `bot-runtime-scope.json`: ordinary default-path tests now inject or materialize an external runtime root; missing-root tests still require exit 2 before side effects; the coverage scope is the union of later dirty runtime/test coverage with the D-02 runtime-root additions.
- Focused candidate command ran 171 tests across 16 files: 166 passed, 5 failed. The previously authorized 3 expanded tests and the 11 conflict-path tests passed. The remaining failures establish a new ownership dependency:
  - `apps/bot/src/cli/commands/start-log-routing-lifecycle.test.ts` is a D-02 base test outside ownership. It still requires the superseded state-file `.log` redirection, while later dirty `start.ts` correctly emits structured logger events to stderr and does not create `<state_file>.log`. Three assertions fail with ENOENT for the expected `.log` files.
  - `apps/bot/src/cli/commands/read-only-command-config-coverage.test.ts` is a D-02 base test outside ownership. Its two success fixtures for `createStrategiesCommand` and `createKillSwitchesCommand` exit 1 against the later dirty command behavior, so its output/fixture semantics must be reconciled rather than masked.
- No coverage/typecheck/build/lint/format/final equality claim was run after this new blocker. No source-worktree file, staging, commit, or self-review occurred.

Status: BLOCKED — authorize only the two named D-02 base tests (or provide an alternative approved reconciliation) before continuing.

## Fix round 2 result

- The authorized lifecycle migration removes the obsolete `<state_file>.log` expectation and uses `RecordingLogger` to assert the public structured events `bot.lifecycle.run.completed`, `bot.lifecycle.run.failed`, `bot.lifecycle.shutdown.completed`, and `bot.lifecycle.shutdown.failed`. It adds no compatibility output or production change.
- The authorized read-only command migration removes an invalid synthetic open-record fixture and instead supplies a schema-valid configuration through the existing public resolver/load/output seams. It asserts public strategy and kill-switch output only.
- TDD evidence: the previous focused candidate was RED exactly at the stale state-file log assertions (`ENOENT`) and the invalid read-only success fixtures (both exit `1`); the two authorized files are GREEN with `bun test apps/bot/src/cli/commands/start-log-routing-lifecycle.test.ts apps/bot/src/cli/commands/read-only-command-config-coverage.test.ts` — 8 pass, 0 fail, 38 expectations.
- Full governed D-02 candidate test list then ran: `bun test` across the evidence's 24 test paths reported 211 pass, 5 fail, 666 expectations. All currently authorized files pass. The five failures establish an additional exact semantic-test ownership dependency:
  - `apps/bot/src/cli/cli-e2e-signal.test.ts` has three subprocess signal cases that still read `<state_file>.log`; later dirty `start.ts` correctly writes structured lifecycle records to stderr and produces no such file. Each failed with `ENOENT` at lines 63, 120, and 177 after the expected cleanup behavior completed.
  - `apps/bot/src/cli/cli-e2e-core.test.ts` has two stale assertions: `start-invalid-config` expects the former `Config validation FAILED` text but later dirty behavior deliberately emits the stable structured stderr code `[start] START_CONFIG_INVALID`; `start-mock-no-feed` still reads `<state_file>.log` and fails with `ENOENT` after its existing stderr assertion.
- No coverage, typecheck, build, lint, format, equality, LOC, secret, unused-new-file, or final status gate was run after this newly discovered ownership blocker. No source-worktree file, Git index, or commit was changed.

Status: BLOCKED — authorization is required only for `apps/bot/src/cli/cli-e2e-signal.test.ts` and `apps/bot/src/cli/cli-e2e-core.test.ts` (or an alternative approved reconciliation) before continuing.

## Fix round 3 result

- The authorized signal E2E now passes an actual `StructuredLogger` with `StderrJsonSink` through the public `runHeadless` logger boundary. It asserts structured stderr events for signal receipt and graceful/failed shutdown, including Error and string failure payloads; no state-file log artifact or compatibility output is recreated.
- The authorized core E2E now asserts the current stable `[start] START_CONFIG_INVALID` diagnostic and the public structured `bot.lifecycle.run.failed` stderr event for the mock-feed fail-closed path. The subprocess evidence established that `run.failed` (not `runner.failed`) is the emitted event.
- TDD evidence: the prior 24-file candidate was RED at exactly these five stale expectations; after the two authorized-file changes, `bun test apps/bot/src/cli/cli-e2e-signal.test.ts apps/bot/src/cli/cli-e2e-core.test.ts` is GREEN — 17 pass, 0 fail, 66 expectations. The full governed D-02 focused list is GREEN — 216 pass, 0 fail, 672 expectations.
- BLOCKED at mandatory unit coverage: `bun run coverage:bot:unit` ran 92 test files / 896 tests successfully but exited `1` because the current 61-runtime-file union scope is not exact: statements `3647/3741` (97.48%), branches `1932/2154` (89.69%), functions `701/708` (99.01%), lines `3431/3500` (98.02%).
- This is not attributable to either authorized round-3 E2E file. The coverage map identifies uncovered runtime branches across later dirty bot, order, state-store, strategy-runner, portfolio, risk, and dry-run modules, for example `apps/bot/src/bot/strategy-runner-native-protection-controller.ts` (S 90.40/B 70.10/F 100/L 92.10), `apps/bot/src/bot/strategy-runner-plugin-risk-controller.ts` (S 93.10/B 73.33/F 100/L 95.39), `apps/bot/src/cli/commands/kill-switch-dry-run-state.ts` (S 31.81/B 27.27/F 60/L 26.31), and `apps/bot/src/cli/commands/kill-switch-dry-run-report.ts` (S 83.87/B 58.33/F 71.42/L 89.28). Reaching the required exact unit gate needs new tests and likely further current-dirty test ownership beyond this D-02 reconciliation brief.
- Per the stop rule, no E2E coverage, typecheck, build, lint, formatter, equality, LOC, secret, unused-new-file, or final status gate was run after this new dependency was established. Coverage output is ignored; no source-worktree file, staging operation, or commit was changed.

Status: BLOCKED — authorize a separately bounded coverage-test ownership scope for the listed uncovered runtime surface, or adjust the governing validation authority; no safe in-scope continuation remains.

## Coverage-closure decomposition dispatch

- Task class: read-only decomposition of the governed bot unit-coverage deficit exposed by the integrated dirty union.
- Mode: read-only planning phase of the existing Terra implementation task; no source/test/manifest writes in this phase.
- Ownership: inspect only the 61 runtime files and executed unit-test manifest selected by `scripts/coverage-tools/bot-runtime-scope.json`; propose an exact, non-overlapping list of existing test paths and only strictly necessary new test paths.
- Package count: `apps/bot` plus the read-only root coverage-scope contract.
- Domain risk: later dirty bot/order/portfolio/risk surface; tests only, no trading/risk/runtime behavior authority. Terra trigger remains.
- Reasoning shape: consume actual V8/LCOV zero counts, map every uncovered statement/branch/function/line to public behavior or a proven unreachable invariant, and minimize the file graph.
- External/mutable resources: local isolated union and test execution only; no network/live exchange/external writes/dependency changes.
- Review role: non-review; fresh TECH/PROCESS remain mandatory after implementation.
- Route: existing mandatory `terra_worker`, `gpt-5.6-terra` / high, workspace-write profile but explicitly read-only for this phase; effective model/effort not observable; no fallback.
- Required result: exact uncovered runtime/line/branch inventory; exact proposed test ownership; identification of any branch that cannot be covered without production or product/risk semantics change; proof that every proposed new file is necessary, referenced by the governed manifest, and <=500. No coverage weakening, private casts, compatibility path, stage, commit, self-review, or scratch deliverable.

Coverage-closure decomposition result: DONE. The governed scope has 30 exact runtime files and 31 runtime files with 94 uncovered statements, 222 branch arms, 7 functions, and 69 lines. Every gap maps to an existing public/DI-driven test home; no new file is currently necessary. Runtime/product behavior changes, private casts, impossible-state mocks, and coverage weakening are not authorized.

## Coverage-closure test implementation dispatch

- Task class: exact public-boundary unit-test completion for the integrated dirty bot runtime.
- Mode: write, non-review; tests only.
- Exact ownership (existing files only):
  - `apps/bot/src/bot/bot-runtime-controller.test.ts`
  - `apps/bot/src/bot/bot.lifecycle.test.ts`
  - `apps/bot/src/bot/kill-switches.coverage.test.ts`
  - `apps/bot/src/bot/order-lifecycle-controller.test.ts`
  - `apps/bot/src/bot/order-manager.placement.test.ts`
  - `apps/bot/src/bot/order-manager.faults.test.ts`
  - `apps/bot/src/bot/position-manager.state-restoration.test.ts`
  - `apps/bot/src/bot/position-manager.test.ts`
  - `apps/bot/src/bot/state-store.test.ts`
  - `apps/bot/src/bot/strategy-market-event-controller.boundary.test.ts`
  - `apps/bot/src/bot/strategy-runner.native-paper-coverage.test.ts`
  - `apps/bot/src/bot/strategy-runner-order-lifecycle-controller.boundary.test.ts`
  - `apps/bot/src/bot/strategy-plugin-risk-controller.trailing-boundary.test.ts`
  - `apps/bot/src/bot/strategy-runner.plugin-emergency-close.test.ts`
  - `apps/bot/src/bot/strategy-runner.test.ts`
  - `apps/bot/src/bot/strategy-runner.trailing-risk-close.test.ts`
  - `apps/bot/src/cli/commands/config-roundtrip.test.ts`
  - `apps/bot/src/cli/commands/kill-switches.command.test.ts`
  - `apps/bot/src/cli/commands/kill-switch-dry-run-report.test.ts`
  - `apps/bot/src/cli/commands/kill-switch-dry-run.state-loading.test.ts`
  - `apps/bot/src/cli/commands/kill-switch-dry-run.command.test.ts`
  - `apps/bot/src/cli/commands/start-log-routing-command.test.ts`
  - `apps/bot/src/cli/commands/read-only-command-config-coverage.test.ts`
  - `apps/bot/src/config/store-sections.test.ts`
  - `apps/bot/src/config/strategy-registry.test.ts`
  - `apps/bot/src/portfolio/correlation.test.ts`
  - `apps/bot/src/portfolio/portfolio-manager.close-all-2.test.ts`
  - `apps/bot/src/portfolio/portfolio-stop.test.ts`
  - `apps/bot/src/risk/risk-manager.test.ts`
- Package count: one runtime package (`apps/bot`); root coverage scope remains read-only and unchanged.
- Domain risk: order, position, strategy protection, portfolio, kill-switch, and risk behavior are safety-critical Terra triggers; authority is strictly characterization/regression tests via public injected ports and paper/test fixtures. No live exchange/order, leverage, risk-policy, runtime, config, manifest, package, or dependency change.
- Reasoning shape: close the exact measured V8 zero-count matrix without fabricating invalid states; prefer existing public seams and deterministic Result/error outcomes.
- External/mutable resources: isolated local worktree and temp fixtures only; no network, live system, external writes, or dependency changes.
- Review role: non-review; fresh `terra_reviewer` TECH and `luna_process_reviewer` PROCESS remain mandatory.
- Route: existing mandatory `terra_worker`, `gpt-5.6-terra` / high, workspace-write; effective model/effort not observable; no fallback.
- Validation: per-group RED/GREEN, full governed `coverage:bot:unit` exact 100% S/B/F/L, governed E2E exact 100%, all focused tests, bot and coverage-tool typechecks, build, exact scoped ESLint0, Prettier/diff, every touched file <=500, zero secret/unsafe/private-cast/disable/legacy/unused-file hits, frozen substrate equality and clean index.
- Stop rule: if any branch requires production semantics, a private cast/impossible mock, a new file, or would push an owned file over 500 without a necessary split, stop and report the exact dependency. Do not stage, commit, self-review, or delegate.

Coverage-closure attempt 1: BLOCKED before writes because `config-roundtrip.test.ts` is not selected by the governed unit manifest, while the selected `config.test.ts` is already 512 LOC and `config.ts:111-123` cannot be affected by the authorized test home.

## Coverage-closure manifest and config-test normalization

The coordinator authorizes exactly three paths for the minimal correction:

- `apps/bot/src/cli/commands/config.test.ts` (already part of the original D-02 semantic conflict scope)
- `apps/bot/src/cli/commands/config-roundtrip.test.ts` (already existing and in the test-closure list)
- `scripts/coverage-tools/bot-runtime-scope.json` (already part of the original D-02 semantic conflict scope)

Move the smallest coherent config-test cohort from the 512-line file into the existing roundtrip test so both remain <=500, add `config-roundtrip.test.ts` exactly once to the governed `unitTestFiles`, and cover `config.ts:111-123` only through public behavior. No new file, duplicate test, compatibility path, runtime change, private cast, manifest weakening, or unrelated manifest edit. Re-run the manifest contract before continuing the full test-closure brief.

Coverage-closure normalization result: governed manifest now selects the existing `config-roundtrip.test.ts` exactly once; duplicate strategy roundtrip coverage moved out of `config.test.ts`; LOC is 468/230; explicit config-path fixtures and newly governed tests are green. Public dry-run snapshot/report and runtime-logger failure tests were added within existing owned tests.

Coverage closure then stopped on one proven unreachable production fallback: `apps/bot/src/cli/commands/strategies.ts:78` receives only schema-valid strategy values, so its final `String(value)` fallback cannot be reached without an invalid fabricated config.

## Strategies formatter invariant simplification

- Classification: low-risk internal production simplification, one bot source plus an already owned public-boundary test; no product/trading/risk/output semantics change.
- Additional exact source ownership: `apps/bot/src/cli/commands/strategies.ts` only. Existing authorized strategy/read-only tests remain the test ownership.
- Predetermined behavior: narrow the local formatter input/section representation to the closed schema-derived strategy value union, preserve the existing schema field/output order and exact rendering for strings, finite validated numbers, booleans, string arrays, and the validated timeframes object, then remove the unreachable unknown fallback. Do not widen accepted config, add a throw/fallback/compatibility branch, cast, or change CLI output.
- Validation: RED characterization of every supported value category and output order; GREEN exact removal; focused tests; governed coverage; strict typecheck; lint0; <=500. Fresh independent TECH/PROCESS must review this automatic low-risk change.

Status: STRATEGIES FORMATTER SIMPLIFICATION PENDING; afterward resume the exact test-closure brief.

### Strategies formatter result and coverage-closure blocker

- `apps/bot/src/cli/commands/strategies.ts` now formats only the schema-derived closed union: optional section values are skipped, validated numbers/booleans and strings retain their existing rendering, validated string arrays render directly, and the validated `timeframes` object retains its current nested order. The unreachable unknown `String(value)` fallback and the unreachable non-string array-item branch are absent. The owned public command characterization is green.
- Authorized mechanical type fixes are green and assertion-preserving: `cli-e2e-signal.test.ts` now imports the runtime-compatible `.js` specifier; `runtime-root.test.ts` derives its table code from `RuntimeRootFailureCode` through `satisfies`, without a cast.
- Focused validation: `bun test apps/bot/src/config/runtime-root.test.ts apps/bot/src/cli/cli-e2e-signal.test.ts apps/bot/src/cli/commands/read-only-command-config-coverage.test.ts` — 28 pass, 0 fail, 72 assertions. `bun run --filter @mm-crypto-bot/bot typecheck` — pass.
- Governed unit execution: 93 files / 901 tests pass, but gate remains red at S 98.26% (3673/3738), B 90.70% (1952/2152), F 99.57% (704/707), L 98.74% (3453/3497).
- BLOCKER: test-only closure cannot cover `apps/bot/src/portfolio/correlation.ts` V8 branches without a prohibited impossible/private fixture. `pearson` is private and called only from `getCorrelation`, which slices both private ordinary `number[]` streams to the same public `n`; therefore the `n !== ys.length` arm (line 135) and the exhausted iterator arms (lines 143 and 157) cannot occur through any public input. Given finite values are admitted by `recordFill`, positive variances imply a positive denominator, so line 166's `denominator <= 0` arm is likewise unreachable. `getMatrix` iterates `this.streams` and synchronously immediately calls `this.streams.get(id)`, making the nullish arm at line 286 unreachable under its documented single-threaded model. Covering those arms requires either a private-state/corrupted-iterator test (forbidden) or source simplification/new production ownership (not authorized). No further coverage-test writes were made after this evidence.

Strategies simplification checkpoint: focused behavior and bot source typing are green; governed unit is 93 files / 901 tests green but not yet exact (98.26/90.70/99.57/98.74). Test-only closure continues under the existing 29-file ownership.

## Mechanical test type-integration fixes

Authorize exactly two test-only, behavior-neutral corrections required by the full bot typecheck:

- `apps/bot/src/cli/cli-e2e-signal.test.ts` (already owned): replace the invalid `.ts` module suffix with the repository's emitted `.js` spelling.
- `apps/bot/src/config/runtime-root.test.ts`: prevent `RuntimeRootFailureCode` literal widening through an explicit safe type annotation/satisfies-style construction; no assertion or runtime behavior change.

No production, config, manifest, dependency, cast, disable, or new-file authority. These remain part of the same Terra test-closure task and later independent review.

## Correlation invariant simplification design audit

- Task class: read-only safety/behavior audit for proven unreachable portfolio-correlation branches.
- Mode: read-only, non-review.
- Exact scope: `apps/bot/src/portfolio/correlation.ts`, `apps/bot/src/portfolio/correlation.test.ts`, their public callers/types, and relevant coverage evidence only.
- Package count: one bot portfolio module.
- Domain risk: portfolio/risk computation; mandatory Terra trigger. No implementation or policy change in this phase.
- Reasoning shape: prove each identified branch unreachable from public state, derive a strict-TypeScript/no-cast/no-disable behavior-preserving simplification, preserve all public correlation outputs/state/snapshot order, and specify public regression tests.
- External/mutable resources: local read-only repository inspection and non-mutating tests only; no network/live/external writes.
- Review role: non-review design audit; later implementation and independent TECH/PROCESS remain separate.
- Route: mandatory `terra_reader`, `gpt-5.6-terra` / high, read-only; effective model/effort not observable; no fallback.
- Required result: exact line/invariant proof, exact target pseudocode/API with no new public seam, TDD cases, risk/non-change statement, LOC/gate plan. If behavior-preserving simplification cannot be proven, report that rather than inventing risk semantics.

Correlation design audit result: APPROVED for implementation. Public construction proves equal-length dense finite suffixes, positive variance proves positive square-root denominator, and synchronous Map enumeration proves the re-lookup fallback unreachable. The non-finite final correlation arm remains publicly reachable with finite extremes and must be tested.

## Correlation invariant simplification implementation

- Mode/route/review: write non-review, same mandatory `terra_worker` high route; fresh final TECH/PROCESS later.
- Exact ownership: `apps/bot/src/portfolio/correlation.ts` and `apps/bot/src/portfolio/correlation.test.ts` only.
- Predetermined change: remove the private precondition, iterator-undefined, redundant denominator, and Map re-lookup branches exactly as the reader handoff specifies; use explicit `Number(iterator.next().value)` under the proven invariant; combine Map ID/count capture in one synchronous `forEach`; preserve O(n), insertion order, public state and every prior result.
- Tests: retain shorter-stream suffix proof; add finite-extreme non-finite-result fallback and snapshot insertion-order/count regressions. No private access, monkey patch, impossible state, cast, disable, caller/API/type/export change.
- Gates: focused test, bot typecheck, governed unit and E2E exact 100% S/B/F/L, coverage-scope, lint0/format/diff/LOC/scans, then resume the remaining test-closure matrix.

Status: CORRELATION IMPLEMENTATION PENDING.

Correlation implementation result: focused public tests 26/26 and bot typecheck pass; the exact invariant simplification is complete. The retained bot config gate then proves one remaining unreachable branch: `config.ts:269`'s `<defaults>` output cannot occur after D-02 because every successful path resolution carries a concrete string path.

## Config validate resolved-path invariant simplification

- Classification: low-risk internal D-02 consistency cleanup; no public successful-path behavior change.
- Exact ownership: `apps/bot/src/cli/commands/config.ts`, `config.test.ts`, and `config-roundtrip.test.ts` only; all were already authorized earlier.
- Predetermined change: narrow private `runValidate`'s `configPath` to `string`; always render `  config: ${configPath}`; remove the unreachable `<defaults>` ternary and the no-op `DEFAULT_BOT_CONFIG` import/reference if it becomes unused. Do not change resolution, error codes, loading, output order, explicit/implicit path semantics, or any other subcommand.
- TDD: public explicit and runtime-root-derived validate success both assert the concrete path and absence of `<defaults>`; existing missing-root failure remains before load/output. The retained targeted config gate must reach exact 100% S/B/F/L.
- No new file, cast, disable, fallback, compatibility output, manifest change, or scope expansion. Independent review remains mandatory.

Status: CONFIG INVARIANT SIMPLIFICATION PENDING; afterward resume full coverage closure.

Config invariant result: targeted config gate is exact 100% (48 tests; S138/B67/F22/L137), bot typecheck passes, and prior public path behavior is preserved. Full coverage then found two schema-impossible branches in `strategy-registry.ts:211,216`.

## Strategy registry schema-invariant simplification

- Classification: low-risk internal strategy-config normalization; valid schema behavior and all defaults/overrides remain identical.
- Exact ownership: `apps/bot/src/config/strategy-registry.ts` and `strategy-registry.test.ts` only.
- Predetermined change: replace the two `unknown` casts plus redundant `typeof ... === "number" && ... > 0` ternaries with direct typed `section.max_notional_per_event_usd ?? DEFAULT...` and `section.cooldown_hours ?? DEFAULT...`; preserve units and output object exactly. The Zod `StrategySection` already rejects non-number/non-positive values.
- Tests: characterize absent defaults and positive overrides through the public registry; no invalid fabricated section, cast, widened config, new fallback, API or risk-policy change.
- Gates: focused registry, bot typecheck, governed unit/E2E exact100, lint0/format/diff/LOC/scans; independent review later.

Status: STRATEGY REGISTRY SIMPLIFICATION PENDING; afterward resume full coverage closure.

Strategy-registry simplification result: typed `??` defaults replace casts/redundant checks; public tests and bot typecheck pass. Subsequent public DI tests increased the governed unit suite to 93 files / 904 tests; coverage remains 98.36/91.30/99.57/98.76.

The next isolated blocker is `kill-switch-state-file.ts:37`: its non-Error formatter arm can only receive the private `StateSnapshotPath` constructor error, whose sole throw is `new Error`, so public tests cannot reach the String fallback.

## Residual coverage invariant audit dispatch

- Task class: comprehensive read-only classification of the current governed unit LCOV residual, replacing one-by-one ownership stops.
- Mode: read-only, non-review.
- Exact scope: all runtime files/branches currently nonzero-uncovered in the latest 93-file/904-test unit LCOV, their public callers, schemas/state machines, and existing authorized test homes. No write.
- Package count/domain: one bot package spanning order/position/strategy/portfolio/risk/config; safety-critical Terra trigger.
- Reasoning shape: freeze source/status/LCOV hashes; for every residual statement/branch/function/line classify (A) reachable via valid public DI/paper/test behavior with exact existing test path, (B) provably unreachable under typed/schema/private state invariants with exact behavior-preserving minimal source simplification, or (C) genuine product/risk semantic decision that cannot be auto-fixed. Consolidate related invariant removals so the writer receives one bounded exact ownership brief.
- External/mutable resources: stable isolated worktree after the current writer stopped; local read-only inspection and non-mutating tests only; no network/live/external writes.
- Review role: non-review; implementation and final TECH/PROCESS separate.
- Route: mandatory `terra_reader`, `gpt-5.6-terra` / high, read-only; effective model/effort not observable; no fallback.
- Prohibitions: no private casts, monkeypatch/impossible state, coverage ignores/threshold changes, invalid schema fixtures, runtime edits, invented risk semantics, stage/commit/delegation.
- Required output: exhaustive exact path/line/branch table, exact source/test ownership proposal using existing files where possible, pseudocode for category B, explicit category C list, and gates/LOC/no-extra-file proof. Include the `kill-switch-state-file` formatter case.

Residual coverage audit result: COMPLETE on frozen status/LCOV. Exactly 20 runtime files remain (43 DA, 185 BRDA arms, 3 functions). All except one branch are Category A public-DI/paper/config/state transitions. Category C is empty: no product/trading/risk-policy decision is required. The sole Category B branch is the private constructor non-Error formatter in `kill-switch-state-file.ts`.

## Consolidated residual coverage implementation

- Task class/mode/route: write non-review, existing mandatory `terra_worker` high route; one bot package, safety-sensitive public behavior tests only.
- Exact test ownership (existing files only):
  - `apps/bot/src/bot/bot.lifecycle.test.ts`
  - `apps/bot/src/bot/bot-runtime-controller.test.ts`
  - `apps/bot/src/bot/bot-public-boundaries.live-equity-persistence.test.ts`
  - `apps/bot/src/bot/bot.runtime.test.ts`
  - `apps/bot/src/bot/kill-switches.coverage.test.ts`
  - `apps/bot/src/bot/order-lifecycle-controller.test.ts`
  - `apps/bot/src/bot/order-manager.placement.test.ts`
  - `apps/bot/src/bot/order-manager.faults.test.ts`
  - `apps/bot/src/bot/position-manager.state-restoration.test.ts`
  - `apps/bot/src/bot/position-manager.test.ts`
  - `apps/bot/src/bot/state-store.test.ts`
  - `apps/bot/src/bot/strategy-market-event-controller.boundary.test.ts`
  - `apps/bot/src/bot/strategy-runner.native-paper-coverage.test.ts`
  - `apps/bot/src/bot/strategy-runner.trailing-risk-close.test.ts`
  - `apps/bot/src/bot/strategy-runner-order-lifecycle-controller.boundary.test.ts`
  - `apps/bot/src/bot/strategy-runner.order-admission-reconciliation.test.ts`
  - `apps/bot/src/bot/strategy-plugin-risk-controller.boundary.test.ts`
  - `apps/bot/src/bot/strategy-plugin-risk-controller.trailing-boundary.test.ts`
  - `apps/bot/src/bot/strategy-runner.plugin-emergency-close.test.ts`
  - `apps/bot/src/bot/strategy-runner.test.ts`
  - `apps/bot/src/cli/commands/kill-switch-dry-run.command.test.ts`
  - `apps/bot/src/cli/commands/kill-switch-dry-run-report.test.ts`
  - `apps/bot/src/cli/commands/kill-switch-dry-run.state-loading.test.ts`
  - `apps/bot/src/config/strategy-registry.test.ts`
- Exact Category B source ownership: `apps/bot/src/cli/commands/kill-switch-state-file.ts` only.
- Predetermined source simplification: introduce a private `validateStateSnapshotPath(string): StateSnapshotPath | undefined`; invalid empty/NUL/current-directory returns undefined and produces the exact existing `invalid state file path: state file path must be a non-empty filesystem path`; make `StateSnapshotPath` a value holder; remove only its throw/catch and the now-unneeded constructor-error `formatError` use. Preserve the separate public read and JSON parse error formatting branches unchanged.
- Tests: valid public injected feed/logger/order/position/risk/portfolio dependencies, schema-valid config/state, paper mode only; empty/NUL/dot/valid state paths; no private access/cast/monkeypatch/invalid schema/live call/new file.
- Gates: grouped RED/GREEN, then governed unit and E2E exact 100% S/B/F/L, coverage-scope, bot+coverage typechecks, build, scoped lint0/Prettier/diff, every touched file <=500, secret/unsafe/disable/legacy/unused scan, frozen non-owned equality and clean index.
- Stop rule: a newly proved non-Category-A/B dependency must stop with exact evidence. No manifest/threshold/ignore/runtime policy/API/dependency/stage/commit/self-review/delegation.

Status: CONSOLIDATED RESIDUAL IMPLEMENTATION PENDING.

Consolidated implementation checkpoint: Category-B state path simplification is green; governed unit is 93 files / 908 tests at 98.49/91.64/99.57/98.88. A new proof corrects one reader classification: `bot.ts:250-251` is Category B, not A. Private `run` has one caller; immediately before it `start` assigns `this.runtime = await init()`, and `init` constructs/assigns the runtime controller before its only normal return. Thus controller absence/context inequality requires private corruption.

## Bot initialized-runtime invariant simplification

- Classification: low-risk private lifecycle simplification; no public start/stop/error/resource behavior change.
- Exact ownership: `apps/bot/src/bot/bot.ts`, `bot.runtime.test.ts`, and `bot.lifecycle.test.ts` only.
- Predetermined change: make private `init` return a typed readonly tuple `[BotRunContext, BotRuntimeController]`; construct a local controller, assign it to the existing property for cleanup, and return it with the same context. In `start`, destructure the tuple, assign the context to `this.runtime`, and call the returned controller directly. Remove the private `run(context)` wrapper and its unreachable guard. No optional call, assertion, fallback, new public seam, or lifecycle ordering change.
- Tests: existing start/cleanup/failure characterization plus exact once controller-run delegation through public start; no private access/monkeypatch.
- File constraint: `bot.ts` starts at 479 LOC; the wrapper deletion and compact tuple refactor must keep it <=500 formatted.
- Resume the consolidated public Category-A matrix afterward; independent final review required.

Status: BOT INITIALIZED-RUNTIME SIMPLIFICATION PENDING.

Bot tuple implementation checkpoint: public runtime/lifecycle tests 19/19 pass, but strict TS proves the retained private `this.runtime` property is now write-only after removal of the sole comparison guard.

## Remove obsolete private runtime storage

- Exact ownership remains `bot.ts` plus the same runtime/lifecycle tests.
- Remove the private `runtime` property and the `this.runtime = context` assignment. Keep the local tuple-returned context/controller ordering and direct controller run. The context remains owned by the controller constructed during `init`; no public getter or other internal read exists.
- No no-op read, optional fallback, API/lifecycle/resource/error change. Add/retain public start/stop/failure characterization; typecheck must prove zero unused property. This directly enforces the user's no-unnecessary-code requirement.

Status: BOT OBSOLETE RUNTIME STORAGE REMOVAL PENDING.

## Consolidated A-matrix checkpoint and stop evidence

- Green public coverage additions: non-`Error` kill-switch callback structured logging; authoritative-heartbeat drawdown registry trigger; exhausted-equity and same-side aggregate L3 failures; unreadable state-path null result; bounded native-protection supersession retention; and valid positive limit-price forwarding.
- Focused tests: 66 pass / 0 fail across the first five affected test files, then order-manager placement 13 pass / 0 fail. Bot typecheck passes.
- Latest complete governed unit measurement before the final native-retention and limit-order additions: 93 files / 915 tests pass; statements 98.71% (3677/3725), branches 92.00% (1956/2126), functions 99.57% (704/707), lines 99.08% (3454/3486). The exact-100 gate remains red.
- Stop dependency: `apps/bot/src/bot/bot-runtime-controller.ts:52` has an uncovered false arm for `supportedTimeframes.has(timeframe)`. Both `BotConfig` and `BotStrategyInstance.instance.timeframes` use the closed exchange `Timeframe` union `"1m" | "5m" | "15m" | "1h" | "4h" | "1d"`, exactly matching the controller's `supportedTimeframes` set. A public config/DI test cannot produce the false arm. Covering it requires a forbidden invalid cast/fabricated strategy instance or an unapproved source invariant simplification. No such source authority exists, so work stopped without staging or committing.

Coordinator ruling: the blocker is Category B and must be simplified; no invalid test or coverage exception is allowed. Correction to the stop proof: configured section timeframes are schema-valid strings, so the line 47 membership filter remains required and continues rejecting values such as `2h`. Only `BotStrategyInstance.instance.timeframes` is the closed exchange `Timeframe` union exactly equal to the supported set, making the line 52 membership test redundant.

## Strategy-instance timeframe invariant simplification

- Task class/mode/route: low-risk private runtime normalization; write, non-review; one bot package with a lifecycle seam, mandatory existing `terra_worker` high route.
- Exact ownership: `apps/bot/src/bot/bot-runtime-controller.ts` and `apps/bot/src/bot/bot-runtime-controller.test.ts` only, then resume the already-owned consolidated A-matrix tests.
- Predetermined change: inside the `instance?.kind === "strategy"` loop, add each typed `Timeframe` directly to the symbol set and remove only `supportedTimeframes.has(timeframe)`. Keep the configured string membership filter, supported set, order, deduplication, subscriptions, logging, error handling, and every public type/API unchanged.
- TDD/characterization: retain/prove through public controller execution that all canonical instance timeframes subscribe and duplicates collapse; retain the existing public configured unsupported-timeframe rejection. No cast, fabricated invalid strategy, private access, new file, fallback, live call, threshold/ignore change, stage, commit, self-review, or delegation.
- Validation: focused controller and configured-timeframe tests, bot typecheck, then resume governed unit exact coverage and all previously required gates. Independent final reviews remain mandatory.
- Ruling cost if wrong: an out-of-contract future timeframe added to an instance would now be subscribed rather than silently dropped; that future change must first extend the authoritative `Timeframe` contract and its exchange support, so the current closed contract is the correct enforcement boundary.

Status: STRATEGY-INSTANCE TIMEFRAME INVARIANT SIMPLIFICATION PENDING.

Strategy-instance timeframe invariant simplification result: `BotRuntimeController` now adds the closed typed instance `Timeframe` directly, while the configured-string membership filter remains unchanged. Public controller coverage proves canonical instance subscriptions collapse correctly; the existing public boundary test still proves configured `2h` is rejected. Focused tests pass and bot typecheck passes. Governed unit: 93 files / 918 tests pass; S 98.81% (3680/3724), B 92.09% (1956/2124), F 99.57% (704/707), L 99.19% (3458/3486); threshold stays red.

New stop dependency: `apps/bot/src/bot/order-manager-placement.ts:184`'s `intent.limitPrice ?? intent.referencePrice` fallback is unreachable through every valid public `placeOrder` path. `assertIntentFields` rejects a limit intent if `limitPrice` is undefined or non-positive at lines 115–120 before private `buildOrderRequest` executes; valid limit-order forwarding is separately green. Reaching the fallback requires a prohibited invalid bypass/private invocation. No source simplification authority exists for this B invariant.

Coordinator ruling: this is Category B and the validated value must be carried forward; an invalid/private coverage seam is forbidden.

## Validated limit-price propagation simplification

- Task class/mode/route: safety-preserving internal order-request normalization; write, non-review; one bot package but order-boundary Terra trigger, existing `terra_worker` high route.
- Exact ownership: `apps/bot/src/bot/order-manager-placement.ts` and `apps/bot/src/bot/order-manager.placement.test.ts` only, then resume already-owned A-matrix tests.
- Predetermined change: rename the private field check to a validator returning `number | undefined`; for a limit intent preserve the exact current missing/nonpositive rejection and return the already-validated `limitPrice`; for non-limit return undefined. Pass this value into the private request builder and include `price` only when the returned value is defined. Remove only `intent.limitPrice ?? intent.referencePrice`; preserve all current amount/reference/protective/leverage/reduce-only validation, request fields/order, errors, counters and side effects.
- Tests/evidence: the existing governed coverage RED proves the fallback arm unreachable. Retain public missing/nonpositive limit rejection, positive limit exact forwarding, market request without price, and the rest of placement behavior. No private call, cast, fabricated invalid state, assertion, new file, change to finite-value policy, live call, threshold/ignore change, stage, commit, self-review, or delegation.
- Validation: focused placement tests, bot typecheck, then resume governed exact coverage and the original full gate set.
- Ruling cost if wrong: a future caller that bypasses validation could no longer receive the old reference-price fallback, but the private builder has one validated caller and that fallback contradicted the public fail-closed contract.

Status: VALIDATED LIMIT-PRICE PROPAGATION PENDING.

Validated limit-price propagation result: DONE. The validator carries the valid limit price into the private builder; public missing/nonpositive rejection, market no-price behavior and exact positive forwarding remain green. Placement 13/13 and bot typecheck pass. Fresh governed unit: 93 files / 919 tests pass; S 98.81% (3684/3728), B 92.18% (1957/2123), F 99.57%, L 99.19%. Exact coverage remains red, so the authorized public A-matrix continues from the fresh LCOV; no new blocker was reported.

## Consolidated A-matrix continuation 2

- Same task class, exact existing test ownership, bot package, safety-triggered mandatory `terra_worker` high route, non-review write authority and all prior prohibitions/gates.
- Start from the fresh governed LCOV after 919 tests. Add only valid public DI/paper/config/state transition cases in the pre-authorized existing test files, one RED/GREEN behavior at a time.
- Stop only on a newly proved Category B/C dependency with exact public-call/type/schema evidence; do not fabricate invalid/private state, add files, weaken scope/threshold, touch cross-owner E2E/cleanup files, stage, commit, self-review or delegate.

Status: CONSOLIDATED A-MATRIX CONTINUATION 2 IN PROGRESS.

Consolidated A-matrix continuation 2 checkpoint: public pre-tracking fill recovery and Error/string lifecycle-listener failure paths pass focused tests and bot typecheck. The separate strict E2E fake-config repair then made all 63 canonical cases pass, but the governed E2E exact gate is red at S 3544/3715, B 1813/2125, F 694/708, L 3345/3477.

## Comprehensive E2E residual coverage audit dispatch

- Task class: exhaustive read-only classification of the fresh governed E2E LCOV residual after all 63 canonical cases execute.
- Mode: read-only, non-review.
- Exact scope: every runtime statement/branch/function/line with zero coverage in the fresh E2E report; the canonical case manifest, active runtime-driver graph, public callers, schemas/state machines, and existing E2E driver files. No writes.
- Package count/domain risk: bot plus root governed coverage tooling; lifecycle/order/risk/config and coverage-integrity Terra triggers.
- Reasoning shape: freeze status/LCOV hashes; classify every residual as (A) valid public driver/DI/paper/config/state behavior with exact existing driver ownership, (B) provably unreachable private/type/schema invariant with exact minimal behavior-preserving source simplification, or (C) genuine product/trading/risk decision. Consolidate into the smallest executable briefs and identify any source simplification already made for unit coverage that now needs an E2E characterization rather than duplicate logic.
- External/mutable resources: local read-only inspection and non-mutating coverage/listing commands only; no network/live/external write/stage/commit.
- Review role/route: non-review, mandatory `terra_reader`, configured `gpt-5.6-terra` / high, read-only; no fallback.
- Required output: exhaustive exact path/line/branch/function table/grouping, exact existing driver/source ownership, public scenarios and expected results, Category C list, execution order, gates/LOC/no-new-file proof.
- Prohibitions: no private casts/monkeypatch/impossible state, invalid schema, live exchange, threshold/scope weakening, ignore, production write, new file, stage, commit, or delegation.

Comprehensive E2E residual coverage audit result: COMPLETE on frozen porcelain SHA `c97ce9d1…c949bfb3` and E2E summary SHA `f13160c…e08c`. All 63 cases execute. Residuals are S171/B312/F14/L132 across 27 governed runtimes. Almost all are Category A valid public driver/DI/paper/config/state scenarios. One StateStore group is Category B. Three diagnostic groups were labeled Category C only because exact closure requires an explicit error-contract ruling; no trading/business choice or live call is involved.

Coordinator ruling on diagnostic contracts: resolve all three as invariant simplifications, not fabricated coverage. Default Node synchronous fs calls and native JSON parse throw `Error`; the statically imported core leverage guard throws only `Error` subclasses. Preserve actual Error `.message` text via a branch-free reflective message extractor and remove only impossible non-Error fallbacks. Typed `BotState` is JSON-serializable, so its impossible serialization catch is dead and must be removed. This is low-risk internal diagnostic normalization; public reachable outputs remain characterized and unchanged.

## E2E invariant simplification dispatch

- Task class/mode/route: persistence and order-boundary invariant cleanup; write, non-review; one bot package with order/data-integrity Terra triggers, mandatory existing `terra_worker` high route.
- Exact source ownership: `apps/bot/src/bot/state-store.ts`, `apps/bot/src/cli/commands/kill-switch-state-file.ts`, `apps/bot/src/bot/order-manager-placement.ts`.
- Exact test ownership: existing `apps/bot/src/bot/state-store.test.ts`, `apps/bot/src/cli/commands/kill-switch-dry-run.state-loading.test.ts`, `apps/bot/src/bot/order-manager.placement.test.ts`, and existing E2E `state-store-boundaries.ts`/`order-manager-boundaries.ts` only if needed for public characterization. No new file.
- StateStore B change: make private `saveSync` accept only `BotState`; remove its null no-op. Capture the current typed state in the debounce callback, remove the redundant `pendingWrite` flag/branch, and keep cancellation/flush/last-write ordering identical.
- StateStore diagnostic change: use a local branch-free Error-message extractor based on `String(Reflect.get(Object(error), "message"))` for Node read/mkdir/write and native JSON parse catches. Serialize typed state directly with `JSON.stringify(enriched, undefined, 2)` and remove the unreachable serialization catch/wrapper. Preserve reachable event names, StateStoreError causes, messages and atomic write order.
- Kill-switch state-file change: replace only the `instanceof Error` fallback in `formatError` with the same branch-free extractor; retain path/read/JSON/schema result strings.
- Order placement change: after the core leverage guard throws, derive its reason through the same branch-free extractor, log it once and always throw the existing detailed `OrderManagerError` with the original cause. Preserve rejection counter, leverage fields and exact reachable breach message.
- TDD/evidence: current exact E2E branch gate is RED. Public regressions must assert existing mkdir/read/write/invalid-JSON/state-load/leverage-breach messages, causes/logs/state and debounce/flush behavior; no non-Error injection or monkeypatch.
- Validation: focused unit/E2E driver cases, bot/E2E typechecks, governed unit and E2E exact coverage, lint0/Prettier/diff/LOC/unsafe/disable/unused scans and clean index.
- Prohibitions: no fs/JSON/core monkeypatch, cast/assertion, invalid private state, error swallowing, schema/runtime API change, new file, threshold/scope/manifest change, live call, stage, commit, self-review, or delegation.
- Ruling cost if wrong: a future platform/dependency that violates these documented native/core Error contracts would render `undefined` in the diagnostic instead of stringifying an arbitrary thrown payload; it would still fail closed and retain the original cause.

## E2E public A-matrix execution plan

- After invariant simplifications and fresh LCOV, use only the reader-mapped existing driver files: CLI/config (`cli-boundaries*`, `strategy-registry-boundaries`, `kill-switch-commands`); portfolio (`portfolio-primitives`, `portfolio-manager-paper`); order/position/state (`order-manager-boundaries`, order-lifecycle/flow, position-manager/state-store boundaries); runner/controller/protection/plugin-risk existing drivers; bot/telemetry existing lifecycle drivers.
- Exercise only schema-valid public temp-file, injected dependency, paper/mock feed, lifecycle/state/log/result/side-effect scenarios specified in the reader handoff. Every assertion must verify observable behavior; no new case ID, driver, source file or production change unless a new proven invariant is separately ruled.
- Order: invariant simplifications, CLI/config, order/position/state, runner, portfolio/bot/telemetry; focused RED/GREEN after each group, then full exact gates.

Status: E2E INVARIANT SIMPLIFICATION PENDING; PUBLIC A-MATRIX FOLLOWS.

E2E invariant simplification result: DONE. Focused StateStore/kill-switch state-load/order-placement tests 42/42 pass and bot typecheck passes. Fresh governed E2E executes 63/63 cases; dead branches/denominators are reduced, but exact coverage remains red at S3540/3709 (95.44%), B1807/2107 (85.76%), F695/709 (98.02%), L3340/3471 (96.22%). No new blocker was reported.

## E2E public A-matrix continuation 1

- Same mandatory `terra_worker` high route, non-review write authority, existing driver ownership, public/mock/paper/schema-valid constraints and full gate set recorded above.
- Start from the fresh LCOV. Execute the reader's ordered groups with observable result/state/log/side-effect assertions. Batch only coherent same-owner scenarios; run focused RED/GREEN and periodically refresh the governed E2E counter.
- No new driver/case ID/source file, invalid config/private state, live call, monkeypatch, threshold/manifest/scope change, stage, commit, self-review or delegation. Stop only on a newly proved invariant or product-semantic decision with exact evidence.

Status: E2E PUBLIC A-MATRIX CONTINUATION 1 IN PROGRESS.

Continuation 1 checkpoint after the first order/position/state additions: governed E2E remains 63/63 canonical cases and now reports S3544/3709 (95.55%), B1815/2107 (86.14%), F695/709 (98.02%), L3344/3471 (96.34%). The prior writer's latest public cases are present; the coverage process has completed and raw envelopes/summary are retained.

## Fresh E2E matrix implementer dispatch

- Same pre-classified write/non-review task, exact existing-driver ownership, bot/root coverage integrity Terra triggers, prohibitions and full gates.
- Route callability/authority verification: prior `terra_worker` turns in this worktree prove the configured `gpt-5.6-terra` high workspace-write profile callable; effective model/effort remain profile-pinned but not separately observable; no fallback.
- Fresh implementer `/root/d02_e2e_matrix_finish` receives only this ledger plus the fresh summary/raw artifacts. It must preserve all prior cases/changes, merge current raw coverage, close coherent public A groups until exact 100% or a new proved invariant/product blocker, and must not delegate/self-review/stage/commit.

Status: FRESH E2E MATRIX IMPLEMENTER IN PROGRESS.

Fresh implementer checkpoint 1: one public CLI/config group added only to `cli-boundaries-d02-config-command.ts` (316 LOC). It covers TOML quoting/backslash/allowed-control rendering, unsupported-control rejection, file-backed config, missing/malformed TOML, `BUN_ENV` paper/live, and accepted/rejected `LOG_LEVEL`. Bot E2E typecheck, scoped lint, Prettier and diff pass. Governed E2E 63/63 remains red but improves to S3558/3709, B1825/2107, F696/709, L3358/3471 (+14/+10/+1/+14).

Status: FRESH E2E MATRIX CONTINUES WITH REMAINING CLI/CONFIG GROUP.

Fresh implementer CLI/config group result: DONE. Modified only the existing
`cli-boundaries-d02-config-command.ts`, `strategy-registry-boundaries.ts`,
`cli-boundaries-d02-start.ts`, and `kill-switch-commands.ts` drivers. Public
loader file/environment failures, carry and cascade defaults/fallbacks, start
logger/run/shutdown Error and string contracts, and dry-run runtime-root,
ConfigError, Error and string failures are characterized. Bot E2E typecheck,
scoped ESLint, Prettier and diff check pass. The governed merged raw result has
63 unique canonical cases and reports S3568/3709, B1838/2107, F697/709,
L3368/3471. `start.ts`, `kill-switch-dry-run.ts`, and
`strategy-registry.ts` are exact 100%; `loader.ts` retains only the
`formatZodIssues` empty-root-path outcome, which remains pending a separate
public-reachability/invariant proof. No product blocker was found.

## Fresh E2E matrix continuation: order, position and state

- Task class/mode/role: close the next coherent public E2E residual group;
  write, non-review.
- Exact ownership: only existing
  `apps/bot/test/e2e/runtime-driver/order-manager-boundaries.ts`,
  `strategy-runner-order-lifecycle-boundaries.ts`,
  `strategy-runner-order-flow.ts`, `position-manager-boundaries.ts`, and
  `state-store-boundaries.ts`; no source, manifest, case-ID or new-file change.
- Package/risk/reasoning: one bot package; order, position, persistence and
  coverage-integrity Terra triggers. Merge the fresh raw envelopes, exercise
  schema-valid public DI/paper/mock lifecycle, rejection, recovery, retention,
  debounce/flush and reconciliation outcomes with observable result/state/log
  and side-effect assertions.
- External resources/authority: isolated worktree and bounded temp fixtures
  only; no live venue, network, external write, stage or commit. Workspace-write
  authority is restricted to the five existing drivers.
- Review role/route: non-review, mandatory `terra_worker`, configured
  `gpt-5.6-terra` high; prior turns prove callability, effective profile remains
  pinned but not separately observable; no fallback.
- Validation: focused RED/GREEN, bot E2E typecheck, full governed E2E with exact
  counters, scoped ESLint0, Prettier, diff and LOC<=500. Preserve all existing
  cases and prior changes; stop only on a newly proved invariant/product blocker.
- Prohibitions: no invalid/private state, casts, monkeypatch, live call,
  threshold/scope/manifest weakening, source edit, extra file, delegation,
  self-review, stage or commit.

Status: ORDER/POSITION/STATE E2E GROUP IN PROGRESS.

Order/position/state checkpoint 1: `state-store-boundaries.ts` (75 LOC) now
characterizes empty `flush()` without persistence and a syntactically valid
directory state-path read failing closed with `null`. E2E typecheck, scoped
ESLint0, Prettier and diff check pass. Governed E2E remains 63/63 and improves
to S3570/3709, B1839/2107, F697/709, L3370/3471. No blocker; the remaining four
owned order/position drivers must continue under the same brief.

Order/position/state checkpoint 2: valid public changes remain in
`order-manager-boundaries.ts`, `position-manager-boundaries.ts`, and
`state-store-boundaries.ts`: open-order query failure, paper authoritative
position short-circuit, same-position reopen fill, oversized opposing fill
rejection, unrelated-symbol price no-op, empty flush, and directory-backed
state read fail-closed. Governed E2E is 63/63 at S3576/3709, B1845/2107,
F697/709, L3374/3471. The existing
`strategy-runner-order-lifecycle-boundaries` canonical case intentionally
rejects any successful `placeOrder`, so it cannot host the successful lifecycle
and cancellation-failure paths without changing the shared allowlist.

Coordinator ruling: do not alter `runtime-driver.ts`, its allowlist, or any case
ID. Move only those public successful lifecycle/cancellation-failure
characterizations into the already owned and semantically correct existing
`strategy-runner-order-flow.ts` driver, whose canonical case permits order
placement. This is test-responsibility placement, not product behavior or new
scenario scope. Keep rejection-only lifecycle assertions in their existing
driver where valid. Preserve every case ID and production source. Cost if wrong:
an assertion may live under a broader order-flow case, but canonical isolation,
observable behavior and governed coverage remain unchanged; the alternative
would weaken the shared unexpected-order guard.

Status: ORDER/POSITION/STATE E2E GROUP CONTINUES WITH APPROVED DRIVER PLACEMENT.

Approved driver-placement result: DONE. The acknowledged-order cancellation
characterization now runs inside the existing order-flow canonical case and
asserts terminal `canceled` plus in-flight removal. The rejection-only lifecycle
driver and shared unexpected-order allowlist are unchanged. Governed E2E remains
63/63 at S3576/3709, B1845/2107, F697/709, L3374/3471; E2E typecheck, scoped
lint, Prettier and diff check pass. No blocker.

## Fresh E2E matrix continuation: runner and protection controllers

- Task class/mode/role: close the next coherent public E2E residual group;
  write, non-review.
- Exact ownership: only existing
  `strategy-runner-facade-coverage.ts`, `strategy-runner-market-lifecycle.ts`,
  `native-protection-failsafe.ts`, `native-protection-retry.ts`,
  `strategy-runner-protections.ts`, `strategy-runner-plugin-risk.ts`,
  `strategy-runner-plugin-risk-coverage.ts`,
  `strategy-runner-plugin-risk-coverage-lifecycle.ts`, and
  `strategy-runner-risk-lifecycle.ts` under
  `apps/bot/test/e2e/runtime-driver/`.
- Package/risk/reasoning: one bot package; strategy lifecycle, protection, risk
  and coverage-integrity Terra triggers. Merge fresh raw coverage and add only
  public injected strategy/plugin/order/portfolio/feed cases for paused,
  unsupported/duplicate market events, protection success/retry/failsafe,
  pending/open/partial/closed/error transitions, risk close, plugin source/error
  and cleanup paths. Assert observable result/state/log/side effects.
- External resources/authority: isolated worktree and paper/mock injected
  dependencies only; no live venue/network/external write. Workspace-write is
  limited to those nine existing drivers.
- Review role/route: non-review mandatory `terra_worker`, configured
  `gpt-5.6-terra` high; callability already proven, no fallback.
- Gates: focused RED/GREEN, E2E typecheck, full governed exact counters,
  scoped ESLint0, Prettier, diff, LOC<=500. Preserve 63 case IDs and every prior
  change. No source/manifest/new file/case ID/cast/invalid state/monkeypatch,
  threshold weakening, delegation, self-review, stage or commit.

Status: RUNNER/PROTECTION E2E GROUP IN PROGRESS.

Runner/protection result: DONE for the assigned public residual cohort. Existing
`strategy-runner-market-lifecycle.ts`, `strategy-runner-plugin-risk.ts`,
`strategy-runner-protections.ts`, and `native-protection-failsafe.ts` now cover
ticker/duplicate/non-price events, informational and single-flight plugin risk,
no-authoritative-position protection no-op, single-leg stop and repeated failsafe
close. E2E typecheck, scoped lint, Prettier and diff pass. Governed E2E remains
63/63 and improves to S3585/3709, B1853/2107, F697/709, L3378/3471. No source,
manifest, scope, threshold or case-ID change and no blocker.

## Fresh E2E matrix continuation: portfolio, bot and telemetry

- Task class/mode/role: close the next coherent public E2E residual group;
  write, non-review.
- Exact ownership: only existing
  `apps/bot/test/e2e/runtime-driver/portfolio-primitives.ts`,
  `portfolio-manager-paper.ts`, `bot-state-and-telemetry.ts`,
  `bot-cleanup-and-order-risk.ts`, and `bot-lifecycle-factory.ts`.
- Package/risk/reasoning: one bot package; portfolio, lifecycle, telemetry and
  coverage-integrity Terra triggers. Merge fresh raw coverage and exercise only
  valid public paper/mock/DI paths for invalid/missing/one/constant/extreme
  correlation streams, fill/eviction/forget/reset/terminal limit, portfolio
  close/state transitions, authoritative equity pre-reconcile, bot cleanup/order
  risk and telemetry success/failure lifecycle. Assert observable state/result/
  logs/side effects, not implementation internals.
- External resources/authority: isolated worktree and injected paper/mock
  dependencies only; no live venue/network/external write. Workspace-write is
  limited to these five drivers.
- Review role/route: non-review mandatory `terra_worker`, configured
  `gpt-5.6-terra` high; callability proven, no fallback.
- Gates: focused RED/GREEN, E2E typecheck, full governed exact counters,
  scoped ESLint0, Prettier, diff, LOC<=500. Preserve all 63 case IDs and prior
  changes. No source/manifest/new file/case ID/cast/invalid state/monkeypatch,
  threshold weakening, delegation, self-review, stage or commit.

Status: PORTFOLIO/BOT/TELEMETRY E2E GROUP IN PROGRESS.

Portfolio/bot/telemetry result: DONE for the assigned reachable cohort.
`portfolio-primitives.ts`, `bot-state-and-telemetry.ts`, and
`bot-cleanup-and-order-risk.ts` now cover correlation invalid/missing/constant/
eviction/forget/reset, telemetry idempotent start-stop/kill-switch enrichment/
uptime/drawdown, and paper-mode feed-close error normalization. E2E typecheck,
lint, Prettier and diff pass. Governed E2E is 63/63 at S3604/3709,
B1867/2107, F701/709, L3392/3471. A private-lifecycle cleanup log is not
reachable with the public paper/live injected-feed contracts; it requires fresh
source-invariant classification before any change. No product blocker.

## Fresh E2E residual audit after public matrix rounds

- Task class/mode/role: exhaustive read-only reclassification of every fresh
  zero E2E statement/branch/function/line after the CLI, order/state,
  runner/protection and portfolio/bot rounds; non-review.
- Exact scope: merged raw envelopes and summary for all 63 canonical cases;
  every currently governed runtime with a zero counter; active public callers,
  schema/types/state machines and existing runtime-driver graph. No writes.
- Package/risk/reasoning: bot plus root coverage tooling; lifecycle/order/risk/
  persistence and coverage-integrity Terra triggers. Freeze artifact/status
  hashes, enumerate exact remaining locations, and classify each as A reachable
  public existing-driver behavior, B proved type/schema/private invariant with
  the exact smallest behavior-preserving source simplification and regressions,
  or C genuine product/trading decision. Identify obsolete/dead test or source
  files if the graph proves any.
- External resources/authority: local read-only inspection and non-mutating
  coverage parsing only; no network/live/external write/stage/commit.
- Review role/route: non-review mandatory `terra_reader`, configured
  `gpt-5.6-terra` high read-only; prior route proves callability, no fallback.
- Required output: exhaustive grouped path/line/branch/function inventory,
  current numerator/denominator hashes, exact existing driver/source ownership,
  public inputs and expected observable results, B proof/cost-if-wrong, C list,
  order of execution and no-new-file/LOC proof.
- Prohibitions: no writes, private casts/monkeypatch/impossible state, invalid
  schema, live exchange, threshold/scope/manifest change, delegation or review.

Status: FRESH POST-MATRIX E2E RESIDUAL AUDIT DISPATCHED.

Fresh residual audit result: COMPLETE on HEAD `762d629`, porcelain SHA
`8866e829…`, summary SHA `551376dd…` and merged raw SHA `3148ead4…`. It
independently remerged 63/63 cases and found 21 runtimes with S105/B240/F8/L79
missing. A reachable public behavior accounts for S104/B238/F8/L78. Two exact
branches are B invariants: positive `PositionRecord.quantity` before
`PositionRiskMonitor`, and a debounce callback that exists only after
`requestSave(state)` and is cancelled by `flush()`. One `Bot.cleanup()` private
lifecycle unsubscribe catch is C only because it is live-reachable but cannot be
driven through the allowed paper/injected-feed contract. No source/test file is
proven dead; all 21 runtimes are governed and all relevant drivers are imported
by canonical cases. The existing `bot-state-and-telemetry.ts` is already 520
LOC and must not be touched; residual bot assertions must use under-cap owners.

Coordinator lifecycle ruling: preserve the existing safe live behavior exactly.
An order-lifecycle unsubscribe failure must be warned, then cleanup must continue
to runner disposal, state flush, subscription cleanup and feed close. Do not
propagate and do not add a live factory override. Extract the existing catch into
an exported-but-package-internal function in `bot.ts` that accepts an explicit
`stopLifecycle: () => Promise<void>` and `Logger`; `Bot.cleanup()` calls it with
the real private manager. The existing E2E driver can call this explicit seam
with Error/string rejection and prove warning plus continuation. It is not added
to a package index and does not alter `BotOptions` or live composition. Cost if
wrong: internal callers could misuse the helper to swallow an unsubscribe error,
but the helper remains module-internal by package exports and preserves the
current fail-safe cleanup ordering; propagation would risk skipping state/feed
cleanup.

## Post-audit invariant and cleanup-seam implementation

- Task class/mode/role: bot lifecycle/persistence/risk invariant remediation;
  write, non-review.
- Exact source ownership: `apps/bot/src/bot/position-manager.risk-monitor.ts`,
  `state-store.ts`, and `bot.ts`.
- Exact test ownership: existing `position-manager.test.ts`,
  `position-manager.state-restoration.test.ts`, `state-store.test.ts`,
  `bot.lifecycle.test.ts`, plus E2E `position-manager-boundaries.ts`,
  `state-store-boundaries.ts`, and `bot-cleanup-and-order-risk.ts`. No other path
  and no new file.
- Required changes: simplify ATR proxy to `(notionalUsd / quantity) * 0.01` only
  after public open/restore non-positive regressions; capture the typed state in
  each scheduled debounce callback and save it directly while preserving newest
  coalescing and flush cancellation; extract the lifecycle stop catch exactly as
  ruled above, preserving warning event/text and cleanup continuation.
- Package/risk/reasoning: one bot package; lifecycle/persistence/risk Terra
  triggers. Each current zero is the RED evidence; add focused public regressions
  before the minimal implementation.
- External resources/authority: isolated worktree, fake timers/temp fixtures/
  injected functions only; no live venue/network/external write/stage/commit.
- Review role/route: non-review mandatory `terra_worker`, configured
  `gpt-5.6-terra` high workspace-write; callability proven, no fallback.
- Gates: focused unit+E2E RED/GREEN, bot/E2E typechecks, governed unit and E2E
  fresh counters, ESLint0, Prettier, diff, LOC<=500, unsafe/disable/reference and
  clean-index checks. No cast/private mutation/monkeypatch/invalid schema,
  option/public package export change, threshold/scope/manifest change,
  delegation, self-review, stage or commit.

Status: POST-AUDIT INVARIANT/CLEANUP REMEDIATION IN PROGRESS.

Post-audit invariant/cleanup result: DONE. Modified only the three approved
sources and existing focused tests/drivers. `PositionRiskMonitor` now relies on
the public positive-quantity admission invariant; StateStore debounce saves its
captured typed snapshot while newest coalescing and flush cancellation remain;
package-internal `stopLifecycleForCleanup()` preserves Error/string warn-and-
continue semantics without `BotOptions`, package-index or live-composition
change. Focused units 62/62, bot and E2E typechecks, scoped ESLint0, Prettier,
diff, unsafe scan and clean index pass. Governed unit is 922/922 at S3685/3726,
B1954/2105, F708/711, L3462/3488; governed E2E is 63/63 at S3609/3713,
B1869/2107, F704/712, L3397/3475. Both exact thresholds remain red; no new
blocker.

## Post-audit A matrix: order, position and persistence

- Task class/mode/role: close every audited A residual in the order/position/
  persistence cohort through existing public drivers; write, non-review.
- Exact ownership: only existing
  `apps/bot/test/e2e/runtime-driver/order-manager-boundaries.ts`,
  `position-manager-boundaries.ts`, `state-store-boundaries.ts`,
  `strategy-runner-order-lifecycle-boundaries.ts`, and
  `strategy-runner-order-flow.ts`. No source/new file/manifest/case-ID edit.
- Required public matrix: order lifecycle subscription absence/presence/default
  handler, fill recovery/execution-ID resolution, cancellation race and bounded
  map evictions, authoritative endpoint unavailable/failure, Error/string
  listener failures; position invalid restore entry/leverage, leverage breach
  wrapping/logging, restored PnL overwrite, public getter and absent risk manager;
  StateStore process-owned invalid-child directory creation failure; runner
  pending/blocked/tripped/max-position/zero sizing-regime-budget, immediate/
  partial/open fills, reconciliation failures, protection install, pending entry
  cleanup and callbacks. Use the already approved order-flow canonical case for
  successful placements and keep all shared allowlists unchanged.
- Package/risk/reasoning: one bot package with order/position/persistence/risk
  Terra triggers. Assertions must prove public result/state/counters/logs/
  side-effects. Distribute helpers/tables among these under-cap files so every
  file remains <=500.
- External resources/authority: injected paper/mock/temp fixtures only; no
  live/network/external write/stage/commit. Mandatory `terra_worker` high,
  non-review, configured/callable, no fallback.
- Gates/prohibitions: focused RED/GREEN, E2E typecheck, full governed counters,
  ESLint0, Prettier, diff, LOC<=500, no private casts/invalid state/monkeypatch,
  source/scope/threshold weakening, delegation/self-review/stage/commit. Handoff
  only when the complete audited cohort is covered or a precise new invariant/
  product blocker is proven.

Status: POST-AUDIT ORDER/POSITION/PERSISTENCE A MATRIX IN PROGRESS.

Post-audit order/position/persistence checkpoint: all five existing drivers were
expanded while staying at 222/258/86/229/497 LOC. Focused instrumented driver
tests, bot/E2E typechecks, ESLint0, Prettier and diff pass. Last complete 63/63
governed E2E is S3628/3713, B1882/2107, F705/712, L3416/3475. A later rerun
timed out in three pre-runtime CLI subprocesses (exit 143); it did not execute
these drivers and is not evidence of a cohort regression.

Reported blocker correction: `Execution.clientOrderId` is a required property
whose declared value type is `ClientOrderId | undefined`; likewise
`exchangeOrderId` permits `undefined`. Therefore a strict schema/type-valid
public execution with `{ clientOrderId: undefined, exchangeOrderId:
known.exchangeId }` reaches the exchange-ID resolution fallback without any
cast/private mutation. This is Category A, not a source/API decision. Add the
fallback and both-IDs-undefined no-op characterization only to the under-cap
existing `order-manager-boundaries.ts`; do not touch the 497-LOC order-flow file
or production source. Then rerun focused and full governed gates.

Status: EXECUTION-ID PUBLIC FALLBACK CHARACTERIZATION IN PROGRESS.

Execution-ID public fallback result: DONE only in
`order-manager-boundaries.ts` (278 LOC). A type-valid execution with
`clientOrderId: undefined` and a known exchange ID resolves/applies; both IDs
undefined is a no-op. Full governed E2E retry is stable 63/63 at S3634/3713,
B1888/2107, F705/712, L3419/3475. Bot/E2E typechecks, lint0, Prettier, diff and
unsafe scans pass. No production/API change or blocker.

## Post-audit A matrix: remaining strategy controllers

- Task class/mode/role: close all currently audited reachable strategy runner,
  market/order lifecycle, native/paper protection and plugin-risk residuals;
  write, non-review.
- Exact ownership: existing E2E drivers only:
  `strategy-runner-market-lifecycle.ts`, `strategy-runner-facade-coverage.ts`,
  `native-protection-retry.ts`, `native-protection-failsafe.ts`,
  `strategy-runner-protections.ts`, `strategy-runner-plugin-risk.ts`,
  `strategy-runner-plugin-risk-coverage.ts`,
  `strategy-runner-plugin-risk-coverage-lifecycle.ts`,
  `strategy-runner-risk-lifecycle.ts`, and
  `strategy-runner-order-lifecycle-boundaries.ts`. Do not touch the 497-LOC
  order-flow driver, source, manifest, case IDs, allowlists or create files.
- Required matrix: use the fresh raw residual to add only still-missing public
  paused/unsupported/non-OHLCV/force-exit/barred/callback-failure/queue-recovery;
  pending/blocked/tripped/max/zero-budget and fill/reconcile/protection callback;
  native/paper no-position/replace/pair-failure/fallback/partial/long-short-gap;
  plugin emergency/manager absence/funding timestamp/Error-string/trailing/
  reconcile/dispose/close/bar paths. Assert observable state, placement, reduce-
  only intents, cleanup, callbacks and structured logs. Avoid duplicate-covered
  cases; distribute data tables so every owned file remains <=500.
- Package/risk/reasoning: one bot package, strategy/order/risk Terra triggers;
  mandatory non-review `terra_worker` high, configured/callable, no fallback.
  Isolated paper/mock/DI only, no live/network/external write/stage/commit.
- Gates/prohibitions: focused RED/GREEN, E2E typecheck, full governed exact
  counters, lint0, Prettier, diff, LOC<=500; no casts/private mutation/invalid
  state/monkeypatch, threshold/scope weakening, delegation/self-review. Handoff
  only after the complete fresh residual cohort or an exact new invariant/C
  blocker.

Status: REMAINING STRATEGY-CONTROLLER A MATRIX IN PROGRESS.

Native-protection continuation ruling: `StrategyNativeProtectionController`
is already exported and exposes `getGroup`, `retireProtectionLeg`,
`settleProtectionGroup`, and `getNativeProtection`; the existing unit suite
already proves the same real lifecycle without private mutation. Therefore the
remaining S82-83 and bounded superseded-metadata retention paths are Category A,
not dead-source blockers. Continue only in the already owned under-cap native
E2E drivers, using installed public protection groups and authoritative
retirement/settlement transitions. No fabricated group, private access, cast,
padding-only assertion, source/public-API change, new file, or threshold/scope
change. Retain a case only if a fresh governed counter moves and the assertion
proves observable cancellation/replacement or bounded metadata behavior.

Continuation dispatch classification: bot-only write/non-review; live order
protection and risk semantics are Terra triggers; mandatory configured/callable
`terra_worker`, gpt-5.6-terra high, isolated workspace-write, no fallback.
External/mutable authority remains paper/mock/temp only with no venue, network,
stage or commit. Exact ownership remains `native-protection-retry.ts`,
`native-protection-failsafe.ts`, and regression-only
`strategy-runner-protections.ts`; validation remains focused RED/GREEN, E2E
typecheck, governed counter delta, ESLint0, Prettier, diff and <=500 LOC.

Native continuation result: DONE without production/API change. Only
`native-protection-retry.ts` (161 LOC) and the previously extended
`native-protection-failsafe.ts` (152 LOC) differ; the protection regression
driver remains 267 LOC. Exported-controller install -> retire -> settle and 501
public retirement cycles close the previously questioned empty-group and
bounded-metadata paths with a real +6 statements/+3 branches/+6 lines delta;
the absent-authoritative-position fail-safe retains its prior +1/+1 delta.
Fresh governed E2E is 63/63 at S3646/3713, B1918/2107, F706/712,
L3428/3475. Bot/E2E typechecks, ESLint0, Prettier and diff pass; no cast,
source/manifest/case-ID change, stage or commit. Exact thresholds remain red;
continue from the fresh residual audit, not the older matrix.

Residual-audit early hygiene finding: `native-protection-retry.ts` creates and
disposes a `StrategyRunner` that is not connected to the directly exercised
`StrategyNativeProtectionController`, drives no assertion and does not own the
emitted lifecycle. This is unnecessary coverage scaffolding and must be removed
from that existing driver, followed by focused/full counter proof. The 501
public retirement cycles remain necessary because they test the exact 1000-item
metadata retention boundary. Fix classification: bot-only mechanical
test-hygiene write/non-review within the existing Terra-risk cohort; mandatory
same `terra_worker` high, exact one-file ownership, no fallback/new file/source/
scope change, stage, commit, self-review or delegation.

Native hygiene result: DONE in `native-protection-retry.ts` (153 LOC). The
unconnected runner construction/disposal is removed; focused driver, bot/E2E
typechecks, ESLint0, Prettier and diff pass. Fresh governed E2E is 63/63 at
S3647/3713, B1920/2107, F706/712, L3427/3475. The expected -1 statement/-1 line
is exactly the unnecessary constructor path; public S82/S83 and retention
S296-299 remain covered. No new blocker.

Paper/facade continuation dispatch: write/non-review, one bot package; strategy
closure/protection/risk behavior is a Terra trigger, so mandatory configured
`terra_worker` gpt-5.6-terra high with workspace-write, no fallback. Exact
ownership is only existing `strategy-runner-protections.ts` and
`strategy-runner-facade-coverage.ts`; no source/new file/manifest/case-ID edit.
Close fresh paper-controller S52/S81 and StrategyRunner option-closure
S/F218/230/250 only through schema-valid paper/mock public feed, order,
protection, risk and callback transitions. Each case must assert observable
state/order/callback and produce a fresh governed counter delta; revert every
zero-delta case. Gates: focused E2E, bot/E2E typechecks, governed E2E, ESLint0,
Prettier, diff, LOC<=500, unsafe/disable scan. No live/network/external write,
cast/private mutation/monkeypatch, threshold/scope change, stage/commit,
self-review or delegation.

Event-serializer invariant dispatch: bounded one-file behavior-preserving
source simplification; write/non-review, one bot package. Although the edit is
mechanical, it sits in strategy event ordering, so Terra trigger and mandatory
configured `terra_worker` gpt-5.6-terra high, workspace-write, no fallback.
Exact ownership is only
`apps/bot/src/bot/strategy-runner.event-serializer.ts`; the existing public
`strategy-runner-event-serializer.test.ts` is read-only characterization. RED
is the fresh E2E uncovered executable no-op at line 16; replace only
`catch (error) { void error; }` with `catch {}` so rejection swallowing and
subsequent ordered execution are unchanged. Validate the existing unit test,
bot typecheck, governed unit/E2E counter delta, scoped ESLint0, Prettier, diff,
LOC and unsafe scan. No new test/file/API/logging/behavior, threshold/scope
change, external write, stage/commit/self-review/delegation.

Event-serializer lint clarification: the exact empty catch is rejected by the
repository `no-empty` rule. Authorize the smallest lint-native equivalent:
`catch { /* prior rejection must not block the next queued operation */ }`.
This removes the executable no-op/error binding while preserving deliberate
swallowing; comment wording may be normalized by Prettier. No disable or config
change is allowed.

Event-serializer result: DONE in the exact 31-LOC source. The catch contains
only the intent comment, with no binding/executable no-op/disable. Focused unit
1/1, bot typecheck, source ESLint0, Prettier, diff and unsafe scan pass. Its full
E2E attempt was invalidated by a concurrent writer recreating the shared
`apps/bot/coverage/e2e` output; no counter claim is made. All remaining governed
E2E runs are serialized by the coordinator, and the next completed writer must
measure the integrated source change.

Market-event residual dispatch: complete the fresh reachable residual in the
existing `strategy-runner-market-lifecycle.ts` only; write/non-review, one bot
package. Market/strategy event handling is a Terra trigger, so mandatory
configured `terra_worker` gpt-5.6-terra high, workspace-write, no fallback.
Target runtime is read-only
`strategy-runner-market-event-controller.ts`; close S96,100-102,194,208,218,238,
F193 and all fresh branch zeros via schema-valid paper/mock public events:
force-exit portfolio/direct, ticker/non-OHLCV, MTF, policy-symbol gates and
callback Error/string isolation. Assertions must prove state/order/callback/log
effects. Keep the formatted driver <=500 by table/helper consolidation; no new
file/source/API/manifest/case-ID, cast/private mutation/monkeypatch, invalid
input, threshold/scope change, external write, stage/commit/self-review or
delegation. Gates are focused RED/GREEN, E2E+bot typechecks, fresh governed
counter delta with zero-delta removal, ESLint0, Prettier, diff and LOC.

Market-event residual result: DONE in the exact existing driver at 500 LOC.
Focused lint/format/type/diff gates pass; governed E2E is 63/63 at S3653/3712,
B1932/2107, F709/712, L3430/3474. The controller itself is exact S115/115,
F17/17 and L97/97; B67/70 remains. Those three branches are the `frames[0]`,
`frames[1]`, and last-frame fallback endpoints in `makeContext`: a call is made
only after the event timeframe equals `strategy.timeframes.at(-1)`, proving a
nonempty list; when length >2, index 1 is present. They are Category B, not
valid test inputs. A separate source owner must replace the redundant fallbacks
with a locally type-safe nonempty/three-frame representation while preserving
one-frame and three-frame HTF/MTF/LTF behavior and keeping E2E exact.

Market-frame invariant simplification dispatch: source+existing-driver
write/non-review, one bot package; strategy context semantics are a Terra
trigger, so mandatory configured `terra_worker` gpt-5.6-terra high,
workspace-write, no fallback. Exact ownership is
`strategy-runner-market-event-controller.ts` plus the existing 500-LOC
`strategy-runner-market-lifecycle.ts`; no new file. Replace only the three
proven unreachable fallback endpoints using a locally type-safe approach that
requires no assertion/cast and preserves: empty timeframes skip dispatch,
one-frame htf=mtf=ltf=current, and three-frame htf=first/mtf=second/ltf=current.
First add/retain public characterizations for empty/one/three frames and record
the RED three branch zeros, then GREEN exact controller coverage. Keep driver
<=500 through consolidation. No API/config/schema/manifest/case-ID change,
invalid/sparse fixture, threshold/ignore/disable, external write, stage/commit,
self-review or delegation. Gates: focused E2E, bot/E2E typechecks, serialized
governed E2E, ESLint0, Prettier, diff, LOC and unsafe scan.

Market-frame invariant result: DONE in the exact controller and 497-LOC
existing driver. Local `resolveStrategyContextFrames` returns no context for an
empty list, one frame for all roles, and first/second/last for three or more;
there is no assertion/cast or fallback branch. Public empty/one/three-frame
scenarios characterize the contract. Controller E2E is exact S119/B69/F18/
L100, all 100%; global 63/63 is S3655/3716, B1933/2106, F710/713,
L3431/3477. Bot/E2E typechecks, ESLint0, Prettier, diff and unsafe scan pass.
One redundant plugin-sizing block was removed from the driver to stay at 497
LOC, and the fresh global counters prove no coverage regression. No new file,
stage or commit.

Order-lifecycle controller residual dispatch: complete the fresh reachable
residual through existing
`strategy-runner-order-lifecycle-boundaries.ts` only; write/non-review, one bot
package. Order/risk lifecycle semantics are Terra triggers, so mandatory
configured `terra_worker` gpt-5.6-terra high, workspace-write, no fallback.
Target runtime remains read-only. Close the audited S54-57,64,155,159,231,234,
245-246,257,291 and all associated branch zeros through valid paper/mock public
budget, RiskManager sizing, portfolio fill, callback, placement/reconciliation,
partial-fill and execution-price paths. Assertions must prove order/state/
callback/log effects. Keep the formatted driver <=500 using typed tables and
shared existing helpers. No new file/source/API/manifest/case-ID, cast/private
mutation/monkeypatch/invalid input, threshold/scope change, external write,
stage/commit/self-review/delegation. Gates: focused RED/GREEN, bot/E2E
typechecks, serialized governed E2E with zero-delta removal, ESLint0, Prettier,
diff, LOC and unsafe scan. Handoff only complete cohort or precise blocker.

Order-lifecycle driver reclassification: the existing canonical case imports
the ledger-recording `runtime-driver-core` feed, while its final allowlist
currently requires zero placements. The reachable budget/RiskManager/fill/
reconciliation paths necessarily place through that exact public feed. The
honest minimal fix is not to bypass the ledger with another mock: add the
existing `strategy-runner-order-lifecycle-boundaries` case ID to
`orderExerciseCases`, preserving the ID and requiring `placeOrderLedger > 0`.
Expanded exact ownership is only that driver plus `runtime-driver.ts`; same
mandatory `terra_worker` high write/non-review route, no new file/case/manifest/
source/API. First characterize current final assertion RED on a valid successful
placement, then change the allowlist and complete the prior matrix. Keep both
files <=500; focused driver, final-ledger assertion, typechecks/lint/format/diff
must pass before the serialized full E2E. No threshold/scope weakening: this
strengthens the case's order-boundary proof.

Order-lifecycle hostile-boundary clarification: placement/reconciliation are
external Promise ports and can reject with any JavaScript value; the production
String fallback is therefore reachable, not an invariant. Retain Error and
string characterization. If lint rejects the deliberate string throw, exactly
one line-scoped `@typescript-eslint/only-throw-error` exception per fault
injection is allowed with the reason that it verifies normalization of a
non-Error external rejection. No file/config/broad disable is allowed; count
and list every such line in the handoff. This is evidence-only test scaffolding,
not a product or risk behavior change.

Order-lifecycle residual result: DONE. The existing canonical case now honestly
requires the ledger-recording placement boundary; the 497-LOC driver covers the
complete controller. Per-file governed E2E is exact S111/B117/F10/L104, all
100%; global 63/63 is S3686/3716, B1996/2106, F711/713, L3453/3477 and remains
red only for other runtime owners. Focused case, bot/E2E typechecks, ESLint0,
Prettier and diff pass. Exactly two line-scoped hostile-port
`only-throw-error` directives remain at driver lines 59 and 77; no broad/config
disable, new file, source/API/case-ID/manifest change, stage or commit.

Plugin-risk controller residual dispatch: complete the fresh reachable
residual through existing `strategy-runner-plugin-risk-coverage.ts` and
`strategy-runner-plugin-risk-coverage-lifecycle.ts` only; write/non-review,
one bot package. Emergency/trailing-risk behavior is a Terra trigger, so
mandatory configured `terra_worker` gpt-5.6-terra high, workspace-write, no
fallback. Target runtime remains read-only. Close audited S119,214,272,275-279,
301,304,336,353,358-359, F353 and all branch zeros via valid public concurrent
emergency, missing/disappeared position, short trailing close, open/cancelled
lifecycle, funding/plugin Error-string and reconciliation-error paths.
Assertions must prove pause/order/state/callback/log/cleanup effects. Both
formatted drivers stay <=500 through tables/helpers; no new file/source/API/
manifest/case-ID, cast/private mutation/monkeypatch/invalid input, threshold/
scope change, external write, stage/commit/self-review/delegation. Gates:
focused RED/GREEN, bot/E2E typechecks, serialized governed E2E after coordinator
release with zero-delta removal, ESLint0, Prettier, diff, LOC and unsafe scan.

Plugin-risk hostile-boundary clarification: plugin/funding/order subscription
ports are external Promise/callback boundaries and non-Error rejection is a
real JavaScript input. Retain both Error and string normalization tests. If the
test throw is otherwise lint-impossible, permit only an exact line-scoped
`@typescript-eslint/only-throw-error` exception with a current fault-injection
reason; list each line/count. No config/file/broad disable or fabricated private
state.

Plugin-risk LOC reclassification: the two owned drivers are already 457 and
482 LOC while the fresh residual remains substantive. To avoid an unnecessary
new file or compressed unreadable tests, expand ownership to the existing,
active canonical `strategy-runner-plugin-risk.ts` (currently well below 500),
which targets the same controller and has no concurrent writer. Distribute
startup/regime/funding/plugin cases there; retain lifecycle/reconciliation cases
in their current drivers. No new case/manifest/runtime allowlist or behavior
change. All three files must remain <=500 and every moved/new block must retain
a fresh counter contribution.

Plugin-risk residual result: DONE across the three existing active drivers at
498/500/482 LOC. Fresh serial per-file E2E is exact S173/B135/F24/L151, all
100%. Focused cases, bot/E2E typechecks, ESLint0, Prettier and diff pass. Four
line-scoped hostile-boundary directives remain (two funding
`only-throw-error`, two controller `prefer-promise-reject-errors`); no broad/
config disable, source/new/temp file, case/manifest change, stage or commit.

Native-protection remaining-residual dispatch: complete the fresh reachable
native controller residual through existing `native-protection-retry.ts`,
`native-protection-failsafe.ts`, `strategy-runner-protections.ts`, and
`strategy-runner-facade-coverage.ts` only; write/non-review, one bot package.
Native protective orders are a Terra live-risk trigger, so mandatory configured
`terra_worker` gpt-5.6-terra high, workspace-write, no fallback. Runtime remains
read-only. Close S204/S217/S262 and all remaining public branch endpoints via
valid paper/mock different-symbol, missing-position, zero/partial fill, short
close, cancel-pending, reconciliation Error/string and price/time fallback
transitions. Prove order/position/group/callback/log effects; keep each driver
<=500 and retain the already justified 501-cycle bound test. No new file/source/
API/manifest/case-ID, cast/private mutation/monkeypatch/invalid input,
threshold/scope change, external write, stage/commit/self-review/delegation.
Focused/type/lint/format/diff first; do not run full coverage until coordinator
release, then one serialized full and revert zero-delta additions.

Paper-protection final-branch dispatch: complete the fresh six reachable branch
zeros only in existing `strategy-runner-protections.ts`; write/non-review, one
bot package. Protective exit behavior is a Terra risk trigger, so mandatory
configured `terra_worker` gpt-5.6-terra high, workspace-write, no fallback.
Target runtime is read-only. Cover B57 else and B60 true (short stop/target gap
prices), B87 price fallback endpoints, B89 timestamp fallback and B91 partial-
fill false via valid public paper protection transitions with observable order,
position and callback assertions. This file is now exclusively paper-owned;
future native work must use retry/failsafe/facade drivers only. Keep <=500; no
new file/source/API/manifest/case-ID, cast/private/invalid input, threshold/scope
change, external write, stage/commit/self-review/delegation. Focused/type/lint/
format/diff first; wait for coordinator before serialized full E2E.

Paper-protection result: DONE in the 491-LOC existing driver. Public long-target
gap, short-stop gap, missing average/price/timestamp and partial receipt paths
close all six endpoints with observable position/callback assertions. Fresh
coordinator serial E2E confirms the paper controller exact S24/B45/F4/L21, all
100%; E2E typecheck, ESLint0, Prettier and diff pass. No source/new file,
stage or commit.

Fresh post-plugin/paper serial audit: E2E 63/63 at S3688/3716,
B2025/2106, F711/713, L3455/3477. Plugin-risk and paper-protection controllers
are exact 100%; any earlier global-green statement from a concurrent run is
superseded by this coordinator-run serial result. Native/facade continuation
ownership is narrowed to `native-protection-retry.ts`,
`native-protection-failsafe.ts`, and `strategy-runner-facade-coverage.ts`;
`strategy-runner-protections.ts` is final paper-owned and must not change.
Close all 17 native branch zeros at lines 71,107,164,178,207,209,211,226,228,
232,234,236,240,260,264,285 plus runner S278-279,298,314,335,377, F334 and
branch lines 130,277-299,314,377 through valid public native lifecycle,
price/time/position/callback transitions. Same mandatory `terra_worker` high
route and prohibitions. Serialized full gate is available; handoff only when
both runtimes are exact or a precise B/C proof is returned.

Order-manager stack residual dispatch: complete the fresh reachable gaps in
`order-manager-lifecycle.ts`, `order-manager-placement.ts`, and
`order-manager.ts` through existing `order-manager-boundaries.ts` only;
write/non-review, one bot package. Live order lifecycle is a Terra trigger, so
mandatory configured `terra_worker` gpt-5.6-terra high, workspace-write, no
fallback. Runtime files are read-only. Fresh targets: lifecycle S57,63,98,101,
150,162,179,218,270-275, F97 and branch lines 53,56,59,63,97,101,130,150,162,
187-188,202,217,237,243,250,269; placement B130; manager S280 and branch lines
104,107,119,122,260,273,279,289. Use only valid public/mock subscription,
execution-ID, capacity-eviction, partial/terminal/cancel/reconcile and Error/
string boundary flows with observable order/counter/state/log effects. Keep the
existing driver <=500 through typed tables/helpers; if impossible, report an
exact existing under-cap driver redistribution before creating any file. No
source/API/manifest/case-ID/cast/private mutation/invalid input, threshold/
scope change, external write, stage/commit/self-review/delegation. Focused,
type/lint/format/diff first; wait for coordinator before serialized full E2E.

Position/persistence residual dispatch: complete the fresh reachable gaps in
`position-manager.ts`, `position-manager.restoration.ts`, and `state-store.ts`
through existing `position-manager-boundaries.ts` and
`state-store-boundaries.ts` only; write/non-review, one bot package. Position
risk and persisted state are Terra triggers, so mandatory configured
`terra_worker` gpt-5.6-terra high, workspace-write, no fallback. Runtime files
are read-only. Targets: restoration B46; position S116-117,124,129,209,332 and
B116,191,331,365; StateStore B150. Use only valid public restore/open/fill/
aggregate/close/reconcile/risk-manager and debounce/flush transitions with
observable position/equity/counter/file-state assertions. Keep both drivers
<=500; no new file/source/API/manifest/case-ID, cast/private mutation/invalid
input, threshold/scope change, external write, stage/commit/self-review/
delegation. Focused/type/lint/format/diff first; wait for coordinator before
serialized full E2E, then retain only fresh delta.

Parallel residual-audit dispatch classification: read-only/non-review over the
fresh generated E2E coverage envelopes and the remaining strategy-controller
sources/drivers; one bot package; strategy/order/risk reasoning and cross-file
reachability are Terra triggers, so mandatory `terra_reader`, gpt-5.6-terra
high, read-only authority, no fallback. It owns no files and must not mutate,
stage, commit or delegate. It may read concurrent writer output but must report
only a fresh post-writer snapshot, classifying every remaining S/B/F/L zero as
publicly reachable through an existing owned driver, a proven typed invariant
eligible for minimal source simplification, or a genuine product decision. It
must also identify zero-delta/redundant tests and exact under-500 owner paths.

Serialized writer handoff result: native/facade drivers are focused-green at
285/262/359 LOC; order boundary is focused-green at exactly 500 LOC; position
and StateStore boundaries are focused-green at 309/98 LOC. E2E typecheck,
scoped ESLint0, Prettier and diff-check are green after the StateStore logger
API correction. No worker ran a valid shared full gate, and no worker staged or
committed.

Fresh coordinator-only serial E2E audit: all 63/63 cases pass; coverage is
S3709/3716, B2056/2106, F712/713, L3472/3477. The remaining exact zero map is
restricted to 14 runtime files. This result supersedes every concurrent or
interrupted coverage claim.

Order-manager invariant-closure continuation: write/non-review, one bot
package; live order lifecycle is a Terra trigger, therefore reuse the configured
`terra_worker` gpt-5.6-terra high with workspace-write and no fallback. Owned
paths expand to `order-manager-lifecycle.ts`, `order-manager-placement.ts`,
`order-manager.ts`, the existing `order-manager-boundaries.ts`, and only directly
required existing unit tests. Close the fresh S/B/F/L map through valid public
flows; where the typed lifecycle makes an endpoint impossible, remove only the
redundant fallback/default/guard after a focused characterization test. Preserve
all order, cancellation, reconciliation, ID, price, leverage and fail-closed
semantics. No casts/private mutation/monkeypatch/invalid financial state, new
file, API/case/manifest/threshold change, stage/commit/self-review/delegation.
Focused RED/GREEN, bot+E2E typecheck, lint0, format/diff/LOC; no shared full run.

Position/persistence invariant-closure continuation: write/non-review, one bot
package; position risk and persisted state are Terra triggers, therefore reuse
the configured `terra_worker` gpt-5.6-terra high with workspace-write and no
fallback. Own `position-manager.ts`, `state-store.ts`, their two existing E2E
drivers and only directly required existing unit tests. The valid finite public
contract proves aggregate/open leverage helpers either return or throw
`LeverageBreachError`; simplify the two redundant non-breach rethrow branches
without weakening exact leverage checks, and close the remaining default/state
branch by a real public flow or a separately proven invariant simplification.
No invalid/nonfinite financial fixture, cast/private mutation/monkeypatch, new
file/API/case/manifest/threshold change, stage/commit/self-review/delegation.
Focused RED/GREEN, bot+E2E typecheck, lint0, format/diff/LOC; no shared full run.

Native/runner invariant-closure continuation: write/non-review, one bot
package; native protection and strategy lifecycle are Terra triggers, therefore
reuse the configured `terra_worker` gpt-5.6-terra high with workspace-write and
no fallback. Own `strategy-runner-native-protection-controller.ts`,
`strategy-runner.ts`, the existing retry/failsafe/facade drivers and only
directly required existing unit tests. Close the fresh 10 native branches and
runner S377 plus branch lines 130,278,282,285,287,292,299,377 using real public
short/long protection and lifecycle transitions; remove only statically proven
redundant typed fallbacks/guards after characterization. Preserve order side,
quantity, reconciliation, cancellation, callback and fail-closed behavior. No
cast/private mutation/monkeypatch/invalid input/new file/API/case/manifest/
threshold change, stage/commit/self-review/delegation. Focused RED/GREEN,
bot+E2E typecheck, lint0, format/diff/LOC; no shared full run.

Bot/config/portfolio final public-branch dispatch: write/non-review, one bot
package. Bot emergency cleanup, authoritative equity, portfolio risk and
correlation are Terra triggers, therefore reuse a configured `terra_worker`
gpt-5.6-terra high with workspace-write and no fallback. Runtime sources are
read-only unless the fresh test proves a statically redundant invariant and the
coordinator is notified before any source edit. Own only the existing active
drivers `bot-cleanup-and-order-risk.ts`, `bot-lifecycle-factory.ts`,
`cli-boundaries.ts`, `portfolio-primitives.ts`, `portfolio-manager-paper.ts`
and `portfolio-manager-lifecycle.ts`; do not touch the over-500
`bot-state-and-telemetry.ts`. Close fresh branches: authoritative-equity null,
emergency unresolved non-stop, Telemetry default interval/reasons,
root-level Zod issue formatting, Correlation default argument/default window
and nonfinite finite-extreme fallback, invalid terminal evidence limit, and
PortfolioStop default argument. Use only public schema-valid paper/mock flows
with observable result/log/state assertions. Retain only cases with fresh
counter delta; every touched driver <=500. No new file/source/API/manifest/
case-ID/cast/private mutation/monkeypatch/invalid financial value/threshold
change, external write, stage/commit/self-review/delegation. Focused isolated
raw output, bot+E2E typecheck, lint0, format/diff/LOC; no shared full run.

Position/persistence result: READY for the coordinator's serialized run. The
existing position driver now exercises public closed-trade retention (1001 to
the newest 1000), realized-PnL overwrite plus equity aggregation, quarantined
position lookup, and same-side aggregate 1:10 rejection with its public log.
The existing StateStore driver proves that an identical debounce/flush snapshot
does not rewrite the published file or emit a second saved event. Both focused
instrumented runtime-driver cases passed; E2E typecheck, ESLint, Prettier and
diff-check pass; files are 309 and 98 LOC. No source/new file/API/manifest/
case-ID/cast/private mutation/invalid input, stage or commit. Category B
handoff: `position-manager.ts` lines 129 and 209, and the false endpoints of
the associated `instanceof LeverageBreachError` branches (B116/B191), require
the invariant helper to throw a non-LeverageBreachError. With public valid
finite position/restoration/open/fill inputs, aggregate notional and equity are
finite and positive; therefore that helper can only return or throw
LeverageBreachError. Reaching those paths would require invalid non-finite or
overflowed financial values, prohibited by this brief. No source ownership was
granted for their simplification.

Position/persistence invariant-closure result: DONE pending coordinator serial
E2E. `position-manager.ts` now handles every invariant-helper error through
the same fail-closed, structured-log and cause-preserving `PositionManagerError`
path; the two redundant non-`LeverageBreachError` rethrows are removed without
changing the exact 1:10 call or valid-finite public behavior. StateStore B150
remains closed by the existing real identical debounce/flush file-state flow.
Focused unit evidence: PositionManager 23/23, restoration 6/6, StateStore
22/22; bot and E2E typechecks, scoped ESLint0, Prettier and diff-check pass;
owned files are 403/373/309/98 LOC. A new instrumented focused run was blocked
only by another active writer's repository-owned raw coverage `2.json`
(strategy-runner-facade-coverage); it was not altered. No shared full run,
stage or commit.

Bot/config/portfolio final public-branch result: PARTIAL handoff. Existing
drivers add public bare-default CorrelationMatrix and PortfolioStop contracts,
finite-extreme correlation fail-closed behavior, NaN terminal-evidence-bound
rejection, and Telemetry default interval plus empty default-reasons metrics.
Scoped ESLint0, Prettier and diff-check pass; all six owned drivers remain
under 500 LOC (264/262/408/258/169/300). The shared E2E typecheck is currently
blocked outside this ownership by `native-protection-retry.ts:231` TS4111
(index-signature `.error` access); no shared raw or full coverage was run.
No valid public path was added for authoritative-equity-null, unresolved
emergency non-stop, or loader root-level Zod formatting without guessing or
using invalid fixtures; these require fresh exact audit/classification.

Bot/config/portfolio DI regression repair: DONE. The bare CorrelationMatrix
and PortfolioStop constructor cases are now explicit missing-logger failures;
their business defaults are asserted only with the required quiet logger.
Fresh E2E typecheck, scoped ESLint0, Prettier and diff-check pass; primitives
is 260 LOC and the instrumented build passes. No isolated runtime case was
written into the active coordinator serial raw directory.
