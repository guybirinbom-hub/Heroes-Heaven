import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite config tuned for Tauri 2: fixed dev port, no screen clearing so Tauri
// logs stay visible, and src-tauri excluded from the watcher.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
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
