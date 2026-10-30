import { listContainers } from '../shared/containersStore';
import { openInContainer, reopenIn } from './containerTabs';
import { getContainerOf } from './tabRegistry';

// Chromium has no `bookmark` context (Firefox-only), so the native bookmark-bar menu can't
// be extended. Two menus cover it instead:
//  - "Open link in container" on any http(s) link in a page;
//  - "Reopen this page in container" on the page itself, so a bookmark opened normally can
//    be moved into a container with one right-click.
const WEB = ['http://*/*', 'https://*/*'];
const LINK_ROOT = 'gloria-link';
const PAGE_ROOT = 'gloria-page';
const NO_CONTAINER = '__none__';

// Item ids encode the action and target: `${root}:${containerId}`. They're the only state
// onClicked gets, so no in-memory map is needed to survive SW restarts.
const itemId = (root: string, cid: string) => `${root}:${cid}`;

// removeAll+create isn't atomic: two overlapping rebuilds (install + storage change) would
// interleave and throw duplicate-id errors. Chain them so each starts on a clean slate.
let chain: Promise<void> = Promise.resolve();
export function rebuildMenus(): Promise<void> {
  chain = chain.then(build, build);
  return chain;
}

async function build(): Promise<void> {
  await chrome.contextMenus.removeAll();
  const containers = await listContainers();
  if (!containers.length) return;

  const create = (p: chrome.contextMenus.CreateProperties) =>
    // The callback form is the only way to observe creation errors; swallow them so one bad
    // item doesn't reject the whole rebuild (lastError is read, so Chromium won't log it).
    chrome.contextMenus.create(p, () => void chrome.runtime.lastError);

  create({ id: LINK_ROOT, title: 'Open link in container', contexts: ['link'], targetUrlPatterns: WEB });
  create({ id: PAGE_ROOT, title: 'Reopen this page in container', contexts: ['page'], documentUrlPatterns: WEB });

  for (const c of containers) {
    create({ id: itemId(LINK_ROOT, c.id), parentId: LINK_ROOT, title: c.name, contexts: ['link'] });
    create({ id: itemId(PAGE_ROOT, c.id), parentId: PAGE_ROOT, title: c.name, contexts: ['page'] });
  }
  create({ id: `${PAGE_ROOT}:sep`, parentId: PAGE_ROOT, type: 'separator', contexts: ['page'] });
  create({ id: itemId(PAGE_ROOT, NO_CONTAINER), parentId: PAGE_ROOT, title: 'No container', contexts: ['page'] });
}

export async function onMenuClick(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab): Promise<void> {
  const id = String(info.menuItemId);
  const sep = id.indexOf(':');
  if (sep < 0) return;
  const root = id.slice(0, sep);
  const cid = id.slice(sep + 1);

  if (root === LINK_ROOT && info.linkUrl) {
    // Place it right after the source tab, like a middle-click would.
    const placement = tab ? { index: tab.index + 1, windowId: tab.windowId } : {};
    await openInContainer(cid, info.linkUrl, placement);
    return;
  }

  if (root === PAGE_ROOT && tab?.id !== undefined) {
    const target = cid === NO_CONTAINER ? null : cid;
    // Reopening into the container the tab is already in would just reload it with a new id.
    if (((await getContainerOf(tab.id)) ?? null) === target) return;
    await reopenIn(tab.id, target);
  }
}
