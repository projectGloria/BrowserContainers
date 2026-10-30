import { getContainerOf } from '../tabRegistry';
import { applyRules } from './applyRules';
import { jarFor, sameSiteContext, schedulePersist } from './cookieJar';
import { installCookieShim } from './docCookieShim';

const isHttp = (url: string | undefined): url is string => !!url && /^https?:/i.test(url);

async function topUrlOf(tabId: number): Promise<string | undefined> {
  try {
    return (await chrome.tabs.get(tabId)).url;
  } catch {
    return undefined; // tab gone
  }
}

// What page JS may see via document.cookie for a given frame: no HttpOnly (http:false),
// SameSite evaluated against the top-level site, like the real cookie store does.
async function scriptVisibleCookies(containerId: string, frameUrl: string, topUrl: string | undefined) {
  const jar = await jarFor(containerId);
  try {
    return jar.getCookieStringSync(frameUrl, {
      http: false,
      sameSiteContext: sameSiteContext(frameUrl, topUrl, false),
    });
  } catch {
    return '';
  }
}

// --- server Set-Cookie -> container jar ---------------------------------------------------

export async function onHeadersReceived(
  d: chrome.webRequest.OnHeadersReceivedDetails,
): Promise<void> {
  // tabId -1 = service worker / prefetch / extension-initiated: not attributable to a container.
  if (d.tabId < 0) return;
  const containerId = await getContainerOf(d.tabId);
  if (!containerId) return;

  const headers = (d.responseHeaders ?? [])
    .filter((h) => h.name.toLowerCase() === 'set-cookie' && h.value)
    // Defensive: some stacks fold multiple Set-Cookie headers into one, newline-separated.
    .flatMap((h) => h.value!.split('\n'));
  if (headers.length === 0) return;

  const jar = await jarFor(containerId);
  const isNav = d.type === 'main_frame';
  const ctx = sameSiteContext(d.url, d.initiator, isNav);
  for (const h of headers) {
    try {
      // ignoreError: a single malformed/rejected cookie (bad Domain, public suffix) must not
      // abort the rest of the batch — same as a real browser silently dropping it.
      jar.setCookieSync(h, d.url, { http: true, sameSiteContext: ctx, ignoreError: true });
    } catch {
      /* rejected by RFC 6265 rules */
    }
  }
  schedulePersist(containerId);
  await applyRules(containerId);

  // Main-frame responses get a fresh shim on commit; subresource responses (XHR logins)
  // need an explicit push so document.cookie isn't stale until the next navigation.
  if (!isNav) void pushSync(d.tabId, d.frameId, containerId);
}

async function pushSync(tabId: number, frameId: number, containerId: string) {
  const frame = await chrome.webNavigation.getFrame({ tabId, frameId }).catch(() => null);
  if (!isHttp(frame?.url)) return;
  const value = await scriptVisibleCookies(containerId, frame.url, await topUrlOf(tabId));
  chrome.tabs.sendMessage(tabId, { type: 'cookie/sync', value }, { frameId }).catch(() => {});
}

// --- document.cookie shim injection ------------------------------------------------------

export async function onCommitted(
  d: chrome.webNavigation.WebNavigationTransitionCallbackDetails,
): Promise<void> {
  if (!isHttp(d.url)) return;
  const containerId = await getContainerOf(d.tabId);
  if (!containerId) return;
  const topUrl = d.frameId === 0 ? d.url : await topUrlOf(d.tabId);
  const initial = await scriptVisibleCookies(containerId, d.url, topUrl);
  await chrome.scripting
    .executeScript({
      target: { tabId: d.tabId, frameIds: [d.frameId] },
      world: 'MAIN',
      // Runs as soon as the document exists rather than at document_idle. Usually beats page
      // scripts, but it's NOT guaranteed to: see README "Known limitations".
      injectImmediately: true,
      func: installCookieShim,
      args: [initial],
    })
    .catch(() => {
      /* frame navigated away / chrome:// / PDF viewer etc. */
    });
}

// --- document.cookie writes from the relay -----------------------------------------------

export async function onScriptCookieWrite(
  cookie: string,
  sender: chrome.runtime.MessageSender,
): Promise<string | null> {
  const tabId = sender.tab?.id;
  if (tabId === undefined || !isHttp(sender.url)) return null;
  const containerId = await getContainerOf(tabId);
  if (!containerId) return null;

  const jar = await jarFor(containerId);
  const topUrl = sender.frameId === 0 ? sender.url : sender.tab?.url;
  try {
    // http:false => JS cannot set or overwrite HttpOnly cookies, matching browser semantics.
    jar.setCookieSync(cookie, sender.url, {
      http: false,
      sameSiteContext: sameSiteContext(sender.url, topUrl, false),
      ignoreError: true,
    });
  } catch {
    /* rejected */
  }
  schedulePersist(containerId);
  await applyRules(containerId);
  return scriptVisibleCookies(containerId, sender.url, topUrl);
}
