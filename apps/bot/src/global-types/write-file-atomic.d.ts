// apps/bot/src/global-types/write-file-atomic.d.ts — a `write-file-atomic`
// library lokális típus-deklarációja.
//
// A `write-file-atomic` 8.x CJS modulként van publish-olva, és NEM
// szállít TypeScript típus-deklarációt (a `package.json` `types`
// mezője hiányzik, a DefinitelyTyped-en pedig nincs `@types/write-file-atomic`).
//
// A modul egy `writeFile` függvényt exportál default-ként, amihez
// `.sync` property-ként csatlakozik a szinkron write. Az async verzió
// egy `(filename, data, options?) => Promise<void>` függvény, a sync
// verő egy `(filename, data, options?) => void` függvény.
//
// A fájl a `apps/bot/src/global-types/` mappában van, és az
// `apps/bot/tsconfig.json` `include` opcióján keresztül
// (`src/**/*` mintát használ) automatikusan betöltődik.
//
// Phase 44: a TUI csomag (`packages/tui/src/global-types/write-file-atomic.d.ts`)
// törölve lett, de a `ConfigStore` (`apps/bot/src/config/store.ts`) továbbra
// használja a `write-file-atomic`-ot. A típus-deklaráció átköltözött ide.

declare module "write-file-atomic" {
  interface WriteFileOptions {
    encoding?: BufferEncoding | null;
    flag?: string;
    mode?: number;
    uid?: number;
    gid?: number;
    chown?: { uid: number; gid: number } | undefined;
  }
  interface WriteFileAtomic {
    (filename: string, data: string | Buffer, options?: WriteFileOptions | BufferEncoding): Promise<void>;
    sync: (filename: string, data: string | Buffer, options?: WriteFileOptions | BufferEncoding) => void;
  }
  const writeFileAtomic: WriteFileAtomic;
  export default writeFileAtomic;
}
