/**
 * packages/tui/src/hooks/useConfigStore.test.tsx
 *
 * Phase 36 Track C1 — `useConfigStore` hook state-machine tesztek.
 *
 * A hook a TOML persistence state-machine-je:
 *   - mount → read from disk → set data + baseline
 *   - setData → in-memory frissítés (a baseline NEM változik)
 *   - save → consumer callback → on success baseline = data
 *   - save → consumer callback → on error errors[] (validation / io)
 *   - abandon → data = baseline
 *
 * A tesztek egy `TestDriver` komponenst renderelnek, ami a hook
 * state-machine kulcs-mezőit (`dirty` / `saving` / `readError` /
 * `errorKinds` / `dataRiskPerTrade`) külön-külön `<Text>` sorokba
 * írja. A sor-alapú renderelés azért kell, mert az Ink `<Text>`
 * a hosszú stringeket sortöréssel wrapeli — egy `JSON.stringify`
 * szórása esetén a frame közepén egy kósza `\n` keletkezik, ami
 * elrontja a JSON.parse-t.
 *
 * A `waitForFrame(50)` helper a React effect + re-render kivárására
 * szolgál (az `ink-testing-library` nem exportál `act`-et).
 *
 * ===========================================================================
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import { render } from "ink-testing-library";
import { Box, Text } from "ink";
import { useEffect, useRef } from "react";
import type { ReactElement } from "react";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { useConfigStore } from "./useConfigStore.js";
import type { UseConfigStoreResult } from "./useConfigStore.js";

/**
 * `TestDriver` — a hook eredményét sor-alapú frame-be írja.
 *
 * A `resultRef` a hook legfrissebb `result` objektumát tartja
 * (minden renderben frissül). A `setTimeout`-on belüli `setData` /
 * `save` / `abandon` hívások a ref-en keresztül mindig a LEGUTOLSÓ
 * state-hez nyúlnak (különben a useCallback-ok régi `data` értéket
 * látnának a closure-ben).
 */
interface TestDriverProps {
  readonly configPath: string;
  readonly save: (data: Readonly<Record<string, unknown>>) => Promise<void> | void;
  readonly setDataPayload?: Record<string, unknown>;
  readonly runSetData?: boolean;
  readonly runSave?: boolean;
  readonly runAbandon?: boolean;
}

function TestDriver(props: TestDriverProps): ReactElement {
  const result = useConfigStore({ configPath: props.configPath, save: props.save });
  const resultRef = useRef<UseConfigStoreResult>(result);
  resultRef.current = result;

  useEffect(() => {
    // A hook belső useEffect-je a mount-kor indul (a TOML-t olvassa).
    // A hook `setBaseline` + `setDataState` hívásai async state-ek
    // — a state csak a következő renderben frissül. A teszt
    // műveleteit (`setData` / `abandon` / `save`) láncolt
    // `setTimeout(0)`-kkal késleltetjük, hogy a hook belső
    // state-frissítése BEFEJEZŐDJÖN, és a re-render megtörténjen
    // MIELŐTT a `save()` hívódna (a `save` useCallback a `data`-t
    // a closure-ben tartja — a régi render-beli `data` értéket
    // használná, ha a save() közvetlenül a setData() után hívódna).
    //
    // A `resultRef.current` a LATEST hook-result referenciáját
    // tartalmazza — a setTimeout-on belüli hívások mindig a friss
    // `save` / `setData` / `abandon` függvényeket használják.
    const handle = setTimeout(() => {
      const r = resultRef.current;
      if (props.runSetData === true && props.setDataPayload !== undefined) {
        r.setData(props.setDataPayload);
      }
      if (props.runAbandon === true) {
        r.abandon();
      }
      if (props.runSave === true) {
        // A setData re-renderje után hívjuk a save()-t (különben a
        // useCallback régi `data` értéket látná).
        const saveHandle = setTimeout(() => {
          void resultRef.current.save();
        }, 0);
        // A saveHandle-t nem tároljuk, mert a teszt várakozik
        // a `waitForFrame(100)`-szel a save promise feloldódásáig.
        void saveHandle;
      }
    }, 0);
    return () => {
      clearTimeout(handle);
    };
  }, []);

  const dataRiskPerTrade =
    typeof (result.data as { risk?: { risk_per_trade?: number } }).risk?.risk_per_trade === "number"
      ? (result.data as { risk: { risk_per_trade: number } }).risk.risk_per_trade
      : null;
  const dataMaxLeverage =
    typeof (result.data as { risk?: { max_leverage?: number } }).risk?.max_leverage === "number"
      ? (result.data as { risk: { max_leverage: number } }).risk.max_leverage
      : null;

  return (
    <Box flexDirection="column">
      <Text>DIRTY: {String(result.dirty)}</Text>
      <Text>SAVING: {String(result.saving)}</Text>
      <Text>READERROR: {result.readError ?? "none"}</Text>
      <Text>ERRORKIND: {result.errors.map((e) => e.kind).join(",") || "none"}</Text>
      <Text>RISK_PER_TRADE: {dataRiskPerTrade === null ? "null" : String(dataRiskPerTrade)}</Text>
      <Text>MAX_LEVERAGE: {dataMaxLeverage === null ? "null" : String(dataMaxLeverage)}</Text>
    </Box>
  );
}

