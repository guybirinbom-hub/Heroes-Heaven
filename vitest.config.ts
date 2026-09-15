import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// Rules tests are pure TS and run in node. A handful of DISPLAY tests render real components in
// jsdom (`// @vitest-environment jsdom` at the top of the file, and a .test.tsx extension) — the
// app's dominant defect class is "the value is computed correctly and no surface shows it", and a
// suite that never renders anything is blind to every one of them. Tests live in test/ (outside
// src/) so the app build (tsc -b on src/) never compiles them.
export default defineConfig({
  // Mirror the app build's version injection (vite.config.ts) so src/version.ts works under tests.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  /*
   * ONE React, as the app has.
   *
   * tracker/ is a second npm project with its own node_modules, so `zustand` there resolves ITS react
   * copy: any test that renders a tracker component through HH got a second React whose hook
   * dispatcher is null — "Cannot read properties of null (reading 'useCallback')" from inside zustand,
   * which reads like a bug in the component. The app never sees it because @vitejs/plugin-react sets
   * this same dedupe, and that plugin isn't part of the test config.
   */
  resolve: { dedupe: ['react', 'react-dom'] },
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    environment: 'node',
    // …and the dedupe above only reaches a module Vite itself loads. Anything under node_modules is
    // externalized to Node's own resolver by default, which is what handed zustand the second React.
    server: { deps: { inline: [/zustand/] } },
  },
});
