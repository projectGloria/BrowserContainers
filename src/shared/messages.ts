// Discriminated-union protocol between UI/content contexts and the service worker.
// The `Res` map ties each request type to its response so callers get typed results
// without casting at every call site.
export type Req =
  | { type: 'tab/open'; containerId: string; url?: string }
  | { type: 'tab/reopenIn'; tabId: number; containerId: string | null }
  | { type: 'tab/getContainer'; tabId: number }
  | { type: 'container/delete'; containerId: string }
  | { type: 'container/clearCookies'; containerId: string }
  | { type: 'container/tabCount'; containerId: string }
  // From the content relay; the SW trusts sender.tab/sender.url, never a URL in the payload.
  | { type: 'cookie/write'; cookie: string };

export interface ResMap {
  'tab/open': { tabId: number };
  'tab/reopenIn': { tabId: number };
  'tab/getContainer': { containerId: string | null };
  'container/delete': { closedTabs: number };
  'container/clearCookies': { ok: true };
  'container/tabCount': { count: number };
  'cookie/write': { cookieString: string | null };
}

export type Res<T extends Req['type']> = ResMap[T];

type Envelope<T> = { ok: true; data: T } | { ok: false; error: string };

export async function send<R extends Req>(req: R): Promise<Res<R['type']>> {
  const env = (await chrome.runtime.sendMessage(req)) as Envelope<Res<R['type']>> | undefined;
  if (!env) throw new Error(`No handler responded to ${req.type}`);
  if (!env.ok) throw new Error(env.error);
  return env.data;
}

export type { Envelope };
