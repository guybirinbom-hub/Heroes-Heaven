/// <reference types="vite/client" />

/** The app's package.json version, injected by `define` in vite.config.ts / vitest.config.ts.
 *  Read it through src/version.ts, which guards against consumers without the define. */
declare const __APP_VERSION__: string;
