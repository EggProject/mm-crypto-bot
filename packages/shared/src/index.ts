// packages/shared/src/index.ts — `@mm/shared` belépési pont
//
// FELADAT: A `@mm/shared` csomag a monorepo minden más csomagja számára
// biztosít közös típusokat, util-okat, konfigurációt és log-olást.
// Ennek a fájlnak a felelőssége:
//   - Aggregálja az al-modulok (types, utils, config, logger) belépési pontjait
//   - Re-exportja a típusokat és függvényeket, hogy a fogyasztók egyetlen
//     `import { ... } from "@mm/shared"` sorral hozzáférjenek mindenhez
//   - A scaffold fázisban csak "hello-world" típusú placeholder — a későbbi
//     fázisokban a tényleges típusok és utilok fognak ide költözni.

export * from "./types/index.js";
export * from "./utils/index.js";
export * from "./config/index.js";
export * from "./logger/index.js";
