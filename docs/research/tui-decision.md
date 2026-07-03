# TUI döntés — ratatui (Rust) vs ink (React/Node/TS)

> Dátum: 2026-07-03 · Szerző: CCXT Pro Specialist (agent-4bd5822807ad)
>
> **Döntés**: Az `mm-crypto-bot` TUI frontendjét az **Ink** (React/Node/TS)
> könyvtárral építjük, **`ink@7.1.0`** verzióval. A Ratatui (Rust) csak
> referenciaként szolgál, de a projektbe nem integráljuk.
>
> Források: a [`sources-stack.md`](./sources-stack.md) §4 és §3 blokkjában
> felsorolt URL-ekre hivatkozunk számokkal (pl. `[4.3]`).

---

## 1. A döntéshozatal kerete

A TUI választásnál három szempontot értékeltünk:

1. **Stack-koherencia** — hogyan illeszkedik a Bun + TypeScript
   ultra-strict monorepo architektúrához.
2. **Karbantarthatóság magyar fejlesztőknek** — milyen nyelvi/
   ökoszisztémabeli ismereteket igényel.
3. **Funkciók teljessége** — a kívánt TUI-szolgáltatások
   (realtime frissítés, indítás/leállítás, statisztikai menü,
   history) megvalósíthatósága.

A Ratatui és az Ink nem „egy az egyben" összehasonlíthatóak — más
nyelven, más paradigmával működnek. Az alábbi elemzés ezt a
különbséget is figyelembe veszi.

---

## 2. A két keretrendszer

### 2.1 Ink — React for CLI

- **Nyelv**: TypeScript / JavaScript, Node.js runtime.
- **Verzió**: `7.1.0` (npm `dist-tags.latest`, 2026-07-03) `[4.9]`.
- **Stílus**: React komponensek, Flexbox layout (Yoga engine),
  deklaratív.
- **Stars**: 35.6k (LibHunt) `[4.3]`.
- **Használják**: Claude Code, Gemini CLI, Qwen Code, GitHub Copilot
  CLI, Codex, lazygit, atuin `[4.3]` `[4.8]` `[8.2]`.
- **Layout**: Flexbox-alapú (Yoga), ami megegyezik a React Native
  layout engine-ével `[4.3]`.

### 2.2 Ratatui — Rust TUI

- **Nyelv**: Rust.
- **Verzió**: `v0.30.2` (Latest, 2026-06-19) `[4.2]`.
- **Stílus**: Immediate-mode, constraint-based layout, Rust struct-ok.
- **Stars**: 19.1k (LibHunt) `[4.3]`.
- **Használják**: desed, gobang, joshuto, repgrep, tenere (LLM TUI),
  game-of-life-rs, oxycards, valamint a Claude Code Rust port
  kísérletek `[4.1]` `[4.2]`.
- **Layout**: Constraint-alapú, „immediate-mode GUI" — minden frame
  újra lerajzolódik.

### 2.3 Hibrid alternatíva: `ratatat`

A `ratatat` egy React-kompatibilis API-t + Rust diff/render engine-t
kombinál — az Ink 20-75×-ös gyorsaságát ígéri Rust backend-del `[4.5]`.
Azonban ez egy friss, kísérleti projekt (egy fejlesztő, ~1 hetes munka),
nem alkalmas production stack-be `[4.5]`.

---

## 3. Szempontonkénti értékelés

### 3.1 Stack-koherencia

A projekt teljes stack-e:

| Réteg | Technológia |
|---|---|
| Runtime | **Bun 1.3.14** |
| Csomagkezelő | Bun + Turborepo 2.10.2 |
| Nyelv | **TypeScript 6.0.3** ultra-strict |
| Exchange integráció | CCXT Pro 4.5.64 (TS bindings) |
| Backend (order, strategy) | TS |
| **Frontend (TUI)** | **Döntés kérdése** |

#### Ink — természetes illeszkedés

Az Ink natívan fut Bun alatt (Node-kompatibilis), és a `tsconfig.base.json`
ugyanaz, amit a többi package használ. Nincs szükség:

