#!/usr/bin/env bun
/**
 * apps/tui/src/index.tsx
 */

import { render } from "ink";
import { App } from "./app.js";

const instance = render(<App />);
await instance.waitUntilExit();