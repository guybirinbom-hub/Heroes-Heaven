import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// Vite config tuned for Tauri 2: fixed dev port, no screen clearing so Tauri
// logs stay visible, and src-tauri excluded from the watcher.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  // The app's own version (src/version.ts) — used by the backup envelope and the update check.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: {
    rollupOptions: {
      output: {
        // Split the React runtime into its own long-cached vendor chunk so app-code changes don't
        // bust it (and the main chunk shrinks below the size-warning threshold).
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-dom/client'],
        },
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
});
