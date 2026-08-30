# CI formátumkapu evidence — 2026-08-30

## Besorolás és hatókör

- Feladatklasszis: rutin, dokumentáció-only evidence-írás; alacsony kockázatú, mechanikus módosítás.
- Route: `luna_worker` (profil: `gpt-5.6-luna`, low); workspace-write sandbox.
- Read/write: írás, 0 package; nincs trading/security/data/public-API/architecture Terra-trigger, nincs külső vagy mutable erőforrás.
- Review role: non-review. No Agy fallback was eligible; the current Luna disposition is recorded below.
- Kizárólagos ownership: `.github/workflows/ci.yml` és `scripts/tooling/ci-format-workflow-contract.test.ts` implementation path, továbbá ez az evidence és az index egyetlen hivatkozási sora. Más fájlra nincs átfedő ownership.

## RED → GREEN

Az előzetes RED semantic contract azt mutatta, hogy a CI workflow-ból hiányzott a külön formátum-ellenőrző job. A GREEN implementation hozzáadta a `format` jobot: pinned Bun/Node toolchain, checkout, frozen install és pontos `bun run format:check` futtatás. A hozzá tartozó contract test ezt a szerződést YAML-szemantikán ellenőrzi.

Az independent Terra technical review **PASS** eredményt adott, nyitott valid finding nélkül. Az első independent process review **FAIL** volt; remediationként ez a tartós evidence-rekord rögzíti a besorolást, ownershipet, RED/GREEN állapotot, tesztértelmezést és a korlátokat.

## Validáció

Újrafuttatott pontos kombinált parancs:

```text
bun test scripts/tooling/ci-format-workflow-contract.test.ts scripts/tooling/toolchain-contract.test.ts
bun test v1.3.14 (0d9b296a)
10 pass
0 fail
63 expect() calls
Ran 10 tests across 2 files. [28.00ms]
```

A candidate contract önmagában 1 testet és 5 expectationt futtat. A kombinált 10 test / 0 fail eredmény nem külön acceptance minimum, és nem értelmezhető tesztpaddingként; a meglévő toolchain contracttal együtt futtatott közös ellenőrzés pontos kimenete.

A két implementation pathon a scoped ESLint és Prettier ellenőrzés zöld, a `git diff --check --` zöld, a secret scan és az index-ellenőrzés zöld. Mindkét path 500 LOC alatt marad. A cached diff üres ezen a két pathon; nincs stage és nincs commit.

A root `bun run format:check` jelenleg RED a dirty-union 30, ettől a scope-tól független fájlja miatt; ezek közül egyik owned path sem érintett. Ezért ez az evidence kizárólag a CI format-gate candidate-re vonatkozik, és nem állít whole-worktree PASS-t.

## Rollback és korlát

Rollback esetén az új `format` job, a hozzá tartozó contract test és az evidence index-hivatkozása eltávolítandó. A változtatás nem stage-elt és nem commitolt.

## Retrospective Agy eligibility assessment

This evidence-writer dispatch is corrected retrospectively: the current rules did not make an Agy write route eligible because the authoritative worktree was shared and dirty, direct Agy writes were forbidden, and no dedicated isolated workspace or effective allow/deny boundary was used or authorized for this slice. The Luna mechanical documentation-only route therefore remained the current disposition. No evaluated Agy route or observable attestation is claimed.

## Commit provenance correction

The historical pre-commit/preflight statements above apply to the review-before-commit snapshot only. The implementation was subsequently committed as `2610154`. `git show --stat --oneline 2610154` identifies the implementation slice, and after that commit the exact implementation paths .github/workflows/ci.yml and scripts/tooling/ci-format-workflow-contract.test.ts were clean.