- Külön `Cargo.toml`-ra
- Külön Rust toolchain-re a CI-ban
- Platform-specifikus bináris build-ekre (macOS arm64, Linux x64,
  Windows stb.)
- FFI / NAPI / sidecar process kommunikációra a Rust bináris és a
  TS app között
- Külön `node-gyp` / `bun build --compile` lépésre

A `bun.lock` egységes marad, a Turborepo task-ek egyszerűek:

```jsonc
{
  "tasks": {
    "build": { "outputs": ["dist/**"] },
    "dev":   { "cache": false, "persistent": true },
    "lint":  {},
    "test":  { "dependsOn": ["build"] }
  }
}
```

A TUI package a `bun run src/index.tsx` módon indítható,
React-szerű fejlesztői élménnyel.

#### Ratatui — plusz komplexitás

A Ratatui integrálásához a TS-Bun projekthez:

1. **Rust workspace** a monorepo-ban (külön `Cargo.toml` a `apps/tui/`
   alatt).
2. **Build pipeline**: `cargo build --release` → platform-specifikus
   bináris (`.app`, ELF, PE).
3. **Indítás**: A Bun/TS app `child_process.spawn()`-nal indítja a Rust
   binárist, és JSON-over-stdio-n kommunikál vele.
4. **CI**: macOS/Linux/Windows külön build target-ek, signature,
   notarizáció macOS-en.
5. **Cross-compile**: A macOS → Linux cross-compile Rust-tal nem
   triviális; a legegyszerűbb, ha minden platformon saját CI runner
   építi a binárist.
6. **Karbantartás**: Két nyelv, két csomagkezelő (Cargo + Bun),
   két teszt framework (Rust + bun test).

Ez a komplexitás **csak akkor éri meg**, ha a Ratatui natív
teljesítménye valódi előnyt jelent — ami a mi esetünkben nem áll fenn
(lásd §3.4).

#### Értékelés

| Szempont | Ink | Ratatui |
|---|---|---|
| Toolchain-ek száma | 1 (Bun) | 2 (Bun + Rust) |
| Build pipeline | 1 lépés | 2 lépés (Bun + Rust) |
| Platform-függőség | Node ABI kompatibilis | Natív bináris per platform |
| `bun.lock` egységesség | ✅ | ❌ külön `Cargo.lock` |
| Hibakeresés | VS Code TS | VS Code TS + VS Code Rust |

**Pontszám**: Ink 5/5, Ratatui 2/5.

### 3.2 Karbantarthatóság magyar fejlesztőknek

A projekt magyar nyelvű fejlesztőknek készül. A kulcskérdés: milyen
plusz ismereteket igényel az adott keretrendszer?

#### Ink — React-tudás újrahasznosítása

- A magyar TS/React fejlesztők azonnal produktívak, mivel az Ink
  API-ja a React-re épül: `<Box>`, `<Text>`, `useState`, `useEffect`,
  `useInput`, `<Static>` stb.
- A Hot Module Replacement (HMR) `bun --hot` módon működik, a
  fejlesztői iteráció azonnali.
- A komponens-modell ösztönzi a tiszta separation of concerns-t
  (Dashboard, PositionsPanel, OrdersLog, stb. mint külön komponens).

#### Ratatui — Rust tanulási görbe

- A Rust nyelv tanulási görbéje meredekebb, mint a TypeScripté —
  különösen az ownership/borrow rendszer és az async Rust.
- A magyar Rust-fejlesztői pool kisebb, mint a TypeScript-pool.
- Immediate-mode GUI-ban való gondolkodás más mentális modell,
  mint a deklaratív React.

#### Értékelés

| Szempont | Ink | Ratatui |
|---|---|---|
| Ismeretlen tanulási görbe | Minimális (React) | Jelentős (Rust + Ratatui) |
| Magyar TS fejlesztők elérhetősége | Magas | Alacsony |
| HMR / gyors iteráció | ✅ | ⚠️ lassabb (Rust rebuild) |

