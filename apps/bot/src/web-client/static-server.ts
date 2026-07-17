/**
 * apps/bot/src/web-client/static-server.ts
 *
 * ============================================================================
 * PHASE 46 — WEB CLIENT STATIC FILE SERVER
 * ============================================================================
 *
 * A `staticHandler` a web client böngésző-felé néző statikus fájl
 * kiszolgálója. A `apps/web/dist/` mappát olvassa (a Vite bundle output);
 * ha a mappa nem létezik, a handler egy placeholder HTML-t ad vissza.
 *
 * ============================================================================
 * MIÉRT PLACEHOLDER HTML?
 * ============================================================================
 *
 *   A Phase 46-ban az `apps/web/` workspace package még NEM létezik
 *   (Phase 47-ben jön létre). A felhasználó a `mm-bot web` parancsot
 *   ki tudja adni a Phase 46-ban, és a böngészőben megnyitva a
 *   `http://127.0.0.1:7913` URL-t — a placeholder HTML jelzi, hogy a
 *   web app még nincs build-elve, és a `bun run web:build` parancsot
 *   kell futtatni.
 *
 *   A placeholder:
 *     - Látható (a felhasználó tudja, hogy a web client él, csak a
 *       bundle hiányzik).
 *     - Világos hibaüzenettel szolgál (a `bun run web:build` parancsot
 *       javasolja).
 *     - Nem blokkolja a `mm-bot web` parancs használatát (a Phase 47
 *       előtt is működik a state-feed WS + REST, csak a UI nincs).
 *
 * ============================================================================
 * FÁJL KISZOLGÁLÁS
 * ============================================================================
 *
 *   A `Bun.file(path)` a natív fájl-API; a `Bun.serve` a `new Response(file)`
 *   formátumban közvetlenül a fájlt adja vissza (stream-elve, nem
 *   memóriába töltve). A `content-type` a fájl kiterjesztése alapján
 *   kerül beállításra.
 *
 *   A path resolution a `Bun.file` relatív path-ját használja; a
 *   `webDistDir` (a `startWebClient` opts-ból jön) abszolút path kell
 *   legyen (a `resolveWebDistDir` helper-rel).
 *
 * ============================================================================
 * BIZTONSÁG — PATH TRAVERSAL VÉDELEM
 * ============================================================================
 *
 *   A `staticHandler` CSAK a `webDistDir` alatti fájlokat szolgálja
 *   ki. A path normalization (a `..` szegmensek eltávolítása) megakadályozza,
 *   hogy a kliens a `../<other-dir>/<file>` URL-en át a `webDistDir`
 *   MÁSIK fájlját olvassa.
 *
 * ============================================================================
 * CONTENT-TYPE
 * ============================================================================
 *
 *   A handler a fájl kiterjesztése alapján állítja be a `content-type`-ot.
 *   Az `index.html` (a `/` útvonal) esetén `text/html; charset=utf-8`;
 *   a `.js` / `.css` / `.svg` / `.png` / stb. esetén a megfelelő MIME
 *   típus. A `Bun.file` automatikusan felismeri a legtöbb típust, de
 *   a `.txt` / `.json` / ismeretlen kiterjesztéseknél a fallback
 *   `application/octet-stream`.
 */

import { existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

// ============================================================================
// Constants
// ============================================================================

/** A placeholder HTML — amikor a `apps/web/dist/` mappa nem létezik. */
const PLACEHOLDER_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>mm-bot web — bundle not built yet</title>
  <style>
    :root { color-scheme: light dark; }
    body {
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      max-width: 640px;
      margin: 4rem auto;
      padding: 0 1.5rem;
      line-height: 1.55;
      color: #1a1a1a;
      background: #fafafa;
    }
    @media (prefers-color-scheme: dark) {
      body { color: #e5e5e5; background: #0d0d0d; }
      code, pre { background: #1f1f1f; }
    }
    h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
    p.subtitle { margin-top: 0; opacity: 0.7; }
    pre {
      background: #ececec;
      padding: 0.75rem 1rem;
      border-radius: 6px;
      overflow-x: auto;
      font-size: 0.9rem;
    }
    code { font-family: ui-monospace, "SF Mono", Menlo, monospace; }
    .footer { margin-top: 2rem; opacity: 0.6; font-size: 0.85rem; }
  </style>
</head>
<body>
  <h1>mm-bot web</h1>
  <p class="subtitle">The web client is running, but the web app bundle has not been built yet.</p>

  <p>The HTTP, WebSocket, and REST proxy endpoints are fully operational. The
     <code>apps/web/</code> workspace package &mdash; which serves the React 19 + Vite 6
     UI &mdash; is delivered in Phase 47.</p>

  <p>To build the bundle (once <code>apps/web/</code> exists):</p>
  <pre><code>bun run web:build</code></pre>

  <p>Until then, you can still inspect the state-feed directly:</p>
  <pre><code>curl http://127.0.0.1:7913/api/health</code></pre>

  <div class="footer">
    Phase 46 &middot; web client skeleton (no UI yet)
  </div>
</body>
</html>
`;

/** A `content-type` tábla a kiterjesztés alapján. */
const CONTENT_TYPE_BY_EXT: ReadonlyMap<string, string> = new Map<string, string>([
  [".html", "text/html; charset=utf-8"],
  [".htm", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
  [".txt", "text/plain; charset=utf-8"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".map", "application/json; charset=utf-8"],
]);

// ============================================================================
// Types
// ============================================================================

/** A `createStaticHandler` opciói. */
export interface StaticHandlerOptions {
  /** A `apps/web/dist/` mappa abszolút path-ja. */
  readonly webDistDir: string;
}

/** A `createStaticHandler` visszatérési típusa — a `fetch` handler. */
export type StaticHandler = (req: Request) => Response;

// ============================================================================
// Factory
// ============================================================================

/**
 * `createStaticHandler` — a `Bun.serve` `fetch` callback-jéhez
 * illeszkedő static file handler factory.
 *
 * A handler:
 *   - A `GET /` útvonalra az `index.html`-t adja vissza (ha a `webDistDir`
 *     tartalmazza), vagy a placeholder HTML-t.
 *   - A `GET /static/<path>` útvonalra a `webDistDir/<path>` fájlt
 *     adja vissza (path-traversal védelemmel).
 *   - Más útvonalra (a `Bun.serve` HTTP részében más handler-ekhez
 *     tartozókat) 404-et ad.
 *
 * A handler a `webDistDir` létezését minden request-nél ellenőrzi
 * (a `Bun.file` a nem létező fájlokra 404-et ad). A placeholder
 * HTML-t a `webDistDir` HIÁNYA esetén adjuk vissza.
 */
export function createStaticHandler(options: StaticHandlerOptions): StaticHandler {
  const webDistDir = resolve(options.webDistDir);
  return (req: Request) => handleStaticRequest(req, webDistDir);
}

// ============================================================================
// Request handler
// ============================================================================

/**
 * `handleStaticRequest` — a static file kiszolgáló. A path alapján
 * eldönti, hogy az `index.html` (placeholder vagy built), vagy a
 * `static/<path>` fájlt kell-e visszaadni.
 */
function handleStaticRequest(req: Request, webDistDir: string): Response {
  const url = new URL(req.url);
  const path = url.pathname;

  // A `/` útvonal: az index.html (vagy a placeholder).
  if (path === "/" || path === "/index.html") {
    return serveIndexHtml(webDistDir);
  }

  // A `/static/*` útvonal: a `webDistDir/<path>` fájl.
  if (path.startsWith("/static/")) {
    return serveStaticFile(webDistDir, path.slice("/static/".length));
  }

  // Phase 52E: a Vite build az asset-eket az
  // `apps/web/dist/assets/` mappába rakja, és az index.html
  // `<script src="/assets/...">`-re hivatkozik. A statikus
  // handlernek a `/assets/*` útvonalat is kezelnie kell —
  // különben a valódi böngésző 404-et kap a JS/CSS assetekre,
  // és a dashboard soha nem bootol be. A `serveStaticFile`
  // hívásban az `assets/` prefixet megtartjuk (a Vite build az
  // `assets/` mappába rakja a fájlokat, és a
  // `webDistDir/assets/<file>` útvonalon kell keresnünk).
  if (path.startsWith("/assets/")) {
    return serveStaticFile(webDistDir, `assets/${path.slice("/assets/".length)}`);
  }

  return textResponse("not found", 404);
}

/**
 * `serveIndexHtml` — a `/` útvonalra az `index.html`-t adja vissza
 * a `webDistDir` mappából, vagy a placeholder HTML-t, ha a bundle
 * nem létezik.
 */
function serveIndexHtml(webDistDir: string): Response {
  if (!isDirectory(webDistDir)) {
    return htmlResponse(PLACEHOLDER_HTML);
  }
  const indexPath = join(webDistDir, "index.html");
  if (!isFile(indexPath)) {
    return htmlResponse(PLACEHOLDER_HTML);
  }
  const file = Bun.file(indexPath);
  return new Response(file, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

/**
 * `serveStaticFile` — a `/static/<path>` útvonalra a `webDistDir/<path>`
 * fájlt adja vissza. A path normalization megakadályozza a path
 * traversal-t.
 */
function serveStaticFile(webDistDir: string, relativePath: string): Response {
  if (!isDirectory(webDistDir)) {
    return htmlResponse(PLACEHOLDER_HTML, 404);
  }
  // A `decodeURIComponent` a `%20` / `%2F` / stb. kezeli.
  let decoded: string;
  try {
    decoded = decodeURIComponent(relativePath);
  } catch {
    return textResponse("invalid path", 400);
  }
  // A `..` szegmensek eltávolítása — a path normalization a `..` /
  // `.` szegmenseket a `node:path` `normalize` metódusával kezeli.
  const normalized = normalize(decoded);
  if (normalized.startsWith("..") || normalized.includes("../")) {
    return textResponse("forbidden", 403);
  }
  const fullPath = resolve(webDistDir, normalized);
  if (!isFile(fullPath)) {
    return textResponse("not found", 404);
  }
  const file = Bun.file(fullPath);
  const contentType = contentTypeForPath(fullPath);
  return new Response(file, {
    headers: { "content-type": contentType },
  });
}

// ============================================================================
// Helper
// ============================================================================

/**
 * `contentTypeForPath` — a fájl kiterjesztése alapján visszaadja a
 * `content-type` értéket. Az ismeretlen kiterjesztésekre
 * `application/octet-stream` a fallback.
 */
function contentTypeForPath(path: string): string {
  const ext = extname(path).toLowerCase();
  return CONTENT_TYPE_BY_EXT.get(ext) ?? "application/octet-stream";
}

/**
 * `isDirectory` — a path directory-e. A `existsSync` ellenőrzi a
 * létezést, a `statSync` a típust. Ha bármelyik hibát dob, a path
 * nem directory (false).
 */
function isDirectory(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

/**
 * `isFile` — a path fájl-e. A `existsSync` ellenőrzi a létezést,
 * a `statSync` a típust.
 */
function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

/**
 * `htmlResponse` — egy HTML Response builder.
 */
function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

/**
 * `textResponse` — egy text Response builder.
 */
function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
