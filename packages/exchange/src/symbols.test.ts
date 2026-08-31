/**
 * packages/exchange/src/symbols.test.ts
 *
 * 100% coverage test for `symbols.ts` — the `Symbol` brand
 * conversion helpers (`asSymbol`, `symbolOf`, `isSupportedSymbol`),
 * the `SUPPORTED_SYMBOLS` allow-list, the `InvalidSymbolError`
 * class, and the `quoteCurrencyOf` / `baseCurrencyOf` extractors.
 *
 * The package-local suite exercises the public conversion and validation
 * contract directly.
 */
import { describe, expect, it } from "bun:test";

import {
  SUPPORTED_SYMBOLS,
  asSymbol,
  baseCurrencyOf,
  isSupportedSymbol,
  quoteCurrencyOf,
  symbolOf,
  InvalidSymbolError,
} from "./symbols.js";
// A types.ts-ből NEM exportálunk asSymbol-t; ezt a függvényt
// kizárólag a symbols.ts definiálja. A types.ts-ből csak típusokat
// importálunk:
// import type { Symbol } from "./types.js";

describe("symbols", () => {
  describe("SUPPORTED_SYMBOLS", () => {
    it("tartalmazza a 3 támogatott párt (BTC, ETH, SOL USDC)", () => {
      expect(SUPPORTED_SYMBOLS.map(String)).toEqual(["BTC/USDC", "ETH/USDC", "SOL/USDC"]);
    });

    it("a lista readonly (TypeScript típus szinten)", () => {
      // TypeScript `as const` biztosítja a freeze-et; futásidőben a
      // tömböt nem fagyasztja be, de a típus szinten readonly.
      // A `readonly Symbol[]` típus ellenőrzése:
      const _readonly: readonly string[] = SUPPORTED_SYMBOLS;
      expect(_readonly.length).toBe(3);
    });
  });

  describe("isSupportedSymbol", () => {
    it("true a támogatott symbolokra", () => {
      expect(isSupportedSymbol("BTC/USDC")).toBe(true);
      expect(isSupportedSymbol("ETH/USDC")).toBe(true);
      expect(isSupportedSymbol("SOL/USDC")).toBe(true);
    });

    it("false a nem támogatott symbolokra", () => {
      expect(isSupportedSymbol("DOGE/USDC")).toBe(false);
      expect(isSupportedSymbol("BTC/USDT")).toBe(false);
      expect(isSupportedSymbol("")).toBe(false);
      expect(isSupportedSymbol("btc/usdc")).toBe(false); // case-sensitive
    });

    it("a type guard-ot ad vissza (s is Symbol)", () => {
      const s = "BTC/USDC";
      if (isSupportedSymbol(s)) {
        // Ha a type guard helyes, itt `s` Symbol típusú.
        const branded = s;
        expect(String(branded)).toBe("BTC/USDC");
      } else {
        throw new Error("type guard nem működik");
      }
    });
  });

  describe("asSymbol", () => {
    it("type cast-ol (string → Symbol) futásidejű ellenőrzés nélkül", () => {
      // asSymbol CSAK type cast, futásidejű check nélkül.
      // A "DOGE/USDC" is átmegy, mert ez CSAK type cast.
      const s = asSymbol("DOGE/USDC");
      expect(String(s)).toBe("DOGE/USDC");
    });

    it("kompatibilis a típus-system-rel (a Symbol brand típussal)", () => {
      // Az asSymbol CSAK type cast, tehát ugyanazt a stringet adja vissza.
      expect(String(asSymbol("BTC/USDC"))).toBe("BTC/USDC");
      // A típusellenőrzés fordítási időben történik: a return type
      // `Symbol` (branded), tehát a hívó kód `Symbol`-ként kezelheti.
      const branded: string = asSymbol("BTC/USDC");
      expect(branded).toBe("BTC/USDC");
    });
  });

  describe("symbolOf", () => {
    it("visszaadja a Symbol-t támogatott inputra", () => {
      expect(String(symbolOf("BTC/USDC"))).toBe("BTC/USDC");
      expect(String(symbolOf("ETH/USDC"))).toBe("ETH/USDC");
      expect(String(symbolOf("SOL/USDC"))).toBe("SOL/USDC");
    });

    it("InvalidSymbolError-t dob nem támogatott inputra", () => {
      expect(() => symbolOf("DOGE/USDC")).toThrow(InvalidSymbolError);
      expect(() => symbolOf("BTC/USDT")).toThrow(InvalidSymbolError);
      expect(() => symbolOf("")).toThrow(InvalidSymbolError);
    });

    it("az InvalidSymbolError tartalmazza a symbol-t és az üzenetet", () => {
      try {
        symbolOf("FOO/BAR");
        expect.unreachable("symbolOf-nak dobnia kellett volna");
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidSymbolError);
        if (!(err instanceof InvalidSymbolError)) {
          throw err;
        }
        expect(err.symbol).toBe("FOO/BAR");
        expect(err.message).toContain("FOO/BAR");
        expect(err.message).toContain("BTC/USDC");
        expect(err.name).toBe("InvalidSymbolError");
      }
    });
  });

  describe("InvalidSymbolError", () => {
    it("konstruktor eltárolja a symbol-t", () => {
      const e = new InvalidSymbolError("XYZ/USDC");
      expect(e.symbol).toBe("XYZ/USDC");
      expect(e.message).toContain("XYZ/USDC");
      expect(e.name).toBe("InvalidSymbolError");
      expect(e).toBeInstanceOf(Error);
    });
  });

  describe("quoteCurrencyOf", () => {
    it("visszaadja a quote currency-t (USDC)", () => {
      expect(quoteCurrencyOf(asSymbol("BTC/USDC"))).toBe("USDC");
      expect(quoteCurrencyOf(asSymbol("ETH/USDC"))).toBe("USDC");
      expect(quoteCurrencyOf(asSymbol("SOL/USDC"))).toBe("USDC");
    });

    it("default 'USDC'-t ad vissza, ha nincs '/' a symbol-ban (defensive branch)", () => {
      // A strict null checks miatt van egy fallback ág, ha nincs slash.
      // Ez a defensive branch akkor fut le, ha valaki megszegi a brand-et.
      expect(quoteCurrencyOf(asSymbol("BTCUSDC"))).toBe("USDC");
    });
  });

  describe("baseCurrencyOf", () => {
    it("visszaadja a base currency-t", () => {
      expect(baseCurrencyOf(asSymbol("BTC/USDC"))).toBe("BTC");
      expect(baseCurrencyOf(asSymbol("ETH/USDC"))).toBe("ETH");
      expect(baseCurrencyOf(asSymbol("SOL/USDC"))).toBe("SOL");
    });

    it("default 'UNKNOWN'-t ad vissza, ha nincs '/' a symbol-ban (defensive branch)", () => {
      // Ugyanaz a defensive branch, mint a quoteCurrencyOf-nál.
      expect(baseCurrencyOf(asSymbol("BTCUSDC"))).toBe("UNKNOWN");
    });
  });
});
