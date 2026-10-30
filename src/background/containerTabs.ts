import { listContainers } from '../shared/containersStore';
import type { Container } from '../shared/types';
import { paintAction } from './actionIcon';
import { applyRules } from './isolation/applyRules';
import { ensureGroup } from './tabGroups';
import { bindTab, getContainerOf } from './tabRegistry';

export async function getContainer(id: string): Promise<Container | undefined> {
  return (await listContainers()).find((c) => c.id === id);
}

// Main-frame requests seen per tab, recorded by an observational onBeforeRequest listener.
// Used to tell whether an inherited tab's first request beat our rules out the door.
const firstNavAt = new Map<number, number>();
export function recordMainFrame(tabId: number) {
  if (tabId < 0 || firstNavAt.has(tabId)) return;
  firstNavAt.set(tabId, performance.now());
  // Bounded: only the "just created" window matters.
  if (firstNavAt.size > 500) firstNavAt.delete(firstNavAt.keys().next().value!);
}
export const forgetTab = (tabId: number) => firstNavAt.delete(tabId);

/**
 * Bind a tab to a container. Order matters: binding + DNR rules must be live BEFORE the
 * tab issues requests, otherwise the first request carries default-store cookies.
 */
async function attach(tabId: number, c: Container) {
  await bindTab(tabId, c.id);
  await applyRules(c.id);
  await Promise.all([ensureGroup(tabId, c), paintAction(tabId, c)]);
}

export async function openInContainer(
  containerId: string,
  url?: string,
  placement: { index?: number; windowId?: number } = {},
): Promise<number> {
  const c = await getContainer(containerId);
  if (!c) throw new Error('Container not found');
  // Create on about:blank (no network), attach, THEN navigate. Creating straight on `url`
  // would race the rule install. No url => browser's new-tab page; typed URLs then
  // navigate this already-bound tab.
  const tab = await chrome.tabs.create({ url: url ? 'about:blank' : undefined, active: true, ...placement });
  const tabId = tab.id!;
  await attach(tabId, c);
  if (url) await chrome.tabs.update(tabId, { url });
  return tabId;
}

export async function reopenIn(tabId: number, containerId: string | null): Promise<number> {
  const old = await chrome.tabs.get(tabId);
  const url = old.url && /^https?:/i.test(old.url) ? old.url : undefined;
  const placement = { index: old.index + 1, windowId: old.windowId };
  const newId = containerId
    ? await openInContainer(containerId, url, placement)
    : (await chrome.tabs.create({ url, active: true, ...placement })).id!;
  await chrome.tabs.remove(tabId);
  return newId;
}

// Links opened from a container tab (target=_blank, ctrl+click, window.open) stay in it.
// Both tabs.onCreated and webNavigation.onCreatedNavigationTarget fire for the same tab,
// so dedupe in-flight adoptions.
const adopting = new Set<number>();
export async function inheritContainer(tabId: number, openerTabId: number, url: string | undefined) {
  if (adopting.has(tabId)) return;
  // Ctrl+T sets an opener too, but lands on chrome://newtab: that should be a default tab.
  if (!url || !/^https?:/i.test(url)) return;
  const cid = await getContainerOf(openerTabId);
  if (!cid || (await getContainerOf(tabId))) return;
  const c = await getContainer(cid);
  if (!c) return;

  adopting.add(tabId);
  try {
    await attach(tabId, c);
    // If a main-frame request already left before rules were live, it went out with the
    // default jar's cookies: re-navigate so the page actually loads inside the container.
    if (firstNavAt.has(tabId)) await chrome.tabs.update(tabId, { url }).catch(() => {});
  } finally {
    adopting.delete(tabId);
  }
}