**Pontszám**: Ink 5/5, Ratatui 2/5.

### 3.3 Funkciók teljessége

A spec-ben megfogalmazott TUI-funkciók:

1. **Realtime frissítés** — árak, pozíciók, PnL 1-10 Hz frissítéssel.
2. **Indítás / leállítás** — billentyűkombináció a bot indításához
   és szabályos leállításához (graceful shutdown).
3. **Statisztikai menü** — napi/heti PnL, win rate, sharpe ratio,
   drawdown.
4. **History** — lezárt trade-ek listája, export CSV-be.

#### Mindkét keretrendszer támogatja

A fenti funkciók **mindkét könyvtárral megvalósíthatók**:

| Funkció | Ink | Ratatui |
|---|---|---|
| Realtime update | `useEffect` + WS subscription + re-render | `tokio::spawn` + WS subscription + draw loop |
| Indítás / leállítás | `useInput('q')` + `process.kill()` | `event::read()` + `crossterm::event::KeyCode` |
| Statisztikai menü | `useState` aggregált számok, `<Box>` layout | `app.draw()` + `Layout::split()` |
| History (scrollable) | `<ScrollView>` vagy `<Box flexDirection>` + `slice` | `List` widget + scroll state |

A Ratatui natívan ad `Table`, `Chart`, `Sparkline`, `Gauge`,
`Tabs`, `List`, `Paragraph` widget-eket `[4.1]`. Az Ink-ből ezeket
magunknak kell összerakni React-komponensekből — de a miénkhez
hasonló scope-hoz (néhány ticker, PnL, history lista) **ehhez nem kell
külső widget-könyvtár**.

#### Értékelés

| Szempont | Ink | Ratatui |
|---|---|---|
| Realtime update | ✅ natívan | ✅ natívan |
| Billentyűzet input | ✅ `useInput` | ✅ `event::read` |
| Layout | ✅ Flexbox (Yoga) | ✅ Constraint |
| Scrollable history | ✅ | ✅ natívan (`List` widget) |
| Szükséges saját widget-kód | Minimális | Minimális |

**Pontszám**: Ink 4/5, Ratatui 5/5 (natív widget-készlete miatt).

### 3.4 Teljesítmény

- A Ratatui Rust-oldali renderelése gyorsabb lehet extrém update rate-nél.
  Egy független kísérleti projekt (`ratatat`) azt mutatta, hogy az Ink
  Rust diff-engine-nel 20-75× gyorsabb lehet `[4.5]`.
- A `Claude Code` esetében is megfigyelhető, hogy az Ink-alapú render
  „stuttering" jelet mutat gépelés közben `[4.5]`. Ez a Yoga +
  string-puffer pipeline-ból fakad `[4.5]`.
- A mi felhasználási esetünk: **1-3 ticker szimbólum, ~1-10 update/sec,
  history max 1000 sor**.
- Ezen a terhelésen az Ink teljesítménye bőven elegendő — a mérhető
  lassulás csak 60+ FPS renderelésnél jön elő.

#### Értékelés

| Szempont | Ink | Ratatui |
|---|---|---|
| Alkalmas 1-10 Hz update-re | ✅ | ✅ |
| Extrém 60+ FPS render | ⚠️ lehet lassabb | ✅ |
| Szükséges a mi scope-unkhoz | Igen | Túlzás |

**Pontszám**: Ink 5/5, Ratatui 5/5 (de a Ratatui előnye itt nem
érvényesül).

---

## 4. Végső pontszám és döntés

| Szempont | Ink | Ratatui |
|---|---|---|
| Stack-koherencia | **5/5** | 2/5 |
| Karbantarthatóság (magyar fejlesztők) | **5/5** | 2/5 |
| Funkciók teljessége | 4/5 | **5/5** |
| Teljesítmény (scope-hoz illeszkedés) | **5/5** | 5/5 (előny nem érvényesül) |
| **Összesen** | **19/20** | **14/20** |

### Döntés

Az `mm-crypto-bot` TUI frontendjét az **Ink 7.1.0**-val építjük. Az
indoklás:

