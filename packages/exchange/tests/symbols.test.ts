// packages/exchange/tests/symbols.test.ts — a `symbols.ts` tesztjei
import { describe, it, expect } from "vitest";

import {
  SUPPORTED_SYMBOLS,
  isSupportedSymbol,
  asSymbol,
  symbolOf,
  baseCurrencyOf,
  quoteCurrencyOf,
  InvalidSymbolError,
} from "../src/symbols.js";
import type { Symbol } from "../src/types.js";

describe("symbols", () => {
  describe("SUPPORTED_SYMBOLS", () => {
    it("tartalmazza a három támogatott párt", () => {
      expect(SUPPORTED_SYMBOLS).toEqual(["BTC/USDC", "ETH/USDC", "SOL/USDC"] as Symbol[]);
    });
  });

  describe("isSupportedSymbol", () => {
    it("true-val tér vissza a támogatott symbolokra", () => {
      expect(isSupportedSymbol("BTC/USDC")).toBe(true);
      expect(isSupportedSymbol("ETH/USDC")).toBe(true);
      expect(isSupportedSymbol("SOL/USDC")).toBe(true);
    });

    it("false-szal tér vissza ismeretlen symbolokra", () => {
      expect(isSupportedSymbol("DOGE/USDC")).toBe(false);
      expect(isSupportedSymbol("BTC/USDT")).toBe(false);
      expect(isSupportedSymbol("")).toBe(false);
    });
  });

  describe("asSymbol", () => {
    it("type-castol stringről Symbol-ra", () => {
      const sym = asSymbol("BTC/USDC");
      expect(sym).toBe("BTC/USDC");
    });
  });

  describe("symbolOf", () => {
    it("visszaadja a Symbol-t támogatott inputra", () => {
      const sym = symbolOf("BTC/USDC");
      expect(sym).toBe("BTC/USDC");
    });

    it("InvalidSymbolError-t dob ismeretlen inputra", () => {
      expect(() => symbolOf("DOGE/USDC")).toThrow(InvalidSymbolError);
    });

    it("az InvalidSymbolError tartalmazza a hibás symbol-t", () => {
      try {
        symbolOf("UNKNOWN");
        expect.fail("expected throw");
      } catch (e) {
        expect(e).toBeInstanceOf(InvalidSymbolError);
        if (e instanceof InvalidSymbolError) {
          expect(e.symbol).toBe("UNKNOWN");
        }
      }
    });
  });

  describe("baseCurrencyOf", () => {
    it("kinyeri a base currency-t a symbol-ból", () => {
      expect(baseCurrencyOf("BTC/USDC" as Symbol)).toBe("BTC");
      expect(baseCurrencyOf("ETH/USDC" as Symbol)).toBe("ETH");
      expect(baseCurrencyOf("SOL/USDC" as Symbol)).toBe("SOL");
    });

    it("'UNKNOWN'-t ad vissza, ha nincs slash", () => {
      expect(baseCurrencyOf("NOSLASH" as Symbol)).toBe("UNKNOWN");
    });
  });

  describe("quoteCurrencyOf", () => {
    it("kinyeri a quote currency-t a symbol-ból", () => {
      expect(quoteCurrencyOf("BTC/USDC" as Symbol)).toBe("USDC");
      expect(quoteCurrencyOf("ETH/USDC" as Symbol)).toBe("USDC");
    });

    it("'USDC'-t ad vissza, ha nincs slash", () => {
      expect(quoteCurrencyOf("NOSLASH" as Symbol)).toBe("USDC");
    });
  });

  describe("InvalidSymbolError", () => {
    it("Error-ből származik", () => {
      const err = new InvalidSymbolError("X");
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("InvalidSymbolError");
    });
  });
});
