# Full refactor: current baseline evidence

**Recorded:** 2026-08-30 (Europe/Budapest)
**Status:** `OBSERVED` baseline only; this document grants no implementation authority.

## Besorolás és határ

Ez a munka rutinszerű, csak dokumentációs bizonyíték-rögzítés volt: egy
fájlt, nulla runtime-csomagot érintett, alacsony kockázatú, lineáris feladatként
a `luna_worker` útvonal kapta (`gpt-5.6-luna`, `low`, `workspace-write`). Az
eredeti implementációs jelölt kizárólagos tulajdonú fájlja a
`plans/full-refactor/README.md` volt. A jelenlegi evidence-writer tulajdona csak
az új bizonyítékfájl és a review-index egyetlen hivatkozási sora; nem volt
átfedés manifestekkel, read-only forrásokkal vagy a worktree más változásaival.

## Aktuális, ellenőrzött tények

- Az inventory pontosan egy alkalmazást (`apps/bot`) és tizenegy workspace
  csomagot mutat: `assert`, `backtest`, `backtest-tools`, `core`, `exchange`,
  `logging`, `numeric`, `paper`, `shared`, `typeguard`, `typing`.
- A `search-best-config/` workspace-en kívüli könyvtár, package manifest nélkül.
  A `run-bot/config/` továbbra is követett; a külső runtime-migráció halasztott.
- Hiányzik a `bin/mm-bot`, a `scripts/install-mm-bot.sh`, a root
  `postinstall`/`mm-bot` script, valamint a bot package `bin` mezője. Az
  `apps/web/` és a root `verify` script szintén hiányzik.
- A tényleges verziók: Bun `1.3.14`, TypeScript `6.0.3`, Turbo `2.10.10`.
  A `workspace:*` használata bizonyítja, hogy nem minden dependency-range
  exact pin.
- A source- és test-inventory 41 darab 500 sornál hosszabb fájlt tartalmaz.
  Ez továbbra is bontandó célállapot, nem elfogadott megfelelőségi bizonyíték.
- A jelenlegi kód/config még dinamikus vagy maximum-leverage szemantikát és
  JavaScript-number pénzügyi értékeket tartalmaz. E dokumentum nem állít fix
  pontos 10x vagy exact-numeric megfelelést.

## Reprodukálható ellenőrzések

Az inventory- és keresési parancsok igazolták a fenti workspace-, manifest-,
alias-, installer-, postinstall-, `apps/web/` és root-`verify` tényeket; a
verziókat a repository toolchain-kontraktusaiból olvastuk. A toolchain-contract
teszt eredménye `9/9` teszt, összesen `58` assertion (`PASS`).

A scoped dokumentációs gate-ek: Prettier, `git diff --check`, a 500-soros LOC
ellenőrzés, secret/sensitive-data scan és cached-index ellenőrzés. Ezek a
csak erre a bizonyíték-scope-ra futtatandó kapuk; a teljes dirty worktree
globális állapota nem ebből a változásból következtethető.

## Exact commands and receipts

Az alábbi történeti preflight-receipt a koordinátor által rögzített HEAD-állapot:
`git rev-parse HEAD` → `6c2e93b16c0c85ed726a472493058c7ae0fd1876`, majd
`git status --short -- plans/full-refactor/README.md` → üres. A jelenlegi
`git diff --name-only -- plans/full-refactor/README.md` kimenete pontosan:
`plans/full-refactor/README.md`.

Jelenlegi workspace-receipt: `find packages -maxdepth 2 -name package.json -print
| sort` → 11 elem, a lista `assert`, `backtest`, `backtest-tools`, `core`,
`exchange`, `logging`, `numeric`, `paper`, `shared`, `typeguard`, `typing`;
`node -e "console.log(require('./package.json').workspaces)"` → `apps/*`,
`packages/*`; az alkalmazás-manifest inventory → 1 (`apps/bot/package.json`).
`test ! -e search-best-config/package.json`, `test ! -e bin/mm-bot`,
`test ! -e scripts/install-mm-bot.sh`, `test ! -e apps/web` mind exit `0`.
Root `package.json` script-check: `verify`, `postinstall`, `mm-bot` → `undefined`;
`apps/bot/package.json` `bin` → `null`. `git ls-files 'run-bot/config/*'` → 3
követett útvonal.

Verzió-receipt: `bun --version` → `1.3.14`; a root manifestből a TypeScript és
Turbo → `6.0.3`, illetve `2.10.10`. `rg -n 'workspace:\*' --glob package.json
| wc -l` → 26 (ezért nem állítunk 25-öt). A 500-soros inventory parancs
`find apps packages scripts -type f \( -name '*.ts' -o -name '*.tsx' -o -name
'*.js' -o -name '*.mjs' -o -name '*.test.ts' \) -print0 | xargs -0 wc -l |
awk '$1>500 && $2!="total"{n++} END{print n+0}'` → 41.

Toolchain gate: `bun test scripts/tooling/toolchain-contract.test.ts` → 9 pass,
0 fail, 58 `expect()`; exit `0`. Egyetlen végleges scoped receipt: `bunx
prettier --check plans/full-refactor/README.md
plans/full-refactor/evidence/full-refactor-baseline-current-state-2026-08-30.md`
→ PASS/exit `0`; `git diff --check -- plans/full-refactor/README.md
plans/full-refactor/evidence/full-refactor-baseline-current-state-2026-08-30.md
plans/full-refactor/REVIEW-EVIDENCE.md` → exit `0`; `wc -l` → README `78`,
evidence `97`; credential-like assignment `rg` scan over README plus evidence
→ no matches; `git diff --cached --quiet -- plans/full-refactor/README.md
plans/full-refactor/evidence/full-refactor-baseline-current-state-2026-08-30.md
plans/full-refactor/REVIEW-EVIDENCE.md` → exit `0` (index empty).

## Folyamat, kockázat és visszaállítás

Az első független Luna process review bizonyíték-kiegészítést kért; ez a fájl
azt a hiányt pótolja. A Terra technikai review eredménye `TECH PASS`, nulla
nyitott technikai findinggal. A folyamat-review R1-et a koordinátor külön
függetlenül ismételteti; addig ez a dokumentum nem jelent closure- vagy
commit-jogosultságot.

Nem változott runtime, trading/risk, live authority, config-reload, biztonsági
mechanizmus vagy termék-szemantika. Nincs stage és nincs commit. Visszaállítás:
az eredeti `plans/full-refactor/README.md` jelölt, az új bizonyítékfájl és a
hozzá tartozó egyetlen `REVIEW-EVIDENCE.md` link visszaállítható; más dirty
változás érintetlen marad.

## Retrospective Agy eligibility assessment

This evidence-writer dispatch is corrected retrospectively: the current rules did not make an Agy write route eligible because the authoritative worktree was shared and dirty, direct Agy writes were forbidden, and no dedicated isolated workspace or effective allow/deny boundary was used or authorized for this slice. The Luna mechanical documentation-only route therefore remained the current disposition. No evaluated Agy route or observable attestation is claimed.

## Commit provenance correction

The historical pre-commit/preflight statements above apply to the review-before-commit snapshot only. The implementation was subsequently committed as `78306f2`. `git show --stat --oneline 78306f2` identifies the implementation slice, and after that commit the exact implementation paths plans/full-refactor/README.md were clean.