1. **Stack-koherencia**: A Bun + TS monorepo-hoz az Ink „dobozból
   kivéve" működik — nincs plusz toolchain, nincs platform-specifikus
   build-örület.
2. **Karbantarthatóság**: A meglévő React/TypeScript-tudás
   újrahasznosítható, a HMR azonnali.
3. **Funkciók**: A kívánt scope-hoz (3 ticker, PnL, history) az Ink
   saját widget-készlettel megoldható, és a teljesítmény is bőven
   elegendő.
4. **Bővíthetőség**: Ha a jövőben valóban szükség lesz 60 FPS
   render-re (pl. komplex chartok, nagyméretű history), a Ratatui
   integrálása egy külön `apps/tui-rs/` Rust package-ként továbbra
   is lehetséges — nem zárjuk ki, csak most nem éri meg a többlet
   komplexitás.

### Referenciaként megjegyzendő

- Ha a későbbiekben valaki mégis a Ratatui felé mozdulna el, a
  `ratatat` projekt egy érdekes hibrid irányt mutat: React API +
  Rust diff engine `[4.5]`.
- A Claude Code Rust port (in progress) szintén Ratatui-t használ —
  ha egyszer a mi botunk is átköltözik Rust-ba, a Ratatui-val való
  integráció érettebb lesz `[4.6]`.

---

## 5. Kódvázlat — Ink alapú TUI (`apps/tui/src/App.tsx`)

```tsx
import React, { useEffect, useState } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { Header } from "./components/Header.js";
import { PositionsPanel } from "./components/PositionsPanel.js";
import { PnLPanel } from "./components/PnLPanel.js";
import { HistoryList } from "./components/HistoryList.js";
import { useBotState } from "./hooks/useBotState.js";

export function App() {
  const { exit } = useApp();
  const [running, setRunning] = useState(false);
  const { state, error } = useBotState({ running });

  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) {
      setRunning(false);
      exit();
    } else if (input === "s") {
      setRunning((r) => !r);
    } else if (input === "h") {
      // toggle history panel
    }
  });

  if (error) {
    return (
      <Box padding={1}>
        <Text color="red">Hiba: {error.message}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Header running={running} onToggle={() => setRunning((r) => !r)} />
      <Box flexDirection="row" marginTop={1}>
        <PositionsPanel positions={state.positions} />
        <PnLPanel stats={state.stats} />
      </Box>
      <HistoryList trades={state.history} />
      <Box marginTop={1}>
        <Text dimColor>[s] start/stop · [h] history · [q] quit</Text>
      </Box>
    </Box>
  );
}
```

A `useBotState` hook a CCXT Pro WS feed-et subscribe-olja, és a
lokális state-et (positions, stats, history) frissíti. A komponensek
React-szerűen, deklaratívan jelennek meg, a Yoga engine intézi a
layout-ot.

---

## 6. Hivatkozások

- [4.1] https://ratatui.rs/ — Ratatui hivatalos oldal
- [4.2] https://github.com/ratatui/ratatui — v0.30.2 Latest, 2026-06-19
- [4.3] https://www.libhunt.com/compare-ink-vs-ratatui — Stars, paradigma
- [4.4] https://github.com/wistrand/melker/blob/main/agent_docs/tui-comparison.md — TUI táblázat
- [4.5] https://www.reddit.com/r/reactjs/comments/1ru223j/ — `ratatat` 20-75× gyorsabb
- [4.6] https://www.reddit.com/r/commandline/comments/1pevcq6/ — Rust vs Ink trade-off
- [4.7] https://blog.logrocket.com/7-tui-libraries-interactive-terminal-apps/ — TUI libraries áttekintés
- [4.8] https://news.ycombinator.com/item?id=35863837 — HN Ink vita
- [4.9] https://registry.npmjs.org/ink — ink@7.1.0
- [8.2] https://www.youtube.com/watch?v=qSZwx5_EmSA — Claude Code, Gemini CLI, Qwen Code mind Ink-et használ