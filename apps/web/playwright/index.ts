/**
 * playwright/index.ts
 *
 * Playwright Component Test entry point. Mounted by `playwright/index.html`
 * when a CT spec calls `mount(<Component />)`.
 *
 * The component-under-test is provided by Playwright via the `mount` API.
 * We don't need to import React here because Playwright handles the mount
 * via the experimental-ct-react package.
 */
import "../src/main.tsx";
