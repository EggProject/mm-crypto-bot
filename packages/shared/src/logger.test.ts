/**
 * packages/shared/src/logger.test.ts
 *
 * A `createLogger` 100% line + branch tesztjei.
 * A logger a `console.log`-ot használja JSON-formátumban; a tesztek
 * a `console.log`-ot spy-on-ra cserélik, hogy ne legyen noisy output.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { createLogger } from "./logger.js";
import type { Logger } from "./logger.js";

describe("createLogger — default level='info'", () => {
  let logSpy: ReturnType<typeof spyOn>;
  beforeEach(() => {
    // Az empty arrow a `console.log` elnyomásához kell — a teszt assert-eli
    // a meghívást, a log outputját nem akarjuk a teszt-kimenetben látni.
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    logSpy = spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it("az info() logol", () => {
    const log = createLogger();
    log.info("hello");
    expect(logSpy).toHaveBeenCalledTimes(1);
    const call = logSpy.mock.calls[0]!;
    const entry = JSON.parse(call[0] as string) as Record<string, unknown>;
    expect(entry["msg"]).toBe("hello");
    expect(entry["level"]).toBe("info");
    expect(typeof entry["ts"]).toBe("string");
  });

  it("a debug() NEM logol info threshold-nál", () => {
    const log = createLogger("info");
    log.debug("debug-msg");
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("a warn() logol info threshold-nál", () => {
    const log = createLogger("info");
    log.warn("warn-msg");
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it("az error() logol info threshold-nál", () => {
    const log = createLogger("info");
    log.error("error-msg");
    expect(logSpy).toHaveBeenCalledTimes(1);
  });
});

describe("createLogger — level='debug' (mindent logol)", () => {
  let logSpy: ReturnType<typeof spyOn>;
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    logSpy = spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it("a debug() logol", () => {
    const log = createLogger("debug");
    log.debug("d");
    expect(logSpy).toHaveBeenCalled();
  });

  it("az info() logol", () => {
    const log = createLogger("debug");
    log.info("i");
    expect(logSpy).toHaveBeenCalled();
  });

  it("a meta objektum belekerül az entry-be", () => {
    const log = createLogger("debug");
    log.info("i", { foo: "bar", n: 42 });
    const entry = JSON.parse(logSpy.mock.calls[0]![0] as string) as Record<string, unknown>;
    expect(entry["foo"]).toBe("bar");
    expect(entry["n"]).toBe(42);
  });

  it("a meta nélküli hívás is működik (undefined meta)", () => {
    const log = createLogger("debug");
    log.info("i");
    const entry = JSON.parse(logSpy.mock.calls[0]![0] as string) as Record<string, unknown>;
    expect(entry["msg"]).toBe("i");
  });
});

describe("createLogger — level='warn' (csak warn+)", () => {
  let logSpy: ReturnType<typeof spyOn>;
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    logSpy = spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it("a debug() NEM logol", () => {
    const log = createLogger("warn");
    log.debug("d");
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("az info() NEM logol", () => {
    const log = createLogger("warn");
    log.info("i");
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("a warn() logol", () => {
    const log = createLogger("warn");
    log.warn("w");
    expect(logSpy).toHaveBeenCalled();
  });

  it("az error() logol", () => {
    const log = createLogger("warn");
    log.error("e");
    expect(logSpy).toHaveBeenCalled();
  });
});

describe("createLogger — level='error' (csak error)", () => {
  let logSpy: ReturnType<typeof spyOn>;
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    logSpy = spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it("a debug/info/warn NEM logol", () => {
    const log = createLogger("error");
    log.debug("d");
    log.info("i");
    log.warn("w");
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("az error() logol", () => {
    const log = createLogger("error");
    log.error("e");
    expect(logSpy).toHaveBeenCalled();
  });
});

describe("createLogger — visszatérési érték", () => {
  it("a visszatérési érték egy Logger interfész", () => {
    const log: Logger = createLogger();
    expect(typeof log.debug).toBe("function");
    expect(typeof log.info).toBe("function");
    expect(typeof log.warn).toBe("function");
    expect(typeof log.error).toBe("function");
  });
});
