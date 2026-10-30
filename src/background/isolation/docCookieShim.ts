// MAIN-world document.cookie override.
//
// IMPORTANT: chrome.scripting serializes this function via toString() and evaluates it in the
// page. It must not reference ANY outer-scope identifier (imports, module consts, helpers),
// because none of them exist on the other side. Everything it needs is inline.
//
// Why it's needed: the DNR base rule strips Set-Cookie for container tabs, so the real cookie
// store never holds container cookies. Without this shim, page JS reading document.cookie would
// see the *default* store's cookies (wrong account) and its writes would go to the default store.
export function installCookieShim(initial: string): void {
  type Hooked = { __gloriaSetCookies?: (v: string) => void };
  const w = window as unknown as Hooked;
  // Re-injection on the same document (e.g. bfcache restore) just refreshes the value.
  if (w.__gloriaSetCookies) {
    w.__gloriaSetCookies(initial);
    return;
  }

  // name -> value, insertion-ordered like the real cookie string.
  const jar = new Map<string, string>();
  const load = (s: string) => {
    jar.clear();
    for (const part of s.split(';')) {
      const p = part.trim();
      if (!p) continue;
      const eq = p.indexOf('=');
      jar.set(eq < 0 ? '' : p.slice(0, eq), eq < 0 ? p : p.slice(eq + 1));
    }
  };
  const serialize = () =>
    [...jar].map(([k, v]) => (k === '' ? v : `${k}=${v}`)).join('; ');
  load(initial);

  Object.defineProperty(w, '__gloriaSetCookies', { value: load, enumerable: false });

  // Own property on the document instance shadows Document.prototype's accessor.
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    enumerable: true,
    get: () => serialize(),
    set: (raw: unknown) => {
      const str = String(raw);
      // Optimistic local apply so `document.cookie = 'a=1'; document.cookie` reads back
      // synchronously (the SW round-trip is async). Path/Domain are ignored locally;
      // the SW's authoritative answer overwrites this via the sync event.
      const [pair = '', ...attrs] = str.split(';');
      const eq = pair.indexOf('=');
      const name = (eq < 0 ? '' : pair.slice(0, eq)).trim();
      const value = (eq < 0 ? pair : pair.slice(eq + 1)).trim();
      let expired = false;
      for (const a of attrs) {
        const [k = '', v = ''] = a.split('=').map((x) => x.trim());
        const key = k.toLowerCase();
        if (key === 'max-age' && Number(v) <= 0) expired = true;
        if (key === 'expires' && Date.parse(v) <= Date.now()) expired = true;
      }
      if (expired) jar.delete(name);
      else jar.set(name, value);
      document.dispatchEvent(new CustomEvent('gloria:cookie-write', { detail: str }));
    },
  });

  // Authoritative value from the SW (relayed by the ISOLATED content script).
  document.addEventListener('gloria:cookie-sync', (e) => {
    const v = (e as CustomEvent).detail;
    if (typeof v === 'string') load(v);
  });
}
