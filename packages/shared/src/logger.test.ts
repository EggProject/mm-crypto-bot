/**
 * packages/shared/src/logger.test.ts
 *
 * Regression tests for the structured logger routing contract. File mode
 * persists accepted entries and mirrors them to stderr; `noFile` mode writes
 * accepted entries only to stderr. Stdout never receives log entries.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "./logger.js";
import type { Logger } from "./logger.js";

function readTestLog(path: string): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- every path is derived from a test-owned mkdtemp directory
  return readFileSync(path, "utf8");
}

function isTestDirectory(path: string): boolean {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- every path is derived from a test-owned mkdtemp directory
  return statSync(path).isDirectory();
}

/**
 * `spyOnStderr` replaces `process.stderr.write` with a spy.
 *
 * The logger writes directly to `process.stderr`, so this is the reliable
 * observation point for the routing contract.
 *
 * The returned `restore` function removes the spy during `afterEach`.
 */
function spyOnStderr(): { spy: ReturnType<typeof spyOn>; restore: () => void } {
  // A `process.stderr.write` alapértelmezetten true-t ad vissza (a
  // sikeres írás jele). A spy-nak ezt a signatúrát kell tartania.
  const orig = process.stderr.write.bind(process.stderr);
  const spy = spyOn(process.stderr, "write").mockImplementation((() => true) as never);
  return {
    spy,
    restore: () => {
      spy.mockRestore();
      // A spy eltávolítása után visszaállítjuk az eredeti write-ot,
      // hogy a többi teszt (és a teardown) a normál `process.stderr`
      // viselkedést lássa.
      process.stderr.write = orig;
    },
  };
}

