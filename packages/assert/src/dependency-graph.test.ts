import { describe, expect, it } from "vitest";

import assertionManifest from "../package.json" with { type: "json" };
import typeguardManifest from "../../typeguard/package.json" with { type: "json" };
import typingManifest from "../../typing/package.json" with { type: "json" };

describe("foundation dependency graph", () => {
  it("permits only the directed internal runtime dependency chain", () => {
    expect(typingManifest.name).toBe("@mm-crypto-bot/typing");
    expect(typeguardManifest.name).toBe("@mm-crypto-bot/typeguard");
    expect(assertionManifest.name).toBe("@mm-crypto-bot/assert");
    expect("dependencies" in typingManifest).toBe(false);
    expect(typeguardManifest.dependencies).toEqual({ "@mm-crypto-bot/typing": "workspace:*" });
    expect(assertionManifest.dependencies).toEqual({
      "@mm-crypto-bot/typeguard": "workspace:*",
      "@mm-crypto-bot/typing": "workspace:*",
    });
  });
});
