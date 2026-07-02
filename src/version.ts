/** App version from package.json, injected at build time (`define` in vite.config.ts). The typeof
 *  guard keeps consumers outside Vite/Vitest (plain tsc, a bare test runner) from crashing. */
export const APP_VERSION: string = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
