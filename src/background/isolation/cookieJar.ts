import { CookieJar, MemoryCookieStore, getPublicSuffix } from 'tough-cookie';
import { deleteJar, getJar, putJar } from '../../shared/db';

// In-memory jars, rehydrated lazily from IndexedDB. Memoize the promise so two concurrent
// Set-Cookie events after a SW wake don't each deserialize their own (diverging) jar.
const jars = new Map<string, Promise<CookieJar>>();
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function jarFor(containerId: string): Promise<CookieJar> {
  let p = jars.get(containerId);
  if (!p) {
    p = getJar(containerId).then((serialized) =>
      serialized
        ? CookieJar.deserializeSync(serialized, new MemoryCookieStore())
        : // looseMode accepts `Set-Cookie: value` without a name, which real browsers also accept.
          new CookieJar(new MemoryCookieStore(), { looseMode: true }),
    );
    jars.set(containerId, p);
  }
  return p;
}

// Debounced write-behind: a login response can carry 20+ Set-Cookie headers; one IDB write
// per burst instead of 20. 250ms is far below the SW's ~30s idle-kill window.
export function schedulePersist(containerId: string): void {
  clearTimeout(persistTimers.get(containerId));
  persistTimers.set(
    containerId,
    setTimeout(async () => {
      persistTimers.delete(containerId);
      const jar = await jars.get(containerId);
      const s = jar?.serializeSync();
      if (s) await putJar(containerId, s);
    }, 250),
  );
}

export async function clearJar(containerId: string): Promise<void> {
  (await jarFor(containerId)).removeAllCookiesSync();
  schedulePersist(containerId);
}

export async function dropJar(containerId: string): Promise<void> {
  clearTimeout(persistTimers.get(containerId));
  persistTimers.delete(containerId);
  jars.delete(containerId);
  await deleteJar(containerId);
}

// "Site" in the SameSite sense = registrable domain (eTLD+1). IPs/localhost have no
// public suffix, so they fall back to the bare host.
export function siteOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const host = new URL(url).hostname;
    return getPublicSuffix(host) ?? host;
  } catch {
    return undefined;
  }
}

export type SameSiteContext = 'strict' | 'lax' | 'none';

export function sameSiteContext(
  url: string,
  contextUrl: string | undefined,
  isTopLevelNav: boolean,
): SameSiteContext {
  if (!contextUrl) return 'strict'; // typed URL / bookmark: no initiator, first-party by definition
  if (siteOf(url) === siteOf(contextUrl)) return 'strict';
  return isTopLevelNav ? 'lax' : 'none';
}
