import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  // Relative asset paths so the built app also works from file:// in the
  // Electron desktop shell. Harmless for web hosting at the domain root.
  base: './',
  // Single-source the app version from package.json (npm sets
  // npm_package_version for any script run). Fallback covers direct
  // `vite` invocations outside an npm script.
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0-dev'),
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
