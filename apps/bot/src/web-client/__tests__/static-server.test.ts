/**
 * apps/bot/src/web-client/__tests__/static-server.test.ts
 *
 * PHASE 46 — StaticServer tests.
 *
 * Lefedi:
 *   - A `createStaticHandler` visszaad egy handlert, ami GET /-re a placeholder HTML-t adja,
 *     ha a webDistDir nem létezik.
 *   - A handler a GET /static/* útvonalra 404-et ad, ha a webDistDir nem létezik.
 *   - Ha a webDistDir létezik és tartalmaz index.html-t, a handler azt adja vissza.
 *   - A handler a GET /static/<fájl>-ra a fájlt adja vissza a megfelelő content-type-pal.
 *   - A path traversal elleni védelem (a `..` szegmensek elutasítása).
 */

import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStaticHandler } from "../static-server.js";

// ============================================================================
// Tests
// ============================================================================

describe("static-server", () => {
  describe("GET / (index.html)", () => {
    it("returns placeholder HTML when webDistDir does not exist", async () => {
      const handler = createStaticHandler({ webDistDir: "/nonexistent/path" });
      const res = await handler(new Request("http://localhost/"));
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("mm-bot web");
      expect(text).toContain("bun run web:build");
      expect(res.headers.get("content-type")).toContain("text/html");
    });

    it("returns placeholder HTML when webDistDir exists but has no index.html", async () => {
      const tmp = mkdtempSync(join(tmpdir(), "static-test-"));
      try {
        const handler = createStaticHandler({ webDistDir: tmp });
        const res = await handler(new Request("http://localhost/"));
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toContain("mm-bot web");
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("returns the built index.html when it exists", async () => {
      const tmp = mkdtempSync(join(tmpdir(), "static-test-"));
      try {
        writeFileSync(join(tmp, "index.html"), "<html>BUILT</html>");
        const handler = createStaticHandler({ webDistDir: tmp });
        const res = await handler(new Request("http://localhost/"));
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toBe("<html>BUILT</html>");
        expect(res.headers.get("content-type")).toContain("text/html");
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("returns the built index.html when path is /index.html", async () => {
      const tmp = mkdtempSync(join(tmpdir(), "static-test-"));
      try {
        writeFileSync(join(tmp, "index.html"), "<html>EXPLICIT</html>");
        const handler = createStaticHandler({ webDistDir: tmp });
        const res = await handler(new Request("http://localhost/index.html"));
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toBe("<html>EXPLICIT</html>");
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  });

  describe("GET /static/*", () => {
    it("returns 404 when webDistDir does not exist", async () => {
      const handler = createStaticHandler({ webDistDir: "/nonexistent/path" });
      const res = await handler(new Request("http://localhost/static/app.js"));
      expect(res.status).toBe(404);
    });

    it("serves a JS file with the correct content-type", async () => {
      const tmp = mkdtempSync(join(tmpdir(), "static-test-"));
      try {
        writeFileSync(join(tmp, "app.js"), "console.log('hi');");
        const handler = createStaticHandler({ webDistDir: tmp });
        const res = await handler(new Request("http://localhost/static/app.js"));
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toBe("console.log('hi');");
        expect(res.headers.get("content-type")).toContain("text/javascript");
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("serves a CSS file with the correct content-type", async () => {
      const tmp = mkdtempSync(join(tmpdir(), "static-test-"));
      try {
        writeFileSync(join(tmp, "style.css"), "body { color: red; }");
        const handler = createStaticHandler({ webDistDir: tmp });
        const res = await handler(new Request("http://localhost/static/style.css"));
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toContain("text/css");
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("serves a SVG file with the correct content-type", async () => {
      const tmp = mkdtempSync(join(tmpdir(), "static-test-"));
      try {
        writeFileSync(join(tmp, "icon.svg"), "<svg></svg>");
        const handler = createStaticHandler({ webDistDir: tmp });
        const res = await handler(new Request("http://localhost/static/icon.svg"));
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toContain("image/svg+xml");
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("serves a JSON file with the correct content-type", async () => {
      const tmp = mkdtempSync(join(tmpdir(), "static-test-"));
      try {
        writeFileSync(join(tmp, "data.json"), '{"a":1}');
        const handler = createStaticHandler({ webDistDir: tmp });
        const res = await handler(new Request("http://localhost/static/data.json"));
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toContain("application/json");
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("returns 404 for a missing static file", async () => {
      const tmp = mkdtempSync(join(tmpdir(), "static-test-"));
      try {
        const handler = createStaticHandler({ webDistDir: tmp });
        const res = await handler(new Request("http://localhost/static/missing.js"));
        expect(res.status).toBe(404);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("serves files in nested subdirectories", async () => {
      const tmp = mkdtempSync(join(tmpdir(), "static-test-"));
      try {
        // Nested directory.
        const { mkdirSync } = await import("node:fs");
        mkdirSync(join(tmp, "assets"), { recursive: true });
        writeFileSync(join(tmp, "assets", "logo.png"), "fake-png-bytes");
        const handler = createStaticHandler({ webDistDir: tmp });
        const res = await handler(new Request("http://localhost/static/assets/logo.png"));
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toContain("image/png");
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("rejects path traversal attempts", async () => {
      const tmp = mkdtempSync(join(tmpdir(), "static-test-"));
      try {
        writeFileSync(join(tmp, "safe.js"), "ok");
        const handler = createStaticHandler({ webDistDir: tmp });
        // A `decodeURIComponent` + `normalize` a `..` szegmenst a
        // path elejére helyezi — a handler ezt elutasítja (403 forbidden
        // a traversal kísérletre).
        const res = await handler(
          new Request("http://localhost/static/.." + encodeURIComponent("/../etc/passwd")),
        );
        expect(res.status).toBe(403);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("uses application/octet-stream for unknown extensions", async () => {
      const tmp = mkdtempSync(join(tmpdir(), "static-test-"));
      try {
        writeFileSync(join(tmp, "blob.unknownext"), "binary");
        const handler = createStaticHandler({ webDistDir: tmp });
        const res = await handler(new Request("http://localhost/static/blob.unknownext"));
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toContain("application/octet-stream");
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("returns 400 when decodeURIComponent fails", async () => {
      const tmp = mkdtempSync(join(tmpdir(), "static-test-"));
      try {
        const handler = createStaticHandler({ webDistDir: tmp });
        // A `%ZZ` érvénytelen percent-encoded sequence — a
        // `decodeURIComponent` hibát dob.
        const res = await handler(new Request("http://localhost/static/%ZZ"));
        expect(res.status).toBe(400);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("returns 403 when normalized path escapes webDistDir", async () => {
      const tmp = mkdtempSync(join(tmpdir(), "static-test-"));
      try {
        const handler = createStaticHandler({ webDistDir: tmp });
        // A percent-encoded `..` szegmensek a decode + normalize után
        // a path elejére kerülnek, és a `..` check elutasítja.
        const res = await handler(
          new Request("http://localhost/static/" + encodeURIComponent("../../../etc/passwd")),
        );
        expect(res.status).toBe(403);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  });

  describe("unknown routes", () => {
    it("returns 404 for routes that are neither / nor /static/*", async () => {
      const handler = createStaticHandler({ webDistDir: "/nonexistent" });
      const res = await handler(new Request("http://localhost/api/something"));
      expect(res.status).toBe(404);
    });
  });
});
