# CI dokumentáció aktuális állapota

Rögzítve: 2026-08-30, Europe/Budapest. Ez routine, dokumentáció-only
korrekció; a kijelölt route `luna_worker`, `gpt-5.6-luna`, `low`,
`workspace-write`. A feladat nulla runtime package-t érint, nem-review feladat,
és nincs Terra-trigger. Az eredeti docs-feladat egyetlen
implementation-owned jelöltje `docs/CI.md`; a `.github/workflows/ci.yml`
kizárólag olvasott referencia. Az evidence-fájl és a
`REVIEW-EVIDENCE.md`-ben lévő link evidence-only remediation ownership; ezek
nem fednek át a külön workflow/test implementation feladattal, és más agentek
módosításait nem érintik és nem állítják vissza.

## Forrás és eltérés

Az egyetlen olvasott runtime-forrás a `.github/workflows/ci.yml`. A korábbi
`docs/CI.md` állapot RED volt: hat jobot és elavult telepítési/teszt/build
állításokat sugallt, nem írta le a format jobot és az alapítványi ellenőrzés
hiányos státuszát, továbbá nem választotta el a JUnit/artifact és coverage
láncot a külső branch-protection beállításoktól.

## GREEN ellenőrzés

Az új dokumentáció pontosan a workflow hét jobját és sorrendjét rögzíti:
`typecheck`, `lint`, `format`, `verify-foundation`, `test`, `build`, `coverage`.
Leírja a push/pull-request `main` trigger-párt, a pinned Bun/Node setupot és
frozen installt, a tényleges parancsokat, az explicit incomplete foundation
ellenőrzést, a JUnit feltöltést/PR-publikálást, a külön unit/subprocess E2E
coverage artifacteket, valamint a full-history és fail-closed coverage-base
láncot. A mergeability és branch protection külső repository-beállítás, ezért
nem állítja belső workflow-tényként.

A szemantikai ellenőrzés `Bun.YAML.parse`-szal történt. A kombinált CI
workflow-contract és toolchain-contract futás eredménye **10 pass, 0 fail,
63 expectation**. A kijelölt dokumentációs scope Prettier-, diff-check-,
LOC<=500-, secret-scan- és cached-index ellenőrzései PASS; staging és commit
nem történt. A teljes root format futás a más agentek dirty-union fájljai miatt
RED maradt, ezt nem tulajdonítjuk ennek a két dokumentációs fájlnak és nem
állítunk whole-repo format PASS-t. A független Terra technical review PASS;
az első Luna process review evidence-hiány miatt FAIL volt, ez a fájl és az
indexhivatkozás annak szűk remediationje.

## Határ, rollback és státusz

Ez a bizonyíték csak a `docs/CI.md` aktuális workflow-leírását igazolja; nem
igazolja a repository-szintű `verify` parancsot, branch protectiont, live
readiness-t vagy a teljes dirty worktree-t. Rollback: a dokumentációs változás
és ez az evidence-link együtt, fájlszinten visszavonható; ezt a dokumentációs
feladatot runtime, config, CI-workflow vagy teszt változtatása nem kísérte
(a shared dirty worktree külön, már review-zott workflow-változását ez nem
foglalja magában). A lezárás előtt ugyanazon tulajdonon
független Luna process re-review szükséges.

## Retrospective Agy eligibility assessment

This evidence-writer dispatch is corrected retrospectively: the current rules did not make an Agy write route eligible because the authoritative worktree was shared and dirty, direct Agy writes were forbidden, and no dedicated isolated workspace or effective allow/deny boundary was used or authorized for this slice. The Luna mechanical documentation-only route therefore remained the current disposition. No evaluated Agy route or observable attestation is claimed.

## Commit provenance correction

The historical pre-commit/preflight statements above apply to the review-before-commit snapshot only. The implementation was subsequently committed as `207dec6`. `git show --stat --oneline 207dec6` identifies the implementation slice, and after that commit the exact implementation paths docs/CI.md were clean.
