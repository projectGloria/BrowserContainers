import { listContainers, removeContainer } from '../shared/containersStore';
import { deleteIcon } from '../shared/db';
import type { Envelope, Req, ResMap } from '../shared/messages';
import { settingsChange } from '../shared/settings';
import type { Container } from '../shared/types';
import { paintAction, paintDefaultAction } from './actionIcon';
import { onMenuClick, rebuildMenus } from './contextMenus';
import {
  forgetTab,
  getContainer,
  inheritContainer,
  openInContainer,
  recordMainFrame,
  reopenIn,
} from './containerTabs';
import { applyRules } from './isolation/applyRules';
import { onCommitted, onHeadersReceived, onScriptCookieWrite } from './isolation/cookieFlow';
import { clearJar, dropJar } from './isolation/cookieJar';
import { ensureGroup, forgetGroups, restyleGroups, ungroupAll } from './tabGroups';
import { bindTab, boundContainerIds, getContainerOf, tabsOf, unbindTab } from './tabRegistry';

// MV3 rule: every listener is registered synchronously at module top level. The SW is
// restarted per event; a listener added after an `await` would miss the event that woke it.

const HTTP_URLS = ['http://*/*', 'https://*/*'];
const EXPIRY_ALARM = 'gloria-expiry';

// ---------- lifecycle ----------

chrome.runtime.onInstalled.addListener(() => {
  void paintDefaultAction();
  void rebuildMenus(); // menus persist across SW restarts, but an update/reload wipes them
  void chrome.alarms.create(EXPIRY_ALARM, { periodInMinutes: 5 });
});
chrome.runtime.onStartup.addListener(() => {
  void paintDefaultAction();
  void chrome.alarms.create(EXPIRY_ALARM, { periodInMinutes: 5 });
});

// Expired cookies stay baked into DNR rule strings until a recompile; sweep periodically.
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== EXPIRY_ALARM) return;
  for (const cid of await boundContainerIds()) void applyRules(cid);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  onMenuClick(info, tab).catch((e: unknown) => console.warn('[gloria] context menu action failed', e));
});

// ---------- network ----------

chrome.webRequest.onHeadersReceived.addListener(
  (d) => void onHeadersReceived(d),
  { urls: HTTP_URLS },
  // extraHeaders: without it Chromium hides Set-Cookie from webRequest entirely.
  ['responseHeaders', 'extraHeaders'],
);

chrome.webRequest.onBeforeRequest.addListener((d) => {
  recordMainFrame(d.tabId);
  return undefined; // observe-only; MV3 can't block here anyway without webRequestBlocking
}, {
  urls: HTTP_URLS,
  types: ['main_frame' as chrome.webRequest.ResourceType],
});

chrome.webNavigation.onCommitted.addListener(async (d) => {
  void onCommitted(d);
  if (d.frameId === 0) {
    const cid = await getContainerOf(d.tabId);
    // Re-assert per-tab toolbar icon after navigation.
    if (cid) void paintAction(d.tabId, await getContainer(cid));
  }
});

// ---------- tabs ----------

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id !== undefined && tab.openerTabId !== undefined) {
    void inheritContainer(tab.id, tab.openerTabId, tab.pendingUrl || tab.url);
  }
});

chrome.webNavigation.onCreatedNavigationTarget.addListener((d) => {
  void inheritContainer(d.tabId, d.sourceTabId, d.url);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  forgetTab(tabId);
  const cid = await unbindTab(tabId);
  if (cid) void applyRules(cid); // drop the tab from the container's tabIds
});

// Prerender/instant swaps replace a tab with a new tabId: carry the binding over,
// otherwise the visible tab silently becomes a default tab.
chrome.tabs.onReplaced.addListener(async (addedTabId, removedTabId) => {
  const cid = await unbindTab(removedTabId);
  if (!cid) return;
  await bindTab(addedTabId, cid);
  void applyRules(cid);
});

