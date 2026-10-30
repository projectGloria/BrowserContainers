import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './src/manifest.ts';

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  build: {
    // Chromium-only target: no reason to down-level syntax for a browser we control.
    target: 'esnext',
    // Keep function bodies readable; the MAIN-world shim is serialized via Function#toString
    // by chrome.scripting, so it must stay self-contained (no injected bundler helpers).
    minify: false,
  },
});