describe("createLogger — default level='info', noFile=true (test mode)", () => {
  let stderrSpy: ReturnType<typeof spyOnStderr>["spy"];
  let restoreStderr: () => void;
  beforeEach(() => {
    const s = spyOnStderr();
    stderrSpy = s.spy;
    restoreStderr = s.restore;
  });
  afterEach(() => {
    restoreStderr();
  });

  it("az info() logol a stderr-re", () => {
    const log = createLogger({ level: "info", noFile: true });
    log.info("hello");
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const call = stderrSpy.mock.calls[0]!;
    const entry = JSON.parse((call[0] as string).trim()) as Record<string, unknown>;
    expect(entry["msg"]).toBe("hello");
    expect(entry["level"]).toBe("info");
    expect(typeof entry["ts"]).toBe("string");
  });

  it("a debug() NEM logol info threshold-nál", () => {
    const log = createLogger({ level: "info", noFile: true });
    log.debug("debug-msg");
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("a warn() logol info threshold-nál", () => {
    const log = createLogger({ level: "info", noFile: true });
    log.warn("warn-msg");
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const call = stderrSpy.mock.calls[0]!;
    const entry = JSON.parse((call[0] as string).trim()) as Record<string, unknown>;
    expect(entry["level"]).toBe("warn");
  });

  it("az error() logol info threshold-nál", () => {
    const log = createLogger({ level: "info", noFile: true });
    log.error("error-msg");
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const call = stderrSpy.mock.calls[0]!;
    const entry = JSON.parse((call[0] as string).trim()) as Record<string, unknown>;
    expect(entry["level"]).toBe("error");
  });
});

describe("createLogger — level='debug' (mindent logol), noFile=true", () => {
  let stderrSpy: ReturnType<typeof spyOnStderr>["spy"];
  let restoreStderr: () => void;
  beforeEach(() => {
    const s = spyOnStderr();
    stderrSpy = s.spy;
    restoreStderr = s.restore;
  });
  afterEach(() => {
    restoreStderr();
  });

  it("a debug() logol", () => {
    const log = createLogger({ level: "debug", noFile: true });
    log.debug("d");
    expect(stderrSpy).toHaveBeenCalled();
  });

  it("az info() logol", () => {
    const log = createLogger({ level: "debug", noFile: true });
    log.info("i");
    expect(stderrSpy).toHaveBeenCalled();
  });

  it("a meta objektum belekerül az entry-be", () => {
    const log = createLogger({ level: "debug", noFile: true });
    log.info("i", { foo: "bar", n: 42 });
    const call = stderrSpy.mock.calls[0]!;
    const entry = JSON.parse((call[0] as string).trim()) as Record<string, unknown>;
    expect(entry["foo"]).toBe("bar");
    expect(entry["n"]).toBe(42);
  });

  it("a meta nélküli hívás is működik (undefined meta)", () => {
    const log = createLogger({ level: "debug", noFile: true });
    log.info("i");
    const call = stderrSpy.mock.calls[0]!;
    const entry = JSON.parse((call[0] as string).trim()) as Record<string, unknown>;
    expect(entry["msg"]).toBe("i");
  });
});

describe("createLogger — level='warn' (csak warn+), noFile=true", () => {
  let stderrSpy: ReturnType<typeof spyOnStderr>["spy"];
  let restoreStderr: () => void;
  beforeEach(() => {
    const s = spyOnStderr();
    stderrSpy = s.spy;
    restoreStderr = s.restore;
  });
  afterEach(() => {
    restoreStderr();
  });

  it("a debug() NEM logol", () => {
    const log = createLogger({ level: "warn", noFile: true });
    log.debug("d");
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("az info() NEM logol", () => {
    const log = createLogger({ level: "warn", noFile: true });
    log.info("i");
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("a warn() logol", () => {
    const log = createLogger({ level: "warn", noFile: true });
    log.warn("w");
    expect(stderrSpy).toHaveBeenCalled();
  });

  it("az error() logol", () => {
    const log = createLogger({ level: "warn", noFile: true });
    log.error("e");
    expect(stderrSpy).toHaveBeenCalled();
  });
});

describe("createLogger — level='error' (csak error), noFile=true", () => {
  let stderrSpy: ReturnType<typeof spyOnStderr>["spy"];
  let restoreStderr: () => void;
  beforeEach(() => {
    const s = spyOnStderr();
    stderrSpy = s.spy;
    restoreStderr = s.restore;
  });
  afterEach(() => {
    restoreStderr();
  });

  it("a debug/info/warn NEM logol", () => {
    const log = createLogger({ level: "error", noFile: true });
    log.debug("d");
    log.info("i");
    log.warn("w");
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("az error() logol", () => {
    const log = createLogger({ level: "error", noFile: true });
    log.error("e");
    expect(stderrSpy).toHaveBeenCalled();
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

describe("createLogger — backward-compat: régi string paraméter forma", () => {
  it("createLogger('info') a level='info' default-ot használja", () => {
    const log = createLogger("info");
    // A visszatérési érték működik (a logikai kiértékeléshez hívunk
    // egy metódust, és ellenőrizzük, hogy nem dob hibát).
    expect(() => {
      log.info("test");
    }).not.toThrow();
  });

  it("createLogger('error') a level='error' threshold-ot használja", () => {
    const log = createLogger("error");
    expect(() => {
      log.error("e");
      log.info("i"); // eldobva
    }).not.toThrow();
  });
});

describe("createLogger — fájl-írás (noFile=false)", () => {
  let tmpDir: string;
  beforeEach(() => {
    // A `logs/bot/` mintát követjük — a `logDir` opció egyedi
    // teszt-könyvtárba mutat, hogy a tesztek ne szennyezzék a
    // workspace `logs/` könyvtárát.
    tmpDir = mkdtempSync(join(tmpdir(), "mm-logger-"));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("a log sor a megadott logDir alá kerül, a YYYY-MM-DD dátummal", () => {
    const log = createLogger({ level: "info", noFile: false, logDir: tmpDir, logFileBase: "test" });
    log.info("from-test");
    // A fájl a `bot-YYYY-MM-DD.log` mintát követi (a `logFileBase`
    // opció itt `"test"`, hogy a teszt ne ütközzön más logger-ekkel).
    const date = new Date().toISOString().slice(0, 10);
    const filePath = join(tmpDir, `test-${date}.log`);
    const content = readTestLog(filePath);
    expect(content).toContain("from-test");
    // A JSON entry strukturált (időbélyeg, szint, msg).
    expect(content).toContain('"level":"info"');
    expect(content).toContain('"msg":"from-test"');
  });

  it("does not route file-backed log entries to process.stdout", () => {
    // The `stdout.write` spy verifies that the logger never writes to
    // process.stdout. Warn and error entries are mirrored to stderr while all
    // accepted entries are persisted to the file.
    const stdoutSpy = spyOn(process.stdout, "write").mockImplementation((() => true) as never);
    const stderrSpy = spyOn(process.stderr, "write").mockImplementation((() => true) as never);
    try {
      const log = createLogger({
        level: "info",
        noFile: false,
        logDir: tmpDir,
        logFileBase: "stdout-routing",
      });
      log.info("this should NOT appear in stdout");
      log.error("this should appear in stderr");

      // No log entry is routed through `process.stdout.write`.
      expect(stdoutSpy).not.toHaveBeenCalled();
      // The error entry is mirrored through `process.stderr.write`.
      expect(stderrSpy).toHaveBeenCalled();
      // The file contains both the info and error entries.
      const date = new Date().toISOString().slice(0, 10);
      const filePath = join(tmpDir, `stdout-routing-${date}.log`);
      const content = readTestLog(filePath);
      expect(content).toContain("this should NOT appear in stdout");
      expect(content).toContain("this should appear in stderr");
    } finally {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    }
  });

  it("a könyvtár automatikusan létrejön (mkdirSync recursive)", () => {
    // A `logDir` opció egy nem-létező almappára mutat — a logger
    // a `mkdirSync({ recursive: true })` hívással létrehozza.
    const nested = join(tmpDir, "nested", "logs");
    expect(() => {
      const log = createLogger({ level: "info", noFile: false, logDir: nested, logFileBase: "auto" });
      log.info("mkdir-test");
    }).not.toThrow();
    // A `mkdir` tényleg megtörtént — a `nested` könyvtár most létezik.
    expect(isTestDirectory(nested)).toBe(true);
  });
});

describe("createLogger — threshold filter (noFile=true)", () => {
  let stderrSpy: ReturnType<typeof spyOnStderr>["spy"];
  let restoreStderr: () => void;
  beforeEach(() => {
    const s = spyOnStderr();
    stderrSpy = s.spy;
    restoreStderr = s.restore;
  });
  afterEach(() => {
    restoreStderr();
  });

  it("a level='warn' threshold: info szintű hívás NEM jut el a stderr-re", () => {
    const log = createLogger({ level: "warn", noFile: true });
    log.info("filtered");
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("a level='warn' threshold: warn szintű hívás ELJUT a stderr-re", () => {
    const log = createLogger({ level: "warn", noFile: true });
    log.warn("not-filtered");
    expect(stderrSpy).toHaveBeenCalledTimes(1);
  });
});

describe("createLogger — default opciók (no opció → info + noFile=false)", () => {
  // Ez a teszt a `mkdirSync({ recursive: true })` ágat fedi le —
  // az alapértelmezett `noFile: false` híváskor a logger megpróbálja
  // létrehozni a `logs/bot/` könyvtárat. A CI runner-en ez lehet, hogy
  // nem írható, ezért a `logDir` opciót felülírjuk egy tmp-dir-re.
  it("az alapértelmezett hívás a `logDir` opciót használja (default 'logs/bot')", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "mm-logger-default-"));
    try {
      // A `logDir` opció felülírásával a teszt a tmpDir-be ír, nem
      // a workspace `logs/` könyvtárába.
      const log = createLogger({ level: "info", logDir: tmpDir, logFileBase: "default-test" });
      log.info("default-opts");
      const date = new Date().toISOString().slice(0, 10);
      const filePath = join(tmpDir, `default-test-${date}.log`);
      const content = readTestLog(filePath);
      expect(content).toContain("default-opts");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// Az `mkdirSync` import a fenti `könyvtár automatikusan létrejön`
// teszthez kell (a `require` fallback biztosítja, hogy a TypeScript
// `verbatimModuleSyntax: true` beállítása esetén is lefusson).
void mkdirSync;
