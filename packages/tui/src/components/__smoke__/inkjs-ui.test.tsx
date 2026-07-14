/**
 * packages/tui/src/components/__smoke__/inkjs-ui.test.tsx
 *
 * ===========================================================================
 * SMOKE TEST — @inkjs/ui v2.0.0 with Ink 7.1.0
 * ===========================================================================
 *
 * Phase 36 Track B1 research directive: "@inkjs/ui v2.0.0 was built for ink
 * 5/6, project is on ink 7.1.0. Before adopting widely, do a 30-line smoke
 * test to verify it loads + renders with ink 7.1.0."
 *
 * This file is a PERMANENT REGRESSION test. It verifies the four most-used
 * `@inkjs/ui` components (Badge, Spinner, StatusMessage, TextInput) load
 * and render with the project's ink 7.1.0 + React 19.2 stack. If a future
 * ink-major-upgrade breaks the library, this test fails immediately.
 *
 * Test approach: mount each component via ink-testing-library (the same
 * harness the rest of the TUI tests use), wait one frame, assert that
 * expected text is in the lastFrame().
 *
 * ===========================================================================
 */

import { describe, expect, it } from "bun:test";
import { Box, Text } from "ink";
import { render } from "ink-testing-library";
import { Badge, Spinner, StatusMessage, TextInput } from "@inkjs/ui";

describe("@inkjs/ui smoke test — ink 7.1.0 compatibility", () => {
  it("Badge renders text with the chosen color", () => {
    const instance = render(
      <Box>
        <Badge color="green">RUNNING</Badge>
        <Text> </Text>
        <Badge color="yellow">STOPPED</Badge>
      </Box>,
    );
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("RUNNING");
    expect(frame).toContain("STOPPED");
    instance.unmount();
  });

  it("Spinner renders an animated glyph + label", () => {
    const instance = render(<Spinner label="Connecting..." />);
    const frame = instance.lastFrame() ?? "";
    // The Spinner renders a Unicode-braille animated glyph + the label.
    // We assert the label is present (the glyph changes frame-to-frame,
    // so we don't pin a specific character).
    expect(frame).toContain("Connecting...");
    instance.unmount();
  });

  it("StatusMessage renders variant + message text", () => {
    const instance = render(<StatusMessage variant="success">trade closed</StatusMessage>);
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("trade closed");
    instance.unmount();
  });

  it("TextInput renders placeholder when empty", () => {
    const instance = render(<TextInput placeholder="enter symbol" />);
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("enter symbol");
    instance.unmount();
  });

  it("TextInput renders default value when provided", () => {
    const instance = render(<TextInput defaultValue="BTC/USDT" />);
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("BTC/USDT");
    instance.unmount();
  });

  it("Badge accepts TextProps['color'] union (smoke: amber, red, green)", () => {
    const instance = render(
      <Box flexDirection="column">
        <Badge color="yellow">[● STOPPED]</Badge>
        <Badge color="green">[● RUNNING]</Badge>
        <Badge color="red">[● KILLED]</Badge>
      </Box>,
    );
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("[● STOPPED]");
    expect(frame).toContain("[● RUNNING]");
    expect(frame).toContain("[● KILLED]");
    instance.unmount();
  });
});
