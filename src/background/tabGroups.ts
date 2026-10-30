import { getSettings } from '../shared/settings';
import type { Container } from '../shared/types';
import { SessionMap } from './sessionMap';

// `${containerId}:${windowId}` -> groupId. Tab groups are per-window, so one container
// can have a group in each window.
const groups = new SessionMap<string, number>('groups', String);
const keyOf = (containerId: string, windowId: number) => `${containerId}:${windowId}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Chromium rejects tab edits while the user is dragging a tab ("Tabs cannot be edited right now").
async function retry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= attempts - 1) throw e;
      await sleep(150 * (i + 1));
    }
  }
}

export async function ensureGroup(tabId: number, c: Container): Promise<void> {
  try {
    if (!(await getSettings()).groupTabs) return;
    const tab = await chrome.tabs.get(tabId);
    if (tab.pinned) return; // pinned tabs can't be grouped
    const key = keyOf(c.id, tab.windowId);
    const existing = await groups.get(key);
    if (existing !== undefined) {
      const alive = await chrome.tabGroups.get(existing).then(
        () => true,
        () => false,
      );
      if (alive) {
        if (tab.groupId !== existing) await retry(() => chrome.tabs.group({ groupId: existing, tabIds: tabId }));
        return;
      }
      await groups.delete(key); // user closed/ungrouped it; make a fresh one
    }
    const groupId = await retry(() =>
      chrome.tabs.group({ tabIds: tabId, createProperties: { windowId: tab.windowId } }),
    );
    await chrome.tabGroups.update(groupId, { title: c.name, color: c.color as never });
    await groups.set(key, groupId);
  } catch (e) {
    // Grouping is cosmetic; isolation must never depend on it succeeding.
    console.warn('[gloria] ensureGroup failed', e);
  }
}

export async function restyleGroups(c: Container): Promise<void> {
  for (const [key, groupId] of await groups.entries()) {
    if (!key.startsWith(`${c.id}:`)) continue;
    await chrome.tabGroups
      .update(groupId, { title: c.name, color: c.color as never })
      .catch(() => groups.delete(key));
  }
}

export async function forgetGroups(containerId: string): Promise<void> {
  for (const [key] of await groups.entries()) {
    if (key.startsWith(`${containerId}:`)) await groups.delete(key);
  }
}

// Grouping switched off: dissolve every group we created. Ungrouping (not closing) keeps the
// tabs and their container bindings intact; Chromium drops a group once its last tab leaves it.
export async function ungroupAll(): Promise<void> {
  for (const [key, groupId] of await groups.entries()) {
    const tabIds = (await chrome.tabs.query({ groupId })).flatMap((t) => (t.id === undefined ? [] : [t.id]));
    if (tabIds.length) await retry(() => chrome.tabs.ungroup(tabIds as [number, ...number[]])).catch(() => {});
    await groups.delete(key);
  }
}
