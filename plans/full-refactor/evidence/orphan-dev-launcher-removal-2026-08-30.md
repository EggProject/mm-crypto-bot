# `scripts/dev.sh` eltávolításának bizonyítéka

Időpont: 2026-08-30, Europe/Budapest. Ez a dokumentum kizárólag a törölt
`scripts/dev.sh` és a hozzá tartozó `plans/full-refactor/SCRIPTS.md` sor
nyilvántartása; a dirty-union munkafa többi változását nem minősíti.

## Besorolás és határ

Az eredeti feladat `terra_worker`, `gpt-5.6-terra`, `high`,
`workspace-write` besorolású volt, mert operatív fejlesztési launchert érintett.
A pontos tulajdon két fájl volt: a törlendő `scripts/dev.sh` és a módosítandó
`plans/full-refactor/SCRIPTS.md`; egy runtime package sem tartozott a scope-ba.
A tiszta előállapotot a `git ls-files` snapshot rögzítette, amelyben a launcher
tracked volt, 34 soros tartalommal. A törlés előtt consumer-inventory futott:
csak két parser-fixture sor és a terv inventory-sora hivatkozott rá; package,
Turbo, CI vagy operátori caller nem volt.

## Döntés és eredmény

RED állapotban a launcher root `logs/` könyvtárat, PID-fájlt és a repositoryban
lévő `run-bot` konfigurációs útvonalat kapcsolta össze, ezért a meglévő
folyamat- és naplókezelési szerződés nem volt elfogadható. GREEN állapotban a
`scripts/dev.sh` törölve lett, pótló launcher nem készült, az inventory sora
`REMOVED` lett. Támogatott felületként megmarad a root `bun run dev` és a bot
közvetlen CLI-ja (`bun run apps/bot/src/index.ts ...`). A scope kifejezetten nem
érintette a config reload/watch későbbi célját, a `run-bot` konfigurációt, a
log-helyettesítést vagy aliasok áttervezését.

## Ellenőrzési napló

- `test ! -e scripts/dev.sh`: PASS.
- A consumer/zero-legacy teszt: 18/18 teszt, 44 expectation: PASS.
- `Prettier` a két evidence/inventory célfájlon, `git diff --check`, 68 soros
  scoped LOC-ellenőrzés és a cached-index trackability ellenőrzése: PASS.
- Secret scan: PASS; a találatok értelmezése szerint nincs credential, kulcs
  vagy érzékeny payload az érintett diffben.
- A technikai re-review: PASS. Az első process-review evidence-only hibát
  jelzett; ez a dokumentum annak tartós pótlása, a process R1 kézbesítése
  külön történik.

## Visszaállíthatóság és integráció

Az eltávolítás recoverable: a pontos HEAD `6c2e93b16c0c85ed726a472493058c7ae0fd1876`,
és a `git show HEAD:scripts/dev.sh` receipt igazolja a forrást. A koncepcionális
visszaállítási parancs `git restore --source=HEAD -- scripts/dev.sh` **nem lett
lefuttatva**. Nem történt stage vagy commit. A dirty-union állítás kizárólag a
kijelölt két fájlra vonatkozik; rollback esetén csak ezek a fájlok állíthatók
vissza, más változás érintése nélkül.

## Retrospective Agy eligibility assessment

This evidence-writer dispatch is corrected retrospectively: the current rules did not make an Agy write route eligible because the authoritative worktree was shared and dirty, direct Agy writes were forbidden, and no dedicated isolated workspace or effective allow/deny boundary was used or authorized for this slice. The Luna mechanical documentation-only route therefore remained the current disposition. No evaluated Agy route or observable attestation is claimed.

## Commit provenance correction

The historical pre-commit/preflight statements above apply to the review-before-commit snapshot only. The implementation was subsequently committed as `94f8af0`. `git show --stat --oneline 94f8af0` identifies the implementation slice, and after that commit the exact implementation paths scripts/dev.sh and plans/full-refactor/SCRIPTS.md were clean.
