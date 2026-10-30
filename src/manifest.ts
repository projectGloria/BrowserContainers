import { defineManifest } from '@crxjs/vite-plugin';
import pkg from '../package.json' with { type: 'json' };

export default defineManifest({
  manifest_version: 3,
  name: 'Gloria Containers',
  description: 'Per-container cookie jars, custom names and icons for Chromium.',
  version: pkg.version,
  minimum_chrome_version: '120',
  action: {
    default_popup: 'src/popup/index.html',
    default_title: 'Gloria Containers',
  },
  options_page: 'src/options/index.html',
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  content_scripts: [
    {
      // ISOLATED-world relay: bridges the MAIN-world document.cookie shim to the SW.
      matches: ['http://*/*', 'https://*/*'],
      js: ['src/content/relay.iife.ts'],
      run_at: 'document_start',
      all_frames: true,
    },
  ],
  permissions: [
    'storage',
    'unlimitedStorage',
    'tabs',
    'tabGroups',
    'declarativeNetRequest',
    'webRequest',
    'webNavigation',
    'scripting',
    'alarms',
    'contextMenus',
    'bookmarks',
    'favicon',
  ],
  host_permissions: ['<all_urls>'],
});