/**
 * `waitForFrame` — a React effect + re-render kivárása.
 */
async function waitForFrame(ms = 50): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * `makeTmpDir` — egyedi tmp könyvtár (a tesztek izoláltak).
 */
function makeTmpDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe("useConfigStore (Phase 36 Track C1)", () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = makeTmpDir("mm-bot-use-cfg-");
    configPath = join(tmpDir, "mm-bot.toml");
    writeFileSync(
      configPath,
      "[risk]\nrisk_per_trade = 0.01\nmax_leverage = 10\n",
      "utf8",
    );
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // --------------------------------------------------------------------------
  // 1) Mount: read from disk → data = { risk: { ... 0.01, 10 } }, dirty = false
  // --------------------------------------------------------------------------
  it("mount reads the TOML file into data + baseline", async () => {
    const saveSpy = (): Promise<void> => Promise.resolve();
    const instance = render(<TestDriver configPath={configPath} save={saveSpy} />);
    await waitForFrame();
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("RISK_PER_TRADE: 0.01");
    expect(frame).toContain("MAX_LEVERAGE: 10");
    expect(frame).toContain("DIRTY: false");
    expect(frame).toContain("SAVING: false");
    expect(frame).toContain("READERROR: none");
    expect(frame).toContain("ERRORKIND: none");
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 2) setData → dirty = true, data reflects the change
  // --------------------------------------------------------------------------
  it("setData makes dirty = true and updates data", async () => {
    const saveSpy = (): Promise<void> => Promise.resolve();
    const instance = render(
      <TestDriver
        configPath={configPath}
        save={saveSpy}
        runSetData
        setDataPayload={{ risk: { risk_per_trade: 0.02 } }}
      />,
    );
    await waitForFrame();
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("RISK_PER_TRADE: 0.02");
    expect(frame).toContain("DIRTY: true");
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 3) abandon → data reverts to baseline (0.01)
  // --------------------------------------------------------------------------
  it("abandon reverts data to baseline (0.01)", async () => {
    const saveSpy = (): Promise<void> => Promise.resolve();
    const instance = render(
      <TestDriver
        configPath={configPath}
        save={saveSpy}
        runSetData
        setDataPayload={{ risk: { risk_per_trade: 0.05 } }}
        runAbandon
      />,
    );
    await waitForFrame();
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("RISK_PER_TRADE: 0.01");
    expect(frame).toContain("DIRTY: false");
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 4) save success → dirty = false, callback called with the data
  // --------------------------------------------------------------------------
  it("save success resets dirty = false and calls the consumer save", async () => {
    let savedData: Record<string, unknown> | null = null;
    const saveCallback = (data: Readonly<Record<string, unknown>>): void => {
      savedData = { ...data };
    };
    const instance = render(
      <TestDriver
        configPath={configPath}
        save={saveCallback}
        runSetData
        setDataPayload={{ risk: { risk_per_trade: 0.03 } }}
        runSave
      />,
    );
    await waitForFrame(100);
    expect(savedData).not.toBeNull();
    const saved = savedData as unknown as { risk: { risk_per_trade: number } };
    expect(saved.risk.risk_per_trade).toBe(0.03);
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("DIRTY: false");
    expect(frame).toContain("SAVING: false");
    expect(frame).toContain("ERRORKIND: none");
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 5) save failure (validation) → errors[] populated with 'validation' kind
  // --------------------------------------------------------------------------
  it("save failure with a Zod-like error sets errors[] with 'validation' kind", async () => {
    class FakeConfigValidationError extends Error {
      public override readonly name = "ConfigValidationError";
      public readonly fieldErrors: Record<string, readonly string[]>;
      public constructor(
        message: string,
        fieldErrors: Record<string, readonly string[]>,
      ) {
        super(message);
        this.fieldErrors = fieldErrors;
      }
    }
    const instance = render(
      <TestDriver
        configPath={configPath}
        save={() => {
          throw new FakeConfigValidationError("validation failed", {
            "risk.max_leverage": ["expected number ≤ 10 (got 15)"],
          });
        }}
        runSetData
        setDataPayload={{ risk: { max_leverage: 15 } }}
        runSave
      />,
    );
    await waitForFrame(100);
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("ERRORKIND: validation");
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 6) save failure (io) → errors[] populated with 'io' kind
  // --------------------------------------------------------------------------
  it("save failure with a non-Zod error sets errors[] with 'io' kind", async () => {
    const instance = render(
      <TestDriver
        configPath={configPath}
        save={() => {
          throw new Error("disk full");
        }}
        runSetData
        setDataPayload={{ risk: { risk_per_trade: 0.02 } }}
        runSave
      />,
    );
    await waitForFrame(100);
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("ERRORKIND: io");
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 7) readError: missing file → data = null, readError set
  // --------------------------------------------------------------------------
  it("mount on a missing file sets readError", async () => {
    const missingPath = join(tmpDir, "does-not-exist.toml");
    const instance = render(
      <TestDriver
        configPath={missingPath}
        save={() => {
          void 0;
        }}
      />,
    );
    await waitForFrame();
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("READERROR:");
    expect(frame).toContain("does-not-exist");
    expect(frame).toContain("RISK_PER_TRADE: null");
    instance.unmount();
  });
});
