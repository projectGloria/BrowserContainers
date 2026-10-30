# Gloria Containers

Firefox-Containers-style tab isolation for Chromium-based browsers (built for Ungoogled Chromium, MV3).

- **Custom name and color** per container, optionally shown as a Chromium tab group (toggle in options). The group is only a label. Isolation is the cookie jar.
- **Right-click menus.** "Open link in container → X" on any link, and "Reopen this page in container → X / No container" on any page.
- **Custom icon from any image.** Upload any image the browser can decode (PNG, JPEG, WebP, AVIF, GIF, SVG, BMP, ICO), at any size up to 25 MB / 16384 px per side. It is center-cropped to a square and downscaled with a halving chain to crisp 16/32/48/128 PNGs. Only those PNGs are stored, in the extension's IndexedDB; the original is discarded. To set or change an existing container's icon, click its icon in the options list or upload one through Edit. Uploads for existing containers save immediately; new-container icons save when you click Create container.
- **Open bookmarks in a container.** The toolbar popup has a bookmark search and folder browser. Click a bookmark, then pick the container.
- **Per-container cookie jar.** Stay signed in to the same site with different accounts in side-by-side tabs.

## Build & install

```bash
npm install
npm run build
```

Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and pick `dist/`.

`npm test` runs the unit tests (rule compiler, icon geometry).

## How isolation works

Chromium has no container API (no `contextualIdentities`), so isolation is emulated:

| Piece | File |
| --- | --- |
| tabId → container binding (`chrome.storage.session`) | `src/background/tabRegistry.ts` |
| Per-container RFC 6265 jar (`tough-cookie`, persisted in IndexedDB) | `src/background/isolation/cookieJar.ts` |
| Jar → `declarativeNetRequest` session rules, scoped by `tabIds` | `src/background/isolation/compileRules.ts` |
| Server `Set-Cookie` → jar (`webRequest`, `extraHeaders`) | `src/background/isolation/cookieFlow.ts` |
| `document.cookie` override in the page's MAIN world | `src/background/isolation/docCookieShim.ts` + `src/content/relay.iife.ts` |

For every container tab:
1. A base rule strips the outgoing `Cookie` header, so default-store cookies never leak in. It also strips incoming `Set-Cookie`, so container cookies never land in the default store.
2. Higher-priority rules **set** `Cookie` from the container's jar. Rules are split by host-only vs `Domain=`, path, scheme (Secure cookies never go over http) and SameSite context (first-party / cross-site navigation / cross-site subresource).
3. Each container owns a block of 999 rule IDs. Updates are atomic, serialized and coalesced per container.

Tabs opened from a container tab (links, `target=_blank`, `window.open`) inherit its container.

## Known limitations — read these

- **Only cookies are isolated.** `localStorage`, `sessionStorage`, IndexedDB, Cache Storage, service workers and HTTP cache are still shared per origin across containers. Most sites keep sessions in cookies, but some SPAs keep tokens in `localStorage`, and those won't be separated.
- **Service-worker and prefetch requests** (`tabId === -1`) can't be attributed to a tab, so they use the default cookie store.
- **`document.cookie` is shimmed best-effort.** It is injected with `injectImmediately` on navigation commit, which usually runs before page scripts but not always. Inline scripts that read `document.cookie` immediately may briefly see the default store's non-HttpOnly cookies.
- **First request of an inherited tab.** If a link-opened tab's first request leaves before its rules are installed, the extension re-navigates it once inside the container. The first, discarded request still went out with default-store cookies.
- **Rule update lag.** The first request right after a new `Set-Cookie` can go out before the rules are recompiled.
- **Path matching is approximate.** `Path=/app` also matches `/application`. Ports are ignored for host-only cookies.
- **Not a browser profile.** Extensions can't create Chromium profiles. If you need full isolation (storage, cache, extensions, history), use real profiles (`--profile-directory`).
- **No bookmark-menu entry.** Chromium has no `bookmark` context-menu type (Firefox does), so the native bookmark menu can't get "Open in container". Use the bookmark picker in the toolbar popup instead. Or open the bookmark, then right-click the page → *Reopen this page in container*.
- **Saved tab groups.** Chromium saves every tab group. Closing a container group's last tab shows "Close tab and delete group?". Deleting only drops the saved group, never the container. Reopening a *saved* group later restores plain default-cookie tabs that merely look like the container. Turn grouping off in options if that bothers you.
- **Session lifetime.** Tab↔container bindings live in `storage.session`. After a browser restart, restored tabs come back as default tabs. Container cookie jars persist.
- **Unverified assumption (needs a manual check in your build).** The design relies on `webRequest.onHeadersReceived` still seeing `Set-Cookie` while a DNR rule strips it from the response. Verify it by signing in somewhere inside a container. If the login doesn't stick, this assumption is broken in your Chromium build.

## Manual test checklist

1. Create **Work** and **Personal**. Upload a 1000×1000 JPEG to one and an SVG to the other. Check the 16/32/48 previews in the editor, the popup, and the toolbar icon on a container tab.
2. Open github.com in Work and sign in as account A. Open github.com in Personal and sign in as account B. Reload both; each keeps its own account.
3. Open github.com in a normal tab: signed out (or your default account).
4. Ctrl+click a link in a Work tab: the new tab joins the Work group and stays signed in as A.
5. Delete **Personal**: its tabs close, and in the SW devtools `await chrome.declarativeNetRequest.getSessionRules()` shows no rules in its ID block.
