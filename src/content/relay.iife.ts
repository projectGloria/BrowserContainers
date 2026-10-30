// ISOLATED-world content script. The MAIN-world shim can't touch chrome.runtime, so it
// dispatches DOM CustomEvents and this script relays them to the SW and back.
//
// Trust model: a page can dispatch 'gloria:cookie-write' itself, but that's equivalent to
// assigning document.cookie. The SW attributes writes using sender.tab/sender.url, never
// anything in the payload, so a page can only ever write its own container's cookies.
import type { Envelope, ResMap } from '../shared/messages';

const sync = (value: string) =>
  document.dispatchEvent(new CustomEvent('gloria:cookie-sync', { detail: value }));

document.addEventListener('gloria:cookie-write', (e) => {
  const cookie = (e as CustomEvent).detail;
  if (typeof cookie !== 'string') return;
  chrome.runtime
    .sendMessage({ type: 'cookie/write', cookie })
    .then((env: Envelope<ResMap['cookie/write']> | undefined) => {
      if (env?.ok && env.data.cookieString !== null) sync(env.data.cookieString);
    })
    .catch(() => {
      /* extension reloaded / context invalidated: nothing useful to do */
    });
});

// Server-side Set-Cookie on a subresource response -> SW pushes the fresh non-HttpOnly string.
chrome.runtime.onMessage.addListener((msg: { type?: string; value?: unknown }) => {
  if (msg?.type === 'cookie/sync' && typeof msg.value === 'string') sync(msg.value);
});