// ---------- container metadata changes (from options/popup writes) ----------

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;

  const s = settingsChange(changes);
  if (s && s.before.groupTabs !== s.after.groupTabs) {
    if (s.after.groupTabs) {
      // Turned on: group the container tabs that are already open.
      const byId = new Map((await listContainers()).map((c) => [c.id, c]));
      for (const cid of await boundContainerIds()) {
        const c = byId.get(cid);
        if (c) for (const t of await tabsOf(cid)) await ensureGroup(t, c); // sequential: shares one group per window
      }
    } else {
      void ungroupAll();
    }
  }

  if (!changes.containers) return;
  void rebuildMenus(); // any add/rename/delete changes the submenu
  const before = new Map(((changes.containers.oldValue ?? []) as Container[]).map((c) => [c.id, c]));
  const after = new Map(((changes.containers.newValue ?? []) as Container[]).map((c) => [c.id, c]));

  for (const [id, c] of after) {
    const prev = before.get(id);
    if (!prev) continue;
    if (prev.name !== c.name || prev.color !== c.color) void restyleGroups(c);
    if (prev.name !== c.name || prev.color !== c.color || prev.iconVersion !== c.iconVersion) {
      for (const t of await tabsOf(id)) void paintAction(t, c);
    }
  }
  // Single cleanup path for deletes, no matter which context removed the container.
  for (const id of before.keys()) {
    if (!after.has(id)) void purge(id);
  }
});

async function purge(containerId: string) {
  const tabs = await tabsOf(containerId);
  await Promise.all(tabs.map((t) => unbindTab(t)));
  await applyRules(containerId); // no tabs left => removes the rule block and frees the slot
  await Promise.all([dropJar(containerId), deleteIcon(containerId), forgetGroups(containerId)]);
}

// ---------- messages ----------

const EXT_ORIGIN = new URL(chrome.runtime.getURL('')).origin;

// Content scripts run inside web pages; a compromised renderer can send ANY message
// through them. Only extension pages may perform privileged operations.
const isExtensionPage = (s: chrome.runtime.MessageSender) =>
  s.id === chrome.runtime.id && !!s.url && new URL(s.url).origin === EXT_ORIGIN;

async function handle(msg: Req, sender: chrome.runtime.MessageSender): Promise<ResMap[Req['type']]> {
  if (msg.type === 'cookie/write') {
    return { cookieString: await onScriptCookieWrite(msg.cookie, sender) };
  }
  if (!isExtensionPage(sender)) throw new Error('Forbidden');

  switch (msg.type) {
    case 'tab/open':
      return { tabId: await openInContainer(msg.containerId, msg.url) };
    case 'tab/reopenIn':
      return { tabId: await reopenIn(msg.tabId, msg.containerId) };
    case 'tab/getContainer':
      return { containerId: (await getContainerOf(msg.tabId)) ?? null };
    case 'container/tabCount':
      return { count: (await tabsOf(msg.containerId)).length };
    case 'container/clearCookies':
      await clearJar(msg.containerId);
      await applyRules(msg.containerId);
      return { ok: true };
    case 'container/delete': {
      // Close the tabs: leaving them open would silently move logged-in pages to the
      // default jar on next request, which is worse than closing them.
      const tabs = await tabsOf(msg.containerId);
      await Promise.all(tabs.map((t) => chrome.tabs.remove(t).catch(() => {})));
      await removeContainer(msg.containerId); // storage.onChanged -> purge()
      return { closedTabs: tabs.length };
    }
  }
}

chrome.runtime.onMessage.addListener((msg: Req, sender, sendResponse) => {
  handle(msg, sender).then(
    (data) => sendResponse({ ok: true, data } satisfies Envelope<unknown>),
    (e: unknown) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }),
  );
  return true; // keep the channel open for the async response
});

// Cheap sanity on SW wake: bindings for containers that no longer exist (deleted while the
// SW was dead and the onChanged event lost) get purged.
void (async () => {
  const live = new Set((await listContainers()).map((c) => c.id));
  for (const cid of await boundContainerIds()) if (!live.has(cid)) void purge(cid);
})();
